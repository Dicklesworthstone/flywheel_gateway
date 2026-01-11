/**
 * Tests for agent routes.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { agents as agentRoutes } from "../routes/agents";

describe("Agent Routes", () => {
  const app = new Hono().route("/agents", agentRoutes);

  describe("GET /agents", () => {
    test("returns list of agents", async () => {
      const res = await app.request("/agents");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.agents).toBeDefined();
      expect(Array.isArray(body.agents)).toBe(true);
    });

    test("returns pagination info", async () => {
      const res = await app.request("/agents");
      const body = await res.json();

      expect(body.pagination).toBeDefined();
      expect(typeof body.pagination.hasMore).toBe("boolean");
    });
  });

  describe("POST /agents - validation", () => {
    test("rejects empty workingDirectory", async () => {
      const res = await app.request("/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workingDirectory: "" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    test("rejects missing workingDirectory", async () => {
      const res = await app.request("/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    test("rejects invalid timeout", async () => {
      const res = await app.request("/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workingDirectory: "/tmp",
          timeout: 100, // Too low, minimum is 1000
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /agents/:id", () => {
    test("returns 404 for non-existent agent", async () => {
      const res = await app.request("/agents/nonexistent-agent-id");

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe("AGENT_NOT_FOUND");
    });
  });

  describe("POST /agents/:id/send", () => {
    test("returns 404 for non-existent agent", async () => {
      const res = await app.request("/agents/nonexistent-agent/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "user", content: "hello" }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("AGENT_NOT_FOUND");
    });
  });

  describe("POST /agents/:id/interrupt", () => {
    test("returns 404 for non-existent agent", async () => {
      const res = await app.request("/agents/nonexistent-agent/interrupt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signal: "SIGINT" }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /agents/:id", () => {
    test("returns 404 for non-existent agent", async () => {
      const res = await app.request("/agents/nonexistent-agent", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /agents/:id/output", () => {
    test("returns 404 for non-existent agent", async () => {
      const res = await app.request("/agents/nonexistent-agent/output");

      expect(res.status).toBe(404);
    });
  });

  describe("GET /agents/:id/state", () => {
    test("returns 404 for non-existent agent", async () => {
      const res = await app.request("/agents/nonexistent-agent/state");

      expect(res.status).toBe(404);
    });
  });
});
