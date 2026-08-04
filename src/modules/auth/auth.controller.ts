import type { CookieOptions, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  SESSION_COOKIE,
} from '../../middlewares/authenticate.js';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../../shared/constants/audit.js';
import { UnauthorizedError } from '../../shared/errors/AppError.js';
import { auditContextFrom, writeAudit } from '../../shared/utils/audit.js';
import { catchAsync } from '../../shared/utils/catchAsync.js';
import { expiresInMs } from '../../shared/utils/jwt.js';
import { sendResponse } from '../../shared/utils/sendResponse.js';
import { authService, type AuthTokens } from './auth.service.js';

/**
 * Blueprint 6.1: tokens live in httpOnly cookies so page scripts cannot read
 * them. The refresh cookie is additionally path-scoped to the refresh endpoint.
 */
const cookieBase = (): CookieOptions => ({
  httpOnly: true,
  secure: env.isProduction,
  sameSite: env.isProduction ? 'none' : 'lax',
  ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
});

const setAuthCookies = (res: Response, tokens: AuthTokens): void => {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...cookieBase(),
    path: '/',
    maxAge: expiresInMs(tokens.accessToken),
  });

  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...cookieBase(),
    path: '/api/v1/auth',
    maxAge: expiresInMs(tokens.refreshToken),
  });

  /**
   * A flag, not a credential — it carries no identity and grants nothing.
   *
   * The access cookie disappears from the browser when it expires, so a
   * frontend route guard checking for it would bounce the user to login every
   * fifteen minutes even though the refresh token is good for a month. The
   * refresh cookie cannot fill that role: it is path-scoped to this router, so
   * the frontend never receives it. This one lives as long as the session and
   * exists purely so the UI knows not to give up.
   */
  res.cookie(SESSION_COOKIE, '1', {
    ...cookieBase(),
    httpOnly: false,
    path: '/',
    maxAge: expiresInMs(tokens.refreshToken),
  });
};

const clearAuthCookies = (res: Response): void => {
  res.clearCookie(ACCESS_COOKIE, { ...cookieBase(), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...cookieBase(), path: '/api/v1/auth' });
  res.clearCookie(SESSION_COOKIE, { ...cookieBase(), httpOnly: false, path: '/' });
};

const sessionMeta = (req: Request) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

const register = catchAsync(async (req, res) => {
  const { user, tokens } = await authService.register(req.body, sessionMeta(req));
  setAuthCookies(res, tokens);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Account created successfully',
    data: { user, ...tokens },
  });
});

const login = catchAsync(async (req, res) => {
  const { user, tokens } = await authService.login(req.body, sessionMeta(req));
  setAuthCookies(res, tokens);

  sendResponse(res, {
    message: 'Logged in successfully',
    data: { user, ...tokens },
  });
});

const refresh = catchAsync(async (req: Request, res: Response) => {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  const token = cookies?.[REFRESH_COOKIE] ?? (req.body as { refreshToken?: string })?.refreshToken;

  if (!token) throw new UnauthorizedError('Refresh token is missing');

  const tokens = await authService.refresh(token, sessionMeta(req));
  setAuthCookies(res, tokens);

  sendResponse(res, { message: 'Token refreshed successfully', data: tokens });
});

const logout = catchAsync(async (req: Request, res: Response) => {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  await authService.logout(cookies?.[REFRESH_COOKIE]);
  clearAuthCookies(res);

  sendResponse(res, { message: 'Logged out successfully', data: null });
});

const me = catchAsync(async (req, res) => {
  const user = await authService.me(req.user!.id);
  sendResponse(res, { message: 'Current user retrieved successfully', data: user });
});

const changePassword = catchAsync(async (req, res) => {
  await authService.changePassword(req.user!.id, req.body);
  clearAuthCookies(res);

  await writeAudit(prisma, auditContextFrom(req, null), {
    action: AUDIT_ACTIONS.PASSWORD_CHANGE,
    entityType: AUDIT_ENTITIES.USER,
    entityId: req.user!.id,
  });

  sendResponse(res, {
    message: 'Password changed successfully. Please sign in again.',
    data: null,
  });
});

export const authController = {
  register,
  login,
  refresh,
  logout,
  me,
  changePassword,
};
