import { PeriodStatus } from '../../../generated/prisma/enums.js';
import type { Db } from '../../config/prisma.js';
import { prisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../../shared/constants/audit.js';
import { ConflictError, NotFoundError } from '../../shared/errors/AppError.js';
import { writeAudit, type AuditContext } from '../../shared/utils/audit.js';
import { buildMeta, buildPagination } from '../../shared/utils/pagination.js';
import { yearMonthOf, zonedToday } from '../../shared/utils/date.js';
import type { CreatePeriodInput, ListPeriodsQuery } from './period.validation.js';

const periodSelect = {
  id: true,
  year: true,
  month: true,
  status: true,
  calculationVersion: true,
  openedAt: true,
  closedAt: true,
  closedById: true,
  reopenReason: true,
} as const;

export const OPEN_STATUSES = [PeriodStatus.OPEN, PeriodStatus.REOPENED] as const;

export const isPeriodOpen = (status: PeriodStatus): boolean =>
  status === PeriodStatus.OPEN || status === PeriodStatus.REOPENED;

const create = async (messId: string, input: CreatePeriodInput, context: AuditContext) => {
  const existing = await prisma.messPeriod.findUnique({
    where: { messId_year_month: { messId, year: input.year, month: input.month } },
    select: { id: true },
  });
  if (existing) throw new ConflictError('This month already exists for the mess');

  const period = await prisma.messPeriod.create({
    data: { messId, year: input.year, month: input.month },
    select: periodSelect,
  });

  await writeAudit(prisma, context, {
    action: AUDIT_ACTIONS.PERIOD_CREATE,
    entityType: AUDIT_ENTITIES.MESS_PERIOD,
    entityId: period.id,
    after: { year: period.year, month: period.month },
  });

  return period;
};

/**
 * Meal and expense writes need a period to attach to; requiring the manager to
 * pre-create every month would block members on the 1st. Auto-open instead,
 * but only for a month that is not already closed.
 */
export const ensurePeriod = async (
  db: Db,
  messId: string,
  year: number,
  month: number,
): Promise<{ id: string; status: PeriodStatus }> => {
  const existing = await db.messPeriod.findUnique({
    where: { messId_year_month: { messId, year, month } },
    select: { id: true, status: true },
  });
  if (existing) return existing;

  return db.messPeriod.create({
    data: { messId, year, month },
    select: { id: true, status: true },
  });
};

/** Resolves the period a given calendar date belongs to. */
export const periodForDate = async (
  db: Db,
  messId: string,
  date: Date,
): Promise<{ id: string; status: PeriodStatus }> => {
  const { year, month } = yearMonthOf(date);
  return ensurePeriod(db, messId, year, month);
};

const list = async (messId: string, query: ListPeriodsQuery) => {
  const pagination = buildPagination(
    { ...query, sortBy: 'year' },
    ['year', 'createdAt'],
    'year',
  );

  const where = {
    messId,
    ...(query.year ? { year: query.year } : {}),
    ...(query.status ? { status: query.status } : {}),
  };

  const [periods, total] = await Promise.all([
    prisma.messPeriod.findMany({
      where,
      select: {
        ...periodSelect,
        _count: { select: { meals: true, expenses: true, deposits: true, statements: true } },
      },
      orderBy: [{ year: pagination.orderBy['year'] ?? 'desc' }, { month: 'desc' }],
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.messPeriod.count({ where }),
  ]);

  return { periods, meta: buildMeta(pagination, total) };
};

const getById = async (messId: string, periodId: string) => {
  const period = await prisma.messPeriod.findFirst({
    where: { id: periodId, messId },
    select: {
      ...periodSelect,
      _count: { select: { meals: true, expenses: true, deposits: true, statements: true } },
    },
  });
  if (!period) throw new NotFoundError('Period not found in this mess');
  return period;
};

/** The month the mess is currently operating in, by its own timezone. */
const getCurrent = async (messId: string, timezone: string) => {
  const { year, month } = yearMonthOf(zonedToday(timezone));
  const period = await ensurePeriod(prisma, messId, year, month);

  return prisma.messPeriod.findUniqueOrThrow({
    where: { id: period.id },
    select: periodSelect,
  });
};

export const periodService = { create, list, getById, getCurrent };
