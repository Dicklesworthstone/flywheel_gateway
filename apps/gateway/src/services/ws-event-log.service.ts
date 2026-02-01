import { and, asc, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
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

export interface WsEventLogCleanupConfig {
  retentionHours: number;
  maxRows: number;
  maxDeletePerRun: number;
  deleteBatchSize: number;
}

const DEFAULT_CONFIG: WsEventLogConfig = {
  enabled: process.env["WS_EVENT_LOG_ENABLED"] === "true",
  maxReplayLimit: 1000,
};

function parsePositiveNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  if (n <= 0) return undefined;
  return n;
}

const DEFAULT_CLEANUP_CONFIG: WsEventLogCleanupConfig = {
  retentionHours:
    parsePositiveNumber(process.env["WS_EVENT_LOG_RETENTION_HOURS"]) ?? 24,
  maxRows: parsePositiveNumber(process.env["WS_EVENT_LOG_MAX_ROWS"]) ?? 200_000,
  maxDeletePerRun:
    parsePositiveNumber(process.env["WS_EVENT_LOG_MAX_DELETE_PER_RUN"]) ?? 5000,
  deleteBatchSize:
    parsePositiveNumber(process.env["WS_EVENT_LOG_DELETE_BATCH_SIZE"]) ?? 500,
};

export interface WsEventLogService {
  append(message: HubMessage): Promise<void>;
  replay(options: WsEventReplayOptions): Promise<WsEventReplayResult>;
}

export interface WsEventLogCleanupResult {
  deletedExpired: number;
  trimmedBySize: number;
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

// ============================================================================
// Cleanup Job
// ============================================================================

const CLEANUP_INTERVAL_MS = 60_000; // 1 minute
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export async function cleanupWsEventLog(
  config: Partial<WsEventLogCleanupConfig> = {},
): Promise<WsEventLogCleanupResult> {
  const resolvedConfig: WsEventLogCleanupConfig = {
    ...DEFAULT_CLEANUP_CONFIG,
    ...config,
  };

  const deletedExpired = await cleanupExpiredEvents(resolvedConfig).catch(
    (error) => {
      logger.error({ error }, "ws_event_log: cleanup expired events failed");
      return 0;
    },
  );

  const trimmedBySize = await cleanupOversizedLog(resolvedConfig).catch(
    (error) => {
      logger.error({ error }, "ws_event_log: cleanup oversized log failed");
      return 0;
    },
  );

  if (deletedExpired > 0 || trimmedBySize > 0) {
    logger.info(
      {
        deletedExpired,
        trimmedBySize,
        retentionHours: resolvedConfig.retentionHours,
        maxRows: resolvedConfig.maxRows,
      },
      "ws_event_log cleanup completed",
    );
  }

  return { deletedExpired, trimmedBySize };
}

async function cleanupExpiredEvents(
  config: WsEventLogCleanupConfig,
): Promise<number> {
  if (config.retentionHours <= 0) return 0;
  const cutoff = new Date(Date.now() - config.retentionHours * 60 * 60 * 1000);

  const deletedRows = await db
    .delete(wsEventLog)
    .where(lt(wsEventLog.createdAt, cutoff))
    .returning({ id: wsEventLog.id });

  return deletedRows.length;
}

async function cleanupOversizedLog(
  config: WsEventLogCleanupConfig,
): Promise<number> {
  if (config.maxRows <= 0) return 0;

  const totalRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(wsEventLog);
  const total = totalRows[0]?.count ?? 0;
  const excess = total - config.maxRows;
  if (excess <= 0) return 0;

  const targetDelete = Math.min(excess, config.maxDeletePerRun);
  const batchSize = Math.max(1, Math.floor(config.deleteBatchSize));

  let deleted = 0;
  while (deleted < targetDelete) {
    const limit = Math.min(batchSize, targetDelete - deleted);
    const ids = await db
      .select({ id: wsEventLog.id })
      .from(wsEventLog)
      .orderBy(asc(wsEventLog.cursorTimestamp), asc(wsEventLog.cursorSequence))
      .limit(limit);

    if (ids.length === 0) {
      break;
    }

    await db.delete(wsEventLog).where(
      inArray(
        wsEventLog.id,
        ids.map((row) => row.id),
      ),
    );

    deleted += ids.length;
  }

  return deleted;
}

export function startWsEventLogCleanupJob(): void {
  if (cleanupInterval) {
    return; // Already running
  }

  cleanupInterval = setInterval(() => {
    cleanupWsEventLog().catch((error) => {
      logger.error({ error }, "ws_event_log: cleanup job failed");
    });
  }, CLEANUP_INTERVAL_MS);

  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  logger.info(
    { intervalMs: CLEANUP_INTERVAL_MS },
    "WS event log cleanup job started",
  );
}

export function stopWsEventLogCleanupJob(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
