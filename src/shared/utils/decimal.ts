import { Prisma } from '../../../generated/prisma/client.js';

export type Decimal = Prisma.Decimal;
export type DecimalInput = Prisma.Decimal | string | number;

export const D = (value: DecimalInput = 0): Decimal => new Prisma.Decimal(value);

export const ZERO: Decimal = D(0);

export const sum = (values: DecimalInput[]): Decimal =>
  values.reduce<Decimal>((acc, value) => acc.plus(D(value)), D(0));

/**
 * Blueprint 3.3: money is never a Float. Rounding happens once, at the point a
 * value is persisted or shown — ROUND_HALF_UP matches how people count taka.
 */
export const round = (value: DecimalInput, scale = 2): Decimal =>
  D(value).toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);

export const toMoney = (value: DecimalInput): Decimal => round(value, 2);

/** Meal rate keeps 4 places so a long month does not drift by taka. */
export const toRate = (value: DecimalInput): Decimal => round(value, 4);

export const isZero = (value: DecimalInput): boolean => D(value).isZero();

export const isNegative = (value: DecimalInput): boolean => D(value).isNegative();

/** JSON has no decimal type — serialise as a string so precision survives. */
export const toFixedString = (value: DecimalInput, scale = 2): string =>
  round(value, scale).toFixed(scale);

/**
 * Splits an amount into `count` shares that add up to exactly the original.
 * Plain division loses paisa; the remainder is handed out one unit at a time
 * to the earliest shares so `sum(shares) === amount` always holds.
 */
export const splitEvenly = (amount: DecimalInput, count: number, scale = 2): Decimal[] => {
  if (count <= 0) return [];

  const total = round(amount, scale);
  const unit = D(1).dividedBy(D(10).pow(scale));
  const base = total.dividedBy(count).toDecimalPlaces(scale, Prisma.Decimal.ROUND_DOWN);

  const shares = Array.from({ length: count }, () => base);
  const distributed = base.times(count);
  let remainderUnits = total.minus(distributed).dividedBy(unit).round().toNumber();

  for (let i = 0; remainderUnits > 0 && i < count; i += 1, remainderUnits -= 1) {
    shares[i] = D(shares[i] ?? 0).plus(unit);
  }

  return shares;
};
