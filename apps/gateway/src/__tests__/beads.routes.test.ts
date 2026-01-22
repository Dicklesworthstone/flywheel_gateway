import { describe, expect, test } from "bun:test";
import type {
  BrIssue,
  BrSyncResult,
  BrSyncStatus,
  BvTriageResult,
} from "@flywheel/flywheel-clients";
import { BrClientError, BvClientError } from "@flywheel/flywheel-clients";
import { Hono } from "hono";
import { createBeadsRoutes } from "../routes/beads";
import type { BeadsService } from "../services/beads.service";

const sampleTriage: BvTriageResult = {
  generated_at: "2026-01-10T00:00:00Z",
  data_hash: "hash",
  triage: {
    recommendations: [
      {
        id: "bead-1",
        title: "Test",
        type: "feature",
        score: 0.9,
      },
    ],
  },
};
const sampleInsights = {
  generated_at: "2026-01-10T00:00:00Z",
  data_hash: "hash",
  insights: [],
};
const samplePlan = {
  generated_at: "2026-01-10T00:00:00Z",
  data_hash: "hash",
  plan: [],
};
const sampleGraph = {
  format: "json" as const,
  nodes: 0,
  edges: 0,
  data_hash: "hash",
};
const sampleIssue: BrIssue = {
  id: "bd-1234",
  title: "Test issue",
  status: "open",
  priority: 1,
  type: "task",
  created_at: "2026-01-10T00:00:00Z",
  updated_at: "2026-01-10T00:00:00Z",
};
const sampleSyncResult: BrSyncResult = {
  imported: 0,
  exported: 0,
  errors: [],
};
const sampleSyncStatus: BrSyncStatus = {
  lastSync: "2026-01-10T00:00:00Z",
  pendingChanges: 0,
  status: "ok",
};

/**
 * Create a mock BeadsService with optional overrides.
 */
function createMockService(
  overrides: Partial<BeadsService> = {},
): BeadsService {
  return {
    getTriage: async () => sampleTriage,
    getInsights: async () => sampleInsights,
    getPlan: async () => samplePlan,
    getGraph: async () => sampleGraph,
    ready: async () => [],
    list: async () => [],
    show: async () => [],
    create: async () => sampleIssue,
    update: async () => [sampleIssue],
    close: async () => [sampleIssue],
    syncStatus: async () => sampleSyncStatus,
    sync: async () => sampleSyncResult,
    ...overrides,
  };
}

