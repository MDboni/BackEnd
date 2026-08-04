import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';

export const hashPassword = (plain: string): Promise<string> =>
  bcrypt.hash(plain, env.BCRYPT_SALT_ROUNDS);

export const verifyPassword = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash);

/**
 * Refresh tokens and invite codes are stored hashed: a leaked database dump
 * must not hand over usable sessions or open invitations. SHA-256 (not bcrypt)
 * because these are already high-entropy and looked up on every refresh.
 */
export const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('hex');

/** Short, readable, unambiguous — an invite code gets typed by hand. */
export const randomInviteCode = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let code = '';
  for (const byte of bytes) {
    code += alphabet[byte % alphabet.length];
  }
  return code;
};
