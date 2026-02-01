/**
 * Health Routes - Health check and readiness probe endpoints.
 *
 * Provides comprehensive health information for operations and monitoring:
 * - /health - Basic liveness probe with version info
 * - /health/ready - Detailed readiness probe with dependency checks
 * - /health/detailed - Comprehensive system health with all dependencies
 */

import { getDriverRegistry } from "@flywheel/agent-drivers";
import { count } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { agents } from "../db/schema";
import { getLogger } from "../middleware/correlation";
import {
  type DetectionResult,
  getAgentDetectionService,
} from "../services/agent-detection.service";
import {
  getBuildInfo,
  getCapabilities,
  getRuntimeInfo,
} from "../services/build-info";
import {
  CircuitBreakerOpenError,
  getAllBreakerStatuses,
  withCircuitBreaker,
} from "../services/circuit-breaker.service";
import {
  computeHealthDiagnostics,
  type HealthDiagnostics,
} from "../services/tool-health-diagnostics.service";
import { loadToolRegistry } from "../services/tool-registry.service";
import { sendList, sendResource } from "../utils/response";
import { getHub, type HubStats } from "../ws/hub";

const health = new Hono();

interface CheckResult {
  status: "pass" | "fail" | "warn";
  message?: string;
  latencyMs?: number;
}

/**
 * GET /health - Liveness probe
 *
 * Returns 200 if the server is running with version and uptime info.
 * This endpoint is used by load balancers and orchestrators.
 */
health.get("/", (c) => {
  const buildInfo = getBuildInfo();
  const runtimeInfo = getRuntimeInfo();

  return sendResource(c, "health_status", {
    status: "healthy",
    version: buildInfo.version,
    commit: buildInfo.commit,
    environment: buildInfo.environment,
    uptime: runtimeInfo.uptimeFormatted,
    uptimeSeconds: runtimeInfo.uptimeSeconds,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/circuits - Circuit breaker states
 *
 * Returns the current circuit breaker statuses for tracked tools/services.
 */
health.get("/circuits", (c) => {
  const statuses = getAllBreakerStatuses().sort((a, b) =>
    a.tool.localeCompare(b.tool),
  );
  return sendList(c, statuses);
});

/**
 * GET /health/ready - Readiness probe
 *
 * Checks all dependencies and returns detailed status including
 * build info, runtime stats, and feature capabilities.
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
    (check) => check.status === "pass",
  );
  const anyFail = Object.values(checks).some(
    (check) => check.status === "fail",
  );

  const status = anyFail ? "unhealthy" : allPass ? "ready" : "degraded";
  const httpStatus = anyFail ? 503 : 200;

  const buildInfo = getBuildInfo();
  const runtimeInfo = getRuntimeInfo();
  const capabilities = getCapabilities();

  return sendResource(
    c,
    "readiness_status",
    {
      status,
      build: {
        version: buildInfo.version,
        commit: buildInfo.commit,
        branch: buildInfo.branch,
        runtime: buildInfo.runtime,
        environment: buildInfo.environment,
        buildTime: buildInfo.buildTime,
      },
      runtime: {
        uptime: runtimeInfo.uptimeFormatted,
        uptimeSeconds: runtimeInfo.uptimeSeconds,
        memoryMB: runtimeInfo.memoryUsageMB,
        pid: runtimeInfo.pid,
      },
      capabilities,
      checks,
      timestamp: new Date().toISOString(),
    },
    httpStatus,
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
    // Log detailed error for debugging, return generic message to client
    getLogger().error({ error }, "Database health check failed");
    return {
      status: "fail",
      message: "Database connection error",
      latencyMs: Math.round(performance.now() - startTime),
    };
  }
}

// ============================================================================
// Detailed Health Check Types
// ============================================================================

interface ComponentHealth {
  status: "healthy" | "degraded" | "unhealthy";
  message: string;
  latencyMs: number;
  version?: string;
  details?: Record<string, unknown>;
}

interface DriverHealth {
  type: string;
  healthy: boolean;
  capabilities?: Record<string, boolean>;
}

interface DetailedHealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  components: {
    database: ComponentHealth;
    dcg: ComponentHealth;
    cass: ComponentHealth;
    ubs: ComponentHealth;
    drivers: ComponentHealth & { registered: DriverHealth[] };
    websocket: ComponentHealth & { stats: HubStats };
    agentCLIs: ComponentHealth & { detection: DetectionResult | null };
  };
  diagnostics?: HealthDiagnostics;
  summary: {
    totalChecks: number;
    passed: number;
    degraded: number;
    failed: number;
    criticalFailures: string[];
  };
  circuitBreakers?: Array<{
    tool: string;
    state: string;
    consecutiveFailures: number;
    currentBackoffMs: number;
    totalFailures: number;
    totalSuccesses: number;
  }>;
  cachedAt?: string;
}

// ============================================================================
// Detailed Health Check Cache
// ============================================================================

interface DetailedHealthCache {
  response: DetailedHealthResponse;
  expiresAt: number;
}

let detailedHealthCache: DetailedHealthCache | null = null;
const DETAILED_HEALTH_CACHE_TTL_MS = 10_000; // 10 seconds

/**
 * Clear the detailed health cache.
 */
export function clearDetailedHealthCache(): void {
  detailedHealthCache = null;
}

// ============================================================================
// Component Health Check Helpers
// ============================================================================

/**
 * Check a CLI tool with timeout.
 */
async function checkCLI(
  name: string,
  command: string[],
  timeoutMs = 5000,
): Promise<ComponentHealth> {
  const startTime = performance.now();

  try {
    const proc = Bun.spawn(command, {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });

    // Set up timeout with cleanup + kill on timeout
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill();
        } catch {
          // Ignore kill errors; process may have already exited
        }
        reject(new Error("Timeout"));
      }, timeoutMs);
    });

    // Race between command and timeout
    const resultPromise = (async () => {
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      return { stdout, exitCode };
    })();

    let result: { stdout: string; exitCode: number };
    try {
      result = await Promise.race([resultPromise, timeoutPromise]);
    } catch (error) {
      // Prevent unhandled rejection if the process exits after timeout
      if (timedOut) {
        void resultPromise.catch(() => undefined);
      }
      throw error;
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }

    const latencyMs = Math.round(performance.now() - startTime);

    if (result.exitCode === 0) {
      // Extract version from output
      const versionMatch = result.stdout.match(
        /v?(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)/,
      );
      const version = versionMatch ? versionMatch[0] : undefined;
      return {
        status: "healthy",
        message: `${name} available`,
        latencyMs,
        ...(version && { version }),
      };
    }

    return {
      status: "unhealthy",
      message: `${name} exited with code ${result.exitCode}`,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startTime);
    const message =
      error instanceof Error && error.message === "Timeout"
        ? `${name} check timed out`
        : `${name} not available`;

    return {
      status: "unhealthy",
      message,
      latencyMs,
    };
  }
}

