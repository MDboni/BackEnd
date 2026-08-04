import { z } from 'zod';
import { AllocationType, ExpenseCategory } from '../../../generated/prisma/enums.js';

/** Money arrives as a string so JS float rounding never touches it. */
const money = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), 'Amount must be a positive number with up to 2 decimals')
  .refine((value) => Number(value) > 0, 'Amount must be greater than zero');

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date format YYYY-MM-DD');

const shareSchema = z.object({
  membershipId: z.uuid(),
  amount: money,
});

const baseExpense = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  category: z.enum(ExpenseCategory),
  allocationType: z.enum(AllocationType),
  amount: money,
  expenseDate: dateOnly,
  paidByMemberId: z.uuid().optional(),
  receiptUrl: z.url().max(500).optional(),
  /** Required for CUSTOM and MEMBER_SPECIFIC, forbidden otherwise. */
  shares: z.array(shareSchema).max(100).optional(),
  /** EQUAL may exclude members (e.g. someone away all month). */
  excludeMembershipIds: z.array(z.uuid()).max(100).optional(),
});

/**
 * Blueprint's most important rule (1.3): food goes into the meal rate, fixed
 * costs never do. Enforcing it at the edge means no service can mix them.
 */
const allocationRules = <T extends z.ZodType>(schema: T) =>
  schema
    .superRefine((value: unknown, ctx: z.RefinementCtx) => {
      const input = value as Partial<z.infer<typeof baseExpense>>;
      const { allocationType, category, shares } = input;

      if (allocationType === AllocationType.MEAL_BASED && category !== ExpenseCategory.FOOD) {
        ctx.addIssue({
          code: 'custom',
          path: ['allocationType'],
          message: 'MEAL_BASED allocation is only valid for FOOD expenses',
        });
      }

      if (category === ExpenseCategory.FOOD && allocationType === AllocationType.EQUAL) {
        ctx.addIssue({
          code: 'custom',
          path: ['allocationType'],
          message:
            'FOOD expenses must be MEAL_BASED (or CUSTOM/MEMBER_SPECIFIC), never split equally',
        });
      }

      const needsShares =
        allocationType === AllocationType.CUSTOM ||
        allocationType === AllocationType.MEMBER_SPECIFIC;

      if (needsShares && (!shares || shares.length === 0)) {
        ctx.addIssue({
          code: 'custom',
          path: ['shares'],
          message: `${allocationType} allocation requires an explicit shares list`,
        });
      }

      if (!needsShares && shares && shares.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['shares'],
          message: `${allocationType} allocation cannot take a shares list`,
        });
      }

      if (shares && shares.length > 0) {
        const ids = shares.map((share) => share.membershipId);
        if (new Set(ids).size !== ids.length) {
          ctx.addIssue({
            code: 'custom',
            path: ['shares'],
            message: 'A member can appear only once in the shares list',
          });
        }
      }
    });

export const createExpenseSchema = allocationRules(baseExpense.strict());

export const updateExpenseSchema = allocationRules(
  baseExpense.omit({ allocationType: true, category: true }).partial().strict().safeExtend({
    category: z.enum(ExpenseCategory).optional(),
    allocationType: z.enum(AllocationType).optional(),
  }),
);

export const listExpensesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    periodId: z.uuid().optional(),
    category: z.enum(ExpenseCategory).optional(),
    allocationType: z.enum(AllocationType).optional(),
    search: z.string().trim().max(80).optional(),
    dateFrom: dateOnly.optional(),
    dateTo: dateOnly.optional(),
    includeVoided: z.coerce.boolean().optional(),
    sortBy: z.enum(['expenseDate', 'amount', 'createdAt']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
  })
  .strict();

export const voidExpenseSchema = z
  .object({ reason: z.string().trim().min(5).max(255) })
  .strict();

export const expenseIdParamSchema = z.object({ messId: z.uuid(), id: z.uuid() });

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
