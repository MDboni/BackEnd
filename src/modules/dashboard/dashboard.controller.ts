import { catchAsync } from '../../shared/utils/catchAsync.js';
import { sendResponse } from '../../shared/utils/sendResponse.js';
import { dashboardService } from './dashboard.service.js';

const member = catchAsync(async (req, res) => {
  const data = await dashboardService.memberDashboard(
    req.membership!.messId,
    req.membership!.membershipId,
    req.membership!.timezone,
  );
  sendResponse(res, { message: 'Member dashboard retrieved successfully', data });
});

const manager = catchAsync(async (req, res) => {
  const data = await dashboardService.managerDashboard(
    req.membership!.messId,
    req.membership!.timezone,
  );
  sendResponse(res, { message: 'Manager dashboard retrieved successfully', data });
});

const cook = catchAsync(async (req, res) => {
  const query = req.query as { date?: string };
  const data = await dashboardService.cookDashboard(
    req.membership!.messId,
    req.membership!.timezone,
    query.date,
  );
  sendResponse(res, { message: 'Cook dashboard retrieved successfully', data });
});

export const dashboardController = { member, manager, cook };
