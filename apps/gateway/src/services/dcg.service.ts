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

import {
  createCursor,
  DEFAULT_PAGINATION,
  decodeCursor,
} from "@flywheel/shared/api/pagination";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { db } from "../db";
import { dcgAllowlist, dcgBlocks } from "../db/schema";
import { getCorrelationId } from "../middleware/correlation";
import { redactCommand } from "../utils/redaction";
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
      command: blockEvent.command,
      reason: event.reason,
      createdBy: event.agentId,
      falsePositive: event.falsePositive ?? false,
      createdAt: event.timestamp,
      pack: event.pack,
      severity: event.severity,
      ruleId: event.ruleId,
      contextClassification: event.contextClassification,
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

  // Resolve cursor if present
  let cursorCreatedAt: Date | undefined;
  let cursorId: string | undefined;

  if (options.startingAfter) {
    const decoded = decodeCursor(options.startingAfter);
    if (decoded) {
      const cursorBlock = await db
        .select({ id: dcgBlocks.id, createdAt: dcgBlocks.createdAt })
        .from(dcgBlocks)
        .where(eq(dcgBlocks.id, decoded.id))
        .get();

      if (cursorBlock) {
        cursorCreatedAt = cursorBlock.createdAt;
        cursorId = cursorBlock.id;
      }
    }
  }

  // Build query
  const filters = [];
  if (options.agentId) {
    filters.push(eq(dcgBlocks.createdBy, options.agentId));
  }
  if (options.severity?.length) {
    filters.push(inArray(dcgBlocks.severity, options.severity));
  }
  if (options.pack) {
    filters.push(eq(dcgBlocks.pack, options.pack));
  }

  // Apply cursor pagination (keyset: createdAt DESC, id DESC)
  if (cursorCreatedAt && cursorId) {
    filters.push(
      or(
        lt(dcgBlocks.createdAt, cursorCreatedAt),
        and(
          eq(dcgBlocks.createdAt, cursorCreatedAt),
          lt(dcgBlocks.id, cursorId),
        ),
      ),
    );
  }

  const query = db
    .select()
    .from(dcgBlocks)
    .orderBy(desc(dcgBlocks.createdAt), desc(dcgBlocks.id))
    .limit(limit + 1);

  if (filters.length > 0) {
    query.where(and(...filters));
  }

  const rows = await query.all();
  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;

  const events: DCGBlockEvent[] = resultRows.map((row) => ({
    id: row.id,
    timestamp: row.createdAt,
    agentId: row.createdBy ?? "unknown",
    command: row.command ?? "",
    pack: row.pack ?? "unknown",
    pattern: row.pattern,
    ruleId: row.ruleId ?? "unknown",
    severity: (row.severity as DCGSeverity) ?? "medium",
    reason: row.reason,
    contextClassification:
      (row.contextClassification as DCGContextClassification) ?? "executed",
    falsePositive: row.falsePositive,
  }));

  const result: {
    events: DCGBlockEvent[];
    hasMore: boolean;
    nextCursor?: string;
    prevCursor?: string;
  } = {
    events,
    hasMore,
  };

  // Add cursors
  if (events.length > 0) {
    const lastItem = events[events.length - 1]!;
    // const firstItem = events[0]!;

    if (hasMore) {
      result.nextCursor = createCursor(lastItem.id);
    }
    // Note: prevCursor implementation for keyset pagination is complex and usually requires reversing direction.
    // We omit it for now as standard infinite scroll usually relies on nextCursor.
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
      getHub().publish(
        channel,
        "dcg.false_positive",
        { eventId, markedBy },
        {},
      );
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
    logger.debug(
      { error, eventId },
      "Database update failed for false positive",
    );
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
  const persistParams: dcgConfigService.UpdateConfigParams = {
    changeType: "bulk_update",
  };
  if (updates.enabledPacks) persistParams.enabledPacks = updates.enabledPacks;
  if (updates.disabledPacks)
    persistParams.disabledPacks = updates.disabledPacks;

  await dcgConfigService.updateConfig(persistParams);

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
  await dcgConfigService.enablePack(packName);

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
  await dcgConfigService.disablePack(packName);

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

// Import stats service for database-backed statistics
import * as dcgStatsService from "./dcg-stats.service";

// Re-export full stats types
export type {
  DCGFullStats,
  DCGOverviewStats,
  DCGPatternStats,
  DCGTimeSeriesPoint,
  DCGTrendStats,
} from "./dcg-stats.service";

/**
 * Get DCG statistics.
 * Uses database queries for accurate counts, with fallback to in-memory for
 * pack/severity data (which isn't stored in the database schema).
 */
export async function getStats(): Promise<DCGStats> {
  // Get database-backed stats (now includes pack/severity distribution)
  const dbStats = await dcgStatsService.getLegacyStats();

  return {
    totalBlocks: dbStats.totalBlocks,
    blocksByPack: dbStats.blocksByPack,
    blocksBySeverity: dbStats.blocksBySeverity,
    falsePositiveRate: dbStats.falsePositiveRate,
    topBlockedCommands: dbStats.topBlockedCommands,
  };
}

/**
 * Get comprehensive DCG statistics with time-based filtering and trends.
 * This is the new enhanced statistics endpoint.
 */
export async function getFullStats(): Promise<dcgStatsService.DCGFullStats> {
  return dcgStatsService.getFullStats();
}

/**
 * Get overview statistics only.
 */
export async function getOverviewStats(): Promise<dcgStatsService.DCGOverviewStats> {
  return dcgStatsService.getOverviewStats();
}

/**
 * Get trend statistics only.
 */
export async function getTrendStats(): Promise<dcgStatsService.DCGTrendStats> {
  return dcgStatsService.getTrendStats();
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
