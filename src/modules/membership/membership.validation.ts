import { z } from 'zod';
import { MembershipRole, MembershipStatus } from '../../../generated/prisma/enums.js';

/** OWNER is granted by creation or transfer, never by invitation or a role edit. */
const assignableRole = z.enum([
  MembershipRole.MANAGER,
  MembershipRole.ACCOUNTANT,
  MembershipRole.COOK,
  MembershipRole.MEMBER,
]);

export const createInvitationSchema = z
  .object({
    role: assignableRole.default(MembershipRole.MEMBER),
    expiresInHours: z.coerce.number().int().min(1).max(720).default(72),
    maxUses: z.coerce.number().int().min(1).max(50).default(1),
  })
  .strict();

export const inviteCodeParamSchema = z.object({
  code: z.string().trim().length(8, 'Invite code must be 8 characters').toUpperCase(),
});

export const joinMessSchema = z
  .object({
    roomLabel: z.string().trim().max(30).optional(),
  })
  .strict();

export const listMembersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    search: z.string().trim().max(80).optional(),
    role: z.enum(MembershipRole).optional(),
    status: z.enum(MembershipStatus).optional(),
    sortBy: z.enum(['joinedAt', 'role', 'status', 'createdAt']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
  })
  .strict();

export const updateRoleSchema = z
  .object({
    role: assignableRole,
    reason: z.string().trim().min(3).max(255).optional(),
  })
  .strict();

export const updateStatusSchema = z
  .object({
    status: z.enum([
      MembershipStatus.ACTIVE,
      MembershipStatus.INACTIVE,
      MembershipStatus.REMOVED,
    ]),
    reason: z.string().trim().min(3).max(255).optional(),
  })
  .strict();

export const transferOwnershipSchema = z
  .object({
    membershipId: z.uuid(),
    reason: z.string().trim().min(3).max(255),
  })
  .strict();

export const membershipIdParamSchema = z.object({
  messId: z.uuid(),
  id: z.uuid(),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type JoinMessInput = z.infer<typeof joinMessSchema>;
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;
