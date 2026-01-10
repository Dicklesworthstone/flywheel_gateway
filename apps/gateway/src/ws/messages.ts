/**
 * WebSocket Message Types.
 *
 * Defines the format of messages sent over WebSocket connections.
 * All messages include metadata for tracing and debugging.
 */

/**
 * Message types that can be published to channels.
 */
export type MessageType =
  // Agent output
  | "output.chunk"
  // State changes
  | "state.change"
  // Tool execution
  | "tool.start"
  | "tool.end"
  // File reservations
  | "reservation.acquired"
  | "reservation.released"
  // Conflicts
  | "conflict.detected"
  | "conflict.resolved"
  // Agent mail
  | "mail.received"
  // System
  | "health.ping"
  | "error";

/**
 * Metadata attached to hub messages.
 */
export interface MessageMetadata {
  /** Correlation ID for request tracing */
  correlationId?: string;
  /** Agent ID if message is agent-related */
  agentId?: string;
  /** User ID if message is user-related */
  userId?: string;
  /** Workspace ID if message is workspace-related */
  workspaceId?: string;
}

/**
 * A message stored in and published from the hub.
 */
export interface HubMessage {
  /** Unique message ID (UUID) for deduplication */
  id: string;
  /** Ring buffer cursor for this message */
  cursor: string;
  /** When the message was created */
  timestamp: string;
  /** Channel this message was published to (serialized) */
  channel: string;
  /** Message type */
  type: MessageType;
  /** Type-specific payload */
  payload: unknown;
  /** Optional tracing metadata */
  metadata?: MessageMetadata;
}

// ============================================================================
// Client -> Server Messages
// ============================================================================

/**
 * Subscribe to a channel.
 */
export interface SubscribeMessage {
  type: "subscribe";
  /** Channel to subscribe to (serialized string) */
  channel: string;
  /** Optional cursor to resume from */
  cursor?: string;
}

/**
 * Unsubscribe from a channel.
 */
export interface UnsubscribeMessage {
  type: "unsubscribe";
  /** Channel to unsubscribe from */
  channel: string;
}

/**
 * Request backfill of messages from a cursor.
 */
export interface BackfillMessage {
  type: "backfill";
  /** Channel to backfill */
  channel: string;
  /** Cursor to start from (exclusive) */
  fromCursor: string;
  /** Maximum messages to return */
  limit?: number;
}

/**
 * Client ping for connection health.
 */
export interface PingMessage {
  type: "ping";
  /** Client timestamp for latency measurement */
  timestamp: number;
}

/**
 * Reconnect with previous cursors.
 */
export interface ReconnectMessage {
  type: "reconnect";
  /** Map of channel -> last known cursor */
  cursors: Record<string, string>;
}

/**
 * All client -> server message types.
 */
export type ClientMessage =
  | SubscribeMessage
  | UnsubscribeMessage
  | BackfillMessage
  | PingMessage
  | ReconnectMessage;

// ============================================================================
// Server -> Client Messages
// ============================================================================

/**
 * Connection established acknowledgement.
 */
export interface ConnectedMessage {
  type: "connected";
  /** Assigned connection ID */
  connectionId: string;
  /** Server timestamp */
  serverTime: string;
}

/**
 * Subscription acknowledgement.
 */
export interface SubscribedMessage {
  type: "subscribed";
  /** Channel that was subscribed to */
  channel: string;
  /** Current cursor for the channel (for future reconnection) */
  cursor?: string;
}

/**
 * Unsubscription acknowledgement.
 */
export interface UnsubscribedMessage {
  type: "unsubscribed";
  /** Channel that was unsubscribed from */
  channel: string;
}

/**
 * Published message from a channel.
 */
export interface ChannelMessage {
  type: "message";
  /** The hub message */
  message: HubMessage;
}

/**
 * Backfill response with historical messages.
 */
