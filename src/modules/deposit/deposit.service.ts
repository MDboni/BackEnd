import { DepositType, MembershipStatus, PeriodStatus } from '../../../generated/prisma/enums.js';
import { prisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../../shared/constants/audit.js';
import { ConflictError, NotFoundError } from '../../shared/errors/AppError.js';
import { writeAudit, type AuditContext } from '../../shared/utils/audit.js';
import { formatDateOnly, toDateOnly } from '../../shared/utils/date.js';
import { toMoney } from '../../shared/utils/decimal.js';
import { buildMeta, buildPagination } from '../../shared/utils/pagination.js';
import { isPeriodOpen, periodForDate } from '../period/period.service.js';
import type {
  CreateDepositInput,
  ListDepositsQuery,
  UpdateDepositInput,
} from './deposit.validation.js';

const depositSelect = {
  id: true,
  type: true,
  amount: true,
  transactionDate: true,
  reference: true,
  note: true,
  voidedAt: true,
  periodId: true,
  createdById: true,
  createdAt: true,
  membership: {
    select: { id: true, roomLabel: true, user: { select: { id: true, name: true } } },
  },
} as const;

const assertPeriodWritable = (status: PeriodStatus): void => {
  if (!isPeriodOpen(status)) {
    throw new ConflictError('This month is closed. Reopen it before changing deposits.');
  }
};

const create = async (
  messId: string,
  createdById: string,
  input: CreateDepositInput,
  context: AuditContext,
) => {
  const transactionDate = toDateOnly(input.transactionDate);

  const membership = await prisma.membership.findFirst({
    where: { id: input.membershipId, messId, status: { not: MembershipStatus.REMOVED } },
    select: { id: true },
  });
  if (!membership) throw new NotFoundError('Member not found in this mess');

  const period = await periodForDate(prisma, messId, transactionDate);
  assertPeriodWritable(period.status);

  const deposit = await prisma.deposit.create({
    data: {
      messId,
      periodId: period.id,
      membershipId: input.membershipId,
      type: input.type,
      amount: input.amount,
      transactionDate,
      reference: input.reference ?? null,
      note: input.note ?? null,
      createdById,
    },
    select: depositSelect,
  });

  await writeAudit(prisma, context, {
    action: AUDIT_ACTIONS.DEPOSIT_CREATE,
    entityType: AUDIT_ENTITIES.DEPOSIT,
    entityId: deposit.id,
    after: deposit,
  });

  return deposit;
};

const update = async (
  messId: string,
  depositId: string,
  input: UpdateDepositInput,
  context: AuditContext,
) => {
  const before = await prisma.deposit.findFirst({
    where: { id: depositId, messId },
    select: { ...depositSelect, period: { select: { status: true } } },
  });
  if (!before) throw new NotFoundError('Deposit not found in this mess');
  if (before.voidedAt) throw new ConflictError('A voided deposit cannot be edited');
  assertPeriodWritable(before.period.status);

  const transactionDate = input.transactionDate
    ? toDateOnly(input.transactionDate)
    : before.transactionDate;

  const period = await periodForDate(prisma, messId, transactionDate);
  assertPeriodWritable(period.status);

  const updated = await prisma.deposit.update({
    where: { id: depositId },
    data: {
      periodId: period.id,
      amount: input.amount ?? before.amount,
      transactionDate,
      reference: input.reference ?? before.reference,
      note: input.note ?? before.note,
    },
    select: depositSelect,
  });

  await writeAudit(prisma, context, {
    action: AUDIT_ACTIONS.DEPOSIT_UPDATE,
    entityType: AUDIT_ENTITIES.DEPOSIT,
    entityId: depositId,
    before,
    after: updated,
  });

  return updated;
};

const voidDeposit = async (
  messId: string,
  depositId: string,
  reason: string,
  context: AuditContext,
) => {
  const before = await prisma.deposit.findFirst({
    where: { id: depositId, messId },
    select: { ...depositSelect, period: { select: { status: true } } },
  });
  if (!before) throw new NotFoundError('Deposit not found in this mess');
  if (before.voidedAt) throw new ConflictError('Deposit is already voided');
  assertPeriodWritable(before.period.status);

  const voided = await prisma.deposit.update({
    where: { id: depositId },
    data: { voidedAt: new Date() },
    select: depositSelect,
  });

  await writeAudit(prisma, context, {
    action: AUDIT_ACTIONS.DEPOSIT_VOID,
    entityType: AUDIT_ENTITIES.DEPOSIT,
    entityId: depositId,
    reason,
    before,
    after: voided,
  });

  return voided;
};

const list = async (messId: string, query: ListDepositsQuery) => {
  const pagination = buildPagination(
    query,
    ['transactionDate', 'amount', 'createdAt'],
    'transactionDate',
  );

  const where = {
    messId,
    ...(query.includeVoided ? {} : { voidedAt: null }),
    ...(query.periodId ? { periodId: query.periodId } : {}),
    ...(query.membershipId ? { membershipId: query.membershipId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          transactionDate: {
            ...(query.dateFrom ? { gte: toDateOnly(query.dateFrom) } : {}),
            ...(query.dateTo ? { lte: toDateOnly(query.dateTo) } : {}),
          },
        }
      : {}),
  };

  const [deposits, total, totals] = await Promise.all([
    prisma.deposit.findMany({
      where,
      select: depositSelect,
      orderBy: pagination.orderBy,
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.deposit.count({ where }),
    prisma.deposit.aggregate({ where, _sum: { amount: true } }),
  ]);

  return {
    deposits: deposits.map((deposit) => ({
      ...deposit,
      transactionDate: formatDateOnly(deposit.transactionDate),
    })),
    totalAmount: toMoney(totals._sum.amount ?? 0).toFixed(2),
    meta: buildMeta(pagination, total),
  };
};

const getById = async (messId: string, depositId: string) => {
  const deposit = await prisma.deposit.findFirst({
    where: { id: depositId, messId },
    select: depositSelect,
  });
  if (!deposit) throw new NotFoundError('Deposit not found in this mess');
  return { ...deposit, transactionDate: formatDateOnly(deposit.transactionDate) };
};

/**
 * REFUND reduces what the member has put in, so it is subtracted. Everything
 * else adds — this sign convention is the one the calculation engine uses too.
 */
const myDeposits = async (membershipId: string, periodId: string | undefined) => {
  const where = {
    membershipId,
    voidedAt: null,
    ...(periodId ? { periodId } : {}),
  };

  const [deposits, byType] = await Promise.all([
    prisma.deposit.findMany({
      where,
      select: depositSelect,
      orderBy: { transactionDate: 'desc' },
    }),
    prisma.deposit.groupBy({ by: ['type'], where, _sum: { amount: true } }),
  ]);

  const totalOf = (type: DepositType) =>
    toMoney(byType.find((row) => row.type === type)?._sum.amount ?? 0);

  const net = totalOf(DepositType.DEPOSIT)
    .plus(totalOf(DepositType.OPENING_BALANCE))
    .plus(totalOf(DepositType.ADJUSTMENT))
    .minus(totalOf(DepositType.REFUND));

  return {
    netDeposited: net.toFixed(2),
    byType: byType.map((row) => ({
      type: row.type,
      amount: toMoney(row._sum.amount ?? 0).toFixed(2),
    })),
    deposits: deposits.map((deposit) => ({
      ...deposit,
      transactionDate: formatDateOnly(deposit.transactionDate),
    })),
  };
};

export const depositService = { create, update, voidDeposit, list, getById, myDeposits };
