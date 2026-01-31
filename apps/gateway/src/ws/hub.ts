/**
 * WebSocket Hub - Central message broker for real-time communication.
 *
 * The hub manages:
 * - Connection lifecycle (add, remove, track)
 * - Channel subscriptions
 * - Message publishing and fan-out
 * - Ring buffer storage and replay
 * - Reconnection with cursor-based catch-up
 */

import type { ServerWebSocket } from "bun";
import { logger } from "../services/logger";
import {
  type Channel,
  channelRequiresAck,
  channelToString,
  getChannelTypePrefix,
  parseChannel,
} from "./channels";
import {
  type AckResponseMessage,
  type ChannelMessage,
  createHubMessage,
  type HubMessage,
  type MessageMetadata,
  type MessageType,
  type ReconnectAckMessage,
  type ServerMessage,
  serializeServerMessage,
} from "./messages";
import { getBufferConfig, RingBuffer } from "./ring-buffer";

/**
 * Maximum pending acknowledgments per connection.
 * Prevents memory exhaustion from clients that don't acknowledge messages.
 */
const MAX_PENDING_ACKS_PER_CONNECTION = 1000;

/**
 * Authentication context for a connection.
 */
export interface AuthContext {
  /** Authenticated user ID */
  userId?: string;
  /** API key ID if using API key auth */
  apiKeyId?: string;
  /** Workspace IDs the user has access to */
  workspaceIds: string[];
  /** Whether this is an admin connection */
  isAdmin: boolean;
}

/**
 * A message pending acknowledgment.
 */
export interface PendingAck {
  /** The message awaiting ack */
  message: HubMessage;
  /** When the message was sent */
  sentAt: Date;
  /** Number of times this message has been replayed */
  replayCount: number;
}

/**
 * Data attached to each WebSocket connection.
 */
export interface ConnectionData {
  /** Unique connection ID */
  connectionId: string;
  /** When the connection was established */
  connectedAt: Date;
  /** Authentication context */
  auth: AuthContext;
  /** Subscribed channels (channel string -> latest cursor) */
  subscriptions: Map<string, string | undefined>;
  /** Last heartbeat received */
  lastHeartbeat: Date;
  /** Messages pending acknowledgment (message ID -> pending ack) */
  pendingAcks: Map<string, PendingAck>;
}

/**
 * Handle for a managed connection.
 */
export interface ConnectionHandle {
  connectionId: string;
  connectedAt: Date;
  subscriptions: string[];
  lastHeartbeat: Date;
  cursors: Record<string, string>;
  /** Number of messages pending acknowledgment */
  pendingAckCount: number;
}

/**
 * Hub statistics.
 */
export interface HubStats {
  /** Number of active connections */
  activeConnections: number;
  /** Subscriptions per channel type */
  subscriptionsByChannel: Record<string, number>;
  /** Approximate messages per second (last minute) */
  messagesPerSecond: number;
  /** Buffer utilization per channel type (0-100) */
  bufferUtilization: Record<string, number>;
  /** Event loss telemetry */
  eventLoss: {
    /** Total buffer capacity evictions across all channels */
    totalCapacityEvictions: number;
    /** Total TTL expirations across all channels */
    totalTtlExpirations: number;
    /** Total WebSocket send failures */
    totalSendFailures: number;
    /** Timestamp of last drop event */
    lastDropAt: string | null;
    /** Per-channel drop counts (only channels with drops) */
    byChannel: Record<
      string,
      { capacityEvictions: number; ttlExpirations: number }
    >;
  };
}

/**
 * The WebSocket Hub implementation.
 */
export class WebSocketHub {
  /** Active connections by ID */
  private connections = new Map<string, ServerWebSocket<ConnectionData>>();
  /** Ring buffers per channel (channel string -> buffer) */
  private buffers = new Map<string, RingBuffer<HubMessage>>();
  /** Subscribers per channel (channel string -> set of connection IDs) */
  private subscribers = new Map<string, Set<string>>();
  /** Message count for stats */
  private messageCount = 0;
  private lastStatsReset = Date.now();
  /** WebSocket send failure counter */
  private sendFailureCount = 0;

