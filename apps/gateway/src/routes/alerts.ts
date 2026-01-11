/**
 * Alerts Routes - REST API endpoints for alert management.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import type {
  AlertFilter,
  AlertRuleUpdate,
  AlertSeverity,
  AlertType,
} from "../models/alert";
import {
  acknowledgeAlert,
  dismissAlert,
  evaluateAlertRules,
  getActiveAlerts,
  getAlert,
  getAlertHistory,
  getAlertRule,
  getAlertRules,
  updateAlertRule,
} from "../services/alerts";
import {
  sendError,
  sendInternalError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";

const alerts = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const AcknowledgeSchema = z.object({
  acknowledgedBy: z.string().min(1).optional(),
  comment: z.string().max(500).optional(),
});

const DismissSchema = z.object({
  dismissedBy: z.string().min(1).optional(),
  reason: z.string().max(500).optional(),
});

const UpdateRuleSchema = z.object({
  enabled: z.boolean().optional(),
  cooldown: z.number().min(0).max(86400000).optional(),
  severity: z.enum(["info", "warning", "error", "critical"]).optional(),
});

// ============================================================================
// Helper Functions
// ============================================================================

function handleError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof z.ZodError) {
    const errors = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));
    return sendValidationError(c, errors);
  }

  log.error({ error }, "Unexpected error in alerts route");
  return sendInternalError(c);
}

function parseArrayQuery(value: string | undefined): string[] | undefined {
  return value ? value.split(",") : undefined;
}

function parseBooleanQuery(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parseDateQuery(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function safeParseInt(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /alerts - List active alerts
 */
