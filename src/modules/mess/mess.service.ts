import { MembershipRole, MembershipStatus } from '../../../generated/prisma/enums.js';
import { prisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../../shared/constants/audit.js';
import { NotFoundError } from '../../shared/errors/AppError.js';
import { writeAudit, type AuditContext } from '../../shared/utils/audit.js';
import { uniqueSlug } from '../../shared/utils/slug.js';
import type { CreateMessInput, UpdateMessInput } from './mess.validation.js';

const messSelect = {
  id: true,
  name: true,
  slug: true,
  address: true,
  timezone: true,
  mealCutoffTime: true,
  cutoffDaysAhead: true,
  roundingScale: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Creating a mess and becoming its OWNER is one atomic act — a mess with no
 * owner would be unmanageable and unreachable.
 */
const create = async (userId: string, input: CreateMessInput, context: AuditContext) => {
  const mess = await prisma.$transaction(async (tx) => {
    const created = await tx.mess.create({
      data: {
        name: input.name,
        slug: uniqueSlug(input.name),
        address: input.address ?? null,
        timezone: input.timezone,
        mealCutoffTime: input.mealCutoffTime,
        cutoffDaysAhead: input.cutoffDaysAhead,
        roundingScale: input.roundingScale,
        memberships: {
          create: {
            userId,
            role: MembershipRole.OWNER,
            status: MembershipStatus.ACTIVE,
          },
        },
      },
      select: messSelect,
    });

    await writeAudit(tx, { ...context, messId: created.id }, {
      action: AUDIT_ACTIONS.MESS_CREATE,
      entityType: AUDIT_ENTITIES.MESS,
      entityId: created.id,
      after: created,
    });

    return created;
  });

  return mess;
};

const listMine = async (userId: string) => {
  const memberships = await prisma.membership.findMany({
    where: {
      userId,
      status: { in: [MembershipStatus.ACTIVE, MembershipStatus.INACTIVE] },
      mess: { deletedAt: null },
    },
    select: {
      id: true,
      role: true,
      status: true,
      roomLabel: true,
      joinedAt: true,
      mess: {
        select: {
          ...messSelect,
          _count: { select: { memberships: { where: { status: MembershipStatus.ACTIVE } } } },
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  return memberships.map((membership) => ({
    membershipId: membership.id,
    role: membership.role,
    status: membership.status,
    roomLabel: membership.roomLabel,
    joinedAt: membership.joinedAt,
    activeMemberCount: membership.mess._count.memberships,
    ...membership.mess,
    _count: undefined,
  }));
};

const getById = async (messId: string) => {
  const mess = await prisma.mess.findFirst({
    where: { id: messId, deletedAt: null },
    select: {
      ...messSelect,
      _count: {
        select: {
          memberships: { where: { status: MembershipStatus.ACTIVE } },
          periods: true,
        },
      },
    },
  });

  if (!mess) throw new NotFoundError('Mess not found');
  return mess;
};

const update = async (messId: string, input: UpdateMessInput, context: AuditContext) => {
  const before = await prisma.mess.findFirst({
    where: { id: messId, deletedAt: null },
    select: messSelect,
  });
  if (!before) throw new NotFoundError('Mess not found');

  const updated = await prisma.mess.update({
    where: { id: messId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.mealCutoffTime !== undefined ? { mealCutoffTime: input.mealCutoffTime } : {}),
      ...(input.cutoffDaysAhead !== undefined ? { cutoffDaysAhead: input.cutoffDaysAhead } : {}),
      ...(input.roundingScale !== undefined ? { roundingScale: input.roundingScale } : {}),
    },
    select: messSelect,
  });

  await writeAudit(prisma, context, {
    action: AUDIT_ACTIONS.MESS_UPDATE,
    entityType: AUDIT_ENTITIES.MESS,
    entityId: messId,
    before,
    after: updated,
  });

  return updated;
};

export const messService = { create, listMine, getById, update };
