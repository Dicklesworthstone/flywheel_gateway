/**
 * Alert Service
 *
 * Manages alert rules, evaluates conditions, and tracks alert state.
 */

import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  type Alert,
  type AlertContext,
  type AlertFilter,
  type AlertListResponse,
  type AlertRule,
  type AlertRuleUpdate,
  type AlertSeverity,
  DEFAULT_COOLDOWN_MS,
  SEVERITY_ORDER,
} from "../models/alert";
import { logger } from "./logger";
import { getMetricsSnapshot } from "./metrics";

/** Active alerts */
const activeAlerts = new Map<string, Alert>();

/** Alert history (most recent first) */
const alertHistory: Alert[] = [];

/** Maximum history size */
const MAX_HISTORY_SIZE = 1000;

/** Last alert time per rule (for cooldown) */
const lastAlertTime = new Map<string, number>();

/** Alert rules registry */
const alertRules = new Map<string, AlertRule>();

/** Alert event listeners */
type AlertListener = (alert: Alert) => void;
const listeners: AlertListener[] = [];

/**
 * Generate a unique alert ID.
 */
function generateAlertId(): string {
  return `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Register an alert rule.
 */
export function registerAlertRule(rule: AlertRule): void {
  alertRules.set(rule.id, rule);
  logger.debug(
    { ruleId: rule.id, ruleName: rule.name },
    "Alert rule registered",
  );
}

/**
 * Update an alert rule.
 */
export function updateAlertRule(
  ruleId: string,
  update: AlertRuleUpdate,
): AlertRule | undefined {
  const rule = alertRules.get(ruleId);
  if (!rule) return undefined;

  const updated = {
    ...rule,
    ...(update.enabled !== undefined && { enabled: update.enabled }),
    ...(update.cooldown !== undefined && { cooldown: update.cooldown }),
    ...(update.severity !== undefined && { severity: update.severity }),
  };

  alertRules.set(ruleId, updated);
  logger.info({ ruleId, update }, "Alert rule updated");

  return updated;
}

/**
 * Get all alert rules.
 */
export function getAlertRules(): AlertRule[] {
  return Array.from(alertRules.values());
}

/**
 * Get a specific alert rule.
 */
export function getAlertRule(ruleId: string): AlertRule | undefined {
  return alertRules.get(ruleId);
}

/**
 * Build alert context for rule evaluation.
 */
function buildAlertContext(correlationId: string): AlertContext {
  const snapshot = getMetricsSnapshot();

  return {
    metrics: {
      agents: snapshot.agents,
      tokens: {
        last24h: snapshot.tokens.last24h,
        quotaUsedPercent: 0, // Would need quota tracking
      },
      performance: {
        avgResponseMs: snapshot.performance.avgResponseMs,
        successRate: snapshot.performance.successRate,
        errorCount: snapshot.performance.errorCount,
      },
      system: {
        memoryUsageMb: snapshot.system.memoryUsageMb,
        cpuPercent: snapshot.system.cpuPercent,
        wsConnections: snapshot.system.wsConnections,
      },
    },
    correlationId,
    timestamp: new Date(),
  };
}

/**
 * Create and fire an alert.
 */
export function fireAlert(rule: AlertRule, context: AlertContext): Alert {
  const correlationId = context.correlationId;
  const log = getLogger();

  const title =
    typeof rule.title === "function" ? rule.title(context) : rule.title;
  const message =
    typeof rule.message === "function" ? rule.message(context) : rule.message;

  const alert: Alert = {
    id: generateAlertId(),
    type: rule.type,
    severity: rule.severity,
    title,
    message,
    source: rule.source ?? rule.id,
    createdAt: context.timestamp,
    acknowledged: false,
    actions: rule.actions,
    correlationId,
  };

  // Store in active alerts
  activeAlerts.set(alert.id, alert);

  // Add to history
  alertHistory.unshift(alert);
  if (alertHistory.length > MAX_HISTORY_SIZE) {
    alertHistory.pop();
  }

  // Update last alert time for cooldown
  lastAlertTime.set(rule.id, Date.now());

  // Log the alert
  log.info({
    type: "alert:fired",
    alertId: alert.id,
    alertType: alert.type,
    severity: alert.severity,
    source: alert.source,
    message: alert.message,
    correlationId,
  });

  // Notify listeners
  for (const listener of listeners) {
    try {
      listener(alert);
    } catch (error) {
      logger.error({ error, alertId: alert.id }, "Alert listener threw error");
    }
  }

  return alert;
}

/**
 * Evaluate all alert rules.
 */
export function evaluateAlertRules(): Alert[] {
  const correlationId = getCorrelationId();
  const context = buildAlertContext(correlationId);
  const firedAlerts: Alert[] = [];

  for (const rule of alertRules.values()) {
    if (!rule.enabled) continue;

    // Check cooldown
    const lastTime = lastAlertTime.get(rule.id);
    const cooldown = rule.cooldown ?? DEFAULT_COOLDOWN_MS;
    if (lastTime && Date.now() - lastTime < cooldown) {
      continue;
    }

    try {
      // Find previous alert for this rule
      const previousAlert = alertHistory.find(
        (a) => a.source === (rule.source ?? rule.id) && !a.acknowledged,
      );
      context.previousAlert = previousAlert;

      if (rule.condition(context)) {
        const alert = fireAlert(rule, context);
        firedAlerts.push(alert);
      }
    } catch (error) {
      logger.error(
        { error, ruleId: rule.id, ruleName: rule.name },
        "Alert rule evaluation failed",
      );
    }
  }

  return firedAlerts;
}

/**
 * Get active alerts.
 */
export function getActiveAlerts(filter?: AlertFilter): AlertListResponse {
  let alerts = Array.from(activeAlerts.values());

  // Apply filters
  if (filter?.type?.length) {
    alerts = alerts.filter((a) => filter.type!.includes(a.type));
  }
  if (filter?.severity?.length) {
    alerts = alerts.filter((a) => filter.severity!.includes(a.severity));
  }
  if (filter?.acknowledged !== undefined) {
    alerts = alerts.filter((a) => a.acknowledged === filter.acknowledged);
  }
  if (filter?.since) {
    alerts = alerts.filter((a) => a.createdAt >= filter.since!);
  }
  if (filter?.until) {
    alerts = alerts.filter((a) => a.createdAt <= filter.until!);
  }

  // Sort by severity (most severe first), then by time (most recent first)
  alerts.sort((a, b) => {
    const severityDiff =
      SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
    if (severityDiff !== 0) return severityDiff;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  const total = alerts.length;
  const limit = filter?.limit ?? 50;
  let startIndex = 0;

  if (filter?.cursor) {
    const parsed = parseInt(filter.cursor, 10);
    if (!Number.isNaN(parsed)) {
      startIndex = parsed;
    }
  }

  const paginatedAlerts = alerts.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < total;

  return {
    alerts: paginatedAlerts,
    pagination: {
      ...(hasMore && { cursor: String(startIndex + limit) }),
      hasMore,
      total,
    },
  };
}

/**
 * Get alert history.
 */
export function getAlertHistory(filter?: AlertFilter): AlertListResponse {
  let alerts = [...alertHistory];

  // Apply filters
  if (filter?.type?.length) {
    alerts = alerts.filter((a) => filter.type!.includes(a.type));
  }
  if (filter?.severity?.length) {
    alerts = alerts.filter((a) => filter.severity!.includes(a.severity));
  }
  if (filter?.since) {
    alerts = alerts.filter((a) => a.createdAt >= filter.since!);
  }
  if (filter?.until) {
    alerts = alerts.filter((a) => a.createdAt <= filter.until!);
  }

  const total = alerts.length;
  const limit = filter?.limit ?? 50;
  let startIndex = 0;

  if (filter?.cursor) {
    const parsed = parseInt(filter.cursor, 10);
    if (!Number.isNaN(parsed)) {
      startIndex = parsed;
    }
  }

  const paginatedAlerts = alerts.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < total;

  return {
    alerts: paginatedAlerts,
    pagination: {
      ...(hasMore && { cursor: String(startIndex + limit) }),
      hasMore,
      total,
    },
  };
}

/**
 * Get an alert by ID.
 */
export function getAlert(alertId: string): Alert | undefined {
  return (
    activeAlerts.get(alertId) ?? alertHistory.find((a) => a.id === alertId)
  );
}

/**
 * Acknowledge an alert.
 */
export function acknowledgeAlert(
  alertId: string,
  acknowledgedBy?: string,
): Alert | undefined {
  const alert = activeAlerts.get(alertId);
  if (!alert) return undefined;

  alert.acknowledged = true;
  alert.acknowledgedAt = new Date();
  alert.acknowledgedBy = acknowledgedBy;

  const log = getLogger();
  log.info({
    type: "alert:acknowledged",
    alertId,
    acknowledgedBy,
    correlationId: getCorrelationId(),
  });

  return alert;
}

/**
 * Dismiss an alert (removes from active).
 */
export function dismissAlert(
  alertId: string,
  dismissedBy?: string,
): Alert | undefined {
  const alert = activeAlerts.get(alertId);
  if (!alert) return undefined;

  alert.dismissedAt = new Date();
  alert.dismissedBy = dismissedBy;
  activeAlerts.delete(alertId);

  const log = getLogger();
  log.info({
    type: "alert:dismissed",
    alertId,
    dismissedBy,
    correlationId: getCorrelationId(),
  });

  return alert;
}

/**
 * Register an alert listener.
 */
export function onAlert(listener: AlertListener): () => void {
  listeners.push(listener);
  return () => {
    const index = listeners.indexOf(listener);
    if (index >= 0) {
      listeners.splice(index, 1);
    }
  };
}

/**
 * Clear all alerts (for testing).
 */
export function clearAlerts(): void {
  activeAlerts.clear();
  alertHistory.length = 0;
  lastAlertTime.clear();
}

/**
 * Clear all alert rules (for testing).
 */
export function clearAlertRules(): void {
  alertRules.clear();
}

// ============================================================================
// Default Alert Rules
// ============================================================================

/**
 * Initialize default alert rules.
 */
export function initializeDefaultAlertRules(): void {
  // Agent stalled - no activity for 5+ minutes
  registerAlertRule({
    id: "agent_stalled",
    name: "Agent Stalled",
    enabled: true,
    description: "Fires when an agent shows no output for 5+ minutes",
    type: "agent_stalled",
    severity: "warning",
    cooldown: 10 * 60 * 1000, // 10 minutes
    condition: (ctx) => {
      // Would need to track per-agent last activity
      return false;
    },
    title: "Agent may be stalled",
    message: (ctx) => `Agent has shown no output for over 5 minutes`,
    source: "agent_monitor",
    actions: [
      { id: "interrupt", label: "Interrupt Agent", type: "custom" },
      { id: "terminate", label: "Terminate Agent", type: "custom" },
    ],
  });

  // Quota warning - 80%+ usage
  registerAlertRule({
    id: "quota_warning",
    name: "Quota Warning",
    enabled: true,
    description: "Fires when account quota reaches 80%",
    type: "quota_warning",
    severity: "warning",
    cooldown: 60 * 60 * 1000, // 1 hour
    condition: (ctx) => ctx.metrics.tokens.quotaUsedPercent >= 80,
    title: "API quota reaching limit",
    message: (ctx) =>
      `API quota is at ${ctx.metrics.tokens.quotaUsedPercent.toFixed(1)}% usage`,
    source: "quota_monitor",
  });

  // Quota exceeded - 100% usage
  registerAlertRule({
    id: "quota_exceeded",
    name: "Quota Exceeded",
    enabled: true,
    description: "Fires when account quota is exhausted",
    type: "quota_exceeded",
    severity: "error",
    cooldown: 15 * 60 * 1000, // 15 minutes
    condition: (ctx) => ctx.metrics.tokens.quotaUsedPercent >= 100,
    title: "API quota exhausted",
    message: "API quota has been exhausted. Agent operations may fail.",
    source: "quota_monitor",
    actions: [{ id: "upgrade", label: "Upgrade Plan", type: "link" }],
  });

  // High error rate
  registerAlertRule({
    id: "high_error_rate",
    name: "High Error Rate",
    enabled: true,
    description: "Fires when API error rate exceeds 10%",
    type: "system_health",
    severity: "error",
    cooldown: 5 * 60 * 1000, // 5 minutes
    condition: (ctx) => ctx.metrics.performance.successRate < 90,
    title: "High API error rate detected",
    message: (ctx) =>
      `API success rate is ${ctx.metrics.performance.successRate.toFixed(1)}%`,
    source: "api_monitor",
  });

  // High latency
  registerAlertRule({
    id: "high_latency",
    name: "High Latency",
    enabled: true,
    description: "Fires when average response time exceeds 1 second",
    type: "system_health",
    severity: "warning",
    cooldown: 5 * 60 * 1000, // 5 minutes
    condition: (ctx) => ctx.metrics.performance.avgResponseMs > 1000,
    title: "High API latency detected",
    message: (ctx) =>
      `Average response time is ${ctx.metrics.performance.avgResponseMs.toFixed(0)}ms`,
    source: "api_monitor",
  });

  // High memory usage
  registerAlertRule({
    id: "high_memory",
    name: "High Memory Usage",
    enabled: true,
    description: "Fires when memory usage exceeds 1GB",
    type: "system_health",
    severity: "warning",
    cooldown: 10 * 60 * 1000, // 10 minutes
    condition: (ctx) => ctx.metrics.system.memoryUsageMb > 1024,
    title: "High memory usage",
    message: (ctx) => `Memory usage is ${ctx.metrics.system.memoryUsageMb}MB`,
    source: "system_monitor",
  });

  logger.info(
    { ruleCount: alertRules.size },
    "Default alert rules initialized",
  );
}

// Initialize rules on module load
initializeDefaultAlertRules();
