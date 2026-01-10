import { Hono } from "hono";
import {
  correlationMiddleware,
  getCorrelationId,
} from "./middleware/correlation";
import { loggingMiddleware } from "./middleware/logging";
import { logger } from "./services/logger";

const app = new Hono();

// Apply middlewares
app.use("*", correlationMiddleware());
app.use("*", loggingMiddleware());

// Health endpoint - includes correlation ID in response
app.get("/health", (c) => {
  return c.json({
    ok: true,
    timestamp: new Date().toISOString(),
    correlationId: getCorrelationId(),
  });
});

export default app;

if (import.meta.main) {
  const port = Number(process.env["PORT"]) || 3000;
  logger.info({ port }, "Starting Flywheel Gateway");
  Bun.serve({
    fetch: app.fetch,
    port,
  });
}
