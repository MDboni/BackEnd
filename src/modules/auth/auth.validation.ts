import { z } from 'zod';

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters') // bcrypt truncates beyond 72 bytes
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/\d/, 'Password must contain a digit');

export const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    email: z.email().toLowerCase().trim(),
    password,
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9\s-]{6,20}$/, 'Invalid phone number')
      .optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email: z.email().toLowerCase().trim(),
    password: z.string().min(1, 'Password is required'),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: password,
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
