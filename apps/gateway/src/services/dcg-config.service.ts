/**
 * DCG Configuration Service - Persistent storage for DCG settings.
 *
 * Provides:
 * - Persistent config across restarts
 * - Audit trail of all config changes
 * - Multi-instance consistency via database
 * - WebSocket notifications on config changes
 */

import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { dcgConfig, dcgConfigHistory } from "../db/schema";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import type { Channel } from "../ws/channels";
import { getHub } from "../ws/hub";
import { logger } from "./logger";

// ============================================================================
// Types
// ============================================================================

export type SeverityMode = "deny" | "warn" | "log";

export interface DCGConfigData {
  enabledPacks: string[];
  disabledPacks: string[];
  criticalMode: SeverityMode;
  highMode: SeverityMode;
  mediumMode: SeverityMode;
  lowMode: SeverityMode;
  updatedBy?: string;
  updatedAt: Date;
}

export type ChangeType =
  | "initial"
  | "pack_enabled"
  | "pack_disabled"
  | "severity_changed"
  | "bulk_update";

export interface ConfigHistoryEntry {
  id: string;
  configSnapshot: DCGConfigData;
  previousSnapshot?: DCGConfigData;
  changedBy?: string;
  changedAt: Date;
  changeReason?: string;
  changeType: ChangeType;
}

export interface UpdateConfigParams {
  enabledPacks?: string[];
  disabledPacks?: string[];
  criticalMode?: SeverityMode;
  highMode?: SeverityMode;
  mediumMode?: SeverityMode;
  lowMode?: SeverityMode;
  changedBy?: string;
  changeReason?: string;
  changeType?: ChangeType;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_ENABLED_PACKS = [
  "core.git",
  "core.filesystem",
  "core.network",
  "database.postgresql",
  "database.mysql",
  "database.sqlite",
  "container.docker",
  "container.kubernetes",
  "cloud.aws",
  "cloud.gcp",
  "secrets",
];

const DEFAULT_CONFIG: Omit<DCGConfigData, "updatedAt"> = {
  enabledPacks: DEFAULT_ENABLED_PACKS,
  disabledPacks: [],
  criticalMode: "deny",
  highMode: "deny",
  mediumMode: "warn",
  lowMode: "log",
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a unique ID for history entries.
 */
function generateHistoryId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = new Uint8Array(12);
  crypto.getRandomValues(randomBytes);
  let result = "";
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(randomBytes[i]! % chars.length);
  }
  return `dcg_hist_${result}`;
}

/**
 * Safely parse JSON with fallback.
 */
function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    logger.warn(
      { json: json.slice(0, 100) },
      "Failed to parse JSON, using fallback",
    );
    return fallback;
  }
}

/**
 * Convert database row to config data.
 */
function rowToConfig(row: typeof dcgConfig.$inferSelect): DCGConfigData {
  const result: DCGConfigData = {
    enabledPacks: safeJsonParse<string[]>(
      row.enabledPacks,
      DEFAULT_ENABLED_PACKS,
    ),
    disabledPacks: safeJsonParse<string[]>(row.disabledPacks, []),
    criticalMode: row.criticalMode as SeverityMode,
    highMode: row.highMode as SeverityMode,
    mediumMode: row.mediumMode as SeverityMode,
    lowMode: row.lowMode as SeverityMode,
    updatedAt: row.updatedAt,
  };
  if (row.updatedBy) result.updatedBy = row.updatedBy;
  return result;
}

/**
 * Convert history row to entry.
 */
function rowToHistoryEntry(
  row: typeof dcgConfigHistory.$inferSelect,
): ConfigHistoryEntry | null {
  // Parse config snapshot - if this fails, the entry is corrupt
  let configSnapshot: DCGConfigData;
  try {
    configSnapshot = JSON.parse(row.configSnapshot) as DCGConfigData;
  } catch {
    logger.warn(
      { historyId: row.id },
      "Corrupt config snapshot in history, skipping entry",
    );
    return null;
  }

  const entry: ConfigHistoryEntry = {
    id: row.id,
    configSnapshot,
    changedAt: row.changedAt,
    changeType: row.changeType as ChangeType,
  };

  if (row.previousSnapshot) {
    try {
      entry.previousSnapshot = JSON.parse(
        row.previousSnapshot,
      ) as DCGConfigData;
    } catch {
      // Previous snapshot is optional, just skip it if corrupt
      logger.debug(
        { historyId: row.id },
        "Corrupt previous snapshot in history, skipping",
      );
    }
  }
  if (row.changedBy) entry.changedBy = row.changedBy;
  if (row.changeReason) entry.changeReason = row.changeReason;
  return entry;
}

