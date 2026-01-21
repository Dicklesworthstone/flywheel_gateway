/**
 * Alert Data Model
 *
 * Defines the structure for alerts and alert rules.
 */

/**
 * Alert severity levels.
 */
export type AlertSeverity = "info" | "warning" | "error" | "critical";

/**
 * Alert types.
 */
export type AlertType =
  | "agent_error"
  | "agent_stalled"
  | "quota_warning"
  | "quota_exceeded"
  | "daemon_failed"
  | "security_violation"
  | "system_health"
  | "custom";

/**
 * An alert instance.
 */
export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  source: string;
  createdAt: Date;
  expiresAt?: Date;
  acknowledged: boolean;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  dismissedAt?: Date;
  dismissedBy?: string;
  actions?: AlertAction[];
  metadata?: Record<string, unknown>;
  correlationId: string;
}

/**
 * An action that can be taken on an alert.
 */
export interface AlertAction {
  id: string;
  label: string;
  description?: string;
  type: "dismiss" | "retry" | "escalate" | "link" | "custom";
  payload?: Record<string, unknown>;
}

/**
 * Context provided to alert rule evaluation.
 */
export interface AlertContext {
  /** Current metric values */
  metrics: {
    agents: {
      total: number;
      byStatus: Record<string, number>;
    };
    tokens: {
      last24h: number;
      quotaUsedPercent: number;
    };
    performance: {
      avgResponseMs: number;
      successRate: number;
      errorCount: number;
    };
    system: {
      memoryUsageMb: number;
      cpuPercent: number;
      wsConnections: number;
    };
  };
  /** Previous alert for this rule (if any) */
  previousAlert?: Alert;
  /** Correlation ID for logging */
  correlationId: string;
  /** Current timestamp */
  timestamp: Date;
  /** Optional NTM signals */
  ntm?: {
    isWorking?: NtmIsWorkingContext;
  };
}

/**
 * NTM is-working context for alert rules.
 */
export interface NtmIsWorkingContext {
  checkedAt: Date;
  agents: Record<
    string,
    {
      isWorking: boolean;
      isIdle: boolean;
      isRateLimited: boolean;
      isContextLow: boolean;
      confidence: number;
      recommendation: string;
      recommendationReason: string;
    }
  >;
  summary?: {
    totalAgents: number;
    workingCount: number;
    idleCount: number;
    rateLimitedCount: number;
    contextLowCount: number;
    errorCount: number;
  };
}

/**
 * Alert rule definition.
 */
export interface AlertRule {
  /** Unique rule identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Whether the rule is enabled */
  enabled: boolean;
  /** Rule description */
  description?: string;
  /** Condition function - returns true if alert should fire */
  condition: (context: AlertContext) => boolean;
  /** Alert severity when fired */
  severity: AlertSeverity;
  /** Alert type */
  type: AlertType;
  /** Title (static or dynamic) */
  title: string | ((context: AlertContext) => string);
  /** Message (static or dynamic) */
  message: string | ((context: AlertContext) => string);
  /** Optional metadata for alert consumers */
  metadata?: (context: AlertContext) => Record<string, unknown> | undefined;
  /** Minimum time between alerts in ms (cooldown) */
  cooldown?: number;
  /** Source identifier */
  source?: string;
  /** Available actions for this alert type */
  actions?: AlertAction[];
}

/**
 * Alert rule update request.
 */
export interface AlertRuleUpdate {
  enabled?: boolean;
  cooldown?: number;
  severity?: AlertSeverity;
}

/**
 * Alert filter options.
 */
export interface AlertFilter {
  type?: AlertType[];
  severity?: AlertSeverity[];
  acknowledged?: boolean;
  since?: Date;
  until?: Date;
  limit?: number;
  startingAfter?: string;
  endingBefore?: string;
}

/**
 * Paginated alert response.
 */
export interface AlertListResponse {
  alerts: Alert[];
  hasMore: boolean;
  total: number;
  nextCursor?: string;
  prevCursor?: string;
}

/**
 * Default cooldown period (5 minutes).
 */
export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Severity order for sorting (higher = more severe).
 */
export const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};
