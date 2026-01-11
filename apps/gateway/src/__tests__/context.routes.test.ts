/**
 * Tests for context routes.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { context } from "../routes/context";

describe("Context Routes", () => {
  const app = new Hono().route("/sessions", context);

  describe("POST /sessions/:sessionId/context/build", () => {
    test("builds context pack for session", async () => {
      const res = await app.request("/sessions/test-session/context/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.pack).toBeDefined();
      expect(body.pack.budget).toBeDefined();
      expect(body.pack.sections).toBeDefined();
      expect(body.pack.metadata).toBeDefined();
    });

    test("accepts maxTokens parameter", async () => {
      const res = await app.request("/sessions/test-session/context/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxTokens: 50000 }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.pack.budget.total).toBe(50000);
    });

    test("rejects invalid maxTokens (too low)", async () => {
      const res = await app.request("/sessions/test-session/context/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxTokens: 100 }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_REQUEST");
    });

    test("rejects invalid maxTokens (too high)", async () => {
      const res = await app.request("/sessions/test-session/context/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxTokens: 1000000 }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /sessions/:sessionId/context/preview", () => {
    test("previews context pack for session", async () => {
      const res = await app.request("/sessions/test-session/context/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.preview).toBeDefined();
      expect(body.sessionId).toBe("test-session");
    });
  });

  describe("POST /sessions/:sessionId/context/render", () => {
    test("renders context pack to prompt", async () => {
      const res = await app.request("/sessions/test-session/context/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rendered).toBeDefined();
      expect(typeof body.rendered).toBe("string");
      expect(body.packId).toBeDefined();
      expect(body.tokensUsed).toBeDefined();
    });
  });
});
