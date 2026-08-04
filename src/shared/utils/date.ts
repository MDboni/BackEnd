import { BadRequestError } from '../errors/AppError.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Meal dates are calendar days, not instants. Everything is normalised to UTC
 * midnight so `@db.Date` round-trips identically regardless of server timezone.
 */
export const toDateOnly = (value: string | Date): Date => {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  if (!DATE_ONLY.test(value)) {
    throw new BadRequestError(`Invalid date "${value}". Expected format YYYY-MM-DD`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestError(`Invalid date "${value}"`);
  }
  return parsed;
};

export const formatDateOnly = (value: Date): string => value.toISOString().slice(0, 10);

export const yearMonthOf = (date: Date): { year: number; month: number } => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
});

export const startOfMonth = (year: number, month: number): Date =>
  new Date(Date.UTC(year, month - 1, 1));

/** Exclusive upper bound — safe for `lt` range filters. */
export const startOfNextMonth = (year: number, month: number): Date =>
  new Date(Date.UTC(year, month, 1));

export const addDays = (date: Date, days: number): Date => {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

/**
 * Reads the wall-clock time in an IANA timezone. The cutoff rule is about the
 * member's local night, so comparing raw UTC would lock people out early.
 */
export const zonedParts = (
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const parts = formatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type)?.value ?? '0';
    return Number.parseInt(found, 10);
  };

  // Intl renders midnight as hour 24 in some ICU versions.
  const hour = read('hour') % 24;

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
  };
};

/** Today's calendar date in the mess timezone, as a UTC-midnight Date. */
export const zonedToday = (timeZone: string, now: Date = new Date()): Date => {
  const { year, month, day } = zonedParts(now, timeZone);
  return new Date(Date.UTC(year, month - 1, day));
};

export const parseTimeOfDay = (value: string): { hour: number; minute: number } => {
  const match = TIME_OF_DAY.exec(value);
  if (!match) {
    throw new BadRequestError(`Invalid cutoff time "${value}". Expected HH:mm (24-hour)`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
};

export const daysBetween = (from: Date, to: Date): number =>
  Math.round((to.getTime() - from.getTime()) / 86_400_000);
