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
  // Agent health
  | "health.score"
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
  // Conflict Resolution
  | "resolution.suggested"
  // DCG
  | "dcg.block"
  | "dcg.warn"
  | "dcg.false_positive"
  | "dcg.allowlist_added"
  | "dcg.config_updated"
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
  // Notifications
  | "notification.created"
  // Handoffs
  | "handoff.initiated"
  | "handoff.phase_changed"
  | "handoff.accepted"
  | "handoff.rejected"
  | "handoff.escalated"
  | "handoff.cancelled"
  | "handoff.completed"
  | "handoff.failed"
  | "handoff.transfer_started"
  | "handoff.transfer_completed"
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
  // Pipeline Engine
  | "pipeline.run_started"
  | "pipeline.run_progress"
  | "pipeline.run_completed"
  | "pipeline.run_failed"
  | "pipeline.run_paused"
  | "pipeline.run_resumed"
  | "pipeline.run_cancelled"
  | "pipeline.step_started"
  | "pipeline.step_completed"
  | "pipeline.step_failed"
  | "pipeline.step_skipped"
  | "pipeline.approval_pending"
  | "pipeline.approval_received"
  // Jobs
  | "job.created"
  | "job.started"
  | "job.progress"
  | "job.completed"
  | "job.failed"
  | "job.cancelled"
  | "job.paused"
  | "job.resumed"
  | "job.retrying"
  // Git coordination
  | "git.branch.assigned"
  | "git.branch.released"
  | "git.branch.renewed"
  | "git.branch.status_changed"
  | "git.branch.expired"
  | "git.branch.expiring"
  | "git.sync.coordinated"
  | "git.sync.completed"
  | "git.sync.queued"
  | "git.sync.started"
  | "git.sync.retrying"
  | "git.sync.failed"
  | "git.sync.cancelled"
  // Circuit breakers
  | "circuit.state_changed"
  // System
  | "maintenance.state_changed"
  | "health.ping"
  | "error"
  // Processes (pt integration)
  | "processes.scan_result"
  | "processes.terminate_result"
  | "processes.bulk_terminate_result"
  | "processes.agent_scan_result"
  | "processes.agent_cleanup_result"
  // Context Health
  | "context.warning"
  | "context.compacted"
  | "context.emergency_rotated"
  // Supervisor/Daemon
  | "daemon.started"
  | "daemon.stopped"
  | "daemon.failed"
  | "daemon.health_changed"
  | "daemon.restarting"
  // Graph
  | "graph.node_added"
  | "graph.node_removed"
  | "graph.node_updated"
  | "graph.edge_added"
  | "graph.edge_removed"
  | "graph.edge_updated"
  | "graph.full_refresh"
  | "graph.stats";

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
  /** Server version identifier */
  serverVersion?: string;
  /** Server capabilities */
  capabilities?: {
    /** Whether backfill is supported */
    backfill: boolean;
    /** Whether compression is supported */
    compression: boolean;
    /** Whether acknowledgment is supported */
    acknowledgment: boolean;
  };
  /** Heartbeat interval in milliseconds */
  heartbeatIntervalMs?: number;
  /** Link to WebSocket documentation */
  docs?: string;
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
  /** Example of valid input/usage that would succeed */
  example?: unknown;
  /** Link to documentation for this error/feature */
  docs?: string;
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
 * Throttle/backpressure indication.
 * Sent when the client is sending messages too fast.
 */
export interface ThrottledMessage {
  type: "throttled";
  /** Human-readable message */
  message: string;
  /** Time in milliseconds before the client should resume sending */
  resumeAfterMs: number;
  /** Current message count in the throttle window */
  currentCount?: number;
  /** Maximum messages allowed per window */
  limit?: number;
  /** When the throttle window resets (ISO timestamp) */
  resetsAt?: string;
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
  | AckResponseMessage
  | ThrottledMessage;

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

/** Maximum allowed size for client WebSocket messages (1MB) */
const MAX_CLIENT_MESSAGE_SIZE = 1_000_000;

/**
 * Parse a client message from JSON.
 * Returns undefined if parsing fails or message is invalid.
 */
export function parseClientMessage(json: string): ClientMessage | undefined {
  try {
    // Reject oversized messages before parsing to prevent DoS
    if (json.length > MAX_CLIENT_MESSAGE_SIZE) {
      return undefined;
    }
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
    // Note: createWSError is safe to use here as it's defined in the same module
    return JSON.stringify(
      createWSError("SERIALIZATION_ERROR", "Failed to serialize message"),
    );
  }
}

// ============================================================================
// WebSocket Error Hints
// ============================================================================

/** WebSocket documentation base URL */
const WS_DOCS_BASE = "https://docs.flywheel.dev/websocket";

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
    example?: unknown;
    docs?: string;
  }
