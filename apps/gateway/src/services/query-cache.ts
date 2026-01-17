/**
 * Query Cache Service
 *
 * Provides an in-memory caching layer for analytics queries to reduce SQLite load
 * and smooth dashboard refreshes. Features:
 * - TTL-based expiration per entry
 * - Size cap with LRU eviction
 * - Cache hit/miss metrics
 * - Invalidation by key pattern or full clear
 * - Concurrency-safe async operations
 */

import { getCorrelationId, getLogger } from "../middleware/correlation";
import { incrementCounter } from "./metrics";

// ============================================================================
// Types
// ============================================================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  lastAccessed: number;
  key: string;
}

export interface QueryCacheOptions {
  /** Time-to-live in milliseconds (default: 60000 = 1 minute) */
  ttlMs?: number;
  /** Maximum number of entries (default: 1000) */
  maxSize?: number;
  /** Cache name for metrics/logging (default: 'query') */
  name?: string;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  invalidations: number;
  hitRate: number;
}

// ============================================================================
// QueryCache Class
// ============================================================================

/**
 * Generic in-memory cache with TTL and LRU eviction.
 */
export class QueryCache<T = unknown> {
  private readonly cache = new Map<string, CacheEntry<T>>();
  private readonly ttlMs: number;
  private readonly maxSize: number;
  private readonly name: string;

  // Stats for monitoring
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private invalidations = 0;

  // Pending async operations for deduplication
  private readonly pending = new Map<string, Promise<T>>();

  constructor(options: QueryCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 60_000; // 1 minute default
    this.maxSize = options.maxSize ?? 1000;
    this.name = options.name ?? "query";
  }

  /**
   * Get a value from cache, or compute and store it if missing/expired.
   * The generic U parameter allows type-safe caching of different value types.
   */
  async getOrCompute<U extends T>(key: string, compute: () => Promise<U>): Promise<U> {
    // Check for valid cached entry
    const entry = this.cache.get(key);
    const now = Date.now();

    if (entry && entry.expiresAt > now) {
      // Cache hit
      entry.lastAccessed = now;
      this.hits++;
      this.emitMetric("hit", key);
      this.log("debug", "Cache hit", { key, ttlRemaining: entry.expiresAt - now });
      return entry.value as U;
    }

    // Cache miss - check if already computing
    const pendingPromise = this.pending.get(key);
    if (pendingPromise) {
      this.log("debug", "Awaiting pending computation", { key });
      return pendingPromise as Promise<U>;
    }

    // Compute value
    this.misses++;
    this.emitMetric("miss", key);
    this.log("debug", "Cache miss, computing", { key });

    const computePromise = compute().then((value) => {
      this.set(key, value);
      this.pending.delete(key);
      return value;
    }).catch((error) => {
      this.pending.delete(key);
      throw error;
    });

    this.pending.set(key, computePromise as Promise<T>);
    return computePromise;
  }

  /**
   * Get a value from cache without computing.
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    const now = Date.now();

    if (entry && entry.expiresAt > now) {
      entry.lastAccessed = now;
      this.hits++;
      this.emitMetric("hit", key);
      return entry.value;
    }

    if (entry) {
      // Expired - remove it
      this.cache.delete(key);
    }

    this.misses++;
    this.emitMetric("miss", key);
    return undefined;
  }

  /**
   * Store a value in the cache.
   */
  set(key: string, value: T, ttlMs?: number): void {
    const now = Date.now();
    const effectiveTtl = ttlMs ?? this.ttlMs;

    // Evict if at capacity and key doesn't exist
    if (!this.cache.has(key) && this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    const entry: CacheEntry<T> = {
      value,
      expiresAt: now + effectiveTtl,
      lastAccessed: now,
      key,
    };

    this.cache.set(key, entry);
    this.log("debug", "Cache set", { key, ttlMs: effectiveTtl, size: this.cache.size });
  }

  /**
   * Invalidate a specific key.
   */
  invalidate(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.invalidations++;
      this.emitMetric("invalidate", key);
      this.log("debug", "Cache invalidated", { key });
    }
    return deleted;
  }

  /**
   * Invalidate all keys matching a pattern.
   */
  invalidatePattern(pattern: string | RegExp): number {
    const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
    let count = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }

    if (count > 0) {
      this.invalidations += count;
      this.emitMetric("invalidate_pattern", pattern.toString(), count);
      this.log("info", "Cache pattern invalidated", { pattern: pattern.toString(), count });
    }

    return count;
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.invalidations += size;
    this.emitMetric("clear", "", size);
    this.log("info", "Cache cleared", { entriesRemoved: size });
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      invalidations: this.invalidations,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Check if a key exists and is not expired.
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Get the number of entries in the cache.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Remove expired entries (can be called periodically).
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
        pruned++;
      }
    }

    if (pruned > 0) {
      this.log("debug", "Cache pruned", { entriesRemoved: pruned });
    }

    return pruned;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Evict least recently used entry.
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.evictions++;
      this.emitMetric("eviction", oldestKey);
      this.log("debug", "Cache LRU eviction", { key: oldestKey });
    }
  }

  /**
   * Emit cache metrics.
   */
  private emitMetric(operation: string, key: string, count = 1): void {
    incrementCounter("cache_operations_total", count, {
      cache: this.name,
      operation,
    });
  }

  /**
   * Log with correlation context.
   */
  private log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data: Record<string, unknown>,
  ): void {
    const log = getLogger();
    log[level]({
      type: `cache:${this.name}`,
      correlationId: getCorrelationId(),
      cache: this.name,
      ...data,
      message,
    });
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Generate a cache key from query parameters.
 */
export function generateCacheKey(
  prefix: string,
  params: Record<string, unknown>,
): string {
  const sortedEntries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b));

  const paramStr = sortedEntries
    .map(([k, v]) => {
      if (v instanceof Date) {
        return `${k}=${v.toISOString()}`;
      }
      return `${k}=${String(v)}`;
    })
    .join("&");

  return paramStr ? `${prefix}:${paramStr}` : prefix;
}

// ============================================================================
// Singleton Analytics Cache Instance
// ============================================================================

/** Analytics query cache - singleton instance */
export const analyticsCache = new QueryCache({
  name: "analytics",
  ttlMs: 30_000, // 30 seconds for analytics (dashboard refresh)
  maxSize: 500,
});

/**
 * Invalidate analytics cache for a specific agent.
 * Call this when agent history is updated.
 */
export function invalidateAgentAnalytics(agentId: string): void {
  analyticsCache.invalidatePattern(new RegExp(`agentId=${agentId}`));
}

/**
 * Invalidate all analytics cache.
 * Call this on major data changes.
 */
export function invalidateAllAnalytics(): void {
  analyticsCache.clear();
}
