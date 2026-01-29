/**
 * Tests for context routes.
 */

import { describe, expect, mock, test } from "bun:test";

// Mock BV service to avoid spawning external commands
mock.module("../services/bv.service", () => ({
  getBvTriage: async () => ({
    triage: {
      recommendations: [
        {
          id: "test-bead-1",
          type: "task",
          title: "Test Task 1",
          description: "A test task description",
          score: 0.9,
          reasons: ["High priority"],
        },
      ],
    },
    data_hash: "mock-hash-123",
  }),
  getBvClient: () => ({
    getTriage: async () => ({ triage: { recommendations: [] }, data_hash: "" }),
    getInsights: async () => ({ insights: {}, data_hash: "" }),
    getPlan: async () => ({ plan: {}, data_hash: "" }),
  }),
  getBvProjectRoot: () => "/mock/project/root",
  clearBvCache: () => {},
}));

// Mock CASS service to avoid external calls
mock.module("../services/cass.service", () => ({
  isCassAvailable: async () => false,
  searchWithTokenBudget: async () => ({
    hits: [],
    total_matches: 0,
    query: "",
  }),
}));

const mockLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  child: () => mockLogger,
};

// Mock correlation middleware
mock.module("../middleware/correlation", () => ({
  getCorrelationId: () => "test-correlation-id",
  getLogger: () => mockLogger,
}));

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
      // Canonical envelope format
      expect(body.object).toBe("context_pack");
      expect(body.data).toBeDefined();
      expect(body.data.budget).toBeDefined();
      expect(body.data.sections).toBeDefined();
      expect(body.data.metadata).toBeDefined();
      expect(body.requestId).toBeDefined();
    });

    test("accepts maxTokens parameter", async () => {
      const res = await app.request("/sessions/test-session/context/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxTokens: 50000 }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      // Canonical envelope format
      expect(body.object).toBe("context_pack");
      expect(body.data.budget.total).toBe(50000);
    });

    test("rejects invalid maxTokens (too low)", async () => {
      const res = await app.request("/sessions/test-session/context/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxTokens: 100 }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_FAILED");
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
      // Canonical envelope format
      expect(body.object).toBe("context_preview");
      expect(body.data).toBeDefined();
      expect(body.data.sessionId).toBe("test-session");
      expect(body.requestId).toBeDefined();
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
      // Canonical envelope format
      expect(body.object).toBe("context_render");
      expect(body.data).toBeDefined();
      expect(typeof body.data.rendered).toBe("string");
      expect(body.data.packId).toBeDefined();
      expect(body.data.tokensUsed).toBeDefined();
      expect(body.requestId).toBeDefined();
    });
  });
});
