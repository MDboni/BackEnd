import type { Request } from 'express';
import type { Db } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import type { AuditAction, AuditEntity } from '../constants/audit.js';

export type AuditContext = {
  actorUserId: string | null;
  messId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
};

export type AuditInput = {
  action: AuditAction;
  entityType: AuditEntity;
  entityId?: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
};

export const auditContextFrom = (req: Request, messId?: string | null): AuditContext => ({
  actorUserId: req.user?.id ?? null,
  messId: messId ?? req.membership?.messId ?? null,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'tokenHash',
  'codeHash',
  'accessToken',
  'refreshToken',
]);

/**
 * Snapshots go into the log verbatim, so strip credentials before they land in
 * a table that ACCOUNTANT can read.
 */
const sanitize = (value: unknown): unknown => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === 'object') {
    // Decimal and Date must survive as scalars, not be walked as objects.
    if (value instanceof Date) return value.toISOString();
    if (typeof (value as { toFixed?: unknown }).toFixed === 'function') return String(value);

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_KEYS.has(key))
        .map(([key, entry]) => [key, sanitize(entry)]),
    );
  }
  return value;
};

/**
 * Writes on the caller's transaction client when given one, so an audit row can
 * never outlive a rolled-back mutation.
 */
export const writeAudit = async (
  db: Db,
  context: AuditContext,
  input: AuditInput,
): Promise<void> => {
  try {
    await db.auditLog.create({
      data: {
        actorUserId: context.actorUserId,
        messId: context.messId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        reason: input.reason ?? null,
        before: sanitize(input.before) as never,
        after: sanitize(input.after) as never,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
  } catch (error) {
    // A failed audit write must not roll back a legitimate business mutation,
    // but it is an operational alarm.
    logger.error({ err: error, action: input.action }, 'Failed to write audit log');
  }
};
