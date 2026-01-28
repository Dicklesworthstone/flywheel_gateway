import { Hono } from "hono";
import { registerDrivers } from "./config/drivers";
import { correlationMiddleware } from "./middleware/correlation";
import { idempotencyMiddleware } from "./middleware/idempotency";
import { loggingMiddleware } from "./middleware/logging";
import { apiSecurityHeaders } from "./middleware/security-headers";
import { routes } from "./routes";
import { startAgentEvents } from "./services/agent-events";
import { startStateCleanupJob } from "./services/agent-state-machine";
import { initializeAgentService } from "./services/agent";
import { initCassService } from "./services/cass.service";
import { getConfig, loadConfig } from "./services/config.service";
import {
  getNtmIngestService,
  startNtmIngest,
} from "./services/ntm-ingest.service";
import { startNtmWsBridge } from "./services/ntm-ws-bridge.service";
import {
  createBunNtmCommandRunner,
  createNtmClient,
} from "@flywheel/flywheel-clients";
import { startDCGCleanupJob } from "./services/dcg-pending.service";
import { logger } from "./services/logger";
import { registerAgentMailToolCallerFromEnv } from "./services/mcp-agentmail";
import { startCleanupJob } from "./services/reservation.service";
import { createGuestAuthContext } from "./ws/authorization";
import { handleWSClose, handleWSMessage, handleWSOpen } from "./ws/handlers";
import { startHeartbeat } from "./ws/heartbeat";
import { getHub } from "./ws/hub";

// Register available agent drivers
registerDrivers();

const app = new Hono();

// Apply global middlewares
app.use("*", correlationMiddleware());
app.use("*", loggingMiddleware());
app.use("*", apiSecurityHeaders());
app.use(
  "*",
  idempotencyMiddleware({
    excludePaths: ["/health"],
  }),
);

// Mount all routes
app.route("/", routes);

export default app;

if (import.meta.main) {
  // Load configuration (async but we block on it during startup)
  await loadConfig({ cwd: process.cwd() });
  const config = getConfig();

  const port = config.server.port;

  // Start background jobs
  startCleanupJob();
  startDCGCleanupJob();
  startStateCleanupJob();
  startHeartbeat();
  startAgentEvents(getHub());
  await initializeAgentService();

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
  logger.info({ port }, "Starting Flywheel Gateway");
  Bun.serve({
    fetch(req, server) {
      // Handle WebSocket upgrade
      const url = new URL(req.url);

      // New generic WS endpoint (e.g. /ws) or keep existing /agents/*/ws for backward compat?
      const agentMatch = url.pathname.match(/^\/agents\/([^/]+)\/ws$/);
      if (agentMatch || url.pathname === "/ws") {
        const initialSubscriptions = new Map<string, string | undefined>();

        // Auto-subscribe if connecting to specific agent endpoint
        if (agentMatch) {
          const agentId = agentMatch[1];
          // Subscribe to standard agent channels
          initialSubscriptions.set(`agent:output:${agentId}`, undefined);
          initialSubscriptions.set(`agent:state:${agentId}`, undefined);
          initialSubscriptions.set(`agent:tools:${agentId}`, undefined);
        }

        const upgraded = server.upgrade(req, {
          data: {
            connectionId: `ws_${crypto.randomUUID()}`,
            connectedAt: new Date(),
            auth: createGuestAuthContext(), // TODO: Real auth
            subscriptions: initialSubscriptions,
            lastHeartbeat: new Date(),
            pendingAcks: new Map(),
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
}
