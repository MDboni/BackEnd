import { auditContextFrom } from '../../shared/utils/audit.js';
import { catchAsync } from '../../shared/utils/catchAsync.js';
import { param } from '../../shared/utils/request.js';
import { sendResponse } from '../../shared/utils/sendResponse.js';
import type { CutoffSettings } from './meal.cutoff.js';
import { mealService } from './meal.service.js';
import type { Request } from 'express';

const settingsOf = (req: Request): CutoffSettings => ({
  timezone: req.membership!.timezone,
  mealCutoffTime: req.membership!.mealCutoffTime,
  cutoffDaysAhead: req.membership!.cutoffDaysAhead,
});

const upsertMyMeal = catchAsync(async (req, res) => {
  const meal = await mealService.upsertOwnMeal(
    req.membership!.messId,
    req.membership!.membershipId,
    param(req, 'date'),
    req.body,
    settingsOf(req),
  );

  sendResponse(res, { message: 'Meal saved successfully', data: meal });
});

const overrideMeal = catchAsync(async (req, res) => {
  const meal = await mealService.overrideMeal(
    req.membership!.messId,
    req.body,
    auditContextFrom(req),
  );

  sendResponse(res, { message: 'Meal overridden successfully', data: meal });
});

const copyMeals = catchAsync(async (req, res) => {
  const result = await mealService.copyMeals(
    req.membership!.messId,
    req.membership!.membershipId,
    req.body,
    settingsOf(req),
  );

  sendResponse(res, {
    message: `Copied to ${result.applied.length} day(s)`,
    data: result,
  });
});

const myMonth = catchAsync(async (req, res) => {
  const query = req.query as { month?: string };
  const calendar = await mealService.myMonth(
    req.membership!.messId,
    req.membership!.membershipId,
    query.month,
    req.membership!.timezone,
  );

  sendResponse(res, { message: 'Meal calendar retrieved successfully', data: calendar });
});

const dailyList = catchAsync(async (req, res) => {
  const query = req.query as { date?: string };
  const daily = await mealService.dailyList(
    req.membership!.messId,
    query.date,
    req.membership!.timezone,
  );

  sendResponse(res, { message: 'Daily meals retrieved successfully', data: daily });
});

const dailySummary = catchAsync(async (req, res) => {
  const query = req.query as { date?: string };
  const summary = await mealService.dailySummary(
    req.membership!.messId,
    query.date,
    req.membership!.timezone,
  );

  sendResponse(res, { message: 'Daily summary retrieved successfully', data: summary });
});

const monthlySummary = catchAsync(async (req, res) => {
  const query = req.query as { periodId?: string };
  const summary = await mealService.monthlySummary(req.membership!.messId, query.periodId!);

  sendResponse(res, { message: 'Monthly meal summary retrieved successfully', data: summary });
});

const cutoffStatus = catchAsync(async (req, res) => {
  const query = req.query as { date?: string };
  const status = mealService.cutoffStatus(settingsOf(req), query.date);

  sendResponse(res, { message: 'Cutoff status retrieved successfully', data: status });
});

export const mealController = {
  upsertMyMeal,
  overrideMeal,
  copyMeals,
  myMonth,
  dailyList,
  dailySummary,
  monthlySummary,
  cutoffStatus,
};
