import rateLimit, { type Options } from 'express-rate-limit';
import { StatusCodes } from 'http-status-codes';
import { env } from '../config/env.js';

const base: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // A single test run would otherwise trip the login limiter.
  skip: () => env.isTest,
  handler: (_req, res) => {
    res.status(StatusCodes.TOO_MANY_REQUESTS).json({
      success: false,
      statusCode: StatusCodes.TOO_MANY_REQUESTS,
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again later.',
    });
  },
};

/**
 * Rate limiting protects production; in development it mostly blocks the
 * developer. A Postman collection run does a dozen logins in 30 seconds and
 * would trip a production-strength limiter every time. The mechanism stays
 * active either way so a 429 is still reachable — only the ceiling moves.
 */
const limitFor = (production: number, development: number): number =>
  env.isProduction ? production : development;

/** Broad backstop for the whole API surface. */
export const globalLimiter = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: limitFor(300, 3000),
});

/** Blueprint 6.3: credential endpoints are the ones worth brute-forcing. */
export const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: limitFor(10, 200),
});

/** Invite codes are guessable in principle — keep the guess rate low. */
export const inviteLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: limitFor(20, 200),
});

/** Month close is expensive and serializable; repeats are almost always accidental. */
export const monthCloseLimiter = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: limitFor(5, 60),
});
