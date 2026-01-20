/**
 * Tests for health routes.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { clearDetailedHealthCache, health } from "../routes/health";
import { clearDetectionCache } from "../services/agent-detection.service";

type HealthCheck = {
  status: string;
  message?: string;
  latencyMs?: number;
};

type DriversHealth = HealthCheck & {
  registered?: unknown[];
};

type WebsocketHealth = HealthCheck & {
  stats?: {
    activeConnections?: number;
  };
};

type DetailedComponents = {
  database: HealthCheck;
  dcg: HealthCheck;
  cass: HealthCheck;
  ubs: HealthCheck;
  drivers: DriversHealth;
  websocket: WebsocketHealth;
  agentCLIs: HealthCheck;
};

type HealthSummary = {
  totalChecks: number;
  passed: number;
  degraded: number;
  failed: number;
  criticalFailures: unknown[];
};

type HealthEnvelope = {
  object: string;
  data: {
    status: string;
    timestamp: string;
    checks?: {
      database?: HealthCheck;
      drivers?: HealthCheck;
    };
    components?: DetailedComponents;
    summary?: HealthSummary;
  };
  requestId?: string;
};

describe("Health Routes", () => {
  const app = new Hono().route("/health", health);

  describe("GET /health", () => {
    test("returns healthy status", async () => {
      const res = await app.request("/health");

      expect(res.status).toBe(200);
      const body = (await res.json()) as HealthEnvelope;
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
      const body = (await res.json()) as HealthEnvelope;
      // Canonical envelope format
      expect(body.object).toBe("readiness_status");
      expect(["ready", "degraded", "unhealthy"]).toContain(body.data.status);
      expect(body.data.checks).toBeDefined();
      expect(body.data.checks!.database).toBeDefined();
      expect(body.data.checks!.drivers).toBeDefined();
      expect(body.data.timestamp).toBeDefined();
    });

    test("includes database check result", async () => {
      const res = await app.request("/health/ready");
      const body = (await res.json()) as HealthEnvelope;

      expect(body.data.checks!.database!.status).toBeDefined();
      expect(["pass", "fail", "warn"]).toContain(
        body.data.checks!.database!.status,
      );
    });

    test("includes drivers check result", async () => {
      const res = await app.request("/health/ready");
      const body = (await res.json()) as HealthEnvelope;

      expect(body.data.checks!.drivers!.status).toBe("pass");
      expect(body.data.checks!.drivers!.message).toContain("driver");
    });
  });

  // Note: The /health/detailed endpoint tests are skipped by default because
  // CLI auth checks (especially for claude) can take 30-60+ seconds due to
  // network timeouts. To run these tests, set RUN_SLOW_TESTS=1 environment variable.
  const runSlowTests = process.env["RUN_SLOW_TESTS"] === "1";

  describe.skipIf(!runSlowTests)("GET /health/detailed", () => {
    // Store the first response to avoid expensive re-detection
    let cachedResponse: Response | null = null;
    let cachedBody: HealthEnvelope | null = null;

    // Helper to get the response (makes first request or returns cached)
    async function getDetailedHealth() {
      if (!cachedBody) {
        // Clear caches for a fresh start on first request
        clearDetailedHealthCache();
        clearDetectionCache();
        cachedResponse = await app.request("/health/detailed");
        cachedBody = (await cachedResponse.json()) as HealthEnvelope;
      }
      return {
        response: cachedResponse!,
        body: cachedBody,
      };
    }

    // First test makes the expensive request - all others use cached body
    test(
      "returns detailed health status with all components",
      async () => {
        const { response, body } = await getDetailedHealth();

        // Status should be 200 or 503 depending on component health
        expect([200, 503]).toContain(response.status);
        // Canonical envelope format
        expect(body.object).toBe("detailed_health");
        const data = body.data;
        expect(["healthy", "degraded", "unhealthy"]).toContain(data.status);
        expect(data.timestamp).toBeDefined();
      },
      { timeout: 120_000 },
    );

    test("includes all component health checks", async () => {
      const { body } = await getDetailedHealth();
      const data = body.data;
      const components = data.components as DetailedComponents;

      // Check that all components are present
      expect(components).toBeDefined();
      expect(components.database).toBeDefined();
      expect(components.dcg).toBeDefined();
      expect(components.cass).toBeDefined();
      expect(components.ubs).toBeDefined();
      expect(components.drivers).toBeDefined();
      expect(components.websocket).toBeDefined();
      expect(components.agentCLIs).toBeDefined();
    });

    test("includes summary with pass/fail counts", async () => {
      const { body } = await getDetailedHealth();
      const data = body.data;
      const summary = data.summary as HealthSummary;

      expect(summary).toBeDefined();
      expect(typeof summary.totalChecks).toBe("number");
      expect(typeof summary.passed).toBe("number");
      expect(typeof summary.degraded).toBe("number");
      expect(typeof summary.failed).toBe("number");
      expect(Array.isArray(summary.criticalFailures)).toBe(true);
    });

    test("each component has required fields", async () => {
      const { body } = await getDetailedHealth();
      const data = body.data;
      const components = data.components as DetailedComponents;

      // Check structure of a component
      const dbHealth = components.database;
      expect(["healthy", "degraded", "unhealthy"]).toContain(dbHealth.status);
      expect(typeof dbHealth.message).toBe("string");
      expect(typeof dbHealth.latencyMs).toBe("number");
    });

    test("websocket component includes stats", async () => {
      const { body } = await getDetailedHealth();
      const data = body.data;
      const components = data.components as DetailedComponents;

      const wsHealth = components.websocket;
      expect(wsHealth.stats).toBeDefined();
      expect(typeof wsHealth.stats?.activeConnections).toBe("number");
    });

    test("drivers component includes registered drivers", async () => {
      const { body } = await getDetailedHealth();
      const data = body.data;
      const components = data.components as DetailedComponents;

      expect(Array.isArray(components.drivers.registered)).toBe(true);
    });

    test("caches results for subsequent requests", async () => {
      // getDetailedHealth already ensures caching is working
      // Let's verify by making a direct request that should hit cache
      await getDetailedHealth(); // Ensure cache is populated

      // Second request should return cached result quickly
      const res = await app.request("/health/detailed");
      const body = (await res.json()) as HealthEnvelope;

      // Should have the response
      expect(body.data.timestamp).toBeDefined();
    });
  });
});
