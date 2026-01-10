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

import { eq, desc, and, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { dcgBlocks, dcgAllowlist } from "../db/schema";
import { getHub } from "../ws/hub";
import type { Channel } from "../ws/channels";
import { logger } from "./logger";
import { getCorrelationId } from "../middleware/correlation";

/**
 * Generate a random ID (alternative to nanoid).
 */
function generateId(prefix: string, length = 12): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
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
  { name: "core.git", description: "Dangerous git operations (force push, hard reset)" },
  { name: "core.filesystem", description: "Risky filesystem operations (rm -rf, chmod 777)" },
  { name: "core.network", description: "Network-related commands (curl to suspicious hosts)" },
  { name: "database.postgresql", description: "Dangerous PostgreSQL commands (DROP, TRUNCATE)" },
  { name: "database.mysql", description: "Dangerous MySQL commands" },
  { name: "database.sqlite", description: "SQLite destructive operations" },
  { name: "container.docker", description: "Risky Docker commands (--privileged, host network)" },
  { name: "container.kubernetes", description: "Dangerous kubectl commands" },
  { name: "cloud.aws", description: "Destructive AWS CLI commands" },
  { name: "cloud.gcp", description: "Destructive GCP commands" },
  { name: "secrets", description: "Commands that may expose secrets" },
];

// In-memory config (in production, this would be persisted)
let currentConfig: DCGConfig = {
  enabledPacks: KNOWN_PACKS.map((p) => p.name),
  disabledPacks: [],
  allowlist: [],
};

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
export async function ingestBlockEvent(event: Omit<DCGBlockEvent, "id">): Promise<DCGBlockEvent> {
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
      createdAt: event.timestamp,
    });
  } catch (error) {
    log.error({ error }, "Failed to persist DCG block event");
  }

  // Publish to WebSocket
  const hub = getHub();
  const channel: Channel = { type: "system:dcg" };
  const eventType = event.severity === "critical" || event.severity === "high" ? "dcg.block" : "dcg.warn";

  hub.publish(channel, eventType, blockEvent, {
    agentId: event.agentId,
  });

  log.warn(
    {
      dcgEventId: id,
      severity: event.severity,
      pack: event.pack,
      ruleId: event.ruleId,
    },
    "DCG block event ingested"
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
  cursor?: string;
}): Promise<{
  events: DCGBlockEvent[];
  pagination: { cursor?: string; hasMore: boolean };
}> {
  const limit = options.limit ?? 50;

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

  // Apply cursor (event ID)
  if (options.cursor) {
    const cursorIndex = events.findIndex((e) => e.id === options.cursor);
    if (cursorIndex >= 0) {
      events = events.slice(cursorIndex + 1);
    }
  }

  const hasMore = events.length > limit;
  const result = events.slice(0, limit);
  const lastEvent = result[result.length - 1];

  return {
    events: result,
    pagination: {
      cursor: lastEvent?.id,
      hasMore,
    },
  };
}

/**
 * Mark a block event as a false positive.
 */
export async function markFalsePositive(eventId: string, markedBy: string): Promise<DCGBlockEvent | null> {
  const event = recentBlocks.find((e) => e.id === eventId);
  if (!event) {
    return null;
  }

  event.falsePositive = true;

  // Publish update
  const hub = getHub();
  const channel: Channel = { type: "system:dcg" };
  hub.publish(channel, "dcg.false_positive", { eventId, markedBy }, {});

  logger.info({ eventId, markedBy }, "DCG block marked as false positive");

  return event;
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
export async function updateConfig(updates: Partial<DCGConfig>): Promise<DCGConfig> {
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

  log.info({ enabledPacks: currentConfig.enabledPacks.length }, "DCG config updated");

  return getConfig();
}

/**
 * List available packs with their status.
 */
export function listPacks(): DCGPackInfo[] {
  return KNOWN_PACKS.map((pack) => ({
    name: pack.name,
    description: pack.description,
    enabled: currentConfig.enabledPacks.includes(pack.name) && !currentConfig.disabledPacks.includes(pack.name),
    patternCount: 0, // Would be populated from DCG in production
  }));
}

/**
 * Enable a pack.
 */
export async function enablePack(packName: string): Promise<boolean> {
  const pack = KNOWN_PACKS.find((p) => p.name === packName);
  if (!pack) {
    return false;
  }

  if (!currentConfig.enabledPacks.includes(packName)) {
    currentConfig.enabledPacks.push(packName);
  }
  currentConfig.disabledPacks = currentConfig.disabledPacks.filter((p) => p !== packName);

  logger.info({ pack: packName }, "DCG pack enabled");
  return true;
}

/**
 * Disable a pack.
 */
export async function disablePack(packName: string): Promise<boolean> {
  const pack = KNOWN_PACKS.find((p) => p.name === packName);
  if (!pack) {
    return false;
  }

  currentConfig.enabledPacks = currentConfig.enabledPacks.filter((p) => p !== packName);
  if (!currentConfig.disabledPacks.includes(packName)) {
    currentConfig.disabledPacks.push(packName);
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
    addedBy: row.approvedBy ?? "system",
    reason: "Allowlisted",
    expiresAt: row.expiresAt ?? undefined,
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

  await db.insert(dcgAllowlist).values({
    id,
    ruleId: entry.ruleId,
    pattern: entry.pattern,
    approvedBy: entry.addedBy,
    expiresAt: entry.expiresAt,
    createdAt: new Date(),
  });

  const result: DCGAllowlistEntry = {
    ruleId: entry.ruleId,
    pattern: entry.pattern,
    addedAt: new Date(),
    addedBy: entry.addedBy,
    reason: entry.reason,
    expiresAt: entry.expiresAt,
  };

  // Publish to WebSocket
  const hub = getHub();
  const channel: Channel = { type: "system:dcg" };
  hub.publish(channel, "dcg.allowlist_added", result, {});

  logger.info({ ruleId: entry.ruleId, pattern: entry.pattern }, "DCG allowlist entry added");

  return result;
}

/**
 * Remove an entry from the allowlist.
 */
export async function removeFromAllowlist(ruleId: string): Promise<boolean> {
  const result = await db
    .delete(dcgAllowlist)
    .where(eq(dcgAllowlist.ruleId, ruleId));

  if (result.rowsAffected === 0) {
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
    blocksBySeverity[event.severity] = (blocksBySeverity[event.severity] ?? 0) + 1;
  }

  // Calculate false positive rate
  const falsePositives = events.filter((e) => e.falsePositive).length;
  const falsePositiveRate = events.length > 0 ? falsePositives / events.length : 0;

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
