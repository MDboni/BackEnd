import {
  AllocationType,
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
import { formatDateOnly, toDateOnly } from '../../shared/utils/date.js';
import { D, splitEvenly, sum, toMoney } from '../../shared/utils/decimal.js';
import { buildMeta, buildPagination } from '../../shared/utils/pagination.js';
import { isPeriodOpen, periodForDate } from '../period/period.service.js';
import type {
  CreateExpenseInput,
  ListExpensesQuery,
  UpdateExpenseInput,
} from './expense.validation.js';

const expenseSelect = {
  id: true,
  title: true,
  description: true,
  category: true,
  allocationType: true,
  amount: true,
  expenseDate: true,
  paidByMemberId: true,
  receiptUrl: true,
  voidedAt: true,
  periodId: true,
  createdById: true,
  updatedById: true,
  createdAt: true,
  updatedAt: true,
  shares: {
    select: {
      id: true,
      amount: true,
      membership: {
        select: { id: true, roomLabel: true, user: { select: { id: true, name: true } } },
      },
    },
  },
} as const;

type ShareInput = { membershipId: string; amount: string };

/**
 * Turns an allocation rule into concrete per-member rows.
 *
 * MEAL_BASED produces none: those are divided by meal units at month close,
 * when the total meal count for the period is finally known.
 */
const buildShares = async (
  db: Db,
  messId: string,
  allocationType: AllocationType,
  amount: string,
  shares: ShareInput[] | undefined,
  excludeMembershipIds: string[] | undefined,
): Promise<{ membershipId: string; amount: string }[]> => {
  if (allocationType === AllocationType.MEAL_BASED) return [];

  if (allocationType === AllocationType.EQUAL) {
    const excluded = new Set(excludeMembershipIds ?? []);
    const eligible = await db.membership.findMany({
      where: { messId, status: MembershipStatus.ACTIVE },
      select: { id: true },
      orderBy: { joinedAt: 'asc' },
    });

    const targets = eligible.filter((member) => !excluded.has(member.id));
    if (targets.length === 0) {
      throw new ValidationError('No eligible active members to split this expense between');
    }

    // splitEvenly guarantees the parts add back up to the exact amount.
    const parts = splitEvenly(amount, targets.length);
    return targets.map((member, index) => ({
      membershipId: member.id,
      amount: (parts[index] ?? D(0)).toFixed(2),
    }));
  }

  // CUSTOM and MEMBER_SPECIFIC: the caller supplied the split, so verify it.
  const provided = shares ?? [];
  const membershipIds = provided.map((share) => share.membershipId);

  const valid = await db.membership.findMany({
    where: { id: { in: membershipIds }, messId, status: { not: MembershipStatus.REMOVED } },
    select: { id: true },
  });

  if (valid.length !== membershipIds.length) {
    throw new ValidationError('One or more members in the shares list do not belong to this mess');
  }

  const total = sum(provided.map((share) => D(share.amount)));
  if (!total.equals(toMoney(amount))) {
    throw new ValidationError(
      `Shares total ${total.toFixed(2)} does not match the expense amount ${toMoney(amount).toFixed(2)}`,
    );
  }

  return provided.map((share) => ({
    membershipId: share.membershipId,
    amount: toMoney(share.amount).toFixed(2),
  }));
};

const assertPeriodWritable = (status: PeriodStatus): void => {
  if (!isPeriodOpen(status)) {
    throw new ConflictError('This month is closed. Reopen it before changing expenses.');
  }
};

const create = async (
  messId: string,
  createdById: string,
  input: CreateExpenseInput,
  context: AuditContext,
) => {
  const expenseDate = toDateOnly(input.expenseDate);

  return prisma.$transaction(async (tx) => {
    const period = await periodForDate(tx, messId, expenseDate);
    assertPeriodWritable(period.status);

    const shares = await buildShares(
      tx,
      messId,
      input.allocationType,
      input.amount,
      input.shares,
      input.excludeMembershipIds,
    );

    const expense = await tx.expense.create({
      data: {
        messId,
        periodId: period.id,
        title: input.title,
        description: input.description ?? null,
        category: input.category,
        allocationType: input.allocationType,
        amount: input.amount,
        expenseDate,
        paidByMemberId: input.paidByMemberId ?? null,
        receiptUrl: input.receiptUrl ?? null,
        createdById,
        shares: { create: shares },
      },
      select: expenseSelect,
    });

    await writeAudit(tx, context, {
      action: AUDIT_ACTIONS.EXPENSE_CREATE,
      entityType: AUDIT_ENTITIES.EXPENSE,
      entityId: expense.id,
      after: expense,
    });

    return expense;
  });
};

const update = async (
  messId: string,
  expenseId: string,
  updatedById: string,
  input: UpdateExpenseInput,
  context: AuditContext,
) =>
  prisma.$transaction(async (tx) => {
    const before = await tx.expense.findFirst({
      where: { id: expenseId, messId },
      select: { ...expenseSelect, period: { select: { status: true } } },
    });
    if (!before) throw new NotFoundError('Expense not found in this mess');
    if (before.voidedAt) throw new ConflictError('A voided expense cannot be edited');
    assertPeriodWritable(before.period.status);

    const expenseDate = input.expenseDate ? toDateOnly(input.expenseDate) : before.expenseDate;
    const category = input.category ?? before.category;
    const allocationType = input.allocationType ?? before.allocationType;
    const amount = input.amount ?? before.amount.toFixed(2);

    // Moving an expense across months must move it to the right period too.
    const period = await periodForDate(tx, messId, expenseDate);
    assertPeriodWritable(period.status);

    const sharesChanged =
      input.amount !== undefined ||
      input.allocationType !== undefined ||
      input.shares !== undefined ||
      input.excludeMembershipIds !== undefined;

    if (sharesChanged) {
      const shares = await buildShares(
        tx,
        messId,
        allocationType,
        amount,
        input.shares,
        input.excludeMembershipIds,
      );
      await tx.expenseShare.deleteMany({ where: { expenseId } });
      if (shares.length > 0) {
        await tx.expenseShare.createMany({
          data: shares.map((share) => ({ ...share, expenseId })),
        });
      }
    }

    const updated = await tx.expense.update({
      where: { id: expenseId },
      data: {
        periodId: period.id,
        title: input.title ?? before.title,
        description: input.description ?? before.description,
        category,
        allocationType,
        amount,
        expenseDate,
        paidByMemberId: input.paidByMemberId ?? before.paidByMemberId,
        receiptUrl: input.receiptUrl ?? before.receiptUrl,
        updatedById,
      },
      select: expenseSelect,
    });

    await writeAudit(tx, context, {
      action: AUDIT_ACTIONS.EXPENSE_UPDATE,
      entityType: AUDIT_ENTITIES.EXPENSE,
      entityId: expenseId,
      before,
      after: updated,
    });

    return updated;
  });

/** Blueprint 3.3: financial rows are voided, never deleted. */
const voidExpense = async (
  messId: string,
  expenseId: string,
  reason: string,
  context: AuditContext,
) => {
  const before = await prisma.expense.findFirst({
    where: { id: expenseId, messId },
    select: { ...expenseSelect, period: { select: { status: true } } },
  });
  if (!before) throw new NotFoundError('Expense not found in this mess');
  if (before.voidedAt) throw new ConflictError('Expense is already voided');
  assertPeriodWritable(before.period.status);

  const voided = await prisma.expense.update({
    where: { id: expenseId },
    data: { voidedAt: new Date() },
    select: expenseSelect,
  });

  await writeAudit(prisma, context, {
    action: AUDIT_ACTIONS.EXPENSE_VOID,
    entityType: AUDIT_ENTITIES.EXPENSE,
    entityId: expenseId,
    reason,
    before,
    after: voided,
  });

  return voided;
};

const list = async (messId: string, query: ListExpensesQuery) => {
  const pagination = buildPagination(
    query,
    ['expenseDate', 'amount', 'createdAt'],
    'expenseDate',
  );

  const where = {
    messId,
    ...(query.includeVoided ? {} : { voidedAt: null }),
    ...(query.periodId ? { periodId: query.periodId } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.allocationType ? { allocationType: query.allocationType } : {}),
    ...(query.search
      ? { title: { contains: query.search, mode: 'insensitive' as const } }
      : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          expenseDate: {
            ...(query.dateFrom ? { gte: toDateOnly(query.dateFrom) } : {}),
            ...(query.dateTo ? { lte: toDateOnly(query.dateTo) } : {}),
          },
        }
      : {}),
  };

  const [expenses, total, totals] = await Promise.all([
    prisma.expense.findMany({
      where,
      select: expenseSelect,
      orderBy: pagination.orderBy,
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
  ]);

  return {
    expenses: expenses.map((expense) => ({
      ...expense,
      expenseDate: formatDateOnly(expense.expenseDate),
    })),
    totalAmount: toMoney(totals._sum.amount ?? 0).toFixed(2),
    meta: buildMeta(pagination, total),
  };
};

const getById = async (messId: string, expenseId: string) => {
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, messId },
    select: expenseSelect,
  });
  if (!expense) throw new NotFoundError('Expense not found in this mess');
  return { ...expense, expenseDate: formatDateOnly(expense.expenseDate) };
};

