import {
  createBunNtmCommandRunner,
  createNtmClient,
} from "@flywheel/flywheel-clients";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { registerDrivers } from "./config/drivers";
import { db, jobs } from "./db";
import {
  authMiddleware,
  buildAuthContext,
  getBearerToken,
  safeCompare,
  verifyJwtHs256,
} from "./middleware/auth";
import { correlationMiddleware } from "./middleware/correlation";
import { globalErrorHandler } from "./middleware/error-handler";
import {
  idempotencyMiddleware,
  stopIdempotencyCleanup,
} from "./middleware/idempotency";
import { loggingMiddleware } from "./middleware/logging";
import { maintenanceMiddleware } from "./middleware/maintenance";
import { apiSecurityHeaders } from "./middleware/security-headers";
import { routes } from "./routes";
import { initializeAgentService } from "./services/agent";
import { startAgentEvents } from "./services/agent-events";
import {
  startAgentHealthScoreBroadcaster,
  stopAgentHealthScoreBroadcaster,
} from "./services/agent-health-score.service";
import {
  startStateCleanupJob,
  stopStateCleanupJob,
} from "./services/agent-state-machine";
import { initCassService } from "./services/cass.service";
import { getConfig, loadConfig } from "./services/config.service";
import {
  startDCGCleanupJob,
  stopDCGCleanupJob,
} from "./services/dcg-pending.service";
import {
  startCleanupJob as startHandoffCleanupJob,
  stopCleanupJob as stopHandoffCleanupJob,
} from "./services/handoff.service";
import { getJobService } from "./services/job.service";
import { logger } from "./services/logger";
import {
  getMaintenanceSnapshot,
  getMaintenanceState,
  startDraining,
} from "./services/maintenance.service";
import { registerAgentMailToolCallerFromEnv } from "./services/mcp-agentmail";
import {
  getNtmIngestService,
  startNtmIngest,
  stopNtmIngest,
} from "./services/ntm-ingest.service";
import {
  startNtmWsBridge,
  stopNtmWsBridge,
} from "./services/ntm-ws-bridge.service";
import { initTracing, shutdownTracing } from "./services/otel.service";
import {
  startCleanupJob as startReservationCleanupJob,
  stopCleanupJob as stopReservationCleanupJob,
} from "./services/reservation.service";
import {
  startCleanupJob as startSafetyCleanupJob,
  stopCleanupJob as stopSafetyCleanupJob,
} from "./services/safety.service";
import {
  startCleanupJob as startWsEventLogCleanupJob,
  stopCleanupJob as stopWsEventLogCleanupJob,
} from "./services/ws-event-log.service";
import {
  enforceStartupSecurity,
  logStartupSecurityWarnings,
} from "./startup-warnings";
import {
  createGuestAuthContext,
  createInternalAuthContext,
} from "./ws/authorization";
import { handleWSClose, handleWSMessage, handleWSOpen } from "./ws/handlers";
import { startHeartbeat, stopHeartbeat } from "./ws/heartbeat";
import { getHub } from "./ws/hub";

// Register available agent drivers
registerDrivers();

const app = new Hono();

// Apply global middlewares
app.use("*", correlationMiddleware());
app.use("*", loggingMiddleware());
app.use("*", apiSecurityHeaders());
app.use("*", authMiddleware());
app.use("*", maintenanceMiddleware());
app.use(
  "*",
  idempotencyMiddleware({
    excludePaths: ["/health"],
  }),
);

// Global error handler - catches any uncaught exceptions
// Handles ZodError (validation), SyntaxError (JSON parsing), and all other errors
app.onError(globalErrorHandler);

// Mount all routes
app.route("/", routes);

export default app;

