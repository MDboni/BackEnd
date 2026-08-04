import type { RequestHandler } from 'express';
import { z, type ZodType } from 'zod';
import { BadRequestError } from '../shared/errors/AppError.js';

export type RequestSchemas = {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
};

/**
 * Blueprint 6.3: validated values replace the raw ones, so handlers receive
 * coerced types (numbers, dates) and unknown keys are already stripped.
 */
export const validateRequest =
  (schemas: RequestSchemas): RequestHandler =>
  (req, _res, next) => {
    const issues: z.core.$ZodIssue[] = [];

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) Object.assign(req.params, result.data);
      else issues.push(...result.error.issues.map((issue) => withPrefix(issue, 'params')));
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (result.success) {
        // Express 5 exposes `req.query` as a getter — mutate in place instead.
        Object.defineProperty(req, 'query', { value: result.data, writable: true });
      } else {
        issues.push(...result.error.issues.map((issue) => withPrefix(issue, 'query')));
      }
    }

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) req.body = result.data;
      else issues.push(...result.error.issues.map((issue) => withPrefix(issue, 'body')));
    }

    if (issues.length > 0) {
      next(
        new BadRequestError(
          'Request validation failed',
          issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        ),
      );
      return;
    }

    next();
  };

const withPrefix = (issue: z.core.$ZodIssue, prefix: string): z.core.$ZodIssue => ({
  ...issue,
  path: [prefix, ...issue.path],
});
