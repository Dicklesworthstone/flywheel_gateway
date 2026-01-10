/**
 * Checkpoint Service - Agent state persistence and recovery.
 *
 * Checkpoints capture agent state for:
 * - Rollback after mistakes
 * - Disaster recovery
 * - Session handoffs
 * - Context window refreshes
 */

import type {
  Checkpoint,
  CheckpointMetadata,
  TokenUsage,
} from "@flywheel/agent-drivers";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { ulid } from "ulid";
import { checkpoints as checkpointsTable, db } from "../db";
import { getCorrelationId, getLogger } from "../middleware/correlation";

// ============================================================================
// Types
// ============================================================================

/**
 * Extended checkpoint with delta support.
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

  return {
    ...checkpoint,
    createdAt,
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
): Promise<CheckpointMetadata> {
  const log = getLogger();
  const correlationId = getCorrelationId();
  const checkpointId = generateCheckpointId();
  const now = new Date();

  // Get latest checkpoint for delta
  const lastCheckpoint = await getLatestCheckpoint(agentId);
  const lastCheckpointId = lastCheckpoint?.id;

  // Build checkpoint
  const checkpoint: DeltaCheckpoint = {
    id: checkpointId,
    agentId,
    createdAt: now,
    tokenUsage: state.tokenUsage,
    description: options.description,
    tags: options.tags,
    conversationHistory: state.conversationHistory,
    toolState: state.toolState,
    contextPack: state.contextPack,
    isDelta: false,
    parentCheckpointId: undefined,
  };

  // If delta mode and we have a parent
  if (options.delta && lastCheckpointId) {
    checkpoint.isDelta = true;
    checkpoint.parentCheckpointId = lastCheckpointId;
  }

  // Persist to DB
  await db.insert(checkpointsTable).values({
    id: checkpointId,
    agentId,
    state: checkpoint,
    createdAt: now,
  });

  log.info(
    {
      type: "checkpoint",
      agentId,
      checkpointId,
      isDelta: checkpoint.isDelta,
      tokenUsage: state.tokenUsage.totalTokens,
      correlationId,
    },
    `[CHECKPOINT] Created checkpoint ${checkpointId} for agent ${agentId}`,
  );

  return {
    id: checkpointId,
    agentId,
    createdAt: now,
    tokenUsage: state.tokenUsage,
    description: options.description,
    tags: options.tags,
  };
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
 */
export async function getAgentCheckpoints(
  agentId: string,
): Promise<CheckpointMetadata[]> {
  const results = await db
    .select()
    .from(checkpointsTable)
    .where(eq(checkpointsTable.agentId, agentId))
    .orderBy(desc(checkpointsTable.id));

  return results.map((row) => {
    const chk = normalizeCheckpoint(row.state as DeltaCheckpoint);
    return {
      id: chk.id,
      agentId: chk.agentId,
      createdAt: chk.createdAt,
      tokenUsage: chk.tokenUsage,
      description: chk.description,
      tags: chk.tags,
    };
  });
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
    .orderBy(desc(checkpointsTable.id))
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
  const chain: DeltaCheckpoint[] = [checkpoint];
  let current = checkpoint;

  while (current.isDelta && current.parentCheckpointId) {
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

  const checkpoint = await getCheckpoint(checkpointId);
  if (!checkpoint) {
    throw new CheckpointError(
      "CHECKPOINT_NOT_FOUND",
      `Checkpoint ${checkpointId} not found`,
    );
  }

  // Verify if requested
  if (options.verify) {
    const verifyResult = await verifyCheckpoint(checkpointId);
    if (!verifyResult.valid) {
      throw new CheckpointError(
        "CHECKPOINT_INVALID",
        `Checkpoint verification failed: ${verifyResult.errors.join(", ")}`,
      );
    }
  }

  // Resolve delta chain if needed
  const resolvedCheckpoint = await resolveDeltaCheckpoint(
    checkpoint as DeltaCheckpoint,
  );

  log.info(
    {
      type: "checkpoint",
      action: "restore",
      checkpointId,
      agentId: checkpoint.agentId,
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
  const checkpoint = (await getCheckpoint(checkpointId)) as
    | DeltaCheckpoint
    | undefined;

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
  if (!checkpoint.conversationHistory) {
    errors.push("Missing conversationHistory");
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
    if (typeof obj !== "object" || obj === null) {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return "[" + obj.map(stableStringify).join(",") + "]";
    }
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const parts = keys.map((key) => {
      const val = (obj as Record<string, unknown>)[key];
      return JSON.stringify(key) + ":" + stableStringify(val);
    });
    return "{" + parts.join(",") + "}";
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

  // TODO: Check if any other checkpoints depend on this one
  // Requires schema update to expose parentCheckpointId as column
  // or JSON query capabilities.

  // Remove from storage
  await db
    .delete(checkpointsTable)
    .where(eq(checkpointsTable.id, checkpointId));

  log.info(
    { type: "checkpoint", action: "delete", checkpointId },
    `[CHECKPOINT] Deleted checkpoint ${checkpointId}`,
  );
}

/**
 * Clean up old checkpoints for an agent, keeping only the most recent N.
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
  const deleteIds = toDelete.map((r) => r.id);

  if (deleteIds.length === 0) return 0;

  // Batch delete
  await db
    .delete(checkpointsTable)
    .where(inArray(checkpointsTable.id, deleteIds));

  log.info(
    { type: "checkpoint", action: "prune", agentId, deleted: deleteIds.length },
    `[CHECKPOINT] Pruned ${deleteIds.length} old checkpoints for agent ${agentId}`,
  );

  return deleteIds.length;
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