/**
 * Check database health.
 */
async function checkDatabaseHealth(): Promise<ComponentHealth> {
  const startTime = performance.now();

  try {
    await db.select({ count: count() }).from(agents);
    return {
      status: "healthy",
      message: "Database connected and responsive",
      latencyMs: Math.round(performance.now() - startTime),
    };
  } catch (error) {
    // Log detailed error for debugging, return generic message to client
    getLogger().error({ error }, "Database health check failed");
    return {
      status: "unhealthy",
      message: "Database connection error",
      latencyMs: Math.round(performance.now() - startTime),
    };
  }
}

/**
 * Check agent drivers health.
 */
async function checkDriversHealth(): Promise<
  ComponentHealth & { registered: DriverHealth[] }
> {
  const startTime = performance.now();
  const registry = getDriverRegistry();
  const registeredTypes = registry.getRegisteredTypes();
  const registered: DriverHealth[] = [];

  // Check health of all active driver instances
  const healthMap = await registry.checkHealth();

  for (const type of registeredTypes) {
    const capabilities = registry.getCapabilities(type);
    // Check if there's an active instance for this type
    const isHealthy =
      healthMap.size === 0 ||
      Array.from(healthMap.entries()).some(
        ([id, healthy]) => id.startsWith(type) && healthy,
      );

    registered.push({
      type,
      healthy: isHealthy,
      ...(capabilities && {
        capabilities: {
          streaming: capabilities.streaming,
          interrupt: capabilities.interrupt,
          checkpoint: capabilities.checkpoint,
          toolCalls: capabilities.toolCalls,
          fileOperations: capabilities.fileOperations,
        },
      }),
    });
  }

  const latencyMs = Math.round(performance.now() - startTime);
  const allHealthy =
    registered.length > 0 && registered.every((d) => d.healthy);
  const anyRegistered = registered.length > 0;

  return {
    status: allHealthy ? "healthy" : anyRegistered ? "degraded" : "unhealthy",
    message: anyRegistered
      ? `${registered.length} driver(s) registered`
      : "No drivers registered",
    latencyMs,
    registered,
  };
}

