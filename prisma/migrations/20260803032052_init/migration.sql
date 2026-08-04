-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'MANAGER', 'ACCOUNTANT', 'COOK', 'MEMBER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'INACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'CALCULATING', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('FOOD', 'RENT', 'ELECTRICITY', 'GAS', 'WATER', 'INTERNET', 'CLEANER', 'MAINTENANCE', 'PERSONAL', 'OTHER');

-- CreateEnum
CREATE TYPE "AllocationType" AS ENUM ('MEAL_BASED', 'EQUAL', 'CUSTOM', 'MEMBER_SPECIFIC');

-- CreateEnum
CREATE TYPE "DepositType" AS ENUM ('DEPOSIT', 'REFUND', 'ADJUSTMENT', 'OPENING_BALANCE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mess" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dhaka',
    "mealCutoffTime" TEXT NOT NULL DEFAULT '22:00',
    "cutoffDaysAhead" INTEGER NOT NULL DEFAULT 1,
    "roundingScale" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Mess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'MEMBER',
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "roomLabel" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessPeriod" (
    "id" TEXT NOT NULL,
    "messId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "calculationVersion" INTEGER NOT NULL DEFAULT 1,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealEntry" (
    "id" TEXT NOT NULL,
    "messId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "breakfast" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "lunch" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "dinner" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "guestBreakfast" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "guestLunch" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "guestDinner" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "overrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MealEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "messId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "ExpenseCategory" NOT NULL,
    "allocationType" "AllocationType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "expenseDate" DATE NOT NULL,
    "paidByMemberId" TEXT,
    "receiptUrl" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseShare" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "ExpenseShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL,
    "messId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "type" "DepositType" NOT NULL DEFAULT 'DEPOSIT',
    "amount" DECIMAL(14,2) NOT NULL,
    "transactionDate" DATE NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyStatement" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "calculationVersion" INTEGER NOT NULL,
    "totalMealUnits" DECIMAL(12,2) NOT NULL,
    "mealRate" DECIMAL(14,4) NOT NULL,
    "mealCost" DECIMAL(14,2) NOT NULL,
    "allocatedFixedCost" DECIMAL(14,2) NOT NULL,
    "personalCost" DECIMAL(14,2) NOT NULL,
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "depositTotal" DECIMAL(14,2) NOT NULL,
    "grossCost" DECIMAL(14,2) NOT NULL,
    "closingBalance" DECIMAL(14,2) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "messId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'MEMBER',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "messId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Mess_slug_key" ON "Mess"("slug");

-- CreateIndex
CREATE INDEX "Mess_deletedAt_idx" ON "Mess"("deletedAt");

-- CreateIndex
CREATE INDEX "Membership_messId_status_idx" ON "Membership"("messId", "status");

-- CreateIndex
CREATE INDEX "Membership_userId_status_idx" ON "Membership"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_messId_key" ON "Membership"("userId", "messId");

-- CreateIndex
CREATE INDEX "MessPeriod_messId_status_idx" ON "MessPeriod"("messId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MessPeriod_messId_year_month_key" ON "MessPeriod"("messId", "year", "month");

-- CreateIndex
CREATE INDEX "MealEntry_messId_date_idx" ON "MealEntry"("messId", "date");

-- CreateIndex
CREATE INDEX "MealEntry_periodId_membershipId_idx" ON "MealEntry"("periodId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "MealEntry_membershipId_date_key" ON "MealEntry"("membershipId", "date");

-- CreateIndex
CREATE INDEX "Expense_messId_expenseDate_category_idx" ON "Expense"("messId", "expenseDate", "category");

-- CreateIndex
CREATE INDEX "Expense_periodId_allocationType_idx" ON "Expense"("periodId", "allocationType");

-- CreateIndex
CREATE INDEX "Expense_periodId_voidedAt_idx" ON "Expense"("periodId", "voidedAt");

-- CreateIndex
CREATE INDEX "ExpenseShare_membershipId_idx" ON "ExpenseShare"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseShare_expenseId_membershipId_key" ON "ExpenseShare"("expenseId", "membershipId");

-- CreateIndex
CREATE INDEX "Deposit_periodId_membershipId_idx" ON "Deposit"("periodId", "membershipId");

-- CreateIndex
CREATE INDEX "Deposit_messId_transactionDate_idx" ON "Deposit"("messId", "transactionDate");

-- CreateIndex
CREATE INDEX "MonthlyStatement_membershipId_createdAt_idx" ON "MonthlyStatement"("membershipId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyStatement_periodId_membershipId_calculationVersion_key" ON "MonthlyStatement"("periodId", "membershipId", "calculationVersion");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_codeHash_key" ON "Invitation"("codeHash");

-- CreateIndex
CREATE INDEX "Invitation_messId_expiresAt_idx" ON "Invitation"("messId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_expiresAt_idx" ON "RefreshSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_messId_createdAt_idx" ON "AuditLog"("messId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_messId_fkey" FOREIGN KEY ("messId") REFERENCES "Mess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessPeriod" ADD CONSTRAINT "MessPeriod_messId_fkey" FOREIGN KEY ("messId") REFERENCES "Mess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealEntry" ADD CONSTRAINT "MealEntry_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealEntry" ADD CONSTRAINT "MealEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "MessPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_messId_fkey" FOREIGN KEY ("messId") REFERENCES "Mess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "MessPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseShare" ADD CONSTRAINT "ExpenseShare_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseShare" ADD CONSTRAINT "ExpenseShare_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_messId_fkey" FOREIGN KEY ("messId") REFERENCES "Mess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "MessPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyStatement" ADD CONSTRAINT "MonthlyStatement_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "MessPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyStatement" ADD CONSTRAINT "MonthlyStatement_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_messId_fkey" FOREIGN KEY ("messId") REFERENCES "Mess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_messId_fkey" FOREIGN KEY ("messId") REFERENCES "Mess"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
