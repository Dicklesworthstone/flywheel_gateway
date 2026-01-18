/**
 * Budget Service
 *
 * Manages cost budgets, tracks usage against limits, and triggers alerts.
 */

import { and, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { db } from "../db/connection";
import { budgetAlerts, budgets, costRecords } from "../db/schema";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import type {
  Budget,
  BudgetAction,
  BudgetInput,
  BudgetPeriod,
  BudgetStatus,
} from "../models/cost";
import { logger } from "./logger";

// ============================================================================
// Budget Period Helpers
// ============================================================================

/**
 * Get the current period boundaries for a budget.
 */
export function getBudgetPeriodBoundaries(
  period: BudgetPeriod,
  referenceDate: Date = new Date(),
): { start: Date; end: Date } {
  const now = new Date(referenceDate);

  switch (period) {
    case "daily": {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { start, end };
    }
    case "weekly": {
      const dayOfWeek = now.getDay();
      const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - dayOfWeek,
      );
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end };
    }
    case "monthly": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { start, end };
    }
    case "yearly": {
      const start = new Date(now.getFullYear(), 0, 1);
      const end = new Date(now.getFullYear() + 1, 0, 1);
      return { start, end };
    }
  }
}

/**
 * Get days remaining in the current period.
 */
export function getDaysRemainingInPeriod(period: BudgetPeriod): number {
  const { end } = getBudgetPeriodBoundaries(period);
  const now = new Date();
  const msRemaining = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));
}

// ============================================================================
// Budget CRUD
// ============================================================================

/**
 * Generate a unique budget ID.
 */
function generateBudgetId(): string {
  const randomBytes = new Uint8Array(6);
  crypto.getRandomValues(randomBytes);
  const random = Array.from(randomBytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 8);
  return `budget_${Date.now()}_${random}`;
}

/**
 * Create a new budget.
 */
