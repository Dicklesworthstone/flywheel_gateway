/**
 * Tests for RingBuffer implementation.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { decodeCursor } from "../cursor";
import {
  getBufferConfig,
  RingBuffer,
  type RingBufferConfig,
} from "../ring-buffer";

describe("RingBuffer", () => {
  describe("constructor", () => {
    test("creates buffer with valid config", () => {
      const buffer = new RingBuffer<string>({ capacity: 10, ttlMs: 60000 });
      expect(buffer.size()).toBe(0);
    });

    test("throws for capacity < 1", () => {
      expect(() => new RingBuffer<string>({ capacity: 0, ttlMs: 0 })).toThrow();
      expect(
        () => new RingBuffer<string>({ capacity: -1, ttlMs: 0 }),
      ).toThrow();
    });
  });

  describe("push", () => {
    test("adds item and returns cursor", () => {
      const buffer = new RingBuffer<string>({ capacity: 10, ttlMs: 0 });

      const cursor = buffer.push("hello");

      expect(cursor).toBeDefined();
      expect(typeof cursor).toBe("string");
      expect(buffer.size()).toBe(1);
    });

    test("cursors are monotonically increasing", () => {
      const buffer = new RingBuffer<number>({ capacity: 10, ttlMs: 0 });

      const cursors: string[] = [];
      for (let i = 0; i < 5; i++) {
        cursors.push(buffer.push(i));
      }

      for (let i = 1; i < cursors.length; i++) {
        const prev = decodeCursor(cursors[i - 1]!)!;
        const curr = decodeCursor(cursors[i]!)!;
        expect(curr.sequence).toBeGreaterThan(prev.sequence);
      }
    });

    test("evicts oldest items when over capacity", () => {
      const buffer = new RingBuffer<number>({ capacity: 3, ttlMs: 0 });

      buffer.push(1);
      buffer.push(2);
      buffer.push(3);
      expect(buffer.size()).toBe(3);

      buffer.push(4); // Should evict 1
      expect(buffer.size()).toBe(3);

      const items = buffer.getAll();
      expect(items).toEqual([2, 3, 4]);
    });
  });

  describe("get", () => {
    test("retrieves item by cursor", () => {
      const buffer = new RingBuffer<string>({ capacity: 10, ttlMs: 0 });

      const cursor = buffer.push("test");
      const item = buffer.get(cursor);

      expect(item).toBe("test");
    });

    test("returns undefined for invalid cursor", () => {
      const buffer = new RingBuffer<string>({ capacity: 10, ttlMs: 0 });
      buffer.push("test");

      expect(buffer.get("invalid")).toBeUndefined();
    });

    test("returns undefined for evicted item", () => {
      const buffer = new RingBuffer<number>({ capacity: 2, ttlMs: 0 });

      const cursor1 = buffer.push(1);
      buffer.push(2);
      buffer.push(3); // Evicts 1

      expect(buffer.get(cursor1)).toBeUndefined();
    });

    test("returns undefined for expired item", async () => {
      const buffer = new RingBuffer<string>({ capacity: 10, ttlMs: 50 });

      const cursor = buffer.push("test");

      // Wait for expiry
      await Bun.sleep(60);

      expect(buffer.get(cursor)).toBeUndefined();
    });
  });

  describe("slice", () => {
    test("returns items after cursor", () => {
      const buffer = new RingBuffer<number>({ capacity: 10, ttlMs: 0 });

      buffer.push(1);
      const cursor = buffer.push(2);
      buffer.push(3);
      buffer.push(4);

      const items = buffer.slice(cursor);
      expect(items).toEqual([3, 4]);
    });

    test("returns empty array for invalid cursor", () => {
      const buffer = new RingBuffer<number>({ capacity: 10, ttlMs: 0 });
      buffer.push(1);
      buffer.push(2);

      expect(buffer.slice("invalid")).toEqual([]);
    });

    test("respects limit parameter", () => {
      const buffer = new RingBuffer<number>({ capacity: 10, ttlMs: 0 });

      buffer.push(1);
      const cursor = buffer.push(2);
      buffer.push(3);
      buffer.push(4);
      buffer.push(5);

      const items = buffer.slice(cursor, 2);
      expect(items).toEqual([3, 4]);
    });

    test("skips expired items", async () => {
      const buffer = new RingBuffer<number>({ capacity: 10, ttlMs: 50 });

      buffer.push(1);
      const cursor = buffer.push(2);

      // Wait for items to expire
      await Bun.sleep(60);

      // These should not be expired
      buffer.push(3);
      buffer.push(4);

      const items = buffer.slice(cursor);
      expect(items).toEqual([3, 4]);
    });
  });

  describe("getAll", () => {
    test("returns all items", () => {
      const buffer = new RingBuffer<number>({ capacity: 10, ttlMs: 0 });

      buffer.push(1);
      buffer.push(2);
      buffer.push(3);

      expect(buffer.getAll()).toEqual([1, 2, 3]);
    });

    test("respects limit", () => {
      const buffer = new RingBuffer<number>({ capacity: 10, ttlMs: 0 });

      buffer.push(1);
      buffer.push(2);
      buffer.push(3);

      expect(buffer.getAll(2)).toEqual([1, 2]);
    });

    test("skips expired items", async () => {
      const buffer = new RingBuffer<number>({ capacity: 10, ttlMs: 50 });

      buffer.push(1);
      buffer.push(2);

      await Bun.sleep(60);

      buffer.push(3);

      const items = buffer.getAll();
      expect(items).toEqual([3]);
    });
  });

  describe("getLatestCursor", () => {
    test("returns cursor of latest item", () => {
      const buffer = new RingBuffer<string>({ capacity: 10, ttlMs: 0 });

      buffer.push("a");
      buffer.push("b");
      const lastCursor = buffer.push("c");

      expect(buffer.getLatestCursor()).toBe(lastCursor);
    });

    test("returns undefined for empty buffer", () => {
      const buffer = new RingBuffer<string>({ capacity: 10, ttlMs: 0 });
      expect(buffer.getLatestCursor()).toBeUndefined();
    });
  });

  describe("getOldestCursor", () => {
    test("returns cursor of oldest non-expired item", () => {
      const buffer = new RingBuffer<string>({ capacity: 10, ttlMs: 0 });

      const firstCursor = buffer.push("a");
      buffer.push("b");
      buffer.push("c");

      expect(buffer.getOldestCursor()).toBe(firstCursor);
    });

    test("returns undefined for empty buffer", () => {
      const buffer = new RingBuffer<string>({ capacity: 10, ttlMs: 0 });
      expect(buffer.getOldestCursor()).toBeUndefined();
    });
  });

  describe("isValidCursor", () => {
    test("returns true for valid cursor", () => {
      const buffer = new RingBuffer<string>({ capacity: 10, ttlMs: 0 });
      const cursor = buffer.push("test");

      expect(buffer.isValidCursor(cursor)).toBe(true);
    });

    test("returns false for invalid cursor format", () => {
      const buffer = new RingBuffer<string>({ capacity: 10, ttlMs: 0 });
      buffer.push("test");

      expect(buffer.isValidCursor("invalid")).toBe(false);
    });

    test("returns false for evicted item", () => {
      const buffer = new RingBuffer<number>({ capacity: 2, ttlMs: 0 });

      const cursor = buffer.push(1);
      buffer.push(2);
      buffer.push(3);

      expect(buffer.isValidCursor(cursor)).toBe(false);
    });

    test("returns false for expired item", async () => {
      const buffer = new RingBuffer<string>({ capacity: 10, ttlMs: 50 });
      const cursor = buffer.push("test");

      await Bun.sleep(60);

      expect(buffer.isValidCursor(cursor)).toBe(false);
    });
  });

  describe("prune", () => {
    test("removes expired entries", async () => {
      const buffer = new RingBuffer<number>({ capacity: 10, ttlMs: 50 });

      buffer.push(1);
      buffer.push(2);

      await Bun.sleep(60);

      buffer.push(3);

      const removed = buffer.prune();
      expect(removed).toBe(2);
      expect(buffer.size()).toBe(1);
    });

    test("returns 0 when TTL is disabled", () => {
      const buffer = new RingBuffer<number>({ capacity: 10, ttlMs: 0 });

      buffer.push(1);
      buffer.push(2);

      const removed = buffer.prune();
      expect(removed).toBe(0);
    });

    test("returns 0 when no expired entries", () => {
      const buffer = new RingBuffer<number>({ capacity: 10, ttlMs: 60000 });

      buffer.push(1);
      buffer.push(2);

      const removed = buffer.prune();
      expect(removed).toBe(0);
    });
  });

  describe("clear", () => {
    test("removes all entries", () => {
      const buffer = new RingBuffer<number>({ capacity: 10, ttlMs: 0 });

      buffer.push(1);
      buffer.push(2);
      buffer.push(3);

      buffer.clear();

      expect(buffer.size()).toBe(0);
      expect(buffer.getAll()).toEqual([]);
    });
  });

  describe("size and validSize", () => {
    test("size returns total count", () => {
      const buffer = new RingBuffer<number>({ capacity: 10, ttlMs: 0 });

      buffer.push(1);
      buffer.push(2);

      expect(buffer.size()).toBe(2);
    });

    test("validSize excludes expired entries", async () => {
      const buffer = new RingBuffer<number>({ capacity: 10, ttlMs: 50 });

      buffer.push(1);
      buffer.push(2);

      await Bun.sleep(60);

      buffer.push(3);

      expect(buffer.size()).toBe(3); // Still 3 in buffer
      expect(buffer.validSize()).toBe(1); // Only 1 valid
    });
  });

  describe("utilization", () => {
    test("returns percentage of capacity used", () => {
      const buffer = new RingBuffer<number>({ capacity: 10, ttlMs: 0 });

      buffer.push(1);
      expect(buffer.utilization()).toBe(10);

      buffer.push(2);
      buffer.push(3);
      buffer.push(4);
      buffer.push(5);
      expect(buffer.utilization()).toBe(50);

      for (let i = 6; i <= 10; i++) {
        buffer.push(i);
      }
      expect(buffer.utilization()).toBe(100);
    });
  });
});

describe("getBufferConfig", () => {
  test("returns config for known channel type", () => {
    const config = getBufferConfig("agent:output");

    expect(config.capacity).toBe(10000);
    expect(config.ttlMs).toBe(300000);
  });

  test("returns default config for unknown channel type", () => {
    const config = getBufferConfig("unknown:type");

    expect(config.capacity).toBe(1000);
    expect(config.ttlMs).toBe(300000);
  });

  test("different channel types have different configs", () => {
    const agentOutput = getBufferConfig("agent:output");
    const agentState = getBufferConfig("agent:state");
    const userMail = getBufferConfig("user:mail");

    expect(agentOutput.capacity).not.toBe(agentState.capacity);
    expect(userMail.ttlMs).not.toBe(agentState.ttlMs);
  });
});
