import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { buildMeta, buildPagination } from '../../shared/utils/pagination.js';

export const listAuditQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    entityType: z.string().trim().max(40).optional(),
    entityId: z.uuid().optional(),
    action: z.string().trim().max(60).optional(),
    actorId: z.uuid().optional(),
    dateFrom: z.iso.datetime().optional(),
    dateTo: z.iso.datetime().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
  })
  .strict();

export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;

const list = async (messId: string, query: ListAuditQuery) => {
  const pagination = buildPagination(query, ['createdAt'], 'createdAt');

  const where = {
    messId,
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.actorId ? { actorUserId: query.actorId } : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          createdAt: {
            ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
            ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
          },
        }
      : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        reason: true,
        before: true,
        after: true,
        ipAddress: true,
        createdAt: true,
        actor: { select: { id: true, name: true, email: true } },
      },
      orderBy: pagination.orderBy,
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { logs, meta: buildMeta(pagination, total) };
};

export const auditService = { list };
