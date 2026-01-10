import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createBeadsRoutes } from "../routes/beads";
import type { BvTriageResult } from "@flywheel/flywheel-clients";
import { BvClientError } from "@flywheel/flywheel-clients";

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

describe("beads routes", () => {
  test("GET /beads/triage returns BV output", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes({
        getTriage: async () => sampleTriage,
        getInsights: async () => sampleInsights,
        getPlan: async () => samplePlan,
        syncBeads: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
      }),
    );

    const res = await app.request("/beads/triage");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.triage.recommendations?.[0]?.id).toBe("bead-1");
  });

  test("GET /beads/triage supports limit and minScore", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes({
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
        getInsights: async () => sampleInsights,
        getPlan: async () => samplePlan,
        syncBeads: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
      }),
    );

    const res = await app.request("/beads/triage?minScore=0.5&limit=1");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.triage.recommendations).toHaveLength(1);
    expect(data.triage.recommendations[0].id).toBe("bead-2");
  });

  test("GET /beads/ready returns quick wins", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes({
        getTriage: async () => ({
          ...sampleTriage,
          triage: {
            ...sampleTriage.triage,
            quick_wins: [{ id: "bead-2", title: "Quick", score: 0.8 }],
          },
        }),
        getInsights: async () => sampleInsights,
        getPlan: async () => samplePlan,
        syncBeads: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
      }),
    );

    const res = await app.request("/beads/ready");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.beads[0].id).toBe("bead-2");
  });

  test("GET /beads/ready respects limit", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes({
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
        getInsights: async () => sampleInsights,
        getPlan: async () => samplePlan,
        syncBeads: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
      }),
    );

    const res = await app.request("/beads/ready?limit=1");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.beads).toHaveLength(1);
  });

  test("GET /beads/blocked returns blockers", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes({
        getTriage: async () => ({
          ...sampleTriage,
          triage: {
            ...sampleTriage.triage,
            blockers_to_clear: [{ id: "bead-3", title: "Blocker", score: 0.5 }],
          },
        }),
        getInsights: async () => sampleInsights,
        getPlan: async () => samplePlan,
        syncBeads: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
      }),
    );

    const res = await app.request("/beads/blocked");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.beads[0].id).toBe("bead-3");
  });

  test("GET /beads/blocked respects limit", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes({
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
        getInsights: async () => sampleInsights,
        getPlan: async () => samplePlan,
        syncBeads: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
      }),
    );

    const res = await app.request("/beads/blocked?limit=1");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.beads).toHaveLength(1);
  });

  test("GET /beads/triage maps BV errors", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes({
        getTriage: async () => {
          throw new BvClientError("command_failed", "boom", {
            exitCode: 1,
          });
        },
        getInsights: async () => sampleInsights,
        getPlan: async () => samplePlan,
        syncBeads: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
      }),
    );

    const res = await app.request("/beads/triage");
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error.code).toBe("SYSTEM_UNAVAILABLE");
  });

  test("GET /beads/insights returns insights", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes({
        getTriage: async () => sampleTriage,
        getInsights: async () => sampleInsights,
        getPlan: async () => samplePlan,
        syncBeads: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
      }),
    );

    const res = await app.request("/beads/insights");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data_hash).toBe("hash");
  });

  test("GET /beads/plan returns plan", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes({
        getTriage: async () => sampleTriage,
        getInsights: async () => sampleInsights,
        getPlan: async () => samplePlan,
        syncBeads: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
      }),
    );

    const res = await app.request("/beads/plan");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data_hash).toBe("hash");
  });

  test("POST /beads/sync returns ok on success", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes({
        getTriage: async () => sampleTriage,
        getInsights: async () => sampleInsights,
        getPlan: async () => samplePlan,
        syncBeads: async () => ({ exitCode: 0, stdout: "synced", stderr: "" }),
      }),
    );

    const res = await app.request("/beads/sync", { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });

  test("POST /beads/sync maps failure", async () => {
    const app = new Hono();
    app.route(
      "/beads",
      createBeadsRoutes({
        getTriage: async () => sampleTriage,
        getInsights: async () => sampleInsights,
        getPlan: async () => samplePlan,
        syncBeads: async () => ({
          exitCode: 2,
          stdout: "",
          stderr: "failed",
        }),
      }),
    );

    const res = await app.request("/beads/sync", { method: "POST" });
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error.code).toBe("SYSTEM_UNAVAILABLE");
  });
});
