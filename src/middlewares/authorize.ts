import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { MembershipStatus } from '../../generated/prisma/enums.js';
import { prisma } from '../config/prisma.js';
import { hasPermission, isOwner, type Permission } from '../shared/constants/permissions.js';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../shared/errors/AppError.js';
import { catchAsync } from '../shared/utils/catchAsync.js';
import { param } from '../shared/utils/request.js';

/**
 * Blueprint 2.3: resolves `:messId` into the caller's membership and pins it to
 * the request. Every downstream query filters by `req.membership.messId`, so a
 * valid id from another mess resolves to 404, not to someone else's data.
 */
export const membershipScope = catchAsync(
  async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new UnauthorizedError('Authentication required');

    const messId = param(req, 'messId');

    const membership = await prisma.membership.findUnique({
      where: { userId_messId: { userId: req.user.id, messId } },
      select: {
        id: true,
        messId: true,
        role: true,
        status: true,
        mess: {
          select: {
            deletedAt: true,
            timezone: true,
            mealCutoffTime: true,
            cutoffDaysAhead: true,
            roundingScale: true,
          },
        },
      },
    });

    // Same 404 for "no such mess" and "not a member" — existence is not public.
    if (!membership || membership.mess.deletedAt) throw new NotFoundError('Mess not found');

    if (
      membership.status === MembershipStatus.REMOVED ||
      membership.status === MembershipStatus.INVITED
    ) {
      throw new ForbiddenError('Your membership is not active in this mess');
    }

    req.membership = {
      membershipId: membership.id,
      messId: membership.messId,
      role: membership.role,
      status: membership.status,
      timezone: membership.mess.timezone,
      mealCutoffTime: membership.mess.mealCutoffTime,
      cutoffDaysAhead: membership.mess.cutoffDaysAhead,
      roundingScale: membership.mess.roundingScale,
    };

    next();
  },
);

/** Requires every listed permission for the caller's role in the scoped mess. */
export const authorize =
  (...required: Permission[]): RequestHandler =>
  (req, _res, next) => {
    const membership = req.membership;
    if (!membership) {
      next(new ForbiddenError('Mess context is required for this action'));
      return;
    }

    const missing = required.filter((permission) => !hasPermission(membership.role, permission));
    if (missing.length > 0) {
      next(new ForbiddenError(`Your role (${membership.role}) cannot perform this action`));
      return;
    }

    next();
  };

/** Ownership transfer, role changes and month reopen never delegate. */
export const requireOwner: RequestHandler = (req, _res, next) => {
  const membership = req.membership;
  if (!membership || !isOwner(membership.role)) {
    next(new ForbiddenError('Only the mess owner can perform this action'));
    return;
  }
  next();
};

/**
 * INACTIVE members keep read access to their history but must not write new
 * financial or meal rows.
 */
export const requireActiveMembership: RequestHandler = (req, _res, next) => {
  if (req.membership?.status !== MembershipStatus.ACTIVE) {
    next(new ForbiddenError('Only active members can perform this action'));
    return;
  }
  next();
};
