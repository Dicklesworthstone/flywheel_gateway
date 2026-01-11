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
  type ChannelTypePrefix,
  channelToString,
  getChannelTypePrefix,
  parseChannel,
} from "./channels";
import {
  type BackfillResponse,
  type ChannelMessage,
  createHubMessage,
  type HubMessage,
  type MessageMetadata,
  type MessageType,
  type ReconnectAckMessage,
  type ServerMessage,
  serializeServerMessage,
} from "./messages";
import {
  getBufferConfig,
  RingBuffer,
  type RingBufferConfig,
} from "./ring-buffer";

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
      const serverMessage: ChannelMessage = { type: "message", message };
      const json = serializeServerMessage(serverMessage);

      for (const connId of subs) {
        const ws = this.connections.get(connId);
        if (ws) {
          try {
            ws.send(json);
            // Update the connection's cursor for this channel
            ws.data.subscriptions.set(channelStr, message.cursor);
          } catch (err) {
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
        trimmed.length > 0 ? trimmed[trimmed.length - 1]!.cursor : undefined;

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
      trimmed.length > 0 ? trimmed[trimmed.length - 1]!.cursor : undefined;

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
  ): ReconnectAckMessage {
    const ws = this.connections.get(connectionId);
    if (!ws) {
      return {
        type: "reconnect_ack",
        replayed: {},
        expired: [],
        newCursors: {},
      };
    }

    const replayed: Record<string, number> = {};
    const expired: string[] = [];
    const newCursors: Record<string, string> = {};

    for (const [channelStr, cursor] of Object.entries(cursors)) {
      const channel = parseChannel(channelStr);
      if (!channel) continue;

      // Subscribe to the channel
      const result = this.subscribe(connectionId, channel, cursor);

      // Track results
      if (result.missedMessages) {
        replayed[channelStr] = result.missedMessages.length;

        // Send missed messages
        for (const msg of result.missedMessages) {
          const serverMessage: ChannelMessage = {
            type: "message",
            message: msg,
          };
          try {
            ws.send(serializeServerMessage(serverMessage));
          } catch (err) {
            logger.warn(
              { connectionId, error: err },
              "Failed to replay message",
            );
          }
        }
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

    logger.info(
      { connectionId, replayed, expired: expired.length },
      "Reconnection handled",
    );

    return {
      type: "reconnect_ack",
      replayed,
      expired,
      newCursors,
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
   */
  getStats(): HubStats {
    const now = Date.now();
    const elapsed = (now - this.lastStatsReset) / 1000; // seconds
    const messagesPerSecond = elapsed > 0 ? this.messageCount / elapsed : 0;

    // Reset stats
    this.messageCount = 0;
    this.lastStatsReset = now;

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
        if (!bufferCounts[prefix]) {
          bufferCounts[prefix] = { total: 0, count: 0 };
        }
        bufferCounts[prefix]!.total += buffer.utilization();
        bufferCounts[prefix]!.count++;
      }
    }

    for (const [prefix, data] of Object.entries(bufferCounts)) {
      bufferUtilization[prefix] = data.count > 0 ? data.total / data.count : 0;
    }

    return {
      activeConnections: this.connections.size,
      subscriptionsByChannel,
      messagesPerSecond,
      bufferUtilization,
    };
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

    for (const ws of this.connections.values()) {
      try {
        ws.send(json);
        sent++;
      } catch {
        // Ignore send failures during broadcast
      }
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
