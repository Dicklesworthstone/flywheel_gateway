/**
 * Alert Channel Service
 *
 * Manages external alert channels (webhook, Slack, Discord) with:
 * - Channel CRUD operations
 * - Routing rules engine
 * - Delivery tracking and health monitoring
 * - Throttling to prevent alert storms
 *
 * @see bd-3c0o3 Real-time Alert Channels bead
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../db/connection";
import {
  alertChannels as alertChannelsTable,
  alertDeliveries as alertDeliveriesTable,
  alertRoutingRules as alertRoutingRulesTable,
} from "../db/schema/alert-channels";
import { getLogger } from "../middleware/correlation";
import {
  type AlertPayload,
  type DeliveryResult,
  getAdapter,
  getSupportedChannelTypes,
} from "./alert-adapters";

// Re-export types needed by routes
export type { AlertPayload };

// ============================================================================
// Types
// ============================================================================

export interface AlertChannel {
  id: string;
  name: string;
  description?: string;
  type: "webhook" | "slack" | "discord";
  config: Record<string, unknown>;
  enabled: boolean;
  // Health tracking
  lastSuccessAt?: Date;
  lastErrorAt?: Date;
  lastError?: string;
  errorCount: number;
  successCount: number;
  // Rate limiting
  rateLimitPerMinute: number;
  currentMinuteCount: number;
  lastRateLimitResetAt?: Date;
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface AlertRoutingRule {
  id: string;
  name: string;
  description?: string;
  priority: number;
  condition: RoutingCondition;
  channelIds: string[];
  // Throttling
  throttleWindowSeconds: number;
  throttleMaxAlerts: number;
  currentThrottleCount: number;
  throttleWindowStart?: Date;
  // Aggregation
  aggregateEnabled: boolean;
  aggregateWindowSeconds: number;
  aggregateMaxAlerts: number;
  // Status
  enabled: boolean;
  matchCount: number;
  lastMatchAt?: Date;
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface RoutingCondition {
  alertTypes?: string[];
  categories?: string[];
  severities?: Array<"critical" | "error" | "warning" | "info" | "low">;
  minSeverity?: "critical" | "error" | "warning" | "info" | "low";
  metadataMatch?: Array<{
    field: string;
    operator: "eq" | "neq" | "contains" | "startsWith" | "matches";
    value: string;
  }>;
}

export interface CreateChannelRequest {
  name: string;
  description?: string;
  type: "webhook" | "slack" | "discord";
  config: Record<string, unknown>;
  enabled?: boolean;
  rateLimitPerMinute?: number;
}

export interface UpdateChannelRequest {
  name?: string;
  description?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
  rateLimitPerMinute?: number;
}

export interface CreateRuleRequest {
  name: string;
  description?: string;
  priority?: number;
  condition: RoutingCondition;
  channelIds: string[];
  throttleWindowSeconds?: number;
  throttleMaxAlerts?: number;
  aggregateEnabled?: boolean;
  aggregateWindowSeconds?: number;
  aggregateMaxAlerts?: number;
  enabled?: boolean;
}

export interface AlertDeliveryRecord {
  id: string;
  alertId: string;
  channelId: string;
  ruleId?: string;
  status: "pending" | "sent" | "failed" | "throttled";
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: Date;
  lastError?: string;
  lastErrorCode?: string;
  createdAt: Date;
  sentAt?: Date;
  durationMs?: number;
  responseStatus?: number;
}

// ============================================================================
// Credential Encryption (AES-256-GCM at rest) & SQLite Storage
// ============================================================================

const ENCRYPTION_PREFIX = "enc:v1:";

function getEncryptionKey(): Buffer {
  const secret =
    process.env["ALERT_CHANNEL_ENCRYPTION_KEY"] ??
    process.env["FLYWHEEL_SECRET_KEY"] ??
    "flywheel-gateway-default-alert-channel-key";
  return createHash("sha256").update(secret).digest();
}

export function encryptChannelConfig(config: Record<string, unknown>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const plaintext = JSON.stringify(config);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${ENCRYPTION_PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptChannelConfig(stored: string): Record<string, unknown> {
  if (!stored.startsWith(ENCRYPTION_PREFIX)) {
    return JSON.parse(stored) as Record<string, unknown>;
  }
  const rest = stored.slice(ENCRYPTION_PREFIX.length);
  const [ivHex, tagHex, dataHex] = rest.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Invalid encrypted channel config format");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as Record<string, unknown>;
}

const channels = new Map<string, AlertChannel>();
const rules = new Map<string, AlertRoutingRule>();
const deliveries = new Map<string, AlertDeliveryRecord>();

let tablesEnsured = false;
let hydratedFromDb = false;

function ensureAlertChannelTables(): void {
  if (tablesEnsured) return;
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS alert_channels (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL,
        config TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_success_at INTEGER,
        last_error_at INTEGER,
        last_error TEXT,
        error_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        rate_limit_per_minute INTEGER DEFAULT 60,
        last_rate_limit_reset_at INTEGER,
        current_minute_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS alert_channels_name_idx ON alert_channels (name);
      CREATE TABLE IF NOT EXISTS alert_routing_rules (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        priority INTEGER NOT NULL DEFAULT 100,
        condition TEXT NOT NULL,
        channel_ids TEXT NOT NULL,
        throttle_window_seconds INTEGER DEFAULT 60,
        throttle_max_alerts INTEGER DEFAULT 10,
        current_throttle_count INTEGER NOT NULL DEFAULT 0,
        throttle_window_start INTEGER,
        aggregate_enabled INTEGER NOT NULL DEFAULT 0,
        aggregate_window_seconds INTEGER DEFAULT 60,
        aggregate_max_alerts INTEGER DEFAULT 5,
        enabled INTEGER NOT NULL DEFAULT 1,
        match_count INTEGER NOT NULL DEFAULT 0,
        last_match_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS alert_routing_rules_name_idx ON alert_routing_rules (name);
      CREATE TABLE IF NOT EXISTS alert_deliveries (
        id TEXT PRIMARY KEY NOT NULL,
        alert_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        rule_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        next_retry_at INTEGER,
        last_error TEXT,
        last_error_code TEXT,
        created_at INTEGER NOT NULL,
        sent_at INTEGER,
        duration_ms INTEGER,
        response_status INTEGER,
        response_body TEXT
      );
    `);
    tablesEnsured = true;
  } catch {
    // Fallback to in-memory if sqlite is unavailable
  }
}

function hydrateFromDbIfNeeded(): void {
  if (hydratedFromDb) return;
  ensureAlertChannelTables();
  hydratedFromDb = true;
  try {
    const dbChannels = db.select().from(alertChannelsTable).all();
    for (const row of dbChannels) {
      if (channels.has(row.id)) continue;
      const channel: AlertChannel = {
        id: row.id,
        name: row.name,
        ...(row.description !== null && { description: row.description }),
        type: row.type as AlertChannel["type"],
        config: decryptChannelConfig(row.config),
        enabled: row.enabled,
        ...(row.lastSuccessAt !== null && { lastSuccessAt: row.lastSuccessAt }),
        ...(row.lastErrorAt !== null && { lastErrorAt: row.lastErrorAt }),
        ...(row.lastError !== null && { lastError: row.lastError }),
        errorCount: row.errorCount,
        successCount: row.successCount,
        rateLimitPerMinute: row.rateLimitPerMinute ?? 60,
        currentMinuteCount: row.currentMinuteCount,
        ...(row.lastRateLimitResetAt !== null && {
          lastRateLimitResetAt: row.lastRateLimitResetAt,
        }),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
      channels.set(channel.id, channel);
    }

    const dbRules = db.select().from(alertRoutingRulesTable).all();
    for (const row of dbRules) {
      if (rules.has(row.id)) continue;
      const rule: AlertRoutingRule = {
        id: row.id,
        name: row.name,
        ...(row.description !== null && { description: row.description }),
        priority: row.priority,
        condition: JSON.parse(row.condition) as RoutingCondition,
        channelIds: JSON.parse(row.channelIds) as string[],
        throttleWindowSeconds: row.throttleWindowSeconds ?? 60,
        throttleMaxAlerts: row.throttleMaxAlerts ?? 10,
        currentThrottleCount: row.currentThrottleCount,
        ...(row.throttleWindowStart !== null && {
          throttleWindowStart: row.throttleWindowStart,
        }),
        aggregateEnabled: row.aggregateEnabled,
        aggregateWindowSeconds: row.aggregateWindowSeconds ?? 60,
        aggregateMaxAlerts: row.aggregateMaxAlerts ?? 5,
        enabled: row.enabled,
        matchCount: row.matchCount,
        ...(row.lastMatchAt !== null && { lastMatchAt: row.lastMatchAt }),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
      rules.set(rule.id, rule);
    }
  } catch {
    // Non-fatal if DB read fails
  }
}

function persistChannel(channel: AlertChannel): void {
  ensureAlertChannelTables();
  try {
    db.insert(alertChannelsTable)
      .values({
        id: channel.id,
        name: channel.name,
        description: channel.description ?? null,
        type: channel.type,
        config: encryptChannelConfig(channel.config),
        enabled: channel.enabled,
        lastSuccessAt: channel.lastSuccessAt ?? null,
        lastErrorAt: channel.lastErrorAt ?? null,
        lastError: channel.lastError ?? null,
        errorCount: channel.errorCount,
        successCount: channel.successCount,
        rateLimitPerMinute: channel.rateLimitPerMinute,
        lastRateLimitResetAt: channel.lastRateLimitResetAt ?? null,
        currentMinuteCount: channel.currentMinuteCount,
        createdAt: channel.createdAt,
        updatedAt: channel.updatedAt,
      })
      .onConflictDoUpdate({
        target: alertChannelsTable.id,
        set: {
          name: channel.name,
          description: channel.description ?? null,
          config: encryptChannelConfig(channel.config),
          enabled: channel.enabled,
          lastSuccessAt: channel.lastSuccessAt ?? null,
          lastErrorAt: channel.lastErrorAt ?? null,
          lastError: channel.lastError ?? null,
          errorCount: channel.errorCount,
          successCount: channel.successCount,
          rateLimitPerMinute: channel.rateLimitPerMinute,
          lastRateLimitResetAt: channel.lastRateLimitResetAt ?? null,
          currentMinuteCount: channel.currentMinuteCount,
          updatedAt: channel.updatedAt,
        },
      })
      .run();
  } catch {
    // Non-fatal
  }
}

function persistRule(rule: AlertRoutingRule): void {
  ensureAlertChannelTables();
  try {
    db.insert(alertRoutingRulesTable)
      .values({
        id: rule.id,
        name: rule.name,
        description: rule.description ?? null,
        priority: rule.priority,
        condition: JSON.stringify(rule.condition),
        channelIds: JSON.stringify(rule.channelIds),
        throttleWindowSeconds: rule.throttleWindowSeconds,
        throttleMaxAlerts: rule.throttleMaxAlerts,
        currentThrottleCount: rule.currentThrottleCount,
        throttleWindowStart: rule.throttleWindowStart ?? null,
        aggregateEnabled: rule.aggregateEnabled,
        aggregateWindowSeconds: rule.aggregateWindowSeconds,
        aggregateMaxAlerts: rule.aggregateMaxAlerts,
        enabled: rule.enabled,
        matchCount: rule.matchCount,
        lastMatchAt: rule.lastMatchAt ?? null,
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt,
      })
      .onConflictDoUpdate({
        target: alertRoutingRulesTable.id,
        set: {
          name: rule.name,
          description: rule.description ?? null,
          priority: rule.priority,
          condition: JSON.stringify(rule.condition),
          channelIds: JSON.stringify(rule.channelIds),
          throttleWindowSeconds: rule.throttleWindowSeconds,
          throttleMaxAlerts: rule.throttleMaxAlerts,
          currentThrottleCount: rule.currentThrottleCount,
          throttleWindowStart: rule.throttleWindowStart ?? null,
          aggregateEnabled: rule.aggregateEnabled,
          aggregateWindowSeconds: rule.aggregateWindowSeconds,
          aggregateMaxAlerts: rule.aggregateMaxAlerts,
          enabled: rule.enabled,
          matchCount: rule.matchCount,
          lastMatchAt: rule.lastMatchAt ?? null,
          updatedAt: rule.updatedAt,
        },
      })
      .run();
  } catch {
    // Non-fatal
  }
}

function persistDelivery(record: AlertDeliveryRecord): void {
  ensureAlertChannelTables();
  try {
    db.insert(alertDeliveriesTable)
      .values({
        id: record.id,
        alertId: record.alertId,
        channelId: record.channelId,
        ruleId: record.ruleId ?? null,
        status: record.status,
        attempts: record.attempts,
        maxAttempts: record.maxAttempts,
        nextRetryAt: record.nextRetryAt ?? null,
        lastError: record.lastError ?? null,
        lastErrorCode: record.lastErrorCode ?? null,
        createdAt: record.createdAt,
        sentAt: record.sentAt ?? null,
        durationMs: record.durationMs ?? null,
        responseStatus: record.responseStatus ?? null,
        responseBody: null,
      })
      .onConflictDoUpdate({
        target: alertDeliveriesTable.id,
        set: {
          status: record.status,
          attempts: record.attempts,
          nextRetryAt: record.nextRetryAt ?? null,
          lastError: record.lastError ?? null,
          lastErrorCode: record.lastErrorCode ?? null,
          sentAt: record.sentAt ?? null,
          durationMs: record.durationMs ?? null,
          responseStatus: record.responseStatus ?? null,
        },
      })
      .run();
  } catch {
    // Non-fatal
  }
}

// Severity order for comparison
const SEVERITY_ORDER: Record<string, number> = {
  low: 0,
  info: 1,
  warning: 2,
  error: 3,
  critical: 4,
};

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(prefix: string): string {
  const randomBytes = new Uint8Array(6);
  crypto.getRandomValues(randomBytes);
  const random = Array.from(randomBytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 8);
  return `${prefix}_${Date.now()}_${random}`;
}

function matchesCondition(
  alert: AlertPayload,
  condition: RoutingCondition,
): boolean {
  // Check alert types
  if (
    condition.alertTypes?.length &&
    !condition.alertTypes.includes(alert.type)
  ) {
    return false;
  }

  // Check categories
  if (condition.categories?.length) {
    if (!alert.category || !condition.categories.includes(alert.category)) {
      return false;
    }
  }

  // Check specific severities
  if (
    condition.severities?.length &&
    !condition.severities.includes(alert.severity)
  ) {
    return false;
  }

  // Check minimum severity
  if (condition.minSeverity) {
    const alertLevel = SEVERITY_ORDER[alert.severity] ?? 0;
    const minLevel = SEVERITY_ORDER[condition.minSeverity] ?? 0;
    if (alertLevel < minLevel) {
      return false;
    }
  }

  // Check metadata matches
  if (condition.metadataMatch?.length && alert.metadata) {
    for (const match of condition.metadataMatch) {
      const value = alert.metadata[match.field];
      if (value === undefined) return false;

      const strValue = String(value);
      switch (match.operator) {
        case "eq":
          if (strValue !== match.value) return false;
          break;
        case "neq":
          if (strValue === match.value) return false;
          break;
        case "contains":
          if (!strValue.includes(match.value)) return false;
          break;
        case "startsWith":
          if (!strValue.startsWith(match.value)) return false;
          break;
        case "matches":
          try {
            if (!new RegExp(match.value).test(strValue)) return false;
          } catch {
            return false;
          }
          break;
      }
    }
  }

  return true;
}

function isThrottled(rule: AlertRoutingRule): boolean {
  if (!rule.throttleMaxAlerts || rule.throttleMaxAlerts <= 0) return false;

  const now = new Date();
  const windowStart = rule.throttleWindowStart;
  const windowMs = (rule.throttleWindowSeconds || 60) * 1000;

  // Reset window if expired
  if (!windowStart || now.getTime() - windowStart.getTime() > windowMs) {
    rule.throttleWindowStart = now;
    rule.currentThrottleCount = 0;
    return false;
  }

  return rule.currentThrottleCount >= rule.throttleMaxAlerts;
}

function isRateLimited(channel: AlertChannel): boolean {
  if (!channel.rateLimitPerMinute || channel.rateLimitPerMinute <= 0)
    return false;

  const now = new Date();
  const resetTime = channel.lastRateLimitResetAt;

  // Reset counter if more than a minute has passed
  if (!resetTime || now.getTime() - resetTime.getTime() > 60_000) {
    channel.lastRateLimitResetAt = now;
    channel.currentMinuteCount = 0;
    return false;
  }

  return channel.currentMinuteCount >= channel.rateLimitPerMinute;
}

// ============================================================================
// Channel Management
// ============================================================================

export function createChannel(request: CreateChannelRequest): AlertChannel {
  hydrateFromDbIfNeeded();
  const log = getLogger();

  // Validate channel type
  if (!getSupportedChannelTypes().includes(request.type)) {
    throw new Error(`Unsupported channel type: ${request.type}`);
  }

  // Validate config
  const adapter = getAdapter(request.type);
  if (!adapter?.validateConfig(request.config)) {
    throw new Error(`Invalid configuration for channel type: ${request.type}`);
  }

  // Check for duplicate name
  for (const channel of channels.values()) {
    if (channel.name === request.name) {
      throw new Error(`Channel with name "${request.name}" already exists`);
    }
  }

  const now = new Date();
  const channel: AlertChannel = {
    id: generateId("ch"),
    name: request.name,
    ...(request.description !== undefined && {
      description: request.description,
    }),
    type: request.type,
    config: request.config,
    enabled: request.enabled ?? true,
    errorCount: 0,
    successCount: 0,
    rateLimitPerMinute: request.rateLimitPerMinute ?? 60,
    currentMinuteCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  channels.set(channel.id, channel);
  persistChannel(channel);

  log.info(
    { channelId: channel.id, name: channel.name, type: channel.type },
    "[ALERT_CHANNEL] Channel created",
  );

  return channel;
}

export function getChannel(id: string): AlertChannel | undefined {
  hydrateFromDbIfNeeded();
  return channels.get(id);
}

export function listChannels(filter?: {
  type?: string;
  enabled?: boolean;
}): AlertChannel[] {
  hydrateFromDbIfNeeded();
  let result = Array.from(channels.values());

  if (filter?.type) {
    result = result.filter((c) => c.type === filter.type);
  }
  if (filter?.enabled !== undefined) {
    result = result.filter((c) => c.enabled === filter.enabled);
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export function updateChannel(
  id: string,
  update: UpdateChannelRequest,
): AlertChannel | undefined {
  hydrateFromDbIfNeeded();
  const channel = channels.get(id);
  if (!channel) return undefined;

  const log = getLogger();

  if (update.name !== undefined) {
    // Check for duplicate name
    for (const c of channels.values()) {
      if (c.id !== id && c.name === update.name) {
        throw new Error(`Channel with name "${update.name}" already exists`);
      }
    }
    channel.name = update.name;
  }

  if (update.description !== undefined) {
    channel.description = update.description;
  }

  if (update.config !== undefined) {
    const adapter = getAdapter(channel.type);
    if (!adapter?.validateConfig(update.config)) {
      throw new Error(
        `Invalid configuration for channel type: ${channel.type}`,
      );
    }
    channel.config = update.config;
  }

  if (update.enabled !== undefined) {
    channel.enabled = update.enabled;
  }

  if (update.rateLimitPerMinute !== undefined) {
    channel.rateLimitPerMinute = update.rateLimitPerMinute;
  }

  channel.updatedAt = new Date();
  persistChannel(channel);

  log.info({ channelId: id, update }, "[ALERT_CHANNEL] Channel updated");

  return channel;
}

export function deleteChannel(id: string): boolean {
  hydrateFromDbIfNeeded();
  const log = getLogger();
  const deleted = channels.delete(id);

  if (deleted) {
    try {
      db.delete(alertChannelsTable).where(eq(alertChannelsTable.id, id)).run();
    } catch {
      // Non-fatal
    }
    log.info({ channelId: id }, "[ALERT_CHANNEL] Channel deleted");
  }

  return deleted;
}

export async function testChannel(id: string): Promise<DeliveryResult> {
  hydrateFromDbIfNeeded();
  const channel = channels.get(id);
  if (!channel) {
    return {
      success: false,
      error: "Channel not found",
      errorCode: "NOT_FOUND",
      durationMs: 0,
    };
  }

  const adapter = getAdapter(channel.type);
  if (!adapter) {
    return {
      success: false,
      error: `No adapter found for channel type: ${channel.type}`,
      errorCode: "NO_ADAPTER",
      durationMs: 0,
    };
  }

  return adapter.testConnection(
    channel.config as Parameters<typeof adapter.testConnection>[0],
  );
}

// ============================================================================
// Routing Rules Management
// ============================================================================

export function createRule(request: CreateRuleRequest): AlertRoutingRule {
  hydrateFromDbIfNeeded();
  const log = getLogger();

  // Validate channel IDs
  for (const channelId of request.channelIds) {
    if (!channels.has(channelId)) {
      throw new Error(`Channel not found: ${channelId}`);
    }
  }

  // Check for duplicate name
  for (const rule of rules.values()) {
    if (rule.name === request.name) {
      throw new Error(`Rule with name "${request.name}" already exists`);
    }
  }

  const now = new Date();
  const rule: AlertRoutingRule = {
    id: generateId("rule"),
    name: request.name,
    ...(request.description !== undefined && {
      description: request.description,
    }),
    priority: request.priority ?? 100,
    condition: request.condition,
    channelIds: request.channelIds,
    throttleWindowSeconds: request.throttleWindowSeconds ?? 60,
    throttleMaxAlerts: request.throttleMaxAlerts ?? 10,
    currentThrottleCount: 0,
    aggregateEnabled: request.aggregateEnabled ?? false,
    aggregateWindowSeconds: request.aggregateWindowSeconds ?? 60,
    aggregateMaxAlerts: request.aggregateMaxAlerts ?? 5,
    enabled: request.enabled ?? true,
    matchCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  rules.set(rule.id, rule);
  persistRule(rule);

  log.info(
    { ruleId: rule.id, name: rule.name },
    "[ALERT_CHANNEL] Routing rule created",
  );

  return rule;
}

export function getRule(id: string): AlertRoutingRule | undefined {
  hydrateFromDbIfNeeded();
  return rules.get(id);
}

export function listRules(filter?: { enabled?: boolean }): AlertRoutingRule[] {
  hydrateFromDbIfNeeded();
  let result = Array.from(rules.values());

  if (filter?.enabled !== undefined) {
    result = result.filter((r) => r.enabled === filter.enabled);
  }

  return result.sort((a, b) => a.priority - b.priority);
}

export function updateRule(
  id: string,
  update: Partial<Omit<CreateRuleRequest, "channelIds">> & {
    channelIds?: string[];
  },
): AlertRoutingRule | undefined {
  hydrateFromDbIfNeeded();
  const rule = rules.get(id);
  if (!rule) return undefined;

  const log = getLogger();

  if (update.name !== undefined) {
    for (const r of rules.values()) {
      if (r.id !== id && r.name === update.name) {
        throw new Error(`Rule with name "${update.name}" already exists`);
      }
    }
    rule.name = update.name;
  }

  if (update.description !== undefined) rule.description = update.description;
  if (update.priority !== undefined) rule.priority = update.priority;
  if (update.condition !== undefined) rule.condition = update.condition;
  if (update.channelIds !== undefined) {
    for (const channelId of update.channelIds) {
      if (!channels.has(channelId)) {
        throw new Error(`Channel not found: ${channelId}`);
      }
    }
    rule.channelIds = update.channelIds;
  }
  if (update.throttleWindowSeconds !== undefined)
    rule.throttleWindowSeconds = update.throttleWindowSeconds;
  if (update.throttleMaxAlerts !== undefined)
    rule.throttleMaxAlerts = update.throttleMaxAlerts;
  if (update.aggregateEnabled !== undefined)
    rule.aggregateEnabled = update.aggregateEnabled;
  if (update.aggregateWindowSeconds !== undefined)
    rule.aggregateWindowSeconds = update.aggregateWindowSeconds;
  if (update.aggregateMaxAlerts !== undefined)
    rule.aggregateMaxAlerts = update.aggregateMaxAlerts;
  if (update.enabled !== undefined) rule.enabled = update.enabled;

  rule.updatedAt = new Date();
  persistRule(rule);

  log.info({ ruleId: id }, "[ALERT_CHANNEL] Routing rule updated");

  return rule;
}

export function deleteRule(id: string): boolean {
  hydrateFromDbIfNeeded();
  const log = getLogger();
  const deleted = rules.delete(id);

  if (deleted) {
    try {
      db.delete(alertRoutingRulesTable)
        .where(eq(alertRoutingRulesTable.id, id))
        .run();
    } catch {
      // Non-fatal
    }
    log.info({ ruleId: id }, "[ALERT_CHANNEL] Routing rule deleted");
  }

  return deleted;
}

// ============================================================================
// Alert Routing and Delivery
// ============================================================================

/**
 * Route an alert to matching channels based on configured rules.
 *
 * Returns the list of delivery records created.
 */
