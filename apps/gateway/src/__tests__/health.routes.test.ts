/**
 * Tests for health routes.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { health } from "../routes/health";

describe("Health Routes", () => {
  const app = new Hono().route("/health", health);

  describe("GET /health", () => {
    test("returns healthy status", async () => {
      const res = await app.request("/health");

      expect(res.status).toBe(200);
      const body = await res.json();
      // Canonical envelope format
      expect(body.object).toBe("health_status");
      expect(body.data.status).toBe("healthy");
      expect(body.data.timestamp).toBeDefined();
      expect(body.requestId).toBeDefined();
    });
  });

  describe("GET /health/ready", () => {
    test("returns readiness status with checks", async () => {
      const res = await app.request("/health/ready");

      expect(res.status).toBe(200);
      const body = await res.json();
      // Canonical envelope format
      expect(body.object).toBe("readiness_status");
      expect(["ready", "degraded", "unhealthy"]).toContain(body.data.status);
      expect(body.data.checks).toBeDefined();
      expect(body.data.checks.database).toBeDefined();
      expect(body.data.checks.drivers).toBeDefined();
      expect(body.data.timestamp).toBeDefined();
    });

    test("includes database check result", async () => {
      const res = await app.request("/health/ready");
      const body = await res.json();

      expect(body.data.checks.database.status).toBeDefined();
      expect(["pass", "fail", "warn"]).toContain(body.data.checks.database.status);
    });

    test("includes drivers check result", async () => {
      const res = await app.request("/health/ready");
      const body = await res.json();

      expect(body.data.checks.drivers.status).toBe("pass");
      expect(body.data.checks.drivers.message).toContain("driver");
    });
  });
});
