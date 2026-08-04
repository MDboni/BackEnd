import { StatusCodes } from 'http-status-codes';
import { auditContextFrom } from '../../shared/utils/audit.js';
import { catchAsync } from '../../shared/utils/catchAsync.js';
import { param } from '../../shared/utils/request.js';
import { sendResponse } from '../../shared/utils/sendResponse.js';
import { membershipService } from './membership.service.js';

const createInvitation = catchAsync(async (req, res) => {
  const invitation = await membershipService.createInvitation(
    req.membership!.messId,
    req.user!.id,
    req.body,
    auditContextFrom(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Invitation created successfully',
    data: invitation,
  });
});

const listInvitations = catchAsync(async (req, res) => {
  const invitations = await membershipService.listInvitations(req.membership!.messId);
  sendResponse(res, { message: 'Invitations retrieved successfully', data: invitations });
});

const revokeInvitation = catchAsync(async (req, res) => {
  await membershipService.revokeInvitation(
    req.membership!.messId,
    param(req, 'id'),
    auditContextFrom(req),
  );
  sendResponse(res, { message: 'Invitation revoked successfully', data: null });
});

const previewInvitation = catchAsync(async (req, res) => {
  const preview = await membershipService.previewInvitation(param(req, 'code'));
  sendResponse(res, { message: 'Invitation retrieved successfully', data: preview });
});

const join = catchAsync(async (req, res) => {
  const result = await membershipService.joinByCode(
    req.user!.id,
    param(req, 'code'),
    req.body,
    auditContextFrom(req, null),
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: `You have joined ${result.messName}`,
    data: result.membership,
  });
});

const listMembers = catchAsync(async (req, res) => {
  const { members, meta } = await membershipService.listMembers(req.membership!.messId, req.query);
  sendResponse(res, { message: 'Members retrieved successfully', data: members, meta });
});

const updateRole = catchAsync(async (req, res) => {
  const member = await membershipService.updateRole(
    req.membership!.messId,
    param(req, 'id'),
    req.body,
    auditContextFrom(req),
  );
  sendResponse(res, { message: 'Member role updated successfully', data: member });
});

const updateStatus = catchAsync(async (req, res) => {
  const member = await membershipService.updateStatus(
    req.membership!.messId,
    param(req, 'id'),
    req.body,
    auditContextFrom(req),
  );
  sendResponse(res, { message: 'Member status updated successfully', data: member });
});

const transferOwnership = catchAsync(async (req, res) => {
  const owner = await membershipService.transferOwnership(
    req.membership!.messId,
    req.membership!.membershipId,
    req.body,
    auditContextFrom(req),
  );
  sendResponse(res, { message: 'Ownership transferred successfully', data: owner });
});

export const membershipController = {
  createInvitation,
  listInvitations,
  revokeInvitation,
  previewInvitation,
  join,
  listMembers,
  updateRole,
  updateStatus,
  transferOwnership,
};
