/**
 * Agent Mail Events Service.
 *
 * Publishes WebSocket events for mail and reservation changes.
 * This enables real-time updates in the UI when agents send messages
 * or acquire/release file reservations.
 */

import type { WebSocketHub } from "../ws/hub";
import type { MessageMetadata } from "../ws/messages";

/**
 * Message received event payload.
 */
export interface MailReceivedPayload {
  messageId: string;
  projectId: string;
  from: { agentId: string };
  to: { agentId: string };
  subject: string;
  priority: "low" | "normal" | "high" | "urgent";
  threadId?: string;
  receivedAt: string;
}

/**
 * Reservation acquired event payload.
 */
export interface ReservationAcquiredPayload {
  reservationId: string;
  projectId: string;
  requesterId: string;
  patterns: string[];
  exclusive: boolean;
  expiresAt: string;
  acquiredAt: string;
}

/**
 * Reservation released event payload.
 */
export interface ReservationReleasedPayload {
  reservationId: string;
  projectId: string;
  requesterId: string;
  patterns: string[];
  releasedAt: string;
}

/**
 * Conflict detected event payload.
 */
export interface ConflictDetectedPayload {
  conflictId: string;
  projectId: string;
  pattern: string;
  existingReservation: {
    reservationId: string;
    requesterId: string;
    expiresAt: string;
  };
  requestingAgent: string;
  detectedAt: string;
}

/**
 * Conflict resolved event payload.
 */
export interface ConflictResolvedPayload {
  conflictId: string;
  projectId: string;
  resolution: "expired" | "released" | "overridden";
  resolvedAt: string;
}

/**
 * Mail events service for publishing Agent Mail WebSocket events.
 */
export class MailEventsService {
  constructor(private hub: WebSocketHub) {}

  /**
   * Publish a mail received event.
   *
   * Sends to:
   * - user:mail:{userId} - for the recipient's user ID
   */
  publishMailReceived(
    userId: string,
    payload: MailReceivedPayload,
    metadata?: MessageMetadata,
  ): void {
    this.hub.publish({ type: "user:mail", userId }, "mail.received", payload, {
      ...metadata,
      userId,
    });
  }

  /**
   * Publish a reservation acquired event.
   *
   * Sends to:
   * - workspace:reservations:{workspaceId}
   */
  publishReservationAcquired(
    workspaceId: string,
    payload: ReservationAcquiredPayload,
    metadata?: MessageMetadata,
  ): void {
    this.hub.publish(
      { type: "workspace:reservations", workspaceId },
      "reservation.acquired",
      payload,
      {
        ...metadata,
        workspaceId,
      },
    );
  }

  /**
   * Publish a reservation released event.
   *
   * Sends to:
   * - workspace:reservations:{workspaceId}
   */
  publishReservationReleased(
    workspaceId: string,
    payload: ReservationReleasedPayload,
    metadata?: MessageMetadata,
  ): void {
    this.hub.publish(
      { type: "workspace:reservations", workspaceId },
      "reservation.released",
      payload,
      {
        ...metadata,
        workspaceId,
      },
    );
  }

  /**
   * Publish a conflict detected event.
   *
   * Sends to:
   * - workspace:conflicts:{workspaceId}
   */
  publishConflictDetected(
    workspaceId: string,
    payload: ConflictDetectedPayload,
    metadata?: MessageMetadata,
  ): void {
    this.hub.publish(
      { type: "workspace:conflicts", workspaceId },
      "conflict.detected",
      payload,
      {
        ...metadata,
        workspaceId,
      },
    );
  }

  /**
   * Publish a conflict resolved event.
   *
   * Sends to:
   * - workspace:conflicts:{workspaceId}
   */
  publishConflictResolved(
    workspaceId: string,
    payload: ConflictResolvedPayload,
    metadata?: MessageMetadata,
  ): void {
    this.hub.publish(
      { type: "workspace:conflicts", workspaceId },
      "conflict.resolved",
      payload,
      {
        ...metadata,
        workspaceId,
      },
    );
  }
}

/**
 * Create a mail events service.
 */
export function createMailEventsService(hub: WebSocketHub): MailEventsService {
  return new MailEventsService(hub);
}
