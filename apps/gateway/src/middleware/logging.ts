import type { Context, Next } from "hono";
import { redactSensitiveData } from "../services/audit-redaction.service";
import { getLogger, getRequestContext } from "./correlation";

/**
 * Request/response logging middleware for Hono.
 *
 * Logs:
 * - Incoming requests with method, path, and query params
 * - Outgoing responses with status code and duration
 * - Automatically redacts sensitive data from logged objects
 */
export function loggingMiddleware() {
  return async (c: Context, next: Next) => {
    const log = getLogger();
    const ctx = getRequestContext();
    const startTime = ctx?.startTime ?? performance.now();

    // Log incoming request
    log.info(
      {
        type: "request",
        query: redactSensitiveData(c.req.query()),
        userAgent: c.req.header("user-agent"),
        ip: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip"),
      },
      `→ ${c.req.method} ${c.req.path}`,
    );

    try {
      await next();
    } catch (error) {
      // Log errors
      const duration = Math.round(performance.now() - startTime);
      log.error(
        {
          type: "error",
          duration,
          error:
            error instanceof Error
              ? { message: error.message, name: error.name }
              : String(error),
        },
        `✗ ${c.req.method} ${c.req.path} - Error`,
      );
      throw error;
    }

    // Log response
    const duration = Math.round(performance.now() - startTime);
    const status = c.res.status;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";

    log[level](
      {
        type: "response",
        status,
        duration,
      },
      `← ${c.req.method} ${c.req.path} ${status} (${duration}ms)`,
    );
  };
}
