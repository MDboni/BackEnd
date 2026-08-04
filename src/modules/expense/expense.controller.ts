import { StatusCodes } from 'http-status-codes';
import { auditContextFrom } from '../../shared/utils/audit.js';
import { catchAsync } from '../../shared/utils/catchAsync.js';
import { param } from '../../shared/utils/request.js';
import { sendResponse } from '../../shared/utils/sendResponse.js';
import { expenseService } from './expense.service.js';

const create = catchAsync(async (req, res) => {
  const expense = await expenseService.create(
    req.membership!.messId,
    req.user!.id,
    req.body,
    auditContextFrom(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Expense created successfully',
    data: expense,
  });
});

const list = catchAsync(async (req, res) => {
  const { expenses, totalAmount, meta } = await expenseService.list(
    req.membership!.messId,
    req.query,
  );

  sendResponse(res, {
    message: 'Expenses retrieved successfully',
    data: { expenses, totalAmount },
    meta,
  });
});

const getById = catchAsync(async (req, res) => {
  const expense = await expenseService.getById(req.membership!.messId, param(req, 'id'));
  sendResponse(res, { message: 'Expense retrieved successfully', data: expense });
});

const update = catchAsync(async (req, res) => {
  const expense = await expenseService.update(
    req.membership!.messId,
    param(req, 'id'),
    req.user!.id,
    req.body,
    auditContextFrom(req),
  );

  sendResponse(res, { message: 'Expense updated successfully', data: expense });
});

const voidExpense = catchAsync(async (req, res) => {
  const expense = await expenseService.voidExpense(
    req.membership!.messId,
    param(req, 'id'),
    (req.body as { reason: string }).reason,
    auditContextFrom(req),
  );

  sendResponse(res, { message: 'Expense voided successfully', data: expense });
});

const summary = catchAsync(async (req, res) => {
  const query = req.query as { periodId?: string };
  const data = await expenseService.summary(req.membership!.messId, query.periodId!);
  sendResponse(res, { message: 'Expense summary retrieved successfully', data });
});

const myAllocations = catchAsync(async (req, res) => {
  const query = req.query as { periodId?: string };
  const data = await expenseService.myAllocations(req.membership!.membershipId, query.periodId!);
  sendResponse(res, { message: 'Your expense allocations retrieved successfully', data });
});

export const expenseController = {
  create,
  list,
  getById,
  update,
  voidExpense,
  summary,
  myAllocations,
};
