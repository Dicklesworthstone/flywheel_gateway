/**
 * RU (Repo Updater) WebSocket Event Publisher.
 *
 * Provides utilities for publishing real-time events from RU operations
 * (fleet management, sync, and sweep) to WebSocket subscribers.
 */

import { getCorrelationId } from "../middleware/correlation";
import type { Channel } from "../ws/channels";
import { getHub } from "../ws/hub";
import type { MessageMetadata, MessageType } from "../ws/messages";
import { logger } from "./logger";

// ============================================================================
// Event Data Types
// ============================================================================

/**
 * Data for repo added/removed/updated events.
 */
export interface RepoEventData {
  repoId: string;
  fullName: string;
  owner?: string;
  name?: string;
  status?: string;
  previousStatus?: string;
}

/**
 * Data for sync started event.
 */
export interface SyncStartedEventData {
  sessionId: string;
  repoCount: number;
  triggeredBy?: string;
}

/**
 * Data for sync repo progress event.
 */
export interface SyncRepoProgressEventData {
  sessionId: string;
  repoId: string;
  fullName: string;
  status: "running" | "success" | "failed";
  completed: number;
  failed: number;
  total: number;
  duration?: number;
}

/**
 * Data for sync completed event.
 */
export interface SyncCompletedEventData {
  sessionId: string;
  completed: number;
  failed: number;
  cancelled: number;
  total: number;
  durationMs: number;
}

/**
 * Data for sweep created event.
 */
export interface SweepCreatedEventData {
  sessionId: string;
  repoCount: number;
  triggeredBy?: string;
  requiresApproval: boolean;
}

/**
 * Data for sweep progress event.
 */
export interface SweepProgressEventData {
  sessionId: string;
  phase: "phase1" | "phase2" | "phase3";
  total: number;
  analyzed?: number;
  planned?: number;
  executed?: number;
  failed?: number;
}

/**
 * Data for sweep plan event.
 */
export interface SweepPlanEventData {
  sessionId?: string;
  planId: string;
  repoFullName?: string;
  actionCount?: number;
  riskLevel?: string;
  approvedBy?: string;
  rejectedBy?: string;
  reason?: string;
}

/**
 * Data for sweep completed event.
 */
export interface SweepCompletedEventData {
  sessionId: string;
  totalDurationMs?: number;
}

// ============================================================================
// Channel Helpers
// ============================================================================

/**
 * Get the fleet:repos channel for repo events.
 */
function getFleetReposChannel(): Channel {
  return { type: "fleet:repos" };
}

/**
 * Get the fleet:sync channel for general sync events.
 */
function getFleetSyncChannel(): Channel {
  return { type: "fleet:sync" };
}

/**
 * Get the fleet:sync:session channel for session-specific sync events.
 */
function getSyncSessionChannel(sessionId: string): Channel {
  return { type: "fleet:sync:session", sessionId };
}

/**
 * Get the fleet:sweep channel for general sweep events.
 */
function getFleetSweepChannel(): Channel {
  return { type: "fleet:sweep" };
}

/**
 * Get the fleet:sweep:session channel for session-specific sweep events.
 */
function getSweepSessionChannel(sessionId: string): Channel {
  return { type: "fleet:sweep:session", sessionId };
}

// ============================================================================
// Event Publishers
// ============================================================================

/**
 * Publish a generic RU event.
 */
function publishEvent(
  channel: Channel,
  type: MessageType,
  payload: unknown,
  metadata?: MessageMetadata,
): void {
  const correlationId = getCorrelationId();
  const meta: MessageMetadata = {
    correlationId,
    ...metadata,
  };

  getHub().publish(channel, type, payload, meta);

  logger.debug(
    { eventType: type, channel: channel.type, correlationId },
    "Published RU event",
  );
}

// ============================================================================
// Fleet Repo Events
// ============================================================================

/**
 * Publish repo added event.
 */
export function publishRepoAdded(data: RepoEventData): void {
  publishEvent(getFleetReposChannel(), "fleet.repo_added", data);
}

/**
 * Publish repo removed event.
 */
export function publishRepoRemoved(data: RepoEventData): void {
  publishEvent(getFleetReposChannel(), "fleet.repo_removed", data);
}

/**
 * Publish repo updated event (status change, etc.).
 */
export function publishRepoUpdated(data: RepoEventData): void {
  publishEvent(getFleetReposChannel(), "fleet.repo_updated", data);
}

// ============================================================================
// Sync Events
// ============================================================================

/**
 * Publish sync started event.
 */