/** Category and allocation breakdown for the expense page header. */
const summary = async (messId: string, periodId: string) => {
  const where = { messId, periodId, voidedAt: null };

  const [byCategory, byAllocation, total] = await Promise.all([
    prisma.expense.groupBy({
      by: ['category'],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.expense.groupBy({
      by: ['allocationType'],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
  ]);

  return {
    periodId,
    totalAmount: toMoney(total._sum.amount ?? 0).toFixed(2),
    byCategory: byCategory.map((row) => ({
      category: row.category,
      count: row._count._all,
      amount: toMoney(row._sum.amount ?? 0).toFixed(2),
    })),
    byAllocation: byAllocation.map((row) => ({
      allocationType: row.allocationType,
      count: row._count._all,
      amount: toMoney(row._sum.amount ?? 0).toFixed(2),
    })),
  };
};

/** A member sees only what was allocated to them. */
const myAllocations = async (membershipId: string, periodId: string) => {
  const shares = await prisma.expenseShare.findMany({
    where: { membershipId, expense: { periodId, voidedAt: null } },
    select: {
      amount: true,
      expense: {
        select: { id: true, title: true, category: true, allocationType: true, expenseDate: true },
      },
    },
    orderBy: { expense: { expenseDate: 'desc' } },
  });

  return {
    total: sum(shares.map((share) => D(share.amount))).toFixed(2),
    items: shares.map((share) => ({
      ...share.expense,
      expenseDate: formatDateOnly(share.expense.expenseDate),
      allocatedAmount: toMoney(share.amount).toFixed(2),
    })),
  };
};

export const expenseService = {
  create,
  update,
  voidExpense,
  list,
  getById,
  summary,
  myAllocations,
};
