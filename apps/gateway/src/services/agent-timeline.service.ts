/**
 * Agent Session Replay and Timeline Service (bd-67lwz)
 *
 * Provides normalized, redacted, chronological session timeline storage and replay
 * for AI agents, supporting cursor-based pagination (forward/backward), full-text
 * search and filtering, retention pruning, and JSON/CSV export.
 */

import { ulid } from "ulid";
import { z } from "zod";
import { sqlite } from "../db";
import { redactSensitiveData } from "./audit-redaction.service";
import { logger } from "./logger";

// ============================================================================
// Schemas & Types
// ============================================================================

export const TimelineEventTypeSchema = z.enum([
  "agent.state",
  "tool.call",
  "tool.result",
  "text.delta",
  "mail.sent",
  "mail.received",
  "reservation.acquired",
  "reservation.conflict",
  "error",
  "recovery.triggered",
]);

export const TimelineSeveritySchema = z.enum([
  "debug",
  "info",
  "warning",
  "error",
  "critical",
]);

export const AppendTimelineEventSchema = z.object({
  type: TimelineEventTypeSchema,
  severity: TimelineSeveritySchema.default("info"),
  summary: z.string().min(1).max(500),
  correlationId: z.string().optional(),
  traceId: z.string().optional(),
  durationMs: z.number().min(0).optional(),
  timestamp: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type TimelineEventType = z.infer<typeof TimelineEventTypeSchema>;
export type TimelineSeverity = z.infer<typeof TimelineSeveritySchema>;
export type AppendTimelineEventInput = z.input<
  typeof AppendTimelineEventSchema
>;

export interface AgentTimelineEvent {
  id: string;
  seq: number;
  agentId: string;
  type: TimelineEventType;
  severity: TimelineSeverity;
  summary: string;
  correlationId?: string;
  traceId?: string;
  durationMs?: number;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface TimelineQueryOptions {
  cursor?: number;
  direction?: "forward" | "backward";
  limit?: number;
  from?: string;
  to?: string;
  types?: TimelineEventType[];
  severities?: TimelineSeverity[];
  correlationId?: string;
  search?: string;
}

export interface TimelineQueryResult {
  events: AgentTimelineEvent[];
  nextCursor?: string;
  prevCursor?: string;
  hasMore: boolean;
  totalMatching: number;
}

// ============================================================================
// Storage & Initialization
// ============================================================================

let tablesInitialized = false;
let nextSeq = 1;
const eventsById = new Map<string, AgentTimelineEvent>();
const eventsByAgent = new Map<string, AgentTimelineEvent[]>();

function ensureTimelineTable(): void {
  if (tablesInitialized) return;
  tablesInitialized = true;
  if (!sqlite) return;
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS agent_timeline_events (
        id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        summary TEXT NOT NULL,
        correlation_id TEXT,
        trace_id TEXT,
        duration_ms INTEGER,
        timestamp TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_timeline_agent_seq
        ON agent_timeline_events(agent_id, seq);
      CREATE INDEX IF NOT EXISTS idx_timeline_agent_ts
        ON agent_timeline_events(agent_id, timestamp);
    `);
  } catch (err) {
    logger.warn({ err }, "Failed to initialize agent_timeline_events table");
  }
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Normalize, redact, and append a timeline event for an agent.
 */
export function appendAgentTimelineEvent(
  agentId: string,
  input: AppendTimelineEventInput,
): AgentTimelineEvent {
  ensureTimelineTable();
  const parsed = AppendTimelineEventSchema.parse(input);
  const redactedPayload = redactSensitiveData(parsed.payload) as Record<
    string,
    unknown
  >;
  const redactedSummary = String(
    (redactSensitiveData({ summary: parsed.summary }) as { summary: string })
      .summary ?? parsed.summary,
  );

  const event: AgentTimelineEvent = {
    id: `ate_${ulid()}`,
    seq: nextSeq++,
    agentId,
    type: parsed.type,
    severity: parsed.severity,
    summary: redactedSummary,
    ...(parsed.correlationId !== undefined && {
      correlationId: parsed.correlationId,
    }),
    ...(parsed.traceId !== undefined && { traceId: parsed.traceId }),
    ...(parsed.durationMs !== undefined && { durationMs: parsed.durationMs }),
    timestamp: parsed.timestamp ?? new Date().toISOString(),
    payload: redactedPayload,
  };

  eventsById.set(event.id, event);
  const agentList = eventsByAgent.get(agentId) ?? [];
  agentList.push(event);
  eventsByAgent.set(agentId, agentList);

  if (sqlite) {
    try {
      sqlite
        .query(
          `INSERT INTO agent_timeline_events
           (id, seq, agent_id, type, severity, summary, correlation_id, trace_id, duration_ms, timestamp, payload_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.id,
          event.seq,
          event.agentId,
          event.type,
          event.severity,
          event.summary,
          event.correlationId ?? null,
          event.traceId ?? null,
          event.durationMs ?? null,
          event.timestamp,
          JSON.stringify(event.payload),
        );
    } catch (err) {
      logger.warn(
        { err, eventId: event.id },
        "Failed to persist timeline event",
      );
    }
  }

  return event;
}

/**
 * Retrieve a single timeline event by ID.
 */
export function getAgentTimelineEvent(
  agentId: string,
  eventId: string,
): AgentTimelineEvent | undefined {
  ensureTimelineTable();
  const event = eventsById.get(eventId);
  if (!event || event.agentId !== agentId) return undefined;
  return event;
}

/**
 * Query an agent's session timeline with cursor pagination and filters.
 */
export function queryAgentTimeline(
  agentId: string,
  options: TimelineQueryOptions = {},
): TimelineQueryResult {
  ensureTimelineTable();
  const allAgentEvents = eventsByAgent.get(agentId) ?? [];
  const direction = options.direction ?? "forward";
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const fromMs = options.from ? Date.parse(options.from) : undefined;
  const toMs = options.to ? Date.parse(options.to) : undefined;
  const searchLower = options.search?.trim().toLowerCase();

  // Filter matching events (ignoring cursor first to compute totalMatching)
  const matching = allAgentEvents.filter((ev) => {
    if (options.types?.length && !options.types.includes(ev.type)) {
      return false;
    }
    if (
      options.severities?.length &&
      !options.severities.includes(ev.severity)
    ) {
      return false;
    }
    if (options.correlationId && ev.correlationId !== options.correlationId) {
      return false;
    }
    if (fromMs !== undefined && !Number.isNaN(fromMs)) {
      const evMs = Date.parse(ev.timestamp);
      if (evMs < fromMs) return false;
    }
    if (toMs !== undefined && !Number.isNaN(toMs)) {
      const evMs = Date.parse(ev.timestamp);
      if (evMs > toMs) return false;
    }
    if (searchLower) {
      const inSummary = ev.summary.toLowerCase().includes(searchLower);
      const inPayload = JSON.stringify(ev.payload)
        .toLowerCase()
        .includes(searchLower);
      if (!inSummary && !inPayload) return false;
    }
    return true;
  });

  const totalMatching = matching.length;

  let cursorFiltered = matching;
  if (options.cursor !== undefined && Number.isFinite(options.cursor)) {
    const cursorSeq = options.cursor;
    cursorFiltered =
      direction === "forward"
        ? matching.filter((e) => e.seq > cursorSeq)
        : matching.filter((e) => e.seq < cursorSeq);
  }

  const ordered =
    direction === "forward"
      ? [...cursorFiltered].sort((a, b) => a.seq - b.seq)
      : [...cursorFiltered].sort((a, b) => b.seq - a.seq);

  const page = ordered.slice(0, limit);
  const hasMore = ordered.length > limit;
  const lastInPage = page[page.length - 1];
  const firstInPage = page[0];

  return {
    events: page,
    ...(hasMore &&
      lastInPage !== undefined && {
        nextCursor: String(lastInPage.seq),
      }),
    ...(firstInPage !== undefined && {
      prevCursor: String(firstInPage.seq),
    }),
    hasMore,
    totalMatching,
  };
}

/**
 * Export an agent's timeline in JSON or CSV format (already redacted).
 */
export function exportAgentTimeline(
  agentId: string,
  format: "json" | "csv" = "json",
  options: TimelineQueryOptions = {},
): { contentType: string; filename: string; body: string } {
  const result = queryAgentTimeline(agentId, { ...options, limit: 500 });
  const safeAgentId = agentId.replace(/[^a-zA-Z0-9_-]/g, "_");

  if (format === "csv") {
    const header = [
      "id",
      "seq",
      "agentId",
      "type",
      "severity",
      "timestamp",
      "correlationId",
      "durationMs",
      "summary",
    ].join(",");
    const rows = result.events.map((ev) =>
      [
        ev.id,
        ev.seq,
        ev.agentId,
        ev.type,
        ev.severity,
        ev.timestamp,
        ev.correlationId ?? "",
        ev.durationMs ?? "",
        `"${ev.summary.replace(/"/g, '""')}"`,
      ].join(","),
    );
    return {
      contentType: "text/csv; charset=utf-8",
      filename: `timeline-${safeAgentId}.csv`,
      body: [header, ...rows].join("\n"),
    };
  }

  return {
    contentType: "application/json; charset=utf-8",
    filename: `timeline-${safeAgentId}.json`,
    body: JSON.stringify(
      {
        agentId,
        exportedAt: new Date().toISOString(),
        totalEvents: result.events.length,
        events: result.events,
      },
      null,
      2,
    ),
  };
}

/**
 * Prune timeline events older than maxAgeDays.
 */
export function pruneAgentTimelineEvents(
  maxAgeDays: number,
  nowMs: number = Date.now(),
): number {
  const cutoffMs = nowMs - maxAgeDays * 24 * 60 * 60 * 1000;
  let pruned = 0;

  for (const [agentId, list] of eventsByAgent.entries()) {
    const kept: AgentTimelineEvent[] = [];
    for (const ev of list) {
      if (Date.parse(ev.timestamp) < cutoffMs) {
        eventsById.delete(ev.id);
        pruned++;
      } else {
        kept.push(ev);
      }
    }
    eventsByAgent.set(agentId, kept);
  }

  if (sqlite && pruned > 0) {
    try {
      const cutoffIso = new Date(cutoffMs).toISOString();
      sqlite
        .query("DELETE FROM agent_timeline_events WHERE timestamp < ?")
        .run(cutoffIso);
    } catch (err) {
      logger.warn({ err }, "Failed to prune agent_timeline_events in SQLite");
    }
  }

  return pruned;
}

export function clearAgentTimelineForTesting(): void {
  eventsById.clear();
  eventsByAgent.clear();
  nextSeq = 1;
}