if (import.meta.main) {
  // Load configuration (async but we block on it during startup)
  await loadConfig({ cwd: process.cwd() });
  const config = getConfig();

  // Initialize tracing early so subsequent services can create spans.
  initTracing(config.otel);

  const port = config.server.port;
  const host = config.server.host;
  logStartupSecurityWarnings({ host, port });
  enforceStartupSecurity({ host, port });

  // Start background jobs
  startReservationCleanupJob();
  startDCGCleanupJob();
  startStateCleanupJob();
  startSafetyCleanupJob();
  startHandoffCleanupJob();
  startWsEventLogCleanupJob();
  startHeartbeat();
  const agentEvents = startAgentEvents(getHub());
  await initializeAgentService();
  startAgentHealthScoreBroadcaster();

  // Initialize CASS service
  initCassService({ cwd: process.cwd() });

  // Start NTM services if enabled
  if (config.ntm.enabled) {
    // Start NTM ingest service (polls NTM status and updates agent states)
    startNtmIngest({
      cwd: process.cwd(),
      pollIntervalMs: config.ntm.pollIntervalMs,
      commandTimeoutMs: config.ntm.commandTimeoutMs,
      maxBackoffMultiplier: config.ntm.maxBackoffMultiplier,
    });

    // Start NTM WebSocket bridge if enabled (publishes NTM events to WebSocket channels)
    if (config.ntm.wsBridge.enabled) {
      const ntmRunner = createBunNtmCommandRunner();
      const ntmClient = createNtmClient({
        runner: ntmRunner,
        cwd: process.cwd(),
      });
      const ingestService = getNtmIngestService();
      startNtmWsBridge(getHub(), ingestService, ntmClient, {
        tailPollIntervalMs: config.ntm.wsBridge.tailPollIntervalMs,
        tailLines: config.ntm.wsBridge.tailLines,
        enableOutputStreaming: config.ntm.wsBridge.enableOutputStreaming,
        enableThrottling: config.ntm.wsBridge.throttling.enabled,
        batchWindowMs: config.ntm.wsBridge.throttling.batchWindowMs,
        maxEventsPerBatch: config.ntm.wsBridge.throttling.maxEventsPerBatch,
        debounceMs: config.ntm.wsBridge.throttling.debounceMs,
      });
      logger.info(
        {
          pollIntervalMs: config.ntm.pollIntervalMs,
          wsBridgeEnabled: true,
          throttlingEnabled: config.ntm.wsBridge.throttling.enabled,
        },
        "NTM integration started",
      );
    } else {
      logger.info(
        { pollIntervalMs: config.ntm.pollIntervalMs, wsBridgeEnabled: false },
        "NTM ingest started (WS bridge disabled)",
      );
    }
  } else {
    logger.info("NTM integration disabled by configuration");
  }

  const mcpEnabled = registerAgentMailToolCallerFromEnv();
  if (mcpEnabled) {
    logger.info("Agent Mail MCP tool caller registered");
  }
  logger.info({ host, port }, "Starting Flywheel Gateway");
  const bunServer = Bun.serve({
    hostname: host,
    async fetch(req, server) {
      // Handle WebSocket upgrade
      const url = new URL(req.url);

      // New generic WS endpoint (e.g. /ws) or keep existing /agents/*/ws for backward compat?
      const agentMatch = url.pathname.match(/^\/agents\/([^/]+)\/ws$/);
      if (agentMatch || url.pathname === "/ws") {
        const maintenanceMode = getMaintenanceState().mode;
        if (maintenanceMode !== "running") {
          const snapshot = getMaintenanceSnapshot();
          const headers = new Headers({
            "Content-Type": "application/json",
          });
          if (snapshot.retryAfterSeconds !== null) {
            headers.set("Retry-After", String(snapshot.retryAfterSeconds));
          }

          const code =
            maintenanceMode === "draining" ? "DRAINING" : "MAINTENANCE_MODE";
          const message =
            maintenanceMode === "draining"
              ? "Service is draining"
              : "Service in maintenance mode";

          return new Response(
            JSON.stringify({
              error: {
                code,
                message,
                details: {
                  mode: snapshot.mode,
                  deadlineAt: snapshot.deadlineAt,
                  retryAfterSeconds: snapshot.retryAfterSeconds,
                },
              },
            }),
            { status: 503, headers },
          );
        }

        const initialSubscriptions = new Map<string, string | undefined>();

        // Auto-subscribe if connecting to specific agent endpoint
        if (agentMatch) {
          const agentId = agentMatch[1];
          // Subscribe to standard agent channels
          initialSubscriptions.set(`agent:output:${agentId}`, undefined);
          initialSubscriptions.set(`agent:state:${agentId}`, undefined);
          initialSubscriptions.set(`agent:tools:${agentId}`, undefined);
        }

        const initialCursor = url.searchParams.get("cursor")?.trim();
        if (initialCursor) {
          for (const channelStr of initialSubscriptions.keys()) {
            initialSubscriptions.set(channelStr, initialCursor);
          }
        }

        // Check for authentication
        const authHeader = req.headers.get("Authorization");
        const urlToken = url.searchParams.get("token");
        const token = getBearerToken(authHeader) ?? urlToken?.trim();

        const adminKey = process.env["GATEWAY_ADMIN_KEY"]?.trim();
        const jwtSecret = process.env["JWT_SECRET"]?.trim();
        const authEnabled = Boolean(adminKey || jwtSecret);

        if (authEnabled && !token) {
          return new Response("Unauthorized", { status: 401 });
        }

        // When auth is disabled, treat WS connections as internal/admin so the
        // local dashboard can subscribe (workspace/user channels require auth).
        let authContext = authEnabled
          ? createGuestAuthContext()
          : createInternalAuthContext();
        if (authEnabled && token) {
          if (adminKey && safeCompare(token, adminKey)) {
            authContext = createInternalAuthContext();
          } else if (jwtSecret) {
            const result = await verifyJwtHs256(token, jwtSecret);
            if (!result.ok) {
              return new Response("Unauthorized", { status: 401 });
            }
            authContext = buildAuthContext(result.payload);
          } else {
            return new Response("Unauthorized", { status: 401 });
          }
        }

        const upgraded = server.upgrade(req, {
          data: {
            connectionId: `ws_${crypto.randomUUID()}`,
            connectedAt: new Date(),
            auth: authContext,
            subscriptions: initialSubscriptions,
            lastHeartbeat: new Date(),
            pendingAcks: new Map(),
            activeReplays: 0,
          },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }
      // Handle regular HTTP requests via Hono
      return app.fetch(req, { server });
    },
    port,
    websocket: {
      open: handleWSOpen,
      message: handleWSMessage,
      close: handleWSClose,
    },
  });

  let shutdownInProgress = false;

  async function getJobCountsForShutdown(): Promise<{
    running: number;
    pending: number;
  }> {
    try {
      const runningRow = await db
        .select({ count: sql<number>`count(*)` })
        .from(jobs)
        .where(eq(jobs.status, "running"));

      const pendingRow = await db
        .select({ count: sql<number>`count(*)` })
        .from(jobs)
        .where(eq(jobs.status, "pending"));

      return {
        running: Number(runningRow[0]?.count ?? 0),
        pending: Number(pendingRow[0]?.count ?? 0),
      };
    } catch {
      return { running: 0, pending: 0 };
    }
  }

  async function initiateShutdown(signal: "SIGINT" | "SIGTERM"): Promise<void> {
    const deadlineSecondsRaw =
      process.env["GATEWAY_DRAIN_DEADLINE_SECONDS"]?.trim();
    const deadlineSeconds = Math.max(
      1,
      Math.min(
        300,
        deadlineSecondsRaw ? Number.parseInt(deadlineSecondsRaw, 10) || 30 : 30,
      ),
    );
    const startedAt = Date.now();
    const shutdownDeadlineAt = startedAt + deadlineSeconds * 1000;

    // Enter drain mode first: closes active WebSockets and returns 503 for mutating routes.
    startDraining({ deadlineSeconds, reason: `shutdown:${signal}` });

    let wsActiveConnections = 0;
    try {
      wsActiveConnections = getHub().getStats().activeConnections;
    } catch {
      // Hub may not be initialized in all contexts.
    }

    const maintenanceSnapshot = getMaintenanceSnapshot();
    const jobCounts = await getJobCountsForShutdown();

    logger.info(
      {
        signal,
        deadlineSeconds,
        http: { inflightRequests: maintenanceSnapshot.http.inflightRequests },
        ws: { activeConnections: wsActiveConnections },
        jobs: jobCounts,
      },
      "Shutdown initiated",
    );

    // Stop accepting new network connections, but do not forcibly close in-flight requests.
    await bunServer.stop(false);

    // Stop background loops (best-effort, idempotent).
    stopHeartbeat();
    stopIdempotencyCleanup();
    agentEvents.stop();
    stopAgentHealthScoreBroadcaster();
    stopStateCleanupJob();
    stopDCGCleanupJob();
    stopReservationCleanupJob();
    stopSafetyCleanupJob();
    stopHandoffCleanupJob();
    stopWsEventLogCleanupJob();
    stopNtmWsBridge();
    stopNtmIngest();

    // Stop job worker, bounded by the overall shutdown deadline.
    await Promise.race([
      getJobService().stop(),
      Bun.sleep(Math.max(0, shutdownDeadlineAt - Date.now())),
    ]);

    // Wait for in-flight HTTP requests (bounded).
    while (Date.now() < shutdownDeadlineAt) {
      const snapshot = getMaintenanceSnapshot();
      if (snapshot.http.inflightRequests <= 0) break;
      await Bun.sleep(100);
    }

    // If anything is still active, force-close remaining connections.
    await bunServer.stop(true);

    // Best-effort flush/shutdown of telemetry before exit (bounded).
    const remainingMs = Math.max(0, shutdownDeadlineAt - Date.now());
    await shutdownTracing({ timeoutMs: Math.min(5_000, remainingMs) });

    const finalJobCounts = await getJobCountsForShutdown();
    const durationMs = Date.now() - startedAt;
    const finalSnapshot = getMaintenanceSnapshot();

    let finalWsConnections = 0;
    try {
      finalWsConnections = getHub().getStats().activeConnections;
    } catch {
      // Hub may not be initialized in all contexts.
    }

    logger.info(
      {
        signal,
        durationMs,
        http: { inflightRequests: finalSnapshot.http.inflightRequests },
        ws: { activeConnections: finalWsConnections },
        jobs: finalJobCounts,
      },
      "Shutdown complete",
    );

    process.exit(0);
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (shutdownInProgress) {
        logger.warn(
          { signal },
          "Second shutdown signal received; forcing exit",
        );
        void bunServer.stop(true).finally(() => {
          process.exit(1);
        });
        return;
      }
      shutdownInProgress = true;
      void initiateShutdown(signal).catch((error) => {
        logger.error({ error, signal }, "Shutdown handler failed");
        void bunServer.stop(true).finally(() => {
          process.exit(1);
        });
      });
    });
  }
}
