import { StatusCodes } from 'http-status-codes';
import { auditContextFrom } from '../../shared/utils/audit.js';
import { catchAsync } from '../../shared/utils/catchAsync.js';
import { param } from '../../shared/utils/request.js';
import { sendResponse } from '../../shared/utils/sendResponse.js';
import { depositService } from './deposit.service.js';

const create = catchAsync(async (req, res) => {
  const deposit = await depositService.create(
    req.membership!.messId,
    req.user!.id,
    req.body,
    auditContextFrom(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Deposit recorded successfully',
    data: deposit,
  });
});

const list = catchAsync(async (req, res) => {
  const { deposits, totalAmount, meta } = await depositService.list(
    req.membership!.messId,
    req.query,
  );

  sendResponse(res, {
    message: 'Deposits retrieved successfully',
    data: { deposits, totalAmount },
    meta,
  });
});

const getById = catchAsync(async (req, res) => {
  const deposit = await depositService.getById(req.membership!.messId, param(req, 'id'));
  sendResponse(res, { message: 'Deposit retrieved successfully', data: deposit });
});

const update = catchAsync(async (req, res) => {
  const deposit = await depositService.update(
    req.membership!.messId,
    param(req, 'id'),
    req.body,
    auditContextFrom(req),
  );

  sendResponse(res, { message: 'Deposit updated successfully', data: deposit });
});

const voidDeposit = catchAsync(async (req, res) => {
  const deposit = await depositService.voidDeposit(
    req.membership!.messId,
    param(req, 'id'),
    (req.body as { reason: string }).reason,
    auditContextFrom(req),
  );

  sendResponse(res, { message: 'Deposit voided successfully', data: deposit });
});

const myDeposits = catchAsync(async (req, res) => {
  const query = req.query as { periodId?: string };
  const data = await depositService.myDeposits(req.membership!.membershipId, query.periodId);
  sendResponse(res, { message: 'Your deposits retrieved successfully', data });
});

export const depositController = { create, list, getById, update, voidDeposit, myDeposits };