export async function createBudget(input: BudgetInput): Promise<Budget> {
  const now = new Date();
  const id = generateBudgetId();

  const budget: Budget = {
    id,
    name: input.name,
    ...(input.organizationId && { organizationId: input.organizationId }),
    ...(input.projectId && { projectId: input.projectId }),
    period: input.period,
    amountUnits: input.amountUnits,
    alertThresholds: input.alertThresholds ?? [50, 75, 90, 100],
    actionOnExceed: input.actionOnExceed ?? "alert",
    rollover: input.rollover ?? false,
    effectiveDate: input.effectiveDate ?? now,
    ...(input.expiresAt && { expiresAt: input.expiresAt }),
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(budgets).values({
    id: budget.id,
    name: budget.name,
    organizationId: budget.organizationId ?? null,
    projectId: budget.projectId ?? null,
    period: budget.period,
    amountUnits: budget.amountUnits,
    alertThresholds: JSON.stringify(budget.alertThresholds),
    actionOnExceed: budget.actionOnExceed,
    rollover: budget.rollover,
    effectiveDate: budget.effectiveDate,
    expiresAt: budget.expiresAt ?? null,
    enabled: budget.enabled,
    createdAt: budget.createdAt,
    updatedAt: budget.updatedAt,
  });

  logger.info(
    { budgetId: id, name: budget.name, amountUnits: budget.amountUnits },
    "Budget created",
  );

  return budget;
}

/**
 * Get a budget by ID.
 */
export async function getBudget(budgetId: string): Promise<Budget | undefined> {
  const rows = await db
    .select()
    .from(budgets)
    .where(eq(budgets.id, budgetId))
    .limit(1);

  if (rows.length === 0) {
    return undefined;
  }

  const row = rows[0]!;
  return {
    id: row.id,
    name: row.name,
    ...(row.organizationId && { organizationId: row.organizationId }),
    ...(row.projectId && { projectId: row.projectId }),
    period: row.period as BudgetPeriod,
    amountUnits: row.amountUnits,
    alertThresholds: JSON.parse(row.alertThresholds) as number[],
    actionOnExceed: row.actionOnExceed as BudgetAction,
    rollover: row.rollover,
    effectiveDate: row.effectiveDate,
    ...(row.expiresAt && { expiresAt: row.expiresAt }),
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Update a budget.
 */
export async function updateBudget(
  budgetId: string,
  updates: Partial<BudgetInput>,
): Promise<Budget | undefined> {
  const existing = await getBudget(budgetId);
  if (!existing) {
    return undefined;
  }

  const now = new Date();
  const updateFields: Record<string, unknown> = { updatedAt: now };

  if (updates.name !== undefined) updateFields["name"] = updates.name;
  if (updates.organizationId !== undefined)
    updateFields["organizationId"] = updates.organizationId ?? null;
  if (updates.projectId !== undefined)
    updateFields["projectId"] = updates.projectId ?? null;
  if (updates.period !== undefined) updateFields["period"] = updates.period;
  if (updates.amountUnits !== undefined)
    updateFields["amountUnits"] = updates.amountUnits;
  if (updates.alertThresholds !== undefined)
    updateFields["alertThresholds"] = JSON.stringify(updates.alertThresholds);
  if (updates.actionOnExceed !== undefined)
    updateFields["actionOnExceed"] = updates.actionOnExceed;
  if (updates.rollover !== undefined)
    updateFields["rollover"] = updates.rollover;
  if (updates.effectiveDate !== undefined)
    updateFields["effectiveDate"] = updates.effectiveDate;
  if (updates.expiresAt !== undefined)
    updateFields["expiresAt"] = updates.expiresAt ?? null;
  if (updates.enabled !== undefined) updateFields["enabled"] = updates.enabled;

  await db.update(budgets).set(updateFields).where(eq(budgets.id, budgetId));

  return getBudget(budgetId);
}

/**
 * Delete a budget.
 */
export async function deleteBudget(budgetId: string): Promise<boolean> {
  const existing = await getBudget(budgetId);
  if (!existing) {
    return false;
  }
  await db.delete(budgets).where(eq(budgets.id, budgetId));
  return true;
}

/**
 * List budgets with filtering.
 */
export async function listBudgets(filter?: {
  organizationId?: string;
  projectId?: string;
  enabled?: boolean;
}): Promise<Budget[]> {
  const conditions = [];

  if (filter?.organizationId) {
    conditions.push(eq(budgets.organizationId, filter.organizationId));
  }
  if (filter?.projectId) {
    conditions.push(eq(budgets.projectId, filter.projectId));
  }
  if (filter?.enabled !== undefined) {
    conditions.push(eq(budgets.enabled, filter.enabled));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(budgets)
    .where(whereClause)
    .orderBy(desc(budgets.createdAt));

  return rows.map((row) => {
    const budget: Budget = {
      id: row.id,
      name: row.name,
      period: row.period as BudgetPeriod,
      amountUnits: row.amountUnits,
      alertThresholds: JSON.parse(row.alertThresholds) as number[],
      actionOnExceed: row.actionOnExceed as BudgetAction,
      rollover: row.rollover,
      effectiveDate: row.effectiveDate,
      enabled: row.enabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    if (row.organizationId) budget.organizationId = row.organizationId;
    if (row.projectId) budget.projectId = row.projectId;
    if (row.expiresAt) budget.expiresAt = row.expiresAt;
    return budget;
  });
}

// ============================================================================
// Budget Status
// ============================================================================

/**
 * Calculate burn rate and projection.
 *
 * @param usedUnits - Units used so far in the period
 * @param amountUnits - Total budget amount in units
 * @param periodStart - Start date of the period
 * @param periodEnd - End date of the period
 * @param now - Current date (defaults to new Date())
 * @param period - The budget period type (daily, weekly, etc.) - needed for legacy calculation compatibility
 */
export function calculateBurnRateAndProjection(
  usedUnits: number,
  amountUnits: number,
  periodStart: Date,
  periodEnd: Date,
  _period: BudgetPeriod,
  now: Date = new Date(),
): {
  burnRateUnitsPerDay: number;
  projectedEndOfPeriodUnits: number;
  projectedExceed: boolean;
  daysRemaining: number;
  daysUntilExhausted: number | undefined;
} {
  const periodDurationMs = periodEnd.getTime() - periodStart.getTime();
  // Ensure we don't divide by zero and have at least 1ms elapsed
  const elapsedMs = Math.max(1, now.getTime() - periodStart.getTime());

  // Calculate usage projection based on time fraction
  const fractionElapsed = Math.min(1, elapsedMs / periodDurationMs);
  const projectedEndOfPeriodUnits =
    fractionElapsed > 0 ? usedUnits / fractionElapsed : 0;

  const projectedExceed = projectedEndOfPeriodUnits > amountUnits;

  // Calculate burn rate (units per day)
  const durationDays = periodDurationMs / (24 * 60 * 60 * 1000);
  const burnRateUnitsPerDay =
    durationDays > 0 ? projectedEndOfPeriodUnits / durationDays : 0;

  // Days remaining (float for precision)
  const msRemaining = Math.max(0, periodEnd.getTime() - now.getTime());
  const daysRemaining = msRemaining / (24 * 60 * 60 * 1000);

  // Remaining units
  const remainingUnits = Math.max(0, amountUnits - usedUnits);

  // Days until exhausted (if burn rate continues)
  const daysUntilExhausted =
    burnRateUnitsPerDay > 0 ? remainingUnits / burnRateUnitsPerDay : undefined;

  return {
    burnRateUnitsPerDay,
    projectedEndOfPeriodUnits,
    projectedExceed,
    daysRemaining, // Return float for better precision
    daysUntilExhausted: daysUntilExhausted,
  };
}

/**
 * Get the current status of a budget.
 */
export async function getBudgetStatus(
  budgetId: string,
): Promise<BudgetStatus | undefined> {
  const budget = await getBudget(budgetId);
  if (!budget) {
    return undefined;
  }

  const { start: periodStart, end: periodEnd } = getBudgetPeriodBoundaries(
    budget.period,
  );

  // Calculate current usage
  const conditions = [
    gte(costRecords.timestamp, periodStart),
    lt(costRecords.timestamp, periodEnd),
  ];

  if (budget.organizationId) {
    conditions.push(eq(costRecords.organizationId, budget.organizationId));
  }
  if (budget.projectId) {
    conditions.push(eq(costRecords.projectId, budget.projectId));
  }

  const usageResult = await db
    .select({
      totalCost: sql<number>`coalesce(sum(${costRecords.totalCostUnits}), 0)`,
    })
    .from(costRecords)
    .where(and(...conditions));

  const usedUnits = usageResult[0]?.totalCost ?? 0;
  const usedPercent =
    budget.amountUnits > 0 ? (usedUnits / budget.amountUnits) * 100 : 0;
  const remainingUnits = Math.max(0, budget.amountUnits - usedUnits);

  const now = new Date();
  const {
    burnRateUnitsPerDay,
    projectedEndOfPeriodUnits,
    projectedExceed,
    daysUntilExhausted,
  } = calculateBurnRateAndProjection(
    usedUnits,
    budget.amountUnits,
    periodStart,
    periodEnd,
    budget.period,
    now,
  );

  // Get previous period usage for comparison
  const prevPeriodBoundaries = getBudgetPeriodBoundaries(
    budget.period,
    new Date(periodStart.getTime() - 1),
  );

  const prevConditions = [
    gte(costRecords.timestamp, prevPeriodBoundaries.start),
    lt(costRecords.timestamp, prevPeriodBoundaries.end),
  ];
  if (budget.organizationId) {
    prevConditions.push(eq(costRecords.organizationId, budget.organizationId));
  }
  if (budget.projectId) {
    prevConditions.push(eq(costRecords.projectId, budget.projectId));
  }

  const prevUsageResult = await db
    .select({
      totalCost: sql<number>`coalesce(sum(${costRecords.totalCostUnits}), 0)`,
    })
    .from(costRecords)
    .where(and(...prevConditions));

  const previousPeriodUnits = prevUsageResult[0]?.totalCost;
  const changePercent =
    previousPeriodUnits && previousPeriodUnits > 0
      ? ((usedUnits - previousPeriodUnits) / previousPeriodUnits) * 100
      : undefined;

  // Determine current threshold crossed
  const alertsTriggered = budget.alertThresholds.filter(
    (threshold) => usedPercent >= threshold,
  );
  const currentThreshold =
    alertsTriggered.length > 0 ? Math.max(...alertsTriggered) : 0;

  // Determine status
  let status: BudgetStatus["status"];
  if (usedPercent >= 100) {
    status = "exceeded";
  } else if (usedPercent >= 90) {
    status = "critical";
  } else if (usedPercent >= 75) {
    status = "warning";
  } else {
    status = "healthy";
  }

  const budgetStatus: BudgetStatus = {
    budget,
    periodStart,
    periodEnd,
    usedUnits,
    usedPercent,
    remainingUnits,
    burnRateUnitsPerDay,
    projectedEndOfPeriodUnits,
    projectedExceed,
    currentThreshold,
    alertsTriggered,
    status,
    lastUpdatedAt: now,
  };
  if (daysUntilExhausted !== undefined)
    budgetStatus.daysUntilExhausted = daysUntilExhausted;
  if (previousPeriodUnits !== undefined)
    budgetStatus.previousPeriodUnits = previousPeriodUnits;
  if (changePercent !== undefined) budgetStatus.changePercent = changePercent;
  return budgetStatus;
}

/**
 * Get status for all active budgets.
 */
export async function getAllBudgetStatuses(): Promise<BudgetStatus[]> {
  const activeBudgets = await listBudgets({ enabled: true });
  const statuses: BudgetStatus[] = [];

  for (const budget of activeBudgets) {
    const status = await getBudgetStatus(budget.id);
    if (status) {
      statuses.push(status);
    }
  }

  return statuses;
}

// ============================================================================
// Budget Alerts
// ============================================================================

/**
 * Generate a unique alert ID.
 */
function generateAlertId(): string {
  const randomBytes = new Uint8Array(6);
  crypto.getRandomValues(randomBytes);
  const random = Array.from(randomBytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 8);
  return `balert_${Date.now()}_${random}`;
}

/**
 * Check budget and create alerts if thresholds crossed.
 */
export async function checkBudgetThresholds(
  budgetId: string,
): Promise<{ alertCreated: boolean; threshold?: number }> {
  const status = await getBudgetStatus(budgetId);
  if (!status) {
    return { alertCreated: false };
  }

  const log = getLogger();

  // Find the highest threshold that was crossed but not yet alerted for this period
  for (const threshold of [...status.budget.alertThresholds].sort(
    (a, b) => b - a,
  )) {
    if (status.usedPercent < threshold) {
      continue;
    }

    // Check if we already alerted for this threshold in this period
    const existingAlert = await db
      .select()
      .from(budgetAlerts)
      .where(
        and(
          eq(budgetAlerts.budgetId, budgetId),
          eq(budgetAlerts.threshold, threshold),
          gte(budgetAlerts.periodStart, status.periodStart),
          lte(budgetAlerts.periodEnd, status.periodEnd),
        ),
      )
      .limit(1);

    if (existingAlert.length === 0) {
      // Create new alert
      const alertId = generateAlertId();
      await db.insert(budgetAlerts).values({
        id: alertId,
        budgetId,
        threshold,
        usedPercent: status.usedPercent,
        usedUnits: status.usedUnits,
        budgetUnits: status.budget.amountUnits,
        periodStart: status.periodStart,
        periodEnd: status.periodEnd,
        acknowledged: false,
        createdAt: new Date(),
      });

      log.info({
        type: "budget:threshold_crossed",
        correlationId: getCorrelationId(),
        budgetId,
        budgetName: status.budget.name,
        threshold,
        usedPercent: status.usedPercent,
        usedUnits: status.usedUnits,
      });

      return { alertCreated: true, threshold };
    }
  }

  return { alertCreated: false };
}

/**
 * Get budget alerts.
 */
export async function getBudgetAlerts(filter?: {
  budgetId?: string;
  acknowledged?: boolean;
  since?: Date;
  limit?: number;
}): Promise<
  Array<{
    id: string;
    budgetId: string;
    threshold: number;
    usedPercent: number;
    usedUnits: number;
    budgetUnits: number;
    periodStart: Date;
    periodEnd: Date;
    acknowledged: boolean;
    acknowledgedBy?: string;
    acknowledgedAt?: Date;
    createdAt: Date;
  }>
> {
  const conditions = [];

  if (filter?.budgetId) {
    conditions.push(eq(budgetAlerts.budgetId, filter.budgetId));
  }
  if (filter?.acknowledged !== undefined) {
    conditions.push(eq(budgetAlerts.acknowledged, filter.acknowledged));
  }
  if (filter?.since) {
    conditions.push(gte(budgetAlerts.createdAt, filter.since));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = filter?.limit ?? 50;

  const rows = await db
    .select()
    .from(budgetAlerts)
    .where(whereClause)
    .orderBy(desc(budgetAlerts.createdAt))
    .limit(limit);

  return rows.map((row) => {
    const alert: {
      id: string;
      budgetId: string;
      threshold: number;
      usedPercent: number;
      usedUnits: number;
      budgetUnits: number;
      periodStart: Date;
      periodEnd: Date;
      acknowledged: boolean;
      acknowledgedBy?: string;
      acknowledgedAt?: Date;
      createdAt: Date;
    } = {
      id: row.id,
      budgetId: row.budgetId,
      threshold: row.threshold,
      usedPercent: row.usedPercent,
      usedUnits: row.usedUnits,
      budgetUnits: row.budgetUnits,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      acknowledged: row.acknowledged,
      createdAt: row.createdAt,
    };
    if (row.acknowledgedBy) alert.acknowledgedBy = row.acknowledgedBy;
    if (row.acknowledgedAt) alert.acknowledgedAt = row.acknowledgedAt;
    return alert;
  });
}

/**
 * Acknowledge a budget alert.
 */
export async function acknowledgeBudgetAlert(
  alertId: string,
  acknowledgedBy?: string,
): Promise<boolean> {
  // Check if alert exists first
  const existing = await db
    .select()
    .from(budgetAlerts)
    .where(eq(budgetAlerts.id, alertId))
    .limit(1);

  if (existing.length === 0) {
    return false;
  }

  const now = new Date();
  await db
    .update(budgetAlerts)
    .set({
      acknowledged: true,
      acknowledgedBy: acknowledgedBy ?? null,
      acknowledgedAt: now,
    })
    .where(eq(budgetAlerts.id, alertId));

  return true;
}

// ============================================================================
// Budget Enforcement
// ============================================================================

/**
 * Check if a cost operation should be blocked based on budget.
 */
export async function shouldBlockOperation(filter: {
  organizationId?: string;
  projectId?: string;
}): Promise<{
  blocked: boolean;
  reason?: string;
  budgetId?: string;
}> {
  const conditions = [eq(budgets.enabled, true)];

  if (filter.organizationId) {
    conditions.push(eq(budgets.organizationId, filter.organizationId));
  }
  if (filter.projectId) {
    conditions.push(eq(budgets.projectId, filter.projectId));
  }

  const matchingBudgets = await db
    .select()
    .from(budgets)
    .where(and(...conditions));

  for (const budget of matchingBudgets) {
    if (budget.actionOnExceed !== "block") {
      continue;
    }

    const status = await getBudgetStatus(budget.id);
    if (status && status.usedPercent >= 100) {
      return {
        blocked: true,
        reason: `Budget "${budget.name}" exceeded (${status.usedPercent.toFixed(1)}% used)`,
        budgetId: budget.id,
      };
    }
  }

  return { blocked: false };
}

/**
 * Check if operations should be throttled based on budget.
 */
export async function shouldThrottleOperation(filter: {
  organizationId?: string;
  projectId?: string;
}): Promise<{
  throttle: boolean;
  delayMs?: number;
  reason?: string;
  budgetId?: string;
}> {
  const conditions = [eq(budgets.enabled, true)];

  if (filter.organizationId) {
    conditions.push(eq(budgets.organizationId, filter.organizationId));
  }
  if (filter.projectId) {
    conditions.push(eq(budgets.projectId, filter.projectId));
  }

  const matchingBudgets = await db
    .select()
    .from(budgets)
    .where(and(...conditions));

  for (const budget of matchingBudgets) {
    if (budget.actionOnExceed !== "throttle") {
      continue;
    }

    const status = await getBudgetStatus(budget.id);
    if (status && status.usedPercent >= 90) {
      // Progressive throttling: 1s at 90%, 5s at 95%, 30s at 100%
      let delayMs = 0;
      if (status.usedPercent >= 100) {
        delayMs = 30000;
      } else if (status.usedPercent >= 95) {
        delayMs = 5000;
      } else {
        delayMs = 1000;
      }

      return {
        throttle: true,
        delayMs,
        reason: `Budget "${budget.name}" at ${status.usedPercent.toFixed(1)}%`,
        budgetId: budget.id,
      };
    }
  }

  return { throttle: false };
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Clear all budget data (for testing).
 */
export async function clearBudgetData(): Promise<void> {
  await db.delete(budgetAlerts);
  await db.delete(budgets);
}
