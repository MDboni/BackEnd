import {
  AllocationType,
  DepositType,
  ExpenseCategory,
  MembershipRole,
} from '../generated/prisma/enums.js';
import { prisma } from '../src/config/prisma.js';
import { hashPassword, sha256 } from '../src/shared/utils/password.js';
import { splitEvenly } from '../src/shared/utils/decimal.js';

/**
 * Seeds one realistic mess for a full month so the month-close flow can be
 * exercised end to end. Idempotent: re-running updates rather than duplicating.
 */

const PASSWORD = 'Messmate123';
const YEAR = 2026;
const MONTH = 7; // July 2026 — a completed month, ready to close.

const PEOPLE = [
  { name: 'Boni Amin Jayed', email: 'owner@messmate.test', role: MembershipRole.OWNER, room: 'A1' },
  { name: 'Rakib Hasan', email: 'manager@messmate.test', role: MembershipRole.MANAGER, room: 'A2' },
  { name: 'Nusrat Jahan', email: 'accountant@messmate.test', role: MembershipRole.ACCOUNTANT, room: 'B1' },
  { name: 'Karim Mia', email: 'cook@messmate.test', role: MembershipRole.COOK, room: null },
  { name: 'Tanvir Ahmed', email: 'member1@messmate.test', role: MembershipRole.MEMBER, room: 'B2' },
  { name: 'Sadia Islam', email: 'member2@messmate.test', role: MembershipRole.MEMBER, room: 'C1' },
];

/** Deterministic pseudo-random so a re-seed produces the same numbers. */
const pick = (seed: number, options: number[]): number =>
  options[Math.abs(Math.sin(seed) * 10_000) % options.length | 0] ?? 0;

const dateOf = (day: number) => new Date(Date.UTC(YEAR, MONTH - 1, day));