export async function routeAlert(
  alert: AlertPayload,
): Promise<AlertDeliveryRecord[]> {
  hydrateFromDbIfNeeded();
  const log = getLogger();
  const records: AlertDeliveryRecord[] = [];

  // Get all enabled rules, sorted by priority
  const enabledRules = listRules({ enabled: true });

  // Find all matching rules
  const matchedRules: AlertRoutingRule[] = [];
  for (const rule of enabledRules) {
    if (matchesCondition(alert, rule.condition)) {
      matchedRules.push(rule);
    }
  }

  if (matchedRules.length === 0) {
    log.debug(
      { alertId: alert.id, type: alert.type },
      "[ALERT_CHANNEL] No matching routing rules",
    );
    return records;
  }

  // Collect all unique channel IDs from matched rules
  const channelIdsToDeliver = new Set<string>();
  const rulesByChannel = new Map<string, AlertRoutingRule>();

  for (const rule of matchedRules) {
    // Check throttling
    if (isThrottled(rule)) {
      log.debug(
        { alertId: alert.id, ruleId: rule.id },
        "[ALERT_CHANNEL] Rule throttled, skipping",
      );
      continue;
    }

    // Update rule stats
    rule.matchCount++;
    rule.lastMatchAt = new Date();
    rule.currentThrottleCount++;
    persistRule(rule);

    for (const channelId of rule.channelIds) {
      channelIdsToDeliver.add(channelId);
      if (!rulesByChannel.has(channelId)) {
        rulesByChannel.set(channelId, rule);
      }
    }
  }

  // Deliver to each channel
  const deliveryPromises: Promise<void>[] = [];

  for (const channelId of channelIdsToDeliver) {
    const channel = channels.get(channelId);
    if (!channel || !channel.enabled) {
      log.debug(
        { channelId },
        "[ALERT_CHANNEL] Channel disabled or not found, skipping",
      );
      continue;
    }

    // Check rate limiting
    if (isRateLimited(channel)) {
      log.debug(
        { alertId: alert.id, channelId },
        "[ALERT_CHANNEL] Channel rate limited, throttling",
      );

      const ruleId = rulesByChannel.get(channelId)?.id;
      const record: AlertDeliveryRecord = {
        id: generateId("del"),
        alertId: alert.id,
        channelId,
        ...(ruleId !== undefined && { ruleId }),
        status: "throttled",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };
      deliveries.set(record.id, record);
      persistDelivery(record);
      records.push(record);
      continue;
    }

    // Create delivery record
    const ruleId = rulesByChannel.get(channelId)?.id;
    const record: AlertDeliveryRecord = {
      id: generateId("del"),
      alertId: alert.id,
      channelId,
      ...(ruleId !== undefined && { ruleId }),
      status: "pending",
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date(),
    };
    deliveries.set(record.id, record);
    persistDelivery(record);
    records.push(record);

    // Send asynchronously
    deliveryPromises.push(
      (async () => {
        await deliverToChannel(record, channel, alert);
      })(),
    );
  }

  // Wait for all deliveries (don't block main flow on failure)
  await Promise.allSettled(deliveryPromises);

  log.info(
    {
      alertId: alert.id,
      matchedRules: matchedRules.length,
      deliveries: records.length,
    },
    "[ALERT_CHANNEL] Alert routed",
  );

  return records;
}

