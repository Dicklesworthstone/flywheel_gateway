/**
 * Handoff Service - Core orchestration for agent-to-agent work transfer.
 *
 * Implements the Session Handoff Protocol with:
 * - State machine for handoff phases
 * - Context packaging and transfer
 * - Resource handover (reservations, checkpoints, messages)
 * - Agent Mail notifications
 * - Full audit trail
 */

import type {
  CompleteHandoffResult,
  HandoffContext,
  HandoffPhase,
  HandoffPreferences,
  HandoffReason,
  HandoffRecord,
  HandoffStats,
  HandoffUrgency,
  InitiateHandoffResult,
  ResourceManifest,
  RespondHandoffResult,
} from "@flywheel/shared/types";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import type { Channel } from "../ws/channels";
import { getHub } from "../ws/hub";
import type { MessageType } from "../ws/messages";
import { logger } from "./logger";

// ============================================================================
// Constants
// ============================================================================

/** Default handoff timeout in milliseconds (5 minutes) */
const DEFAULT_TIMEOUT_MS = 300_000;

/** Maximum handoff timeout in milliseconds (30 minutes) */
const MAX_TIMEOUT_MS = 1_800_000;

/** Cleanup interval for expired handoffs (1 minute) */
const CLEANUP_INTERVAL_MS = 60_000;

/** Retention period for completed handoffs before removal (1 hour) */
const COMPLETED_RETENTION_MS = 3_600_000;

/** Maximum pending handoffs per agent */
const MAX_PENDING_PER_AGENT = 5;

// ============================================================================
// Storage
// ============================================================================

/** In-memory storage for active handoffs */
const handoffStore: Map<string, HandoffRecord> = new Map();

/** Index: source agent ID -> handoff IDs */
const sourceAgentIndex: Map<string, Set<string>> = new Map();

/** Index: target agent ID -> handoff IDs */
const targetAgentIndex: Map<string, Set<string>> = new Map();

/** Cleanup interval handle */
let cleanupInterval: Timer | null = null;

/** Statistics tracking */
const stats = {
  totalHandoffs: 0,
  completedHandoffs: 0,
  failedHandoffs: 0,
  cancelledHandoffs: 0,
  totalTransferTimeMs: 0,
  byReason: {} as Record<HandoffReason, number>,
  byUrgency: {} as Record<HandoffUrgency, number>,
};

// ============================================================================
// Valid Transitions (reimplemented to avoid import issues)
// ============================================================================

const VALID_TRANSITIONS: Record<HandoffPhase, HandoffPhase[]> = {
  initiate: ["pending", "cancelled"],
  pending: ["transfer", "rejected", "cancelled"],
  transfer: ["complete", "failed", "cancelled"],
  complete: [],
  rejected: ["cancelled"],
  failed: ["cancelled"],
  cancelled: [],
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique handoff ID.
 */
function generateHandoffId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = new Uint8Array(12);
  crypto.getRandomValues(randomBytes);
  let result = "";
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(randomBytes[i]! % chars.length);
  }
  return `hoff_${result}`;
}

/**
 * Check if a phase transition is valid.
 */
function isValidTransition(from: HandoffPhase, to: HandoffPhase): boolean {
  const validTargets = VALID_TRANSITIONS[from];
  return validTargets?.includes(to) ?? false;
}

/**
 * Publish handoff event to WebSocket.
 */
function publishHandoffEvent(
  workspaceId: string,
  eventType: MessageType,
  payload: Record<string, unknown>,
): void {
  const hub = getHub();
  const channel: Channel = { type: "workspace:handoffs", workspaceId };
  hub.publish(channel, eventType, payload, { workspaceId });
}

/**
 * Add to index.
 */
function addToIndex(
  index: Map<string, Set<string>>,
  key: string,
  id: string,
): void {
  let set = index.get(key);
  if (!set) {
    set = new Set();
    index.set(key, set);
  }
  set.add(id);
}

/**
 * Remove from index.
 */
