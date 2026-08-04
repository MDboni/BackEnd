import { z } from 'zod';
import { PeriodStatus } from '../../../generated/prisma/enums.js';

export const createPeriodSchema = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12),
  })
  .strict();

export const listPeriodsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    status: z.enum(PeriodStatus).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
  })
  .strict();

export const closePeriodSchema = z
  .object({
    /**
     * Blueprint 5.1: a retried close must not produce a second statement set.
     * The key makes the request identifiable, the period status makes it safe.
     */
    idempotencyKey: z.string().trim().min(8).max(100).optional(),
  })
  .strict();

export const reopenPeriodSchema = z
  .object({
    reason: z.string().trim().min(5).max(255),
  })
  .strict();

export const periodIdParamSchema = z.object({
  messId: z.uuid(),
  periodId: z.uuid(),
});

export type CreatePeriodInput = z.infer<typeof createPeriodSchema>;
export type ListPeriodsQuery = z.infer<typeof listPeriodsQuerySchema>;
export type ReopenPeriodInput = z.infer<typeof reopenPeriodSchema>;
