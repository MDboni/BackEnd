import { MembershipRole, MembershipStatus } from '../../../generated/prisma/enums.js';
import { prisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../../shared/constants/audit.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/AppError.js';
import { writeAudit, type AuditContext } from '../../shared/utils/audit.js';
import { buildMeta, buildPagination } from '../../shared/utils/pagination.js';
import { randomInviteCode, sha256 } from '../../shared/utils/password.js';
import type {
  CreateInvitationInput,
  JoinMessInput,
  ListMembersQuery,
  TransferOwnershipInput,
  UpdateRoleInput,
  UpdateStatusInput,
} from './membership.validation.js';

const memberSelect = {
  id: true,
  role: true,
  status: true,
  roomLabel: true,
  joinedAt: true,
  leftAt: true,
  user: { select: { id: true, name: true, email: true, phone: true, avatarUrl: true } },
} as const;

const createInvitation = async (
  messId: string,
  createdById: string,
  input: CreateInvitationInput,
  context: AuditContext,
) => {
  const code = randomInviteCode();

  const invitation = await prisma.invitation.create({
    data: {
      messId,
      codeHash: sha256(code),
      role: input.role,
      expiresAt: new Date(Date.now() + input.expiresInHours * 3_600_000),
      maxUses: input.maxUses,
      createdById,
    },
    select: { id: true, role: true, expiresAt: true, maxUses: true, usedCount: true },
  });

  await writeAudit(prisma, context, {
    action: AUDIT_ACTIONS.INVITATION_CREATE,
    entityType: AUDIT_ENTITIES.INVITATION,
    entityId: invitation.id,
    after: { role: invitation.role, expiresAt: invitation.expiresAt, maxUses: invitation.maxUses },
  });

  // The plaintext code is returned exactly once — only its hash is stored.
  return { ...invitation, code };
};

const listInvitations = async (messId: string) =>
  prisma.invitation.findMany({
    where: { messId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      role: true,
      expiresAt: true,
      maxUses: true,
      usedCount: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

const revokeInvitation = async (messId: string, invitationId: string, context: AuditContext) => {
  const invitation = await prisma.invitation.findFirst({
    where: { id: invitationId, messId, revokedAt: null },
    select: { id: true },
  });
  if (!invitation) throw new NotFoundError('Invitation not found');

  await prisma.invitation.update({
    where: { id: invitationId },
    data: { revokedAt: new Date() },
  });

  await writeAudit(prisma, context, {
    action: AUDIT_ACTIONS.INVITATION_REVOKE,
    entityType: AUDIT_ENTITIES.INVITATION,
    entityId: invitationId,
  });
};

/** Public preview so the join page can show what the code is for before committing. */
const previewInvitation = async (code: string) => {
  const invitation = await prisma.invitation.findUnique({
    where: { codeHash: sha256(code) },
    select: {
      role: true,
      expiresAt: true,
      maxUses: true,
      usedCount: true,
      revokedAt: true,
      mess: { select: { id: true, name: true, slug: true, deletedAt: true } },
    },
  });

  if (!invitation || invitation.revokedAt || invitation.mess.deletedAt) {
    throw new NotFoundError('Invitation is invalid or has been revoked');
  }
  if (invitation.expiresAt <= new Date()) throw new ConflictError('Invitation has expired');
  if (invitation.usedCount >= invitation.maxUses) {
    throw new ConflictError('Invitation has already been fully used');
  }

  return {
    messId: invitation.mess.id,
    messName: invitation.mess.name,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    remainingUses: invitation.maxUses - invitation.usedCount,
  };
};

/**
 * Join is transactional and the usage counter is bumped with a guarded
 * `updateMany`, so two people redeeming a single-use code cannot both win.
 */
const joinByCode = async (
  userId: string,
  code: string,
  input: JoinMessInput,
  context: AuditContext,
) =>
  prisma.$transaction(async (tx) => {
    const invitation = await tx.invitation.findUnique({
      where: { codeHash: sha256(code) },
      select: {
        id: true,
        messId: true,
        role: true,
        expiresAt: true,
        maxUses: true,
        usedCount: true,
        revokedAt: true,
        mess: { select: { name: true, deletedAt: true } },
      },
    });

    if (!invitation || invitation.revokedAt || invitation.mess.deletedAt) {
      throw new NotFoundError('Invitation is invalid or has been revoked');
    }
    if (invitation.expiresAt <= new Date()) throw new ConflictError('Invitation has expired');

    const existing = await tx.membership.findUnique({
      where: { userId_messId: { userId, messId: invitation.messId } },
      select: { id: true, status: true },
    });

    if (existing && existing.status !== MembershipStatus.REMOVED) {
      throw new ConflictError('You are already a member of this mess');
    }

    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, usedCount: { lt: invitation.maxUses }, revokedAt: null },
      data: { usedCount: { increment: 1 } },
    });
    if (claimed.count === 0) throw new ConflictError('Invitation has already been fully used');

    // A previously removed member rejoins on the same row, keeping their history.
    const membership = existing
      ? await tx.membership.update({
          where: { id: existing.id },
          data: {
            role: invitation.role,
            status: MembershipStatus.ACTIVE,
            roomLabel: input.roomLabel ?? null,
            joinedAt: new Date(),
            leftAt: null,
          },
          select: memberSelect,
        })
      : await tx.membership.create({
          data: {
            userId,
            messId: invitation.messId,
            role: invitation.role,
            status: MembershipStatus.ACTIVE,
            roomLabel: input.roomLabel ?? null,
          },
          select: memberSelect,
        });

    await writeAudit(tx, { ...context, messId: invitation.messId }, {
      action: AUDIT_ACTIONS.MEMBERSHIP_JOIN,
      entityType: AUDIT_ENTITIES.MEMBERSHIP,
      entityId: membership.id,
      after: { role: membership.role, invitationId: invitation.id },
    });

    return { membership, messId: invitation.messId, messName: invitation.mess.name };
  });

const listMembers = async (messId: string, query: ListMembersQuery) => {
  const pagination = buildPagination(query, ['joinedAt', 'role', 'status', 'createdAt'], 'joinedAt');

  const where = {
    messId,
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { status: query.status } : { status: { not: MembershipStatus.REMOVED } }),
    ...(query.search
      ? {
          user: {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { email: { contains: query.search, mode: 'insensitive' as const } },
            ],
          },
        }
      : {}),
  };

  const [members, total] = await Promise.all([
    prisma.membership.findMany({
      where,
      select: memberSelect,
      orderBy: pagination.orderBy,
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.membership.count({ where }),
  ]);

  return { members, meta: buildMeta(pagination, total) };
};

const requireMember = async (messId: string, membershipId: string) => {
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, messId },
    select: { ...memberSelect, messId: true },
  });
  if (!membership) throw new NotFoundError('Member not found in this mess');
  return membership;
};