describe("beads routes", () => {
  test("GET /beads/triage returns BV output", async () => {
    const app = new Hono();
    app.route("/beads", createBeadsRoutes(createMockService()));

    const res = await app.request("/beads/triage");
    expect(res.status).toBe(200);
    const data = await res.json();
    // Canonical envelope format
    expect(data.object).toBe("triage");
    expect(data.data.triage.recommendations?.[0]?.id).toBe("bead-1");
    expect(data.requestId).toBeDefined();
  });

  test("GET /beads/triage supports limit and minScore", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes(
        createMockService({
          getTriage: async () => ({
            ...sampleTriage,
            triage: {
              ...sampleTriage.triage,
              recommendations: [
                { id: "bead-1", title: "Low", score: 0.2 },
                { id: "bead-2", title: "High", score: 0.9 },
                { id: "bead-3", title: "High2", score: 0.8 },
              ],
            },
          }),
        }),
      ),
    );

    const res = await app.request("/beads/triage?minScore=0.5&limit=1");
    expect(res.status).toBe(200);
    const data = await res.json();
    // Canonical envelope format
    expect(data.object).toBe("triage");
    expect(data.data.triage.recommendations).toHaveLength(1);
    expect(data.data.triage.recommendations[0].id).toBe("bead-2");
  });

  test("GET /beads/ready returns quick wins", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes(
        createMockService({
          getTriage: async () => ({
            ...sampleTriage,
            triage: {
              ...sampleTriage.triage,
              quick_wins: [{ id: "bead-2", title: "Quick", score: 0.8 }],
            },
          }),
        }),
      ),
    );

    const res = await app.request("/beads/ready");
    expect(res.status).toBe(200);
    const data = await res.json();
    // Canonical envelope format
    expect(data.object).toBe("ready");
    expect(data.data.beads[0].id).toBe("bead-2");
    expect(data.requestId).toBeDefined();
  });

  test("GET /beads/ready respects limit", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes(
        createMockService({
          getTriage: async () => ({
            ...sampleTriage,
            triage: {
              ...sampleTriage.triage,
              quick_wins: [
                { id: "bead-2", title: "Quick", score: 0.8 },
                { id: "bead-4", title: "Quick2", score: 0.7 },
              ],
            },
          }),
        }),
      ),
    );

    const res = await app.request("/beads/ready?limit=1");
    expect(res.status).toBe(200);
    const data = await res.json();
    // Canonical envelope format
    expect(data.object).toBe("ready");
    expect(data.data.beads).toHaveLength(1);
    expect(data.requestId).toBeDefined();
  });

  test("GET /beads/blocked returns blockers", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes(
        createMockService({
          getTriage: async () => ({
            ...sampleTriage,
            triage: {
              ...sampleTriage.triage,
              blockers_to_clear: [
                { id: "bead-3", title: "Blocker", score: 0.5 },
              ],
            },
          }),
        }),
      ),
    );

    const res = await app.request("/beads/blocked");
    expect(res.status).toBe(200);
    const data = await res.json();
    // Canonical envelope format
    expect(data.object).toBe("blocked");
    expect(data.data.beads[0].id).toBe("bead-3");
    expect(data.requestId).toBeDefined();
  });

  test("GET /beads/blocked respects limit", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes(
        createMockService({
          getTriage: async () => ({
            ...sampleTriage,
            triage: {
              ...sampleTriage.triage,
              blockers_to_clear: [
                { id: "bead-3", title: "Blocker", score: 0.5 },
                { id: "bead-5", title: "Blocker2", score: 0.4 },
              ],
            },
          }),
        }),
      ),
    );

    const res = await app.request("/beads/blocked?limit=1");
    expect(res.status).toBe(200);
    const data = await res.json();
    // Canonical envelope format
    expect(data.object).toBe("blocked");
    expect(data.data.beads).toHaveLength(1);
    expect(data.requestId).toBeDefined();
  });

  test("GET /beads/triage maps BV errors", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes(
        createMockService({
          getTriage: async () => {
            throw new BvClientError("command_failed", "boom", {
              exitCode: 1,
            });
          },
        }),
      ),
    );

    const res = await app.request("/beads/triage");
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error.code).toBe("SYSTEM_UNAVAILABLE");
  });

  test("GET /beads/insights returns insights", async () => {
    const app = new Hono();
    app.route("/beads", createBeadsRoutes(createMockService()));

    const res = await app.request("/beads/insights");
    expect(res.status).toBe(200);
    const data = await res.json();
    // Canonical envelope format
    expect(data.object).toBe("insights");
    expect(data.data.data_hash).toBe("hash");
    expect(data.requestId).toBeDefined();
  });

  test("GET /beads/plan returns plan", async () => {
    const app = new Hono();
    app.route("/beads", createBeadsRoutes(createMockService()));

    const res = await app.request("/beads/plan");
    expect(res.status).toBe(200);
    const data = await res.json();
    // Canonical envelope format
    expect(data.object).toBe("plan");
    expect(data.data.data_hash).toBe("hash");
    expect(data.requestId).toBeDefined();
  });

  test("POST /beads/sync returns ok on success", async () => {
    const app = new Hono();
    app.route("/beads", createBeadsRoutes(createMockService()));

    const res = await app.request("/beads/sync", { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json();
    // Canonical envelope format
    expect(data.object).toBe("sync_result");
    expect(data.data.status).toBe("ok");
    expect(data.requestId).toBeDefined();
  });

  test("POST /beads/sync maps BR errors", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes(
        createMockService({
          sync: async () => {
            throw new BrClientError("command_failed", "sync failed", {
              exitCode: 1,
            });
          },
        }),
      ),
    );

    const res = await app.request("/beads/sync", { method: "POST" });
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error.code).toBe("SYSTEM_UNAVAILABLE");
  });

  // ==========================================================================
  // BR CRUD Endpoint Tests
  // ==========================================================================

  test("GET /beads returns list of beads", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes(
        createMockService({
          list: async () => [sampleIssue, { ...sampleIssue, id: "bd-5678" }],
        }),
      ),
    );

    const res = await app.request("/beads");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.object).toBe("beads");
    expect(data.data.beads).toHaveLength(2);
    expect(data.data.count).toBe(2);
  });

  test("GET /beads/:id returns single bead", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes(
        createMockService({
          show: async (id) => (id === "bd-1234" ? [sampleIssue] : []),
        }),
      ),
    );

    const res = await app.request("/beads/bd-1234");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.object).toBe("bead");
    expect(data.data.id).toBe("bd-1234");
  });

  test("GET /beads/:id returns 404 for missing bead", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes(
        createMockService({
          show: async () => [],
        }),
      ),
    );

    const res = await app.request("/beads/bd-missing");
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error.code).toBe("BEAD_NOT_FOUND");
  });

  test("POST /beads creates a new bead", async () => {
    const createdIssue = { ...sampleIssue, title: "New bead" };
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes(
        createMockService({
          create: async () => createdIssue,
        }),
      ),
    );

    const res = await app.request("/beads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New bead", type: "task" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.object).toBe("bead");
    expect(data.data.title).toBe("New bead");
  });

  test("PATCH /beads/:id updates a bead", async () => {
    const updatedIssue = { ...sampleIssue, title: "Updated title" };
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes(
        createMockService({
          update: async () => [updatedIssue],
        }),
      ),
    );

    const res = await app.request("/beads/bd-1234", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated title" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.object).toBe("bead");
    expect(data.data.title).toBe("Updated title");
  });

  test("DELETE /beads/:id closes a bead", async () => {
    const closedIssue = { ...sampleIssue, status: "closed" };
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes(
        createMockService({
          close: async () => [closedIssue],
        }),
      ),
    );

    const res = await app.request("/beads/bd-1234", { method: "DELETE" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.object).toBe("bead");
    expect(data.data.status).toBe("closed");
  });

  test("POST /beads/:id/claim claims a bead", async () => {
    const claimedIssue = { ...sampleIssue, status: "in_progress" };
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes(
        createMockService({
          update: async (_id, input) => (input.claim ? [claimedIssue] : []),
        }),
      ),
    );

    const res = await app.request("/beads/bd-1234/claim", { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.object).toBe("bead");
    expect(data.data.status).toBe("in_progress");
  });

  test("GET /beads/sync/status returns sync status", async () => {
    const app = new Hono();
    app.route("/beads", createBeadsRoutes(createMockService()));

    const res = await app.request("/beads/sync/status");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.object).toBe("sync_status");
    expect(data.data.status).toBe("ok");
  });

  test("GET /beads/list/ready returns ready beads", async () => {
    const readyIssue = { ...sampleIssue, status: "open" };
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes(
        createMockService({
          ready: async () => [readyIssue],
        }),
      ),
    );

    const res = await app.request("/beads/list/ready");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.object).toBe("beads");
    expect(data.data.beads).toHaveLength(1);
  });
});
