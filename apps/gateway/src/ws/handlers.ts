import type { ServerWebSocket } from "bun";
import { logger } from "../services/logger";
import { canSubscribe } from "./authorization";
import { parseChannel, type Channel } from "./channels";
import { getHub, type AuthContext, type ConnectionData } from "./hub";
import {
  parseClientMessage,
  serializeServerMessage,
  type ServerMessage,
} from "./messages";

/**
 * Handle WebSocket connection open event.
 * Adds the connection to the hub and registers initial subscriptions.
 */
export function handleWSOpen(ws: ServerWebSocket<ConnectionData>): void {
  const hub = getHub();
  const connectionId = ws.data.connectionId;

  hub.addConnection(ws, ws.data.auth);

  // Register pre-existing subscriptions (e.g. from upgrade)
  // These are considered "system-assigned" so we skip auth checks here
  if (ws.data.subscriptions.size > 0) {
    // Clone entries to avoid iterator invalidation issues as hub.subscribe modifies the map
    const initialSubs = Array.from(ws.data.subscriptions.entries());

    for (const [channelStr, cursor] of initialSubs) {
      const channel = parseChannel(channelStr);
      if (channel) {
        const result = hub.subscribe(connectionId, channel, cursor);

        // Send missed messages immediately
        if (result.missedMessages && result.missedMessages.length > 0) {
          for (const msg of result.missedMessages) {
            const serverMsg: ServerMessage = { type: "message", message: msg };
            ws.send(serializeServerMessage(serverMsg));
          }
        }
      }
    }
  }

  // Send welcome message
  const connectedMsg: ServerMessage = {
    type: "connected",
    connectionId: connectionId,
    serverTime: new Date().toISOString(),
  };
  ws.send(serializeServerMessage(connectedMsg));
}

/**
 * Handle WebSocket message event.
 * Parses the message and delegates to the hub.
 */
export function handleWSMessage(
  ws: ServerWebSocket<ConnectionData>,
  message: string | Buffer,
): void {
  const hub = getHub();
  const connectionId = ws.data.connectionId;

  try {
    const text = typeof message === "string" ? message : message.toString();
    const clientMsg = parseClientMessage(text);

    if (!clientMsg) {
      logger.warn({ connectionId, text }, "Invalid WebSocket message format");
      const errorMsg: ServerMessage = {
        type: "error",
        code: "INVALID_FORMAT",
        message: "Invalid message format",
      };
      ws.send(serializeServerMessage(errorMsg));
      return;
    }

    switch (clientMsg.type) {
      case "subscribe": {
        const channelStr = clientMsg.channel;
        const channel = parseChannel(channelStr);
        if (channel) {
          // Check authorization
          const authResult = canSubscribe(ws.data.auth, channel);
          if (!authResult.allowed) {
            const errorMsg: ServerMessage = {
              type: "error",
              code: "FORBIDDEN",
              message: `Subscription denied: ${authResult.reason}`,
              channel: channelStr,
            };
            ws.send(serializeServerMessage(errorMsg));
            break;
          }

          const cursor = clientMsg.cursor;

          // Subscribe and get missed messages
          const result = hub.subscribe(connectionId, channel, cursor);

          // Replay missed messages FIRST (so client state is consistent)
          if (result.missedMessages && result.missedMessages.length > 0) {
            for (const msg of result.missedMessages) {
              const serverMsg: ServerMessage = {
                type: "message",
                message: msg,
              };
              ws.send(serializeServerMessage(serverMsg));
            }
          }

          // THEN send acknowledgement with the latest cursor
          const subMsg: ServerMessage = {
            type: "subscribed",
            channel: channelStr,
            cursor: result.cursor,
          };
          ws.send(serializeServerMessage(subMsg));
        }
        break;
      }

      case "unsubscribe": {
        const channelStr = clientMsg.channel;
        const channel = parseChannel(channelStr);
        if (channel) {
          hub.unsubscribe(connectionId, channel);
          const unsubMsg: ServerMessage = {
            type: "unsubscribed",
            channel: channelStr,
          };
          ws.send(serializeServerMessage(unsubMsg));
        }
        break;
      }

      case "ping": {
        // Pong is handled via specialized message type in messages.ts?
        // messages.ts has PongMessage.
        const pongMsg: ServerMessage = {
          type: "pong",
          timestamp: clientMsg.timestamp,
          serverTime: Date.now(),
          subscriptions: Array.from(ws.data.subscriptions.keys()),
          cursors: Object.fromEntries(
            Array.from(ws.data.subscriptions.entries()).filter(
              ([_, v]) => v !== undefined,
            ) as [string, string][],
          ),
        };
        ws.send(serializeServerMessage(pongMsg));
        hub.updateHeartbeat(connectionId);
        break;
      }

      case "reconnect": {
        // Handle reconnection logic
        const result = hub.handleReconnect(connectionId, clientMsg.cursors);
        ws.send(serializeServerMessage(result));
        break;
      }

      default:
        logger.warn(
          { connectionId, type: clientMsg.type },
          "Unknown message type",
        );
    }
  } catch (err) {
    logger.error({ err, connectionId }, "Error handling WebSocket message");
    const errorMsg: ServerMessage = {
      type: "error",
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    };
    ws.send(serializeServerMessage(errorMsg));
  }
}

/**
 * Handle WebSocket close event.
 * Removes the connection from the hub.
 */
export function handleWSClose(ws: ServerWebSocket<ConnectionData>): void {
  const hub = getHub();
  hub.removeConnection(ws.data.connectionId);
}

/**
 * Handle WebSocket error event.
 */
export function handleWSError(
  ws: ServerWebSocket<ConnectionData>,
  error: Error,
): void {
  logger.error(
    { connectionId: ws.data.connectionId, error },
    "WebSocket error",
  );
  // Connection removal is handled by close event usually,
  // but we can ensure cleanup here if needed.
  // Bun emits close after error typically.
}
