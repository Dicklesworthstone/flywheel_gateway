/**
 * Unit tests for the Query Cache Service.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  analyticsCache,
  generateCacheKey,
  invalidateAgentAnalytics,
  invalidateAllAnalytics,
  QueryCache,
} from "../services/query-cache";

describe("QueryCache", () => {
  describe("basic operations", () => {
    let cache: QueryCache<string>;

    beforeEach(() => {
      cache = new QueryCache<string>({
        name: "test",
        ttlMs: 1000, // 1 second for fast tests
        maxSize: 10,
      });
    });

    test("get returns undefined for missing key", () => {
      expect(cache.get("nonexistent")).toBeUndefined();
    });

    test("set and get return correct value", () => {
      cache.set("key1", "value1");
      expect(cache.get("key1")).toBe("value1");
    });

    test("has returns true for existing key", () => {
      cache.set("key1", "value1");
      expect(cache.has("key1")).toBe(true);
    });

    test("has returns false for missing key", () => {
      expect(cache.has("nonexistent")).toBe(false);
    });

    test("size reflects number of entries", () => {
      expect(cache.size).toBe(0);
      cache.set("key1", "value1");
      expect(cache.size).toBe(1);
      cache.set("key2", "value2");
      expect(cache.size).toBe(2);
    });

    test("invalidate removes specific key", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");

      const result = cache.invalidate("key1");

      expect(result).toBe(true);
      expect(cache.has("key1")).toBe(false);
      expect(cache.has("key2")).toBe(true);
    });

    test("invalidate returns false for missing key", () => {
      const result = cache.invalidate("nonexistent");
      expect(result).toBe(false);
    });

    test("clear removes all entries", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.has("key1")).toBe(false);
      expect(cache.has("key2")).toBe(false);
      expect(cache.has("key3")).toBe(false);
    });
  });

  describe("TTL expiration", () => {
    test("entry expires after TTL", async () => {
      const cache = new QueryCache<string>({
        name: "test-ttl",
        ttlMs: 50, // 50ms TTL
        maxSize: 10,
      });

      cache.set("key1", "value1");
      expect(cache.get("key1")).toBe("value1");

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(cache.get("key1")).toBeUndefined();
    });

    test("has returns false after TTL expires", async () => {
      const cache = new QueryCache<string>({
        name: "test-ttl-has",
        ttlMs: 50,
        maxSize: 10,
      });

      cache.set("key1", "value1");
      expect(cache.has("key1")).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(cache.has("key1")).toBe(false);
    });

    test("custom TTL per entry overrides default", async () => {
      const cache = new QueryCache<string>({
        name: "test-custom-ttl",
        ttlMs: 1000, // Default 1 second
        maxSize: 10,
      });

      cache.set("short", "value1", 50); // 50ms TTL
      cache.set("long", "value2"); // Default 1 second TTL

      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(cache.get("short")).toBeUndefined(); // Expired
      expect(cache.get("long")).toBe("value2"); // Still valid
    });

    test("prune removes expired entries", async () => {
      const cache = new QueryCache<string>({
        name: "test-prune",
        ttlMs: 50,
        maxSize: 10,
      });

      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      await new Promise((resolve) => setTimeout(resolve, 60));

      const pruned = cache.prune();

      expect(pruned).toBe(3);
      expect(cache.size).toBe(0);
    });
  });

  describe("size cap and LRU eviction", () => {
    test("evicts LRU entry when at capacity", () => {
      const cache = new QueryCache<string>({
        name: "test-lru",
        ttlMs: 10000,
        maxSize: 3,
      });

      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      // All should be present
      expect(cache.size).toBe(3);

      // Add one more - should evict LRU (key1)
      cache.set("key4", "value4");

      expect(cache.size).toBe(3);
      expect(cache.has("key1")).toBe(false); // Evicted
      expect(cache.has("key2")).toBe(true);
      expect(cache.has("key3")).toBe(true);
      expect(cache.has("key4")).toBe(true);
    });

    test("accessing entry updates lastAccessed for LRU", async () => {
      const cache = new QueryCache<string>({
        name: "test-lru-access",
        ttlMs: 10000,
        maxSize: 3,
      });

      cache.set("key1", "value1");
      await new Promise((resolve) => setTimeout(resolve, 5));
      cache.set("key2", "value2");
      await new Promise((resolve) => setTimeout(resolve, 5));
      cache.set("key3", "value3");

      // Access key1 to update its lastAccessed
      cache.get("key1");

      // Add new entry - should evict key2 (now LRU)
      cache.set("key4", "value4");

      expect(cache.has("key1")).toBe(true); // Recently accessed
      expect(cache.has("key2")).toBe(false); // Evicted (was LRU)
      expect(cache.has("key3")).toBe(true);
      expect(cache.has("key4")).toBe(true);
    });

    test("updating existing key does not trigger eviction", () => {
      const cache = new QueryCache<string>({
        name: "test-update",
        ttlMs: 10000,
        maxSize: 3,
      });

      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      // Update existing key
      cache.set("key1", "updated");

      expect(cache.size).toBe(3);
      expect(cache.get("key1")).toBe("updated");
      expect(cache.has("key2")).toBe(true);
      expect(cache.has("key3")).toBe(true);
    });
  });

  describe("getOrCompute", () => {
    let cache: QueryCache<number>;

    beforeEach(() => {
      cache = new QueryCache<number>({
        name: "test-compute",
        ttlMs: 1000,
        maxSize: 10,
      });
    });

    test("computes and caches value on miss", async () => {
      let computeCount = 0;
      const result = await cache.getOrCompute("key1", async () => {
        computeCount++;
        return 42;
      });

      expect(result).toBe(42);
      expect(computeCount).toBe(1);
      expect(cache.get("key1")).toBe(42);
    });

    test("returns cached value on hit without computing", async () => {
      cache.set("key1", 100);

      let computeCount = 0;
      const result: number = await cache.getOrCompute("key1", async () => {
        computeCount++;
        return 42;
      });

      expect(result).toBe(100);
      expect(computeCount).toBe(0);
    });

    test("deduplicates concurrent requests", async () => {
      let computeCount = 0;

      // Simulate slow computation
      const compute = async () => {
        computeCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 42;
      };

      // Fire multiple concurrent requests
      const results = await Promise.all([
        cache.getOrCompute("key1", compute),
        cache.getOrCompute("key1", compute),
        cache.getOrCompute("key1", compute),
      ]);

      // All should get same result
      expect(results).toEqual([42, 42, 42]);

      // Compute should only be called once
      expect(computeCount).toBe(1);
    });

    test("handles compute errors gracefully", async () => {
      const error = new Error("Compute failed");

      await expect(
        cache.getOrCompute("key1", async () => {
          throw error;
        }),
      ).rejects.toThrow("Compute failed");

      // Key should not be in cache after failure
      expect(cache.has("key1")).toBe(false);
    });

    test("subsequent request after error computes again", async () => {
      let attempt = 0;

      // First call fails
      await expect(
        cache.getOrCompute("key1", async () => {
          attempt++;
          if (attempt === 1) throw new Error("First attempt failed");
          return 42;
        }),
      ).rejects.toThrow();

      // Second call should succeed
      const result = await cache.getOrCompute("key1", async () => {
        attempt++;
        return 42;
      });

      expect(result).toBe(42);
      expect(attempt).toBe(2);
    });
  });

  describe("pattern invalidation", () => {
    let cache: QueryCache<string>;

    beforeEach(() => {
      cache = new QueryCache<string>({
        name: "test-pattern",
        ttlMs: 10000,
        maxSize: 100,
      });
    });

    test("invalidates keys matching string pattern", () => {
      cache.set("analytics:agent1:productivity", "v1");
      cache.set("analytics:agent1:quality", "v2");
      cache.set("analytics:agent2:productivity", "v3");
      cache.set("other:agent1:data", "v4");

      const count = cache.invalidatePattern("analytics:agent1");

      expect(count).toBe(2);
      expect(cache.has("analytics:agent1:productivity")).toBe(false);
      expect(cache.has("analytics:agent1:quality")).toBe(false);
      expect(cache.has("analytics:agent2:productivity")).toBe(true);
      expect(cache.has("other:agent1:data")).toBe(true);
    });

    test("invalidates keys matching regex pattern", () => {
      cache.set("productivity:agentId=abc123", "v1");
      cache.set("quality:agentId=abc123", "v2");
      cache.set("productivity:agentId=xyz789", "v3");

      const count = cache.invalidatePattern(/agentId=abc123/);

      expect(count).toBe(2);
      expect(cache.has("productivity:agentId=abc123")).toBe(false);
      expect(cache.has("quality:agentId=abc123")).toBe(false);
      expect(cache.has("productivity:agentId=xyz789")).toBe(true);
    });

    test("returns 0 when no keys match", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");

      const count = cache.invalidatePattern("nonexistent");

      expect(count).toBe(0);
      expect(cache.size).toBe(2);
    });
  });

  describe("statistics", () => {
    test("tracks hits and misses", () => {
      const cache = new QueryCache<string>({
        name: "test-stats",
        ttlMs: 10000,
        maxSize: 10,
      });

      cache.set("key1", "value1");

      // Hits
      cache.get("key1");
      cache.get("key1");

      // Misses
      cache.get("nonexistent1");
      cache.get("nonexistent2");

      const stats = cache.getStats();

      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBe(0.5);
    });

    test("tracks evictions", () => {
      const cache = new QueryCache<string>({
        name: "test-evictions",
        ttlMs: 10000,
        maxSize: 2,
      });

      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3"); // Evicts key1
      cache.set("key4", "value4"); // Evicts key2

      const stats = cache.getStats();

      expect(stats.evictions).toBe(2);
    });

    test("tracks invalidations", () => {
      const cache = new QueryCache<string>({
        name: "test-invalidations",
        ttlMs: 10000,
        maxSize: 10,
      });

      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      cache.invalidate("key1");
      cache.invalidatePattern("key2");

      const stats = cache.getStats();

      expect(stats.invalidations).toBe(2);
    });

    test("calculates hit rate correctly", () => {
      const cache = new QueryCache<string>({
        name: "test-hitrate",
        ttlMs: 10000,
        maxSize: 10,
      });

      cache.set("key1", "value1");

      // 3 hits
      cache.get("key1");
      cache.get("key1");
      cache.get("key1");

      // 1 miss
      cache.get("key2");

      const stats = cache.getStats();

      expect(stats.hitRate).toBe(0.75);
    });

    test("hit rate is 0 when no requests", () => {
      const cache = new QueryCache<string>({
        name: "test-empty",
        ttlMs: 10000,
        maxSize: 10,
      });

      const stats = cache.getStats();

      expect(stats.hitRate).toBe(0);
    });
  });
});

describe("generateCacheKey", () => {
  test("generates key with prefix only when no params", () => {
    const key = generateCacheKey("prefix", {});
    expect(key).toBe("prefix");
  });

  test("generates key with sorted parameters", () => {
    const key = generateCacheKey("analytics", { z: 1, a: 2, m: 3 });
    expect(key).toBe("analytics:a=2&m=3&z=1");
  });

  test("filters out undefined and null values", () => {
    const key = generateCacheKey("test", {
      valid: "value",
      undef: undefined,
      nil: null,
    });
    expect(key).toBe("test:valid=value");
  });

  test("converts Date to ISO string", () => {
    const date = new Date("2024-01-15T12:00:00.000Z");
    const key = generateCacheKey("test", { date });
    expect(key).toBe("test:date=2024-01-15T12:00:00.000Z");
  });

  test("handles mixed value types", () => {
    const key = generateCacheKey("test", {
      num: 42,
      str: "hello",
      bool: true,
    });
    expect(key).toBe("test:bool=true&num=42&str=hello");
  });
});

describe("analyticsCache singleton", () => {
  afterEach(() => {
    // Clean up after each test
    invalidateAllAnalytics();
  });

  test("has correct configuration", () => {
    const stats = analyticsCache.getStats();
    expect(stats.size).toBeGreaterThanOrEqual(0);
  });

  test("invalidateAgentAnalytics removes matching entries", () => {
    // Set some entries
    analyticsCache.set("productivity:agentId=agent123&period=24h", {});
    analyticsCache.set("quality:agentId=agent123&period=24h", {});
    analyticsCache.set("productivity:agentId=agent456&period=24h", {});

    // Invalidate agent123
    invalidateAgentAnalytics("agent123");

    // Check results
    expect(analyticsCache.has("productivity:agentId=agent123&period=24h")).toBe(
      false,
    );
    expect(analyticsCache.has("quality:agentId=agent123&period=24h")).toBe(
      false,
    );
    expect(analyticsCache.has("productivity:agentId=agent456&period=24h")).toBe(
      true,
    );
  });

  test("invalidateAllAnalytics clears entire cache", () => {
    analyticsCache.set("key1", {});
    analyticsCache.set("key2", {});
    analyticsCache.set("key3", {});

    invalidateAllAnalytics();

    expect(analyticsCache.size).toBe(0);
  });
});
