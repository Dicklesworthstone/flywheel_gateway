/**
 * Checkpoint Service - Agent state persistence and recovery.
 *
 * Checkpoints capture agent state for:
 * - Rollback after mistakes
 * - Disaster recovery
 * - Session handoffs
 * - Context window refreshes
 *
 * Features:
 * - Delta-based progressive checkpointing
 * - Optional compression (gzip) for storage efficiency
 * - Auto-checkpointing triggers (interval, message count, token threshold)
 * - Compaction for delta chain management
 */

import type {
  Checkpoint,
  CheckpointMetadata,
  TokenUsage,
} from "@flywheel/agent-drivers";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { checkpoints as checkpointsTable, db } from "../db";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import { incrementCounter, recordHistogram } from "./metrics";

// ============================================================================
// Compression Utilities
// ============================================================================

/**
 * Compression statistics for monitoring.
 */
export interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  ratio: number;
  durationMs: number;
}

/**
 * Compress data using gzip.
 * Returns base64-encoded compressed data for JSON storage compatibility.
 */
export function compressData(data: string): {
  compressed: string;
  stats: CompressionStats;
} {
  const startTime = performance.now();
  const encoder = new TextEncoder();
  const inputBuffer = encoder.encode(data);
  const compressed = Bun.gzipSync(inputBuffer);
  const base64 = Buffer.from(compressed).toString("base64");
  const durationMs = performance.now() - startTime;

  return {
    compressed: base64,
    stats: {
      originalSize: inputBuffer.length,
      compressedSize: compressed.length,
      ratio: inputBuffer.length / compressed.length,
      durationMs,
    },
  };
}

/**
 * Decompress gzip data from base64.
 */
export function decompressData(base64Data: string): string {
  const compressed = Buffer.from(base64Data, "base64");
  const decompressed = Bun.gunzipSync(compressed);
  const decoder = new TextDecoder();
  return decoder.decode(decompressed);
}

// ============================================================================
// Types
// ============================================================================

/**
 * Extended checkpoint with delta and compression support.
 */
export interface DeltaCheckpoint extends Checkpoint {
  /** Parent checkpoint ID for delta chain */
  parentCheckpointId: string | undefined;
  /** Whether this is a full checkpoint or delta */
  isDelta: boolean;
  /** Delta entries since parent (if isDelta) */
  deltaEntries?: Array<{
    type: "message" | "tool_result" | "file_change";
    timestamp: Date;
    content: unknown;
  }>;
  /** Compression metadata */
  compression?: {
    enabled: boolean;
    algorithm: "gzip";
    originalSize: number;
    compressedSize: number;
    ratio: number;
  };
  /** Compressed conversation history (base64 gzip) */
  compressedConversationHistory?: string;
  /** Compressed tool state (base64 gzip) */
  compressedToolState?: string;
}

/**
 * Result of checkpoint verification.
 */
export interface VerifyResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Options for creating a checkpoint.
 */
export interface CreateCheckpointOptions {
  description?: string;
  tags?: string[];
  /** If true, create delta from last checkpoint instead of full */
  delta?: boolean;
  /** Include file snapshots in checkpoint */
  includeFileSnapshots?: boolean;
  /** Enable gzip compression for large checkpoints (recommended for >10KB) */
  compress?: boolean;
}

/**
 * Options for restoring a checkpoint.
 */
export interface RestoreCheckpointOptions {
  /** If true, verify checkpoint before restoring */
  verify?: boolean;
  /** If true, create a new agent instead of restoring to existing */
  createNew?: boolean;
}

/**
 * Export format for checkpoints.
 */
export interface ExportedCheckpoint {
  version: string;
  exportedAt: string;
  checkpoint: Checkpoint;
  /** SHA-256 hash of checkpoint data */
  hash: string;
}

// ============================================================================
// Storage
// ============================================================================

/**
 * Normalize checkpoint data, including decompression if needed.
 */