const updateRole = async (
  messId: string,
  membershipId: string,
  input: UpdateRoleInput,
  context: AuditContext,
) => {
  const member = await requireMember(messId, membershipId);

  // Demoting the only owner would leave the mess unmanageable.
  if (member.role === MembershipRole.OWNER) {
    throw new ForbiddenError('Use ownership transfer to change the owner');
  }

  const updated = await prisma.membership.update({
    where: { id: membershipId },
    data: { role: input.role },
    select: memberSelect,
  });

  await writeAudit(prisma, context, {
    action: AUDIT_ACTIONS.MEMBERSHIP_ROLE_UPDATE,
    entityType: AUDIT_ENTITIES.MEMBERSHIP,
    entityId: membershipId,
    reason: input.reason ?? null,
    before: { role: member.role },
    after: { role: updated.role },
  });

  return updated;
};

const updateStatus = async (
  messId: string,
  membershipId: string,
  input: UpdateStatusInput,
  context: AuditContext,
) => {
  const member = await requireMember(messId, membershipId);

  if (member.role === MembershipRole.OWNER) {
    throw new ForbiddenError('The owner cannot be deactivated or removed');
  }

  if (input.status === MembershipStatus.REMOVED) {
    // Financial history must stay attributable; block removal while an open
    // period still references this member.
    const openActivity = await prisma.mealEntry.count({
      where: { membershipId, period: { status: { in: ['OPEN', 'REOPENED'] } } },
    });
    if (openActivity > 0) {
      throw new ValidationError(
        'This member has meal entries in an open period. Set them INACTIVE, or close the period first.',
      );
    }
  }

  const updated = await prisma.membership.update({
    where: { id: membershipId },
    data: {
      status: input.status,
      leftAt: input.status === MembershipStatus.ACTIVE ? null : new Date(),
    },
    select: memberSelect,
  });

  await writeAudit(prisma, context, {
    action: AUDIT_ACTIONS.MEMBERSHIP_STATUS_UPDATE,
    entityType: AUDIT_ENTITIES.MEMBERSHIP,
    entityId: membershipId,
    reason: input.reason ?? null,
    before: { status: member.status },
    after: { status: updated.status },
  });

  return updated;
};

/** Owner steps down and the target steps up in one transaction — never two owners, never none. */
const transferOwnership = async (
  messId: string,
  currentOwnerMembershipId: string,
  input: TransferOwnershipInput,
  context: AuditContext,
) =>
  prisma.$transaction(async (tx) => {
    const target = await tx.membership.findFirst({
      where: { id: input.membershipId, messId, status: MembershipStatus.ACTIVE },
      select: { id: true, role: true, user: { select: { name: true } } },
    });
    if (!target) throw new NotFoundError('Target member not found or is not active');
    if (target.id === currentOwnerMembershipId) {
      throw new ConflictError('You already own this mess');
    }

    await tx.membership.update({
      where: { id: currentOwnerMembershipId },
      data: { role: MembershipRole.MANAGER },
    });

    const newOwner = await tx.membership.update({
      where: { id: target.id },
      data: { role: MembershipRole.OWNER },
      select: memberSelect,
    });

    await writeAudit(tx, context, {
      action: AUDIT_ACTIONS.OWNERSHIP_TRANSFER,
      entityType: AUDIT_ENTITIES.MEMBERSHIP,
      entityId: target.id,
      reason: input.reason,
      before: { ownerMembershipId: currentOwnerMembershipId },
      after: { ownerMembershipId: target.id },
    });

    return newOwner;
  });

export const membershipService = {
  createInvitation,
  listInvitations,
  revokeInvitation,
  previewInvitation,
  joinByCode,
  listMembers,
  updateRole,
  updateStatus,
  transferOwnership,
};
