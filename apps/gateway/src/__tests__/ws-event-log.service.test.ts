/**
 * Unit tests for WebSocket Event Log Service.
 *
 * Tests durable event persistence, replay with cursor-based pagination,
 * rate limiting, and cleanup operations.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

// Mock the logger
const mockLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  child: () => mockLogger,
};

mock.module("../services/logger", () => ({
  logger: mockLogger,
}));

afterAll(() => {
  mock.restore();
});

import { db } from "../db/connection";
import { wsChannelConfig, wsEventLog, wsReplayAuditLog } from "../db/schema";
import {
  cleanupExpiredEvents,
  clearConnectionRateLimits,
  getStats,
  type PersistableEvent,
  persistEvent,
  persistEventBatch,
  type ReplayRequest,
  replayEvents,
  startCleanupJob,
  stopCleanupJob,
  trimChannelEvents,
} from "../services/ws-event-log.service";
import { createCursor } from "../ws/cursor";

// Ensure migrations are run before tests
beforeAll(async () => {
  try {
    await migrate(db, { migrationsFolder: "apps/gateway/src/db/migrations" });
  } catch (e) {
    // Migration may fail if already run, ignore
  }
});

// Helper to generate test events
function createTestEvent(
  overrides: Partial<PersistableEvent> = {},
): PersistableEvent {
  const sequence = overrides.sequence ?? Date.now();
  return {
    id: `evt_${crypto.randomUUID()}`,
    channel: "agent:output:test-agent-123",
    cursor: createCursor(sequence),
    sequence,
    messageType: "agent:output:chunk",
    payload: { content: "test output" },
    metadata: {
      agentId: "test-agent-123",
      correlationId: "corr-123",
    },
    ...overrides,
  };
}

// Helper to clean up test data (safe to call before migrations)
async function cleanupTestData(): Promise<void> {
  try {
    await db.delete(wsEventLog);
    await db.delete(wsReplayAuditLog);
    await db.delete(wsChannelConfig);
  } catch {
    // Tables may not exist yet if migrations haven't run
  }
}

// Clean up before and after each test
beforeEach(async () => {
  await cleanupTestData();
  stopCleanupJob();
});

afterEach(async () => {
  await cleanupTestData();
  stopCleanupJob();
});

describe("persistEvent", () => {
  test("persists event to database", async () => {
    const event = createTestEvent();

    const result = await persistEvent(event);

    expect(result).toBe(true);

    const stored = await db
      .select()
      .from(wsEventLog)
      .where(eq(wsEventLog.id, event.id));

    expect(stored).toHaveLength(1);
    expect(stored[0]?.channel).toBe(event.channel);
    expect(stored[0]?.cursor).toBe(event.cursor);
    expect(stored[0]?.messageType).toBe(event.messageType);
    expect(JSON.parse(stored[0]?.payload ?? "{}")).toEqual(event.payload);
  });

  test("sets expiration based on channel config", async () => {
    const event = createTestEvent();
    const beforeInsert = Date.now();

    await persistEvent(event);

    const stored = await db
      .select()
      .from(wsEventLog)
      .where(eq(wsEventLog.id, event.id));

    expect(stored[0]?.expiresAt).toBeDefined();
    const expiresAtMs = stored[0]?.expiresAt?.getTime() ?? 0;
    // Should expire ~5 minutes from now (300_000ms default for agent:output)
    expect(expiresAtMs).toBeGreaterThan(beforeInsert + 290_000);
    expect(expiresAtMs).toBeLessThan(beforeInsert + 310_000);
  });

  test("stores metadata fields", async () => {
    const event = createTestEvent({
      metadata: {
        agentId: "agent-xyz",
        workspaceId: "ws-abc",
        correlationId: "corr-456",
      },
    });

    await persistEvent(event);

    const stored = await db
      .select()
      .from(wsEventLog)
      .where(eq(wsEventLog.id, event.id));

    expect(stored[0]?.agentId).toBe("agent-xyz");
    expect(stored[0]?.workspaceId).toBe("ws-abc");
    expect(stored[0]?.correlationId).toBe("corr-456");
  });
});

describe("persistEventBatch", () => {
  test("persists multiple events", async () => {
    const events = [
      createTestEvent({ sequence: 1 }),
      createTestEvent({ sequence: 2 }),
      createTestEvent({ sequence: 3 }),
    ];

    const count = await persistEventBatch(events);

    expect(count).toBe(3);

    const stored = await db
      .select()
      .from(wsEventLog)
      .where(eq(wsEventLog.channel, "agent:output:test-agent-123"));

    expect(stored).toHaveLength(3);
  });

  test("returns 0 for empty batch", async () => {
    const count = await persistEventBatch([]);
    expect(count).toBe(0);
  });
});

describe("replayEvents", () => {
  test("returns events from channel", async () => {
    // Insert test events
    const events = [
      createTestEvent({ sequence: 1 }),
      createTestEvent({ sequence: 2 }),
      createTestEvent({ sequence: 3 }),
    ];
    for (const event of events) {
      await persistEvent(event);
    }

    const request: ReplayRequest = {
      connectionId: "conn-123",
      channel: "agent:output:test-agent-123",
    };

    const result = await replayEvents(request, 10);

    expect(result.messages).toHaveLength(3);
    expect(result.hasMore).toBe(false);
    expect(result.cursorExpired).toBe(false);
  });

  test("respects cursor for pagination", async () => {
    const baseTime = Date.now();
    const events = [
      createTestEvent({ sequence: baseTime + 1 }),
      createTestEvent({ sequence: baseTime + 2 }),
      createTestEvent({ sequence: baseTime + 3 }),
    ];
    for (const event of events) {
      await persistEvent(event);
    }

    // Replay from after first event
    const request: ReplayRequest = {
      connectionId: "conn-123",
      channel: "agent:output:test-agent-123",
      fromCursor: events[0]!.cursor,
    };

    const result = await replayEvents(request, 10);

    expect(result.messages).toHaveLength(2);
    // Should start from sequence 2
    expect(result.messages[0]?.id).toBe(events[1]?.id);
    expect(result.messages[1]?.id).toBe(events[2]?.id);
  });

  test("indicates hasMore when limit is reached", async () => {
    const baseTime = Date.now();
    const events = [
      createTestEvent({ sequence: baseTime + 1 }),
      createTestEvent({ sequence: baseTime + 2 }),
      createTestEvent({ sequence: baseTime + 3 }),
    ];
    for (const event of events) {
      await persistEvent(event);
    }

    const request: ReplayRequest = {
      connectionId: "conn-123",
      channel: "agent:output:test-agent-123",
    };

    const result = await replayEvents(request, 2);

    expect(result.messages).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  test("rate limits excessive replay requests", async () => {
    // First 10 requests should succeed (default limit)
    const request: ReplayRequest = {
      connectionId: "rate-limit-test-conn",
      channel: "agent:output:test-agent-123",
    };

    for (let i = 0; i < 10; i++) {
      await replayEvents(request, 10);
    }

    // 11th request should be rate limited (empty response)
    const result = await replayEvents(request, 10);

    expect(result.messages).toHaveLength(0);
    expect(result.hasMore).toBe(false);

    // Clean up rate limit tracking
    clearConnectionRateLimits("rate-limit-test-conn");
  });

  test("creates audit log entry", async () => {
    const request: ReplayRequest = {
      connectionId: "audit-test-conn",
      userId: "user-123",
      channel: "agent:output:test-agent-123",
      correlationId: "corr-abc",
    };

    await replayEvents(request, 10);

    const auditLogs = await db.select().from(wsReplayAuditLog);

    expect(auditLogs.length).toBeGreaterThan(0);
    const log = auditLogs.find((l) => l.connectionId === "audit-test-conn");
    expect(log?.userId).toBe("user-123");
    expect(log?.channel).toBe("agent:output:test-agent-123");
    expect(log?.correlationId).toBe("corr-abc");

    clearConnectionRateLimits("audit-test-conn");
  });
});

describe("cleanupExpiredEvents", () => {
  test("removes expired events", async () => {
    // Insert an expired event directly
    const expiredEvent = createTestEvent();
    await db.insert(wsEventLog).values({
      id: expiredEvent.id,
      channel: expiredEvent.channel,
      cursor: expiredEvent.cursor,
      sequence: expiredEvent.sequence,
      messageType: expiredEvent.messageType,
      payload: JSON.stringify(expiredEvent.payload),
      createdAt: new Date(Date.now() - 600_000), // 10 minutes ago
      expiresAt: new Date(Date.now() - 60_000), // Expired 1 minute ago
    });

    // Insert a fresh event
    const freshEvent = createTestEvent({ sequence: Date.now() + 1 });
    await persistEvent(freshEvent);

    const deleted = await cleanupExpiredEvents();

    expect(deleted).toBe(1);

    // Fresh event should still exist
    const remaining = await db
      .select()
      .from(wsEventLog)
      .where(eq(wsEventLog.id, freshEvent.id));
    expect(remaining).toHaveLength(1);
  });
});

describe("trimChannelEvents", () => {
  test("trims events exceeding max limit", async () => {
    // Create a custom channel config with low max
    await db.insert(wsChannelConfig).values({
      id: crypto.randomUUID(),
      channelPattern: "agent:state:test-agent-123",
      persistEvents: true,
      retentionMs: 300_000,
      maxEvents: 3,
      snapshotEnabled: false,
      maxReplayRequestsPerMinute: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Insert 5 events
    const baseTime = Date.now();
    for (let i = 0; i < 5; i++) {
      const event = createTestEvent({
        channel: "agent:state:test-agent-123",
        sequence: baseTime + i,
      });
      await persistEvent(event);
    }

    // Wait for cache refresh
    await new Promise((resolve) => setTimeout(resolve, 100));

    const deleted = await trimChannelEvents("agent:state:test-agent-123");

    expect(deleted).toBe(2); // Should trim oldest 2 events

    const remaining = await db
      .select()
      .from(wsEventLog)
      .where(eq(wsEventLog.channel, "agent:state:test-agent-123"));
    expect(remaining).toHaveLength(3);
  });
});

describe("getStats", () => {
  test("returns correct statistics", async () => {
    // Insert events for multiple channels
    const baseTime = Date.now();
    await persistEvent(createTestEvent({ sequence: baseTime + 1 }));
    await persistEvent(createTestEvent({ sequence: baseTime + 2 }));
    await persistEvent(
      createTestEvent({
        channel: "agent:state:test-agent-123",
        sequence: baseTime + 3,
      }),
    );

    const stats = await getStats();

    expect(stats.totalEvents).toBe(3);
    expect(stats.eventsByChannel["agent:output:test-agent-123"]).toBe(2);
    expect(stats.eventsByChannel["agent:state:test-agent-123"]).toBe(1);
    expect(stats.oldestEventAge).toBeDefined();
    expect(stats.newestEventAge).toBeDefined();
  });

  test("handles empty log", async () => {
    const stats = await getStats();

    expect(stats.totalEvents).toBe(0);
    expect(Object.keys(stats.eventsByChannel)).toHaveLength(0);
    expect(stats.oldestEventAge).toBeUndefined();
    expect(stats.newestEventAge).toBeUndefined();
  });
});

describe("cleanup job", () => {
  test("starts and stops without error", () => {
    expect(() => startCleanupJob()).not.toThrow();
    expect(() => startCleanupJob()).not.toThrow(); // idempotent
    expect(() => stopCleanupJob()).not.toThrow();
    expect(() => stopCleanupJob()).not.toThrow(); // idempotent
  });
});

describe("clearConnectionRateLimits", () => {
  test("clears rate limit state for connection", async () => {
    const request: ReplayRequest = {
      connectionId: "clear-test-conn",
      channel: "agent:output:test-agent-123",
    };

    // Use up rate limit
    for (let i = 0; i < 10; i++) {
      await replayEvents(request, 1);
    }

    // Should be rate limited
    const limited = await replayEvents(request, 1);
    expect(limited.messages).toHaveLength(0);

    // Clear and try again
    clearConnectionRateLimits("clear-test-conn");

    // Should work now
    const result = await replayEvents(request, 1);
    // Empty because no events, but not rate limited
    expect(result.hasMore).toBe(false);
  });
});