function normalizeCheckpoint(checkpoint: DeltaCheckpoint): DeltaCheckpoint {
  const createdAt =
    checkpoint.createdAt instanceof Date
      ? checkpoint.createdAt
      : new Date(checkpoint.createdAt);

  const deltaEntries = checkpoint.deltaEntries?.map((entry) => ({
    ...entry,
    timestamp:
      entry.timestamp instanceof Date
        ? entry.timestamp
        : new Date(entry.timestamp),
  }));

  // Handle decompression if checkpoint was compressed
  let conversationHistory = checkpoint.conversationHistory;
  let toolState = checkpoint.toolState;

  if (checkpoint.compression?.enabled) {
    try {
      if (checkpoint.compressedConversationHistory) {
        const decompressed = decompressData(
          checkpoint.compressedConversationHistory,
        );
        conversationHistory = JSON.parse(decompressed);
      }
      if (checkpoint.compressedToolState) {
        const decompressed = decompressData(checkpoint.compressedToolState);
        toolState = JSON.parse(decompressed);
      }
    } catch (error) {
      const log = getLogger();
      log.error(
        { error, checkpointId: checkpoint.id },
        "[CHECKPOINT] Failed to decompress checkpoint data",
      );
      // Re-throw as CheckpointError so callers know data is corrupted
      throw new CheckpointError(
        "DECOMPRESSION_FAILED",
        `Failed to decompress checkpoint ${checkpoint.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    ...checkpoint,
    createdAt,
    conversationHistory,
    toolState,
    ...(deltaEntries ? { deltaEntries } : {}),
  };
}

// ============================================================================
// Checkpoint Creation
// ============================================================================

/**
 * Generate a unique checkpoint ID.
 */
function generateCheckpointId(): string {
  return `chk_${ulid().toLowerCase()}`;
}

/**
 * Create a checkpoint for an agent.
 *
 * @param agentId - The agent to checkpoint
 * @param state - Current agent state snapshot
 * @param options - Checkpoint options
 * @returns The created checkpoint metadata
 */
export async function createCheckpoint(
  agentId: string,
  state: {
    conversationHistory: unknown[];
    toolState: Record<string, unknown>;
    tokenUsage: TokenUsage;
    contextPack?: unknown;
  },
  options: CreateCheckpointOptions = {},
): Promise<CheckpointMetadata & { compressionStats?: CompressionStats }> {
  const log = getLogger();
  const correlationId = getCorrelationId();
  const checkpointId = generateCheckpointId();
  const now = new Date();

  // Get latest checkpoint for delta
  const lastCheckpoint = await getLatestCheckpoint(agentId);
  const lastCheckpointId = lastCheckpoint?.id;

  // Optionally compress large data
  let compressionMeta: DeltaCheckpoint["compression"];
  let compressedConversationHistory: string | undefined;
  let compressedToolState: string | undefined;
  let totalCompressionStats: CompressionStats | undefined;

  if (options.compress) {
    const historyJson = JSON.stringify(state.conversationHistory);
    const toolStateJson = JSON.stringify(state.toolState);

    const historyResult = compressData(historyJson);
    const toolStateResult = compressData(toolStateJson);

    compressedConversationHistory = historyResult.compressed;
    compressedToolState = toolStateResult.compressed;

    const totalOriginal =
      historyResult.stats.originalSize + toolStateResult.stats.originalSize;
    const totalCompressed =
      historyResult.stats.compressedSize + toolStateResult.stats.compressedSize;

    compressionMeta = {
      enabled: true,
      algorithm: "gzip",
      originalSize: totalOriginal,
      compressedSize: totalCompressed,
      ratio: totalOriginal / totalCompressed,
    };

    totalCompressionStats = {
      originalSize: totalOriginal,
      compressedSize: totalCompressed,
      ratio: totalOriginal / totalCompressed,
      durationMs:
        historyResult.stats.durationMs + toolStateResult.stats.durationMs,
    };

    log.debug(
      {
        agentId,
        checkpointId,
        compression: compressionMeta,
        correlationId,
      },
      `[CHECKPOINT] Compressed checkpoint data (ratio: ${compressionMeta.ratio.toFixed(2)}x)`,
    );
  }

  // Build checkpoint (description and tags are required but can be undefined)
  const checkpoint: DeltaCheckpoint = {
    id: checkpointId,
    agentId,
    createdAt: now,
    tokenUsage: state.tokenUsage,
    description: options.description,
    tags: options.tags,
    // Store uncompressed if not compressing, or leave undefined if compressed
    conversationHistory: options.compress ? [] : state.conversationHistory,
    toolState: options.compress ? {} : state.toolState,
    isDelta: false,
    parentCheckpointId: undefined,
  };
  // Add truly optional properties only if defined
  if (state.contextPack !== undefined)
    checkpoint.contextPack = state.contextPack;
  if (compressionMeta) checkpoint.compression = compressionMeta;
  if (compressedConversationHistory)
    checkpoint.compressedConversationHistory = compressedConversationHistory;
  if (compressedToolState) checkpoint.compressedToolState = compressedToolState;

  // If delta mode and we have a parent
  if (options.delta && lastCheckpointId) {
    checkpoint.isDelta = true;
    checkpoint.parentCheckpointId = lastCheckpointId;
  }

  // Record checkpoint creation start time for metrics
  const createStartTime = performance.now();

  // Persist to DB
  await db.insert(checkpointsTable).values({
    id: checkpointId,
    agentId,
    state: checkpoint,
    createdAt: now,
  });

  // Record metrics
  const createDurationMs = performance.now() - createStartTime;
  const checkpointType = checkpoint.isDelta ? "delta" : "full";
  const trigger = options.tags?.includes("error")
    ? "error"
    : options.tags?.includes("auto")
      ? "auto"
      : "manual";

  incrementCounter("flywheel_checkpoints_created_total", 1, {
    type: checkpointType,
    trigger,
    compressed: options.compress ? "true" : "false",
  });

  recordHistogram("flywheel_checkpoint_create_duration_ms", createDurationMs, {
    type: checkpointType,
  });

  if (compressionMeta) {
    recordHistogram(
      "flywheel_checkpoint_size_bytes",
      compressionMeta.compressedSize,
      { type: checkpointType, compressed: "true" },
    );
    recordHistogram(
      "flywheel_checkpoint_compression_ratio",
      compressionMeta.ratio,
      {},
    );
  }

  log.info(
    {
      type: "checkpoint",
      agentId,
      checkpointId,
      isDelta: checkpoint.isDelta,
      compressed: !!options.compress,
      compressionRatio: compressionMeta?.ratio,
      tokenUsage: state.tokenUsage.totalTokens,
      createDurationMs,
      correlationId,
    },
    `[CHECKPOINT] Created checkpoint ${checkpointId} for agent ${agentId}${options.compress ? ` (compressed ${compressionMeta?.ratio.toFixed(2)}x)` : ""}`,
  );

  // Build result (description and tags are required but can be undefined)
  const result: CheckpointMetadata & { compressionStats?: CompressionStats } = {
    id: checkpointId,
    agentId,
    createdAt: now,
    tokenUsage: state.tokenUsage,
    description: options.description,
    tags: options.tags,
  };
  // Add truly optional properties only if defined
  if (totalCompressionStats) result.compressionStats = totalCompressionStats;
  return result;
}

// ============================================================================
// Error Checkpoints
// ============================================================================

/**
 * Error context captured with an error checkpoint.
 */
export interface ErrorContext {
  errorType: string;
  errorMessage: string;
  errorStack?: string;
  lastCommand?: string;
  lastToolCall?: string;
  correlationId?: string;
}

/**
 * Create an error checkpoint before an error propagates.
 * This captures the agent state at the moment of failure for debugging.
 *
 * Error checkpoints are always compressed and tagged for easy identification.
 * They never fail - if checkpoint creation fails, the error is logged but not thrown.
 *
 * @param agentId - The agent that encountered the error
 * @param state - Current agent state
 * @param errorContext - Information about the error
 * @returns The checkpoint metadata, or undefined if creation failed
 */
export async function createErrorCheckpoint(
  agentId: string,
  state: {
    conversationHistory: unknown[];
    toolState: Record<string, unknown>;
    tokenUsage: TokenUsage;
    contextPack?: unknown;
  },
  errorContext: ErrorContext,
): Promise<CheckpointMetadata | undefined> {
  const log = getLogger();
  const correlationId = getCorrelationId();

  try {
    const description = `Error checkpoint: ${errorContext.errorType} - ${errorContext.errorMessage.slice(0, 100)}`;

    const metadata = await createCheckpoint(
      agentId,
      {
        ...state,
        toolState: {
          ...state.toolState,
          _errorContext: errorContext,
        },
      },
      {
        description,
        tags: ["error", "auto", errorContext.errorType],
        compress: true,
      },
    );

    log.info(
      {
        type: "checkpoint:error",
        agentId,
        checkpointId: metadata.id,
        errorType: errorContext.errorType,
        correlationId,
      },
      `[CHECKPOINT] Created error checkpoint ${metadata.id} for agent ${agentId}`,
    );

    return metadata;
  } catch (error) {
    // Error checkpoints must never fail - log and continue
    log.error(
      {
        type: "checkpoint:error_failed",
        agentId,
        originalError: errorContext,
        checkpointError: error,
        correlationId,
      },
      "[CHECKPOINT] Failed to create error checkpoint - continuing without checkpoint",
    );
    return undefined;
  }
}

/**
 * Wrapper to capture checkpoint on error.
 * Use this to wrap async operations that might fail.
 *
 * @example
 * ```typescript
 * const result = await withErrorCheckpoint(
 *   agentId,
 *   () => getAgentState(agentId),
 *   async () => riskyOperation(),
 * );
 * ```
 */
export async function withErrorCheckpoint<T>(
  agentId: string,
  getState: () => Promise<{
    conversationHistory: unknown[];
    toolState: Record<string, unknown>;
    tokenUsage: TokenUsage;
    contextPack?: unknown;
  }>,
  operation: () => Promise<T>,
  options?: { captureOnSuccess?: boolean },
): Promise<T> {
  try {
    const result = await operation();

    // Optionally capture on success (milestone checkpoint)
    if (options?.captureOnSuccess) {
      const state = await getState();
      await createCheckpoint(agentId, state, {
        description: "Milestone checkpoint after successful operation",
        tags: ["milestone", "auto"],
        compress: true,
      });
    }

    return result;
  } catch (error) {
    // Capture error checkpoint
    try {
      const state = await getState();
      // Build error context conditionally (for exactOptionalPropertyTypes)
      const errorContext: ErrorContext = {
        errorType:
          error instanceof Error ? error.constructor.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
        correlationId: getCorrelationId(),
      };
      if (error instanceof Error && error.stack)
        errorContext.errorStack = error.stack;

      await createErrorCheckpoint(agentId, state, errorContext);
    } catch {
      // Ignore checkpoint errors - the original error is more important
    }

    throw error;
  }
}

// ============================================================================
// Checkpoint Retrieval
// ============================================================================

/**
 * Get a checkpoint by ID.
 */
export async function getCheckpoint(
  checkpointId: string,
): Promise<Checkpoint | undefined> {
  const result = await db
    .select()
    .from(checkpointsTable)
    .where(eq(checkpointsTable.id, checkpointId))
    .limit(1);

  const row = result[0];
  if (!row) return undefined;
  return normalizeCheckpoint(row.state as DeltaCheckpoint);
}

/**
 * Get all checkpoints for an agent.
 * Skips checkpoints that fail to normalize (e.g., corrupted compression).
 */
export async function getAgentCheckpoints(
  agentId: string,
): Promise<CheckpointMetadata[]> {
  const log = getLogger();
  const results = await db
    .select()
    .from(checkpointsTable)
    .where(eq(checkpointsTable.agentId, agentId))
    .orderBy(desc(checkpointsTable.id));

  const checkpoints: CheckpointMetadata[] = [];
  for (const row of results) {
    try {
      const chk = normalizeCheckpoint(row.state as DeltaCheckpoint);
      checkpoints.push({
        id: chk.id,
        agentId: chk.agentId,
        createdAt: chk.createdAt,
        tokenUsage: chk.tokenUsage,
        description: chk.description,
        tags: chk.tags,
      });
    } catch (error) {
      // Skip corrupted checkpoints but log for debugging
      log.warn(
        { checkpointId: row.id, agentId, error },
        "[CHECKPOINT] Skipping corrupted checkpoint in listing",
      );
    }
  }
  return checkpoints;
}

/**
 * Get the latest checkpoint for an agent.
 */
export async function getLatestCheckpoint(
  agentId: string,
): Promise<Checkpoint | undefined> {
  const result = await db
    .select()
    .from(checkpointsTable)
    .where(eq(checkpointsTable.agentId, agentId))
    .orderBy(desc(checkpointsTable.createdAt), desc(sql`rowid`))
    .limit(1);

  const row = result[0];
  if (!row) return undefined;
  return normalizeCheckpoint(row.state as DeltaCheckpoint);
}

// ============================================================================
// Checkpoint Restoration
// ============================================================================

/**
 * Resolve a delta checkpoint to its full state.
 * Walks the parent chain and merges all deltas.
 */
async function resolveDeltaCheckpoint(
  checkpoint: DeltaCheckpoint,
): Promise<Checkpoint> {
  // Optimization: If the checkpoint has full state (conversationHistory and toolState),
  // we don't need to resolve the parent, even if it's marked as a delta.
  // This avoids unnecessary DB queries and recursion when "delta" checkpoints
  // actually contain full snapshots (which is the current implementation behavior).
  if (checkpoint.conversationHistory && checkpoint.toolState) {
    return checkpoint;
  }

  if (!checkpoint.isDelta || !checkpoint.parentCheckpointId) {
    return checkpoint;
  }

  // Iterative resolution to prevent stack overflow
  const MAX_CHAIN_DEPTH = 100;
  const chain: DeltaCheckpoint[] = [checkpoint];
  let current = checkpoint;

  while (current.isDelta && current.parentCheckpointId) {
    if (chain.length >= MAX_CHAIN_DEPTH) {
      throw new CheckpointError(
        "CHAIN_TOO_DEEP",
        `Delta checkpoint chain exceeded maximum depth of ${MAX_CHAIN_DEPTH}`,
      );
    }
    // If current has full state, we can stop resolving parents
    if (
      current.conversationHistory &&
      current.toolState &&
      current !== checkpoint
    ) {
      break;
    }

    const parent = await getCheckpoint(current.parentCheckpointId);
    if (!parent) {
      throw new CheckpointError(
        "PARENT_NOT_FOUND",
        `Parent checkpoint ${current.parentCheckpointId} not found`,
      );
    }
    const parentDelta = parent as DeltaCheckpoint;
    chain.push(parentDelta);
    current = parentDelta;
  }

  // Apply changes from oldest to newest (reverse order)
  // Start with the base (oldest loaded parent)
  const base = chain.pop()!;
  let resolved: Checkpoint = { ...base };

  // Apply deltas
  while (chain.length > 0) {
    const next = chain.pop()!;
    resolved = {
      ...resolved,
      id: next.id,
      agentId: next.agentId,
      createdAt: next.createdAt,
      tokenUsage: next.tokenUsage,
      description: next.description,
      tags: next.tags,
      // If next has history, use it (override). If not, keep resolved (merge logic would go here)
      conversationHistory:
        next.conversationHistory ?? resolved.conversationHistory,
      // Merge tool state if needed, or override
      toolState: { ...resolved.toolState, ...next.toolState },
      contextPack: next.contextPack ?? resolved.contextPack,
    };
  }

  return resolved;
}

/**
 * Restore an agent from a checkpoint.
 *
 * @param checkpointId - The checkpoint to restore from
 * @param options - Restore options
 * @returns The full checkpoint state to apply
 */
export async function restoreCheckpoint(
  checkpointId: string,
  options: RestoreCheckpointOptions = {},
): Promise<Checkpoint> {
  const log = getLogger();
  const correlationId = getCorrelationId();
  const restoreStartTime = performance.now();

  const checkpoint = await getCheckpoint(checkpointId);
  if (!checkpoint) {
    incrementCounter("flywheel_checkpoint_restore_errors_total", 1, {
      error: "not_found",
    });
    throw new CheckpointError(
      "CHECKPOINT_NOT_FOUND",
      `Checkpoint ${checkpointId} not found`,
    );
  }

  // Verify if requested
  if (options.verify) {
    const verifyResult = await verifyCheckpoint(checkpointId);
    if (!verifyResult.valid) {
      incrementCounter("flywheel_checkpoint_restore_errors_total", 1, {
        error: "invalid",
      });
      throw new CheckpointError(
        "CHECKPOINT_INVALID",
        `Checkpoint verification failed: ${verifyResult.errors.join(", ")}`,
      );
    }
  }

  // Resolve delta chain if needed
  const deltaCheckpoint = checkpoint as DeltaCheckpoint;
  const resolvedCheckpoint = await resolveDeltaCheckpoint(deltaCheckpoint);

  // Record metrics
  const restoreDurationMs = performance.now() - restoreStartTime;
  const checkpointType = deltaCheckpoint.isDelta ? "delta" : "full";

  incrementCounter("flywheel_checkpoint_restores_total", 1, {
    type: checkpointType,
  });

  recordHistogram(
    "flywheel_checkpoint_restore_duration_ms",
    restoreDurationMs,
    { type: checkpointType },
  );

  log.info(
    {
      type: "checkpoint",
      action: "restore",
      checkpointId,
      agentId: checkpoint.agentId,
      restoreDurationMs,
      correlationId,
    },
    `[CHECKPOINT] Restored checkpoint ${checkpointId} for agent ${checkpoint.agentId}`,
  );

  return resolvedCheckpoint;
}

// ============================================================================
// Checkpoint Verification
// ============================================================================

/**
 * Verify checkpoint integrity.
 */
export async function verifyCheckpoint(
  checkpointId: string,
): Promise<VerifyResult> {
  let checkpoint: DeltaCheckpoint | undefined;
  try {
    checkpoint = (await getCheckpoint(checkpointId)) as
      | DeltaCheckpoint
      | undefined;
  } catch (error) {
    // Decompression or other errors mean the checkpoint is corrupted
    return {
      valid: false,
      errors: [
        `Checkpoint ${checkpointId} is corrupted: ${error instanceof Error ? error.message : String(error)}`,
      ],
      warnings: [],
    };
  }

  if (!checkpoint) {
    return {
      valid: false,
      errors: [`Checkpoint ${checkpointId} not found`],
      warnings: [],
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required fields
  if (!checkpoint.agentId) {
    errors.push("Missing agentId");
  }
  if (!checkpoint.createdAt) {
    errors.push("Missing createdAt");
  }
  if (!Array.isArray(checkpoint.conversationHistory)) {
    errors.push("Missing or invalid conversationHistory");
  }

  // Check delta chain integrity
  if (checkpoint.isDelta && checkpoint.parentCheckpointId) {
    const parent = await getCheckpoint(checkpoint.parentCheckpointId);
    if (!parent) {
      errors.push(
        `Parent checkpoint ${checkpoint.parentCheckpointId} not found`,
      );
    }
  }

  // Check token usage sanity
  if (checkpoint.tokenUsage) {
    const { promptTokens, completionTokens, totalTokens } =
      checkpoint.tokenUsage;
    if (promptTokens + completionTokens !== totalTokens) {
      warnings.push("Token usage sum mismatch");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Checkpoint Export/Import
// ============================================================================

/**
 * Export a checkpoint to a portable format.
 */
export async function exportCheckpoint(
  checkpointId: string,
): Promise<ExportedCheckpoint> {
  const checkpoint = await getCheckpoint(checkpointId);
  if (!checkpoint) {
    throw new CheckpointError(
      "CHECKPOINT_NOT_FOUND",
      `Checkpoint ${checkpointId} not found`,
    );
  }

  // Resolve delta to full checkpoint for export
  const fullCheckpoint = await resolveDeltaCheckpoint(
    checkpoint as DeltaCheckpoint,
  );

  // Compute hash for integrity
  const hash = await computeCheckpointHash(fullCheckpoint);

  return {
    version: "1.0.0",
    exportedAt: new Date().toISOString(),
    checkpoint: fullCheckpoint,
    hash,
  };
}

/**
 * Import a checkpoint from exported format.
 */
export async function importCheckpoint(
  exported: ExportedCheckpoint,
  targetAgentId?: string,
): Promise<CheckpointMetadata> {
  const log = getLogger();

  // Verify hash
  const computedHash = await computeCheckpointHash(exported.checkpoint);
  if (computedHash !== exported.hash) {
    throw new CheckpointError(
      "IMPORT_HASH_MISMATCH",
      "Checkpoint hash verification failed",
    );
  }

  // Generate new ID for imported checkpoint
  const newId = generateCheckpointId();
  const agentId = targetAgentId ?? exported.checkpoint.agentId;

  const importedCheckpoint: DeltaCheckpoint = {
    ...exported.checkpoint,
    id: newId,
    agentId,
    isDelta: false,
    parentCheckpointId: undefined,
  };

  // Store
  await db.insert(checkpointsTable).values({
    id: newId,
    agentId,
    state: importedCheckpoint,
    createdAt: new Date(),
  });

  log.info(
    {
      type: "checkpoint",
      action: "import",
      originalId: exported.checkpoint.id,
      newId,
      agentId,
    },
    `[CHECKPOINT] Imported checkpoint as ${newId}`,
  );

  return {
    id: newId,
    agentId,
    createdAt: importedCheckpoint.createdAt,
    tokenUsage: importedCheckpoint.tokenUsage,
    description: importedCheckpoint.description,
    tags: importedCheckpoint.tags,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Compute SHA-256 hash of checkpoint data.
 */
async function computeCheckpointHash(checkpoint: Checkpoint): Promise<string> {
  // Use a stable stringify function (sort keys)
  const stableStringify = (obj: unknown): string => {
    if (obj instanceof Date) {
      return JSON.stringify(obj.toISOString());
    }
    if (typeof obj !== "object" || obj === null) {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return `[${obj.map(stableStringify).join(",")}]`;
    }
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const val = (obj as Record<string, unknown>)[key];
      if (val !== undefined) {
        parts.push(`${JSON.stringify(key)}:${stableStringify(val)}`);
      }
    }
    return `{${parts.join(",")}}`;
  };

  const data = stableStringify({
    agentId: checkpoint.agentId,
    createdAt: checkpoint.createdAt,
    conversationHistory: checkpoint.conversationHistory,
    toolState: checkpoint.toolState,
    tokenUsage: checkpoint.tokenUsage,
  });

  const encoder = new TextEncoder();
  const buffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Delete a checkpoint.
 */
export async function deleteCheckpoint(checkpointId: string): Promise<void> {
  const log = getLogger();
  const checkpoint = await getCheckpoint(checkpointId);

  if (!checkpoint) {
    return; // Already deleted
  }

  // Check if any other checkpoints depend on this one via delta chain
  const dependents = await db
    .select({ id: checkpointsTable.id })
    .from(checkpointsTable)
    .where(
      sql`json_extract(${checkpointsTable.state}, '$.parentCheckpointId') = ${checkpointId}`,
    )
    .limit(1);

  const firstDependent = dependents[0];
  if (firstDependent) {
    throw new CheckpointError(
      "HAS_DEPENDENTS",
      `Cannot delete checkpoint ${checkpointId}: it is referenced as parent by ${firstDependent.id}`,
    );
  }

  // Remove from storage
  await db
    .delete(checkpointsTable)
    .where(eq(checkpointsTable.id, checkpointId));

  incrementCounter("flywheel_checkpoints_deleted_total", 1, {});

  log.info(
    { type: "checkpoint", action: "delete", checkpointId },
    `[CHECKPOINT] Deleted checkpoint ${checkpointId}`,
  );
}

/**
 * Transfer a checkpoint to a new agent.
 */
export async function transferCheckpoint(
  checkpointId: string,
  targetAgentId: string,
): Promise<void> {
  const log = getLogger();

  const result = await db
    .update(checkpointsTable)
    .set({ agentId: targetAgentId })
    .where(eq(checkpointsTable.id, checkpointId))
    .returning({ id: checkpointsTable.id });

  if (result.length === 0) {
    throw new CheckpointError(
      "CHECKPOINT_NOT_FOUND",
      `Checkpoint ${checkpointId} not found`,
    );
  }

  log.info(
    { type: "checkpoint", action: "transfer", checkpointId, targetAgentId },
    `[CHECKPOINT] Transferred checkpoint ${checkpointId} to agent ${targetAgentId}`,
  );
}

/**
 * Clean up old checkpoints for an agent, keeping only the most recent N.
 * Respects delta chain dependencies - checkpoints that are parents of other
 * checkpoints will not be deleted to avoid corrupting delta chains.
 */
export async function pruneCheckpoints(
  agentId: string,
  keepCount: number,
): Promise<number> {
  const log = getLogger();

  // Get all checkpoints sorted by date (oldest first)
  const allCheckpoints = await db
    .select({ id: checkpointsTable.id })
    .from(checkpointsTable)
    .where(eq(checkpointsTable.agentId, agentId))
    .orderBy(checkpointsTable.createdAt);

  if (allCheckpoints.length <= keepCount) {
    return 0;
  }

  const toDelete = allCheckpoints.slice(0, allCheckpoints.length - keepCount);
  const candidateIds = toDelete.map((r) => r.id);

  if (candidateIds.length === 0) return 0;

  // Find checkpoints that are referenced as parents by other checkpoints.
  // These cannot be safely deleted without corrupting delta chains.
  const referencedParents = await db
    .select({
      parentId: sql<
        string | null
      >`json_extract(${checkpointsTable.state}, '$.parentCheckpointId')`,
    })
    .from(checkpointsTable)
    .where(eq(checkpointsTable.agentId, agentId));

  const parentIds = new Set(
    referencedParents
      .map((r) => r.parentId)
      .filter((id): id is string => id !== null && id !== undefined),
  );

  // Filter out candidates that are parents of other checkpoints
  const safeToDelete = candidateIds.filter((id) => !parentIds.has(id));

  if (safeToDelete.length === 0) {
    log.debug(
      {
        type: "checkpoint",
        action: "prune",
        agentId,
        candidates: candidateIds.length,
        skipped: candidateIds.length,
      },
      "[CHECKPOINT] All prune candidates are delta chain parents, skipping",
    );
    return 0;
  }

  // Batch delete only safe checkpoints
  await db
    .delete(checkpointsTable)
    .where(inArray(checkpointsTable.id, safeToDelete));

  incrementCounter(
    "flywheel_checkpoints_pruned_total",
    safeToDelete.length,
    {},
  );

  const skipped = candidateIds.length - safeToDelete.length;
  log.info(
    {
      type: "checkpoint",
      action: "prune",
      agentId,
      deleted: safeToDelete.length,
      skippedDeltaParents: skipped,
    },
    `[CHECKPOINT] Pruned ${safeToDelete.length} old checkpoints for agent ${agentId}${skipped > 0 ? ` (skipped ${skipped} delta chain parents)` : ""}`,
  );

  return safeToDelete.length;
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Custom error class for checkpoint operations.
 */
export class CheckpointError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "CheckpointError";
  }
}
