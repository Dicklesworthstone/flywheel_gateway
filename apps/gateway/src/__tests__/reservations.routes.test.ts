import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

// Mock the logger with child method
const mockLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  child: () => mockLogger,
};

mock.module("../services/logger", () => ({
  logger: mockLogger,
}));

afterAll(() => {
  mock.restore();
});

import { Hono } from "hono";
import { reservations } from "../routes/reservations";
import {
  _clearAllReservations,
  stopCleanupJob,
} from "../services/reservation.service";

function createTestApp() {
  const app = new Hono();
  app.route("/reservations", reservations);
  return app;
}

beforeEach(() => {
  _clearAllReservations();
  stopCleanupJob();
});

afterEach(() => {
  _clearAllReservations();
  stopCleanupJob();
});

describe("reservations routes", () => {
  test("GET /reservations/conflicts lists conflicts", async () => {
    const app = createTestApp();

    const first = await app.request("/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      }),
    });
    expect(first.status).toBe(201);

    const second = await app.request("/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        agentId: "agent-2",
        patterns: ["src/index.ts"],
        mode: "exclusive",
      }),
    });
    expect(second.status).toBe(409);

    const res = await app.request(
      "/reservations/conflicts?projectId=project-1&status=open",
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    // Canonical envelope format - list response
    expect(data.object).toBe("list");
    expect(data.data).toHaveLength(1);
    expect(data.data[0]?.status).toBe("open");
    expect(data.requestId).toBeDefined();
  });

  test("POST /reservations/conflicts/:id/resolve resolves conflict", async () => {
    const app = createTestApp();

    await app.request("/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      }),
    });

    await app.request("/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        agentId: "agent-2",
        patterns: ["src/index.ts"],
        mode: "exclusive",
      }),
    });

    const listRes = await app.request(
      "/reservations/conflicts?projectId=project-1",
    );
    const listData = await listRes.json();
    // Canonical envelope format - list response
    const conflictId = listData.data[0]?.conflictId;
    expect(conflictId).toBeDefined();
    if (!conflictId) {
      throw new Error("Expected conflict id");
    }

    const resolveRes = await app.request(
      `/reservations/conflicts/${conflictId}/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolvedBy: "agent-2", reason: "manual" }),
      },
    );
    expect(resolveRes.status).toBe(200);

    const resolvedList = await app.request(
      "/reservations/conflicts?projectId=project-1&status=resolved",
    );
    const resolvedData = await resolvedList.json();
    // Canonical envelope format - list response
    expect(resolvedData.object).toBe("list");
    expect(resolvedData.data).toHaveLength(1);
    expect(resolvedData.data[0]?.status).toBe("resolved");
  });

  test("POST /reservations/conflicts/:id/resolve returns 404 for unknown id", async () => {
    const app = createTestApp();
    const res = await app.request("/reservations/conflicts/unknown/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resolvedBy: "agent-1", reason: "manual" }),
    });
    expect(res.status).toBe(404);
  });

  test("GET /reservations/conflicts validates query", async () => {
    const app = createTestApp();
    const res = await app.request("/reservations/conflicts");
    expect(res.status).toBe(400);
  });

  // ==========================================================================
  // DELETE /reservations/:id Tests
  // ==========================================================================

  describe("DELETE /reservations/:id", () => {
    test("releases reservation with X-Agent-Id header", async () => {
      const app = createTestApp();

      // Create a reservation
      const createRes = await app.request("/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "project-1",
          agentId: "agent-1",
          patterns: ["src/**/*.ts"],
          mode: "exclusive",
        }),
      });
      expect(createRes.status).toBe(201);
      const createData = await createRes.json();
      const reservationId = createData.data.reservation.id;

      // Release with X-Agent-Id header
      const deleteRes = await app.request(`/reservations/${reservationId}`, {
        method: "DELETE",
        headers: { "X-Agent-Id": "agent-1" },
      });
      expect(deleteRes.status).toBe(204);
    });

    test("releases reservation with body (deprecated)", async () => {
      const app = createTestApp();

      // Create a reservation
      const createRes = await app.request("/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "project-1",
          agentId: "agent-1",
          patterns: ["src/**/*.ts"],
          mode: "exclusive",
        }),
      });
      expect(createRes.status).toBe(201);
      const createData = await createRes.json();
      const reservationId = createData.data.reservation.id;

      // Release with body (deprecated but still supported)
      const deleteRes = await app.request(`/reservations/${reservationId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "agent-1" }),
      });
      expect(deleteRes.status).toBe(204);
    });

    test("returns 400 without X-Agent-Id header or body", async () => {
      const app = createTestApp();

      // Create a reservation
      const createRes = await app.request("/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "project-1",
          agentId: "agent-1",
          patterns: ["src/**/*.ts"],
          mode: "exclusive",
        }),
      });
      expect(createRes.status).toBe(201);
      const createData = await createRes.json();
      const reservationId = createData.data.reservation.id;

      // Try to release without agent ID
      const deleteRes = await app.request(`/reservations/${reservationId}`, {
        method: "DELETE",
      });
      expect(deleteRes.status).toBe(400);
      const deleteData = await deleteRes.json();
      expect(deleteData.error.code).toBe("MISSING_AGENT_ID");
      expect(deleteData.error.hint).toBeDefined();
      expect(deleteData.error.example).toBeDefined();
    });

    test("returns 404 for non-existent reservation", async () => {
      const app = createTestApp();

      const deleteRes = await app.request("/reservations/rsv_nonexistent", {
        method: "DELETE",
        headers: { "X-Agent-Id": "agent-1" },
      });
      expect(deleteRes.status).toBe(404);
    });

    test("returns 403 when non-holder tries to release", async () => {
      const app = createTestApp();

      // Create a reservation
      const createRes = await app.request("/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "project-1",
          agentId: "agent-1",
          patterns: ["src/**/*.ts"],
          mode: "exclusive",
        }),
      });
      expect(createRes.status).toBe(201);
      const createData = await createRes.json();
      const reservationId = createData.data.reservation.id;

      // Try to release as different agent
      const deleteRes = await app.request(`/reservations/${reservationId}`, {
        method: "DELETE",
        headers: { "X-Agent-Id": "agent-2" },
      });
      expect(deleteRes.status).toBe(403);
    });
  });
});