  /**
   * Add a new connection to the hub.
   *
   * @param ws - The WebSocket connection
   * @param auth - Authentication context
   * @returns Connection handle with assigned ID
   */
  addConnection(
    ws: ServerWebSocket<ConnectionData>,
    auth: AuthContext,
  ): ConnectionHandle {
    const connectionId = ws.data.connectionId;
    this.connections.set(connectionId, ws);

    logger.info(
      { connectionId, userId: auth.userId },
      "WebSocket connection added to hub",
    );

    return {
      connectionId,
      connectedAt: ws.data.connectedAt,
      subscriptions: [],
      lastHeartbeat: ws.data.lastHeartbeat,
      cursors: {},
      pendingAckCount: 0,
    };
  }

  /**
   * Remove a connection from the hub.
   *
   * @param connectionId - The connection ID to remove
   */
  removeConnection(connectionId: string): void {
    const ws = this.connections.get(connectionId);
    if (!ws) return;

    // Clear pending acks to prevent memory leaks
    ws.data.pendingAcks.clear();

    // Unsubscribe from all channels
    for (const channelStr of ws.data.subscriptions.keys()) {
      const subs = this.subscribers.get(channelStr);
      if (subs) {
        subs.delete(connectionId);
        if (subs.size === 0) {
          this.subscribers.delete(channelStr);
        }
      }
    }

    this.connections.delete(connectionId);
    logger.info({ connectionId }, "WebSocket connection removed from hub");
  }

  /**
   * Close and remove a connection from the hub.
   * This properly closes the underlying WebSocket before removing it.
   *
   * @param connectionId - The connection ID to close
   * @param code - WebSocket close code (default: 1000 Normal Closure)
   * @param reason - Close reason message
   */
  closeConnection(connectionId: string, code = 1000, reason?: string): void {
    const ws = this.connections.get(connectionId);
    if (!ws) return;

    // Close the WebSocket connection
    try {
      ws.close(code, reason);
    } catch (err) {
      logger.warn(
        { connectionId, error: err },
        "Error closing WebSocket connection",
      );
    }

    // Remove from hub tracking
    this.removeConnection(connectionId);
  }

  /**
   * Subscribe a connection to a channel.
   *
   * @param connectionId - The connection ID
   * @param channel - The channel to subscribe to
   * @param cursor - Optional cursor to resume from
   * @returns Messages missed since cursor (if provided and valid)
   */
  subscribe(
    connectionId: string,
    channel: Channel,
    cursor?: string,
  ): { cursor?: string; missedMessages?: HubMessage[] } {
    const ws = this.connections.get(connectionId);
    if (!ws) {
      logger.warn({ connectionId }, "Subscribe failed: connection not found");
      return {};
    }

    const channelStr = channelToString(channel);

    // Add to subscriptions
    ws.data.subscriptions.set(channelStr, cursor);

    // Add to subscriber set
    let subs = this.subscribers.get(channelStr);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(channelStr, subs);
    }
    subs.add(connectionId);

    // Get current cursor and any missed messages
    const buffer = this.getOrCreateBuffer(channelStr);
    const currentCursor = buffer.getLatestCursor();

    let missedMessages: HubMessage[] | undefined;
    if (cursor) {
      // Replay messages since the cursor (or full buffer if cursor expired/invalid)
      missedMessages = buffer.isValidCursor(cursor)
        ? buffer.slice(cursor)
        : buffer.getAll();
    }

    logger.debug(
      {
        connectionId,
        channel: channelStr,
        cursor,
        missedCount: missedMessages?.length,
      },
      "Connection subscribed to channel",
    );

