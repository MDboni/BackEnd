import {
  AllocationType,
  DepositType,
  MembershipStatus,
  PeriodStatus,
} from '../../../generated/prisma/enums.js';
import { prisma } from '../../config/prisma.js';
import { formatDateOnly, yearMonthOf, zonedToday } from '../../shared/utils/date.js';
import { D, sum, toMoney, toRate } from '../../shared/utils/decimal.js';
import { totalMealUnits } from '../meal/meal.service.js';
import { ensurePeriod } from '../period/period.service.js';

const currentPeriodOf = async (messId: string, timezone: string) => {
  const { year, month } = yearMonthOf(zonedToday(timezone));
  return ensurePeriod(prisma, messId, year, month);
};

/**
 * Live meal rate for an open month. Explicitly provisional: the denominator
 * keeps growing until the month closes, so it must never be shown as final.
 */
const runningMealRate = async (periodId: string) => {
  const [foodTotal, meals] = await Promise.all([
    prisma.expense.aggregate({
      where: { periodId, voidedAt: null, allocationType: AllocationType.MEAL_BASED },
      _sum: { amount: true },
    }),
    prisma.mealEntry.findMany({
      where: { periodId },
      select: {
        breakfast: true,
        lunch: true,
        dinner: true,
        guestBreakfast: true,
        guestLunch: true,
        guestDinner: true,
      },
    }),
  ]);

  const totalFood = toMoney(foodTotal._sum.amount ?? 0);
  const units = sum(meals.map((meal) => totalMealUnits(meal)));
  const rate = units.isZero() ? D(0) : toRate(totalFood.dividedBy(units));

  return { totalFood, units, rate };
};

const netDepositsOf = async (where: { periodId: string; membershipId?: string }) => {
  const rows = await prisma.deposit.groupBy({
    by: ['type'],
    where: { ...where, voidedAt: null },
    _sum: { amount: true },
  });

  const totalOf = (type: DepositType) =>
    toMoney(rows.find((row) => row.type === type)?._sum.amount ?? 0);

  return totalOf(DepositType.DEPOSIT)
    .plus(totalOf(DepositType.OPENING_BALANCE))
    .plus(totalOf(DepositType.ADJUSTMENT))
    .minus(totalOf(DepositType.REFUND));
};