const isTestEnv =
  process.env["BUN_TEST"] === "1" || process.env["NODE_ENV"] === "test";

/**
 * Deliver an alert to a specific channel with exponential backoff retries.
 */
async function deliverToChannel(
  record: AlertDeliveryRecord,
  channel: AlertChannel,
  alert: AlertPayload,
): Promise<void> {
  const log = getLogger();
  const adapter = getAdapter(channel.type);

  if (!adapter) {
    record.status = "failed";
    record.lastError = `No adapter for channel type: ${channel.type}`;
    record.lastErrorCode = "NO_ADAPTER";
    persistDelivery(record);
    return;
  }

  const baseDelayMs = isTestEnv ? 5 : 200;

  while (record.attempts < record.maxAttempts) {
    record.attempts++;

    try {
      const result = await adapter.send(
        alert,
        channel.config as Parameters<typeof adapter.send>[1],
      );

      record.durationMs = result.durationMs;
      if (result.responseStatus !== undefined) {
        record.responseStatus = result.responseStatus;
      }

      if (result.success) {
        record.status = "sent";
        record.sentAt = new Date();
        delete record.nextRetryAt;
        channel.successCount++;
        channel.lastSuccessAt = new Date();
        channel.currentMinuteCount++;
        persistChannel(channel);
        persistDelivery(record);
        return;
      }

      if (result.error !== undefined) record.lastError = result.error;
      if (result.errorCode !== undefined)
        record.lastErrorCode = result.errorCode;

      if (record.attempts < record.maxAttempts) {
        record.status = "pending";
        const backoffMs = baseDelayMs * 2 ** (record.attempts - 1);
        record.nextRetryAt = new Date(Date.now() + backoffMs);
        persistDelivery(record);

        log.warn(
          {
            alertId: alert.id,
            channelId: channel.id,
            attempt: record.attempts,
            nextRetryAt: record.nextRetryAt,
          },
          "[ALERT_CHANNEL] Delivery failed, retrying with backoff",
        );

        await Bun.sleep(backoffMs);
      } else {
        record.status = "failed";
        delete record.nextRetryAt;
        channel.errorCount++;
        channel.lastErrorAt = new Date();
        if (result.error !== undefined) channel.lastError = result.error;
        persistChannel(channel);
        persistDelivery(record);

        log.error(
          {
            alertId: alert.id,
            channelId: channel.id,
            attempts: record.attempts,
            error: result.error,
          },
          "[ALERT_CHANNEL] Delivery failed after max retries",
        );
      }
    } catch (error) {
      record.lastError = String(error);
      record.lastErrorCode = "EXCEPTION";

      if (record.attempts < record.maxAttempts) {
        record.status = "pending";
        const backoffMs = baseDelayMs * 2 ** (record.attempts - 1);
        record.nextRetryAt = new Date(Date.now() + backoffMs);
        persistDelivery(record);
        await Bun.sleep(backoffMs);
      } else {
        record.status = "failed";
        delete record.nextRetryAt;
        channel.errorCount++;
        channel.lastErrorAt = new Date();
        channel.lastError = String(error);
        persistChannel(channel);
        persistDelivery(record);

        log.error(
          { alertId: alert.id, channelId: channel.id, error: String(error) },
          "[ALERT_CHANNEL] Delivery exception",
        );
      }
    }
  }
}

