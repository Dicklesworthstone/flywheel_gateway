import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
    expect(data.conflicts).toHaveLength(1);
    expect(data.conflicts[0]?.status).toBe("open");
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
    const conflictId = listData.conflicts[0]?.conflictId;
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
    expect(resolvedData.conflicts).toHaveLength(1);
    expect(resolvedData.conflicts[0]?.status).toBe("resolved");
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
});
