import { MembershipStatus } from '../../../generated/prisma/enums.js';
import { prisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../../shared/constants/audit.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors/AppError.js';
import { writeAudit, type AuditContext } from '../../shared/utils/audit.js';
import {
  formatDateOnly,
  startOfMonth,
  startOfNextMonth,
  toDateOnly,
  yearMonthOf,
  zonedToday,
} from '../../shared/utils/date.js';
import { D, sum } from '../../shared/utils/decimal.js';
import { isPeriodOpen, periodForDate } from '../period/period.service.js';
import { assertCutoff, evaluateCutoff, type CutoffSettings } from './meal.cutoff.js';
import type { CopyMealsInput, OverrideMealInput, UpsertMealInput } from './meal.validation.js';

const mealSelect = {
  id: true,
  date: true,
  breakfast: true,
  lunch: true,
  dinner: true,
  guestBreakfast: true,
  guestLunch: true,
  guestDinner: true,
  note: true,
  overrideReason: true,
  membershipId: true,
  updatedAt: true,
} as const;

type MealRow = {
  breakfast: unknown;
  lunch: unknown;
  dinner: unknown;
  guestBreakfast: unknown;
  guestLunch: unknown;
  guestDinner: unknown;
};

/** Blueprint 4.1: one number drives every downstream calculation. */
export const totalMealUnits = (meal: MealRow) =>
  sum([
    D(meal.breakfast as never),
    D(meal.lunch as never),
    D(meal.dinner as never),
    D(meal.guestBreakfast as never),
    D(meal.guestLunch as never),
    D(meal.guestDinner as never),
  ]);

const withTotals = <T extends MealRow>(meal: T) => ({
  ...meal,
  totalMealUnits: totalMealUnits(meal).toFixed(2),
});

const quantityData = (input: UpsertMealInput) => ({
  ...(input.breakfast !== undefined ? { breakfast: input.breakfast } : {}),
  ...(input.lunch !== undefined ? { lunch: input.lunch } : {}),
  ...(input.dinner !== undefined ? { dinner: input.dinner } : {}),
  ...(input.guestBreakfast !== undefined ? { guestBreakfast: input.guestBreakfast } : {}),
  ...(input.guestLunch !== undefined ? { guestLunch: input.guestLunch } : {}),
  ...(input.guestDinner !== undefined ? { guestDinner: input.guestDinner } : {}),
  ...(input.note !== undefined ? { note: input.note } : {}),
});

/**
 * Blueprint 4.2 (4): a closed month is immutable. This guard runs for members
 * and managers alike — an override may bypass the cutoff, never a closed period.
 */
const assertPeriodOpen = (status: Parameters<typeof isPeriodOpen>[0], date: Date): void => {
  if (!isPeriodOpen(status)) {
    throw new ForbiddenError(
      `${formatDateOnly(date)} belongs to a closed month. Ask the owner to reopen it first.`,
    );
  }
};

const upsertOwnMeal = async (
  messId: string,
  membershipId: string,
  dateInput: string,
  input: UpsertMealInput,
  settings: CutoffSettings,
) => {
  const date = toDateOnly(dateInput);
  assertCutoff(date, settings);

  const period = await periodForDate(prisma, messId, date);
  assertPeriodOpen(period.status, date);

  const data = quantityData(input);

  const meal = await prisma.mealEntry.upsert({
    where: { membershipId_date: { membershipId, date } },
    create: { messId, periodId: period.id, membershipId, date, ...data },
    update: data,
    select: mealSelect,
  });

  return withTotals(meal);
};

/**
 * Manager override: skips the cutoff but demands a reason, and the before/after
 * snapshot goes to the audit log (blueprint 4.2 rule 3).
 */
const overrideMeal = async (
  messId: string,
  input: OverrideMealInput,
  context: AuditContext,
) => {
  const date = toDateOnly(input.date);

  const membership = await prisma.membership.findFirst({
    where: { id: input.membershipId, messId, status: { not: MembershipStatus.REMOVED } },
    select: { id: true },
  });
  if (!membership) throw new NotFoundError('Member not found in this mess');

  const period = await periodForDate(prisma, messId, date);
  assertPeriodOpen(period.status, date);

  const before = await prisma.mealEntry.findUnique({
    where: { membershipId_date: { membershipId: input.membershipId, date } },
    select: mealSelect,
  });

  const { membershipId: _membershipId, date: _date, reason, ...quantities } = input;
  const data = { ...quantityData(quantities), overrideReason: reason };

  const meal = await prisma.mealEntry.upsert({
    where: { membershipId_date: { membershipId: input.membershipId, date } },
    create: { messId, periodId: period.id, membershipId: input.membershipId, date, ...data },
    update: data,
    select: mealSelect,
  });

  await writeAudit(prisma, context, {
    action: AUDIT_ACTIONS.MEAL_OVERRIDE,
    entityType: AUDIT_ENTITIES.MEAL_ENTRY,
    entityId: meal.id,
    reason,
    before,
    after: meal,
  });

  return withTotals(meal);
};

/** Blueprint 7.5: "copy yesterday" / "same for 7 days" is the most-used action. */
const copyMeals = async (
  messId: string,
  membershipId: string,
  input: CopyMealsInput,
  settings: CutoffSettings,
) => {
  const source = await prisma.mealEntry.findUnique({
    where: { membershipId_date: { membershipId, date: toDateOnly(input.fromDate) } },
    select: mealSelect,
  });
  if (!source) throw new NotFoundError(`No meal entry found for ${input.fromDate}`);

  const quantities = {
    breakfast: source.breakfast,
    lunch: source.lunch,
    dinner: source.dinner,
    guestBreakfast: source.guestBreakfast,
    guestLunch: source.guestLunch,
    guestDinner: source.guestDinner,
  };

  const applied: string[] = [];
  const skipped: { date: string; reason: string }[] = [];

  for (const target of input.toDates) {
    const date = toDateOnly(target);
    const decision = evaluateCutoff(date, settings);

    if (!decision.allowed) {
      skipped.push({ date: target, reason: decision.reason ?? 'Editing is closed' });
      continue;
    }

    const period = await periodForDate(prisma, messId, date);
    if (!isPeriodOpen(period.status)) {
      skipped.push({ date: target, reason: 'Month is closed' });
      continue;
    }

    const existing = await prisma.mealEntry.findUnique({
      where: { membershipId_date: { membershipId, date } },
      select: { id: true },
    });

    if (existing && !input.overwrite) {
      skipped.push({ date: target, reason: 'Entry already exists' });
      continue;
    }

    await prisma.mealEntry.upsert({
      where: { membershipId_date: { membershipId, date } },
      create: { messId, periodId: period.id, membershipId, date, ...quantities },
      update: quantities,
      select: { id: true },
    });

    applied.push(target);
  }

  // Partial success is reported, never silently swallowed.
  return { applied, skipped };
};

const myMonth = async (
  messId: string,
  membershipId: string,
  monthInput: string | undefined,
  timezone: string,
) => {
  const today = zonedToday(timezone);
  const { year, month } = monthInput
    ? { year: Number(monthInput.slice(0, 4)), month: Number(monthInput.slice(5, 7)) }
    : yearMonthOf(today);

  const meals = await prisma.mealEntry.findMany({
    where: {
      membershipId,
      messId,
      date: { gte: startOfMonth(year, month), lt: startOfNextMonth(year, month) },
    },
    select: mealSelect,
    orderBy: { date: 'asc' },
  });

  const entries = meals.map((meal) => ({
    ...withTotals(meal),
    date: formatDateOnly(meal.date),
  }));

  return {
    year,
    month,
    totalMealUnits: sum(entries.map((entry) => D(entry.totalMealUnits))).toFixed(2),
    daysWithMeals: entries.filter((entry) => D(entry.totalMealUnits).greaterThan(0)).length,
    entries,
  };
};

const dailyList = async (messId: string, dateInput: string | undefined, timezone: string) => {
  const date = dateInput ? toDateOnly(dateInput) : zonedToday(timezone);

  const members = await prisma.membership.findMany({
    where: { messId, status: { in: [MembershipStatus.ACTIVE, MembershipStatus.INACTIVE] } },
    select: {
      id: true,
      roomLabel: true,
      status: true,
      user: { select: { id: true, name: true } },
      meals: { where: { date }, select: mealSelect },
    },
    orderBy: { joinedAt: 'asc' },
  });

  const rows = members.map((member) => {
    const meal = member.meals[0];
    return {
      membershipId: member.id,
      name: member.user.name,
      roomLabel: member.roomLabel,
      status: member.status,
      breakfast: meal?.breakfast ?? D(0),
      lunch: meal?.lunch ?? D(0),
      dinner: meal?.dinner ?? D(0),
      guestBreakfast: meal?.guestBreakfast ?? D(0),
      guestLunch: meal?.guestLunch ?? D(0),
      guestDinner: meal?.guestDinner ?? D(0),
      note: meal?.note ?? null,
      totalMealUnits: meal ? totalMealUnits(meal).toFixed(2) : '0.00',
    };
  });

  return { date: formatDateOnly(date), members: rows };
};

/**
 * Cook screen: totals only, no money. Guest meals are counted separately so the
 * kitchen knows the head count is higher than the member count.
 */
const dailySummary = async (messId: string, dateInput: string | undefined, timezone: string) => {
  const date = dateInput ? toDateOnly(dateInput) : zonedToday(timezone);

  const meals = await prisma.mealEntry.findMany({
    where: { messId, date },
    select: {
      breakfast: true,
      lunch: true,
      dinner: true,
      guestBreakfast: true,
      guestLunch: true,
      guestDinner: true,
      membership: { select: { user: { select: { name: true } } }, },
    },
  });

  const totalOf = (key: 'breakfast' | 'lunch' | 'dinner') =>
    sum(meals.map((meal) => D(meal[key] as never)));
  const guestOf = (key: 'guestBreakfast' | 'guestLunch' | 'guestDinner') =>
    sum(meals.map((meal) => D(meal[key] as never)));

  return {
    date: formatDateOnly(date),
    breakfast: totalOf('breakfast').plus(guestOf('guestBreakfast')).toFixed(2),
    lunch: totalOf('lunch').plus(guestOf('guestLunch')).toFixed(2),
    dinner: totalOf('dinner').plus(guestOf('guestDinner')).toFixed(2),
    guestTotal: sum([
      guestOf('guestBreakfast'),
      guestOf('guestLunch'),
      guestOf('guestDinner'),
    ]).toFixed(2),
    membersEating: meals.filter((meal) => totalMealUnits(meal).greaterThan(0)).length,
  };
};

/** Per-member meal units for a period — the input to the monthly meal rate. */
const monthlySummary = async (messId: string, periodId: string) => {
  const period = await prisma.messPeriod.findFirst({
    where: { id: periodId, messId },
    select: { id: true, year: true, month: true, status: true },
  });
  if (!period) throw new NotFoundError('Period not found in this mess');

  const meals = await prisma.mealEntry.findMany({
    where: { periodId },
    select: {
      ...mealSelect,
      membership: { select: { id: true, roomLabel: true, user: { select: { name: true } } } },
    },
  });

  const perMember = new Map<string, { name: string; roomLabel: string | null; units: ReturnType<typeof D> }>();

  for (const meal of meals) {
    const current = perMember.get(meal.membership.id) ?? {
      name: meal.membership.user.name,
      roomLabel: meal.membership.roomLabel,
      units: D(0),
    };
    current.units = current.units.plus(totalMealUnits(meal));
    perMember.set(meal.membership.id, current);
  }

  const members = [...perMember.entries()].map(([membershipId, value]) => ({
    membershipId,
    name: value.name,
    roomLabel: value.roomLabel,
    totalMealUnits: value.units.toFixed(2),
  }));

  return {
    period,
    totalMealUnits: sum(members.map((member) => D(member.totalMealUnits))).toFixed(2),
    members: members.sort((a, b) => a.name.localeCompare(b.name)),
  };
};

const cutoffStatus = (settings: CutoffSettings, dateInput?: string) => {
  const date = dateInput ? toDateOnly(dateInput) : zonedToday(settings.timezone);
  const decision = evaluateCutoff(date, settings);

  return {
    date: formatDateOnly(date),
    editable: decision.allowed,
    reason: decision.reason,
    mealCutoffTime: settings.mealCutoffTime,
    cutoffDaysAhead: settings.cutoffDaysAhead,
    timezone: settings.timezone,
  };
};

export const mealService = {
  upsertOwnMeal,
  overrideMeal,
  copyMeals,
  myMonth,
  dailyList,
  dailySummary,
  monthlySummary,
  cutoffStatus,
};
