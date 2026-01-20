/**
 * Rate Limiting Middleware.
 *
 * Provides configurable rate limiting with support for:
 * - Per-IP, per-API-key, or custom key-based limiting
 * - Sliding window counters (in-memory)
 * - Standard rate limit headers (X-RateLimit-*)
 * - 429 responses with Retry-After header
 */

import { wrapError } from "@flywheel/shared";
import type { Context, Next } from "hono";
import { getCorrelationId } from "./correlation";

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for rate limiting.
 */
export interface RateLimitConfig {
  /** Maximum requests per window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Key generator function (default: byIP) */
  keyGenerator?: (c: Context) => string;
  /** Whether to skip rate limiting for certain requests */
  skip?: (c: Context) => boolean;
  /** Custom message for 429 response */
  message?: string;
}

/**
 * Rate limit information for a specific key.
 */
export interface RateLimitInfo {
  /** Total limit per window */
  limit: number;
  /** Remaining requests in current window */
  remaining: number;
  /** Unix timestamp (seconds) when window resets */
  reset: number;
  /** Whether the limit has been exceeded */
  exceeded: boolean;
}

/**
 * Internal counter entry for tracking requests.
 */
interface CounterEntry {
  count: number;
  resetAt: number;
}

// ============================================================================
// In-Memory Rate Limiter
// ============================================================================

/**
 * In-memory rate limiter using sliding window counters.
 *
 * Note: This implementation is suitable for single-instance deployments.
 * For distributed deployments, use Redis-backed rate limiting.
 */
export class InMemoryRateLimiter {
  private counters: Map<string, CounterEntry> = new Map();
  private cleanupIntervalMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(cleanupIntervalMs = 60_000) {
    this.cleanupIntervalMs = cleanupIntervalMs;
  }

  /**
   * Start periodic cleanup of expired entries.
   */
  startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(
      () => this.cleanup(),
      this.cleanupIntervalMs,
    );
  }

  /**
   * Stop periodic cleanup.
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Check and increment the counter for a key.
   * Returns rate limit info after incrementing.
   */
  check(key: string, config: RateLimitConfig): RateLimitInfo {
    const now = Date.now();
    let entry = this.counters.get(key);

    // Reset if window expired
    if (!entry || entry.resetAt <= now) {
      entry = {
        count: 0,
        resetAt: now + config.windowMs,
      };
    }

    // Increment counter
    entry.count++;
    // If key exists, delete first to update insertion order (LRU-like behavior for active keys)
    if (this.counters.has(key)) {
      this.counters.delete(key);
    }
    this.counters.set(key, entry);

    // Enforce max items
    if (this.counters.size > this.maxItems) {
      const oldestKey = this.counters.keys().next().value;
      if (oldestKey) {
        // console.log(`Evicting ${oldestKey} (size ${this.counters.size} > ${this.maxItems})`);
        this.counters.delete(oldestKey);
      }
    }

    const remaining = Math.max(0, config.limit - entry.count);
    const exceeded = entry.count > config.limit;

    return {
      limit: config.limit,
      remaining,
      reset: Math.ceil(entry.resetAt / 1000),
      exceeded,
    };
  }

  /**
   * Peek at rate limit info without incrementing.
   */
  peek(key: string, config: RateLimitConfig): RateLimitInfo {
    const now = Date.now();
    const entry = this.counters.get(key);

    // Window expired or no entry
    if (!entry || entry.resetAt <= now) {
      return {
        limit: config.limit,
        remaining: config.limit,
        reset: Math.ceil((now + config.windowMs) / 1000),
        exceeded: false,
      };
    }

    const remaining = Math.max(0, config.limit - entry.count);
    const exceeded = entry.count > config.limit;

    return {
      limit: config.limit,
      remaining,
      reset: Math.ceil(entry.resetAt / 1000),
      exceeded,
    };
  }

  /**
   * Check if a key is currently rate limited without incrementing.
   */
  isLimited(key: string, config: RateLimitConfig): boolean {
    const now = Date.now();
    const entry = this.counters.get(key);
    if (!entry || entry.resetAt <= now) return false;
    return entry.count >= config.limit;
  }

  /**
   * Remove expired entries from the map.
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.counters) {
      if (entry.resetAt <= now) {
        this.counters.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.counters.clear();
  }

  /**
   * Get the current number of tracked keys.
   */
  size(): number {
    return this.counters.size;
  }
}

