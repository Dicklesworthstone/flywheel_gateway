/**
 * Heartbeat Manager for WebSocket connections.
 *
 * Maintains connection health by:
 * - Sending periodic heartbeats to all connections
 * - Detecting dead connections (no response within timeout)
 * - Cleaning up stale connections
 */

import { logger } from "../services/logger";
import { getHub, type WebSocketHub } from "./hub";
import type { HeartbeatMessage, PongMessage } from "./messages";

/** Default heartbeat interval in milliseconds */
export const HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds

/** Default connection timeout in milliseconds */
export const CONNECTION_TIMEOUT_MS = 90000; // 90 seconds

/**
 * Heartbeat manager for a WebSocket hub.
 */
export class HeartbeatManager {
  private hub: WebSocketHub;
  private heartbeatInterval: ReturnType<typeof setInterval> | undefined;
  private cleanupInterval: ReturnType<typeof setInterval> | undefined;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;

  constructor(
    hub?: WebSocketHub,
    options?: {
      intervalMs?: number;
      timeoutMs?: number;
    },
  ) {
    this.hub = hub ?? getHub();
    this.intervalMs = options?.intervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.timeoutMs = options?.timeoutMs ?? CONNECTION_TIMEOUT_MS;
  }

  /**
   * Start the heartbeat manager.
   * Begins sending periodic heartbeats and cleaning up dead connections.
   */
  start(): void {
    if (this.heartbeatInterval) return; // Already started

    // Send heartbeats at regular intervals
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, this.intervalMs);

    // Clean up dead connections at half the timeout interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupDeadConnections();
    }, this.timeoutMs / 2);

    logger.info(
      { intervalMs: this.intervalMs, timeoutMs: this.timeoutMs },
      "Heartbeat manager started",
    );
  }

  /**
   * Stop the heartbeat manager.
   */
  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    logger.info("Heartbeat manager stopped");
  }

  /**
   * Send a heartbeat to all connections.
   */
  private sendHeartbeat(): void {
    const message: HeartbeatMessage = {
      type: "heartbeat",
      serverTime: Date.now(),
    };

    const sent = this.hub.broadcast(message);
    logger.debug({ sentCount: sent }, "Heartbeat sent to all connections");
  }

  /**
   * Clean up connections that haven't responded within the timeout.
   */
  private cleanupDeadConnections(): void {
    const dead = this.hub.getDeadConnections(this.timeoutMs);

    for (const connectionId of dead) {
      logger.warn(
        { connectionId },
        "Closing dead connection (heartbeat timeout)",
      );
      // Use closeConnection to properly close the WebSocket before removing
      this.hub.closeConnection(connectionId, 1001, "Heartbeat timeout");
    }

    if (dead.length > 0) {
      logger.info({ count: dead.length }, "Cleaned up dead connections");
    }
  }

  /**
   * Handle a ping message from a client.
   * Updates heartbeat and returns a pong response.
   *
   * @param connectionId - The connection ID
   * @param timestamp - Client timestamp from ping
   * @returns Pong message to send back
   */
  handlePing(connectionId: string, timestamp: number): PongMessage | undefined {
    // Update heartbeat timestamp
    this.hub.updateHeartbeat(connectionId);

    // Get connection info for response
    const conn = this.hub.getConnection(connectionId);
    if (!conn) return undefined;

    return {
      type: "pong",
      timestamp,
      serverTime: Date.now(),
      subscriptions: conn.subscriptions,
      cursors: conn.cursors,
    };
  }
}

// Singleton heartbeat manager
let managerInstance: HeartbeatManager | undefined;

/**
 * Get the singleton heartbeat manager.
 */
export function getHeartbeatManager(): HeartbeatManager {
  if (!managerInstance) {
    managerInstance = new HeartbeatManager();
  }
  return managerInstance;
}

/**
 * Start the heartbeat manager (idempotent).
 */
export function startHeartbeat(): void {
  getHeartbeatManager().start();
}

/**
 * Stop the heartbeat manager.
 */
export function stopHeartbeat(): void {
  if (managerInstance) {
    managerInstance.stop();
  }
}