/**
 * Check WebSocket hub health.
 */
function checkWebSocketHealth(): ComponentHealth & { stats: HubStats } {
  const startTime = performance.now();
  const hub = getHub();
  const stats = hub.getStats();

  return {
    status: "healthy",
    message: `${stats.activeConnections} active connection(s)`,
    latencyMs: Math.round(performance.now() - startTime),
    stats,
    details: {
      messagesPerSecond: stats.messagesPerSecond.toFixed(2),
      channels: Object.keys(stats.subscriptionsByChannel).length,
    },
  };
}

/**
 * Check agent CLI detection.
 */
async function checkAgentCLIsHealth(): Promise<
  ComponentHealth & { detection: DetectionResult | null }
> {
  const startTime = performance.now();

  try {
    const service = getAgentDetectionService();
    const detection = await service.detectAll();
    const latencyMs = Math.round(performance.now() - startTime);

    const anyAgentAvailable = detection.summary.agentsAvailable > 0;
    const anyToolAvailable = detection.summary.toolsAvailable > 0;
    const hasAuthIssues = detection.summary.authIssues.length > 0;

    let status: "healthy" | "degraded" | "unhealthy";
    let message: string;

    if (anyAgentAvailable && anyToolAvailable && !hasAuthIssues) {
      status = "healthy";
      message = `${detection.summary.agentsAvailable} agent(s), ${detection.summary.toolsAvailable} tool(s) available`;
    } else if (anyAgentAvailable || anyToolAvailable) {
      status = "degraded";
      const parts: string[] = [];
      if (!anyAgentAvailable)
        parts.push(`no agents (${detection.summary.agentsTotal} checked)`);
      if (!anyToolAvailable)
        parts.push(`no tools (${detection.summary.toolsTotal} checked)`);
      if (hasAuthIssues)
        parts.push(`${detection.summary.authIssues.length} auth issue(s)`);
      message = parts.join(", ");
    } else {
      status = "unhealthy";
      message = "No agent CLIs or tools detected";
    }

    return {
      status,
      message,
      latencyMs,
      detection,
    };
  } catch (error) {
    // Log detailed error for debugging, return generic message to client
    getLogger().error({ error }, "Agent detection health check failed");
    return {
      status: "unhealthy",
      message: "Agent detection failed",
      latencyMs: Math.round(performance.now() - startTime),
      detection: null,
    };
  }
}

/**
 * GET /health/detailed - Comprehensive system health check
 *
 * Checks all external dependencies and returns detailed status including:
 * - Database connectivity and latency
 * - DCG CLI availability and version
 * - CASS CLI availability and version
 * - UBS CLI availability and version
 * - Agent drivers registered and healthy
 * - WebSocket hub metrics (connections, backpressure)
 * - Detected agent CLIs from auto-detection service
 *
 * Results are cached for 10 seconds. Returns 200 if healthy, 503 if critical failure.
 */