// ============================================================================
// Key Generators
// ============================================================================

/**
 * Rate limit by client IP address.
 * Handles X-Forwarded-For for proxied requests.
 */
export function byIP(c: Context): string {
  // Check for forwarded IP (when behind proxy/load balancer)
  const forwarded = c.req.header("X-Forwarded-For");
  if (forwarded) {
    // Take the first IP (original client)
    const clientIp = forwarded.split(",")[0]?.trim();
    if (clientIp) return `ip:${clientIp}`;
  }

  // Check X-Real-IP header
  const realIp = c.req.header("X-Real-IP");
  if (realIp) return `ip:${realIp}`;

  // Fallback to unknown
  return "ip:unknown";
}

/**
 * Rate limit by API key from Authorization header.
 * Falls back to IP-based limiting if no auth header.
 */
export function byAPIKey(c: Context): string {
  const auth = c.req.header("Authorization");
  if (auth) {
    // Extract token from "Bearer <token>" format
    const token = auth.replace(/^Bearer\s+/i, "");
    if (token) {
      // Use first 16 chars of token as key (for privacy)
      const keyPrefix = token.substring(0, 16);
      return `key:${keyPrefix}`;
    }
  }
  // Fall back to IP
  return byIP(c);
}

/**
 * Rate limit by user ID from context.
 * Falls back to API key, then IP if no user ID.
 */
export function byUser(c: Context): string {
  const userId = c.get("userId") as string | undefined;
  if (userId) return `user:${userId}`;
  return byAPIKey(c);
}

/**
 * Rate limit by workspace ID from context.
 * Falls back to API key, then IP if no workspace.
 */
export function byWorkspace(c: Context): string {
  const workspaceId = c.get("workspaceId") as string | undefined;
  if (workspaceId) return `ws:${workspaceId}`;
  return byAPIKey(c);
}

/**
 * Create a composite key generator that combines multiple dimensions.
 * Useful for per-endpoint-per-user limiting.
 */
export function compositeKey(
  ...generators: Array<(c: Context) => string>
): (c: Context) => string {
  return (c: Context) => generators.map((gen) => gen(c)).join(":");
}

/**
 * Create a key generator that includes the request path.
 * Useful for per-endpoint rate limiting.
 */
export function withPath(
  baseGenerator: (c: Context) => string,
): (c: Context) => string {
  return (c: Context) => `${baseGenerator(c)}:${c.req.path}`;
}

// ============================================================================
// Default Rate Limiter Instance
// ============================================================================

/**
 * Global rate limiter instance.
 * Shared across all middleware instances by default.
 */
const globalRateLimiter = new InMemoryRateLimiter();

// ============================================================================
// Middleware
// ============================================================================

/**
 * Create rate limiting middleware.
 *
 * @example
 * ```typescript
 * // Basic usage - 100 requests per minute by IP
 * app.use("*", rateLimitMiddleware({
 *   limit: 100,
 *   windowMs: 60_000,
 * }));
 *
 * // Per-endpoint limits
 * app.use("/agents", rateLimitMiddleware({
 *   limit: 100,
 *   windowMs: 60_000,
 *   keyGenerator: byAPIKey,
 * }));
 *
 * // Stricter limit for expensive operations
 * app.use("/agents/:agentId/send", rateLimitMiddleware({
 *   limit: 30,
 *   windowMs: 60_000,
 *   keyGenerator: compositeKey(byAPIKey, (c) => c.req.param("agentId")),
 * }));
 * ```
 */
