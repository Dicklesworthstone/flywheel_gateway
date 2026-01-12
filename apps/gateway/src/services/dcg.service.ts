/**
 * DCG Service - Destructive Command Guard Integration.
 *
 * Provides visibility and governance for DCG (external Rust binary).
 * DCG mechanically enforces command safety at the execution boundary.
 * This service handles:
 * - Block event ingestion and storage
 * - Configuration management (packs, allowlists)
 * - Statistics and reporting
 * - WebSocket event publishing
 */

import { desc, eq } from "drizzle-orm";
import {
  createCursor,
  decodeCursor,
  DEFAULT_PAGINATION,
} from "@flywheel/shared/api/pagination";
import { db } from "../db";
import { dcgAllowlist, dcgBlocks } from "../db/schema";
import { getCorrelationId } from "../middleware/correlation";
import type { Channel } from "../ws/channels";
import { getHub } from "../ws/hub";
import type { MessageType } from "../ws/messages";
import * as dcgConfigService from "./dcg-config.service";
import { logger } from "./logger";

/**
 * Generate a cryptographically secure random ID.
 * Uses crypto.getRandomValues() for security-sensitive contexts.
 */
function generateId(prefix: string, length = 12): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(randomBytes[i]! % chars.length);
  }
  return `${prefix}_${result}`;
}

// ============================================================================
// Types
// ============================================================================

export type DCGSeverity = "critical" | "high" | "medium" | "low";
export type DCGContextClassification = "executed" | "data" | "ambiguous";

export interface DCGBlockEvent {
  id: string;
  timestamp: Date;
  agentId: string;
  command: string;
  pack: string;
  pattern: string;
  ruleId: string;
  severity: DCGSeverity;
  reason: string;
  contextClassification: DCGContextClassification;
  falsePositive?: boolean;
  allowlisted?: boolean;
}

export interface DCGAllowlistEntry {
  ruleId: string;
  pattern: string;
  addedAt: Date;
  addedBy: string;
  reason: string;
  expiresAt?: Date;
  condition?: string;
}

export interface DCGConfig {
  enabledPacks: string[];
  disabledPacks: string[];
  allowlist: DCGAllowlistEntry[];
}

export interface DCGStats {
  totalBlocks: number;
  blocksByPack: Record<string, number>;
  blocksBySeverity: Record<string, number>;
  falsePositiveRate: number;
  topBlockedCommands: Array<{ command: string; count: number }>;
}

export interface DCGPackInfo {
  name: string;
  description: string;
  enabled: boolean;
  patternCount: number;
}

// ============================================================================
// Known Packs (DCG defines these, we just track them)
// ============================================================================

const KNOWN_PACKS: Array<{ name: string; description: string }> = [
  {
    name: "core.git",
    description: "Dangerous git operations (force push, hard reset)",
  },
  {
    name: "core.filesystem",
    description: "Risky filesystem operations (rm -rf, chmod 777)",
  },
  {
    name: "core.network",
    description: "Network-related commands (curl to suspicious hosts)",
  },
  {
    name: "database.postgresql",
    description: "Dangerous PostgreSQL commands (DROP, TRUNCATE)",
  },
  { name: "database.mysql", description: "Dangerous MySQL commands" },
  { name: "database.sqlite", description: "SQLite destructive operations" },
  {
    name: "container.docker",
    description: "Risky Docker commands (--privileged, host network)",
  },
  { name: "container.kubernetes", description: "Dangerous kubectl commands" },
  { name: "cloud.aws", description: "Destructive AWS CLI commands" },
  { name: "cloud.gcp", description: "Destructive GCP commands" },
  { name: "secrets", description: "Commands that may expose secrets" },
];

// In-memory config cache (synced with persistent storage)
const currentConfig: DCGConfig = {
  enabledPacks: KNOWN_PACKS.map((p) => p.name),
  disabledPacks: [],
  allowlist: [],
};

// Promise cache for config sync to prevent race conditions
let syncPromise: Promise<void> | null = null;
let syncSucceeded = false;

/**
 * Sync in-memory config with persistent storage.
 * Called lazily on first access. Uses promise caching to prevent race conditions.
 * Allows retry if previous sync failed.
 */
async function syncConfigFromPersistent(): Promise<void> {
  // If sync already succeeded, don't retry
  if (syncSucceeded) return;

  // Return existing promise if sync is in progress
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    try {
      const persistedConfig = await dcgConfigService.getConfig();
      currentConfig.enabledPacks = persistedConfig.enabledPacks;
      currentConfig.disabledPacks = persistedConfig.disabledPacks;
      syncSucceeded = true;
      logger.debug("DCG config synced from persistent storage");
    } catch (error) {
      // Reset promise to allow retry on next call
      syncPromise = null;
      // In tests or if DB not available, use in-memory defaults
      logger.debug({ error }, "Using in-memory DCG config (DB sync failed)");
    }
  })();

  return syncPromise;
}

