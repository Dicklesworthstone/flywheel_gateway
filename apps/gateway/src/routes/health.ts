/**
 * Health Routes - Health check and readiness probe endpoints.
 */

import { Hono } from "hono";
import { getCorrelationId } from "../middleware/correlation";
import { db } from "../db";
import { agents } from "../db/schema";
import { count } from "drizzle-orm";

const health = new Hono();

interface CheckResult {
  status: "pass" | "fail" | "warn";
  message?: string;
  latencyMs?: number;
}

/**
 * GET /health - Liveness probe
 *
 * Returns 200 if the server is running.
 * This endpoint is used by load balancers and orchestrators.
 */
health.get("/", (c) => {
  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    correlationId: getCorrelationId(),
  });
});

/**
 * GET /health/ready - Readiness probe
 *
 * Checks all dependencies and returns detailed status.
 * Returns 200 if ready to accept traffic, 503 if not.
 */
health.get("/ready", async (c) => {
  const checks: Record<string, CheckResult> = {};

  // Check database
  const dbCheck = await checkDatabase();
  checks["database"] = dbCheck;

  // Check drivers (placeholder - would check actual driver health)
  checks["drivers"] = { status: "pass", message: "SDK driver available" };

  // Determine overall status
  const allPass = Object.values(checks).every(
    (check) => (check as CheckResult).status === "pass"
  );
  const anyFail = Object.values(checks).some(
    (check) => (check as CheckResult).status === "fail"
  );

  const status = anyFail ? "unhealthy" : allPass ? "ready" : "degraded";
  const httpStatus = anyFail ? 503 : 200;

  return c.json(
    {
      status,
      checks,
      timestamp: new Date().toISOString(),
      correlationId: getCorrelationId(),
    },
    httpStatus
  );
});

/**
 * Check database connectivity and health.
 */
async function checkDatabase(): Promise<CheckResult> {
  const startTime = performance.now();

  try {
    // Simple query to verify database connectivity
    await db.select({ count: count() }).from(agents);

    return {
      status: "pass",
      message: "Database connected",
      latencyMs: Math.round(performance.now() - startTime),
    };
  } catch (error) {
    return {
      status: "fail",
      message: `Database error: ${error instanceof Error ? error.message : String(error)}`,
      latencyMs: Math.round(performance.now() - startTime),
    };
  }
}

export { health };
