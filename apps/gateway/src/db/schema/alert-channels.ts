/**
 * Alert Channels Schema
 *
 * Database tables for external alert channel management:
 * - Alert channels (webhook, slack, discord)
 * - Routing rules for alert-to-channel mapping
 * - Delivery tracking for health monitoring
 *
 * @see bd-3c0o3 Real-time Alert Channels bead
 */

import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ============================================================================
// Alert Channels
// ============================================================================

/**
 * Configured external alert channels.
 *
 * Supports multiple channel types:
 * - webhook: Generic HTTP POST with configurable payload
 * - slack: Slack incoming webhook with Block Kit formatting
 * - discord: Discord webhook with embed support
 */
export const alertChannels = sqliteTable(
  "alert_channels",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),

    // Channel type: webhook | slack | discord
    type: text("type").notNull(),

    // Encrypted JSON configuration (type-specific)
    // webhook: { url, method?, headers?, payloadTemplate?, secret? }
    // slack: { webhookUrl, channel?, username?, iconEmoji? }
    // discord: { webhookUrl, username?, avatarUrl? }
    config: text("config").notNull(),

    // Status
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),

    // Health tracking
    lastSuccessAt: integer("last_success_at", { mode: "timestamp" }),
    lastErrorAt: integer("last_error_at", { mode: "timestamp" }),
    lastError: text("last_error"),
    errorCount: integer("error_count").notNull().default(0),
    successCount: integer("success_count").notNull().default(0),

    // Rate limiting
    rateLimitPerMinute: integer("rate_limit_per_minute").default(60),
    lastRateLimitResetAt: integer("last_rate_limit_reset_at", {
      mode: "timestamp",
    }),
    currentMinuteCount: integer("current_minute_count").notNull().default(0),

    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("alert_channels_type_idx").on(table.type),
    index("alert_channels_enabled_idx").on(table.enabled),
    uniqueIndex("alert_channels_name_idx").on(table.name),
  ],
);

// ============================================================================
// Alert Routing Rules
// ============================================================================

/**
 * Rules that determine which alerts go to which channels.
 *
 * Condition matching supports:
 * - Alert type/category matching
 * - Severity thresholds
 * - Metadata pattern matching
 * - Time-based rules
 */
export const alertRoutingRules = sqliteTable(
  "alert_routing_rules",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),

    // Priority (lower = evaluated first)
    priority: integer("priority").notNull().default(100),

    // Condition (JSON)
    // {
    //   alertTypes?: string[],
    //   categories?: string[],
    //   severities?: string[],
    //   minSeverity?: string,
    //   metadataMatch?: { field: string, operator: string, value: any }[],
    //   timeWindow?: { start: string, end: string, timezone?: string }
    // }
    condition: text("condition").notNull(),

    // Target channel IDs (JSON array)
    channelIds: text("channel_ids").notNull(),

    // Throttling
    throttleWindowSeconds: integer("throttle_window_seconds").default(60),
    throttleMaxAlerts: integer("throttle_max_alerts").default(10),
    currentThrottleCount: integer("current_throttle_count")
      .notNull()
      .default(0),
    throttleWindowStart: integer("throttle_window_start", {
      mode: "timestamp",
    }),

    // Aggregation (batch similar alerts)
    aggregateEnabled: integer("aggregate_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    aggregateWindowSeconds: integer("aggregate_window_seconds").default(60),
    aggregateMaxAlerts: integer("aggregate_max_alerts").default(5),

    // Status
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),

    // Statistics
    matchCount: integer("match_count").notNull().default(0),
    lastMatchAt: integer("last_match_at", { mode: "timestamp" }),

    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("alert_routing_rules_priority_idx").on(table.priority),
    index("alert_routing_rules_enabled_idx").on(table.enabled),
    uniqueIndex("alert_routing_rules_name_idx").on(table.name),
  ],
);

// ============================================================================
// Alert Deliveries
// ============================================================================

/**
 * Delivery tracking for alerts sent to external channels.
 *
 * Tracks each delivery attempt for:
 * - Health monitoring
 * - Retry logic
 * - Debugging delivery failures
 */
export const alertDeliveries = sqliteTable(
  "alert_deliveries",
  {
    id: text("id").primaryKey(),

    // References
    alertId: text("alert_id").notNull(),
    channelId: text("channel_id")
      .notNull()
      .references(() => alertChannels.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").references(() => alertRoutingRules.id, {
      onDelete: "set null",
    }),

    // Status: pending | sent | failed | throttled
    status: text("status").notNull().default("pending"),

    // Attempt tracking
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextRetryAt: integer("next_retry_at", { mode: "timestamp" }),

    // Error info
    lastError: text("last_error"),
    lastErrorCode: text("last_error_code"),

    // Timing
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    sentAt: integer("sent_at", { mode: "timestamp" }),
    durationMs: integer("duration_ms"),

    // Response info (for debugging)
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
  },
  (table) => [
    index("alert_deliveries_alert_idx").on(table.alertId),
    index("alert_deliveries_channel_idx").on(table.channelId),
    index("alert_deliveries_status_idx").on(table.status),
    index("alert_deliveries_created_at_idx").on(table.createdAt),
    index("alert_deliveries_next_retry_idx").on(table.nextRetryAt),
  ],
);

// ============================================================================
// Type exports for use in services
// ============================================================================

export type AlertChannel = typeof alertChannels.$inferSelect;
export type NewAlertChannel = typeof alertChannels.$inferInsert;

export type AlertRoutingRule = typeof alertRoutingRules.$inferSelect;
export type NewAlertRoutingRule = typeof alertRoutingRules.$inferInsert;

export type AlertDelivery = typeof alertDeliveries.$inferSelect;
export type NewAlertDelivery = typeof alertDeliveries.$inferInsert;
