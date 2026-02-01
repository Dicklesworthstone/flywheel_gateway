import { and, asc, desc, eq, gt, or } from "drizzle-orm";
import { db, wsEventLog } from "../db";
import { decodeCursor } from "../ws/cursor";
import type { HubMessage } from "../ws/messages";
import { logger } from "./logger";

export interface WsEventReplayResult {
  messages: HubMessage[];
  hasMore: boolean;
  lastCursor?: string;
  cursorExpired: boolean;
}

export interface WsEventReplayOptions {
  channel: string;
  cursor?: string;
  limit?: number;
}

export interface WsEventLogConfig {
  enabled: boolean;
  maxReplayLimit: number;
}

const DEFAULT_CONFIG: WsEventLogConfig = {
  enabled: process.env["WS_EVENT_LOG_ENABLED"] === "true",
  maxReplayLimit: 1000,
};

export interface WsEventLogService {
  append(message: HubMessage): Promise<void>;
  replay(options: WsEventReplayOptions): Promise<WsEventReplayResult>;
}

export function createWsEventLogService(
  config: Partial<WsEventLogConfig> = {},
): WsEventLogService {
  const resolvedConfig: WsEventLogConfig = { ...DEFAULT_CONFIG, ...config };

  async function append(message: HubMessage): Promise<void> {
    if (!resolvedConfig.enabled) return;

    const cursorData = decodeCursor(message.cursor);
    if (!cursorData) {
      logger.warn(
        { channel: message.channel, cursor: message.cursor },
        "ws_event_log: skipping message with invalid cursor",
      );
      return;
    }

    try {
      await db
        .insert(wsEventLog)
        .values({
          id: message.id,
          channel: message.channel,
          cursor: message.cursor,
          cursorTimestamp: cursorData.timestamp,
          cursorSequence: cursorData.sequence,
          message,
          createdAt: new Date(cursorData.timestamp),
        })
        .onConflictDoNothing();
    } catch (error) {
      logger.warn(
        { channel: message.channel, error },
        "ws_event_log: failed to persist message",
      );
    }
  }

  async function replay(
    options: WsEventReplayOptions,
  ): Promise<WsEventReplayResult> {
    if (!resolvedConfig.enabled) {
      return { messages: [], hasMore: false, cursorExpired: false };
    }

    const limitRaw = options.limit ?? 200;
    const limit = Math.max(1, Math.min(limitRaw, resolvedConfig.maxReplayLimit));
    const cursor = options.cursor?.trim();
    const channel = options.channel;

    const queryLatest = async (
      cursorExpired: boolean,
    ): Promise<WsEventReplayResult> => {
      const rows = await db
        .select({ message: wsEventLog.message })
        .from(wsEventLog)
        .where(eq(wsEventLog.channel, channel))
        .orderBy(desc(wsEventLog.cursorTimestamp), desc(wsEventLog.cursorSequence))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const trimmed = hasMore ? rows.slice(0, limit) : rows;
      const messages = trimmed
        .reverse()
        .map((row) => row.message as HubMessage);
      const lastCursor = messages[messages.length - 1]?.cursor;

      return {
        messages,
        hasMore,
        ...(lastCursor !== undefined && { lastCursor }),
        cursorExpired,
      };
    };

    if (!cursor) {
      return queryLatest(false);
    }

    const cursorData = decodeCursor(cursor);
    if (!cursorData) {
      return queryLatest(true);
    }

    const exists = await db
      .select({ id: wsEventLog.id })
      .from(wsEventLog)
      .where(
        and(
          eq(wsEventLog.channel, channel),
          eq(wsEventLog.cursorTimestamp, cursorData.timestamp),
          eq(wsEventLog.cursorSequence, cursorData.sequence),
        ),
      )
      .limit(1);
    if (exists.length === 0) {
      return queryLatest(true);
    }

    const whereClause = and(
      eq(wsEventLog.channel, channel),
      or(
        gt(wsEventLog.cursorTimestamp, cursorData.timestamp),
        and(
          eq(wsEventLog.cursorTimestamp, cursorData.timestamp),
          gt(wsEventLog.cursorSequence, cursorData.sequence),
        ),
      ),
    );

    const rows = await db
      .select({ message: wsEventLog.message })
      .from(wsEventLog)
      .where(whereClause)
      .orderBy(asc(wsEventLog.cursorTimestamp), asc(wsEventLog.cursorSequence))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(0, limit) : rows;
    const messages = trimmed.map((row) => row.message as HubMessage);
    const lastCursor = messages[messages.length - 1]?.cursor;

    return {
      messages,
      hasMore,
      ...(lastCursor !== undefined && { lastCursor }),
      cursorExpired: false,
    };
  }

  return { append, replay };
}

let serviceInstance: WsEventLogService | null = null;

export function getWsEventLogService(): WsEventLogService {
  if (!serviceInstance) {
    serviceInstance = createWsEventLogService();
  }
  return serviceInstance;
}

export function _clearWsEventLogService(): void {
  serviceInstance = null;
}
