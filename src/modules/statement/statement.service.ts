import {
  AllocationType,
  DepositType,
  MembershipStatus,
  PeriodStatus,
} from '../../../generated/prisma/enums.js';
import type { Db } from '../../config/prisma.js';
import { prisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../../shared/constants/audit.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/AppError.js';
import { writeAudit, type AuditContext } from '../../shared/utils/audit.js';
import { D, sum, toMoney } from '../../shared/utils/decimal.js';
import { totalMealUnits } from '../meal/meal.service.js';
import {
  calculatePeriod,
  CalculationError,
  reconcile,
  type CalculationResult,
  type MemberInput,
} from './calculation.js';

export type PeriodIssue = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
};

type PeriodRow = {
  id: string;
  messId: string;
  year: number;
  month: number;
  status: PeriodStatus;
  calculationVersion: number;
};

const loadPeriod = async (db: Db, messId: string, periodId: string): Promise<PeriodRow> => {
  const period = await db.messPeriod.findFirst({
    where: { id: periodId, messId },
    select: {
      id: true,
      messId: true,
      year: true,
      month: true,
      status: true,
      calculationVersion: true,
    },
  });
  if (!period) throw new NotFoundError('Period not found in this mess');
  return period;
};

/**
 * Carries the previous month's closing balance forward. Without this, a member
 * who overpaid in July would silently lose the credit in August.
 */
const loadOpeningBalances = async (
  db: Db,
  messId: string,
  year: number,
  month: number,
): Promise<Map<string, string>> => {
  const previous = await db.messPeriod.findFirst({
    where: {
      messId,
      status: PeriodStatus.CLOSED,
      OR: [{ year: { lt: year } }, { year, month: { lt: month } }],
    },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    select: { id: true, calculationVersion: true },
  });

  if (!previous) return new Map();

  const statements = await db.monthlyStatement.findMany({
    where: { periodId: previous.id, calculationVersion: previous.calculationVersion },
    select: { membershipId: true, closingBalance: true },
  });

  return new Map(statements.map((row) => [row.membershipId, row.closingBalance.toFixed(2)]));
};

/**
 * Gathers everything the pure engine needs. Kept separate from `calculatePeriod`
 * so the maths can be tested without a database (blueprint Phase 5, step 30).
 */
