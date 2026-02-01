/**
 * WebSocket Event Log Service
 *
 * Persists WebSocket hub messages to SQLite with short-term retention so
 * reconnecting clients can backfill missed messages deterministically.
 *
 * Primary use-cases:
 * - Durable replay for flaky connections
 * - Cursor expiration detection for full refresh paths
 * - Authorization/audit + rate limiting for replay requests
 */

import { and, asc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { db, wsChannelConfig, wsEventLog, wsReplayAuditLog } from "../db";
import { decodeCursor } from "../ws/cursor";
import type { HubMessage, MessageMetadata } from "../ws/messages";
import { BUFFER_CONFIGS } from "../ws/ring-buffer";
import { logger } from "./logger";

export interface PersistableEvent {
  id: string;
  channel: string;
  cursor: string;
  sequence: number;
  messageType: string;
  payload: unknown;
  metadata?: MessageMetadata;
}

export interface ReplayRequest {
  connectionId: string;
  userId?: string;
  channel: string;
  fromCursor?: string;
  correlationId?: string;
}

export interface ReplayResult {
  messages: HubMessage[];
  lastCursor?: string;
  hasMore: boolean;
  cursorExpired: boolean;
  usedSnapshot: boolean;
}

export interface WsEventLogStats {
  totalEvents: number;
  eventsByChannel: Record<string, number>;
  oldestEventAge?: number;
  newestEventAge?: number;
}

interface ResolvedChannelConfig {
  persistEvents: boolean;
  retentionMs: number;
  maxEvents: number;
  snapshotEnabled: boolean;
  snapshotIntervalMs?: number;
  maxReplayRequestsPerMinute: number;
}

const DEFAULT_CONFIG: ResolvedChannelConfig = {
  persistEvents: true,
  retentionMs: 300_000,
  maxEvents: 10_000,
  snapshotEnabled: false,
  maxReplayRequestsPerMinute: 10,
};

function isEnabled(): boolean {
  const raw = process.env["WS_EVENT_LOG_ENABLED"]?.trim().toLowerCase();
  if (!raw) return true;
  return raw !== "0" && raw !== "false" && raw !== "off";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesChannelPattern(pattern: string, channel: string): boolean {
  if (!pattern.includes("*")) return pattern === channel;
  const regex = new RegExp(
    `^${pattern.split("*").map(escapeRegExp).join(".*")}$`,
  );
  return regex.test(channel);
}

function patternSpecificity(pattern: string): number {
  return pattern.replaceAll("*", "").length;
}

function isTestEnvironment(): boolean {
  const nodeEnv = process.env["NODE_ENV"]?.trim().toLowerCase();
  if (nodeEnv === "test") return true;

  const bunTest = process.env["BUN_TEST"]?.trim();
  if (bunTest === "1" || bunTest?.toLowerCase() === "true") return true;

  const dbFile = process.env["DB_FILE_NAME"]?.trim();
  return dbFile === ":memory:";
}

const CHANNEL_CONFIG_CACHE_TTL_MS = isTestEnvironment() ? 0 : 5000;
let cachedChannelConfigs: (typeof wsChannelConfig.$inferSelect)[] | undefined;
let cachedChannelConfigsAt = 0;

async function getChannelConfigs(): Promise<
  (typeof wsChannelConfig.$inferSelect)[]
> {
  if (CHANNEL_CONFIG_CACHE_TTL_MS > 0) {
    const ageMs = Date.now() - cachedChannelConfigsAt;
    if (cachedChannelConfigs && ageMs < CHANNEL_CONFIG_CACHE_TTL_MS) {
      return cachedChannelConfigs;
    }
  }

  const configs = await db.select().from(wsChannelConfig);
  cachedChannelConfigs = configs;
  cachedChannelConfigsAt = Date.now();
  return configs;
}

function getDefaultConfigForChannel(channel: string): ResolvedChannelConfig {
  let bestKey: string | undefined;
  for (const key of Object.keys(BUFFER_CONFIGS)) {
    if (channel === key || channel.startsWith(`${key}:`)) {
      if (!bestKey || key.length > bestKey.length) bestKey = key;
    }
  }

  const bufferConfig = bestKey ? BUFFER_CONFIGS[bestKey] : undefined;
  const retentionMs = bufferConfig?.ttlMs ?? DEFAULT_CONFIG.retentionMs;
  const maxEvents = bufferConfig?.capacity ?? DEFAULT_CONFIG.maxEvents;

  return { ...DEFAULT_CONFIG, retentionMs, maxEvents };
}

async function resolveChannelConfig(
  channel: string,
): Promise<ResolvedChannelConfig> {
  const configs = await getChannelConfigs();

  let best: typeof wsChannelConfig.$inferSelect | undefined;
  let bestScore = -1;

  for (const cfg of configs) {
    if (!matchesChannelPattern(cfg.channelPattern, channel)) continue;
    const score = patternSpecificity(cfg.channelPattern);
    if (score > bestScore) {
      best = cfg;
      bestScore = score;
    }
  }

  if (!best) {
    return getDefaultConfigForChannel(channel);
  }

  const resolved: ResolvedChannelConfig = {
    persistEvents: best.persistEvents,
    retentionMs: best.retentionMs,
    maxEvents: best.maxEvents,
    snapshotEnabled: best.snapshotEnabled,
    maxReplayRequestsPerMinute: best.maxReplayRequestsPerMinute,
  };

  if (best.snapshotIntervalMs !== null) {
    resolved.snapshotIntervalMs = best.snapshotIntervalMs;
  }

  return resolved;
}

function toHubMessage(row: typeof wsEventLog.$inferSelect): HubMessage | null {
  let parsedPayload: unknown = null;
  try {
    parsedPayload = JSON.parse(row.payload);
  } catch (error) {
    logger.warn({ error, id: row.id }, "ws_event_log: invalid payload JSON");
    return null;
  }

  const metadata: MessageMetadata = {};
  if (row.correlationId !== null) metadata.correlationId = row.correlationId;
  if (row.agentId !== null) metadata.agentId = row.agentId;
  if (row.workspaceId !== null) metadata.workspaceId = row.workspaceId;

  const hasMetadata = Object.keys(metadata).length > 0;

  return {
    id: row.id,
    cursor: row.cursor,
    timestamp: row.createdAt.toISOString(),
    channel: row.channel,
    type: row.messageType as HubMessage["type"],
    payload: parsedPayload,
    ...(hasMetadata && { metadata }),
  };
}

export async function persistEvent(event: PersistableEvent): Promise<boolean> {
  if (!isEnabled()) return false;

  const config = await resolveChannelConfig(event.channel);
  if (!config.persistEvents) return false;

  const cursorData = decodeCursor(event.cursor);
  if (!cursorData) {
    logger.warn(
      { channel: event.channel, cursor: event.cursor },
      "ws_event_log: skipping event with invalid cursor",
    );
    return false;
  }

  const createdAt = new Date(cursorData.timestamp);
  const expiresAt =
    config.retentionMs > 0
      ? new Date(createdAt.getTime() + config.retentionMs)
      : null;

  try {
    await db
      .insert(wsEventLog)
      .values({
        id: event.id,
        channel: event.channel,
        cursor: event.cursor,
        sequence: event.sequence,
        messageType: event.messageType,
        payload: JSON.stringify(event.payload),
        ...(event.metadata?.correlationId !== undefined && {
          correlationId: event.metadata.correlationId,
        }),
        ...(event.metadata?.agentId !== undefined && {
          agentId: event.metadata.agentId,
        }),
        ...(event.metadata?.workspaceId !== undefined && {
          workspaceId: event.metadata.workspaceId,
        }),
        createdAt,
        ...(expiresAt !== null && { expiresAt }),
      })
      .onConflictDoNothing();
    return true;
  } catch (error) {
    logger.warn(
      { channel: event.channel, error },
      "ws_event_log: persist failed",
    );
    return false;
  }
}

export async function persistEventBatch(
  events: PersistableEvent[],
): Promise<number> {
  if (!isEnabled()) return 0;
  if (events.length === 0) return 0;

  let persisted = 0;
  for (const event of events) {
    // Keep batch implementation simple and correct; callers can optimize later.
    if (await persistEvent(event)) persisted++;
  }
  return persisted;
}

type RateLimitState = { windowStartMs: number; count: number };
const connectionRateLimits = new Map<string, RateLimitState>();

export function clearConnectionRateLimits(connectionId: string): void {
  connectionRateLimits.delete(connectionId);
}

function isRateLimited(connectionId: string, maxPerMinute: number): boolean {
  if (maxPerMinute <= 0) return false;

  const now = Date.now();
  const state = connectionRateLimits.get(connectionId);
  if (!state) {
    connectionRateLimits.set(connectionId, { windowStartMs: now, count: 1 });
    return false;
  }

  const elapsed = now - state.windowStartMs;
  if (elapsed >= 60_000) {
    connectionRateLimits.set(connectionId, { windowStartMs: now, count: 1 });
    return false;
  }

  if (state.count >= maxPerMinute) return true;
  state.count++;
  return false;
}

export async function replayEvents(
  request: ReplayRequest,
  limit = 100,
): Promise<ReplayResult> {
  const startedAt = Date.now();
  const safeLimit = Math.max(1, Math.min(limit, 1000));

  const config = await resolveChannelConfig(request.channel);
  const now = new Date();

  const emptyResult: ReplayResult = {
    messages: [],
    hasMore: false,
    cursorExpired: false,
    usedSnapshot: false,
  };

  // Rate limit (per-connection, per-minute)
  if (isRateLimited(request.connectionId, config.maxReplayRequestsPerMinute)) {
    await writeReplayAuditLog({
      request,
      cursorExpired: false,
      usedSnapshot: false,
      messagesReplayed: 0,
      startedAt,
      finishedAt: Date.now(),
    });
    return emptyResult;
  }

  // Only return non-expired events (cleanup job is best-effort).
  const baseWhere = and(
    eq(wsEventLog.channel, request.channel),
    or(sql`${wsEventLog.expiresAt} IS NULL`, gt(wsEventLog.expiresAt, now)),
  );

  let cursorExpired = false;
  const fromCursor = request.fromCursor?.trim();
  const cursorData = fromCursor ? decodeCursor(fromCursor) : undefined;

  if (fromCursor && !cursorData) {
    cursorExpired = true;
  }

  if (fromCursor && cursorData) {
    const tooOld = Date.now() - cursorData.timestamp > config.retentionMs;
    if (tooOld) {
      cursorExpired = true;
    } else {
      const exists = await db
        .select({ id: wsEventLog.id })
        .from(wsEventLog)
        .where(
          and(
            eq(wsEventLog.channel, request.channel),
            eq(wsEventLog.cursor, fromCursor),
          ),
        )
        .limit(1);
      if (exists.length === 0) {
        cursorExpired = true;
      }
    }
  }

  const whereClause =
    fromCursor && cursorData && !cursorExpired
      ? and(
          baseWhere,
          or(
            gt(wsEventLog.createdAt, new Date(cursorData.timestamp)),
            and(
              eq(wsEventLog.createdAt, new Date(cursorData.timestamp)),
              gt(wsEventLog.sequence, cursorData.sequence),
            ),
          ),
        )
      : baseWhere;

  const rows = await db
    .select()
    .from(wsEventLog)
    .where(whereClause)
    .orderBy(asc(wsEventLog.createdAt), asc(wsEventLog.sequence))
    .limit(safeLimit + 1);

  const hasMore = rows.length > safeLimit;
  const trimmed = hasMore ? rows.slice(0, safeLimit) : rows;
  const messages: HubMessage[] = [];
  for (const row of trimmed) {
    const msg = toHubMessage(row);
    if (msg) messages.push(msg);
  }

  const lastCursor = messages[messages.length - 1]?.cursor;

  const result: ReplayResult = {
    messages,
    hasMore,
    ...(lastCursor !== undefined && { lastCursor }),
    cursorExpired,
    usedSnapshot: false,
  };

  await writeReplayAuditLog({
    request,
    cursorExpired,
    usedSnapshot: result.usedSnapshot,
    messagesReplayed: messages.length,
    ...(lastCursor !== undefined && { lastCursor }),
    startedAt,
    finishedAt: Date.now(),
  });

  return result;
}

async function writeReplayAuditLog(options: {
  request: ReplayRequest;
  cursorExpired: boolean;
  usedSnapshot: boolean;
  messagesReplayed: number;
  lastCursor?: string;
  startedAt: number;
  finishedAt: number;
}): Promise<void> {
  if (!isEnabled()) return;

  const durationMs = options.finishedAt - options.startedAt;

  try {
    await db.insert(wsReplayAuditLog).values({
      id: crypto.randomUUID(),
      connectionId: options.request.connectionId,
      ...(options.request.userId !== undefined && {
        userId: options.request.userId,
      }),
      channel: options.request.channel,
      ...(options.request.fromCursor !== undefined && {
        fromCursor: options.request.fromCursor,
      }),
      ...(options.lastCursor !== undefined && { toCursor: options.lastCursor }),
      messagesReplayed: options.messagesReplayed,
      cursorExpired: options.cursorExpired,
      usedSnapshot: options.usedSnapshot,
      requestedAt: new Date(options.startedAt),
      durationMs,
      ...(options.request.correlationId !== undefined && {
        correlationId: options.request.correlationId,
      }),
    });
  } catch (error) {
    logger.warn({ error }, "ws_event_log: failed to write replay audit log");
  }
}

export async function cleanupExpiredEvents(): Promise<number> {
  if (!isEnabled()) return 0;

  const now = new Date();
  const deleted = await db
    .delete(wsEventLog)
    .where(lt(wsEventLog.expiresAt, now))
    .returning({ id: wsEventLog.id })
    .catch((error) => {
      logger.error({ error }, "ws_event_log: cleanupExpiredEvents failed");
      return [];
    });

  return deleted.length;
}

export async function trimChannelEvents(channel: string): Promise<number> {
  if (!isEnabled()) return 0;

  const config = await resolveChannelConfig(channel);
  if (config.maxEvents <= 0) return 0;

  const totalRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(wsEventLog)
    .where(eq(wsEventLog.channel, channel));

  const total = totalRows[0]?.count ?? 0;
  const excess = total - config.maxEvents;
  if (excess <= 0) return 0;

  const ids = await db
    .select({ id: wsEventLog.id })
    .from(wsEventLog)
    .where(eq(wsEventLog.channel, channel))
    .orderBy(asc(wsEventLog.createdAt), asc(wsEventLog.sequence))
    .limit(excess);

  if (ids.length === 0) return 0;

  await db.delete(wsEventLog).where(
    inArray(
      wsEventLog.id,
      ids.map((row) => row.id),
    ),
  );

  return ids.length;
}

export async function getStats(): Promise<WsEventLogStats> {
  const totalRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(wsEventLog);
  const totalEvents = totalRows[0]?.count ?? 0;

  const eventsByChannel: Record<string, number> = {};

  if (totalEvents === 0) {
    return { totalEvents: 0, eventsByChannel };
  }

  const byChannel = await db
    .select({
      channel: wsEventLog.channel,
      count: sql<number>`count(*)`,
    })
    .from(wsEventLog)
    .groupBy(wsEventLog.channel);

  for (const row of byChannel) {
    eventsByChannel[row.channel] = row.count;
  }

  const oldestRow = await db
    .select({ createdAt: wsEventLog.createdAt })
    .from(wsEventLog)
    .orderBy(asc(wsEventLog.createdAt))
    .limit(1);
  const newestRow = await db
    .select({ createdAt: wsEventLog.createdAt })
    .from(wsEventLog)
    .orderBy(sql`${wsEventLog.createdAt} DESC`)
    .limit(1);

  const now = Date.now();
  const oldest = oldestRow[0]?.createdAt;
  const newest = newestRow[0]?.createdAt;

  const stats: WsEventLogStats = {
    totalEvents,
    eventsByChannel,
  };

  if (oldest) stats.oldestEventAge = now - oldest.getTime();
  if (newest) stats.newestEventAge = now - newest.getTime();

  return stats;
}

// ============================================================================
// Cleanup job (best-effort, production convenience)
// ============================================================================

const CLEANUP_INTERVAL_MS = 60_000;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startCleanupJob(): void {
  if (cleanupInterval) return;
  if (!isEnabled()) return;

  cleanupInterval = setInterval(() => {
    cleanupExpiredEvents().catch((error) => {
      logger.error({ error }, "ws_event_log: cleanup job failed");
    });
  }, CLEANUP_INTERVAL_MS);

  if (cleanupInterval.unref) cleanupInterval.unref();
}

export function stopCleanupJob(): void {
  if (!cleanupInterval) return;
  clearInterval(cleanupInterval);
  cleanupInterval = null;
}
