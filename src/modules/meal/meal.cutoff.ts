import { ForbiddenError } from '../../shared/errors/AppError.js';
import { daysBetween, formatDateOnly, parseTimeOfDay, zonedParts, zonedToday } from '../../shared/utils/date.js';

export type CutoffSettings = {
  timezone: string;
  mealCutoffTime: string;
  cutoffDaysAhead: number;
};

export type CutoffDecision = {
  allowed: boolean;
  reason: string | null;
  /** Latest moment a member may still edit this date, for the UI banner. */
  cutoffAt: Date | null;
};

/**
 * Blueprint 4.2. The rule in one line: a member may edit today+1 .. today+N,
 * and today itself only until the cutoff hour has passed in the mess timezone.
 * Past dates are always closed to members — a manager override is required.
 */
export const evaluateCutoff = (
  targetDate: Date,
  settings: CutoffSettings,
  now: Date = new Date(),
): CutoffDecision => {
  const today = zonedToday(settings.timezone, now);
  const offset = daysBetween(today, targetDate);

  if (offset < 0) {
    return {
      allowed: false,
      reason: `${formatDateOnly(targetDate)} is in the past. Ask a manager to override it.`,
      cutoffAt: null,
    };
  }

  if (offset > settings.cutoffDaysAhead) {
    return {
      allowed: false,
      reason: `You can only set meals up to ${settings.cutoffDaysAhead} day(s) ahead.`,
      cutoffAt: null,
    };
  }

  if (offset > 0) {
    // A future date within the window is always editable until it becomes today.
    return { allowed: true, reason: null, cutoffAt: null };
  }

  const cutoff = parseTimeOfDay(settings.mealCutoffTime);
  const local = zonedParts(now, settings.timezone);
  const passed =
    local.hour > cutoff.hour || (local.hour === cutoff.hour && local.minute >= cutoff.minute);

  if (passed) {
    return {
      allowed: false,
      reason: `Today's cutoff (${settings.mealCutoffTime}) has passed. Ask a manager to override it.`,
      cutoffAt: null,
    };
  }

  return { allowed: true, reason: null, cutoffAt: null };
};

export const assertCutoff = (
  targetDate: Date,
  settings: CutoffSettings,
  now: Date = new Date(),
): void => {
  const decision = evaluateCutoff(targetDate, settings, now);
  if (!decision.allowed) throw new ForbiddenError(decision.reason ?? 'Meal editing is closed');
};
