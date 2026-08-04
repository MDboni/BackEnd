import { z } from 'zod';
import { DepositType } from '../../../generated/prisma/enums.js';

const money = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), 'Amount must be a positive number with up to 2 decimals')
  .refine((value) => Number(value) > 0, 'Amount must be greater than zero');

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date format YYYY-MM-DD');

export const createDepositSchema = z
  .object({
    membershipId: z.uuid(),
    type: z.enum(DepositType).default(DepositType.DEPOSIT),
    amount: money,
    transactionDate: dateOnly,
    reference: z.string().trim().max(80).optional(),
    note: z.string().trim().max(255).optional(),
  })
  .strict();

export const updateDepositSchema = z
  .object({
    amount: money.optional(),
    transactionDate: dateOnly.optional(),
    reference: z.string().trim().max(80).optional(),
    note: z.string().trim().max(255).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const listDepositsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    periodId: z.uuid().optional(),
    membershipId: z.uuid().optional(),
    type: z.enum(DepositType).optional(),
    dateFrom: dateOnly.optional(),
    dateTo: dateOnly.optional(),
    includeVoided: z.coerce.boolean().optional(),
    sortBy: z.enum(['transactionDate', 'amount', 'createdAt']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
  })
  .strict();

export const voidDepositSchema = z
  .object({ reason: z.string().trim().min(5).max(255) })
  .strict();

export const depositIdParamSchema = z.object({ messId: z.uuid(), id: z.uuid() });

export type CreateDepositInput = z.infer<typeof createDepositSchema>;
export type UpdateDepositInput = z.infer<typeof updateDepositSchema>;
export type ListDepositsQuery = z.infer<typeof listDepositsQuerySchema>;
