import { z } from 'zod';

/**
 * Blueprint 4.1: half meals and guest meals are real, so quantities are
 * decimals — but only in 0.5 steps, which is what the stepper UI produces.
 */
const mealQuantity = z.coerce
  .number()
  .min(0, 'Meal quantity cannot be negative')
  .max(20, 'Meal quantity looks unrealistic')
  .refine((value) => Number.isInteger(value * 2), 'Meal quantity must be in steps of 0.5');

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date format YYYY-MM-DD');

export const upsertMealSchema = z
  .object({
    breakfast: mealQuantity.optional(),
    lunch: mealQuantity.optional(),
    dinner: mealQuantity.optional(),
    guestBreakfast: mealQuantity.optional(),
    guestLunch: mealQuantity.optional(),
    guestDinner: mealQuantity.optional(),
    note: z.string().trim().max(255).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one meal field');

export const overrideMealSchema = upsertMealSchema
  .safeExtend({
    membershipId: z.uuid(),
    date: dateOnly,
    /** Blueprint 4.2: an override without a reason is not auditable. */
    reason: z.string().trim().min(5, 'Override reason is required').max(255),
  })
  .strict();

export const mealDateParamSchema = z.object({
  messId: z.uuid(),
  date: dateOnly,
});

export const monthQuerySchema = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected month format YYYY-MM')
      .optional(),
  })
  .strict();

export const dailyQuerySchema = z
  .object({
    date: dateOnly.optional(),
  })
  .strict();

export const copyMealsSchema = z
  .object({
    fromDate: dateOnly,
    toDates: z.array(dateOnly).min(1).max(31),
    overwrite: z.boolean().default(false),
  })
  .strict();

export type UpsertMealInput = z.infer<typeof upsertMealSchema>;
export type OverrideMealInput = z.infer<typeof overrideMealSchema>;
export type CopyMealsInput = z.infer<typeof copyMealsSchema>;