export interface BackfillResponse {
  type: "backfill_response";
  /** Channel that was backfilled */
  channel: string;
  /** Messages from the backfill */
  messages: HubMessage[];
  /** Cursor of the last message (for pagination) */
  lastCursor?: string;
  /** Whether there are more messages */
  hasMore: boolean;
}

/**
 * Pong response to client ping.
 */
export interface PongMessage {
  type: "pong";
  /** Echo of client timestamp */
  timestamp: number;
  /** Server timestamp */
  serverTime: number;
  /** Current subscriptions for this connection */
  subscriptions: string[];
  /** Current cursors per channel */
  cursors: Record<string, string>;
}

/**
 * Server heartbeat (sent periodically to all connections).
 */
export interface HeartbeatMessage {
  type: "heartbeat";
  /** Server timestamp */
  serverTime: number;
}

/**
 * Reconnection acknowledgement.
 */
export interface ReconnectAckMessage {
  type: "reconnect_ack";
  /** Number of messages replayed per channel */
  replayed: Record<string, number>;
  /** Channels where cursor was expired (lost messages) */
  expired: string[];
  /** New cursors after replay */
  newCursors: Record<string, string>;
}

/**
 * Error message.
 */
export interface ErrorMessage {
  type: "error";
  /** Error code (from error taxonomy) */
  code: string;
  /** Human-readable message */
  message: string;
  /** Channel if error is channel-specific */
  channel?: string;
  /** Additional error details */
  details?: Record<string, unknown>;
}

/**
 * All server -> client message types.
 */
export type ServerMessage =
  | ConnectedMessage
  | SubscribedMessage
  | UnsubscribedMessage
  | ChannelMessage
  | BackfillResponse
  | PongMessage
  | HeartbeatMessage
  | ReconnectAckMessage
  | ErrorMessage;

// ============================================================================
// Message Helpers
// ============================================================================

/**
 * Create a hub message with auto-generated fields.
 */
export function createHubMessage(
  type: MessageType,
  channel: string,
  payload: unknown,
  metadata?: MessageMetadata,
): Omit<HubMessage, "cursor"> {
  return {
    id: crypto.randomUUID(),
    cursor: "", // Will be set by ring buffer
    timestamp: new Date().toISOString(),
    channel,
    type,
    payload,
    metadata,
  };
}

/**
 * Parse a client message from JSON.
 * Returns undefined if parsing fails or message is invalid.
 */
export function parseClientMessage(json: string): ClientMessage | undefined {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return undefined;
    if (!("type" in parsed) || typeof parsed.type !== "string")
      return undefined;

    switch (parsed.type) {
      case "subscribe":
        if (typeof parsed.channel !== "string") return undefined;
        return {
          type: "subscribe",
          channel: parsed.channel,
          cursor: typeof parsed.cursor === "string" ? parsed.cursor : undefined,
        };

      case "unsubscribe":
        if (typeof parsed.channel !== "string") return undefined;
        return { type: "unsubscribe", channel: parsed.channel };

      case "backfill":
        if (typeof parsed.channel !== "string") return undefined;
        if (typeof parsed.fromCursor !== "string") return undefined;
        return {
          type: "backfill",
          channel: parsed.channel,
          fromCursor: parsed.fromCursor,
          limit: typeof parsed.limit === "number" ? parsed.limit : undefined,
        };

      case "ping":
        if (typeof parsed.timestamp !== "number") return undefined;
        return { type: "ping", timestamp: parsed.timestamp };

      case "reconnect": {
        if (!parsed.cursors || typeof parsed.cursors !== "object")
          return undefined;
        const entries = Object.entries(
          parsed.cursors as Record<string, unknown>,
        )
          .filter(([, value]) => typeof value === "string")
          .map(([key, value]) => [key, value] as [string, string]);
        return { type: "reconnect", cursors: Object.fromEntries(entries) };
      }

      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

/**
 * Serialize a server message to JSON.
 */
export function serializeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}
