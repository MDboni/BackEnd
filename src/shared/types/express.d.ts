import type { MembershipRole, MembershipStatus } from '../../../generated/prisma/enums.js';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

export type MembershipContext = {
  membershipId: string;
  messId: string;
  role: MembershipRole;
  status: MembershipStatus;
  timezone: string;
  mealCutoffTime: string;
  cutoffDaysAhead: number;
  roundingScale: number;
};

declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate`. */
      user?: AuthUser;
      /** Set by `membershipScope` on every `/messes/:messId/...` route. */
      membership?: MembershipContext;
      requestId?: string;
    }
  }
}

export {};
