import { StatusCodes } from 'http-status-codes';
import { auditContextFrom } from '../../shared/utils/audit.js';
import { catchAsync } from '../../shared/utils/catchAsync.js';
import { sendResponse } from '../../shared/utils/sendResponse.js';
import { messService } from './mess.service.js';

const create = catchAsync(async (req, res) => {
  const mess = await messService.create(req.user!.id, req.body, auditContextFrom(req, null));

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Mess created successfully',
    data: mess,
  });
});

const listMine = catchAsync(async (req, res) => {
  const messes = await messService.listMine(req.user!.id);
  sendResponse(res, { message: 'Mess list retrieved successfully', data: messes });
});

const getById = catchAsync(async (req, res) => {
  const mess = await messService.getById(req.membership!.messId);
  sendResponse(res, { message: 'Mess retrieved successfully', data: mess });
});

const update = catchAsync(async (req, res) => {
  const mess = await messService.update(req.membership!.messId, req.body, auditContextFrom(req));
  sendResponse(res, { message: 'Mess settings updated successfully', data: mess });
});

export const messController = { create, listMine, getById, update };
