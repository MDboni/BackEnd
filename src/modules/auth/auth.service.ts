import { prisma } from '../../config/prisma.js';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from '../../shared/errors/AppError.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../shared/utils/jwt.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../shared/utils/password.js';
import type { ChangePasswordInput, LoginInput, RegisterInput } from './auth.validation.js';

const REFRESH_TTL_DAYS = 30;

/**
 * How long after rotation a replayed refresh token is treated as a benign
 * race rather than a stolen token. Long enough to cover several tabs waking
 * together; far too short to be useful to an attacker holding a copy.
 */
const REFRESH_REPLAY_GRACE_MS = 60_000;

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
};

type SessionMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  avatarUrl: true,
} as const;

/**
 * Refresh tokens carry a session id (`sid`) and are stored only as a hash.
 * Rotation replaces the row, so a stolen token stops working the moment the
 * real client refreshes.
 */
const issueSession = async (
  userId: string,
  meta: SessionMeta,
): Promise<AuthTokens & { sessionId: string }> => {
  const secret = randomToken(32);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000);

  const session = await prisma.refreshSession.create({
    data: {
      userId,
      tokenHash: sha256(secret),
      expiresAt,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    },
    select: { id: true, user: { select: publicUserSelect } },
  });

  return {
    sessionId: session.id,
    accessToken: signAccessToken({
      sub: session.user.id,
      email: session.user.email,
      name: session.user.name,
    }),
    // The client-side token embeds the secret so the server can verify the hash.
    refreshToken: signRefreshToken({ sub: userId, sid: `${session.id}.${secret}` }),
  };
};

const splitSid = (sid: string): { sessionId: string; secret: string } => {
  const separator = sid.indexOf('.');
  if (separator < 0) throw new UnauthorizedError('Invalid refresh token');
  return { sessionId: sid.slice(0, separator), secret: sid.slice(separator + 1) };
};

const register = async (
  input: RegisterInput,
  meta: SessionMeta,
): Promise<{ user: PublicUser; tokens: AuthTokens }> => {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) throw new ConflictError('An account with this email already exists');

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      phone: input.phone ?? null,
    },
    select: publicUserSelect,
  });

  const { accessToken, refreshToken } = await issueSession(user.id, meta);
  return { user, tokens: { accessToken, refreshToken } };
};

const login = async (
  input: LoginInput,
  meta: SessionMeta,
): Promise<{ user: PublicUser; tokens: AuthTokens }> => {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { ...publicUserSelect, passwordHash: true, isActive: true },
  });

  // Same message and roughly the same work either way — do not leak which
  // emails are registered.
  const passwordOk = user
    ? await verifyPassword(input.password, user.passwordHash)
    : await verifyPassword(input.password, '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinv');

  if (!user || !passwordOk) throw new UnauthorizedError('Invalid email or password');
  if (!user.isActive) throw new UnauthorizedError('Account is disabled');

  const { passwordHash: _passwordHash, isActive: _isActive, ...publicUser } = user;
  const { accessToken, refreshToken } = await issueSession(user.id, meta);
  return { user: publicUser, tokens: { accessToken, refreshToken } };
};

/** Rotation: the presented session is revoked and a fresh one is issued. */
const refresh = async (token: string, meta: SessionMeta): Promise<AuthTokens> => {
  const payload = verifyRefreshToken(token);
  const { sessionId, secret } = splitSid(payload.sid);

  const session = await prisma.refreshSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      tokenHash: true,
      expiresAt: true,
      revokedAt: true,
      user: { select: { isActive: true } },
    },
  });

  if (!session || session.userId !== payload.sub) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  if (session.revokedAt) {
    // Two tabs waking at once both send the same cookie, and the loser arrives
    // moments after rotation. That is a race, not theft — treating it as theft
    // would sign the user out of every device for having two tabs open. Only a
    // replay well after rotation is a real reuse signal.
    const sinceRevoked = Date.now() - session.revokedAt.getTime();

    if (sinceRevoked > REFRESH_REPLAY_GRACE_MS) {
      await prisma.refreshSession.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedError('Refresh token has been revoked');
    }

    // The cookie has already been replaced by the winning request; the caller
    // just needs to try again with what the browser now holds.
    throw new UnauthorizedError('Refresh token was just rotated. Please retry.');
  }

  if (session.expiresAt <= new Date()) throw new UnauthorizedError('Refresh token has expired');
  if (session.tokenHash !== sha256(secret)) throw new UnauthorizedError('Invalid refresh token');
  if (!session.user.isActive) throw new UnauthorizedError('Account is disabled');

  await prisma.refreshSession.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });

  const { accessToken, refreshToken } = await issueSession(session.userId, meta);
  return { accessToken, refreshToken };
};

const logout = async (token: string | undefined): Promise<void> => {
  if (!token) return;

  try {
    const payload = verifyRefreshToken(token);
    const { sessionId } = splitSid(payload.sid);
    await prisma.refreshSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch {
    // Logging out with a bad token still clears cookies — never a 401.
  }
};

const changePassword = async (userId: string, input: ChangePasswordInput): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) throw new NotFoundError('User not found');

  const matches = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!matches) throw new UnauthorizedError('Current password is incorrect');

  // Blueprint 6.1: a password change invalidates every existing session.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(input.newPassword) },
    }),
    prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
};

const me = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...publicUserSelect,
      createdAt: true,
      memberships: {
        where: { status: { in: ['ACTIVE', 'INACTIVE'] } },
        select: {
          id: true,
          role: true,
          status: true,
          roomLabel: true,
          joinedAt: true,
          mess: { select: { id: true, name: true, slug: true, timezone: true } },
        },
        orderBy: { joinedAt: 'asc' },
      },
    },
  });

  if (!user) throw new NotFoundError('User not found');
  return user;
};

export const authService = {
  register,
  login,
  refresh,
  logout,
  changePassword,
  me,
};
