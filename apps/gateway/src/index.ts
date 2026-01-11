import { Hono } from "hono";
import { registerDrivers } from "./config/drivers";
import { correlationMiddleware } from "./middleware/correlation";
import { idempotencyMiddleware } from "./middleware/idempotency";
import { loggingMiddleware } from "./middleware/logging";
import { routes } from "./routes";
import { startAgentEvents } from "./services/agent-events";
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
  const port = Number(process.env["PORT"]) || 3000;

  // Start background jobs
  startCleanupJob();
  startHeartbeat();
  startAgentEvents(getHub());

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
