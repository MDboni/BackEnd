import { describe, expect, it } from 'vitest';
import { D, splitEvenly, sum } from '../../shared/utils/decimal.js';
import { calculatePeriod, CalculationError, reconcile, type MemberInput } from './calculation.js';

const member = (overrides: Partial<MemberInput> & { membershipId: string }): MemberInput => ({
  name: overrides.membershipId,
  mealUnits: 0,
  fixedShares: [],
  personalShares: [],
  openingBalance: 0,
  deposits: 0,
  ...overrides,
});

describe('calculatePeriod', () => {
  it('derives the meal rate from food expense and total meal units (blueprint 8.2)', () => {
    const result = calculatePeriod({
      totalFoodExpense: '30000',
      members: [
        member({ membershipId: 'a', mealUnits: 300 }),
        member({ membershipId: 'b', mealUnits: 300 }),
      ],
    });

    expect(result.totalMealUnits.toFixed(2)).toBe('600.00');
    expect(result.mealRate.toFixed(2)).toBe('50.00');
    expect(result.statements[0]?.mealCost.toFixed(2)).toBe('15000.00');
    expect(result.statements[1]?.mealCost.toFixed(2)).toBe('15000.00');
  });

  it('handles fractional and guest meals exactly', () => {
    const result = calculatePeriod({
      totalFoodExpense: '1000',
      members: [
        member({ membershipId: 'a', mealUnits: '15.5' }),
        member({ membershipId: 'b', mealUnits: '9.5' }),
      ],
    });

    expect(result.totalMealUnits.toFixed(2)).toBe('25.00');
    expect(result.mealRate.toFixed(4)).toBe('40.0000');
    expect(result.statements[0]?.mealCost.toFixed(2)).toBe('620.00');
    expect(result.statements[1]?.mealCost.toFixed(2)).toBe('380.00');
  });

  it('allocates every paisa of the food bill even when the rate does not divide evenly', () => {
    // 100 / 3 members = 33.333... — naive rounding would lose or invent a paisa.
    const result = calculatePeriod({
      totalFoodExpense: '100',
      members: [
        member({ membershipId: 'a', mealUnits: 1 }),
        member({ membershipId: 'b', mealUnits: 1 }),
        member({ membershipId: 'c', mealUnits: 1 }),
      ],
    });

    const allocated = sum(result.statements.map((statement) => statement.mealCost));
    expect(allocated.toFixed(2)).toBe('100.00');
  });

  it('keeps fixed and personal costs out of the meal rate (blueprint 1.3)', () => {
    const result = calculatePeriod({
      totalFoodExpense: '6000',
      members: [
        member({ membershipId: 'a', mealUnits: 100, fixedShares: ['3000'], personalShares: ['250'] }),
        member({ membershipId: 'b', mealUnits: 100, fixedShares: ['3000'] }),
      ],
    });

    // Rent did not inflate the rate: 6000 / 200 units = 30.
    expect(result.mealRate.toFixed(2)).toBe('30.00');
    expect(result.statements[0]?.mealCost.toFixed(2)).toBe('3000.00');
    expect(result.statements[0]?.allocatedFixedCost.toFixed(2)).toBe('3000.00');
    expect(result.statements[0]?.personalCost.toFixed(2)).toBe('250.00');
    expect(result.statements[0]?.grossCost.toFixed(2)).toBe('6250.00');
  });

  it('computes balance as opening + deposits - gross', () => {
    const result = calculatePeriod({
      totalFoodExpense: '1000',
      members: [
        member({ membershipId: 'a', mealUnits: 10, openingBalance: '200', deposits: '1500' }),
      ],
    });

    // 200 + 1500 - 1000 = 700 advance.
    expect(result.statements[0]?.closingBalance.toFixed(2)).toBe('700.00');
  });

  it('reports a due as a negative balance', () => {
    const result = calculatePeriod({
      totalFoodExpense: '1000',
      members: [member({ membershipId: 'a', mealUnits: 10, deposits: '400' })],
    });

    expect(result.statements[0]?.closingBalance.toFixed(2)).toBe('-600.00');
  });

  it('carries a previous closing balance forward as the opening balance', () => {
    const result = calculatePeriod({
      totalFoodExpense: '500',
      members: [member({ membershipId: 'a', mealUnits: 10, openingBalance: '-150', deposits: '0' })],
    });

    expect(result.statements[0]?.closingBalance.toFixed(2)).toBe('-650.00');
  });

  it('refuses to divide by zero when food was bought but no meals were recorded', () => {
    expect(() =>
      calculatePeriod({
        totalFoodExpense: '5000',
        members: [member({ membershipId: 'a', mealUnits: 0 })],
      }),
    ).toThrow(CalculationError);
  });

  it('allows a month with no meals and no food expense', () => {
    const result = calculatePeriod({
      totalFoodExpense: '0',
      members: [member({ membershipId: 'a', mealUnits: 0, fixedShares: ['1200'] })],
    });

    expect(result.mealRate.toFixed(2)).toBe('0.00');
    expect(result.statements[0]?.grossCost.toFixed(2)).toBe('1200.00');
  });

  it('rejects negative meal units', () => {
    expect(() =>
      calculatePeriod({
        totalFoodExpense: '100',
        members: [member({ membershipId: 'a', mealUnits: '-5' })],
      }),
    ).toThrow(CalculationError);
  });

  it('charges nothing for meals to a member who ate nothing', () => {
    const result = calculatePeriod({
      totalFoodExpense: '900',
      members: [
        member({ membershipId: 'a', mealUnits: 30 }),
        member({ membershipId: 'b', mealUnits: 0, fixedShares: ['500'] }),
      ],
    });

    expect(result.statements[1]?.mealCost.toFixed(2)).toBe('0.00');
    expect(result.statements[1]?.grossCost.toFixed(2)).toBe('500.00');
  });
});