// ============================================================================
// Core Operations
// ============================================================================

const CONFIG_ID = "current";

/**
 * Get the current DCG configuration.
 * Initializes with defaults if no config exists.
 */
export async function getConfig(): Promise<DCGConfigData> {
  const row = await db
    .select()
    .from(dcgConfig)
    .where(eq(dcgConfig.id, CONFIG_ID))
    .get();

  if (!row) {
    // Initialize with defaults
    return initializeConfig();
  }

  return rowToConfig(row);
}

/**
 * Initialize the configuration with defaults.
 * Called on first startup.
 */
async function initializeConfig(): Promise<DCGConfigData> {
  const correlationId = getCorrelationId();
  const log = getLogger();
  const now = new Date();

  const configData: DCGConfigData = {
    ...DEFAULT_CONFIG,
    updatedAt: now,
    updatedBy: "system",
  };

  await db.insert(dcgConfig).values({
    id: CONFIG_ID,
    enabledPacks: JSON.stringify(configData.enabledPacks),
    disabledPacks: JSON.stringify(configData.disabledPacks),
    criticalMode: configData.criticalMode,
    highMode: configData.highMode,
    mediumMode: configData.mediumMode,
    lowMode: configData.lowMode,
    updatedBy: "system",
    updatedAt: now,
  });

  // Record initial history
  await db.insert(dcgConfigHistory).values({
    id: generateHistoryId(),
    configSnapshot: JSON.stringify(configData),
    changedBy: "system",
    changedAt: now,
    changeReason: "Initial configuration",
    changeType: "initial",
  });

  log.info({ correlationId }, "DCG config initialized with defaults");

  return configData;
}

/**
 * Update the DCG configuration.
 */
export async function updateConfig(
  params: UpdateConfigParams,
): Promise<DCGConfigData> {
  const correlationId = getCorrelationId();
  const log = getLogger();
  const now = new Date();

  // Get current config
  const current = await getConfig();
  const previous = { ...current };

  // Apply updates
  const updates: Partial<typeof dcgConfig.$inferInsert> = {
    updatedAt: now,
  };

  if (params.enabledPacks !== undefined) {
    updates.enabledPacks = JSON.stringify(params.enabledPacks);
    current.enabledPacks = params.enabledPacks;
  }
  if (params.disabledPacks !== undefined) {
    updates.disabledPacks = JSON.stringify(params.disabledPacks);
    current.disabledPacks = params.disabledPacks;
  }
  if (params.criticalMode !== undefined) {
    updates.criticalMode = params.criticalMode;
    current.criticalMode = params.criticalMode;
  }
  if (params.highMode !== undefined) {
    updates.highMode = params.highMode;
    current.highMode = params.highMode;
  }
  if (params.mediumMode !== undefined) {
    updates.mediumMode = params.mediumMode;
    current.mediumMode = params.mediumMode;
  }
  if (params.lowMode !== undefined) {
    updates.lowMode = params.lowMode;
    current.lowMode = params.lowMode;
  }
  if (params.changedBy !== undefined) {
    updates.updatedBy = params.changedBy;
    current.updatedBy = params.changedBy;
  }

  current.updatedAt = now;

  // Update config
  await db.update(dcgConfig).set(updates).where(eq(dcgConfig.id, CONFIG_ID));

  // Record history
  const historyEntry: typeof dcgConfigHistory.$inferInsert = {
    id: generateHistoryId(),
    configSnapshot: JSON.stringify(current),
    previousSnapshot: JSON.stringify(previous),
    changedAt: now,
    changeType: params.changeType ?? "bulk_update",
  };
  if (params.changedBy) historyEntry.changedBy = params.changedBy;
  if (params.changeReason) historyEntry.changeReason = params.changeReason;

  await db.insert(dcgConfigHistory).values(historyEntry);

  // Publish WebSocket event
  const channel: Channel = { type: "system:dcg" };
  getHub().publish(
    channel,
    "dcg.config_updated",
    {
      changedBy: params.changedBy,
      changeType: params.changeType ?? "bulk_update",
      changeReason: params.changeReason,
    },
    { correlationId },
  );

  log.info(
    {
      correlationId,
      changedBy: params.changedBy,
      changeType: params.changeType ?? "bulk_update",
    },
    "DCG config updated",
  );

  return current;
}

