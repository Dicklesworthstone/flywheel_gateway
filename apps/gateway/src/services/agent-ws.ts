/**
 * Agent WebSocket Service
 *
 * Manages WebSocket connections for real-time agent state updates.
 * Integrates with the agent state machine to broadcast state changes.
 */

import type { ServerWebSocket } from "bun";
import { onStateChange, type StateChangeEvent } from "./agent-state-machine";
import { logger } from "./logger";

/** WebSocket data attached to each connection */
interface WSData {
  /** Subscribed agent IDs (empty = all agents) */
  subscriptions: Set<string>;
  /** Connection ID for logging */
  connectionId: string;
}

/** Connected WebSocket clients */
const connections = new Set<ServerWebSocket<WSData>>();

/** Track if we've registered the state change listener */
let listenerRegistered = false;

/**
 * Register the global state change listener.
 * Called once when the first WebSocket connects.
 */
function ensureListenerRegistered(): void {
  if (listenerRegistered) return;

  onStateChange((event: StateChangeEvent) => {
    broadcastStateChange(event);
  });

  listenerRegistered = true;
  logger.debug("WebSocket state change listener registered");
}

/**
 * Broadcast a state change event to all subscribed clients.
 */
function broadcastStateChange(event: StateChangeEvent): void {
  const message = JSON.stringify({
    type: event.type,
    agentId: event.agentId,
    previousState: event.previousState,
    currentState: event.currentState,
    timestamp: event.timestamp,
    reason: event.reason,
    correlationId: event.correlationId,
    ...(event.error && { error: event.error }),
  });

  for (const ws of connections) {
    const data = ws.data;
    // Send if subscribed to this agent or subscribed to all
    if (
      data.subscriptions.size === 0 ||
      data.subscriptions.has(event.agentId)
    ) {
      try {
        ws.send(message);
      } catch (error) {
        logger.warn(
          { connectionId: data.connectionId, error },
          "Failed to send WebSocket message",
        );
      }
    }
  }
}

/**
 * Generate a unique connection ID.
 */
function generateConnectionId(): string {
  return `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Handle WebSocket open event.
 */
export function handleWSOpen(ws: ServerWebSocket<WSData>): void {
  ensureListenerRegistered();
  connections.add(ws);
  logger.info(
    { connectionId: ws.data.connectionId },
    "WebSocket client connected",
  );

  // Send welcome message
  ws.send(
    JSON.stringify({
      type: "connected",
      connectionId: ws.data.connectionId,
      timestamp: new Date().toISOString(),
    }),
  );
}

/**
 * Handle WebSocket message event.
 * Clients can send subscription commands.
 */
export function handleWSMessage(
  ws: ServerWebSocket<WSData>,
  message: string | Buffer,
): void {
  try {
    const data = typeof message === "string" ? message : message.toString();
    const parsed = JSON.parse(data) as {
      type: string;
      agentId?: string;
      agentIds?: string[];
    };

    switch (parsed.type) {
      case "subscribe": {
        // Subscribe to specific agent(s)
        const agentIds =
          parsed.agentIds ?? (parsed.agentId ? [parsed.agentId] : []);
        for (const id of agentIds) {
          ws.data.subscriptions.add(id);
        }
        ws.send(
          JSON.stringify({
            type: "subscribed",
            agentIds,
            timestamp: new Date().toISOString(),
          }),
        );
        logger.debug(
          { connectionId: ws.data.connectionId, agentIds },
          "WebSocket subscribed to agents",
        );
        break;
      }

      case "unsubscribe": {
        // Unsubscribe from specific agent(s)
        const agentIds =
          parsed.agentIds ?? (parsed.agentId ? [parsed.agentId] : []);
        for (const id of agentIds) {
          ws.data.subscriptions.delete(id);
        }
        ws.send(
          JSON.stringify({
            type: "unsubscribed",
            agentIds,
            timestamp: new Date().toISOString(),
          }),
        );
        logger.debug(
          { connectionId: ws.data.connectionId, agentIds },
          "WebSocket unsubscribed from agents",
        );
        break;
      }

      case "subscribe_all": {
        // Subscribe to all agents (clear specific subscriptions)
        ws.data.subscriptions.clear();
        ws.send(
          JSON.stringify({
            type: "subscribed_all",
            timestamp: new Date().toISOString(),
          }),
        );
        logger.debug(
          { connectionId: ws.data.connectionId },
          "WebSocket subscribed to all agents",
        );
        break;
      }

      case "ping": {
        ws.send(
          JSON.stringify({
            type: "pong",
            timestamp: new Date().toISOString(),
          }),
        );
        break;
      }

      default:
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Unknown message type: ${parsed.type}`,
            timestamp: new Date().toISOString(),
          }),
        );
    }
  } catch (error) {
    logger.warn(
      { connectionId: ws.data.connectionId, error },
      "Invalid WebSocket message",
    );
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Invalid JSON message",
        timestamp: new Date().toISOString(),
      }),
    );
  }
}

/**
 * Handle WebSocket close event.
 */
export function handleWSClose(ws: ServerWebSocket<WSData>): void {
  connections.delete(ws);
  logger.info(
    { connectionId: ws.data.connectionId },
    "WebSocket client disconnected",
  );
}

/**
 * Handle WebSocket error event.
 */
export function handleWSError(ws: ServerWebSocket<WSData>, error: Error): void {
  logger.error(
    { connectionId: ws.data.connectionId, error },
    "WebSocket error",
  );
  connections.delete(ws);
}

/**
 * Create initial WebSocket data for a new connection.
 */
export function createWSData(initialSubscriptions: string[] = []): WSData {
  return {
    subscriptions: new Set(initialSubscriptions),
    connectionId: generateConnectionId(),
  };
}

/**
 * Get the number of active WebSocket connections.
 */
export function getConnectionCount(): number {
  return connections.size;
}
