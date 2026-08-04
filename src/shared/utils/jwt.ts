import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { UnauthorizedError } from '../errors/AppError.js';

export type AccessTokenPayload = {
  sub: string;
  email: string;
  name: string;
};

export type RefreshTokenPayload = {
  sub: string;
  sid: string;
};

/** `expiresIn` is typed as a template literal in @types/jsonwebtoken; env gives a plain string. */
type ExpiresIn = SignOptions['expiresIn'];

export const signAccessToken = (payload: AccessTokenPayload): string =>
  jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as ExpiresIn,
  });

export const signRefreshToken = (payload: RefreshTokenPayload): string =>
  jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.REFRESH_TOKEN_TTL as ExpiresIn,
  });

const verify = <T>(token: string, secret: string): T & JwtPayload => {
  try {
    return jwt.verify(token, secret) as T & JwtPayload;
  } catch {
    // Never surface the library message — it distinguishes "expired" from
    // "bad signature" and that is a probing aid.
    throw new UnauthorizedError('Invalid or expired token');
  }
};

export const verifyAccessToken = (token: string): AccessTokenPayload & JwtPayload =>
  verify<AccessTokenPayload>(token, env.JWT_ACCESS_SECRET);

export const verifyRefreshToken = (token: string): RefreshTokenPayload & JwtPayload =>
  verify<RefreshTokenPayload>(token, env.JWT_REFRESH_SECRET);

/** Seconds until a signed token expires, for cookie maxAge. */
export const expiresInMs = (token: string): number => {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded === 'string' || !decoded.exp) return 0;
  return Math.max(0, decoded.exp * 1000 - Date.now());
};
