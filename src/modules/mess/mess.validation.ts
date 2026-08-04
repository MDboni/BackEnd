import { z } from 'zod';

const timezone = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'Unknown IANA timezone');

export const createMessSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    address: z.string().trim().max(255).optional(),
    timezone: timezone.default('Asia/Dhaka'),
    mealCutoffTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Expected HH:mm (24-hour)')
      .default('22:00'),
    cutoffDaysAhead: z.coerce.number().int().min(0).max(7).default(1),
    roundingScale: z.coerce.number().int().min(0).max(4).default(2),
  })
  .strict();

export const updateMessSchema = createMessSchema.partial().strict();

export const messIdParamSchema = z.object({ messId: z.uuid() });

export type CreateMessInput = z.infer<typeof createMessSchema>;
export type UpdateMessInput = z.infer<typeof updateMessSchema>;