export function publishSyncStarted(data: SyncStartedEventData): void {
  // Publish to both general sync channel and session-specific channel
  publishEvent(getFleetSyncChannel(), "fleet.sync_started", data);
  publishEvent(
    getSyncSessionChannel(data.sessionId),
    "fleet.sync_started",
    data,
  );
}

/**
 * Publish sync progress event (per-repo progress).
 */
export function publishSyncProgress(data: SyncRepoProgressEventData): void {
  publishEvent(
    getSyncSessionChannel(data.sessionId),
    "fleet.sync_progress",
    data,
  );
}

/**
 * Publish sync completed event.
 */
export function publishSyncCompleted(data: SyncCompletedEventData): void {
  publishEvent(getFleetSyncChannel(), "fleet.sync_completed", data);
  publishEvent(
    getSyncSessionChannel(data.sessionId),
    "fleet.sync_completed",
    data,
  );
}

/**
 * Publish sync cancelled event.
 */
export function publishSyncCancelled(
  sessionId: string,
  cancelledBy?: string,
): void {
  const payload = { sessionId, cancelledBy };
  publishEvent(getFleetSyncChannel(), "fleet.sync_cancelled", payload);
  publishEvent(
    getSyncSessionChannel(sessionId),
    "fleet.sync_cancelled",
    payload,
  );
}

// ============================================================================
// Sweep Events
// ============================================================================

/**
 * Publish sweep created event.
 */
export function publishSweepCreated(data: SweepCreatedEventData): void {
  publishEvent(getFleetSweepChannel(), "fleet.sweep_created", data);
  publishEvent(
    getSweepSessionChannel(data.sessionId),
    "fleet.sweep_created",
    data,
  );
}

/**
 * Publish sweep started event.
 */
export function publishSweepStarted(sessionId: string): void {
  const payload = { sessionId };
  publishEvent(getFleetSweepChannel(), "fleet.sweep_started", payload);
  publishEvent(
    getSweepSessionChannel(sessionId),
    "fleet.sweep_started",
    payload,
  );
}

/**
 * Publish sweep progress event.
 */
export function publishSweepProgress(data: SweepProgressEventData): void {
  publishEvent(
    getSweepSessionChannel(data.sessionId),
    "fleet.sweep_progress",
    data,
  );
}

/**
 * Publish sweep plan created event.
 */
export function publishSweepPlanCreated(data: SweepPlanEventData): void {
  publishEvent(getFleetSweepChannel(), "fleet.plan_created", data);
  if (data.sessionId) {
    publishEvent(
      getSweepSessionChannel(data.sessionId),
      "fleet.plan_created",
      data,
    );
  }
}

/**
 * Publish sweep plan approved event.
 */
export function publishSweepPlanApproved(data: SweepPlanEventData): void {
  publishEvent(getFleetSweepChannel(), "fleet.plan_approved", data);
  if (data.sessionId) {
    publishEvent(
      getSweepSessionChannel(data.sessionId),
      "fleet.plan_approved",
      data,
    );
  }
}

/**
 * Publish sweep plan rejected event.
 */
export function publishSweepPlanRejected(data: SweepPlanEventData): void {
  publishEvent(getFleetSweepChannel(), "fleet.plan_rejected", data);
  if (data.sessionId) {
    publishEvent(
      getSweepSessionChannel(data.sessionId),
      "fleet.plan_rejected",
      data,
    );
  }
}

/**
 * Publish sweep completed event.
 */
export function publishSweepCompleted(data: SweepCompletedEventData): void {
  publishEvent(getFleetSweepChannel(), "fleet.sweep_completed", data);
  publishEvent(
    getSweepSessionChannel(data.sessionId),
    "fleet.sweep_completed",
    data,
  );
}

/**
 * Publish sweep failed event.
 */
export function publishSweepFailed(sessionId: string, error: string): void {
  const payload = { sessionId, error };
  publishEvent(getFleetSweepChannel(), "fleet.sweep_failed", payload);
  publishEvent(
    getSweepSessionChannel(sessionId),
    "fleet.sweep_failed",
    payload,
  );
}

/**
 * Publish sweep cancelled event.
 */
export function publishSweepCancelled(
  sessionId: string,
  cancelledBy?: string,
): void {
  const payload = { sessionId, cancelledBy };
  publishEvent(getFleetSweepChannel(), "fleet.sweep_cancelled", payload);
  publishEvent(
    getSweepSessionChannel(sessionId),
    "fleet.sweep_cancelled",
    payload,
  );
}