    return {
      ...(currentCursor !== undefined && { cursor: currentCursor }),
      ...(missedMessages !== undefined && { missedMessages }),
    };
  }

  /**
   * Unsubscribe a connection from a channel.
   *
   * @param connectionId - The connection ID
   * @param channel - The channel to unsubscribe from
   */
  unsubscribe(connectionId: string, channel: Channel): void {
    const ws = this.connections.get(connectionId);
    if (!ws) return;

    const channelStr = channelToString(channel);

    // Remove from subscriptions
    ws.data.subscriptions.delete(channelStr);

    // Remove from subscriber set
    const subs = this.subscribers.get(channelStr);
    if (subs) {
      subs.delete(connectionId);
      if (subs.size === 0) {
        this.subscribers.delete(channelStr);
      }
    }

    logger.debug(
      { connectionId, channel: channelStr },
      "Connection unsubscribed from channel",
    );
  }

  /**
   * Publish a message to a channel.
   *
   * @param channel - The channel to publish to
   * @param type - Message type
   * @param payload - Message payload
   * @param metadata - Optional metadata
   * @returns The published message with cursor
   */
  publish(
    channel: Channel,
    type: MessageType,
    payload: unknown,
    metadata?: MessageMetadata,
  ): HubMessage {
    const channelStr = channelToString(channel);
    const requiresAck = channelRequiresAck(channel);

    // Create message (cursor will be set by buffer)
    const message = createHubMessage(
      type,
      channelStr,
      payload,
      metadata,
    ) as HubMessage;

    // Add to ring buffer
    const buffer = this.getOrCreateBuffer(channelStr);
    message.cursor = buffer.push(message);

    // Fan out to subscribers
    const subs = this.subscribers.get(channelStr);
    if (subs && subs.size > 0) {
      const serverMessage: ChannelMessage = {
        type: "message",
        message,
        ...(requiresAck && { ackRequired: true }),
      };
      const json = serializeServerMessage(serverMessage);

      for (const connId of subs) {
        const ws = this.connections.get(connId);
        if (ws) {
          try {
            ws.send(json);
            // Update the connection's cursor for this channel
            ws.data.subscriptions.set(channelStr, message.cursor);

            // Track pending ack if required (with limit enforcement)
            if (requiresAck) {
              if (ws.data.pendingAcks.size >= MAX_PENDING_ACKS_PER_CONNECTION) {
                logger.warn(
                  {
                    connectionId: connId,
                    pendingCount: ws.data.pendingAcks.size,
                    limit: MAX_PENDING_ACKS_PER_CONNECTION,
                  },
                  "Pending ack limit reached, skipping ack tracking for message",
                );
              } else {
                ws.data.pendingAcks.set(message.id, {
                  message,
                  sentAt: new Date(),
                  replayCount: 0,
                });
              }
            }
          } catch (err) {
            this.sendFailureCount++;
            logger.warn(
              { connectionId: connId, channel: channelStr, error: err },
              "Failed to send message to subscriber",
            );
          }
        }
      }
    }

    this.messageCount++;
    return message;
  }

  /**
   * Handle acknowledgment of messages from a client.
   *
   * @param connectionId - The connection acknowledging messages
   * @param messageIds - IDs of messages being acknowledged
   * @returns Acknowledgment result
   */
  handleAck(connectionId: string, messageIds: string[]): AckResponseMessage {
    const ws = this.connections.get(connectionId);
    if (!ws) {
      return {
        type: "ack_response",
        acknowledged: [],
        notFound: messageIds,
      };
    }

    const acknowledged: string[] = [];
    const notFound: string[] = [];

    for (const msgId of messageIds) {
      if (ws.data.pendingAcks.has(msgId)) {
        ws.data.pendingAcks.delete(msgId);
        acknowledged.push(msgId);
      } else {
        notFound.push(msgId);
      }
    }

    if (acknowledged.length > 0) {
      logger.debug(
        { connectionId, acknowledged: acknowledged.length },
        "Messages acknowledged",
      );
    }

    return {
      type: "ack_response",
      acknowledged,
      notFound,
    };
  }

  /**
   * Get pending acks for a connection.
   *
   * @param connectionId - The connection ID
   * @returns Array of pending ack messages
   */
  getPendingAcks(connectionId: string): PendingAck[] {
    const ws = this.connections.get(connectionId);
    if (!ws) return [];
    return Array.from(ws.data.pendingAcks.values());
  }

  /**
   * Replay pending acks for a connection (e.g., on reconnect).
   *
   * @param connectionId - The connection ID
   * @param messageIds - Optional subset of message IDs to replay
   * @returns Number of messages replayed
   */
  replayPendingAcks(
    connectionId: string,
    messageIds?: ReadonlySet<string>,
  ): number {
    const ws = this.connections.get(connectionId);
    if (!ws) return 0;

    let replayed = 0;
    const entries = messageIds
      ? Array.from(
          messageIds,
          (id) => [id, ws.data.pendingAcks.get(id)] as const,
        )
      : Array.from(ws.data.pendingAcks.entries());

    for (const [msgId, pending] of entries) {
      if (!pending) continue;
      const serverMessage: ChannelMessage = {
        type: "message",
        message: pending.message,
        ackRequired: true,
      };
      try {
        ws.send(serializeServerMessage(serverMessage));
        pending.replayCount++;
        pending.sentAt = new Date();
        replayed++;
      } catch (err) {
        logger.warn(
          { connectionId, messageId: msgId, error: err },
          "Failed to replay pending ack message",
        );
      }
    }

    if (replayed > 0) {
      logger.info(
        { connectionId, replayed },
        "Replayed pending ack messages on reconnect",
      );
    }

    return replayed;
  }

  /**
   * Replay messages from a cursor.
   *
   * @param channel - The channel to replay
   * @param cursor - Starting cursor (exclusive)
   * @param limit - Maximum messages to return
   * @returns Array of messages and metadata
   */
  replay(
    channel: Channel,
    cursor: string,
    limit = 100,
  ): {
    messages: HubMessage[];
    hasMore: boolean;
    lastCursor?: string;
    expired: boolean;
  } {
    const channelStr = channelToString(channel);
    const buffer = this.buffers.get(channelStr);

    if (!buffer) {
      return { messages: [], hasMore: false, expired: false };
    }

    // Check if cursor is still valid
    const expired = !buffer.isValidCursor(cursor);
    if (expired) {
      // Cursor expired - return all available messages
      const messages = buffer.getAll(limit + 1);
      const hasMore = messages.length > limit;
      const trimmed = hasMore ? messages.slice(0, limit) : messages;
      const lastCursor =
        trimmed.length > 0 ? trimmed[trimmed.length - 1]?.cursor : undefined;

      return {
        messages: trimmed,
        hasMore,
        ...(lastCursor !== undefined && { lastCursor }),
        expired: true,
      };
    }

    // Slice from cursor
    const messages = buffer.slice(cursor, limit + 1);
    const hasMore = messages.length > limit;
    const trimmed = hasMore ? messages.slice(0, limit) : messages;
    const lastCursor =
      trimmed.length > 0 ? trimmed[trimmed.length - 1]?.cursor : undefined;

    return {
      messages: trimmed,
      hasMore,
      ...(lastCursor !== undefined && { lastCursor }),
      expired: false,
    };
  }

  /**
   * Handle reconnection with multiple cursors.
   *
   * @param connectionId - The connection ID
   * @param cursors - Map of channel -> last known cursor
   * @returns Reconnection result with replay info
   */
  handleReconnect(
    connectionId: string,
    cursors: Record<string, string>,
  ): ReconnectAckMessage & { pendingAcksReplayed?: number } {
    const ws = this.connections.get(connectionId);
    if (!ws) {
      return {
        type: "reconnect_ack",
        replayed: {},
        expired: [],
        newCursors: {},
      };
    }

    const pendingAckIdsBefore = new Set(ws.data.pendingAcks.keys());

    const replayed: Record<string, number> = {};
    const expired: string[] = [];
    const newCursors: Record<string, string> = {};

    for (const [channelStr, cursor] of Object.entries(cursors)) {
      const channel = parseChannel(channelStr);
      if (!channel) continue;

      // Subscribe to the channel
      const result = this.subscribe(connectionId, channel, cursor);

      // Check if this channel requires acks
      const requiresAck = channelRequiresAck(channel);

      // Track results
      if (result.missedMessages) {
        let sentCount = 0;

        // Send missed messages
        for (const msg of result.missedMessages) {
          if (requiresAck && ws.data.pendingAcks.has(msg.id)) {
            // Avoid double-sending messages that are already pending ack.
            // These will be replayed via replayPendingAcks().
            ws.data.subscriptions.set(channelStr, msg.cursor);
            continue;
          }

          const serverMessage: ChannelMessage = {
            type: "message",
            message: msg,
            ...(requiresAck && { ackRequired: true }),
          };
          try {
            ws.send(serializeServerMessage(serverMessage));
            ws.data.subscriptions.set(channelStr, msg.cursor);
            sentCount++;

            // Track as pending ack if required
            if (requiresAck) {
              ws.data.pendingAcks.set(msg.id, {
                message: msg,
                sentAt: new Date(),
                replayCount: 1, // This is a replay
              });
            }
          } catch (err) {
            logger.warn(
              { connectionId, error: err },
              "Failed to replay message",
            );
          }
        }

        replayed[channelStr] = sentCount;
      }

      // Check if cursor was expired
      const buffer = this.buffers.get(channelStr);
      if (buffer && cursor && !buffer.isValidCursor(cursor)) {
        expired.push(channelStr);
      }

      // Record new cursor
      if (result.cursor) {
        newCursors[channelStr] = result.cursor;
      }
    }

    // Also replay any previously pending acks that weren't acknowledged
    const pendingAcksReplayed = this.replayPendingAcks(
      connectionId,
      pendingAckIdsBefore,
    );

    logger.info(
      { connectionId, replayed, expired: expired.length, pendingAcksReplayed },
      "Reconnection handled",
    );

    return {
      type: "reconnect_ack",
      replayed,
      expired,
      newCursors,
      ...(pendingAcksReplayed > 0 && { pendingAcksReplayed }),
    };
  }

  /**
   * Get a connection handle by ID.
   */
  getConnection(connectionId: string): ConnectionHandle | undefined {
    const ws = this.connections.get(connectionId);
    if (!ws) return undefined;

    const cursors: Record<string, string> = {};
    for (const [ch, cursor] of ws.data.subscriptions) {
      if (cursor) cursors[ch] = cursor;
    }

    return {
      connectionId,
      connectedAt: ws.data.connectedAt,
      subscriptions: Array.from(ws.data.subscriptions.keys()),
      lastHeartbeat: ws.data.lastHeartbeat,
      cursors,
      pendingAckCount: ws.data.pendingAcks.size,
    };
  }

  /**
   * Update last heartbeat for a connection.
   */
  updateHeartbeat(connectionId: string): void {
    const ws = this.connections.get(connectionId);
    if (ws) {
      ws.data.lastHeartbeat = new Date();
    }
  }

  /**
   * Get all connections that haven't sent a heartbeat within timeout.
   *
   * @param timeoutMs - Timeout in milliseconds
   * @returns Array of connection IDs
   */
  getDeadConnections(timeoutMs: number): string[] {
    const now = Date.now();
    const dead: string[] = [];

    for (const [connId, ws] of this.connections) {
      if (now - ws.data.lastHeartbeat.getTime() > timeoutMs) {
        dead.push(connId);
      }
    }

    return dead;
  }

  /**
   * Get hub statistics.
   *
   * Note: This is a pure read operation with no side effects.
   * Use resetMessageStats() to reset the message counter if needed.
   */
  getStats(): HubStats {
    const now = Date.now();
    const elapsed = (now - this.lastStatsReset) / 1000; // seconds
    const messagesPerSecond = elapsed > 0 ? this.messageCount / elapsed : 0;

    // Count subscriptions by channel type
    const subscriptionsByChannel: Record<string, number> = {};
    for (const [channelStr, subs] of this.subscribers) {
      const channel = parseChannel(channelStr);
      if (channel) {
        const prefix = getChannelTypePrefix(channel);
        subscriptionsByChannel[prefix] =
          (subscriptionsByChannel[prefix] ?? 0) + subs.size;
      }
    }

    // Get buffer utilization by type
    const bufferUtilization: Record<string, number> = {};
    const bufferCounts: Record<string, { total: number; count: number }> = {};

    for (const [channelStr, buffer] of this.buffers) {
      const channel = parseChannel(channelStr);
      if (channel) {
        const prefix = getChannelTypePrefix(channel);
        const bucket = bufferCounts[prefix] ?? { total: 0, count: 0 };
        bucket.total += buffer.utilization();
        bucket.count += 1;
        bufferCounts[prefix] = bucket;
      }
    }

    for (const [prefix, data] of Object.entries(bufferCounts)) {
      bufferUtilization[prefix] = data.count > 0 ? data.total / data.count : 0;
    }

    // Aggregate event loss telemetry from ring buffers
    let totalCapacityEvictions = 0;
    let totalTtlExpirations = 0;
    let lastDropAt: number | null = null;
    const byChannel: Record<
      string,
      { capacityEvictions: number; ttlExpirations: number }
    > = {};

    for (const [channelStr, buffer] of this.buffers) {
      const stats = buffer.dropStats;
      if (stats.capacityEvictions > 0 || stats.ttlExpirations > 0) {
        const channel = parseChannel(channelStr);
        const prefix = channel ? getChannelTypePrefix(channel) : channelStr;

        const channelStats = byChannel[prefix] ?? {
          capacityEvictions: 0,
          ttlExpirations: 0,
        };
        channelStats.capacityEvictions += stats.capacityEvictions;
        channelStats.ttlExpirations += stats.ttlExpirations;
        byChannel[prefix] = channelStats;
        totalCapacityEvictions += stats.capacityEvictions;
        totalTtlExpirations += stats.ttlExpirations;

        const lastDrop = Math.max(
          stats.lastEvictionAt ?? 0,
          stats.lastExpirationAt ?? 0,
        );
        if (lastDrop > 0 && (lastDropAt === null || lastDrop > lastDropAt)) {
          lastDropAt = lastDrop;
        }
      }
    }

    return {
      activeConnections: this.connections.size,
      subscriptionsByChannel,
      messagesPerSecond,
      bufferUtilization,
      eventLoss: {
        totalCapacityEvictions,
        totalTtlExpirations,
        totalSendFailures: this.sendFailureCount,
        lastDropAt: lastDropAt ? new Date(lastDropAt).toISOString() : null,
        byChannel,
      },
    };
  }

  /**
   * Reset message statistics counter.
   *
   * Call this after getStats() if you want to start a new measurement period.
   * Returns the stats from the period that was just reset.
   */
  resetMessageStats(): { messageCount: number; elapsedMs: number } {
    const now = Date.now();
    const elapsedMs = now - this.lastStatsReset;
    const messageCount = this.messageCount;

    this.messageCount = 0;
    this.lastStatsReset = now;

    return { messageCount, elapsedMs };
  }

  /**
   * Prune expired entries from all buffers.
   *
   * @returns Total number of entries pruned
   */
  pruneBuffers(): number {
    let total = 0;
    for (const buffer of this.buffers.values()) {
      total += buffer.prune();
    }
    return total;
  }

  /**
   * Remove buffers for channels that have no subscribers and are empty.
   * This prevents unbounded memory growth from accumulated channel buffers.
   *
   * @returns Number of buffers removed
   */
  pruneUnusedBuffers(): number {
    let removed = 0;

    for (const [channelStr, buffer] of this.buffers) {
      // Check if channel has any subscribers
      const subs = this.subscribers.get(channelStr);
      if (subs && subs.size > 0) {
        continue; // Channel still has subscribers, keep buffer
      }

      // Prune expired entries first
      buffer.prune();

      // If buffer is now empty (or was already empty), remove it
      if (buffer.validSize() === 0) {
        this.buffers.delete(channelStr);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug(
        { buffersRemoved: removed, buffersRemaining: this.buffers.size },
        "Pruned unused channel buffers",
      );
    }

    return removed;
  }

  /**
   * Get memory usage statistics for monitoring.
   */
  getMemoryStats(): {
    connections: number;
    buffers: number;
    subscriberSets: number;
    totalBufferItems: number;
  } {
    let totalBufferItems = 0;
    for (const buffer of this.buffers.values()) {
      totalBufferItems += buffer.size();
    }

    return {
      connections: this.connections.size,
      buffers: this.buffers.size,
      subscriberSets: this.subscribers.size,
      totalBufferItems,
    };
  }

  /**
   * Send a message to a specific connection.
   */
  sendToConnection(connectionId: string, message: ServerMessage): boolean {
    const ws = this.connections.get(connectionId);
    if (!ws) return false;

    try {
      ws.send(serializeServerMessage(message));
      return true;
    } catch (err) {
      logger.warn({ connectionId, error: err }, "Failed to send to connection");
      return false;
    }
  }

  /**
   * Broadcast a message to all connections.
   */
  broadcast(message: ServerMessage): number {
    const json = serializeServerMessage(message);
    let sent = 0;
    let failed = 0;

    for (const ws of this.connections.values()) {
      try {
        ws.send(json);
        sent++;
      } catch {
        failed++;
      }
    }

    // Log if there were failures for observability
    if (failed > 0) {
      logger.warn(
        {
          messageType: message.type,
          sent,
          failed,
          total: this.connections.size,
        },
        "Broadcast had send failures",
      );
    }

    return sent;
  }

  /**
   * Get or create a ring buffer for a channel.
   */
  private getOrCreateBuffer(channelStr: string): RingBuffer<HubMessage> {
    let buffer = this.buffers.get(channelStr);
    if (!buffer) {
      // Determine config based on channel type
      const channel = parseChannel(channelStr);
      const prefix = channel ? getChannelTypePrefix(channel) : "default";
      const config = getBufferConfig(prefix);

      buffer = new RingBuffer(config);
      this.buffers.set(channelStr, buffer);
    }
    return buffer;
  }
}

