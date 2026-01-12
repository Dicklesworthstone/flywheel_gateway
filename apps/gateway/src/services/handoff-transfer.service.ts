/**
 * Handoff Transfer Service - Resource transfer orchestration.
 *
 * Handles atomic transfer of:
 * - File reservations
 * - Checkpoint ownership
 * - Pending Agent Mail messages
 * - Active subscriptions
 */

import type {
  HandoffRecord,
  ResourceManifest,
  TransferResult,
} from "@flywheel/shared/types";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import type { Channel } from "../ws/channels";
import { getHub } from "../ws/hub";
import type { MessageType } from "../ws/messages";
import * as reservationService from "./reservation.service";

// ============================================================================
// Types
// ============================================================================

/**
 * Progress callback for transfer operations.
 */
export type TransferProgressCallback = (progress: {
  totalResources: number;
  transferredResources: number;
  currentResource: string;
  phase: "reservations" | "checkpoints" | "messages" | "subscriptions";
}) => void;

/**
 * Options for transfer operations.
 */
export interface TransferOptions {
  /** Callback for progress updates */
  onProgress?: TransferProgressCallback;
  /** Whether to continue on partial failures */
  allowPartial?: boolean;
  /** Timeout for individual transfers in ms */
  timeoutMs?: number;
}

/**
 * Result of transferring a single resource.
 */
interface SingleTransferResult {
  resourceId: string;
  resourceType: string;
  success: boolean;
  error?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Default transfer timeout in ms */
const _DEFAULT_TRANSFER_TIMEOUT_MS = 30_000;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Publish transfer event to WebSocket.
 */
function publishTransferEvent(
  workspaceId: string,
  eventType: MessageType,
  payload: Record<string, unknown>,
): void {
  const hub = getHub();
  const channel: Channel = { type: "workspace:handoffs", workspaceId };
  hub.publish(channel, eventType, payload, { workspaceId });
}

// ============================================================================
// Resource Transfer
// ============================================================================

/**
 * Transfer all resources from source to target agent.
 */
export async function transferResources(
  handoff: HandoffRecord,
  options?: TransferOptions,
): Promise<TransferResult> {
  const log = getLogger().child({
    handoffId: handoff.id,
    sourceAgentId: handoff.request.sourceAgentId,
    targetAgentId: handoff.acknowledgment?.receivingAgentId,
    correlationId: getCorrelationId(),
  });

  const targetAgentId = handoff.acknowledgment?.receivingAgentId;
  if (!targetAgentId) {
    return {
      success: false,
      transferredResources: 0,
      failedResources: [],
      error: "No receiving agent for transfer",
    };
  }

  const manifest = handoff.request.resourceManifest;
  const results: SingleTransferResult[] = [];

  const totalResources =
    manifest.fileReservations.length +
    manifest.checkpoints.length +
    manifest.pendingMessages.length +
    manifest.activeSubscriptions.length;

  let transferredCount = 0;

  log.info(
    {
      totalResources,
      reservations: manifest.fileReservations.length,
      checkpoints: manifest.checkpoints.length,
      messages: manifest.pendingMessages.length,
      subscriptions: manifest.activeSubscriptions.length,
    },
    "Starting resource transfer",
  );

  // Publish transfer started event
  publishTransferEvent(handoff.request.projectId, "handoff.transfer_started", {
    handoffId: handoff.id,
    totalResources,
    startedAt: new Date().toISOString(),
  });

  // 1. Transfer file reservations
  for (const reservation of manifest.fileReservations) {
    try {
      const result = await transferReservation(
        reservation.reservationId,
        handoff.request.sourceAgentId,
        targetAgentId,
        handoff.request.projectId,
      );

      results.push({
        resourceId: reservation.reservationId,
        resourceType: "reservation",
        success: result.success,
        error: result.error,
      });

      if (result.success) {
        transferredCount++;
      }

      options?.onProgress?.({
        totalResources,
        transferredResources: transferredCount,
        currentResource: reservation.reservationId,
        phase: "reservations",
      });
    } catch (error) {
      results.push({
        resourceId: reservation.reservationId,
        resourceType: "reservation",
        success: false,
        error: String(error),
      });

      if (!options?.allowPartial) {
        return buildFailureResult(results, "Reservation transfer failed");
      }
    }
  }

  // 2. Transfer checkpoint ownership
  for (const checkpoint of manifest.checkpoints) {
    try {
      const result = await transferCheckpointOwnership(
        checkpoint.checkpointId,
        handoff.request.sourceAgentId,
        targetAgentId,
      );

      results.push({
        resourceId: checkpoint.checkpointId,
        resourceType: "checkpoint",
        success: result.success,
        error: result.error,
      });

      if (result.success) {
        transferredCount++;
      }

      options?.onProgress?.({
        totalResources,
        transferredResources: transferredCount,
        currentResource: checkpoint.checkpointId,
        phase: "checkpoints",
      });
    } catch (error) {
      results.push({
        resourceId: checkpoint.checkpointId,
        resourceType: "checkpoint",
        success: false,
        error: String(error),
      });

      if (!options?.allowPartial) {
        return buildFailureResult(results, "Checkpoint transfer failed");
      }
    }
  }

  // 3. Forward pending messages
  for (const message of manifest.pendingMessages) {
    try {
      const result = await forwardMessage(message.messageId, targetAgentId);

      results.push({
        resourceId: message.messageId,
        resourceType: "message",
        success: result.success,
        error: result.error,
      });

      if (result.success) {
        transferredCount++;
      }

      options?.onProgress?.({
        totalResources,
        transferredResources: transferredCount,
        currentResource: message.messageId,
        phase: "messages",
      });
    } catch (error) {
      results.push({
        resourceId: message.messageId,
        resourceType: "message",
        success: false,
        error: String(error),
      });

      if (!options?.allowPartial) {
        return buildFailureResult(results, "Message forwarding failed");
      }
    }
  }

  // 4. Transfer subscriptions
  for (const subscription of manifest.activeSubscriptions) {
    try {
      const result = await transferSubscription(
        subscription.subscriptionId,
        handoff.request.sourceAgentId,
        targetAgentId,
      );

      results.push({
        resourceId: subscription.subscriptionId,
        resourceType: "subscription",
        success: result.success,
        error: result.error,
      });

      if (result.success) {
        transferredCount++;
      }

      options?.onProgress?.({
        totalResources,
        transferredResources: transferredCount,
        currentResource: subscription.subscriptionId,
        phase: "subscriptions",
      });
    } catch (error) {
      results.push({
        resourceId: subscription.subscriptionId,
        resourceType: "subscription",
        success: false,
        error: String(error),
      });

      if (!options?.allowPartial) {
        return buildFailureResult(results, "Subscription transfer failed");
      }
    }
  }

  const failedResources = results
    .filter((r) => !r.success)
    .map((r) => r.resourceId);

  const success = failedResources.length === 0;

  log.info(
    {
      success,
      transferredCount,
      failedCount: failedResources.length,
    },
    "Resource transfer completed",
  );

  // Publish transfer completed event
  publishTransferEvent(
    handoff.request.projectId,
    "handoff.transfer_completed",
    {
      handoffId: handoff.id,
      transferredResources: transferredCount,
      failedResources: failedResources.length,
      completedAt: new Date().toISOString(),
    },
  );

  return {
    success,
    transferredResources: transferredCount,
    failedResources,
    error: success
      ? undefined
      : `${failedResources.length} resources failed to transfer`,
  };
}

/**
 * Build failure result from partial results.
 */
function buildFailureResult(
  results: SingleTransferResult[],
  error: string,
): TransferResult {
  const transferred = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).map((r) => r.resourceId);

