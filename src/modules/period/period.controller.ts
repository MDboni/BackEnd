import { StatusCodes } from 'http-status-codes';
import { auditContextFrom } from '../../shared/utils/audit.js';
import { catchAsync } from '../../shared/utils/catchAsync.js';
import { param } from '../../shared/utils/request.js';
import { sendResponse } from '../../shared/utils/sendResponse.js';
import { statementService } from '../statement/statement.service.js';
import { periodService } from './period.service.js';

const create = catchAsync(async (req, res) => {
  const period = await periodService.create(
    req.membership!.messId,
    req.body,
    auditContextFrom(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Period created successfully',
    data: period,
  });
});

const list = catchAsync(async (req, res) => {
  const { periods, meta } = await periodService.list(req.membership!.messId, req.query);
  sendResponse(res, { message: 'Periods retrieved successfully', data: periods, meta });
});

const getCurrent = catchAsync(async (req, res) => {
  const period = await periodService.getCurrent(
    req.membership!.messId,
    req.membership!.timezone,
  );
  sendResponse(res, { message: 'Current period retrieved successfully', data: period });
});

const getById = catchAsync(async (req, res) => {
  const period = await periodService.getById(req.membership!.messId, param(req, 'periodId'));
  sendResponse(res, { message: 'Period retrieved successfully', data: period });
});

const preview = catchAsync(async (req, res) => {
  const preview = await statementService.preview(
    req.membership!.messId,
    param(req, 'periodId'),
  );
  sendResponse(res, { message: 'Month close preview generated', data: preview });
});

const close = catchAsync(async (req, res) => {
  const result = await statementService.closePeriod(
    req.membership!.messId,
    param(req, 'periodId'),
    req.user!.id,
    auditContextFrom(req),
  );

  sendResponse(res, { message: 'Month closed successfully', data: result });
});

const reopen = catchAsync(async (req, res) => {
  const period = await statementService.reopenPeriod(
    req.membership!.messId,
    param(req, 'periodId'),
    (req.body as { reason: string }).reason,
    auditContextFrom(req),
  );

  sendResponse(res, { message: 'Month reopened successfully', data: period });
});

export const periodController = { create, list, getCurrent, getById, preview, close, reopen };