// In-memory block events (recent, for fast access)
const recentBlocks: DCGBlockEvent[] = [];
const MAX_RECENT_BLOCKS = 100;

// ============================================================================
// Block Event Handling
// ============================================================================

/**
 * Redact potentially sensitive information from a command string.
 */
function redactCommand(command: string): string {
  // Redact common secret patterns
  return command
    .replace(/(?<=password[=:])\S+/gi, "[REDACTED]")
    .replace(/(?<=api[_-]?key[=:])\S+/gi, "[REDACTED]")
    .replace(/(?<=token[=:])\S+/gi, "[REDACTED]")
    .replace(/(?<=secret[=:])\S+/gi, "[REDACTED]")
    .replace(/(?<=bearer\s)\S+/gi, "[REDACTED]")
    .replace(/(?<=authorization[=:]\s*)\S+/gi, "[REDACTED]");
}

/**
 * Ingest a DCG block event from the agent driver.
 */
export async function ingestBlockEvent(
  event: Omit<DCGBlockEvent, "id">,
): Promise<DCGBlockEvent> {
  const correlationId = getCorrelationId();
  const log = logger.child({ correlationId, agentId: event.agentId });

  const id = generateId("dcg");
  const blockEvent: DCGBlockEvent = {
    ...event,
    id,
    command: redactCommand(event.command),
  };

  // Store in recent blocks
  recentBlocks.unshift(blockEvent);
  if (recentBlocks.length > MAX_RECENT_BLOCKS) {
    recentBlocks.pop();
  }

  // Persist to database
  try {
    await db.insert(dcgBlocks).values({
      id,
      pattern: event.pattern,
      reason: event.reason,
      createdBy: event.agentId,
      falsePositive: event.falsePositive ?? false,
      createdAt: event.timestamp,
    });
  } catch (error) {
    log.error({ error }, "Failed to persist DCG block event");
  }

  // Publish to WebSocket
  const channel: Channel = { type: "system:dcg" };
  const eventType: MessageType =
    blockEvent.severity === "critical" || blockEvent.severity === "high"
      ? "dcg.block"
      : "dcg.warn";

  getHub().publish(channel, eventType, blockEvent, {
    correlationId: getCorrelationId(),
    agentId: event.agentId,
  });

  log.warn(
    {
      dcgEventId: id,
      severity: event.severity,
      pack: event.pack,
      ruleId: event.ruleId,
    },
    "DCG block event ingested",
  );

  return blockEvent;
}

/**
 * Get recent block events with optional filters.
 */
export async function getBlockEvents(options: {
  agentId?: string;
  severity?: DCGSeverity[];
  pack?: string;
  limit?: number;
  startingAfter?: string;
  endingBefore?: string;
}): Promise<{
  events: DCGBlockEvent[];
  hasMore: boolean;
  nextCursor?: string;
  prevCursor?: string;
}> {
  const limit = options.limit ?? DEFAULT_PAGINATION.limit;

  // For now, use in-memory blocks
  let events = [...recentBlocks];

  if (options.agentId) {
    events = events.filter((e) => e.agentId === options.agentId);
  }
  if (options.severity?.length) {
    events = events.filter((e) => options.severity!.includes(e.severity));
  }
  if (options.pack) {
    events = events.filter((e) => e.pack === options.pack);
  }

  // Apply cursor-based pagination
  let startIndex = 0;
  if (options.startingAfter) {
    const decoded = decodeCursor(options.startingAfter);
    if (decoded) {
      const cursorIndex = events.findIndex((e) => e.id === decoded.id);
      if (cursorIndex >= 0) {
        startIndex = cursorIndex + 1;
      }
    }
  } else if (options.endingBefore) {
    const decoded = decodeCursor(options.endingBefore);
    if (decoded) {
      const cursorIndex = events.findIndex((e) => e.id === decoded.id);
      if (cursorIndex >= 0) {
        startIndex = Math.max(0, cursorIndex - limit);
      }
    }
  }

  // Get page items (fetch limit + 1 to determine hasMore)
  const pageItems = events.slice(startIndex, startIndex + limit + 1);
  const hasMore = pageItems.length > limit;
  const resultItems = hasMore ? pageItems.slice(0, limit) : pageItems;

  const result: {
    events: DCGBlockEvent[];
    hasMore: boolean;
    nextCursor?: string;
    prevCursor?: string;
  } = {
    events: resultItems,
    hasMore,
  };

  // Add cursors if there are results
  if (resultItems.length > 0) {
    const lastItem = resultItems[resultItems.length - 1]!;
    const firstItem = resultItems[0]!;

    if (hasMore) {
      result.nextCursor = createCursor(lastItem.id);
    }
    if (startIndex > 0) {
      result.prevCursor = createCursor(firstItem.id);
    }
  }

  return result;
}

