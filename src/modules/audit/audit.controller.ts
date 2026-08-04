import { catchAsync } from '../../shared/utils/catchAsync.js';
import { sendResponse } from '../../shared/utils/sendResponse.js';
import { auditService } from './audit.service.js';

const list = catchAsync(async (req, res) => {
  const { logs, meta } = await auditService.list(req.membership!.messId, req.query);
  sendResponse(res, { message: 'Audit logs retrieved successfully', data: logs, meta });
});

export const auditController = { list };
