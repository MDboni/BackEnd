import { catchAsync } from '../../shared/utils/catchAsync.js';
import { optionalParam, param } from '../../shared/utils/request.js';
import { sendResponse } from '../../shared/utils/sendResponse.js';
import { statementService } from './statement.service.js';

const listByPeriod = catchAsync(async (req, res) => {
  const data = await statementService.listStatements(
    req.membership!.messId,
    param(req, 'periodId'),
  );
  sendResponse(res, { message: 'Statements retrieved successfully', data });
});

const myStatement = catchAsync(async (req, res) => {
  const data = await statementService.myStatement(
    req.membership!.messId,
    param(req, 'periodId'),
    req.membership!.membershipId,
  );
  sendResponse(res, { message: 'Your statement retrieved successfully', data });
});

const history = catchAsync(async (req, res) => {
  const data = await statementService.statementHistory(
    req.membership!.messId,
    optionalParam(req, 'membershipId') ?? req.membership!.membershipId,
  );
  sendResponse(res, { message: 'Statement history retrieved successfully', data });
});

export const statementController = { listByPeriod, myStatement, history };