/** Blueprint 7.4 first row: today's meal, monthly meal, meal rate, balance. */
const memberDashboard = async (messId: string, membershipId: string, timezone: string) => {
  const period = await currentPeriodOf(messId, timezone);
  const today = zonedToday(timezone);

  const [todayMeal, monthMeals, myShares, myDeposits, rate, lastStatement] = await Promise.all([
    prisma.mealEntry.findUnique({
      where: { membershipId_date: { membershipId, date: today } },
      select: {
        breakfast: true,
        lunch: true,
        dinner: true,
        guestBreakfast: true,
        guestLunch: true,
        guestDinner: true,
      },
    }),
    prisma.mealEntry.findMany({
      where: { membershipId, periodId: period.id },
      select: {
        breakfast: true,
        lunch: true,
        dinner: true,
        guestBreakfast: true,
        guestLunch: true,
        guestDinner: true,
      },
    }),
    prisma.expenseShare.findMany({
      where: { membershipId, expense: { periodId: period.id, voidedAt: null } },
      select: { amount: true },
    }),
    netDepositsOf({ periodId: period.id, membershipId }),
    runningMealRate(period.id),
    prisma.monthlyStatement.findFirst({
      where: { membershipId, period: { status: PeriodStatus.CLOSED } },
      select: { closingBalance: true, period: { select: { year: true, month: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const myUnits = sum(monthMeals.map((meal) => totalMealUnits(meal)));
  const myFixed = sum(myShares.map((share) => D(share.amount)));
  const estimatedMealCost = toMoney(myUnits.times(rate.rate));
  const openingBalance = toMoney(lastStatement?.closingBalance ?? 0);
  const estimatedGross = estimatedMealCost.plus(myFixed);

  return {
    periodId: period.id,
    todayMealUnits: todayMeal ? totalMealUnits(todayMeal).toFixed(2) : '0.00',
    monthlyMealUnits: myUnits.toFixed(2),
    /** Provisional until the month is closed. */
    currentMealRate: rate.rate.toFixed(4),
    estimatedMealCost: estimatedMealCost.toFixed(2),
    allocatedFixedCost: myFixed.toFixed(2),
    estimatedGrossCost: estimatedGross.toFixed(2),
    openingBalance: openingBalance.toFixed(2),
    depositTotal: myDeposits.toFixed(2),
    estimatedBalance: openingBalance.plus(myDeposits).minus(estimatedGross).toFixed(2),
    lastClosedMonth: lastStatement
      ? `${lastStatement.period.year}-${String(lastStatement.period.month).padStart(2, '0')}`
      : null,
    isProvisional: true,
  };
};

const managerDashboard = async (messId: string, timezone: string) => {
  const period = await currentPeriodOf(messId, timezone);
  const today = zonedToday(timezone);

  const [activeMembers, rate, expenseTotal, deposits, todayMeals, openPeriods] = await Promise.all([
    prisma.membership.count({ where: { messId, status: MembershipStatus.ACTIVE } }),
    runningMealRate(period.id),
    prisma.expense.aggregate({
      where: { periodId: period.id, voidedAt: null },
      _sum: { amount: true },
    }),
    netDepositsOf({ periodId: period.id }),
    prisma.mealEntry.count({ where: { messId, date: today } }),
    prisma.messPeriod.findMany({
      where: { messId, status: { in: [PeriodStatus.OPEN, PeriodStatus.REOPENED] } },
      select: { id: true, year: true, month: true, status: true },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    }),
  ]);

  const totalExpense = toMoney(expenseTotal._sum.amount ?? 0);

  return {
    periodId: period.id,
    activeMembers,
    membersWithMealToday: todayMeals,
    totalMealUnits: rate.units.toFixed(2),
    totalFoodExpense: rate.totalFood.toFixed(2),
    totalExpense: totalExpense.toFixed(2),
    fixedExpense: totalExpense.minus(rate.totalFood).toFixed(2),
    currentMealRate: rate.rate.toFixed(4),
    totalDeposits: deposits.toFixed(2),
    /** Positive means the mess is holding more than it has spent so far. */
    cashPosition: deposits.minus(totalExpense).toFixed(2),
    openPeriods,
    isProvisional: true,
  };
};

/** Blueprint 2.1: the cook screen carries head counts and no money at all. */
const cookDashboard = async (messId: string, timezone: string, dateInput?: string) => {
  const date = dateInput ? new Date(`${dateInput}T00:00:00.000Z`) : zonedToday(timezone);

  const meals = await prisma.mealEntry.findMany({
    where: { messId, date },
    select: {
      breakfast: true,
      lunch: true,
      dinner: true,
      guestBreakfast: true,
      guestLunch: true,
      guestDinner: true,
      membership: { select: { roomLabel: true, user: { select: { name: true } } } },
    },
  });

  const totalOf = (key: 'breakfast' | 'lunch' | 'dinner', guestKey: 'guestBreakfast' | 'guestLunch' | 'guestDinner') =>
    sum(meals.map((meal) => D(meal[key] as never).plus(D(meal[guestKey] as never))));

  return {
    date: formatDateOnly(date),
    breakfast: totalOf('breakfast', 'guestBreakfast').toFixed(2),
    lunch: totalOf('lunch', 'guestLunch').toFixed(2),
    dinner: totalOf('dinner', 'guestDinner').toFixed(2),
    members: meals
      .map((meal) => ({
        name: meal.membership.user.name,
        roomLabel: meal.membership.roomLabel,
        breakfast: D(meal.breakfast as never).toFixed(2),
        lunch: D(meal.lunch as never).toFixed(2),
        dinner: D(meal.dinner as never).toFixed(2),
        totalMealUnits: totalMealUnits(meal).toFixed(2),
      }))
      .filter((row) => D(row.totalMealUnits).greaterThan(0))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
};

export const dashboardService = { memberDashboard, managerDashboard, cookDashboard };
