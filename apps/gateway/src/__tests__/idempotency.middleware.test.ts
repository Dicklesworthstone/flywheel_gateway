/**
 * Tests for the Idempotency Middleware.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  clearIdempotencyStore,
  deleteIdempotencyRecord,
  getIdempotencyRecord,
  getIdempotencyStats,
  idempotencyMiddleware,
  pruneExpiredRecords,
  setIdempotencyRecord,
} from "../middleware/idempotency";

describe("Idempotency Middleware", () => {
  beforeEach(() => {
    clearIdempotencyStore();
  });

  describe("basic functionality", () => {
    test("passes through requests without idempotency key", async () => {
      const app = new Hono();
      app.use("*", idempotencyMiddleware());
      app.post("/test", (c) => c.json({ success: true }));

      const res = await app.request("/test", { method: "POST" });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
    });

    test("caches response with idempotency key", async () => {
      let callCount = 0;
      const app = new Hono();
      app.use("*", idempotencyMiddleware());
      app.post("/test", (c) => {
        callCount++;
        return c.json({ count: callCount });
      });

      const key = crypto.randomUUID();

      // First request
      const res1 = await app.request("/test", {
        method: "POST",
        headers: { "Idempotency-Key": key },
      });

      expect(res1.status).toBe(200);
      expect(await res1.json()).toEqual({ count: 1 });
      expect(callCount).toBe(1);

      // Second request with same key - should return cached response
      const res2 = await app.request("/test", {
        method: "POST",
        headers: { "Idempotency-Key": key },
      });

      expect(res2.status).toBe(200);
      expect(await res2.json()).toEqual({ count: 1 });
      expect(callCount).toBe(1); // Handler not called again
      expect(res2.headers.get("X-Idempotent-Replayed")).toBe("true");
    });

    test("scopes cache by auth context when present", async () => {
      let callCount = 0;
      const app = new Hono();

      // Simulate auth middleware populating c.set("auth", ...)
      app.use("*", async (c, next) => {
        const userId = c.req.header("X-Test-User") ?? "anon";
        c.set("auth", {
          userId,
          workspaceIds: [`ws_${userId}`],
          isAdmin: false,
        });
        await next();
      });

      app.use("*", idempotencyMiddleware());
      app.post("/test", () => {
        callCount++;
        return Response.json({ count: callCount });
      });

      const key = crypto.randomUUID();

      const resUserA1 = await app.request("/test", {
        method: "POST",
        headers: { "Idempotency-Key": key, "X-Test-User": "user_a" },
      });
      expect(await resUserA1.json()).toEqual({ count: 1 });

      const resUserB1 = await app.request("/test", {
        method: "POST",
        headers: { "Idempotency-Key": key, "X-Test-User": "user_b" },
      });
      expect(await resUserB1.json()).toEqual({ count: 2 });

      const resUserA2 = await app.request("/test", {
        method: "POST",
        headers: { "Idempotency-Key": key, "X-Test-User": "user_a" },
      });
      expect(await resUserA2.json()).toEqual({ count: 1 });
      expect(resUserA2.headers.get("X-Idempotent-Replayed")).toBe("true");

      expect(callCount).toBe(2);
    });

    test("different keys execute handler separately", async () => {
      let callCount = 0;
      const app = new Hono();
      app.use("*", idempotencyMiddleware());
      app.post("/test", (c) => {
        callCount++;
        return c.json({ count: callCount });
      });

      const key1 = crypto.randomUUID();
      const key2 = crypto.randomUUID();

      const res1 = await app.request("/test", {
        method: "POST",
        headers: { "Idempotency-Key": key1 },
      });
      const res2 = await app.request("/test", {
        method: "POST",
        headers: { "Idempotency-Key": key2 },
      });

      expect(await res1.json()).toEqual({ count: 1 });
      expect(await res2.json()).toEqual({ count: 2 });
      expect(callCount).toBe(2);
    });
  });

  describe("method filtering", () => {
    test("only applies to POST, PUT, PATCH by default", async () => {
      let callCount = 0;
      const app = new Hono();
      app.use("*", idempotencyMiddleware());
      app.get("/test", (c) => {
        callCount++;
        return c.json({ count: callCount });
      });

      const key = crypto.randomUUID();

      // GET requests should not use idempotency
      await app.request("/test", {
        method: "GET",
        headers: { "Idempotency-Key": key },
      });
      await app.request("/test", {
        method: "GET",
        headers: { "Idempotency-Key": key },
      });

      expect(callCount).toBe(2); // Called twice
    });

    test("PUT requests are idempotent", async () => {
      let callCount = 0;
      const app = new Hono();
      app.use("*", idempotencyMiddleware());
      app.put("/test", (c) => {
        callCount++;
        return c.json({ count: callCount });
      });

      const key = crypto.randomUUID();

      await app.request("/test", {
        method: "PUT",
        headers: { "Idempotency-Key": key },
      });
      await app.request("/test", {
        method: "PUT",
        headers: { "Idempotency-Key": key },
      });

      expect(callCount).toBe(1);
    });

    test("PATCH requests are idempotent", async () => {
      let callCount = 0;
      const app = new Hono();
      app.use("*", idempotencyMiddleware());
      app.patch("/test", (c) => {
        callCount++;
        return c.json({ count: callCount });
      });

      const key = crypto.randomUUID();

      await app.request("/test", {
        method: "PATCH",
        headers: { "Idempotency-Key": key },
      });
      await app.request("/test", {
        method: "PATCH",
        headers: { "Idempotency-Key": key },
      });

      expect(callCount).toBe(1);
    });
  });

  describe("fingerprint validation", () => {
    test("rejects reused key with different body", async () => {
      const app = new Hono();
      app.use("*", idempotencyMiddleware());
      app.post("/test", async (c) => {
        const body = await c.req.json();
        return c.json({ received: body });
      });

      const key = crypto.randomUUID();

      // First request
      await app.request("/test", {
        method: "POST",
        headers: {
          "Idempotency-Key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ data: "first" }),
      });

      // Second request with same key but different body
      const res2 = await app.request("/test", {
        method: "POST",
        headers: {
          "Idempotency-Key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ data: "second" }),
      });

      expect(res2.status).toBe(422);
      const body = await res2.json();
      expect(body.error.code).toBe("IDEMPOTENCY_KEY_MISMATCH");
    });

    test("rejects reused key with different path", async () => {
      const app = new Hono();
      app.use("*", idempotencyMiddleware());
      app.post("/test1", (c) => c.json({ path: "test1" }));
      app.post("/test2", (c) => c.json({ path: "test2" }));

      const key = crypto.randomUUID();

      await app.request("/test1", {
        method: "POST",
        headers: { "Idempotency-Key": key },
      });

      const res2 = await app.request("/test2", {
        method: "POST",
        headers: { "Idempotency-Key": key },
      });

      expect(res2.status).toBe(422);
    });
  });

  describe("key validation", () => {
    test("rejects key that is too short", async () => {
      const app = new Hono();
      app.use("*", idempotencyMiddleware());
      app.post("/test", (c) => c.json({ success: true }));

      const res = await app.request("/test", {
        method: "POST",
        headers: { "Idempotency-Key": "short" },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_IDEMPOTENCY_KEY");
    });

    test("accepts valid UUID key", async () => {
      const app = new Hono();
      app.use("*", idempotencyMiddleware());
      app.post("/test", (c) => c.json({ success: true }));

      const res = await app.request("/test", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });

      expect(res.status).toBe(200);
    });
  });

  describe("configuration", () => {
    test("custom header name", async () => {
      let callCount = 0;
      const app = new Hono();
      app.use("*", idempotencyMiddleware({ headerName: "X-Request-Id" }));
      app.post("/test", (c) => {
        callCount++;
        return c.json({ count: callCount });
      });

      const key = crypto.randomUUID();

      await app.request("/test", {
        method: "POST",
        headers: { "X-Request-Id": key },
      });
      await app.request("/test", {
        method: "POST",
        headers: { "X-Request-Id": key },
      });

      expect(callCount).toBe(1);
    });

    test("custom methods", async () => {
      let callCount = 0;
      const app = new Hono();
      app.use("*", idempotencyMiddleware({ methods: ["DELETE"] }));
      app.delete("/test", (c) => {
        callCount++;
        return c.json({ count: callCount });
      });

      const key = crypto.randomUUID();

      await app.request("/test", {
        method: "DELETE",
        headers: { "Idempotency-Key": key },
      });
      await app.request("/test", {
        method: "DELETE",
        headers: { "Idempotency-Key": key },
      });

      expect(callCount).toBe(1);
    });

    test("excludePaths", async () => {
      let callCount = 0;
      const app = new Hono();
      app.use("*", idempotencyMiddleware({ excludePaths: ["/health"] }));
      app.post("/health", (c) => {
        callCount++;
        return c.json({ count: callCount });
      });

      const key = crypto.randomUUID();

      await app.request("/health", {
        method: "POST",
        headers: { "Idempotency-Key": key },
      });
      await app.request("/health", {
        method: "POST",
        headers: { "Idempotency-Key": key },
      });

      expect(callCount).toBe(2); // Not cached
    });
  });

  describe("store operations", () => {
    test("getIdempotencyRecord returns undefined for missing key", () => {
      const record = getIdempotencyRecord("nonexistent");
      expect(record).toBeUndefined();
    });

    test("setIdempotencyRecord and getIdempotencyRecord", () => {
      const record = {
        key: "test-key",
        method: "POST",
        path: "/test",
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: '{"success":true}',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        fingerprint: "abc123",
      };

      setIdempotencyRecord(record);
      const retrieved = getIdempotencyRecord("test-key");

      expect(retrieved).toEqual(record);
    });

    test("getIdempotencyRecord returns undefined for expired records", () => {
      const record = {
        key: "expired-key",
        method: "POST",
        path: "/test",
        status: 200,
        headers: {},
        body: "{}",
        createdAt: new Date(Date.now() - 120000),
        expiresAt: new Date(Date.now() - 60000), // Already expired
        fingerprint: "abc123",
      };

      setIdempotencyRecord(record);
      const retrieved = getIdempotencyRecord("expired-key");

      expect(retrieved).toBeUndefined();
    });

    test("deleteIdempotencyRecord removes record", () => {
      const record = {
        key: "delete-test",
        method: "POST",
        path: "/test",
        status: 200,
        headers: {},
        body: "{}",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        fingerprint: "abc123",
      };

      setIdempotencyRecord(record);
      expect(getIdempotencyRecord("delete-test")).toBeDefined();

      const deleted = deleteIdempotencyRecord("delete-test");
      expect(deleted).toBe(true);
      expect(getIdempotencyRecord("delete-test")).toBeUndefined();
    });

    test("pruneExpiredRecords removes expired entries", () => {
      // Add expired record
      setIdempotencyRecord({
        key: "expired",
        method: "POST",
        path: "/test",
        status: 200,
        headers: {},
        body: "{}",
        createdAt: new Date(Date.now() - 120000),
        expiresAt: new Date(Date.now() - 60000),
        fingerprint: "abc123",
      });

      // Add valid record
      setIdempotencyRecord({
        key: "valid",
        method: "POST",
        path: "/test",
        status: 200,
        headers: {},
        body: "{}",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        fingerprint: "def456",
      });

      const pruned = pruneExpiredRecords();

      expect(pruned).toBe(1);
      expect(getIdempotencyStats().totalRecords).toBe(1);
    });

    test("getIdempotencyStats returns correct stats", () => {
      setIdempotencyRecord({
        key: "stat1",
        method: "POST",
        path: "/test",
        status: 200,
        headers: {},
        body: "{}",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        fingerprint: "abc123",
      });

      setIdempotencyRecord({
        key: "stat2",
        method: "POST",
        path: "/test",
        status: 200,
        headers: {},
        body: "{}",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        fingerprint: "def456",
      });

      const stats = getIdempotencyStats();

      expect(stats.totalRecords).toBe(2);
      expect(stats.pendingRequests).toBe(0);
      expect(stats.oldestRecord).toBeDefined();
      expect(stats.newestRecord).toBeDefined();
    });
  });

  describe("response caching", () => {
    test("caches 2xx responses", async () => {
      let callCount = 0;
      const app = new Hono();
      app.use("*", idempotencyMiddleware());
      app.post("/test", (c) => {
        callCount++;
        return c.json({ success: true }, 201);
      });

      const key = crypto.randomUUID();

      const res1 = await app.request("/test", {
        method: "POST",
        headers: { "Idempotency-Key": key },
      });
      const res2 = await app.request("/test", {
        method: "POST",
        headers: { "Idempotency-Key": key },
      });

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(callCount).toBe(1);
    });

    test("caches 4xx responses", async () => {
      let callCount = 0;
      const app = new Hono();
      app.use("*", idempotencyMiddleware());
      app.post("/test", (c) => {
        callCount++;
        return c.json({ error: "bad request" }, 400);
      });

      const key = crypto.randomUUID();

      const res1 = await app.request("/test", {
        method: "POST",
        headers: { "Idempotency-Key": key },
      });
      const res2 = await app.request("/test", {
        method: "POST",
        headers: { "Idempotency-Key": key },
      });

      expect(res1.status).toBe(400);
      expect(res2.status).toBe(400);
      expect(callCount).toBe(1);
    });

    test("does not cache 5xx responses", async () => {
      let callCount = 0;
      const app = new Hono();
      app.use("*", idempotencyMiddleware());
      app.post("/test", (c) => {
        callCount++;
        if (callCount === 1) {
          return c.json({ error: "server error" }, 500);
        }
        return c.json({ success: true }, 200);
      });

      const key = crypto.randomUUID();

      const res1 = await app.request("/test", {
        method: "POST",
        headers: { "Idempotency-Key": key },
      });
      const res2 = await app.request("/test", {
        method: "POST",
        headers: { "Idempotency-Key": key },
      });

      expect(res1.status).toBe(500);
      expect(res2.status).toBe(200); // Retry succeeded
      expect(callCount).toBe(2);
    });

    test("preserves content-type header", async () => {
      const app = new Hono();
      app.use("*", idempotencyMiddleware());
      app.post("/test", (c) => c.json({ success: true }));

      const key = crypto.randomUUID();

      await app.request("/test", {
        method: "POST",
        headers: { "Idempotency-Key": key },
      });

      const res2 = await app.request("/test", {
        method: "POST",
        headers: { "Idempotency-Key": key },
      });

      expect(res2.headers.get("Content-Type")).toContain("application/json");
    });
  });
});
