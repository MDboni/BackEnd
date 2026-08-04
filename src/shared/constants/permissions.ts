import { MembershipRole } from '../../../generated/prisma/enums.js';

/**
 * Blueprint 2.2, encoded once. Route guards reference a permission name, never
 * a role list — adding ACCOUNTANT to a feature is then a one-line change here.
 */
export const PERMISSIONS = {
  MESS_SETTINGS_UPDATE: 'mess:settings:update',
  MESS_DELETE: 'mess:delete',

  MEMBER_READ: 'member:read',
  MEMBER_INVITE: 'member:invite',
  MEMBER_STATUS_UPDATE: 'member:status:update',
  MEMBER_ROLE_UPDATE: 'member:role:update',

  MEAL_OVERRIDE: 'meal:override',
  MEAL_READ_ALL: 'meal:read:all',

  EXPENSE_WRITE: 'expense:write',
  EXPENSE_READ_ALL: 'expense:read:all',

  DEPOSIT_WRITE: 'deposit:write',
  DEPOSIT_READ_ALL: 'deposit:read:all',

  PERIOD_WRITE: 'period:write',
  PERIOD_PREVIEW: 'period:preview',
  PERIOD_CLOSE: 'period:close',
  PERIOD_REOPEN: 'period:reopen',

  STATEMENT_READ_ALL: 'statement:read:all',
  AUDIT_READ: 'audit:read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const OWNER_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

const MANAGER_PERMISSIONS: Permission[] = [
  PERMISSIONS.MESS_SETTINGS_UPDATE,
  PERMISSIONS.MEMBER_READ,
  PERMISSIONS.MEMBER_INVITE,
  PERMISSIONS.MEMBER_STATUS_UPDATE,
  PERMISSIONS.MEAL_OVERRIDE,
  PERMISSIONS.MEAL_READ_ALL,
  PERMISSIONS.EXPENSE_WRITE,
  PERMISSIONS.EXPENSE_READ_ALL,
  PERMISSIONS.DEPOSIT_WRITE,
  PERMISSIONS.DEPOSIT_READ_ALL,
  PERMISSIONS.PERIOD_WRITE,
  PERMISSIONS.PERIOD_PREVIEW,
  PERMISSIONS.PERIOD_CLOSE,
  PERMISSIONS.STATEMENT_READ_ALL,
  PERMISSIONS.AUDIT_READ,
];

const ACCOUNTANT_PERMISSIONS: Permission[] = [
  PERMISSIONS.MEMBER_READ,
  PERMISSIONS.MEAL_READ_ALL,
  PERMISSIONS.EXPENSE_WRITE,
  PERMISSIONS.EXPENSE_READ_ALL,
  PERMISSIONS.DEPOSIT_WRITE,
  PERMISSIONS.DEPOSIT_READ_ALL,
  PERMISSIONS.PERIOD_PREVIEW,
  PERMISSIONS.STATEMENT_READ_ALL,
  PERMISSIONS.AUDIT_READ,
];

/** Cook sees who is eating today and nothing financial. */
const COOK_PERMISSIONS: Permission[] = [PERMISSIONS.MEAL_READ_ALL];

const MEMBER_PERMISSIONS: Permission[] = [];

export const ROLE_PERMISSIONS: Record<MembershipRole, Permission[]> = {
  [MembershipRole.OWNER]: OWNER_PERMISSIONS,
  [MembershipRole.MANAGER]: MANAGER_PERMISSIONS,
  [MembershipRole.ACCOUNTANT]: ACCOUNTANT_PERMISSIONS,
  [MembershipRole.COOK]: COOK_PERMISSIONS,
  [MembershipRole.MEMBER]: MEMBER_PERMISSIONS,
};

export const hasPermission = (role: MembershipRole, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].includes(permission);

/** Ownership transfer and reopen are OWNER-only regardless of permission grants. */
export const isOwner = (role: MembershipRole): boolean => role === MembershipRole.OWNER;