describe('reconcile', () => {
  it('balances when member charges equal total expenses', () => {
    const result = calculatePeriod({
      totalFoodExpense: '7000',
      members: [
        member({ membershipId: 'a', mealUnits: 61, fixedShares: ['1500'] }),
        member({ membershipId: 'b', mealUnits: 44, fixedShares: ['1500'] }),
        member({ membershipId: 'c', mealUnits: 37, fixedShares: ['1500'] }),
      ],
    });

    const check = reconcile(result, D('7000').plus(D('4500')));
    expect(check.balanced).toBe(true);
    expect(check.difference.toFixed(2)).toBe('0.00');
  });

  it('flags a mismatch instead of absorbing it', () => {
    const result = calculatePeriod({
      totalFoodExpense: '1000',
      members: [member({ membershipId: 'a', mealUnits: 10 })],
    });

    const check = reconcile(result, '1200');
    expect(check.balanced).toBe(false);
    expect(check.difference.toFixed(2)).toBe('-200.00');
  });
});

describe('splitEvenly', () => {
  it('splits an indivisible amount without losing a paisa', () => {
    const parts = splitEvenly('100', 3);
    expect(parts.map((part) => part.toFixed(2))).toEqual(['33.34', '33.33', '33.33']);
    expect(sum(parts).toFixed(2)).toBe('100.00');
  });

  it('splits evenly when it divides cleanly', () => {
    const parts = splitEvenly('1200', 4);
    expect(parts.map((part) => part.toFixed(2))).toEqual([
      '300.00',
      '300.00',
      '300.00',
      '300.00',
    ]);
  });

  it('returns nothing for zero members rather than dividing by zero', () => {
    expect(splitEvenly('500', 0)).toEqual([]);
  });

  it('keeps the total exact across many members', () => {
    const parts = splitEvenly('1000', 7);
    expect(sum(parts).toFixed(2)).toBe('1000.00');
  });
});