// ============================================================================
// Health and Statistics
// ============================================================================

export interface ChannelHealth {
  channelId: string;
  name: string;
  type: string;
  enabled: boolean;
  successCount: number;
  errorCount: number;
  successRate: number;
  lastSuccessAt?: Date;
  lastErrorAt?: Date;
  lastError?: string;
  currentRateLimit: number;
  rateLimitPerMinute: number;
}

export function getChannelHealth(id: string): ChannelHealth | undefined {
  hydrateFromDbIfNeeded();
  const channel = channels.get(id);
  if (!channel) return undefined;

  const total = channel.successCount + channel.errorCount;
  const successRate = total > 0 ? channel.successCount / total : 1;

  const health: ChannelHealth = {
    channelId: channel.id,
    name: channel.name,
    type: channel.type,
    enabled: channel.enabled,
    successCount: channel.successCount,
    errorCount: channel.errorCount,
    successRate,
    currentRateLimit: channel.currentMinuteCount,
    rateLimitPerMinute: channel.rateLimitPerMinute,
  };

  if (channel.lastSuccessAt !== undefined)
    health.lastSuccessAt = channel.lastSuccessAt;
  if (channel.lastErrorAt !== undefined)
    health.lastErrorAt = channel.lastErrorAt;
  if (channel.lastError !== undefined) health.lastError = channel.lastError;

  return health;
}

