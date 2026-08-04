import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { UnauthorizedError } from '../shared/errors/AppError.js';
import { catchAsync } from '../shared/utils/catchAsync.js';
import { verifyAccessToken } from '../shared/utils/jwt.js';

export const ACCESS_COOKIE = 'accessToken';
export const REFRESH_COOKIE = 'refreshToken';
/** Not a credential — see `setAuthCookies` for why it exists. */
export const SESSION_COOKIE = 'mm_session';

const readToken = (req: Request): string | null => {
  const cookieToken = (req.cookies as Record<string, string | undefined> | undefined)?.[
    ACCESS_COOKIE
  ];
  if (cookieToken) return cookieToken;

  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null;

  return null;
};

/**
 * Proves who the caller is. It deliberately does NOT decide what they may do —
 * that needs a mess, and lives in `membershipScope` + `authorize`.
 */
export const authenticate = catchAsync(
  async (req: Request, _res: Response, next: NextFunction) => {
    const token = readToken(req);
    if (!token) throw new UnauthorizedError('Authentication required');

    const payload = verifyAccessToken(token);

    // Re-read the user: a token stays valid after the account is disabled.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, isActive: true },
    });

    if (!user) throw new UnauthorizedError('Account no longer exists');
    if (!user.isActive) throw new UnauthorizedError('Account is disabled');

    req.user = { id: user.id, email: user.email, name: user.name };
    next();
  },
);
