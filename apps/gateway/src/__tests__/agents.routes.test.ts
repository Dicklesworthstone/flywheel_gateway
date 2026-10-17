/**
 * Tests for agent routes.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { agents as agentRoutes } from "../routes/agents";
import { _clearAgentsForTest, _registerAgentForTest } from "../services/agent";

describe("Agent Routes", () => {
  const app = new Hono().route("/agents", agentRoutes);

  beforeEach(() => {
    _clearAgentsForTest();
  });

  afterEach(() => {
    _clearAgentsForTest();
  });

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

    test("paginates with a stable opaque cursor (no skip/dup)", async () => {
      const ts = new Date("2025-01-01T00:00:00.000Z");

      _registerAgentForTest({ id: "agent_1000_aaaa", createdAt: ts });
      _registerAgentForTest({ id: "agent_1000_bbbb", createdAt: ts });
      _registerAgentForTest({ id: "agent_1000_cccc", createdAt: ts });
      _registerAgentForTest({
        id: "agent_0900_zzzz",
        createdAt: new Date("2024-12-31T23:59:59.000Z"),
      });

      const page1Res = await app.request("/agents?limit=2");
      expect(page1Res.status).toBe(200);
      const page1 = await page1Res.json();
      expect(page1.data.map((a: { agentId: string }) => a.agentId)).toEqual([
        "agent_1000_cccc",
        "agent_1000_bbbb",
      ]);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBeDefined();
      expect(page1.nextCursor).not.toMatch(/^\\d+$/);

      const cursor = encodeURIComponent(page1.nextCursor as string);
      const page2Res = await app.request(`/agents?limit=2&cursor=${cursor}`);
      expect(page2Res.status).toBe(200);
      const page2 = await page2Res.json();
      expect(page2.data.map((a: { agentId: string }) => a.agentId)).toEqual([
        "agent_1000_aaaa",
        "agent_0900_zzzz",
      ]);
      expect(page2.hasMore).toBe(false);
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

  describe("Driver Registration", () => {
    test("registerDrivers registers sdk, acp, tmux, and ntm drivers", async () => {
      const { getDriverRegistry } = await import("@flywheel/agent-drivers");
      const { registerDrivers } = await import("../config/drivers");

      registerDrivers();
      const registry = getDriverRegistry();

      expect(registry.has("sdk")).toBe(true);
      expect(registry.has("acp")).toBe(true);
      expect(registry.has("tmux")).toBe(true);
      expect(registry.has("ntm")).toBe(true);
    });

    test("POST /agents respects custom provider and model and captureAgentCheckpointState returns live driver history", async () => {
      const { registerDrivers } = await import("../config/drivers");
      const { captureAgentCheckpointState, sendMessage, terminateAgent } =
        await import("../services/agent");

      registerDrivers();

      const agentId = `agent_custom_model_${Date.now()}`;
      const spawnRes = await app.request("/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          workingDirectory: "/data/projects/flywheel_gateway",
          provider: "codex",
          model: "o4-mini",
          driver: "sdk",
          systemPrompt: "Test multi-provider spawn",
        }),
      });

      expect(spawnRes.status).toBe(201);
      const spawnBody = await spawnRes.json();
      expect(spawnBody.data.agentId).toBe(agentId);

      try {
        const getRes = await app.request(`/agents/${agentId}`);
        expect(getRes.status).toBe(200);
        const getBody = await getRes.json();
        expect(getBody.data.config.provider).toBe("codex");
        expect(getBody.data.config.model).toBe("o4-mini");

        await sendMessage(agentId, "user", "Verify checkpoint state capture");
        const checkpointState = await captureAgentCheckpointState(agentId);
        expect(Array.isArray(checkpointState.conversationHistory)).toBe(true);
        expect(checkpointState.conversationHistory.length).toBeGreaterThan(0);
      } finally {
        await terminateAgent(agentId, false).catch(() => {});
      }
    });
  });
});