const buildCalculationInput = async (db: Db, period: PeriodRow) => {
  const [members, meals, expenses, deposits, openingBalances] = await Promise.all([
    db.membership.findMany({
      where: {
        messId: period.messId,
        status: { in: [MembershipStatus.ACTIVE, MembershipStatus.INACTIVE] },
      },
      select: { id: true, status: true, user: { select: { name: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
    db.mealEntry.findMany({
      where: { periodId: period.id },
      select: {
        membershipId: true,
        breakfast: true,
        lunch: true,
        dinner: true,
        guestBreakfast: true,
        guestLunch: true,
        guestDinner: true,
      },
    }),
    db.expense.findMany({
      where: { periodId: period.id, voidedAt: null },
      select: {
        id: true,
        title: true,
        amount: true,
        allocationType: true,
        shares: { select: { membershipId: true, amount: true } },
      },
    }),
    db.deposit.findMany({
      where: { periodId: period.id, voidedAt: null },
      select: { membershipId: true, type: true, amount: true },
    }),
    loadOpeningBalances(db, period.messId, period.year, period.month),
  ]);

  const mealUnitsByMember = new Map<string, ReturnType<typeof D>>();
  for (const meal of meals) {
    mealUnitsByMember.set(
      meal.membershipId,
      (mealUnitsByMember.get(meal.membershipId) ?? D(0)).plus(totalMealUnits(meal)),
    );
  }

  const fixedByMember = new Map<string, string[]>();
  const personalByMember = new Map<string, string[]>();
  let totalFoodExpense = D(0);
  const unallocated: { id: string; title: string; amount: string }[] = [];

  for (const expense of expenses) {
    if (expense.allocationType === AllocationType.MEAL_BASED) {
      totalFoodExpense = totalFoodExpense.plus(D(expense.amount));
      continue;
    }

    if (expense.shares.length === 0) {
      unallocated.push({
        id: expense.id,
        title: expense.title,
        amount: toMoney(expense.amount).toFixed(2),
      });
      continue;
    }

    const bucket =
      expense.allocationType === AllocationType.MEMBER_SPECIFIC
        ? personalByMember
        : fixedByMember;

    for (const share of expense.shares) {
      const list = bucket.get(share.membershipId) ?? [];
      list.push(toMoney(share.amount).toFixed(2));
      bucket.set(share.membershipId, list);
    }
  }

  const depositsByMember = new Map<string, ReturnType<typeof D>>();
  for (const deposit of deposits) {
    const signed =
      deposit.type === DepositType.REFUND ? D(deposit.amount).negated() : D(deposit.amount);
    depositsByMember.set(
      deposit.membershipId,
      (depositsByMember.get(deposit.membershipId) ?? D(0)).plus(signed),
    );
  }

  const memberInputs: MemberInput[] = members.map((member) => ({
    membershipId: member.id,
    name: member.user.name,
    mealUnits: mealUnitsByMember.get(member.id) ?? D(0),
    fixedShares: fixedByMember.get(member.id) ?? [],
    personalShares: personalByMember.get(member.id) ?? [],
    openingBalance: openingBalances.get(member.id) ?? '0.00',
    deposits: depositsByMember.get(member.id) ?? D(0),
  }));

  const totalAllocatedExpense = totalFoodExpense
    .plus(sum([...fixedByMember.values()].flat()))
    .plus(sum([...personalByMember.values()].flat()));

  // Shares belonging to members outside the statement set would break
  // reconciliation; surface them rather than absorbing the difference.
  const knownIds = new Set(members.map((member) => member.id));
  const orphanShares = [...fixedByMember.keys(), ...personalByMember.keys()].filter(
    (id) => !knownIds.has(id),
  );

  return {
    memberInputs,
    totalFoodExpense,
    totalAllocatedExpense,
    unallocated,
    orphanShares,
    memberCount: members.length,
  };
};

type Prepared = Awaited<ReturnType<typeof buildCalculationInput>>;

/** Blueprint 4.5 step 6: everything that would make a close wrong, listed up front. */
const collectIssues = (prepared: Prepared, result: CalculationResult | null): PeriodIssue[] => {
  const issues: PeriodIssue[] = [];

  if (prepared.memberCount === 0) {
    issues.push({
      severity: 'error',
      code: 'NO_MEMBERS',
      message: 'This mess has no active members to generate statements for.',
    });
  }

  for (const expense of prepared.unallocated) {
    issues.push({
      severity: 'error',
      code: 'UNALLOCATED_EXPENSE',
      message: `Expense "${expense.title}" (${expense.amount}) has no allocation shares.`,
    });
  }

  if (prepared.orphanShares.length > 0) {
    issues.push({
      severity: 'error',
      code: 'ORPHAN_SHARES',
      message: `${prepared.orphanShares.length} expense share(s) belong to removed members. Reassign them before closing.`,
    });
  }

  if (!result) return issues;

  if (result.totalMealUnits.isZero() && result.totalFoodExpense.greaterThan(0)) {
    issues.push({
      severity: 'error',
      code: 'ZERO_MEAL_WITH_FOOD_EXPENSE',
      message: 'Food expenses exist but no meals were recorded this month.',
    });
  }

  const check = reconcile(result, prepared.totalAllocatedExpense);
  if (!check.balanced) {
    issues.push({
      severity: 'error',
      code: 'RECONCILIATION_MISMATCH',
      message: `Member charges differ from total expenses by ${check.difference.toFixed(2)}.`,
    });
  }

  for (const statement of result.statements) {
    if (statement.closingBalance.isNegative()) {
      issues.push({
        severity: 'warning',
        code: 'MEMBER_DUE',
        message: `${statement.name} owes ${statement.closingBalance.abs().toFixed(2)}.`,
      });
    }
  }

  if (result.totalMealUnits.isZero()) {
    issues.push({
      severity: 'warning',
      code: 'NO_MEALS',
      message: 'No meals were recorded this month; the meal rate will be 0.',
    });
  }

  return issues;
};

const serializeResult = (result: CalculationResult) => ({
  totalMealUnits: result.totalMealUnits.toFixed(2),
  totalFoodExpense: result.totalFoodExpense.toFixed(2),
  mealRate: result.mealRate.toFixed(4),
  totalFixedCost: result.totalFixedCost.toFixed(2),
  totalPersonalCost: result.totalPersonalCost.toFixed(2),
  totalGrossCost: result.totalGrossCost.toFixed(2),
  totalDeposits: result.totalDeposits.toFixed(2),
  members: result.statements.map((statement) => ({
    membershipId: statement.membershipId,
    name: statement.name,
    mealUnits: statement.mealUnits.toFixed(2),
    mealCost: statement.mealCost.toFixed(2),
    allocatedFixedCost: statement.allocatedFixedCost.toFixed(2),
    personalCost: statement.personalCost.toFixed(2),
    grossCost: statement.grossCost.toFixed(2),
    openingBalance: statement.openingBalance.toFixed(2),
    depositTotal: statement.depositTotal.toFixed(2),
    closingBalance: statement.closingBalance.toFixed(2),
  })),
});

const computeFor = async (db: Db, period: PeriodRow) => {
  const prepared = await buildCalculationInput(db, period);

  let result: CalculationResult | null = null;
  let calculationError: string | null = null;

  try {
    result = calculatePeriod({
      totalFoodExpense: prepared.totalFoodExpense,
      members: prepared.memberInputs,
    });
  } catch (error) {
    if (!(error instanceof CalculationError)) throw error;
    calculationError = error.message;
  }

  const issues = collectIssues(prepared, result);
  if (calculationError) {
    issues.unshift({ severity: 'error', code: 'CALCULATION_FAILED', message: calculationError });
  }

  return { prepared, result, issues };
};

/** Read-only dry run — same numbers the close will write, without writing them. */
const preview = async (messId: string, periodId: string) => {
  const period = await loadPeriod(prisma, messId, periodId);
  const { result, issues } = await computeFor(prisma, period);

  return {
    period,
    canClose: issues.every((issue) => issue.severity !== 'error'),
    issues,
    summary: result ? serializeResult(result) : null,
  };
};

/**
 * Blueprint 4.5: validate, lock, aggregate, write statements, mark CLOSED — one
 * Serializable transaction. Two simultaneous close requests cannot both commit,
 * so a duplicate submit can never produce a second set of statements.
 */
const closePeriod = async (messId: string, periodId: string, actorId: string, context: AuditContext) =>
  prisma.$transaction(
    async (tx) => {
      const period = await loadPeriod(tx, messId, periodId);

      if (period.status === PeriodStatus.CLOSED) {
        throw new ConflictError('This month is already closed');
      }
      if (period.status === PeriodStatus.CALCULATING) {
        throw new ConflictError('A close is already in progress for this month');
      }

      const { result, issues } = await computeFor(tx, period);
      const blockers = issues.filter((issue) => issue.severity === 'error');

      if (blockers.length > 0 || !result) {
        throw new ValidationError(
          'This month cannot be closed yet',
          blockers.map((issue) => ({ path: issue.code, message: issue.message })),
        );
      }

      // A reopened month closes again at a higher version; old statements stay
      // in place as superseded history rather than being overwritten.
      const version = period.calculationVersion;

      await tx.monthlyStatement.deleteMany({
        where: { periodId: period.id, calculationVersion: version },
      });

      await tx.monthlyStatement.createMany({
        data: result.statements.map((statement) => ({
          periodId: period.id,
          membershipId: statement.membershipId,
          calculationVersion: version,
          totalMealUnits: statement.mealUnits.toFixed(2),
          mealRate: result.mealRate.toFixed(4),
          mealCost: statement.mealCost.toFixed(2),
          allocatedFixedCost: statement.allocatedFixedCost.toFixed(2),
          personalCost: statement.personalCost.toFixed(2),
          openingBalance: statement.openingBalance.toFixed(2),
          depositTotal: statement.depositTotal.toFixed(2),
          grossCost: statement.grossCost.toFixed(2),
          closingBalance: statement.closingBalance.toFixed(2),
          breakdown: {
            periodTotalMealUnits: result.totalMealUnits.toFixed(2),
            periodTotalFoodExpense: result.totalFoodExpense.toFixed(2),
            mealRate: result.mealRate.toFixed(4),
            formula: 'mealCost = mealUnits x mealRate; balance = opening + deposits - gross',
          },
        })),
      });

      const closed = await tx.messPeriod.update({
        where: { id: period.id },
        data: { status: PeriodStatus.CLOSED, closedAt: new Date(), closedById: actorId },
        select: {
          id: true,
          year: true,
          month: true,
          status: true,
          calculationVersion: true,
          closedAt: true,
        },
      });

      await writeAudit(tx, context, {
        action: AUDIT_ACTIONS.PERIOD_CLOSE,
        entityType: AUDIT_ENTITIES.MESS_PERIOD,
        entityId: period.id,
        after: {
          calculationVersion: version,
          mealRate: result.mealRate.toFixed(4),
          totalGrossCost: result.totalGrossCost.toFixed(2),
          statementCount: result.statements.length,
        },
      });

      return { period: closed, summary: serializeResult(result), warnings: issues };
    },
    { isolationLevel: 'Serializable', timeout: 30_000 },
  );

/**
 * Blueprint 4.6: reopening bumps the calculation version, so the next close
 * writes a new statement set and the superseded one remains auditable.
 */
const reopenPeriod = async (
  messId: string,
  periodId: string,
  reason: string,
  context: AuditContext,
) =>
  prisma.$transaction(async (tx) => {
    const period = await loadPeriod(tx, messId, periodId);

    if (period.status !== PeriodStatus.CLOSED) {
      throw new ConflictError('Only a closed month can be reopened');
    }

    const newer = await tx.messPeriod.findFirst({
      where: {
        messId,
        status: PeriodStatus.CLOSED,
        OR: [{ year: { gt: period.year } }, { year: period.year, month: { gt: period.month } }],
      },
      select: { year: true, month: true },
    });

    // Reopening an older month would invalidate every opening balance after it.
    if (newer) {
      throw new ConflictError(
        `Close order must be preserved: reopen ${newer.year}-${String(newer.month).padStart(2, '0')} first`,
      );
    }

    const reopened = await tx.messPeriod.update({
      where: { id: period.id },
      data: {
        status: PeriodStatus.REOPENED,
        calculationVersion: { increment: 1 },
        reopenReason: reason,
        closedAt: null,
        closedById: null,
      },
      select: { id: true, year: true, month: true, status: true, calculationVersion: true },
    });

    await writeAudit(tx, context, {
      action: AUDIT_ACTIONS.PERIOD_REOPEN,
      entityType: AUDIT_ENTITIES.MESS_PERIOD,
      entityId: period.id,
      reason,
      before: { status: period.status, calculationVersion: period.calculationVersion },
      after: { status: reopened.status, calculationVersion: reopened.calculationVersion },
    });

    return reopened;
  });

const statementSelect = {
  id: true,
  calculationVersion: true,
  totalMealUnits: true,
  mealRate: true,
  mealCost: true,
  allocatedFixedCost: true,
  personalCost: true,
  openingBalance: true,
  depositTotal: true,
  grossCost: true,
  closingBalance: true,
  breakdown: true,
  createdAt: true,
  membership: {
    select: { id: true, roomLabel: true, user: { select: { id: true, name: true, email: true } } },
  },
} as const;

const listStatements = async (messId: string, periodId: string) => {
  const period = await loadPeriod(prisma, messId, periodId);

  const statements = await prisma.monthlyStatement.findMany({
    where: { periodId, calculationVersion: period.calculationVersion },
    select: statementSelect,
    orderBy: { membership: { user: { name: 'asc' } } },
  });

  return { period, statements };
};

const myStatement = async (messId: string, periodId: string, membershipId: string) => {
  const period = await loadPeriod(prisma, messId, periodId);

  const statement = await prisma.monthlyStatement.findFirst({
    where: { periodId, membershipId, calculationVersion: period.calculationVersion },
    select: statementSelect,
  });

  if (!statement) {
    throw new NotFoundError('No statement exists for you in this month yet');
  }

  return { period, statement };
};

/** Every version ever produced for a member — the reopen audit trail. */
const statementHistory = async (messId: string, membershipId: string) => {
  const member = await prisma.membership.findFirst({
    where: { id: membershipId, messId },
    select: { id: true },
  });
  if (!member) throw new NotFoundError('Member not found in this mess');

  return prisma.monthlyStatement.findMany({
    where: { membershipId },
    select: {
      ...statementSelect,
      period: { select: { id: true, year: true, month: true, status: true } },
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 50,
  });
};

export const statementService = {
  preview,
  closePeriod,
  reopenPeriod,
  listStatements,
  myStatement,
  statementHistory,
};
