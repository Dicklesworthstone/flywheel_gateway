/**
 * Tests for the Rate Limit Middleware.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import type { Context } from "hono";
import { Hono } from "hono";
import {
  byAPIKey,
  byIP,
  byUser,
  byWorkspace,
  compositeKey,
  globalRateLimiter,
  InMemoryRateLimiter,
  type RateLimitConfig,
  RELAXED_RATE_LIMIT,
  rateLimitMiddleware,
  STANDARD_RATE_LIMIT,
  STRICT_RATE_LIMIT,
  strictRateLimitMiddleware,
  withPath,
} from "../middleware/rate-limit";

/** Test-specific context variables */
type TestEnv = { Variables: { userId: string; workspaceId: string } };

describe("Rate Limit Middleware", () => {
  beforeEach(() => {
    globalRateLimiter.clear();
  });

  describe("InMemoryRateLimiter", () => {
    test("tracks request count per key", () => {
      const limiter = new InMemoryRateLimiter();
      const config: RateLimitConfig = { limit: 5, windowMs: 60_000 };

      const info1 = limiter.check("test-key", config);
      expect(info1.remaining).toBe(4);
      expect(info1.exceeded).toBe(false);

      const info2 = limiter.check("test-key", config);
      expect(info2.remaining).toBe(3);
      expect(info2.exceeded).toBe(false);
    });

    test("marks exceeded when limit reached", () => {
      const limiter = new InMemoryRateLimiter();
      const config: RateLimitConfig = { limit: 3, windowMs: 60_000 };

      limiter.check("test-key", config); // 1
      limiter.check("test-key", config); // 2
      limiter.check("test-key", config); // 3

      const info = limiter.check("test-key", config); // 4 (exceeds limit of 3)
      expect(info.exceeded).toBe(true);
      expect(info.remaining).toBe(0);
    });

    test("different keys are independent", () => {
      const limiter = new InMemoryRateLimiter();
      const config: RateLimitConfig = { limit: 5, windowMs: 60_000 };

      limiter.check("key-a", config);
      limiter.check("key-a", config);

      const infoA = limiter.check("key-a", config);
      const infoB = limiter.check("key-b", config);

      expect(infoA.remaining).toBe(2); // 5 - 3
      expect(infoB.remaining).toBe(4); // 5 - 1
    });

    test("peek does not increment counter", () => {
      const limiter = new InMemoryRateLimiter();
      const config: RateLimitConfig = { limit: 5, windowMs: 60_000 };

      limiter.check("test-key", config);
      const peek1 = limiter.peek("test-key", config);
      const peek2 = limiter.peek("test-key", config);

      expect(peek1.remaining).toBe(4);
      expect(peek2.remaining).toBe(4); // Same because peek doesn't increment
    });

    test("isLimited returns true when at limit", () => {
      const limiter = new InMemoryRateLimiter();
      const config: RateLimitConfig = { limit: 2, windowMs: 60_000 };

      expect(limiter.isLimited("test-key", config)).toBe(false);
      limiter.check("test-key", config);
      expect(limiter.isLimited("test-key", config)).toBe(false);
      limiter.check("test-key", config);
      expect(limiter.isLimited("test-key", config)).toBe(true);
    });

    test("cleanup removes expired entries", () => {
      const limiter = new InMemoryRateLimiter();
      // Use very short window for test
      const config: RateLimitConfig = { limit: 5, windowMs: 1 };

      limiter.check("test-key", config);
      expect(limiter.size()).toBe(1);

      // Wait for window to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const removed = limiter.cleanup();
          expect(removed).toBe(1);
          expect(limiter.size()).toBe(0);
          resolve();
        }, 10);
      });
    });

    test("clear removes all entries", () => {
      const limiter = new InMemoryRateLimiter();
      const config: RateLimitConfig = { limit: 5, windowMs: 60_000 };

      limiter.check("key-1", config);
      limiter.check("key-2", config);
      limiter.check("key-3", config);

      expect(limiter.size()).toBe(3);
      limiter.clear();
      expect(limiter.size()).toBe(0);
    });

    test("reset timestamp is in seconds", () => {
      const limiter = new InMemoryRateLimiter();
      const config: RateLimitConfig = { limit: 5, windowMs: 60_000 };

      const info = limiter.check("test-key", config);
      const nowSeconds = Math.ceil(Date.now() / 1000);

      // Reset should be approximately 60 seconds in the future
      expect(info.reset).toBeGreaterThan(nowSeconds);
      expect(info.reset).toBeLessThanOrEqual(nowSeconds + 61);
    });

    test("tryConsume atomically checks and increments", () => {
      const limiter = new InMemoryRateLimiter();
      const config: RateLimitConfig = { limit: 3, windowMs: 60_000 };

      // First request - should be allowed
      const result1 = limiter.tryConsume("test-key", config);
      expect(result1.allowed).toBe(true);
      expect(result1.info.remaining).toBe(2);
      expect(result1.info.exceeded).toBe(false);

      // Second request - should be allowed
      const result2 = limiter.tryConsume("test-key", config);
      expect(result2.allowed).toBe(true);
      expect(result2.info.remaining).toBe(1);
      expect(result2.info.exceeded).toBe(false);

      // Third request - should be allowed (at limit)
      const result3 = limiter.tryConsume("test-key", config);
      expect(result3.allowed).toBe(true);
      expect(result3.info.remaining).toBe(0);
      expect(result3.info.exceeded).toBe(false);

      // Fourth request - should be rejected
      const result4 = limiter.tryConsume("test-key", config);
      expect(result4.allowed).toBe(false);
      expect(result4.info.remaining).toBe(0);
      expect(result4.info.exceeded).toBe(true);
    });

    test("tryConsume does not increment counter when rejected", () => {
      const limiter = new InMemoryRateLimiter();
      const config: RateLimitConfig = { limit: 2, windowMs: 60_000 };

      // Consume all slots
      limiter.tryConsume("test-key", config); // 1
      limiter.tryConsume("test-key", config); // 2

      // Try to consume more - should be rejected
      const result1 = limiter.tryConsume("test-key", config);
      expect(result1.allowed).toBe(false);

      // Counter should still be at 2, not incremented
      const peek = limiter.peek("test-key", config);
      expect(peek.remaining).toBe(0);

      // Multiple rejections should not increment
      limiter.tryConsume("test-key", config);
      limiter.tryConsume("test-key", config);
      limiter.tryConsume("test-key", config);

      // Still at same count
      const peek2 = limiter.peek("test-key", config);
      expect(peek2.remaining).toBe(0);
    });

    test("tryConsume resets on window expiry", () => {
      const limiter = new InMemoryRateLimiter();
      // Very short window for testing
      const config: RateLimitConfig = { limit: 1, windowMs: 1 };

      const result1 = limiter.tryConsume("test-key", config);
      expect(result1.allowed).toBe(true);

      const result2 = limiter.tryConsume("test-key", config);
      expect(result2.allowed).toBe(false);

      // Wait for window to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const result3 = limiter.tryConsume("test-key", config);
          expect(result3.allowed).toBe(true);
          resolve();
        }, 10);
      });
    });

    test("tryConsume handles different keys independently", () => {
      const limiter = new InMemoryRateLimiter();
      const config: RateLimitConfig = { limit: 1, windowMs: 60_000 };

      const resultA = limiter.tryConsume("key-a", config);
      expect(resultA.allowed).toBe(true);

      // key-a is now limited
      const resultA2 = limiter.tryConsume("key-a", config);
      expect(resultA2.allowed).toBe(false);

      // key-b should still be allowed
      const resultB = limiter.tryConsume("key-b", config);
      expect(resultB.allowed).toBe(true);
    });
  });

  describe("Key Generators", () => {
    test("byIP extracts from X-Forwarded-For header", async () => {
      const app = new Hono();
      app.get("/test", (c) => c.text(byIP(c)));

      const res = await app.request("/test", {
        headers: { "X-Forwarded-For": "1.2.3.4, 5.6.7.8" },
      });
      expect(await res.text()).toBe("ip:1.2.3.4");
    });

    test("byIP extracts from X-Real-IP header", async () => {
      const app = new Hono();
      app.get("/test", (c) => c.text(byIP(c)));

      const res = await app.request("/test", {
        headers: { "X-Real-IP": "10.0.0.1" },
      });
      expect(await res.text()).toBe("ip:10.0.0.1");
    });

    test("byIP falls back to unknown", async () => {
      const app = new Hono();
      app.get("/test", (c) => c.text(byIP(c)));

      const res = await app.request("/test");
      expect(await res.text()).toBe("ip:unknown");
    });

    test("byAPIKey prefers apiKeyId from auth context", async () => {
      const app = new Hono();
      app.use("*", (c, next) => {
        (c.set as (key: string, value: unknown) => void)("auth", {
          apiKeyId: "api_key_123",
          workspaceIds: [],
          isAdmin: false,
        });
        return next();
      });
      app.get("/test", (c) => c.text(byAPIKey(c)));

      const res = await app.request("/test");
      expect(await res.text()).toBe("key:api:api_key_123");
    });

    test("byAPIKey falls back to IP", async () => {
      const app = new Hono();
      app.get("/test", (c) => c.text(byAPIKey(c)));

      const res = await app.request("/test", {
        headers: { "X-Real-IP": "192.168.1.1" },
      });
      expect(await res.text()).toBe("ip:192.168.1.1");
    });

    test("byUser extracts from context", async () => {
      const app = new Hono<TestEnv>();
      app.use("*", (c, next) => {
        c.set("userId", "user_123");
        return next();
      });
      app.get("/test", (c) => c.text(byUser(c as unknown as Context)));

      const res = await app.request("/test");
      expect(await res.text()).toBe("user:user_123");
    });

    test("byUser falls back to API key identity when no userId", async () => {
      const app = new Hono();
      app.use("*", (c, next) => {
        (c.set as (key: string, value: unknown) => void)("auth", {
          apiKeyId: "api_key_fallback",
          workspaceIds: [],
          isAdmin: false,
        });
        return next();
      });
      app.get("/test", (c) => c.text(byUser(c)));

      const res = await app.request("/test");
      expect(await res.text()).toBe("key:api:api_key_fallback");
    });

    test("byWorkspace extracts from context", async () => {
      const app = new Hono<TestEnv>();
      app.use("*", (c, next) => {
        (c.set as (key: string, value: unknown) => void)(
          "workspaceId",
          "ws_456",
        );
        return next();
      });
      app.get("/test", (c) => c.text(byWorkspace(c as unknown as Context)));

      const res = await app.request("/test");
      expect(await res.text()).toBe("ws:ws_456");
    });

    test("compositeKey combines multiple generators", async () => {
      const app = new Hono<TestEnv>();
      app.use("*", (c, next) => {
        (c.set as (key: string, value: unknown) => void)("userId", "user_abc");
        return next();
      });
      app.get("/test", (c) =>
        c.text(compositeKey(byUser, byIP)(c as unknown as Context)),
      );

      const res = await app.request("/test", {
        headers: { "X-Real-IP": "10.0.0.5" },
      });
      expect(await res.text()).toBe("user:user_abc:ip:10.0.0.5");
    });

    test("withPath includes request path", async () => {
      const app = new Hono();
      app.get("/api/users", (c) => c.text(withPath(byIP)(c)));

      const res = await app.request("/api/users", {
        headers: { "X-Real-IP": "1.1.1.1" },
      });
      expect(await res.text()).toBe("ip:1.1.1.1:/api/users");
    });
  });

  describe("rateLimitMiddleware", () => {
    test("adds rate limit headers to response", async () => {
      const app = new Hono();
      app.use(
        "*",
        rateLimitMiddleware({
          limit: 100,
          windowMs: 60_000,
        }),
      );
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("/test", {
        headers: { "X-Real-IP": "1.2.3.4" },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("X-RateLimit-Limit")).toBe("100");
      expect(res.headers.get("X-RateLimit-Remaining")).toBe("99");
      expect(res.headers.get("X-RateLimit-Reset")).toBeDefined();
    });

    test("decrements remaining with each request", async () => {
      const app = new Hono();
      app.use(
        "*",
        rateLimitMiddleware({
          limit: 10,
          windowMs: 60_000,
        }),
      );
      app.get("/test", (c) => c.json({ ok: true }));

      const headers = { "X-Real-IP": "test-client" };

      const res1 = await app.request("/test", { headers });
      const res2 = await app.request("/test", { headers });
      const res3 = await app.request("/test", { headers });

      expect(res1.headers.get("X-RateLimit-Remaining")).toBe("9");
      expect(res2.headers.get("X-RateLimit-Remaining")).toBe("8");
      expect(res3.headers.get("X-RateLimit-Remaining")).toBe("7");
    });

    test("returns 429 when limit exceeded", async () => {
      const app = new Hono();
      app.use(
        "*",
        rateLimitMiddleware({
          limit: 3,
          windowMs: 60_000,
        }),
      );
      app.get("/test", (c) => c.json({ ok: true }));

      const headers = { "X-Real-IP": "rate-limited-client" };

      await app.request("/test", { headers });
      await app.request("/test", { headers });
      await app.request("/test", { headers });

      const res = await app.request("/test", { headers });

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBeDefined();
      expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");

      const body = await res.json();
      expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(body.error.details).toBeDefined();
      expect(body.error.details.limit).toBe(3);
    });

    test("429 response includes helpful hints", async () => {
      const app = new Hono();
      app.use(
        "*",
        rateLimitMiddleware({
          limit: 1,
          windowMs: 60_000,
        }),
      );
      app.get("/test", (c) => c.json({ ok: true }));

      const headers = { "X-Real-IP": "hint-test" };

      await app.request("/test", { headers });
      const res = await app.request("/test", { headers });

      const body = await res.json();
      expect(body.error.severity).toBe("retry");
      expect(body.error.hint).toContain("too fast");
    });

    test("skip function bypasses rate limiting", async () => {
      const app = new Hono();
      app.use(
        "*",
        rateLimitMiddleware({
          limit: 1,
          windowMs: 60_000,
          skip: (c) => c.req.path === "/health",
        }),
      );
      app.get("/health", (c) => c.json({ ok: true }));
      app.get("/other", (c) => c.json({ ok: true }));

      const headers = { "X-Real-IP": "skip-test" };

      // Health endpoint should not be rate limited
      const res1 = await app.request("/health", { headers });
      const res2 = await app.request("/health", { headers });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res2.headers.get("X-RateLimit-Limit")).toBeNull(); // No headers

      // Other endpoint should be rate limited
      await app.request("/other", { headers });
      const res3 = await app.request("/other", { headers });
      expect(res3.status).toBe(429);
    });

    test("custom message in 429 response", async () => {
      const app = new Hono();
      app.use(
        "*",
        rateLimitMiddleware({
          limit: 1,
          windowMs: 60_000,
          message: "Custom rate limit message",
        }),
      );
      app.get("/test", (c) => c.json({ ok: true }));

      const headers = { "X-Real-IP": "custom-msg-test" };

      await app.request("/test", { headers });
      const res = await app.request("/test", { headers });

      const body = await res.json();
      expect(body.error.message).toBe("Custom rate limit message");
    });

    test("different IPs have separate limits", async () => {
      const app = new Hono();
      app.use(
        "*",
        rateLimitMiddleware({
          limit: 2,
          windowMs: 60_000,
        }),
      );
      app.get("/test", (c) => c.json({ ok: true }));

      // Client A uses their limit
      await app.request("/test", { headers: { "X-Real-IP": "client-a" } });
      await app.request("/test", { headers: { "X-Real-IP": "client-a" } });
      const resA = await app.request("/test", {
        headers: { "X-Real-IP": "client-a" },
      });

      // Client B should still have their limit
      const resB = await app.request("/test", {
        headers: { "X-Real-IP": "client-b" },
      });

      expect(resA.status).toBe(429);
      expect(resB.status).toBe(200);
    });
  });

  describe("strictRateLimitMiddleware", () => {
    test("rejects immediately when limit reached", async () => {
      let handlerCalled = 0;
      const app = new Hono();
      app.use(
        "*",
        strictRateLimitMiddleware({
          limit: 2,
          windowMs: 60_000,
        }),
      );
      app.get("/test", (c) => {
        handlerCalled++;
        return c.json({ ok: true });
      });

      const headers = { "X-Real-IP": "strict-test" };

      await app.request("/test", { headers });
      await app.request("/test", { headers });
      const res = await app.request("/test", { headers });

      expect(res.status).toBe(429);
      expect(handlerCalled).toBe(2); // Handler only called twice
    });
  });

  describe("Preset Configurations", () => {
    test("STANDARD_RATE_LIMIT has correct values", () => {
      expect(STANDARD_RATE_LIMIT.limit).toBe(100);
      expect(STANDARD_RATE_LIMIT.windowMs).toBe(60_000);
    });

    test("STRICT_RATE_LIMIT has correct values", () => {
      expect(STRICT_RATE_LIMIT.limit).toBe(30);
      expect(STRICT_RATE_LIMIT.windowMs).toBe(60_000);
    });

    test("RELAXED_RATE_LIMIT has correct values", () => {
      expect(RELAXED_RATE_LIMIT.limit).toBe(300);
      expect(RELAXED_RATE_LIMIT.windowMs).toBe(60_000);
    });
  });

  describe("Concurrent access (race condition fix)", () => {
    test("concurrent requests are properly rate limited with tryConsume", async () => {
      const limiter = new InMemoryRateLimiter();
      const config: RateLimitConfig = { limit: 5, windowMs: 60_000 };

      // Simulate 20 concurrent requests
      const concurrentRequests = 20;
      const results = await Promise.all(
        Array.from({ length: concurrentRequests }, () =>
          Promise.resolve(limiter.tryConsume("concurrent-key", config)),
        ),
      );

      // Exactly 5 should be allowed (the limit)
      const allowedCount = results.filter((r) => r.allowed).length;
      const rejectedCount = results.filter((r) => !r.allowed).length;

      expect(allowedCount).toBe(5);
      expect(rejectedCount).toBe(15);
    });

    test("middleware properly limits concurrent requests", async () => {
      let handlerCallCount = 0;
      const app = new Hono();
      app.use(
        "*",
        rateLimitMiddleware({
          limit: 3,
          windowMs: 60_000,
        }),
      );
      app.get("/test", (c) => {
        handlerCallCount++;
        return c.json({ ok: true });
      });

      const headers = { "X-Real-IP": "concurrent-client" };

      // Fire 10 concurrent requests
      const responses = await Promise.all(
        Array.from({ length: 10 }, () => app.request("/test", { headers })),
      );

      // Exactly 3 should succeed (200), 7 should be rate limited (429)
      const successCount = responses.filter((r) => r.status === 200).length;
      const limitedCount = responses.filter((r) => r.status === 429).length;

      expect(successCount).toBe(3);
      expect(limitedCount).toBe(7);
      expect(handlerCallCount).toBe(3); // Handler should only be called 3 times
    });

    test("strictRateLimitMiddleware also properly limits concurrent requests", async () => {
      let handlerCallCount = 0;
      const app = new Hono();
      app.use(
        "*",
        strictRateLimitMiddleware({
          limit: 3,
          windowMs: 60_000,
        }),
      );
      app.get("/test", (c) => {
        handlerCallCount++;
        return c.json({ ok: true });
      });

      const headers = { "X-Real-IP": "strict-concurrent-client" };

      // Fire 10 concurrent requests
      const responses = await Promise.all(
        Array.from({ length: 10 }, () => app.request("/test", { headers })),
      );

      // Exactly 3 should succeed (200), 7 should be rate limited (429)
      const successCount = responses.filter((r) => r.status === 200).length;
      const limitedCount = responses.filter((r) => r.status === 429).length;

      expect(successCount).toBe(3);
      expect(limitedCount).toBe(7);
      expect(handlerCallCount).toBe(3);
    });

    test("high concurrency burst is properly limited", async () => {
      const app = new Hono();
      app.use(
        "*",
        rateLimitMiddleware({
          limit: 10,
          windowMs: 60_000,
        }),
      );
      app.get("/test", (c) => c.json({ ok: true }));

      const headers = { "X-Real-IP": "burst-client" };

      // Fire 100 concurrent requests (high burst)
      const responses = await Promise.all(
        Array.from({ length: 100 }, () => app.request("/test", { headers })),
      );

      // Exactly 10 should succeed
      const successCount = responses.filter((r) => r.status === 200).length;
      const limitedCount = responses.filter((r) => r.status === 429).length;

      expect(successCount).toBe(10);
      expect(limitedCount).toBe(90);
    });
  });

  describe("Integration scenarios", () => {
    test("per-user-per-endpoint rate limiting", async () => {
      const app = new Hono<TestEnv>();
      app.use("*", (c, next) => {
        (c.set as (key: string, value: unknown) => void)(
          "userId",
          c.req.header("X-User-Id") ?? "anon",
        );
        return next();
      });
      app.use(
        "/api/*",
        rateLimitMiddleware({
          limit: 2,
          windowMs: 60_000,
          keyGenerator: compositeKey(byUser, withPath(byIP)),
        }),
      );
      app.get("/api/resource", (c) => c.json({ ok: true }));

      // User A hits their limit on /api/resource
      await app.request("/api/resource", {
        headers: { "X-User-Id": "user-a" },
      });
      await app.request("/api/resource", {
        headers: { "X-User-Id": "user-a" },
      });
      const resA = await app.request("/api/resource", {
        headers: { "X-User-Id": "user-a" },
      });

      // User B should still have their limit
      const resB = await app.request("/api/resource", {
        headers: { "X-User-Id": "user-b" },
      });

      expect(resA.status).toBe(429);
      expect(resB.status).toBe(200);
    });

    test("multiple rate limits stack", async () => {
      const app = new Hono();

      // Global loose limit
      app.use(
        "*",
        rateLimitMiddleware({
          limit: 100,
          windowMs: 60_000,
          keyGenerator: (c) => `global:${byIP(c)}`,
        }),
      );

      // Tighter limit on specific endpoint
      app.use(
        "/expensive",
        strictRateLimitMiddleware({
          limit: 2,
          windowMs: 60_000,
          keyGenerator: (c) => `expensive:${byIP(c)}`,
        }),
      );

      app.get("/cheap", (c) => c.json({ type: "cheap" }));
      app.get("/expensive", (c) => c.json({ type: "expensive" }));

      const headers = { "X-Real-IP": "stacking-test" };

      // Can still hit cheap endpoint many times
      for (let i = 0; i < 10; i++) {
        const res = await app.request("/cheap", { headers });
        expect(res.status).toBe(200);
      }

      // But expensive is limited
      await app.request("/expensive", { headers });
      await app.request("/expensive", { headers });
      const res = await app.request("/expensive", { headers });
      expect(res.status).toBe(429);
    });
  });
});