// Singleton hub instance
let hubInstance: WebSocketHub | undefined;

/** Cleanup interval handle */
let cleanupIntervalHandle: ReturnType<typeof setInterval> | null = null;

/** Cleanup interval in milliseconds (default: 5 minutes) */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Get the singleton WebSocket hub instance.
 */
export function getHub(): WebSocketHub {
  if (!hubInstance) {
    hubInstance = new WebSocketHub();
  }
  return hubInstance;
}

/**
 * Set the hub instance (for testing).
 */
export function setHub(hub: WebSocketHub): void {
  hubInstance = hub;
}

/**
 * Start the periodic hub cleanup job.
 * This prunes expired buffer entries and removes unused channel buffers.
 * Safe to call multiple times - will not create duplicate intervals.
 */
export function startHubCleanupJob(): void {
  if (cleanupIntervalHandle !== null) {
    return; // Already running
  }

  cleanupIntervalHandle = setInterval(() => {
    const hub = hubInstance;
    if (!hub) return;

    // First prune expired entries from all buffers
    const entriesPruned = hub.pruneBuffers();

    // Then remove empty/unused buffers
    const buffersPruned = hub.pruneUnusedBuffers();

    if (entriesPruned > 0 || buffersPruned > 0) {
      const stats = hub.getMemoryStats();
      logger.debug(
        {
          entriesPruned,
          buffersPruned,
          ...stats,
        },
        "Hub cleanup completed",
      );
    }
  }, CLEANUP_INTERVAL_MS);

  // Ensure the interval doesn't prevent process exit
  if (cleanupIntervalHandle.unref) {
    cleanupIntervalHandle.unref();
  }

  logger.info("WebSocket hub cleanup job started");
}

/**
 * Stop the periodic hub cleanup job.
 */
export function stopHubCleanupJob(): void {
  if (cleanupIntervalHandle !== null) {
    clearInterval(cleanupIntervalHandle);
    cleanupIntervalHandle = null;
    logger.info("WebSocket hub cleanup job stopped");
  }
}

/**
 * Reset the hub instance and cleanup job (for testing).
 */
export function resetHub(): void {
  stopHubCleanupJob();
  hubInstance = undefined;
}
