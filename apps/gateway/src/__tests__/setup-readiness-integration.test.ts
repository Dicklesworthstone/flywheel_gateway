/**
 * Setup Readiness Integration Tests (bd-1vr1.6)
 *
 * Tests /setup routes without mock.module. Route-level validation
 * (install, verify 404) works without detection. Detection-dependent
 * tests (readiness) are skipped here because the agent-detection
 * service spawns `command -v` which is a shell builtin unavailable
 * as a subprocess in bun:test. The unit tests in setup-readiness.test.ts
 * cover all detection scenarios via controlled mocks.
 *
 * When the detection service is fixed to use `which` instead of
 * `command -v`, the readiness tests can be re-enabled here.
 */

import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

// Import routes directly — no mock.module
import { setup } from "../routes/setup";

type Envelope<T> = {
  object: string;
  data: T;
  requestId?: string;
  error?: { code?: string; message?: string };
};

describe("Setup Routes Integration (no mocks)", () => {
  // These tests intentionally mount only the setup routes (no auth middleware),
  // so set an admin auth context explicitly instead of mutating process.env
  // (which can be flaky under parallel test execution).
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("auth", { isAdmin: true });
    await next();
  });
  app.route("/setup", setup);

  // ========================================================================
  // Install endpoint validation
  // ========================================================================

  it("POST /setup/install rejects invalid payload", async () => {
    const res = await app.request("/setup/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invalid: "payload" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Envelope<unknown>;
    expect(body.error).toBeDefined();
  });

  it("POST /setup/install rejects unknown tool", async () => {
    const res = await app.request("/setup/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "nonexistent-xyz" }),
    });

    expect(res.status).toBe(400);
  });

  it("POST /setup/install validates body schema", async () => {
    const res = await app.request("/setup/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  // ========================================================================
  // Verify endpoint
  // ========================================================================

  it("POST /setup/verify/:tool returns result for known tool", async () => {
    const res = await app.request("/setup/verify/dcg", {
      method: "POST",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Envelope<{
      tool: string;
      available: boolean;
    }>;

    expect(body.data.tool).toBe("dcg");
    expect(typeof body.data.available).toBe("boolean");
  }, 30_000);

  it("POST /setup/verify/:tool returns 404 for unknown tool", async () => {
    const res = await app.request("/setup/verify/totally-fake-tool-xyz", {
      method: "POST",
    });

    expect(res.status).toBe(404);
  });
});