/**
 * Enable a specific pack.
 */
export async function enablePack(
  packName: string,
  changedBy?: string,
  changeReason?: string,
): Promise<DCGConfigData> {
  const current = await getConfig();

  // Add to enabled if not already present
  const enabledPacks = current.enabledPacks.includes(packName)
    ? current.enabledPacks
    : [...current.enabledPacks, packName];

  // Remove from disabled
  const disabledPacks = current.disabledPacks.filter((p) => p !== packName);

  const params: UpdateConfigParams = {
    enabledPacks,
    disabledPacks,
    changeReason: changeReason ?? `Enabled pack: ${packName}`,
    changeType: "pack_enabled",
  };
  if (changedBy) params.changedBy = changedBy;

  return updateConfig(params);
}

/**
 * Disable a specific pack.
 */
export async function disablePack(
  packName: string,
  changedBy?: string,
  changeReason?: string,
): Promise<DCGConfigData> {
  const current = await getConfig();

  // Remove from enabled
  const enabledPacks = current.enabledPacks.filter((p) => p !== packName);

  // Add to disabled if not already present
  const disabledPacks = current.disabledPacks.includes(packName)
    ? current.disabledPacks
    : [...current.disabledPacks, packName];

  const params: UpdateConfigParams = {
    enabledPacks,
    disabledPacks,
    changeReason: changeReason ?? `Disabled pack: ${packName}`,
    changeType: "pack_disabled",
  };
  if (changedBy) params.changedBy = changedBy;

  return updateConfig(params);
}

/**
 * Update severity modes.
 */
export async function updateSeverityModes(
  modes: {
    criticalMode?: SeverityMode;
    highMode?: SeverityMode;
    mediumMode?: SeverityMode;
    lowMode?: SeverityMode;
  },
  changedBy?: string,
  changeReason?: string,
): Promise<DCGConfigData> {
  const params: UpdateConfigParams = {
    ...modes,
    changeReason: changeReason ?? "Updated severity modes",
    changeType: "severity_changed",
  };
  if (changedBy) params.changedBy = changedBy;

  return updateConfig(params);
}

// ============================================================================
// History Operations
// ============================================================================

/**
 * Get config history.
 */
export async function getConfigHistory(options?: {
  limit?: number;
}): Promise<ConfigHistoryEntry[]> {
  const limit = options?.limit ?? 50;

  const rows = await db
    .select()
    .from(dcgConfigHistory)
    .orderBy(desc(dcgConfigHistory.changedAt))
    .limit(limit);

  // Filter out corrupt entries (null) from the result
  return rows
    .map(rowToHistoryEntry)
    .filter((entry): entry is ConfigHistoryEntry => entry !== null);
}

/**
 * Get a specific history entry.
 */
export async function getConfigHistoryEntry(
  id: string,
): Promise<ConfigHistoryEntry | null> {
  const row = await db
    .select()
    .from(dcgConfigHistory)
    .where(eq(dcgConfigHistory.id, id))
    .get();

  if (!row) return null;
  // rowToHistoryEntry returns null if the entry is corrupt
  return rowToHistoryEntry(row);
}

/**
 * Rollback to a previous config state.
 */
export async function rollbackConfig(
  historyId: string,
  changedBy?: string,
): Promise<DCGConfigData> {
  const entry = await getConfigHistoryEntry(historyId);
  if (!entry) {
    throw new Error(`Config history entry not found: ${historyId}`);
  }

  const snapshot = entry.configSnapshot;

  const params: UpdateConfigParams = {
    enabledPacks: snapshot.enabledPacks,
    disabledPacks: snapshot.disabledPacks,
    criticalMode: snapshot.criticalMode,
    highMode: snapshot.highMode,
    mediumMode: snapshot.mediumMode,
    lowMode: snapshot.lowMode,
    changeReason: `Rollback to config from ${entry.changedAt.toISOString()}`,
    changeType: "bulk_update",
  };
  if (changedBy) params.changedBy = changedBy;

  return updateConfig(params);
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Clear all config (for tests).
 */
export async function _clearConfig(): Promise<void> {
  await db.delete(dcgConfigHistory);
  await db.delete(dcgConfig);
}