function removeFromIndex(
  index: Map<string, Set<string>>,
  key: string,
  id: string,
): void {
  const set = index.get(key);
  if (set) {
    set.delete(id);
    if (set.size === 0) {
      index.delete(key);
    }
  }
}

/**
 * Add audit trail entry.
 */
function addAuditEntry(
  record: HandoffRecord,
  event: string,
  details: Record<string, unknown> = {},
): void {
  record.auditTrail.push({
    timestamp: new Date(),
    event,
    details: {
      ...details,
      correlationId: getCorrelationId(),
    },
  });
  record.updatedAt = new Date();
}

// ============================================================================
// Core Operations
// ============================================================================

/**
 * Initiate a handoff from source to target agent.
 */
export async function initiateHandoff(params: {
  sourceAgentId: string;
  targetAgentId: string | null;
  projectId: string;
  beadId?: string;
  reason: HandoffReason;
  urgency?: HandoffUrgency;
  context: HandoffContext;
  resourceManifest: ResourceManifest;
  preferences?: Partial<HandoffPreferences>;
}): Promise<InitiateHandoffResult> {
  const log = getLogger().child({
    sourceAgentId: params.sourceAgentId,
    targetAgentId: params.targetAgentId,
    projectId: params.projectId,
    correlationId: getCorrelationId(),
  });

  // Check pending limit for source agent
  const sourceHandoffs = sourceAgentIndex.get(params.sourceAgentId);
  if (sourceHandoffs && sourceHandoffs.size >= MAX_PENDING_PER_AGENT) {
    log.warn("Source agent has too many pending handoffs");
    return {
      success: false,
      error: `Maximum pending handoffs (${MAX_PENDING_PER_AGENT}) reached for source agent`,
    };
  }

  // Build preferences with defaults
  const preferences: HandoffPreferences = {
    requireAcknowledgment: true,
    allowPartialTransfer: false,
    timeoutMs: Math.min(
      params.preferences?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
    fallbackBehavior: params.preferences?.fallbackBehavior ?? "escalate",
    priorityAgents: params.preferences?.priorityAgents ?? [],
  };

  const now = new Date();
  const expiresAt = new Date(now.getTime() + preferences.timeoutMs);
  const handoffId = generateHandoffId();

  // Create handoff record
  const record: HandoffRecord = {
    id: handoffId,
    phase: "initiate",
    request: {
      handoffId,
      sourceAgentId: params.sourceAgentId,
      targetAgentId: params.targetAgentId,
      projectId: params.projectId,
      ...(params.beadId !== undefined && { beadId: params.beadId }),
      reason: params.reason,
      urgency: params.urgency ?? "normal",
      context: params.context,
      resourceManifest: params.resourceManifest,
      preferences,
      expiresAt,
      createdAt: now,
    },
    auditTrail: [],
    createdAt: now,
    updatedAt: now,
  };

  // Add initial audit entry
  addAuditEntry(record, "handoff_initiated", {
    reason: params.reason,
    urgency: params.urgency ?? "normal",
    targetAgentId: params.targetAgentId,
    contextSize: JSON.stringify(params.context).length,
    resourceCount:
      params.resourceManifest.fileReservations.length +
      params.resourceManifest.checkpoints.length +
      params.resourceManifest.pendingMessages.length,
  });

  // Store and index
  handoffStore.set(handoffId, record);
  addToIndex(sourceAgentIndex, params.sourceAgentId, handoffId);
  if (params.targetAgentId) {
    addToIndex(targetAgentIndex, params.targetAgentId, handoffId);
  }

  // Transition to pending
  await transitionPhase(handoffId, "pending");

  // Update stats
  stats.totalHandoffs++;
  stats.byReason[params.reason] = (stats.byReason[params.reason] ?? 0) + 1;
  stats.byUrgency[params.urgency ?? "normal"] =
    (stats.byUrgency[params.urgency ?? "normal"] ?? 0) + 1;

  log.info(
    { handoffId, expiresAt: expiresAt.toISOString() },
    "Handoff initiated",
  );

  // Publish event
  publishHandoffEvent(params.projectId, "handoff.initiated", {
    handoffId,
    sourceAgentId: params.sourceAgentId,
    targetAgentId: params.targetAgentId,
    reason: params.reason,
    urgency: params.urgency ?? "normal",
    beadId: params.beadId,
    expiresAt: expiresAt.toISOString(),
    initiatedAt: now.toISOString(),
  });

  return {
    success: true,
    handoffId,
    phase: "pending",
    expiresAt,
  };
}

/**
 * Transition handoff to a new phase.
 */
async function transitionPhase(
  handoffId: string,
  newPhase: HandoffPhase,
  details?: Record<string, unknown>,
): Promise<boolean> {
  const record = handoffStore.get(handoffId);
  if (!record) {
    logger.warn({ handoffId }, "Handoff not found for transition");
    return false;
  }

  if (!isValidTransition(record.phase, newPhase)) {
    logger.warn(
      { handoffId, currentPhase: record.phase, targetPhase: newPhase },
      "Invalid handoff phase transition",
    );
    return false;
  }

  const previousPhase = record.phase;
  record.phase = newPhase;

  addAuditEntry(record, "phase_transition", {
    from: previousPhase,
    to: newPhase,
    ...details,
  });

  // Handle terminal states (rejected is semi-terminal - can only go to cancelled)
  if (
    newPhase === "complete" ||
    newPhase === "cancelled" ||
    newPhase === "failed" ||
    newPhase === "rejected"
  ) {
    record.completedAt = new Date();

    // Remove from indices to prevent memory leak
    removeFromIndex(sourceAgentIndex, record.request.sourceAgentId, handoffId);
    if (record.request.targetAgentId) {
      removeFromIndex(
        targetAgentIndex,
        record.request.targetAgentId,
        handoffId,
      );
    }
    if (record.acknowledgment?.receivingAgentId) {
      removeFromIndex(
        targetAgentIndex,
        record.acknowledgment.receivingAgentId,
        handoffId,
      );
    }

    // Update stats
    if (newPhase === "complete") {
      stats.completedHandoffs++;
      const transferTime =
        record.completedAt.getTime() - record.createdAt.getTime();
      stats.totalTransferTimeMs += transferTime;
    } else if (newPhase === "failed") {
      stats.failedHandoffs++;
    } else if (newPhase === "cancelled") {
      stats.cancelledHandoffs++;
    }
  }

  // Publish event
  publishHandoffEvent(record.request.projectId, "handoff.phase_changed", {
    handoffId,
    previousPhase,
    newPhase,
    timestamp: new Date().toISOString(),
    ...details,
  });

  return true;
}

/**
 * Accept a handoff as the receiving agent.
 */
export async function acceptHandoff(params: {
  handoffId: string;
  receivingAgentId: string;
  estimatedResumeTime?: Date;
  receiverNotes?: string;
}): Promise<RespondHandoffResult> {
  const log = getLogger().child({
    handoffId: params.handoffId,
    receivingAgentId: params.receivingAgentId,
    correlationId: getCorrelationId(),
  });

  const record = handoffStore.get(params.handoffId);
  if (!record) {
    return {
      success: false,
      handoffId: params.handoffId,
      phase: "cancelled",
      error: "Handoff not found",
    };
  }

  // Check if still in pending phase
  if (record.phase !== "pending") {
    return {
      success: false,
      handoffId: params.handoffId,
      phase: record.phase,
      error: `Cannot accept handoff in ${record.phase} phase`,
    };
  }

  // Check if expired
  if (new Date() > record.request.expiresAt) {
    await transitionPhase(params.handoffId, "failed", { reason: "expired" });
    return {
      success: false,
      handoffId: params.handoffId,
      phase: "failed",
      error: "Handoff has expired",
    };
  }

  // Validate target agent (if specific target was requested)
  if (
    record.request.targetAgentId &&
    record.request.targetAgentId !== params.receivingAgentId
  ) {
    return {
      success: false,
      handoffId: params.handoffId,
      phase: record.phase,
      error: "Agent is not the intended target for this handoff",
    };
  }

  // Create acknowledgment
  const now = new Date();
  record.acknowledgment = {
    handoffId: params.handoffId,
    receivingAgentId: params.receivingAgentId,
    status: "accepted",
    acceptedAt: now,
    ...(params.estimatedResumeTime !== undefined && {
      estimatedResumeTime: params.estimatedResumeTime,
    }),
    ...(params.receiverNotes !== undefined && {
      receiverNotes: params.receiverNotes,
    }),
  };

  addAuditEntry(record, "handoff_accepted", {
    receivingAgentId: params.receivingAgentId,
    estimatedResumeTime: params.estimatedResumeTime?.toISOString(),
  });

  // Update target agent index if it was a broadcast
  if (!record.request.targetAgentId) {
    addToIndex(targetAgentIndex, params.receivingAgentId, params.handoffId);
  }

  // Transition to transfer
  await transitionPhase(params.handoffId, "transfer");

  log.info("Handoff accepted");

  // Publish event
  publishHandoffEvent(record.request.projectId, "handoff.accepted", {
    handoffId: params.handoffId,
    sourceAgentId: record.request.sourceAgentId,
    receivingAgentId: params.receivingAgentId,
    acceptedAt: now.toISOString(),
  });

  return {
    success: true,
    handoffId: params.handoffId,
    phase: "transfer",
  };
}

/**
 * Reject a handoff as the receiving agent.
 */
export async function rejectHandoff(params: {
  handoffId: string;
  receivingAgentId: string;
  reason: string;
  suggestedAlternative?: string;
}): Promise<RespondHandoffResult> {
  const log = getLogger().child({
    handoffId: params.handoffId,
    receivingAgentId: params.receivingAgentId,
    correlationId: getCorrelationId(),
  });

  const record = handoffStore.get(params.handoffId);
  if (!record) {
    return {
      success: false,
      handoffId: params.handoffId,
      phase: "cancelled",
      error: "Handoff not found",
    };
  }

  if (record.phase !== "pending") {
    return {
      success: false,
      handoffId: params.handoffId,
      phase: record.phase,
      error: `Cannot reject handoff in ${record.phase} phase`,
    };
  }

  // Create rejection acknowledgment
  const now = new Date();
  record.acknowledgment = {
    handoffId: params.handoffId,
    receivingAgentId: params.receivingAgentId,
    status: "rejected",
    rejectedAt: now,
    rejectionReason: params.reason,
    ...(params.suggestedAlternative !== undefined && {
      suggestedAlternative: params.suggestedAlternative,
    }),
  };

  addAuditEntry(record, "handoff_rejected", {
    receivingAgentId: params.receivingAgentId,
    reason: params.reason,
    suggestedAlternative: params.suggestedAlternative,
  });

  // Transition to rejected
  await transitionPhase(params.handoffId, "rejected", {
    reason: params.reason,
  });

  log.info({ reason: params.reason }, "Handoff rejected");

  // Publish event
  publishHandoffEvent(record.request.projectId, "handoff.rejected", {
    handoffId: params.handoffId,
    sourceAgentId: record.request.sourceAgentId,
    receivingAgentId: params.receivingAgentId,
    reason: params.reason,
    suggestedAlternative: params.suggestedAlternative,
    rejectedAt: now.toISOString(),
  });

  // Handle fallback behavior
  await handleFallback(record);

  return {
    success: true,
    handoffId: params.handoffId,
    phase: "rejected",
  };
}

/**
 * Handle fallback behavior after rejection or failure.
 */
async function handleFallback(record: HandoffRecord): Promise<void> {
  const fallback = record.request.preferences.fallbackBehavior;

  addAuditEntry(record, "fallback_triggered", { behavior: fallback });

  switch (fallback) {
    case "broadcast":
      // Re-initiate as broadcast (implementation would create new handoff)
      logger.info(
        { handoffId: record.id },
        "Fallback: would broadcast to available agents",
      );
      break;

    case "retry":
      // Retry same target
      logger.info(
        { handoffId: record.id },
        "Fallback: would retry same target",
      );
      break;

    case "escalate":
      // Notify user
      publishHandoffEvent(record.request.projectId, "handoff.escalated", {
        handoffId: record.id,
        reason: "fallback_escalation",
        sourceAgentId: record.request.sourceAgentId,
        originalTarget: record.request.targetAgentId,
        escalatedAt: new Date().toISOString(),
      });
      break;

    case "abort":
      // Just cancel
      await transitionPhase(record.id, "cancelled", {
        reason: "abort_fallback",
      });
      break;
  }
}

/**
 * Cancel a handoff.
 */
export async function cancelHandoff(params: {
  handoffId: string;
  agentId: string;
  reason?: string;
}): Promise<RespondHandoffResult> {
  const log = getLogger().child({
    handoffId: params.handoffId,
    agentId: params.agentId,
    correlationId: getCorrelationId(),
  });

  const record = handoffStore.get(params.handoffId);
  if (!record) {
    return {
      success: false,
      handoffId: params.handoffId,
      phase: "cancelled",
      error: "Handoff not found",
    };
  }

  // Only source agent can cancel
  if (record.request.sourceAgentId !== params.agentId) {
    return {
      success: false,
      handoffId: params.handoffId,
      phase: record.phase,
      error: "Only source agent can cancel handoff",
    };
  }

  // Check if already in terminal state
  if (record.phase === "complete" || record.phase === "cancelled") {
    return {
      success: false,
      handoffId: params.handoffId,
      phase: record.phase,
      error: `Cannot cancel handoff in ${record.phase} phase`,
    };
  }

  addAuditEntry(record, "handoff_cancelled", {
    cancelledBy: params.agentId,
    reason: params.reason,
  });

  await transitionPhase(params.handoffId, "cancelled", {
    reason: params.reason,
  });

  log.info({ reason: params.reason }, "Handoff cancelled");

  // Publish event
  publishHandoffEvent(record.request.projectId, "handoff.cancelled", {
    handoffId: params.handoffId,
    cancelledBy: params.agentId,
    reason: params.reason,
    cancelledAt: new Date().toISOString(),
  });

  return {
    success: true,
    handoffId: params.handoffId,
    phase: "cancelled",
  };
}

/**
 * Complete a handoff after successful resource transfer.
 */
export async function completeHandoff(params: {
  handoffId: string;
  transferSummary: {
    filesModified: number;
    reservationsTransferred: number;
    checkpointsTransferred: number;
    messagesForwarded: number;
  };
}): Promise<CompleteHandoffResult> {
  const log = getLogger().child({
    handoffId: params.handoffId,
    correlationId: getCorrelationId(),
  });

  const record = handoffStore.get(params.handoffId);
  if (!record) {
    return {
      success: false,
      handoffId: params.handoffId,
      newOwnerAgentId: "",
      transferSummary: params.transferSummary,
      error: "Handoff not found",
    };
  }

  if (record.phase !== "transfer") {
    return {
      success: false,
      handoffId: params.handoffId,
      newOwnerAgentId: record.acknowledgment?.receivingAgentId ?? "",
      transferSummary: params.transferSummary,
      error: `Cannot complete handoff in ${record.phase} phase`,
    };
  }

  const receivingAgentId = record.acknowledgment?.receivingAgentId;
  if (!receivingAgentId) {
    return {
      success: false,
      handoffId: params.handoffId,
      newOwnerAgentId: "",
      transferSummary: params.transferSummary,
      error: "No receiving agent acknowledgment",
    };
  }

  // Update acknowledgment with receipt
  if (record.acknowledgment) {
    record.acknowledgment.contextReceived = {
      filesModified: params.transferSummary.filesModified,
      decisionsReceived: record.request.context.decisionsMade.length,
      resourcesTransferred:
        params.transferSummary.reservationsTransferred +
        params.transferSummary.checkpointsTransferred +
        params.transferSummary.messagesForwarded,
    };
  }

  addAuditEntry(record, "handoff_completed", {
    newOwnerAgentId: receivingAgentId,
    transferSummary: params.transferSummary,
  });

  await transitionPhase(params.handoffId, "complete");

  log.info(
    { receivingAgentId, transferSummary: params.transferSummary },
    "Handoff completed",
  );

  // Publish event
  publishHandoffEvent(record.request.projectId, "handoff.completed", {
    handoffId: params.handoffId,
    sourceAgentId: record.request.sourceAgentId,
    receivingAgentId,
    transferSummary: params.transferSummary,
    completedAt: new Date().toISOString(),
    durationMs: record.completedAt
      ? record.completedAt.getTime() - record.createdAt.getTime()
      : 0,
  });

  return {
    success: true,
    handoffId: params.handoffId,
    newOwnerAgentId: receivingAgentId,
    transferSummary: params.transferSummary,
  };
}

/**
 * Mark a handoff as failed.
 */
export async function failHandoff(params: {
  handoffId: string;
  errorCode: string;
  errorMessage: string;
  recoverable: boolean;
}): Promise<RespondHandoffResult> {
  const log = getLogger().child({
    handoffId: params.handoffId,
    correlationId: getCorrelationId(),
  });

  const record = handoffStore.get(params.handoffId);
  if (!record) {
    return {
      success: false,
      handoffId: params.handoffId,
      phase: "cancelled",
      error: "Handoff not found",
    };
  }

  record.error = {
    code: params.errorCode,
    message: params.errorMessage,
    recoverable: params.recoverable,
    occurredAt: new Date(),
  };

  addAuditEntry(record, "handoff_failed", {
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
    recoverable: params.recoverable,
  });

  await transitionPhase(params.handoffId, "failed", {
    errorCode: params.errorCode,
  });

  log.error(
    { errorCode: params.errorCode, errorMessage: params.errorMessage },
    "Handoff failed",
  );

  // Publish event
  publishHandoffEvent(record.request.projectId, "handoff.failed", {
    handoffId: params.handoffId,
    sourceAgentId: record.request.sourceAgentId,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
    recoverable: params.recoverable,
    failedAt: new Date().toISOString(),
  });

  // Handle fallback
  await handleFallback(record);

  return {
    success: true,
    handoffId: params.handoffId,
    phase: "failed",
  };
}

// ============================================================================
// Query Operations
// ============================================================================

/**
 * Get a handoff by ID.
 */
export function getHandoff(handoffId: string): HandoffRecord | null {
  return handoffStore.get(handoffId) ?? null;
}

/**
 * List handoffs for a source agent.
 */
export function listHandoffsForSource(
  sourceAgentId: string,
  options?: { phase?: HandoffPhase; limit?: number },
): HandoffRecord[] {
  const handoffIds = sourceAgentIndex.get(sourceAgentId) ?? new Set();
  let results: HandoffRecord[] = [];

  for (const id of handoffIds) {
    const record = handoffStore.get(id);
    if (record) {
      if (!options?.phase || record.phase === options.phase) {
        results.push(record);
      }
    }
  }

  // Sort by created date (newest first)
  results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // Apply limit
  if (options?.limit) {
    results = results.slice(0, options.limit);
  }

  return results;
}

/**
 * List handoffs targeting an agent.
 */
export function listHandoffsForTarget(
  targetAgentId: string,
  options?: { phase?: HandoffPhase; limit?: number },
): HandoffRecord[] {
  const handoffIds = targetAgentIndex.get(targetAgentId) ?? new Set();
  let results: HandoffRecord[] = [];

  for (const id of handoffIds) {
    const record = handoffStore.get(id);
    if (record) {
      if (!options?.phase || record.phase === options.phase) {
        results.push(record);
      }
    }
  }

  results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  if (options?.limit) {
    results = results.slice(0, options.limit);
  }

  return results;
}

/**
 * List pending handoffs available for any agent to accept.
 */
export function listBroadcastHandoffs(projectId: string): HandoffRecord[] {
  const results: HandoffRecord[] = [];

  for (const record of handoffStore.values()) {
    if (
      record.request.projectId === projectId &&
      record.request.targetAgentId === null &&
      record.phase === "pending"
    ) {
      results.push(record);
    }
  }

  results.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return results;
}

/**
 * Get handoff statistics.
 */
export function getHandoffStats(): HandoffStats {
  const completedCount = stats.completedHandoffs || 1; // Avoid division by zero
  return {
    totalHandoffs: stats.totalHandoffs,
    completedHandoffs: stats.completedHandoffs,
    failedHandoffs: stats.failedHandoffs,
    cancelledHandoffs: stats.cancelledHandoffs,
    averageTransferTimeMs: stats.totalTransferTimeMs / completedCount,
    byReason: { ...stats.byReason },
    byUrgency: { ...stats.byUrgency },
  };
}

// ============================================================================
// Background Cleanup
// ============================================================================

/**
 * Clean up expired handoffs and remove old terminal handoffs.
 */
async function cleanupExpiredHandoffs(): Promise<number> {
  const now = new Date();
  let expiredCount = 0;
  let removedCount = 0;

  // Collect IDs to avoid modifying map during iteration
  const toRemove: string[] = [];

  for (const [id, record] of handoffStore) {
    // Clean up non-terminal handoffs that have expired
    // Note: rejected is excluded because fallback was already triggered
    if (
      record.phase !== "complete" &&
      record.phase !== "cancelled" &&
      record.phase !== "failed" &&
      record.phase !== "rejected" &&
      now > record.request.expiresAt
    ) {
      addAuditEntry(record, "handoff_expired", {
        phase: record.phase,
        expiresAt: record.request.expiresAt.toISOString(),
      });

      await transitionPhase(id, "failed", { reason: "timeout" });
      expiredCount++;

      logger.debug(
        {
          handoffId: id,
          phase: record.phase,
          sourceAgentId: record.request.sourceAgentId,
        },
        "Expired handoff cleaned up",
      );
    }

    // Remove old terminal handoffs to prevent memory leak
    if (
      record.completedAt &&
      (record.phase === "complete" ||
        record.phase === "cancelled" ||
        record.phase === "failed" ||
        record.phase === "rejected") &&
      now.getTime() - record.completedAt.getTime() > COMPLETED_RETENTION_MS
    ) {
      toRemove.push(id);
    }
  }

  // Remove old terminal handoffs
  for (const id of toRemove) {
    handoffStore.delete(id);
    removedCount++;
  }

  if (expiredCount > 0 || removedCount > 0) {
    logger.info({ expiredCount, removedCount }, "Handoff cleanup completed");
  }

  return expiredCount + removedCount;
}

/**
 * Start the background cleanup job.
 */
export function startCleanupJob(): void {
  if (cleanupInterval) {
    return;
  }

  cleanupInterval = setInterval(() => {
    cleanupExpiredHandoffs().catch((err) => {
      logger.error({ error: err }, "Error in handoff cleanup job");
    });
  }, CLEANUP_INTERVAL_MS);

  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  logger.info(
    { intervalMs: CLEANUP_INTERVAL_MS },
    "Handoff cleanup job started",
  );
}

/**
 * Stop the background cleanup job.
 */
export function stopCleanupJob(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.info("Handoff cleanup job stopped");
  }
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Clear all handoffs. Only for testing.
 */
export function _clearAllHandoffs(): void {
  handoffStore.clear();
  sourceAgentIndex.clear();
  targetAgentIndex.clear();

  // Reset stats
  stats.totalHandoffs = 0;
  stats.completedHandoffs = 0;
  stats.failedHandoffs = 0;
  stats.cancelledHandoffs = 0;
  stats.totalTransferTimeMs = 0;
  stats.byReason = {} as Record<HandoffReason, number>;
  stats.byUrgency = {} as Record<HandoffUrgency, number>;
}

/**
 * Get the raw handoff store. Only for testing.
 */
export function _getHandoffStore(): Map<string, HandoffRecord> {
  return handoffStore;
}
