/**
 * Dashboard routes auth hardening tests.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { dashboards as dashboardsRoutes } from "../routes/dashboards";
import { clearDashboardStore, createDashboard } from "../services/dashboard.service";

const TEST_JWT_SECRET = "test-secret-please-change";

function createJwt(payload: Record<string, unknown>, secret: string) {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${headerB64}.${payloadB64}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

function createApp() {
  const app = new Hono();
  app.use("*", authMiddleware());
  app.route("/dashboards", dashboardsRoutes);
  return app;
}

describe("Dashboard Routes", () => {
  beforeEach(async () => {
    await clearDashboardStore();
    delete process.env["GATEWAY_ADMIN_KEY"];
  });

  afterEach(() => {
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
