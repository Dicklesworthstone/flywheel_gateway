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
  | "reservation.renewed"
  | "reservation.expired"
  | "reservation.expiring"
  // Conflicts
  | "conflict.detected"
  | "conflict.updated"
  | "conflict.resolved"
  | "conflict.escalated"
  // DCG
  | "dcg.block"
  | "dcg.warn"
  | "dcg.false_positive"
  | "dcg.allowlist_added"
  | "dcg.pending_created"
  | "dcg.pending_approved"
  | "dcg.pending_denied"
  | "dcg.pending_expired"
  | "dcg.pending_executed"
  // Checkpoints
  | "checkpoint.created"
  | "checkpoint.auto_created"
  | "checkpoint.restored"
  | "checkpoint.deleted"
  | "checkpoint.pruned"
  | "checkpoint.compacted"
  | "checkpoint.imported"
  // Agent mail
  | "mail.received"
  // Fleet (RU)
  | "fleet.repo_added"
  | "fleet.repo_removed"
  | "fleet.repo_updated"
  | "fleet.sync_started"
  | "fleet.sync_progress"
  | "fleet.sync_completed"
  | "fleet.sync_cancelled"
  | "fleet.sweep_created"
  | "fleet.sweep_started"
  | "fleet.sweep_progress"
  | "fleet.sweep_completed"
  | "fleet.sweep_failed"
  | "fleet.sweep_cancelled"
  | "fleet.plan_created"
  | "fleet.plan_approved"
  | "fleet.plan_rejected"
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
 * Acknowledge receipt of a message.
 * Required for channels with ackRequired flag.
 */
export interface AckMessage {
  type: "ack";
  /** Message ID(s) to acknowledge */
  messageIds: string[];
}

/**
 * All client -> server message types.
 */
export type ClientMessage =
  | SubscribeMessage
  | UnsubscribeMessage
  | BackfillMessage
  | PingMessage
  | ReconnectMessage
  | AckMessage;

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
  /** Whether this message requires acknowledgment */
  ackRequired?: boolean;
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
 * Includes AI hints to help agents understand and recover from errors.
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
  /**
   * Error severity for AI agents.
   * - terminal: Cannot be retried, requires different approach
   * - recoverable: Can be fixed by the agent (e.g., fix request params)
   * - retry: Transient error, retry with same request may succeed
   */
  severity?: "terminal" | "recoverable" | "retry";
  /** Suggested action to resolve the error */
  hint?: string;
  /** Alternative approach if the current request cannot succeed */
  alternative?: string;
}

/**
 * Acknowledgment response.
 */
export interface AckResponseMessage {
  type: "ack_response";
  /** Message IDs that were acknowledged */
  acknowledged: string[];
  /** Message IDs that were not found (already expired or invalid) */
  notFound: string[];
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
  | ErrorMessage
  | AckResponseMessage;

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
    // cursor: "", // Will be set by ring buffer
    timestamp: new Date().toISOString(),
    channel,
    type,
    payload,
    ...(metadata !== undefined && { metadata }),
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

      case "ack": {
        if (!Array.isArray(parsed.messageIds)) return undefined;
        const messageIds = parsed.messageIds.filter(
          (id: unknown) => typeof id === "string",
        ) as string[];
        if (messageIds.length === 0) return undefined;
        return { type: "ack", messageIds };
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
 * Handles circular references gracefully by returning an error message.
 */
export function serializeServerMessage(message: ServerMessage): string {
  try {
    return JSON.stringify(message);
  } catch {
    // Handle circular references or other serialization errors
    const errorMessage: ErrorMessage = {
      type: "error",
      code: "SERIALIZATION_ERROR",
      message: "Failed to serialize message",
      severity: "retry",
      hint: "This is a transient serialization error. Retry the request.",
    };
    return JSON.stringify(errorMessage);
  }
}

// ============================================================================
// WebSocket Error Hints
// ============================================================================

/**
 * AI hints for WebSocket-specific error codes.
 * Used by createWSError to include helpful guidance in error messages.
 */
const WS_ERROR_HINTS: Record<
  string,
  {
    severity: "terminal" | "recoverable" | "retry";
    hint: string;
    alternative?: string;
  }
> = {
  INVALID_FORMAT: {
    severity: "recoverable",
    hint: "Messages must be valid JSON with a 'type' field. Check message format.",
    alternative: "Use the SDK client which handles message formatting automatically.",
  },
  FORBIDDEN: {
    severity: "terminal",
    hint: "You don't have permission to access this channel. Check authentication.",
    alternative: "Verify your auth token has the required scopes for this channel.",
  },
  WS_SUBSCRIPTION_DENIED: {
    severity: "terminal",
    hint: "Subscription was denied. Verify your auth token and channel permissions.",
    alternative: "Request elevated permissions or use a different channel.",
  },
  WS_CURSOR_EXPIRED: {
    severity: "recoverable",
    hint: "The cursor has expired. Reconnect without a cursor to get latest messages.",
    alternative: "Subscribe to the channel again without specifying a cursor.",
  },
  WS_RATE_LIMITED: {
    severity: "retry",
    hint: "You're sending messages too fast. Implement exponential backoff.",
    alternative: "Batch multiple operations into fewer messages.",
  },
  WS_AUTHENTICATION_REQUIRED: {
    severity: "recoverable",
    hint: "This connection requires authentication. Provide valid credentials.",
    alternative: "Reconnect with an auth token in the connection parameters.",
  },
  INVALID_CHANNEL: {
    severity: "recoverable",
    hint: "Channel format is 'scope:type:id', e.g., 'agent:output:agent-123'.",
    alternative: "Use parseChannel() to validate channel format before subscribing.",
  },
  SERIALIZATION_ERROR: {
    severity: "retry",
    hint: "Failed to serialize message. This is usually a transient error.",
  },
  INTERNAL_ERROR: {
    severity: "retry",
    hint: "An internal error occurred. Retry the request.",
    alternative: "If the error persists, check the server logs or contact support.",
  },
};

/**
 * Create a WebSocket error message with AI hints.
 * Automatically includes severity, hint, and alternative based on error code.
 *
 * @param code - Error code from taxonomy
 * @param message - Human-readable error message
 * @param channel - Optional channel the error relates to
 * @param details - Optional additional error details
 * @returns Error message with AI hints
 *
 * @example
 * ```typescript
 * const errorMsg = createWSError("INVALID_FORMAT", "Invalid message format");
 * ws.send(serializeServerMessage(errorMsg));
 * ```
 */
export function createWSError(
  code: string,
  message: string,
  channel?: string,
  details?: Record<string, unknown>,
): ErrorMessage {
  const hints = WS_ERROR_HINTS[code];

  const errorMsg: ErrorMessage = {
    type: "error",
    code,
    message,
  };

  // Add optional fields only if they have values
  if (channel) {
    errorMsg.channel = channel;
  }
  if (details) {
    errorMsg.details = details;
  }
  if (hints?.severity) {
    errorMsg.severity = hints.severity;
  }
  if (hints?.hint) {
    errorMsg.hint = hints.hint;
  }
  if (hints?.alternative) {
    errorMsg.alternative = hints.alternative;
  }

  return errorMsg;
}
