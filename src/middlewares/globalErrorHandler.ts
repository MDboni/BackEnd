import type { ErrorRequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ZodError } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError, type ErrorDetail } from '../shared/errors/AppError.js';

type NormalizedError = {
  statusCode: number;
  code: string;
  message: string;
  details?: ErrorDetail[];
};

/** Blueprint B.5: known Prisma failures become predictable HTTP contracts. */
const fromPrisma = (error: Prisma.PrismaClientKnownRequestError): NormalizedError => {
  switch (error.code) {
    case 'P2002': {
      const target = error.meta?.['target'];
      const fields = Array.isArray(target) ? target.join(', ') : String(target ?? 'field');
      return {
        statusCode: StatusCodes.CONFLICT,
        code: 'DUPLICATE_RECORD',
        message: `A record with this ${fields} already exists`,
        details: [{ path: fields, message: 'Must be unique' }],
      };
    }
    case 'P2003':
      return {
        statusCode: StatusCodes.CONFLICT,
        code: 'FOREIGN_KEY_CONSTRAINT',
        message: 'Related record is missing or still referenced',
      };
    case 'P2025':
      return {
        statusCode: StatusCodes.NOT_FOUND,
        code: 'NOT_FOUND',
        message: 'Resource not found',
      };
    case 'P2034':
      // Serializable month-close lost a write race; the client may retry safely.
      return {
        statusCode: StatusCodes.CONFLICT,
        code: 'TRANSACTION_CONFLICT',
        message: 'The operation conflicted with a concurrent change. Please retry.',
      };
    default:
      return {
        statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
        code: `PRISMA_${error.code}`,
        message: 'Database request failed',
      };
  }
};

const normalize = (error: unknown): NormalizedError => {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: StatusCodes.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) return fromPrisma(error);

  if (error instanceof Prisma.PrismaClientValidationError) {
    return {
      statusCode: StatusCodes.BAD_REQUEST,
      code: 'INVALID_QUERY',
      message: 'Malformed database query',
    };
  }

  if (error instanceof SyntaxError && 'body' in error) {
    return {
      statusCode: StatusCodes.BAD_REQUEST,
      code: 'MALFORMED_JSON',
      message: 'Request body is not valid JSON',
    };
  }

  return {
    statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Something went wrong',
  };
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express identifies handlers by arity
export const globalErrorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const normalized = normalize(error);
  const requestId = req.requestId;

  const logPayload = {
    err: error,
    requestId,
    route: `${req.method} ${req.originalUrl}`,
    userId: req.user?.id,
    messId: req.membership?.messId,
    statusCode: normalized.statusCode,
  };

  if (normalized.statusCode >= 500) logger.error(logPayload, normalized.message);
  else logger.warn(logPayload, normalized.message);

  res.status(normalized.statusCode).json({
    success: false,
    statusCode: normalized.statusCode,
    code: normalized.code,
    message: normalized.message,
    ...(normalized.details ? { details: normalized.details } : {}),
    requestId,
    // Blueprint 6.3: stack traces never cross the wire in production.
    ...(env.isProduction ? {} : { stack: error instanceof Error ? error.stack : undefined }),
  });
};