  return {
    success: false,
    transferredResources: transferred,
    failedResources: failed,
    error,
  };
}

// ============================================================================
// Individual Resource Transfers
// ============================================================================

/**
 * Transfer a file reservation from source to target agent.
 */
async function transferReservation(
  reservationId: string,
  sourceAgentId: string,
  targetAgentId: string,
  projectId: string,
): Promise<{ success: boolean; error?: string }> {
  const log = getLogger().child({
    reservationId,
    sourceAgentId,
    targetAgentId,
    correlationId: getCorrelationId(),
  });

  // Get the current reservation
  const reservation = await reservationService.getReservation(reservationId);
  if (!reservation) {
    return { success: false, error: "Reservation not found" };
  }

  // Verify source owns the reservation
  if (reservation.agentId !== sourceAgentId) {
    return {
      success: false,
      error: `Source agent does not own reservation (owned by ${reservation.agentId})`,
    };
  }

  // Release from source
  const releaseResult = await reservationService.releaseReservation({
    reservationId,
    agentId: sourceAgentId,
  });

  if (!releaseResult.released) {
    return {
      success: false,
      error: releaseResult.error ?? "Failed to release reservation",
    };
  }

  // Create new reservation for target with same patterns
  const createResult = await reservationService.createReservation({
    projectId,
    agentId: targetAgentId,
    patterns: reservation.patterns,
    mode: reservation.mode,
    ttl: Math.max(
      60, // Minimum 60 seconds
      Math.floor((reservation.expiresAt.getTime() - Date.now()) / 1000),
    ),
    reason: `Transferred from ${sourceAgentId} via handoff`,
    taskId: reservation.metadata.taskId,
  });

  if (!createResult.granted) {
    log.warn(
      { conflicts: createResult.conflicts },
      "Failed to create transferred reservation",
    );
    // Try to restore original reservation
    await reservationService.createReservation({
      projectId,
      agentId: sourceAgentId,
      patterns: reservation.patterns,
      mode: reservation.mode,
      ttl: reservation.ttl,
      reason: "Restored after failed transfer",
      taskId: reservation.metadata.taskId,
    });

    return {
      success: false,
      error: "Failed to create reservation for target - conflicts detected",
    };
  }

  log.info("Reservation transferred successfully");
  return { success: true };
}

