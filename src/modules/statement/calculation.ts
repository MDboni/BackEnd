import { D, sum, toMoney, toRate, type Decimal, type DecimalInput } from '../../shared/utils/decimal.js';

/**
 * Blueprint 4.4, as a pure function. No Prisma, no dates, no I/O — the money
 * rules can be proven with unit tests before a database exists.
 */

export type MemberInput = {
  membershipId: string;
  name: string;
  /** Sum of breakfast+lunch+dinner+guest meals for the period. */
  mealUnits: DecimalInput;
  /** Shares of EQUAL and CUSTOM expenses already allocated to this member. */
  fixedShares: DecimalInput[];
  /** Shares of MEMBER_SPECIFIC expenses (personal purchases, fines). */
  personalShares: DecimalInput[];
  /** Carried forward from the previous closed month. */
  openingBalance: DecimalInput;
  /** Net of DEPOSIT + OPENING_BALANCE + ADJUSTMENT − REFUND. */
  deposits: DecimalInput;
};

export type CalculationInput = {
  /** Total of every non-voided MEAL_BASED expense in the period. */
  totalFoodExpense: DecimalInput;
  members: MemberInput[];
};

export type MemberStatement = {
  membershipId: string;
  name: string;
  mealUnits: Decimal;
  mealCost: Decimal;
  allocatedFixedCost: Decimal;
  personalCost: Decimal;
  grossCost: Decimal;
  openingBalance: Decimal;
  depositTotal: Decimal;
  closingBalance: Decimal;
};

export type CalculationResult = {
  totalMealUnits: Decimal;
  totalFoodExpense: Decimal;
  mealRate: Decimal;
  totalFixedCost: Decimal;
  totalPersonalCost: Decimal;
  totalGrossCost: Decimal;
  totalDeposits: Decimal;
  statements: MemberStatement[];
};

export class CalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalculationError';
  }
}

/**
 * Splits the food bill by meal units so the parts add up to the bill exactly.
 *
 * Rounding each member's `units × rate` independently leaves a residual of a
 * few paisa — over a year that is a real, visible discrepancy. The residual is
 * handed out one paisa at a time, largest eaters first, which is both stable
 * and the fairest reading of "who should absorb the rounding".
 */
const allocateByMealUnits = (
  totalFoodExpense: Decimal,
  totalMealUnits: Decimal,
  members: MemberInput[],
): Map<string, Decimal> => {
  const allocations = new Map<string, Decimal>();

  if (totalMealUnits.isZero() || totalFoodExpense.isZero()) {
    for (const member of members) allocations.set(member.membershipId, D(0));
    return allocations;
  }

  let distributed = D(0);
  for (const member of members) {
    const exact = totalFoodExpense.times(D(member.mealUnits)).dividedBy(totalMealUnits);
    const rounded = toMoney(exact);
    allocations.set(member.membershipId, rounded);
    distributed = distributed.plus(rounded);
  }

  const residual = totalFoodExpense.minus(distributed);
  if (residual.isZero()) return allocations;

  const paisa = D('0.01');
  const step = residual.isNegative() ? paisa.negated() : paisa;
  let remaining = residual.abs().dividedBy(paisa).round().toNumber();

  const ranked = [...members]
    .filter((member) => D(member.mealUnits).greaterThan(0))
    .sort((a, b) => D(b.mealUnits).comparedTo(D(a.mealUnits)));

  for (let i = 0; remaining > 0 && ranked.length > 0; i += 1, remaining -= 1) {
    const target = ranked[i % ranked.length]!;
    allocations.set(
      target.membershipId,
      (allocations.get(target.membershipId) ?? D(0)).plus(step),
    );
  }

  return allocations;
};

export const calculatePeriod = (input: CalculationInput): CalculationResult => {
  const totalFoodExpense = toMoney(input.totalFoodExpense);
  const totalMealUnits = sum(input.members.map((member) => D(member.mealUnits)));

  // Blueprint 4.4 zero-meal guard: dividing here would produce Infinity and
  // silently corrupt every statement in the month.
  if (totalMealUnits.isZero() && totalFoodExpense.greaterThan(0)) {
    throw new CalculationError(
      'There are food expenses but no meals recorded for this month. Add meal entries or reclassify the expense before closing.',
    );
  }

  if (input.members.some((member) => D(member.mealUnits).isNegative())) {
    throw new CalculationError('Meal units cannot be negative');
  }

  const mealRate = totalMealUnits.isZero()
    ? D(0)
    : toRate(totalFoodExpense.dividedBy(totalMealUnits));

  const mealCosts = allocateByMealUnits(totalFoodExpense, totalMealUnits, input.members);

  const statements = input.members.map<MemberStatement>((member) => {
    const mealCost = mealCosts.get(member.membershipId) ?? D(0);
    const allocatedFixedCost = toMoney(sum(member.fixedShares));
    const personalCost = toMoney(sum(member.personalShares));
    const grossCost = mealCost.plus(allocatedFixedCost).plus(personalCost);

    const openingBalance = toMoney(member.openingBalance);
    const depositTotal = toMoney(member.deposits);

    return {
      membershipId: member.membershipId,
      name: member.name,
      mealUnits: D(member.mealUnits),
      mealCost,
      allocatedFixedCost,
      personalCost,
      grossCost,
      openingBalance,
      depositTotal,
      // Positive => the mess owes the member; negative => the member owes.
      closingBalance: openingBalance.plus(depositTotal).minus(grossCost),
    };
  });

  return {
    totalMealUnits,
    totalFoodExpense,
    mealRate,
    totalFixedCost: sum(statements.map((statement) => statement.allocatedFixedCost)),
    totalPersonalCost: sum(statements.map((statement) => statement.personalCost)),
    totalGrossCost: sum(statements.map((statement) => statement.grossCost)),
    totalDeposits: sum(statements.map((statement) => statement.depositTotal)),
    statements,
  };
};

/**
 * Blueprint 8.2: the sum of what members were charged must equal what the mess
 * actually spent. Run before persisting statements — a mismatch means a bug in
 * allocation, not a rounding quirk to be shrugged off.
 */
export const reconcile = (
  result: CalculationResult,
  totalAllocatedExpense: DecimalInput,
): { balanced: boolean; difference: Decimal } => {
  const difference = result.totalGrossCost.minus(toMoney(totalAllocatedExpense));
  return { balanced: difference.isZero(), difference };
};
