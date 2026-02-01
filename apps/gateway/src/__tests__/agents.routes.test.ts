/**
 * Tests for agent routes.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { agents as agentRoutes } from "../routes/agents";

describe("Agent Routes", () => {
  const app = new Hono().route("/agents", agentRoutes);

  describe("GET /agents", () => {
    test("returns list of agents with canonical envelope", async () => {
      const res = await app.request("/agents");

      expect(res.status).toBe(200);
      const body = await res.json();
      // Canonical envelope format
      expect(body.object).toBe("list");
      expect(body.data).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.requestId).toBeDefined();
      expect(body.timestamp).toBeDefined();
      expect(body.url).toBe("/agents");
    });

    test("returns pagination info in canonical envelope", async () => {
      const res = await app.request("/agents");
      const body = await res.json();

      // Canonical list envelope has hasMore at top level
      expect(typeof body.hasMore).toBe("boolean");
    });
  });

  describe("GET /agents/health-scores", () => {
    test("returns list envelope", async () => {
      const res = await app.request("/agents/health-scores");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.object).toBe("list");
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.requestId).toBeDefined();
      expect(body.timestamp).toBeDefined();
      expect(body.url).toBe("/agents/health-scores");
    });
  });

  describe("GET /agents/:id/health-score", () => {
    test("returns 404 for non-existent agent", async () => {
      const res = await app.request("/agents/nonexistent-agent/health-score");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.object).toBe("error");
      expect(body.error.code).toBe("AGENT_NOT_FOUND");
    });
  });

  describe("POST /agents - validation", () => {
    test("rejects empty workingDirectory with canonical error envelope", async () => {
      const res = await app.request("/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workingDirectory: "" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      // Canonical error envelope format
      expect(body.object).toBe("error");
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe("VALIDATION_FAILED");
      expect(body.requestId).toBeDefined();
      expect(body.timestamp).toBeDefined();
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
    test("returns 404 for non-existent agent with canonical error envelope", async () => {
      const res = await app.request("/agents/nonexistent-agent-id");

      expect(res.status).toBe(404);
      const body = await res.json();
      // Canonical error envelope format
      expect(body.object).toBe("error");
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe("AGENT_NOT_FOUND");
      expect(body.error.severity).toBe("terminal");
      expect(body.error.hint).toBeDefined();
      expect(body.requestId).toBeDefined();
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