export function getAllChannelHealth(): ChannelHealth[] {
  hydrateFromDbIfNeeded();
  return Array.from(channels.keys())
    .map((id) => getChannelHealth(id))
    .filter((h): h is ChannelHealth => h !== undefined);
}

// ============================================================================
// Delivery History
// ============================================================================

export function getDeliveries(filter?: {
  alertId?: string;
  channelId?: string;
  status?: AlertDeliveryRecord["status"];
  limit?: number;
}): AlertDeliveryRecord[] {
  let result = Array.from(deliveries.values());

  if (filter?.alertId) {
    result = result.filter((d) => d.alertId === filter.alertId);
  }
  if (filter?.channelId) {
    result = result.filter((d) => d.channelId === filter.channelId);
  }
  if (filter?.status) {
    result = result.filter((d) => d.status === filter.status);
  }

  // Sort by createdAt descending
  result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const limit = filter?.limit ?? 100;
  return result.slice(0, limit);
}

// ============================================================================
// Testing Utilities
// ============================================================================

export function clearAllChannels(): void {
  channels.clear();
  try {
    ensureAlertChannelTables();
    db.delete(alertChannelsTable).run();
  } catch {
    // Non-fatal
  }
}

export function clearAllRules(): void {
  rules.clear();
  try {
    ensureAlertChannelTables();
    db.delete(alertRoutingRulesTable).run();
  } catch {
    // Non-fatal
  }
}

export function clearAllDeliveries(): void {
  deliveries.clear();
  try {
    ensureAlertChannelTables();
    db.delete(alertDeliveriesTable).run();
  } catch {
    // Non-fatal
  }
}
