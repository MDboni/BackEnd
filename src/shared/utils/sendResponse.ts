import type { Response } from 'express';
import { StatusCodes } from 'http-status-codes';

export type ResponseMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type SuccessPayload<T> = {
  statusCode?: number;
  message: string;
  data: T;
  meta?: ResponseMeta;
};

/** Blueprint 5.1: every success body is `{ success, message, data, meta }`. */
export const sendResponse = <T>(res: Response, payload: SuccessPayload<T>): void => {
  const statusCode = payload.statusCode ?? StatusCodes.OK;

  res.status(statusCode).json({
    success: true,
    statusCode,
    message: payload.message,
    data: payload.data,
    ...(payload.meta ? { meta: payload.meta } : {}),
  });
};