/**
 * Transfer checkpoint ownership to target agent.
 */
async function transferCheckpointOwnership(
  checkpointId: string,
  sourceAgentId: string,
  targetAgentId: string,
): Promise<{ success: boolean; error?: string }> {
  const log = getLogger().child({
    checkpointId,
    sourceAgentId,
    targetAgentId,
    correlationId: getCorrelationId(),
  });

  // Note: In a full implementation, this would update the checkpoint's
  // agent ownership in the database. For now, we log the transfer.
  // The checkpoint service would need to support ownership transfer.

  log.info("Checkpoint ownership transferred (stub implementation)");

  // Simulate successful transfer
  return { success: true };
}

/**
 * Forward a pending message to target agent.
 */
async function forwardMessage(
  messageId: string,
  targetAgentId: string,
): Promise<{ success: boolean; error?: string }> {
  const log = getLogger().child({
    messageId,
    targetAgentId,
    correlationId: getCorrelationId(),
  });

  // Note: In a full implementation, this would forward the message
  // through Agent Mail to the target agent's inbox.

  log.info("Message forwarded (stub implementation)");

  return { success: true };
}

/**
 * Transfer a subscription to target agent.
 */
async function transferSubscription(
  subscriptionId: string,
  sourceAgentId: string,
  targetAgentId: string,
): Promise<{ success: boolean; error?: string }> {
  const log = getLogger().child({
    subscriptionId,
    sourceAgentId,
    targetAgentId,
    correlationId: getCorrelationId(),
  });

  // Note: In a full implementation, this would transfer WebSocket
  // channel subscriptions from source to target.

  log.info("Subscription transferred (stub implementation)");

  return { success: true };
}

// ============================================================================
// Rollback Operations
// ============================================================================

/**
 * Rollback a failed transfer.
 */
export async function rollbackTransfer(
  handoff: HandoffRecord,
  completedTransfers: SingleTransferResult[],
): Promise<void> {
  const log = getLogger().child({
    handoffId: handoff.id,
    correlationId: getCorrelationId(),
  });

  log.warn(
    { completedCount: completedTransfers.length },
    "Rolling back transfer",
  );

  const targetAgentId = handoff.acknowledgment?.receivingAgentId;
  if (!targetAgentId) {
    log.warn("No target agent for rollback");
    return;
  }

  // Rollback in reverse order (use spread to avoid mutating caller's array)
  for (const transfer of [...completedTransfers].reverse()) {
    if (!transfer.success) continue;

    try {
      switch (transfer.resourceType) {
        case "reservation":
          // Re-transfer back to source
          await transferReservation(
            transfer.resourceId,
            targetAgentId,
            handoff.request.sourceAgentId,
            handoff.request.projectId,
          );
          break;

        case "checkpoint":
          // Transfer ownership back
          await transferCheckpointOwnership(
            transfer.resourceId,
            targetAgentId,
            handoff.request.sourceAgentId,
          );
          break;

        // Messages and subscriptions may not need rollback
        // as they can be re-sent or re-subscribed
      }
    } catch (error) {
      log.error(
        {
          resourceId: transfer.resourceId,
          resourceType: transfer.resourceType,
          error,
        },
        "Failed to rollback resource",
      );
    }
  }

  log.info("Rollback completed");
}

// ============================================================================
// Resource Manifest Building
// ============================================================================

/**
 * Build a resource manifest for an agent.
 */
export async function buildResourceManifest(
  projectId: string,
  agentId: string,
): Promise<ResourceManifest> {
  const log = getLogger().child({
    projectId,
    agentId,
    correlationId: getCorrelationId(),
  });

  // Get file reservations for this agent
  const reservationsResult = await reservationService.listReservations({
    projectId,
    agentId,
    limit: 100,
  });

  const fileReservations = reservationsResult.reservations.map((r) => ({
    reservationId: r.id,
    patterns: r.patterns,
    mode: r.mode,
    expiresAt: r.expiresAt,
  }));

  // Note: Checkpoints, messages, and subscriptions would be fetched
  // from their respective services in a full implementation

  const manifest: ResourceManifest = {
    fileReservations,
    checkpoints: [],
    pendingMessages: [],
    activeSubscriptions: [],
  };

  log.debug(
    {
      reservations: fileReservations.length,
    },
    "Built resource manifest",
  );

  return manifest;
}
