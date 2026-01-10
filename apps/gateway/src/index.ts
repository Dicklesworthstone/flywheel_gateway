import { Hono } from "hono";
import { correlationMiddleware } from "./middleware/correlation";
import { idempotencyMiddleware } from "./middleware/idempotency";
import { loggingMiddleware } from "./middleware/logging";
import { routes } from "./routes";
import {
  createWSData,
  handleWSClose,
  handleWSError,
  handleWSMessage,
  handleWSOpen,
} from "./services/agent-ws";
import { logger } from "./services/logger";
import { registerAgentMailToolCallerFromEnv } from "./services/mcp-agentmail";

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
  const mcpEnabled = registerAgentMailToolCallerFromEnv();
  if (mcpEnabled) {
    logger.info("Agent Mail MCP tool caller registered");
  }
  logger.info({ port }, "Starting Flywheel Gateway");
  Bun.serve({
    fetch(req, server) {
      // Handle WebSocket upgrade for agent state subscriptions
      const url = new URL(req.url);
      const match = url.pathname.match(/^\/agents\/([^/]+)\/ws$/);
      if (match) {
        const agentId = match[1];
        const upgraded = server.upgrade(req, {
          data: createWSData([agentId]),
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
      error: handleWSError,
    },
  });
}