/**
 * Mark a block event as a false positive.
 * Returns the updated event or null if not found.
 */
export async function markFalsePositive(
  eventId: string,
  markedBy: string,
): Promise<DCGBlockEvent | null> {
  // First check in-memory cache
  const cachedEvent = recentBlocks.find((e) => e.id === eventId);

  // Try to update in database
  let dbUpdated = false;
  try {
    const result = await db
      .update(dcgBlocks)
      .set({ falsePositive: true })
      .where(eq(dcgBlocks.id, eventId))
      .returning();

    dbUpdated = result.length > 0;

    // If found in DB but not in cache, construct from DB result
    if (dbUpdated && !cachedEvent) {
      const row = result[0]!;
      const channel: Channel = { type: "system:dcg" };
      getHub().publish(channel, "dcg.false_positive", { eventId, markedBy }, {});
      return {
        id: row.id,
        timestamp: row.createdAt,
        agentId: row.createdBy ?? "unknown",
        command: "",
        pack: "",
        pattern: row.pattern,
        ruleId: "",
        severity: "medium" as DCGSeverity,
        reason: row.reason,
        contextClassification: "executed" as DCGContextClassification,
        falsePositive: true,
      };
    }
  } catch (error) {
    // Database error (table might not exist in tests) - fall through to cache check
    logger.debug({ error, eventId }, "Database update failed for false positive");
  }

  // If not found in DB and not in cache, return null
  if (!cachedEvent && !dbUpdated) {
    return null;
  }

  // Update in-memory cache
  if (cachedEvent) {
    cachedEvent.falsePositive = true;
    const channel: Channel = { type: "system:dcg" };
    getHub().publish(channel, "dcg.false_positive", { eventId, markedBy }, {});
    return cachedEvent;
  }

  return null;
}

// ============================================================================
// Configuration Management
// ============================================================================

/**
 * Get current DCG configuration.
 */
export function getConfig(): DCGConfig {
  return { ...currentConfig };
}

/**
 * Update DCG configuration.
 */
export async function updateConfig(
  updates: Partial<DCGConfig>,
): Promise<DCGConfig> {
  // Ensure we have the latest config from persistent storage before updating
  await syncConfigFromPersistent();
  const log = logger.child({ correlationId: getCorrelationId() });

  if (updates.enabledPacks) {
    // Validate pack names
    const validPacks = new Set(KNOWN_PACKS.map((p) => p.name));
    const invalidPacks = updates.enabledPacks.filter((p) => !validPacks.has(p));
    if (invalidPacks.length > 0) {
      throw new Error(`Unknown packs: ${invalidPacks.join(", ")}`);
    }
    currentConfig.enabledPacks = updates.enabledPacks;
  }

  if (updates.disabledPacks) {
    currentConfig.disabledPacks = updates.disabledPacks;
  }

  // Persist to database
  try {
    const persistParams: dcgConfigService.UpdateConfigParams = {
      changeType: "bulk_update",
    };
    if (updates.enabledPacks) persistParams.enabledPacks = updates.enabledPacks;
    if (updates.disabledPacks) persistParams.disabledPacks = updates.disabledPacks;

    await dcgConfigService.updateConfig(persistParams);
  } catch (error) {
    log.debug({ error }, "Failed to persist config update (DB may not be available)");
  }

  log.info(
    { enabledPacks: currentConfig.enabledPacks.length },
    "DCG config updated",
  );

  return getConfig();
}

/**
 * List available packs with their status.
 */
export function listPacks(): DCGPackInfo[] {
  return KNOWN_PACKS.map((pack) => ({
    name: pack.name,
    description: pack.description,
    enabled:
      currentConfig.enabledPacks.includes(pack.name) &&
      !currentConfig.disabledPacks.includes(pack.name),
    patternCount: 0, // Would be populated from DCG in production
  }));
}

/**
 * Enable a pack.
 */
export async function enablePack(packName: string): Promise<boolean> {
  // Ensure we have the latest config from persistent storage
  await syncConfigFromPersistent();

  const pack = KNOWN_PACKS.find((p) => p.name === packName);
  if (!pack) {
    return false;
  }

  // Update in-memory cache
  if (!currentConfig.enabledPacks.includes(packName)) {
    currentConfig.enabledPacks.push(packName);
  }
  currentConfig.disabledPacks = currentConfig.disabledPacks.filter(
    (p) => p !== packName,
  );

  // Persist to database
  try {
    await dcgConfigService.enablePack(packName);
  } catch (error) {
    logger.debug({ error, pack: packName }, "Failed to persist pack enable (DB may not be available)");
  }

  logger.info({ pack: packName }, "DCG pack enabled");
  return true;
}