export function rateLimitMiddleware(
  config: RateLimitConfig,
  limiter: InMemoryRateLimiter = globalRateLimiter,
) {
  const keyGenerator = config.keyGenerator ?? byIP;

  return async (c: Context, next: Next) => {
    // Check if this request should be skipped
    if (config.skip?.(c)) {
      await next();
      return;
    }

    const key = keyGenerator(c);

    // Check if already limited (before incrementing)
    if (limiter.isLimited(key, config)) {
      const info = limiter.peek(key, config);
      return sendRateLimitResponse(c, info, config);
    }

    // Process request and increment counter
    await next();

    // Add rate limit headers to response
    const info = limiter.check(key, config);
    setRateLimitHeaders(c, info);
  };
}

/**
 * Create rate limiting middleware that checks before processing.
 * This version rejects immediately if limit is exceeded.
 *
 * Use this for endpoints where you want to reject before any processing.
 */
export function strictRateLimitMiddleware(
  config: RateLimitConfig,
  limiter: InMemoryRateLimiter = globalRateLimiter,
) {
  const keyGenerator = config.keyGenerator ?? byIP;

  return async (c: Context, next: Next) => {
    // Check if this request should be skipped
    if (config.skip?.(c)) {
      await next();
      return;
    }

    const key = keyGenerator(c);

    // Check and increment atomically
    const info = limiter.check(key, config);

    if (info.exceeded) {
      return sendRateLimitResponse(c, info, config);
    }

    // Add headers and continue
    setRateLimitHeaders(c, info);
    await next();
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Set rate limit headers on the response.
 */
function setRateLimitHeaders(c: Context, info: RateLimitInfo): void {
  c.header("X-RateLimit-Limit", String(info.limit));
  c.header("X-RateLimit-Remaining", String(info.remaining));
  c.header("X-RateLimit-Reset", String(info.reset));
}

/**
 * Send a 429 rate limit exceeded response.
 */
function sendRateLimitResponse(
  c: Context,
  info: RateLimitInfo,
  config: RateLimitConfig,
) {
  const requestId = getCorrelationId();
  const retryAfter = Math.max(0, info.reset - Math.ceil(Date.now() / 1000));

  // Set headers
  c.header("X-RateLimit-Limit", String(info.limit));
  c.header("X-RateLimit-Remaining", "0");
  c.header("X-RateLimit-Reset", String(info.reset));
  c.header("Retry-After", String(retryAfter));

  const message = config.message ?? "Rate limit exceeded. Please slow down.";

  return c.json(
    wrapError({
      code: "RATE_LIMIT_EXCEEDED",
      message,
      requestId,
      severity: "retry",
      hint: `You are sending requests too fast. Wait ${retryAfter} seconds before retrying.`,
      details: {
        limit: info.limit,
        windowMs: config.windowMs,
        retryAfter,
        reset: new Date(info.reset * 1000).toISOString(),
      },
    }),
    429,
  );
}

// ============================================================================
// Preset Configurations
// ============================================================================

/**
 * Standard rate limit: 100 requests per minute.
 */
export const STANDARD_RATE_LIMIT: RateLimitConfig = {
  limit: 100,
  windowMs: 60_000,
  keyGenerator: byIP,
};

/**
 * Strict rate limit: 30 requests per minute.
 * For expensive operations like spawning agents.
 */
export const STRICT_RATE_LIMIT: RateLimitConfig = {
  limit: 30,
  windowMs: 60_000,
  keyGenerator: byAPIKey,
};

/**
 * Relaxed rate limit: 300 requests per minute.
 * For read-heavy endpoints.
 */
export const RELAXED_RATE_LIMIT: RateLimitConfig = {
  limit: 300,
  windowMs: 60_000,
  keyGenerator: byIP,
};

/**
 * Burst rate limit: 20 requests per 10 seconds.
 * For protecting against burst traffic.
 */
export const BURST_RATE_LIMIT: RateLimitConfig = {
  limit: 20,
  windowMs: 10_000,
  keyGenerator: byIP,
};

// ============================================================================
// Exports for Testing
// ============================================================================

export { globalRateLimiter };
