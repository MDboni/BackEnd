import { Router } from 'express';
import {
  authorize,
  membershipScope,
  requireActiveMembership,
  requireOwner,
} from '../middlewares/authorize.js';
import { monthCloseLimiter } from '../middlewares/rateLimit.js';
import { validateRequest } from '../middlewares/validateRequest.js';
import { auditController } from '../modules/audit/audit.controller.js';
import { listAuditQuerySchema } from '../modules/audit/audit.service.js';
import { dashboardController } from '../modules/dashboard/dashboard.controller.js';
import { depositController } from '../modules/deposit/deposit.controller.js';
import {
  createDepositSchema,
  listDepositsQuerySchema,
  updateDepositSchema,
  voidDepositSchema,
} from '../modules/deposit/deposit.validation.js';
import { expenseController } from '../modules/expense/expense.controller.js';
import {
  createExpenseSchema,
  listExpensesQuerySchema,
  updateExpenseSchema,
  voidExpenseSchema,
} from '../modules/expense/expense.validation.js';
import { mealController } from '../modules/meal/meal.controller.js';
import {
  copyMealsSchema,
  dailyQuerySchema,
  mealDateParamSchema,
  monthQuerySchema,
  overrideMealSchema,
  upsertMealSchema,
} from '../modules/meal/meal.validation.js';
import { membershipController } from '../modules/membership/membership.controller.js';
import {
  createInvitationSchema,
  listMembersQuerySchema,
  transferOwnershipSchema,
  updateRoleSchema,
  updateStatusSchema,
} from '../modules/membership/membership.validation.js';
import { messController } from '../modules/mess/mess.controller.js';
import { updateMessSchema } from '../modules/mess/mess.validation.js';
import { periodController } from '../modules/period/period.controller.js';
import {
  closePeriodSchema,
  createPeriodSchema,
  listPeriodsQuerySchema,
  reopenPeriodSchema,
} from '../modules/period/period.validation.js';
import { statementController } from '../modules/statement/statement.controller.js';
import { PERMISSIONS } from '../shared/constants/permissions.js';

/**
 * Every route below is mounted under `/messes/:messId`, so `membershipScope`
 * runs first and pins the tenant. Nothing here may query without it.
 */
const router: Router = Router({ mergeParams: true });

router.use(membershipScope);

/* ---------------------------------- Mess ---------------------------------- */

router.get('/', messController.getById);

router.patch(
  '/',
  authorize(PERMISSIONS.MESS_SETTINGS_UPDATE),
  validateRequest({ body: updateMessSchema }),
  messController.update,
);

/* ------------------------------- Membership ------------------------------- */

router.get(
  '/members',
  authorize(PERMISSIONS.MEMBER_READ),
  validateRequest({ query: listMembersQuerySchema }),
  membershipController.listMembers,
);

router.patch(
  '/members/:id/role',
  requireOwner,
  validateRequest({ body: updateRoleSchema }),
  membershipController.updateRole,
);

router.patch(
  '/members/:id/status',
  authorize(PERMISSIONS.MEMBER_STATUS_UPDATE),
  validateRequest({ body: updateStatusSchema }),
  membershipController.updateStatus,
);

router.post(
  '/transfer-ownership',
  requireOwner,
  validateRequest({ body: transferOwnershipSchema }),
  membershipController.transferOwnership,
);

router.post(
  '/invitations',
  authorize(PERMISSIONS.MEMBER_INVITE),
  validateRequest({ body: createInvitationSchema }),
  membershipController.createInvitation,
);

router.get(
  '/invitations',
  authorize(PERMISSIONS.MEMBER_INVITE),
  membershipController.listInvitations,
);

router.delete(
  '/invitations/:id',
  authorize(PERMISSIONS.MEMBER_INVITE),
  membershipController.revokeInvitation,
);

/* ---------------------------------- Meals --------------------------------- */

router.get('/meals/cutoff', mealController.cutoffStatus);

router.get(
  '/meals/my',
  validateRequest({ query: monthQuerySchema }),
  mealController.myMonth,
);

router.put(
  '/meals/my/:date',
  requireActiveMembership,
  validateRequest({ params: mealDateParamSchema, body: upsertMealSchema }),
  mealController.upsertMyMeal,
);

router.post(
  '/meals/my/copy',
  requireActiveMembership,
  validateRequest({ body: copyMealsSchema }),
  mealController.copyMeals,
);

router.get(
  '/meals/daily',
  authorize(PERMISSIONS.MEAL_READ_ALL),
  validateRequest({ query: dailyQuerySchema }),
  mealController.dailyList,
);

router.get(
  '/meals/daily-summary',
  authorize(PERMISSIONS.MEAL_READ_ALL),
  validateRequest({ query: dailyQuerySchema }),
  mealController.dailySummary,
);