health.get("/detailed", async (c) => {
  const log = getLogger();

  // Check cache
  if (detailedHealthCache && Date.now() < detailedHealthCache.expiresAt) {
    log.debug("Returning cached detailed health");
    const cached = detailedHealthCache.response;
    const httpStatus = cached.status === "unhealthy" ? 503 : 200;
    return sendResource(
      c,
      "detailed_health",
      {
        ...cached,
        cachedAt: new Date(
          detailedHealthCache.expiresAt - DETAILED_HEALTH_CACHE_TTL_MS,
        ).toISOString(),
      },
      httpStatus,
    );
  }

  const startTime = performance.now();
  log.info("Running detailed health check");

  // Run all checks in parallel with circuit breakers for CLI tools
  const unhealthyFallback: ComponentHealth = {
    status: "unhealthy",
    message: "Dependency check failed (circuit breaker fallback)",
    latencyMs: 0,
  };

  const [
    database,
    dcgResult,
    cassResult,
    ubsResult,
    drivers,
    websocket,
    agentCLIs,
  ] = await Promise.all([
    checkDatabaseHealth(),
    withCircuitBreaker(
      "dcg",
      () => checkCLI("DCG", ["dcg", "--version"]),
      unhealthyFallback,
      { isSuccess: (r) => r.status === "healthy" },
    ),
    withCircuitBreaker(
      "cass",
      () => checkCLI("CASS", ["cass", "--version"]),
      unhealthyFallback,
      { isSuccess: (r) => r.status === "healthy" },
    ),
    withCircuitBreaker(
      "ubs",
      () => checkCLI("UBS", ["ubs", "--version"]),
      unhealthyFallback,
      { isSuccess: (r) => r.status === "healthy" },
    ),
    checkDriversHealth(),
    Promise.resolve(checkWebSocketHealth()),
    checkAgentCLIsHealth(),
  ]);

  const dcg = dcgResult.result;
  const cass = cassResult.result;
  const ubs = ubsResult.result;

  // Add circuit breaker metadata to cached results
  if (dcgResult.fromCache) {
    dcg.details = { ...dcg.details, fallbackUsed: true };
    if (dcgResult.error instanceof CircuitBreakerOpenError) {
      dcg.details = { ...dcg.details, circuitBreakerOpen: true };
    }
  }
  if (cassResult.fromCache) {
    cass.details = { ...cass.details, fallbackUsed: true };
    if (cassResult.error instanceof CircuitBreakerOpenError) {
      cass.details = { ...cass.details, circuitBreakerOpen: true };
    }
  }
  if (ubsResult.fromCache) {
    ubs.details = { ...ubs.details, fallbackUsed: true };
    if (ubsResult.error instanceof CircuitBreakerOpenError) {
      ubs.details = { ...ubs.details, circuitBreakerOpen: true };
    }
  }

  // Compute dependency-aware diagnostics if detection succeeded
  let diagnostics: HealthDiagnostics | undefined;
  if (agentCLIs.detection) {
    try {
      const registry = await loadToolRegistry();
      const detectedCLIs = [
        ...agentCLIs.detection.agents,
        ...agentCLIs.detection.tools,
      ];
      diagnostics = computeHealthDiagnostics(registry.tools, detectedCLIs);
    } catch {
      // Non-critical; omit diagnostics on failure
    }
  }

  // Aggregate results
  const components = {
    database,
    dcg,
    cass,
    ubs,
    drivers,
    websocket,
    agentCLIs,
  };
  const allComponents = [
    database,
    dcg,
    cass,
    ubs,
    drivers,
    websocket,
    agentCLIs,
  ];

  const passed = allComponents.filter((c) => c.status === "healthy").length;
  const degraded = allComponents.filter((c) => c.status === "degraded").length;
  const failed = allComponents.filter((c) => c.status === "unhealthy").length;

  // Critical failures are components that are essential for operation
  const criticalFailures: string[] = [];
  if (database.status === "unhealthy") criticalFailures.push("database");
  // Drivers being unhealthy is critical if none are registered
  if (drivers.status === "unhealthy" && drivers.registered.length === 0) {
    criticalFailures.push("drivers");
  }

  // Determine overall status
  let status: "healthy" | "degraded" | "unhealthy";
  if (criticalFailures.length > 0) {
    status = "unhealthy";
  } else if (failed > 0 || degraded > 0) {
    status = "degraded";
  } else {
    status = "healthy";
  }

  const circuitBreakers = getAllBreakerStatuses();

  const response: DetailedHealthResponse = {
    status,
    timestamp: new Date().toISOString(),
    components,
    ...(diagnostics && { diagnostics }),
    summary: {
      totalChecks: allComponents.length,
      passed,
      degraded,
      failed,
      criticalFailures,
    },
    ...(circuitBreakers.length > 0 && { circuitBreakers }),
  };

  // Cache the response
  detailedHealthCache = {
    response,
    expiresAt: Date.now() + DETAILED_HEALTH_CACHE_TTL_MS,
  };

  const totalLatencyMs = Math.round(performance.now() - startTime);
  log.info(
    {
      status,
      passed,
      degraded,
      failed,
      criticalFailures,
      totalLatencyMs,
    },
    "Detailed health check complete",
  );

  const httpStatus = status === "unhealthy" ? 503 : 200;
  return sendResource(c, "detailed_health", response, httpStatus);
});

export { health };
