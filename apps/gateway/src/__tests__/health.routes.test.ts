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
      expect(body.status).toBe("healthy");
      expect(body.timestamp).toBeDefined();
    });
  });

  describe("GET /health/ready", () => {
    test("returns readiness status with checks", async () => {
      const res = await app.request("/health/ready");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(["ready", "degraded", "unhealthy"]).toContain(body.status);
      expect(body.checks).toBeDefined();
      expect(body.checks.database).toBeDefined();
      expect(body.checks.drivers).toBeDefined();
      expect(body.timestamp).toBeDefined();
    });

    test("includes database check result", async () => {
      const res = await app.request("/health/ready");
      const body = await res.json();

      expect(body.checks.database.status).toBeDefined();
      expect(["pass", "fail", "warn"]).toContain(body.checks.database.status);
    });

    test("includes drivers check result", async () => {
      const res = await app.request("/health/ready");
      const body = await res.json();

      expect(body.checks.drivers.status).toBe("pass");
      expect(body.checks.drivers.message).toContain("driver");
    });
  });
});
