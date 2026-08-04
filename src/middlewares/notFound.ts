import type { RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';

export const notFound: RequestHandler = (req, res) => {
  res.status(StatusCodes.NOT_FOUND).json({
    success: false,
    statusCode: StatusCodes.NOT_FOUND,
    code: 'ROUTE_NOT_FOUND',
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
};