router.get(
  '/meals/monthly-summary',
  authorize(PERMISSIONS.MEAL_READ_ALL),
  mealController.monthlySummary,
);

router.patch(
  '/meals/override',
  authorize(PERMISSIONS.MEAL_OVERRIDE),
  validateRequest({ body: overrideMealSchema }),
  mealController.overrideMeal,
);

/* -------------------------------- Expenses -------------------------------- */

router.post(
  '/expenses',
  authorize(PERMISSIONS.EXPENSE_WRITE),
  validateRequest({ body: createExpenseSchema }),
  expenseController.create,
);

router.get(
  '/expenses',
  authorize(PERMISSIONS.EXPENSE_READ_ALL),
  validateRequest({ query: listExpensesQuerySchema }),
  expenseController.list,
);

router.get(
  '/expenses/summary',
  authorize(PERMISSIONS.EXPENSE_READ_ALL),
  expenseController.summary,
);

/** Members without EXPENSE_READ_ALL still see what was charged to them. */
router.get('/expenses/my-allocations', expenseController.myAllocations);

router.get(
  '/expenses/:id',
  authorize(PERMISSIONS.EXPENSE_READ_ALL),
  expenseController.getById,
);

router.patch(
  '/expenses/:id',
  authorize(PERMISSIONS.EXPENSE_WRITE),
  validateRequest({ body: updateExpenseSchema }),
  expenseController.update,
);

router.delete(
  '/expenses/:id',
  authorize(PERMISSIONS.EXPENSE_WRITE),
  validateRequest({ body: voidExpenseSchema }),
  expenseController.voidExpense,
);

/* -------------------------------- Deposits -------------------------------- */

router.post(
  '/deposits',
  authorize(PERMISSIONS.DEPOSIT_WRITE),
  validateRequest({ body: createDepositSchema }),
  depositController.create,
);

router.get(
  '/deposits',
  authorize(PERMISSIONS.DEPOSIT_READ_ALL),
  validateRequest({ query: listDepositsQuerySchema }),
  depositController.list,
);

router.get('/deposits/my', depositController.myDeposits);

router.get(
  '/deposits/:id',
  authorize(PERMISSIONS.DEPOSIT_READ_ALL),
  depositController.getById,
);

router.patch(
  '/deposits/:id',
  authorize(PERMISSIONS.DEPOSIT_WRITE),
  validateRequest({ body: updateDepositSchema }),
  depositController.update,
);

router.delete(
  '/deposits/:id',
  authorize(PERMISSIONS.DEPOSIT_WRITE),
  validateRequest({ body: voidDepositSchema }),
  depositController.voidDeposit,
);

/* --------------------------------- Periods -------------------------------- */

router.post(
  '/periods',
  authorize(PERMISSIONS.PERIOD_WRITE),
  validateRequest({ body: createPeriodSchema }),
  periodController.create,
);

router.get(
  '/periods',
  validateRequest({ query: listPeriodsQuerySchema }),
  periodController.list,
);

router.get('/periods/current', periodController.getCurrent);

router.get('/periods/:periodId', periodController.getById);

router.get(
  '/periods/:periodId/preview',
  authorize(PERMISSIONS.PERIOD_PREVIEW),
  periodController.preview,
);

router.post(
  '/periods/:periodId/close',
  authorize(PERMISSIONS.PERIOD_CLOSE),
  monthCloseLimiter,
  validateRequest({ body: closePeriodSchema }),
  periodController.close,
);

router.post(
  '/periods/:periodId/reopen',
  requireOwner,
  validateRequest({ body: reopenPeriodSchema }),
  periodController.reopen,
);

/* ------------------------------- Statements ------------------------------- */

router.get(
  '/periods/:periodId/statements',
  authorize(PERMISSIONS.STATEMENT_READ_ALL),
  statementController.listByPeriod,
);

router.get('/periods/:periodId/statements/my', statementController.myStatement);

router.get('/statements/my-history', statementController.history);

router.get(
  '/statements/history/:membershipId',
  authorize(PERMISSIONS.STATEMENT_READ_ALL),
  statementController.history,
);

/* ------------------------------- Dashboards ------------------------------- */

router.get('/dashboard/member', dashboardController.member);

router.get(
  '/dashboard/manager',
  authorize(PERMISSIONS.EXPENSE_READ_ALL),
  dashboardController.manager,
);

router.get(
  '/dashboard/cook',
  authorize(PERMISSIONS.MEAL_READ_ALL),
  dashboardController.cook,
);

/* --------------------------------- Audit ---------------------------------- */

router.get(
  '/audit-logs',
  authorize(PERMISSIONS.AUDIT_READ),
  validateRequest({ query: listAuditQuerySchema }),
  auditController.list,
);

export const messScopedRoutes: Router = router;
