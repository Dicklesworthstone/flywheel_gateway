/**
 * Dashboard routes auth hardening tests.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { collaboration as collaborationRoutes } from "../routes/collaboration";
import { dashboards as dashboardsRoutes } from "../routes/dashboards";
import { velocity as velocityRoutes } from "../routes/velocity";
import {
  clearDashboardStore,
  createDashboard,
} from "../services/dashboard.service";
import {
  _clearAllReservations,
  createReservation,
} from "../services/reservation.service";

const TEST_JWT_SECRET = "test-secret-please-change";

function createJwt(payload: Record<string, unknown>, secret: string) {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${headerB64}.${payloadB64}`;
  const signature = createHmac("sha256", secret)
    .update(data)
    .digest("base64url");
  return `${data}.${signature}`;
}

function createApp() {
  const app = new Hono();
  app.use("*", authMiddleware());
  app.route("/dashboards", dashboardsRoutes);
  app.route("/velocity", velocityRoutes);
  app.route("/collaboration", collaborationRoutes);
  return app;
}

describe("Dashboard Routes", () => {
  beforeEach(async () => {
    await clearDashboardStore();
    _clearAllReservations();
    delete process.env["GATEWAY_ADMIN_KEY"];
  });

  afterEach(() => {
    _clearAllReservations();
    delete process.env["JWT_SECRET"];
    delete process.env["GATEWAY_ADMIN_KEY"];
  });

  it("ignores X-User headers when JWT auth is enabled", async () => {
    process.env["JWT_SECRET"] = TEST_JWT_SECRET;

    await createDashboard({ name: "User A Dashboard" }, "user-a");
    await createDashboard({ name: "User B Dashboard" }, "user-b");

    const app = createApp();
    const token = createJwt({ sub: "user-a" }, TEST_JWT_SECRET);

    const res = await app.request("/dashboards", {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-User-Id": "user-b",
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("list");

    const items = body.data as Array<{ name: string }>;
    expect(items.some((d) => d.name === "User A Dashboard")).toBe(true);
    expect(items.some((d) => d.name === "User B Dashboard")).toBe(false);
  });

  it("allows X-User headers when auth is disabled (local dev mode)", async () => {
    delete process.env["JWT_SECRET"];

    await createDashboard({ name: "User B Dashboard" }, "user-b");

    const app = createApp();
    const res = await app.request("/dashboards", {
      headers: {
        "X-User-Id": "user-b",
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("list");

    const items = body.data as Array<{ name: string }>;
    expect(items.some((d) => d.name === "User B Dashboard")).toBe(true);
  });
});

describe("Velocity Dashboard Routes (/velocity)", () => {
  beforeEach(() => {
    _clearAllReservations();
    delete process.env["JWT_SECRET"];
  });

  afterEach(() => {
    _clearAllReservations();
  });

  it("GET /velocity/score returns computed score and component breakdown", async () => {
    const app = createApp();
    const res = await app.request("/velocity/score?period=7d");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("velocity_score");
    expect(body.data.period).toBe("7d");
    expect(typeof body.data.overall_score).toBe("number");
    expect(body.data.components.throughput_score).toBeGreaterThan(0);
    expect(body.data.components.cycle_time_score).toBeGreaterThan(0);
    expect(body.data.components.success_rate_score).toBeGreaterThan(0);
    expect(body.data.components.learning_rate_score).toBeGreaterThan(0);
    expect(body.data.components.collaboration_score).toBeGreaterThan(0);
  });

  it("GET /velocity/score rejects invalid period parameter", async () => {
    const app = createApp();
    const res = await app.request("/velocity/score?period=invalid");
    expect(res.status).toBe(400);
  });

  it("GET /velocity/stages returns metrics for all 5 Flywheel stages", async () => {
    const app = createApp();
    const res = await app.request("/velocity/stages");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("velocity_stages");
    expect(body.data.plan).toBeDefined();
    expect(body.data.coordinate).toBeDefined();
    expect(body.data.execute).toBeDefined();
    expect(body.data.scan).toBeDefined();
    expect(body.data.remember).toBeDefined();
  });

  it("GET /velocity/learning, /trends, and /history return structured analytics", async () => {
    const app = createApp();

    const learningRes = await app.request("/velocity/learning");
    expect(learningRes.status).toBe(200);
    const learningBody = await learningRes.json();
    expect(learningBody.data.improvement_rate.overall).toBeGreaterThan(0);

    const trendsRes = await app.request("/velocity/trends");
    expect(trendsRes.status).toBe(200);
    const trendsBody = await trendsRes.json();
    expect(trendsBody.data.forecast_7d.expected_velocity).toBeGreaterThan(0);
    expect(Array.isArray(trendsBody.data.recommendations)).toBe(true);

    const historyRes = await app.request("/velocity/history?period=30d");
    expect(historyRes.status).toBe(200);
    const historyBody = await historyRes.json();
    expect(historyBody.data.period).toBe("30d");
    expect(historyBody.data.points.length).toBe(31);
  });
});

describe("Collaboration Graph Routes (/collaboration)", () => {
  beforeEach(() => {
    _clearAllReservations();
    delete process.env["JWT_SECRET"];
  });

  afterEach(() => {
    _clearAllReservations();
  });

  it("reflects live reservations, conflicts, agents, and edges in /collaboration/graph", async () => {
    // Agent 1 acquires an exclusive reservation
    const r1 = await createReservation({
      projectId: "default",
      agentId: "agent-holder",
      patterns: ["src/routes/collaboration.ts"],
      mode: "exclusive",
      ttl: 300,
    });
    expect(r1.granted).toBe(true);

    // Agent 2 attempts a conflicting exclusive reservation
    const r2 = await createReservation({
      projectId: "default",
      agentId: "agent-waiter",
      patterns: ["src/routes/collaboration.ts"],
      mode: "exclusive",
      ttl: 300,
    });
    expect(r2.granted).toBe(false);

    const app = createApp();
    const graphRes = await app.request("/collaboration/graph");
    expect(graphRes.status).toBe(200);
    const graphBody = await graphRes.json();
    expect(graphBody.object).toBe("collaboration_graph");

    const data = graphBody.data;
    expect(data.reservations.length).toBeGreaterThanOrEqual(1);
    const resNode = data.reservations.find(
      (r: { id: string }) => r.id === r1.reservation!.id,
    );
    expect(resNode).toBeDefined();
    expect(resNode.holderId).toBe("agent-holder");
    expect(resNode.waiters).toContain("agent-waiter");

    expect(data.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(
      data.agents.some(
        (a: { agentId: string }) => a.agentId === "agent-holder",
      ),
    ).toBe(true);
    expect(
      data.agents.some(
        (a: { agentId: string; status: string }) =>
          a.agentId === "agent-waiter" && a.status === "waiting",
      ),
    ).toBe(true);
    expect(
      data.edges.some((e: { type: string }) => e.type === "reservation"),
    ).toBe(true);
    expect(data.edges.some((e: { type: string }) => e.type === "waiting")).toBe(
      true,
    );
    expect(data.stats.totalReservations).toBeGreaterThanOrEqual(1);
    expect(data.stats.activeConflicts).toBeGreaterThanOrEqual(1);
  });

  it("serves /collaboration/graph/stats, /agents, /reservations, /conflicts, and /messages", async () => {
    await createReservation({
      projectId: "default",
      agentId: "agent-collab-1",
      patterns: ["packages/shared/**"],
      mode: "shared",
      ttl: 300,
    });

    const app = createApp();

    const statsRes = await app.request("/collaboration/graph/stats");
    expect(statsRes.status).toBe(200);
    const statsBody = await statsRes.json();
    expect(statsBody.data.totalReservations).toBeGreaterThanOrEqual(1);

    const agentsRes = await app.request("/collaboration/agents");
    expect(agentsRes.status).toBe(200);

    const resvRes = await app.request("/collaboration/reservations");
    expect(resvRes.status).toBe(200);
    const resvBody = await resvRes.json();
    expect(resvBody.data.length).toBeGreaterThanOrEqual(1);

    const conflictsRes = await app.request("/collaboration/conflicts");
    expect(conflictsRes.status).toBe(200);

    const messagesRes = await app.request("/collaboration/messages?limit=5");
    expect(messagesRes.status).toBe(200);
    const messagesBody = await messagesRes.json();
    expect(Array.isArray(messagesBody.data)).toBe(true);
  });
});
