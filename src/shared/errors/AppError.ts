import { StatusCodes } from 'http-status-codes';

export type ErrorDetail = {
  path: string;
  message: string;
};

/**
 * Every deliberate failure carries the status, a stable machine code and
 * optional field details. The global handler never has to guess.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details: ErrorDetail[] | undefined;

  constructor(statusCode: number, code: string, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Malformed request', details?: ErrorDetail[]) {
    super(StatusCodes.BAD_REQUEST, 'BAD_REQUEST', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'You are not authenticated') {
    super(StatusCodes.UNAUTHORIZED, 'UNAUTHENTICATED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(StatusCodes.FORBIDDEN, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(StatusCodes.NOT_FOUND, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Request conflicts with the current state') {
    super(StatusCodes.CONFLICT, 'CONFLICT', message);
  }
}

/** 422 — the request was well-formed but breaks a business rule. */
export class ValidationError extends AppError {
  constructor(message = 'Business validation failed', details?: ErrorDetail[]) {
    super(StatusCodes.UNPROCESSABLE_ENTITY, 'BUSINESS_VALIDATION_FAILED', message, details);
  }
}
