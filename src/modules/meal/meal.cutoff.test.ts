import { describe, expect, it } from 'vitest';
import { evaluateCutoff, type CutoffSettings } from './meal.cutoff.js';

const settings: CutoffSettings = {
  timezone: 'Asia/Dhaka', // UTC+6, no DST
  mealCutoffTime: '22:00',
  cutoffDaysAhead: 1,
};

/** 2026-08-03 16:00 UTC = 2026-08-03 22:00 in Dhaka — exactly at the cutoff. */
const atCutoff = new Date('2026-08-03T16:00:00.000Z');
/** 2026-08-03 12:00 UTC = 18:00 Dhaka — before the cutoff. */
const beforeCutoff = new Date('2026-08-03T12:00:00.000Z');

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('evaluateCutoff', () => {
  it('allows editing tomorrow within the allowed window', () => {
    const decision = evaluateCutoff(date('2026-08-04'), settings, beforeCutoff);
    expect(decision.allowed).toBe(true);
  });

  it('allows editing today before the cutoff time', () => {
    const decision = evaluateCutoff(date('2026-08-03'), settings, beforeCutoff);
    expect(decision.allowed).toBe(true);
  });

  it("blocks today's meal once the cutoff moment is reached", () => {
    const decision = evaluateCutoff(date('2026-08-03'), settings, atCutoff);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('22:00');
  });

  it('still allows tomorrow after tonight\'s cutoff has passed', () => {
    // The cutoff closes today only; tomorrow stays open until it becomes today.
    const decision = evaluateCutoff(date('2026-08-04'), settings, atCutoff);
    expect(decision.allowed).toBe(true);
  });

  it('blocks past dates for members', () => {
    const decision = evaluateCutoff(date('2026-08-02'), settings, beforeCutoff);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('past');
  });

  it('blocks dates beyond the allowed look-ahead window', () => {
    const decision = evaluateCutoff(date('2026-08-05'), settings, beforeCutoff);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('1 day');
  });

  it('honours a wider look-ahead window when the mess allows it', () => {
    const decision = evaluateCutoff(
      date('2026-08-06'),
      { ...settings, cutoffDaysAhead: 3 },
      beforeCutoff,
    );
    expect(decision.allowed).toBe(true);
  });

  it('uses the mess timezone, not the server clock', () => {
    // 2026-08-03 19:00 UTC is still 03 Aug in UTC but already 04 Aug in Dhaka,
    // so "today" for the mess has moved on and 03 Aug is now in the past.
    const lateUtc = new Date('2026-08-03T19:00:00.000Z');
    expect(evaluateCutoff(date('2026-08-03'), settings, lateUtc).allowed).toBe(false);
    expect(evaluateCutoff(date('2026-08-04'), settings, lateUtc).allowed).toBe(true);
  });
});
