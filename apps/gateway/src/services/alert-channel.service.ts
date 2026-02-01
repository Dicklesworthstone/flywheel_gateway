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
// In-Memory Storage (TODO: migrate to database in production)
// ============================================================================

const channels = new Map<string, AlertChannel>();
const rules = new Map<string, AlertRoutingRule>();
const deliveries = new Map<string, AlertDeliveryRecord>();

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

  log.info(
    { channelId: channel.id, name: channel.name, type: channel.type },
    "[ALERT_CHANNEL] Channel created",
  );

  return channel;
}

export function getChannel(id: string): AlertChannel | undefined {
  return channels.get(id);
}

export function listChannels(filter?: {
  type?: string;
  enabled?: boolean;
}): AlertChannel[] {
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

  log.info({ channelId: id, update }, "[ALERT_CHANNEL] Channel updated");

  return channel;
}

export function deleteChannel(id: string): boolean {
  const log = getLogger();
  const deleted = channels.delete(id);

  if (deleted) {
    log.info({ channelId: id }, "[ALERT_CHANNEL] Channel deleted");
  }

  return deleted;
}

export async function testChannel(id: string): Promise<DeliveryResult> {
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

  log.info(
    { ruleId: rule.id, name: rule.name },
    "[ALERT_CHANNEL] Routing rule created",
  );

  return rule;
}

export function getRule(id: string): AlertRoutingRule | undefined {
  return rules.get(id);
}

export function listRules(filter?: { enabled?: boolean }): AlertRoutingRule[] {
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

  log.info({ ruleId: id }, "[ALERT_CHANNEL] Routing rule updated");

  return rule;
}

export function deleteRule(id: string): boolean {
  const log = getLogger();
  const deleted = rules.delete(id);

  if (deleted) {
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

/**
 * Deliver an alert to a specific channel.
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
    return;
  }

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
      channel.successCount++;
      channel.lastSuccessAt = new Date();
      channel.currentMinuteCount++;
    } else {
      if (result.error !== undefined) record.lastError = result.error;
      if (result.errorCode !== undefined)
        record.lastErrorCode = result.errorCode;

      // Retry logic
      if (record.attempts < record.maxAttempts) {
        record.status = "pending";
        // Exponential backoff: 1s, 2s, 4s...
        const backoffMs = 1000 * 2 ** (record.attempts - 1);
        record.nextRetryAt = new Date(Date.now() + backoffMs);

        log.warn(
          {
            alertId: alert.id,
            channelId: channel.id,
            attempt: record.attempts,
            nextRetryAt: record.nextRetryAt,
          },
          "[ALERT_CHANNEL] Delivery failed, scheduling retry",
        );
      } else {
        record.status = "failed";
        channel.errorCount++;
        channel.lastErrorAt = new Date();
        if (result.error !== undefined) channel.lastError = result.error;

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
    }
  } catch (error) {
    record.status = "failed";
    record.lastError = String(error);
    record.lastErrorCode = "EXCEPTION";
    channel.errorCount++;
    channel.lastErrorAt = new Date();
    channel.lastError = String(error);

    log.error(
      { alertId: alert.id, channelId: channel.id, error: String(error) },
      "[ALERT_CHANNEL] Delivery exception",
    );
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
}

export function clearAllRules(): void {
  rules.clear();
}

export function clearAllDeliveries(): void {
  deliveries.clear();
}