> = {
  INVALID_FORMAT: {
    severity: "recoverable",
    hint: "Messages must be valid JSON with a 'type' field. Check message format.",
    alternative:
      "Use the SDK client which handles message formatting automatically.",
    example: { type: "subscribe", channel: "agent:output:YOUR_AGENT_ID" },
    docs: `${WS_DOCS_BASE}#message-format`,
  },
  WS_CONNECTION_FAILED: {
    severity: "retry",
    hint: "WebSocket connection failed. Check network connectivity and server availability.",
    alternative: "Retry connection with exponential backoff.",
    docs: `${WS_DOCS_BASE}#connection`,
  },
  WS_SUBSCRIPTION_DENIED: {
    severity: "terminal",
    hint: "Subscription was denied. Verify your auth token and channel permissions.",
    alternative: "Request elevated permissions or use a different channel.",
    docs: `${WS_DOCS_BASE}#authentication`,
  },
  WS_CURSOR_EXPIRED: {
    severity: "recoverable",
    hint: "The cursor has expired. Reconnect without a cursor to get latest messages.",
    alternative: "Subscribe to the channel again without specifying a cursor.",
    example: { type: "subscribe", channel: "agent:output:agent-123" },
    docs: `${WS_DOCS_BASE}#cursors`,
  },
  WS_RATE_LIMITED: {
    severity: "retry",
    hint: "You're sending messages too fast. Implement exponential backoff.",
    alternative: "Batch multiple operations into fewer messages.",
    docs: `${WS_DOCS_BASE}#rate-limits`,
  },
  WS_AUTHENTICATION_REQUIRED: {
    severity: "recoverable",
    hint: "This connection requires authentication. Provide valid credentials.",
    alternative: "Reconnect with an auth token in the connection parameters.",
    docs: `${WS_DOCS_BASE}#authentication`,
  },
  INVALID_CHANNEL: {
    severity: "recoverable",
    hint: "Channel format is 'scope:type:id', e.g., 'agent:output:agent-123'.",
    alternative:
      "Use parseChannel() to validate channel format before subscribing.",
    example: "agent:output:agent-abc123",
    docs: `${WS_DOCS_BASE}#channels`,
  },
  SERIALIZATION_ERROR: {
    severity: "retry",
    hint: "Failed to serialize message. This is usually a transient error.",
  },
  INTERNAL_ERROR: {
    severity: "retry",
    hint: "An internal error occurred. Retry the request.",
    alternative:
      "If the error persists, check the server logs or contact support.",
  },
};

/**
 * Create a WebSocket error message with AI hints.
 * Automatically includes severity, hint, alternative, example, and docs based on error code.
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
 * // Result includes hint, example, and docs link
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
  if (hints?.example !== undefined) {
    errorMsg.example = hints.example;
  }
  if (hints?.docs) {
    errorMsg.docs = hints.docs;
  }

  return errorMsg;
}

/**
 * Create a throttle message for backpressure.
 * Sent when the client is sending messages too fast.
 *
 * @param resumeAfterMs - Time in milliseconds before the client should resume
 * @param options - Additional throttle information
 * @returns Throttle message
 *
 * @example
 * ```typescript
 * const throttleMsg = createThrottleMessage(1000, {
 *   currentCount: 105,
 *   limit: 100,
 * });
 * ws.send(serializeServerMessage(throttleMsg));
 * ```
 */
export function createThrottleMessage(
  resumeAfterMs: number,
  options?: {
    currentCount?: number;
    limit?: number;
    resetsAt?: Date;
  },
): ThrottledMessage {
  const msg: ThrottledMessage = {
    type: "throttled",
    message: "Slow down message rate",
    resumeAfterMs,
  };

  if (options?.currentCount !== undefined) {
    msg.currentCount = options.currentCount;
  }
  if (options?.limit !== undefined) {
    msg.limit = options.limit;
  }
  if (options?.resetsAt !== undefined) {
    msg.resetsAt = options.resetsAt.toISOString();
  }

  return msg;
}
