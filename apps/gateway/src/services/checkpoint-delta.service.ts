/**
 * Incremental Checkpoint Streaming & Checkpoint Diff Viewer Service
 * (bd-1qxhc, bd-qby4w)
 *
 * Provides:
 * 1. Incremental Checkpoint Streaming (bd-1qxhc):
 *    - Delta calculation (`additions`, `modifications`, `deletions`) against base checkpoint
 *    - Delta chain reconstruction (`reconstructCheckpointState`)
 *    - Periodic full snapshot bounding (`maxChainLength`) + byte savings ratio
 * 2. Checkpoint Diff Viewer (bd-qby4w):
 *    - Side-by-side structural comparison between any two checkpoints (`computeCheckpointDiff`)
 *    - File changes (`added`, `modified`, `deleted`), context token deltas, tool call deltas, and decision notes
 */

import { ulid } from "ulid";
import { z } from "zod";

// ============================================================================
// Schemas & Types
// ============================================================================

export const CheckpointStateInputSchema = z.object({
  id: z.string().optional(),
  sessionId: z.string().min(1),
  files: z.record(z.string(), z.string()).default({}),
  contextTokens: z.number().int().min(0).default(0),
  toolCalls: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type CheckpointState = z.infer<typeof CheckpointStateInputSchema> & {
  id: string;
  sequence: number;
  isFullSnapshot: boolean;
  baseCheckpointId: string | null;
  delta?: CheckpointDelta;
  fullSizeBytes: number;
  storedSizeBytes: number;
  compressionRatio: number;
  createdAt: string;
};

export interface DeltaEntry {
  key: string;
  value: unknown;
}

export interface CheckpointDelta {
  id: string;
  baseCheckpointId: string;
  sequence: number;
  additions: DeltaEntry[];
  modifications: DeltaEntry[];
  deletions: string[];
  contextTokensDelta: number;
  addedToolCalls: string[];
  addedDecisions: string[];
  timestamp: string;
}

export interface CheckpointDiffResult {
  fromCheckpointId: string;
  toCheckpointId: string;
  fileChanges: {
    added: string[];
    modified: string[];
    deleted: string[];
  };
  contextDelta: {
    beforeTokens: number;
    afterTokens: number;
    deltaTokens: number;
  };
  toolCallDelta: {
    added: string[];
    removed: string[];
  };
  decisionNotesDelta: {
    added: string[];
  };
}

// ============================================================================
// State Stores
// ============================================================================

const checkpointsById = new Map<string, CheckpointState>();
const checkpointsBySession = new Map<string, CheckpointState[]>();
const fullStateCache = new Map<
  string,
  z.infer<typeof CheckpointStateInputSchema>
>();

const MAX_DELTA_CHAIN_LENGTH = 5;

// ============================================================================
// Incremental Checkpoint Streaming (bd-1qxhc)
// ============================================================================

export function createIncrementalCheckpoint(
  input: z.input<typeof CheckpointStateInputSchema>,
  options?: { maxChainLength?: number },
): CheckpointState {
  const parsed = CheckpointStateInputSchema.parse(input);
  const id = parsed.id ?? `chk_${ulid()}`;
  const sessionList = checkpointsBySession.get(parsed.sessionId) ?? [];
  const sequence = sessionList.length + 1;
  const maxChain = options?.maxChainLength ?? MAX_DELTA_CHAIN_LENGTH;

  const prevCheckpoint = sessionList[sessionList.length - 1];
  const prevState = prevCheckpoint
    ? fullStateCache.get(prevCheckpoint.id)
    : undefined;

  // Periodic full snapshot every maxChainLength steps or on first checkpoint
  const isFullSnapshot =
    !prevCheckpoint || !prevState || (sequence - 1) % maxChain === 0;

  const fullSerialized = JSON.stringify(parsed);
  const fullSizeBytes = Buffer.byteLength(fullSerialized, "utf8");

  let delta: CheckpointDelta | undefined;
  let storedSizeBytes = fullSizeBytes;

  if (!isFullSnapshot && prevCheckpoint && prevState) {
    const additions: DeltaEntry[] = [];
    const modifications: DeltaEntry[] = [];
    const deletions: string[] = [];

    for (const [filePath, content] of Object.entries(parsed.files)) {
      if (!(filePath in prevState.files)) {
        additions.push({ key: filePath, value: content });
      } else if (prevState.files[filePath] !== content) {
        modifications.push({ key: filePath, value: content });
      }
    }

    for (const filePath of Object.keys(prevState.files)) {
      if (!(filePath in parsed.files)) {
        deletions.push(filePath);
      }
    }

    delta = {
      id: `chkd_${ulid()}`,
      baseCheckpointId: prevCheckpoint.id,
      sequence,
      additions,
      modifications,
      deletions,
      contextTokensDelta: parsed.contextTokens - prevState.contextTokens,
      addedToolCalls: parsed.toolCalls.slice(prevState.toolCalls.length),
      addedDecisions: parsed.decisions.slice(prevState.decisions.length),
      timestamp: new Date().toISOString(),
    };

    storedSizeBytes = Buffer.byteLength(JSON.stringify(delta), "utf8");
  }

  const compressionRatio =
    fullSizeBytes > 0
      ? Number((storedSizeBytes / fullSizeBytes).toFixed(4))
      : 1;

  const checkpoint: CheckpointState = {
    ...parsed,
    id,
    sequence,
    isFullSnapshot,
    baseCheckpointId: prevCheckpoint?.id ?? null,
    ...(delta !== undefined && { delta }),
    fullSizeBytes,
    storedSizeBytes,
    compressionRatio,
    createdAt: new Date().toISOString(),
  };

  checkpointsById.set(id, checkpoint);
  fullStateCache.set(id, structuredClone(parsed));
  sessionList.push(checkpoint);
  checkpointsBySession.set(parsed.sessionId, sessionList);

  return checkpoint;
}

export function reconstructCheckpointState(
  checkpointId: string,
): z.infer<typeof CheckpointStateInputSchema> | undefined {
  const target = checkpointsById.get(checkpointId);
  if (!target) return undefined;

  // Walk back to nearest full snapshot in chain
  const chain: CheckpointState[] = [];
  let cursor: CheckpointState | undefined = target;
  while (cursor) {
    chain.unshift(cursor);
    if (cursor.isFullSnapshot || !cursor.baseCheckpointId) break;
    cursor = checkpointsById.get(cursor.baseCheckpointId);
  }

  const base = chain[0];
  if (!base) return undefined;

  const reconstructedFiles: Record<string, string> = { ...base.files };
  let contextTokens = base.contextTokens;
  const toolCalls = [...base.toolCalls];
  const decisions = [...base.decisions];

  for (let i = 1; i < chain.length; i++) {
    const step = chain[i]!;
    if (!step.delta) continue;
    for (const add of step.delta.additions) {
      reconstructedFiles[add.key] = String(add.value);
    }
    for (const mod of step.delta.modifications) {
      reconstructedFiles[mod.key] = String(mod.value);
    }
    for (const del of step.delta.deletions) {
      delete reconstructedFiles[del];
    }
    contextTokens += step.delta.contextTokensDelta;
    toolCalls.push(...step.delta.addedToolCalls);
    decisions.push(...step.delta.addedDecisions);
  }

  return {
    id: target.id,
    sessionId: target.sessionId,
    files: reconstructedFiles,
    contextTokens,
    toolCalls,
    decisions,
    metadata: target.metadata,
  };
}

// ============================================================================
// Checkpoint Diff Viewer (bd-qby4w)
// ============================================================================

export function computeCheckpointDiff(
  fromId: string,
  toId: string,
): CheckpointDiffResult | undefined {
  const fromState = reconstructCheckpointState(fromId);
  const toState = reconstructCheckpointState(toId);
  if (!fromState || !toState) return undefined;

  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const [path, content] of Object.entries(toState.files)) {
    if (!(path in fromState.files)) {
      added.push(path);
    } else if (fromState.files[path] !== content) {
      modified.push(path);
    }
  }

  for (const path of Object.keys(fromState.files)) {
    if (!(path in toState.files)) {
      deleted.push(path);
    }
  }

  const addedTools = toState.toolCalls.filter(
    (t) => !fromState.toolCalls.includes(t),
  );
  const removedTools = fromState.toolCalls.filter(
    (t) => !toState.toolCalls.includes(t),
  );
  const addedDecisions = toState.decisions.filter(
    (d) => !fromState.decisions.includes(d),
  );

  return {
    fromCheckpointId: fromId,
    toCheckpointId: toId,
    fileChanges: {
      added: added.sort(),
      modified: modified.sort(),
      deleted: deleted.sort(),
    },
    contextDelta: {
      beforeTokens: fromState.contextTokens,
      afterTokens: toState.contextTokens,
      deltaTokens: toState.contextTokens - fromState.contextTokens,
    },
    toolCallDelta: {
      added: addedTools,
      removed: removedTools,
    },
    decisionNotesDelta: {
      added: addedDecisions,
    },
  };
}

export function clearCheckpointDeltasForTesting(): void {
  checkpointsById.clear();
  checkpointsBySession.clear();
  fullStateCache.clear();
}
