import { Hono } from "hono";
import { correlationMiddleware } from "./middleware/correlation";
import { loggingMiddleware } from "./middleware/logging";
import { routes } from "./routes";
import { logger } from "./services/logger";

const app = new Hono();

// Apply global middlewares
app.use("*", correlationMiddleware());
app.use("*", loggingMiddleware());

// Mount all routes
app.route("/", routes);

export default app;

if (import.meta.main) {
  const port = Number(process.env["PORT"]) || 3000;
  logger.info({ port }, "Starting Flywheel Gateway");
  Bun.serve({
    fetch: app.fetch,
    port,
  });
}
