import type { Request } from 'express';
import { BadRequestError } from '../errors/AppError.js';

/**
 * Express 5 types every route param as `string | string[]` because a pattern
 * can repeat. None of ours do, so read them through here: one narrowing point
 * instead of a cast at every call site, and a clear 400 if one is ever repeated.
 */
export const param = (req: Request, name: string): string => {
  const value = req.params[name];

  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    throw new BadRequestError(`Route parameter "${name}" was supplied more than once`);
  }

  throw new BadRequestError(`Route parameter "${name}" is missing`);
};

/** Optional counterpart for handlers that fall back to a default. */
export const optionalParam = (req: Request, name: string): string | undefined => {
  const value = req.params[name];
  return typeof value === 'string' ? value : undefined;
};
