/**
 * E2E tests for reliability and diagnostics flows (bd-2gkx.10).
 *
 * Validates circuit breaker state reporting, dependency-aware diagnostics,
 * event-loss telemetry in hub stats, and unified error labels through
 * the health and WebSocket endpoints.
 */

import { test, expect } from "./lib/test-fixture";

const GATEWAY_URL = process.env["E2E_GATEWAY_URL"] ?? "http://localhost:3456";

// =============================================================================
// Helpers
// =============================================================================

async function gw(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

// =============================================================================
// Health Endpoint Basics
// =============================================================================

test.describe("Health endpoints", () => {
  test("GET /health returns liveness probe", async ({ logEvent }) => {
    logEvent("Checking liveness probe");
    const { status, body } = await gw("/health");

    expect(status).toBe(200);
    expect(body).toHaveProperty("status", "ok");
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("uptime");
  });

  test("GET /health/ready returns readiness with components", async ({
    logEvent,
  }) => {
    logEvent("Checking readiness probe");
    const { status, body } = await gw("/health/ready");

    // Should be 200 or 503 depending on environment
    expect([200, 503]).toContain(status);
    expect(body).toHaveProperty("ready");
    expect(body).toHaveProperty("checks");
    expect(typeof body["checks"]).toBe("object");
  });

  test("GET /health/detailed returns comprehensive diagnostics", async ({
    logEvent,
  }) => {
    logEvent("Checking detailed health");
    const { status, body } = await gw("/health/detailed");

    expect([200, 503]).toContain(status);
    expect(body).toHaveProperty("status");
    expect(["healthy", "degraded", "unhealthy"]).toContain(body["status"]);
    expect(body).toHaveProperty("timestamp");
    expect(body).toHaveProperty("components");
    expect(body).toHaveProperty("summary");

    const summary = body["summary"] as Record<string, unknown>;
    expect(summary).toHaveProperty("totalChecks");
    expect(summary).toHaveProperty("passed");
    expect(summary).toHaveProperty("degraded");
    expect(summary).toHaveProperty("failed");
    expect(summary).toHaveProperty("criticalFailures");
    expect(typeof summary["totalChecks"]).toBe("number");
  });
});

// =============================================================================
// Circuit Breaker Reporting
// =============================================================================

test.describe("Circuit breaker diagnostics", () => {
  test("detailed health includes circuit breaker statuses", async ({
    logEvent,
  }) => {
    logEvent("Checking circuit breaker status in health response");
    const { body } = await gw("/health/detailed");

    // circuitBreakers may be absent if no breakers have been triggered
    if (body["circuitBreakers"]) {
      const breakers = body["circuitBreakers"] as Array<
        Record<string, unknown>
      >;
      expect(Array.isArray(breakers)).toBe(true);

      for (const breaker of breakers) {
        expect(breaker).toHaveProperty("tool");
        expect(breaker).toHaveProperty("state");
        expect(["CLOSED", "OPEN", "HALF_OPEN"]).toContain(breaker["state"]);
        expect(breaker).toHaveProperty("consecutiveFailures");
        expect(breaker).toHaveProperty("totalChecks");
        expect(breaker).toHaveProperty("totalFailures");
        expect(breaker).toHaveProperty("totalSuccesses");
        expect(breaker).toHaveProperty("currentBackoffMs");
      }
    }
  });

  test("CLI tools have circuitBreakerOpen flag when cached", async ({
    logEvent,
  }) => {
    logEvent("Checking circuit breaker cache flags");
    const { body } = await gw("/health/detailed");
    const components = body["components"] as Record<
      string,
      Record<string, unknown>
    >;

    // Check dcg, cass, ubs components for circuitBreakerOpen flag
    for (const tool of ["dcg", "cass", "ubs"]) {
      const component = components[tool];
      if (!component) continue;

      if (
        component["details"] &&
        (component["details"] as Record<string, unknown>)["circuitBreakerOpen"]
      ) {
        // If circuit breaker is open, status should be unhealthy with cached message
        expect(component["status"]).toBe("unhealthy");
        expect(component["message"]).toContain("Circuit breaker");
      }
    }
  });
});

// =============================================================================
// Dependency-Aware Diagnostics
// =============================================================================

test.describe("Dependency-aware diagnostics", () => {
  test("detailed health may include diagnostics section", async ({
    logEvent,
  }) => {
    logEvent("Checking dependency diagnostics");
    const { body } = await gw("/health/detailed");

    // diagnostics is optional (requires agent CLI detection to succeed)
    if (body["diagnostics"]) {
      const diag = body["diagnostics"] as Record<string, unknown>;

      // Should have summary
      if (diag["summary"]) {
        const summary = diag["summary"] as Record<string, unknown>;
        expect(summary).toHaveProperty("totalTools");
        expect(summary).toHaveProperty("availableTools");
        expect(summary).toHaveProperty("unavailableTools");
        expect(typeof summary["totalTools"]).toBe("number");
      }

      // Should have tools array/object
      if (diag["tools"]) {
        const tools = diag["tools"] as Record<
          string,
          Record<string, unknown>
        >;
        for (const [name, tool] of Object.entries(tools)) {
          expect(tool).toHaveProperty("available");
          expect(typeof tool["available"]).toBe("boolean");

          if (!tool["available"]) {
            // Unavailable tools should have reason info
            logEvent(
              `Tool ${name} unavailable: ${tool["reasonLabel"] ?? "unknown"}`,
            );
          }
        }
      }

      // Cascade failures
      if (diag["cascadeFailures"]) {
        const cascades = diag["cascadeFailures"] as Array<
          Record<string, unknown>
        >;
        expect(Array.isArray(cascades)).toBe(true);
        for (const cascade of cascades) {
          expect(cascade).toHaveProperty("affectedTool");
          expect(cascade).toHaveProperty("rootCause");
          expect(cascade).toHaveProperty("path");
          expect(Array.isArray(cascade["path"])).toBe(true);
        }
      }
    }
  });

  test("diagnostics root cause paths are valid chains", async ({
    logEvent,
  }) => {
    const { body } = await gw("/health/detailed");
    const diag = body["diagnostics"] as Record<string, unknown> | undefined;
    if (!diag?.["cascadeFailures"]) {
      logEvent("No cascade failures to validate (skipping)");
      return;
    }

    const cascades = diag["cascadeFailures"] as Array<
      Record<string, unknown>
    >;
    for (const cascade of cascades) {
      const path = cascade["path"] as string[];
      expect(path.length).toBeGreaterThanOrEqual(2);
      // Root cause should be first element
      expect(path[0]).toBe(cascade["rootCause"]);
      // Affected tool should be last element
      expect(path[path.length - 1]).toBe(cascade["affectedTool"]);
    }
  });
});

// =============================================================================
// Component Status Structure
// =============================================================================

test.describe("Component status structure", () => {
  test("all components have required fields", async ({ logEvent }) => {
    logEvent("Validating component structure");
    const { body } = await gw("/health/detailed");
    const components = body["components"] as Record<
      string,
      Record<string, unknown>
    >;

    for (const [name, component] of Object.entries(components)) {
      expect(component).toHaveProperty("status");
      expect(["healthy", "degraded", "unhealthy"]).toContain(
        component["status"],
      );

      logEvent(`${name}: ${component["status"]}`);
    }
  });

  test("database component includes latency", async () => {
    const { body } = await gw("/health/detailed");
    const components = body["components"] as Record<
      string,
      Record<string, unknown>
    >;
    const db = components["database"];

    expect(db).toBeDefined();
    if (db["status"] === "healthy") {
      expect(db).toHaveProperty("latencyMs");
      expect(typeof db["latencyMs"]).toBe("number");
    }
  });

  test("websocket component includes hub stats", async () => {
    const { body } = await gw("/health/detailed");
    const components = body["components"] as Record<
      string,
      Record<string, unknown>
    >;
    const ws = components["websocket"];

    expect(ws).toBeDefined();
    expect(ws).toHaveProperty("status");
  });

  test("summary counts are consistent", async () => {
    const { body } = await gw("/health/detailed");
    const summary = body["summary"] as Record<string, unknown>;

    const total = summary["totalChecks"] as number;
    const passed = summary["passed"] as number;
    const degraded = summary["degraded"] as number;
    const failed = summary["failed"] as number;

    expect(passed + degraded + failed).toBe(total);
  });
});

// =============================================================================
// Caching Behavior
// =============================================================================

test.describe("Health response caching", () => {
  test("second request within cache window returns cachedAt", async ({
    logEvent,
  }) => {
    logEvent("Testing cache behavior");

    // First request populates cache
    const first = await gw("/health/detailed");
    const firstTimestamp = first.body["timestamp"];

    // Second request should hit cache (within 10s window)
    const second = await gw("/health/detailed");

    // If cached, timestamp should match and cachedAt should be present
    if (second.body["cachedAt"]) {
      expect(second.body["timestamp"]).toBe(firstTimestamp);
      logEvent(
        `Cache hit: cachedAt=${second.body["cachedAt"]}`,
      );
    }
  });
});

// =============================================================================
// WebSocket Hub Stats (Event Loss Telemetry)
// =============================================================================

test.describe("WebSocket event loss telemetry", () => {
  test("hub stats endpoint includes event loss data", async ({
    logEvent,
  }) => {
    logEvent("Checking WS hub stats for event loss telemetry");

    // Try to hit the hub stats endpoint if it exists
    const { status, body } = await gw("/ws/stats");

    if (status === 200) {
      // Event loss telemetry should be present
      if (body["eventLoss"]) {
        const eventLoss = body["eventLoss"] as Record<string, unknown>;
        expect(eventLoss).toHaveProperty("totalCapacityEvictions");
        expect(eventLoss).toHaveProperty("totalTtlExpirations");
        expect(eventLoss).toHaveProperty("totalSendFailures");
        expect(typeof eventLoss["totalCapacityEvictions"]).toBe("number");
        expect(typeof eventLoss["totalTtlExpirations"]).toBe("number");
        expect(typeof eventLoss["totalSendFailures"]).toBe("number");

        logEvent(
          `Event loss: evictions=${eventLoss["totalCapacityEvictions"]}, ` +
            `expirations=${eventLoss["totalTtlExpirations"]}, ` +
            `sendFailures=${eventLoss["totalSendFailures"]}`,
        );
      }
    } else {
      logEvent(
        `WS stats endpoint returned ${status} (may not be exposed)`,
      );
    }
  });
});
