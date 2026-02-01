import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { authMiddleware, requireAdminMiddleware } from "../middleware/auth";

const TEST_JWT_SECRET = "test-secret-please-change";
const TEST_ADMIN_KEY = "admin-test-key";

function createApp() {
  const app = new Hono();
  app.use("*", authMiddleware());
  app.get("/protected", (c) => c.text("ok"));
  return app;
}

function createAdminApp() {
  const app = new Hono();
  app.use("*", authMiddleware());
  app.use("*", requireAdminMiddleware());
  app.get("/admin", (c) => c.text("ok"));
  return app;
}

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

describe("authMiddleware", () => {
  beforeEach(() => {
    process.env["JWT_SECRET"] = TEST_JWT_SECRET;
    process.env["GATEWAY_ADMIN_KEY"] = TEST_ADMIN_KEY;
  });

  afterEach(() => {
    delete process.env["JWT_SECRET"];
    delete process.env["GATEWAY_ADMIN_KEY"];
  });

  it("allows requests when auth is disabled", async () => {
    delete process.env["JWT_SECRET"];
    delete process.env["GATEWAY_ADMIN_KEY"];
    const app = createApp();

    const res = await app.request("/protected");
    expect(res.status).toBe(200);
  });

  it("rejects missing auth when JWT secret is set", async () => {
    const app = createApp();
    const res = await app.request("/protected");
    expect(res.status).toBe(401);
  });

  it("accepts admin key bearer token", async () => {
    const app = createApp();
    const res = await app.request("/protected", {
      headers: { Authorization: `Bearer ${TEST_ADMIN_KEY}` },
    });
    expect(res.status).toBe(200);
  });

  it("accepts valid JWT bearer token", async () => {
    const app = createApp();
    const token = createJwt({ sub: "user-1" }, TEST_JWT_SECRET);
    const res = await app.request("/protected", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("rejects expired JWT bearer token", async () => {
    const app = createApp();
    const now = Math.floor(Date.now() / 1000);
    const token = createJwt({ sub: "user-1", exp: now - 1 }, TEST_JWT_SECRET);
    const res = await app.request("/protected", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin JWT token for admin routes", async () => {
    const app = createAdminApp();
    const token = createJwt({ sub: "user-1" }, TEST_JWT_SECRET);
    const res = await app.request("/admin", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("accepts admin JWT token for admin routes", async () => {
    const app = createAdminApp();
    const token = createJwt({ sub: "user-1", isAdmin: true }, TEST_JWT_SECRET);
    const res = await app.request("/admin", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("accepts admin key bearer token for admin routes", async () => {
    const app = createAdminApp();
    const res = await app.request("/admin", {
      headers: { Authorization: `Bearer ${TEST_ADMIN_KEY}` },
    });
    expect(res.status).toBe(200);
  });
});