const main = async (): Promise<void> => {
  console.log('Seeding MessMate…');

  const passwordHash = await hashPassword(PASSWORD);

  const users = await Promise.all(
    PEOPLE.map((person) =>
      prisma.user.upsert({
        where: { email: person.email },
        // Password is reset on every seed too: the API test suite has a
        // change-password step, and a baseline that cannot restore the known
        // password is not a baseline.
        update: { name: person.name, passwordHash, isActive: true },
        create: { name: person.name, email: person.email, passwordHash },
        select: { id: true, email: true },
      }),
    ),
  );

  const mess = await prisma.mess.upsert({
    where: { slug: 'demo-mess' },
    update: {},
    create: {
      name: 'Shanti Mess',
      slug: 'demo-mess',
      address: 'House 12, Road 5, Dhanmondi, Dhaka',
      timezone: 'Asia/Dhaka',
      mealCutoffTime: '22:00',
      cutoffDaysAhead: 1,
    },
    select: { id: true },
  });

  const memberships = await Promise.all(
    PEOPLE.map((person, index) =>
      prisma.membership.upsert({
        where: { userId_messId: { userId: users[index]!.id, messId: mess.id } },
        update: { role: person.role, roomLabel: person.room },
        create: {
          userId: users[index]!.id,
          messId: mess.id,
          role: person.role,
          roomLabel: person.room,
        },
        select: { id: true, role: true },
      }),
    ),
  );

  /**
   * Reset every period of the demo mess back to OPEN and drop its statements.
   *
   * Without this, a single API-testing run leaves months CLOSED, and the next
   * run cannot write meals or expenses anywhere — re-seeding would "succeed"
   * while leaving the data unusable. A seed is only useful if it restores a
   * known baseline, not just if it inserts rows.
   */
  const closed = await prisma.messPeriod.findMany({
    where: { messId: mess.id, status: { not: 'OPEN' } },
    select: { id: true, year: true, month: true, status: true },
  });

  if (closed.length > 0) {
    const label = closed
      .map((p) => `${p.year}-${String(p.month).padStart(2, '0')}`)
      .join(', ');
    console.log(`Resetting ${closed.length} non-open period(s) to OPEN: ${label}`);

    await prisma.monthlyStatement.deleteMany({
      where: { periodId: { in: closed.map((p) => p.id) } },
    });
    await prisma.messPeriod.updateMany({
      where: { id: { in: closed.map((p) => p.id) } },
      data: { status: 'OPEN', calculationVersion: 1, closedAt: null, closedById: null, reopenReason: null },
    });
  }

  const period = await prisma.messPeriod.upsert({
    where: { messId_year_month: { messId: mess.id, year: YEAR, month: MONTH } },
    update: {},
    create: { messId: mess.id, year: YEAR, month: MONTH },
    select: { id: true, status: true },
  });

  // Cook does not eat on the mess account; everyone else does.
  const eaters = memberships.filter((member) => member.role !== MembershipRole.COOK);

  console.log(`Creating meal entries for ${eaters.length} members across 31 days…`);

  for (const [memberIndex, member] of eaters.entries()) {
    for (let day = 1; day <= 31; day += 1) {
      const seed = memberIndex * 100 + day;
      const breakfast = pick(seed, [0, 0, 1, 1]);
      const lunch = pick(seed + 1, [0, 1, 1, 1]);
      const dinner = pick(seed + 2, [1, 1, 1, 0.5]);
      const guestLunch = day % 13 === 0 ? 1 : 0;

      await prisma.mealEntry.upsert({
        where: { membershipId_date: { membershipId: member.id, date: dateOf(day) } },
        update: {},
        create: {
          messId: mess.id,
          periodId: period.id,
          membershipId: member.id,
          date: dateOf(day),
          breakfast,
          lunch,
          dinner,
          guestLunch,
        },
      });
    }
  }

  const ownerId = users[0]!.id;
  const existingExpenses = await prisma.expense.count({ where: { periodId: period.id } });

  if (existingExpenses === 0) {
    console.log('Creating expenses…');

    // Bazar: MEAL_BASED, so it flows into the meal rate.
    const bazarRuns = [
      { day: 2, amount: '7450.00', title: 'Weekly bazar - week 1' },
      { day: 9, amount: '8120.00', title: 'Weekly bazar - week 2' },
      { day: 16, amount: '7890.00', title: 'Weekly bazar - week 3' },
      { day: 23, amount: '8340.00', title: 'Weekly bazar - week 4' },
      { day: 30, amount: '4200.00', title: 'Bazar - month end' },
    ];

    for (const run of bazarRuns) {
      await prisma.expense.create({
        data: {
          messId: mess.id,
          periodId: period.id,
          title: run.title,
          category: ExpenseCategory.FOOD,
          allocationType: AllocationType.MEAL_BASED,
          amount: run.amount,
          expenseDate: dateOf(run.day),
          createdById: ownerId,
        },
      });
    }

    // Rent: CUSTOM, split by room rather than by meals.
    const rentShares = [
      { membershipId: memberships[0]!.id, amount: '3600.00' },
      { membershipId: memberships[1]!.id, amount: '3600.00' },
      { membershipId: memberships[2]!.id, amount: '3600.00' },
      { membershipId: memberships[3]!.id, amount: '0.00' },
      { membershipId: memberships[4]!.id, amount: '3600.00' },
      { membershipId: memberships[5]!.id, amount: '3600.00' },
    ];

    await prisma.expense.create({
      data: {
        messId: mess.id,
        periodId: period.id,
        title: 'Room rent - July',
        category: ExpenseCategory.RENT,
        allocationType: AllocationType.CUSTOM,
        amount: '18000.00',
        expenseDate: dateOf(1),
        createdById: ownerId,
        shares: { create: rentShares },
      },
    });

    // Utilities and the cook's salary: EQUAL across every member.
    const equalExpenses = [
      { title: 'Electricity bill', category: ExpenseCategory.ELECTRICITY, amount: '4200.00', day: 5 },
      { title: 'Gas bill', category: ExpenseCategory.GAS, amount: '1080.00', day: 5 },
      { title: 'Internet', category: ExpenseCategory.INTERNET, amount: '1200.00', day: 5 },
      { title: 'Cook salary - July', category: ExpenseCategory.CLEANER, amount: '6000.00', day: 31 },
    ];

    for (const expense of equalExpenses) {
      const parts = splitEvenly(expense.amount, memberships.length);
      await prisma.expense.create({
        data: {
          messId: mess.id,
          periodId: period.id,
          title: expense.title,
          category: expense.category,
          allocationType: AllocationType.EQUAL,
          amount: expense.amount,
          expenseDate: dateOf(expense.day),
          createdById: ownerId,
          shares: {
            create: memberships.map((member, index) => ({
              membershipId: member.id,
              amount: (parts[index] ?? 0).toString(),
            })),
          },
        },
      });
    }

    // A personal purchase charged to one member only.
    await prisma.expense.create({
      data: {
        messId: mess.id,
        periodId: period.id,
        title: 'Personal grocery - Tanvir',
        category: ExpenseCategory.PERSONAL,
        allocationType: AllocationType.MEMBER_SPECIFIC,
        amount: '650.00',
        expenseDate: dateOf(18),
        createdById: ownerId,
        shares: { create: [{ membershipId: memberships[4]!.id, amount: '650.00' }] },
      },
    });
  }

  const existingDeposits = await prisma.deposit.count({ where: { periodId: period.id } });

  if (existingDeposits === 0) {
    console.log('Creating deposits…');

    for (const [index, member] of memberships.entries()) {
      await prisma.deposit.create({
        data: {
          messId: mess.id,
          periodId: period.id,
          membershipId: member.id,
          type: DepositType.DEPOSIT,
          amount: index % 2 === 0 ? '9000.00' : '8000.00',
          transactionDate: dateOf(3),
          reference: `bKash-${1000 + index}`,
          createdById: ownerId,
        },
      });
    }
  }

  // One live invite code for testing the join flow.
  const inviteCode = 'DEMO2026';
  await prisma.invitation.upsert({
    where: { codeHash: sha256(inviteCode) },
    update: { expiresAt: new Date(Date.now() + 30 * 86_400_000), revokedAt: null },
    create: {
      messId: mess.id,
      codeHash: sha256(inviteCode),
      role: MembershipRole.MEMBER,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      maxUses: 20,
      createdById: ownerId,
    },
  });

  console.log('\nSeed complete.');
  console.log(`  Mess id      : ${mess.id}`);
  console.log(`  Period id    : ${period.id} (${YEAR}-${String(MONTH).padStart(2, '0')})`);
  console.log(`  Invite code  : ${inviteCode}`);
  console.log(`  Password     : ${PASSWORD}`);
  console.log('  Accounts     :');
  for (const person of PEOPLE) console.log(`    ${person.role.padEnd(11)} ${person.email}`);
};

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
