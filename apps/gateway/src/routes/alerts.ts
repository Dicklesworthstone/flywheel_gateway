/**
 * Alerts Routes - REST API endpoints for alert management.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getCorrelationId, getLogger } from "../middleware/correlation";
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
  const correlationId = getCorrelationId();

  if (error instanceof z.ZodError) {
    return c.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Validation failed",
          correlationId,
          timestamp: new Date().toISOString(),
          details: error.issues,
        },
      },
      400,
    );
  }

  log.error({ error }, "Unexpected error in alerts route");
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        correlationId,
        timestamp: new Date().toISOString(),
      },
    },
    500,
  );
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

    return c.json({
      alerts: result.alerts.map((alert) => ({
        ...alert,
        createdAt: alert.createdAt.toISOString(),
        ...(alert.expiresAt && { expiresAt: alert.expiresAt.toISOString() }),
        ...(alert.acknowledgedAt && {
          acknowledgedAt: alert.acknowledgedAt.toISOString(),
        }),
        ...(alert.dismissedAt && {
          dismissedAt: alert.dismissedAt.toISOString(),
        }),
      })),
      pagination: result.pagination,
    });
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

    return c.json({
      alerts: result.alerts.map((alert) => ({
        ...alert,
        createdAt: alert.createdAt.toISOString(),
        ...(alert.expiresAt && { expiresAt: alert.expiresAt.toISOString() }),
        ...(alert.acknowledgedAt && {
          acknowledgedAt: alert.acknowledgedAt.toISOString(),
        }),
        ...(alert.dismissedAt && {
          dismissedAt: alert.dismissedAt.toISOString(),
        }),
      })),
      pagination: result.pagination,
    });
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

    return c.json({
      rules: rules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        description: rule.description,
        enabled: rule.enabled,
        type: rule.type,
        severity: rule.severity,
        cooldown: rule.cooldown,
        source: rule.source,
      })),
    });
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
      return c.json(
        {
          error: {
            code: "RULE_NOT_FOUND",
            message: `Alert rule ${ruleId} not found`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404,
      );
    }

    return c.json({
      id: updated.id,
      name: updated.name,
      enabled: updated.enabled,
      severity: updated.severity,
      cooldown: updated.cooldown,
    });
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
      return c.json(
        {
          error: {
            code: "ALERT_NOT_FOUND",
            message: `Alert ${alertId} not found`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404,
      );
    }

    return c.json({
      ...alert,
      createdAt: alert.createdAt.toISOString(),
      ...(alert.expiresAt && { expiresAt: alert.expiresAt.toISOString() }),
      ...(alert.acknowledgedAt && {
        acknowledgedAt: alert.acknowledgedAt.toISOString(),
      }),
      ...(alert.dismissedAt && {
        dismissedAt: alert.dismissedAt.toISOString(),
      }),
    });
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
      return c.json(
        {
          error: {
            code: "ALERT_NOT_FOUND",
            message: `Alert ${alertId} not found`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404,
      );
    }

    return c.json({
      id: alert.id,
      acknowledged: alert.acknowledged,
      acknowledgedAt: alert.acknowledgedAt?.toISOString(),
      acknowledgedBy: alert.acknowledgedBy,
    });
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
      return c.json(
        {
          error: {
            code: "ALERT_NOT_FOUND",
            message: `Alert ${alertId} not found`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404,
      );
    }

    return c.json({
      id: alert.id,
      dismissed: true,
      dismissedAt: alert.dismissedAt?.toISOString(),
      dismissedBy: alert.dismissedBy,
    });
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

    return c.json({
      evaluated: true,
      alertsFired: firedAlerts.length,
      alerts: firedAlerts.map((alert) => ({
        id: alert.id,
        type: alert.type,
        severity: alert.severity,
        title: alert.title,
      })),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

export { alerts };