alerts.get("/", (c) => {
  try {
    // Build filter conditionally (for exactOptionalPropertyTypes)
    const filter: AlertFilter = {
      limit: safeParseInt(c.req.query("limit"), 50),
    };
    const typeParam = parseArrayQuery(c.req.query("type"));
    if (typeParam) filter.type = typeParam as AlertType[];
    const severityParam = parseArrayQuery(c.req.query("severity"));
    if (severityParam) filter.severity = severityParam as AlertSeverity[];
    const acknowledgedParam = parseBooleanQuery(c.req.query("acknowledged"));
    if (acknowledgedParam !== undefined)
      filter.acknowledged = acknowledgedParam;
    const sinceParam = parseDateQuery(c.req.query("since"));
    if (sinceParam) filter.since = sinceParam;
    const untilParam = parseDateQuery(c.req.query("until"));
    if (untilParam) filter.until = untilParam;
    const cursorParam = c.req.query("cursor");
    if (cursorParam) filter.cursor = cursorParam;

    const result = getActiveAlerts(filter);

    const serializedAlerts = result.alerts.map((alert) => ({
      ...alert,
      createdAt: alert.createdAt.toISOString(),
      ...(alert.expiresAt && { expiresAt: alert.expiresAt.toISOString() }),
      ...(alert.acknowledgedAt && {
        acknowledgedAt: alert.acknowledgedAt.toISOString(),
      }),
      ...(alert.dismissedAt && {
        dismissedAt: alert.dismissedAt.toISOString(),
      }),
    }));

    const listOptions: Parameters<typeof sendList>[2] = {
      hasMore: result.pagination.hasMore,
      total: result.pagination.total,
    };
    if (result.pagination.cursor) {
      listOptions.nextCursor = result.pagination.cursor;
    }
    return sendList(c, serializedAlerts, listOptions);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /alerts/history - Get alert history
 */
alerts.get("/history", (c) => {
  try {
    // Build filter conditionally (for exactOptionalPropertyTypes)
    const filter: AlertFilter = {
      limit: safeParseInt(c.req.query("limit"), 50),
    };
    const typeParam = parseArrayQuery(c.req.query("type"));
    if (typeParam) filter.type = typeParam as AlertType[];
    const severityParam = parseArrayQuery(c.req.query("severity"));
    if (severityParam) filter.severity = severityParam as AlertSeverity[];
    const sinceParam = parseDateQuery(c.req.query("since"));
    if (sinceParam) filter.since = sinceParam;
    const untilParam = parseDateQuery(c.req.query("until"));
    if (untilParam) filter.until = untilParam;
    const cursorParam = c.req.query("cursor");
    if (cursorParam) filter.cursor = cursorParam;

    const result = getAlertHistory(filter);

    const serializedAlerts = result.alerts.map((alert) => ({
      ...alert,
      createdAt: alert.createdAt.toISOString(),
      ...(alert.expiresAt && { expiresAt: alert.expiresAt.toISOString() }),
      ...(alert.acknowledgedAt && {
        acknowledgedAt: alert.acknowledgedAt.toISOString(),
      }),
      ...(alert.dismissedAt && {
        dismissedAt: alert.dismissedAt.toISOString(),
      }),
    }));

    const listOptions: Parameters<typeof sendList>[2] = {
      hasMore: result.pagination.hasMore,
      total: result.pagination.total,
    };
    if (result.pagination.cursor) {
      listOptions.nextCursor = result.pagination.cursor;
    }
    return sendList(c, serializedAlerts, listOptions);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /alerts/rules - List alert rules
 */
alerts.get("/rules", (c) => {
  try {
    const rules = getAlertRules();

    const serializedRules = rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      description: rule.description,
      enabled: rule.enabled,
      type: rule.type,
      severity: rule.severity,
      cooldown: rule.cooldown,
      source: rule.source,
    }));

    return sendList(c, serializedRules);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * PUT /alerts/rules/:ruleId - Update an alert rule
 */
alerts.put("/rules/:ruleId", async (c) => {
  try {
    const ruleId = c.req.param("ruleId");
    const body = await c.req.json();
    const validated = UpdateRuleSchema.parse(body);

    // Build update object conditionally (for exactOptionalPropertyTypes)
    const update: AlertRuleUpdate = {};
    if (validated.enabled !== undefined) update.enabled = validated.enabled;
    if (validated.cooldown !== undefined) update.cooldown = validated.cooldown;
    if (validated.severity !== undefined) update.severity = validated.severity;

    const updated = updateAlertRule(ruleId, update);
    if (!updated) {
      return sendNotFound(c, "alert_rule", ruleId);
    }

    const serializedRule = {
      id: updated.id,
      name: updated.name,
      enabled: updated.enabled,
      severity: updated.severity,
      cooldown: updated.cooldown,
    };

    return sendResource(c, "alert_rule", serializedRule);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /alerts/:alertId - Get a specific alert
 */
alerts.get("/:alertId", (c) => {
  try {
    const alertId = c.req.param("alertId");
    const alert = getAlert(alertId);

    if (!alert) {
      return sendNotFound(c, "alert", alertId);
    }

    const serializedAlert = {
      ...alert,
      createdAt: alert.createdAt.toISOString(),
      ...(alert.expiresAt && { expiresAt: alert.expiresAt.toISOString() }),
      ...(alert.acknowledgedAt && {
        acknowledgedAt: alert.acknowledgedAt.toISOString(),
      }),
      ...(alert.dismissedAt && {
        dismissedAt: alert.dismissedAt.toISOString(),
      }),
    };

    return sendResource(c, "alert", serializedAlert);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /alerts/:alertId/acknowledge - Acknowledge an alert
 */
alerts.post("/:alertId/acknowledge", async (c) => {
  try {
    const alertId = c.req.param("alertId");

    let acknowledgedBy: string | undefined;
    try {
      const body = await c.req.json();
      const validated = AcknowledgeSchema.parse(body);
      acknowledgedBy = validated.acknowledgedBy;
    } catch {
      // No body or invalid body - use defaults
    }

    const alert = acknowledgeAlert(alertId, acknowledgedBy);
    if (!alert) {
      return sendNotFound(c, "alert", alertId);
    }

    const serializedAlert = {
      id: alert.id,
      acknowledged: alert.acknowledged,
      acknowledgedAt: alert.acknowledgedAt?.toISOString(),
      acknowledgedBy: alert.acknowledgedBy,
    };

    return sendResource(c, "alert", serializedAlert);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /alerts/:alertId/dismiss - Dismiss an alert
 */
alerts.post("/:alertId/dismiss", async (c) => {
  try {
    const alertId = c.req.param("alertId");

    let dismissedBy: string | undefined;
    try {
      const body = await c.req.json();
      const validated = DismissSchema.parse(body);
      dismissedBy = validated.dismissedBy;
    } catch {
      // No body or invalid body - use defaults
    }

    const alert = dismissAlert(alertId, dismissedBy);
    if (!alert) {
      return sendNotFound(c, "alert", alertId);
    }

    const serializedAlert = {
      id: alert.id,
      dismissed: true,
      dismissedAt: alert.dismissedAt?.toISOString(),
      dismissedBy: alert.dismissedBy,
    };

    return sendResource(c, "alert", serializedAlert);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /alerts/evaluate - Manually trigger alert rule evaluation
 */
alerts.post("/evaluate", (c) => {
  try {
    const firedAlerts = evaluateAlertRules();

    const serializedAlerts = firedAlerts.map((alert) => ({
      id: alert.id,
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
    }));

    const response = {
      evaluated: true,
      alertsFired: firedAlerts.length,
      alerts: serializedAlerts,
    };

    return sendResource(c, "alert_evaluation", response);
  } catch (error) {
    return handleError(error, c);
  }
});

export { alerts };
