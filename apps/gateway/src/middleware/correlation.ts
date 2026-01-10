import { AsyncLocalStorage } from "node:async_hooks";
import type { Context, Next } from "hono";
import type { Logger } from "../services/logger";
import { createChildLogger, logger } from "../services/logger";

/**
 * Request context stored in AsyncLocalStorage.
 */
export interface RequestContext {
  correlationId: string;
  requestId: string;
  startTime: number;
  logger: Logger;
}

/**
 * AsyncLocalStorage instance for request context propagation.
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Get the current request context from AsyncLocalStorage.
 * Returns undefined if called outside of a request context.
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Get the correlation ID from the current request context.
 * Returns "unknown" if called outside of a request context.
 */
export function getCorrelationId(): string {
  return getRequestContext()?.correlationId ?? "unknown";
}

/**
 * Get the request-scoped logger from the current context.
 * Falls back to the base logger if called outside of a request context.
 */
export function getLogger(): Logger {
  return getRequestContext()?.logger ?? logger;
}

/**
 * Generate a UUID v4 for correlation IDs.
 * Uses crypto.randomUUID which is available in Bun/Node.
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Correlation ID middleware for Hono.
 *
 * - Accepts incoming X-Correlation-ID header or generates a new one
 * - Stores context in AsyncLocalStorage for automatic propagation
 * - Adds X-Correlation-ID and X-Request-ID to response headers
 */
export function correlationMiddleware() {
  return async (c: Context, next: Next) => {
    const incomingCorrelationId = c.req.header("x-correlation-id");
    const correlationId = incomingCorrelationId || generateId();
    const requestId = generateId();
    const startTime = performance.now();

    const requestLogger = createChildLogger({
      correlationId,
      requestId,
      method: c.req.method,
      path: c.req.path,
    });

    const context: RequestContext = {
      correlationId,
      requestId,
      startTime,
      logger: requestLogger,
    };

    // Set response headers
    c.header("X-Correlation-ID", correlationId);
    c.header("X-Request-ID", requestId);
    c.set("correlationId", correlationId);
    c.set("requestId", requestId);

    // Run the rest of the middleware chain within the context
    await requestContextStorage.run(context, async () => {
      await next();
    });
  };
}