/**
 * Disable a pack.
 */
export async function disablePack(packName: string): Promise<boolean> {
  // Ensure we have the latest config from persistent storage
  await syncConfigFromPersistent();

  const pack = KNOWN_PACKS.find((p) => p.name === packName);
  if (!pack) {
    return false;
  }

  // Update in-memory cache
  currentConfig.enabledPacks = currentConfig.enabledPacks.filter(
    (p) => p !== packName,
  );
  if (!currentConfig.disabledPacks.includes(packName)) {
    currentConfig.disabledPacks.push(packName);
  }

  // Persist to database
  try {
    await dcgConfigService.disablePack(packName);
  } catch (error) {
    logger.debug({ error, pack: packName }, "Failed to persist pack disable (DB may not be available)");
  }

  logger.info({ pack: packName }, "DCG pack disabled");
  return true;
}

// ============================================================================
// Allowlist Management
// ============================================================================

/**
 * Get allowlist entries.
 */
export async function getAllowlist(): Promise<DCGAllowlistEntry[]> {
  const rows = await db
    .select()
    .from(dcgAllowlist)
    .orderBy(desc(dcgAllowlist.createdAt));

  return rows.map((row) => ({
    ruleId: row.ruleId,
    pattern: row.pattern,
    addedAt: row.createdAt,
    addedBy: row.approvedBy ?? "unknown",
    reason: row.reason ?? "",
    ...(row.expiresAt !== null && { expiresAt: row.expiresAt }),
  }));
}

/**
 * Add an entry to the allowlist.
 */
export async function addToAllowlist(entry: {
  ruleId: string;
  pattern: string;
  reason: string;
  addedBy: string;
  expiresAt?: Date;
}): Promise<DCGAllowlistEntry> {
  const id = generateId("allow");
  const now = new Date();

  await db.insert(dcgAllowlist).values({
    id,
    ruleId: entry.ruleId,
    pattern: entry.pattern,
    reason: entry.reason,
    approvedBy: entry.addedBy,
    expiresAt: entry.expiresAt,
    createdAt: now,
  });

  const result: DCGAllowlistEntry = {
    ruleId: entry.ruleId,
    pattern: entry.pattern,
    addedAt: now,
    addedBy: entry.addedBy,
    reason: entry.reason,
    ...(entry.expiresAt !== undefined && { expiresAt: entry.expiresAt }),
  };

  // Publish to WebSocket
  const channel: Channel = { type: "system:dcg" };
  getHub().publish(channel, "dcg.allowlist_added", result, {});

  return result;
}

/**
 * Remove an entry from the allowlist.
 */
export async function removeFromAllowlist(ruleId: string): Promise<boolean> {
  const result = await db
    .delete(dcgAllowlist)
    .where(eq(dcgAllowlist.ruleId, ruleId))
    .returning();

  if (result.length === 0) {
    return false;
  }

  logger.info({ ruleId }, "DCG allowlist entry removed");
  return true;
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get DCG statistics.
 */
export async function getStats(): Promise<DCGStats> {
  const events = recentBlocks;

  // Count by pack
  const blocksByPack: Record<string, number> = {};
  for (const event of events) {
    blocksByPack[event.pack] = (blocksByPack[event.pack] ?? 0) + 1;
  }

  // Count by severity
  const blocksBySeverity: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const event of events) {
    blocksBySeverity[event.severity] =
      (blocksBySeverity[event.severity] ?? 0) + 1;
  }

  // Calculate false positive rate
  const falsePositives = events.filter((e) => e.falsePositive).length;
  const falsePositiveRate =
    events.length > 0 ? falsePositives / events.length : 0;

  // Top blocked commands (simplified/redacted)
  const commandCounts: Record<string, number> = {};
  for (const event of events) {
    // Extract just the command name, not args
    const cmdName = event.command.split(/\s+/)[0] ?? event.command;
    commandCounts[cmdName] = (commandCounts[cmdName] ?? 0) + 1;
  }

  const topBlockedCommands = Object.entries(commandCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([command, count]) => ({ command, count }));

  return {
    totalBlocks: events.length,
    blocksByPack,
    blocksBySeverity,
    falsePositiveRate,
    topBlockedCommands,
  };
}

// ============================================================================
// DCG Binary Integration
// ============================================================================

/**
 * Check if DCG binary is available.
 */
export async function isDcgAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["dcg", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Get DCG version if available.
 */
export async function getDcgVersion(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["dcg", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    if (proc.exitCode === 0) {
      const match = output.match(/(\d+\.\d+\.\d+)/);
      return match?.[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}
