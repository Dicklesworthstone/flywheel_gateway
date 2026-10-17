/**
 * WebSocket Replay Routes
 *
 * Provides HTTP endpoints for WebSocket event replay and statistics.
 * Enables clients to retrieve missed events after reconnection.
 *
 * Endpoints:
 * - GET /ws/replay - Replay events from a cursor
 * - GET /ws/stats - Get event log statistics
 */

import { Hono } from "hono";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  getStats,
  type ReplayRequest,
  replayEvents,
} from "../services/ws-event-log.service";
import { sendResource } from "../utils/response";

const wsReplay = new Hono<{
  Variables: {
    userId?: string;
  };
}>();

/**
 * GET /ws/replay - Replay WebSocket events from a cursor.
 *
 * Query parameters:
 * - channel (required): Channel to replay events from
 * - cursor (optional): Starting cursor (exclusive); omit for all available
 * - limit (optional): Maximum events to return (default: 100, max: 1000)
 *
 * Headers:
 * - X-Connection-Id (optional): Connection ID for rate limiting and audit
 *
 * Returns:
 * - messages: Array of HubMessage objects
 * - lastCursor: Cursor of the last message (for pagination)
 * - hasMore: Whether there are more messages available
 * - cursorExpired: Whether the provided cursor was expired
 */
wsReplay.get("/replay", async (c) => {
  const log = getLogger();

  // Parse query parameters
  const channel = c.req.query("channel");
  if (!channel) {
    return c.json(
      {
        type: "error",
        code: "MISSING_CHANNEL",
        message: "Channel query parameter is required",
        hint: "Add ?channel=agent:output:YOUR_AGENT_ID to the URL",
      },
      400,
    );
  }

  const cursor = c.req.query("cursor");
  const limitStr = c.req.query("limit");
  const limit = limitStr ? Math.min(parseInt(limitStr, 10) || 100, 1000) : 100;

  // Get connection ID from header or generate one
  const connectionId =
    c.req.header("X-Connection-Id") || `http-${crypto.randomUUID()}`;

  // Get user ID from auth context if available
  const userId = c.get("userId");

  // Build request object, omitting undefined properties for exactOptionalPropertyTypes
  const request: ReplayRequest = {
    connectionId,
    channel,
    ...(userId !== undefined && { userId }),
    ...(cursor !== undefined && { fromCursor: cursor }),
    ...(getCorrelationId() !== undefined && {
      correlationId: getCorrelationId(),
    }),
  };

  log.info(
    { channel, cursor, limit, connectionId },
    "WebSocket replay requested",
  );

  const result = await replayEvents(request, limit);

  // Log replay statistics
  log.info(
    {
      channel,
      messagesReplayed: result.messages.length,
      hasMore: result.hasMore,
      cursorExpired: result.cursorExpired,
    },
    "WebSocket replay completed",
  );

  return sendResource(c, "ws_replay", {
    channel,
    messages: result.messages,
    lastCursor: result.lastCursor,
    hasMore: result.hasMore,
    cursorExpired: result.cursorExpired,
    usedSnapshot: result.usedSnapshot,
    count: result.messages.length,
  });
});

/**
 * GET /ws/stats - Get WebSocket event log statistics.
 *
 * Returns:
 * - totalEvents: Total number of events in the log
 * - eventsByChannel: Event counts per channel
 * - oldestEventAge: Age of oldest event in milliseconds
 * - newestEventAge: Age of newest event in milliseconds
 */
wsReplay.get("/stats", async (c) => {
  const stats = await getStats();

  return sendResource(c, "ws_event_log_stats", {
    ...stats,
    oldestEventAgeFormatted: stats.oldestEventAge
      ? formatDuration(stats.oldestEventAge)
      : undefined,
    newestEventAgeFormatted: stats.newestEventAge
      ? formatDuration(stats.newestEventAge)
      : undefined,
  });
});

/**
 * Format duration in milliseconds to human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3600_000).toFixed(1)}h`;
}

export { wsReplay };
