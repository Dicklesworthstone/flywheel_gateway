/**
 * NTM WebSocket Bridge Service Unit Tests
 *
 * Tests for the ThrottledEventBatcher and NtmWsBridgeService throttling behavior.
 * Part of bead bd-pbt2: Backpressure/throttling for NTM ingest + WS events.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_BATCH_WINDOW_MS,
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_MAX_EVENTS_PER_BATCH,
  ThrottledEventBatcher,
} from "../services/ntm-ws-bridge.service";

// ============================================================================
// Test Setup
// ============================================================================

/** Helper to wait for async operations */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================================
// ThrottledEventBatcher Tests
// ============================================================================

describe("ThrottledEventBatcher", () => {
  describe("basic batching", () => {
    test("batches multiple events and flushes after window", async () => {
      const flushedEvents: Array<{ key: string; event: string }> = [];

      const batcher = new ThrottledEventBatcher<string>(
        (events) => flushedEvents.push(...events),
        {
          batchWindowMs: 50,
          maxEventsPerBatch: 100,
          debounceMs: 10,
        },
      );

      // Enqueue multiple events
      batcher.enqueue("agent-1", "event-1");
      batcher.enqueue("agent-2", "event-2");
      batcher.enqueue("agent-3", "event-3");

      // Events should not be flushed yet
      expect(flushedEvents.length).toBe(0);

      // Wait for batch window to expire
      await sleep(60);

      // Events should now be flushed
      expect(flushedEvents.length).toBe(3);
      expect(flushedEvents).toContainEqual({ key: "agent-1", event: "event-1" });
      expect(flushedEvents).toContainEqual({ key: "agent-2", event: "event-2" });
      expect(flushedEvents).toContainEqual({ key: "agent-3", event: "event-3" });

      batcher.stop();
    });

    test("manual flush immediately delivers events", () => {
      const flushedEvents: Array<{ key: string; event: string }> = [];

      const batcher = new ThrottledEventBatcher<string>(
        (events) => flushedEvents.push(...events),
        {
          batchWindowMs: 1000, // Long window
          maxEventsPerBatch: 100,
          debounceMs: 10,
        },
      );

      batcher.enqueue("agent-1", "event-1");
      batcher.enqueue("agent-2", "event-2");

      expect(flushedEvents.length).toBe(0);

      // Manual flush
      batcher.flush();

      expect(flushedEvents.length).toBe(2);

      batcher.stop();
    });
  });

  describe("per-key debouncing", () => {
    test("coalesces rapid events for same key", async () => {
      const flushedEvents: Array<{ key: string; event: string }> = [];

      const batcher = new ThrottledEventBatcher<string>(
        (events) => flushedEvents.push(...events),
        {
          batchWindowMs: 100,
          maxEventsPerBatch: 100,
          debounceMs: 50, // 50ms debounce window
        },
      );

      // Rapid events for same key - only last should survive
      batcher.enqueue("agent-1", "state-1");
      batcher.enqueue("agent-1", "state-2");
      batcher.enqueue("agent-1", "state-3");

      // Also add event for different key
      batcher.enqueue("agent-2", "state-a");

      // Wait for flush
      await sleep(120);

      // Should have 2 events: last for agent-1 and one for agent-2
      expect(flushedEvents.length).toBe(2);
      expect(flushedEvents).toContainEqual({ key: "agent-1", event: "state-3" });
      expect(flushedEvents).toContainEqual({ key: "agent-2", event: "state-a" });

      batcher.stop();
    });

    test("allows new event after debounce window expires", async () => {
      const flushedEvents: Array<{ key: string; event: string }> = [];

      const batcher = new ThrottledEventBatcher<string>(
        (events) => flushedEvents.push(...events),
        {
          batchWindowMs: 200,
          maxEventsPerBatch: 100,
          debounceMs: 30,
        },
      );

      batcher.enqueue("agent-1", "state-1");

      // Wait longer than debounce window
      await sleep(50);

      // This should be treated as new event (not coalesced)
      batcher.enqueue("agent-1", "state-2");

      // Flush to check
      batcher.flush();

      // Should have latest event
      expect(flushedEvents.length).toBe(1);
      expect(flushedEvents[0]?.event).toBe("state-2");

      batcher.stop();
    });
  });

  describe("max events cap", () => {
    test("drops oldest events when limit exceeded", () => {
      const flushedEvents: Array<{ key: string; event: number }> = [];

      const batcher = new ThrottledEventBatcher<number>(
        (events) => flushedEvents.push(...events),
        {
          batchWindowMs: 1000,
          maxEventsPerBatch: 3, // Small limit
          debounceMs: 0, // No debouncing
        },
      );

      // Add more events than max
      batcher.enqueue("agent-1", 1);
      batcher.enqueue("agent-2", 2);
      batcher.enqueue("agent-3", 3);
      batcher.enqueue("agent-4", 4); // This should cause agent-1 to be dropped
      batcher.enqueue("agent-5", 5); // This should cause agent-2 to be dropped

      const stats = batcher.getStats();
      expect(stats.queueSize).toBe(3);
      expect(stats.droppedCount).toBe(2);

      batcher.flush();

      // Should have events 3, 4, 5 (oldest 1, 2 were dropped)
      expect(flushedEvents.length).toBe(3);
      expect(flushedEvents.map((e) => e.event)).toContain(3);
      expect(flushedEvents.map((e) => e.event)).toContain(4);
      expect(flushedEvents.map((e) => e.event)).toContain(5);

      batcher.stop();
    });

    test("getStats reports dropped count", () => {
      const batcher = new ThrottledEventBatcher<string>(
        () => {},
        {
          batchWindowMs: 1000,
          maxEventsPerBatch: 2,
          debounceMs: 0,
        },
      );

      batcher.enqueue("a", "1");
      batcher.enqueue("b", "2");
      batcher.enqueue("c", "3"); // Drops oldest

      const stats = batcher.getStats();
      expect(stats.droppedCount).toBe(1);
      expect(stats.queueSize).toBe(2);

      batcher.stop();
    });

    test("resetDroppedCount clears counter", () => {
      const batcher = new ThrottledEventBatcher<string>(
        () => {},
        {
          batchWindowMs: 1000,
          maxEventsPerBatch: 1,
          debounceMs: 0,
        },
      );

      batcher.enqueue("a", "1");
      batcher.enqueue("b", "2");
      expect(batcher.getStats().droppedCount).toBe(1);

      batcher.resetDroppedCount();
      expect(batcher.getStats().droppedCount).toBe(0);

      batcher.stop();
    });
  });

  describe("error handling", () => {
    test("handles flush callback errors gracefully", async () => {
      let callCount = 0;

      const batcher = new ThrottledEventBatcher<string>(
        () => {
          callCount++;
          throw new Error("Flush error");
        },
        {
          batchWindowMs: 50,
          maxEventsPerBatch: 100,
          debounceMs: 10,
        },
      );

      batcher.enqueue("agent-1", "event-1");

      // Wait for flush
      await sleep(60);

      // Callback was called despite error
      expect(callCount).toBe(1);

      // Batcher should still work after error
      batcher.enqueue("agent-2", "event-2");
      await sleep(60);
      expect(callCount).toBe(2);

      batcher.stop();
    });
  });

  describe("stop behavior", () => {
    test("stop flushes remaining events", () => {
      const flushedEvents: Array<{ key: string; event: string }> = [];

      const batcher = new ThrottledEventBatcher<string>(
        (events) => flushedEvents.push(...events),
        {
          batchWindowMs: 10000, // Long window
          maxEventsPerBatch: 100,
          debounceMs: 10,
        },
      );

      batcher.enqueue("agent-1", "event-1");
      batcher.enqueue("agent-2", "event-2");

      expect(flushedEvents.length).toBe(0);

      batcher.stop();

      // Events should be flushed on stop
      expect(flushedEvents.length).toBe(2);
    });
  });
});

// ============================================================================
// Default Constants Tests
// ============================================================================

describe("Throttling Constants", () => {
  test("default batch window is 100ms", () => {
    expect(DEFAULT_BATCH_WINDOW_MS).toBe(100);
  });

  test("default max events per batch is 50", () => {
    expect(DEFAULT_MAX_EVENTS_PER_BATCH).toBe(50);
  });

  test("default debounce is 50ms", () => {
    expect(DEFAULT_DEBOUNCE_MS).toBe(50);
  });
});
