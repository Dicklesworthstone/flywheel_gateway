import type { Context, Next } from "hono";
import {
  getMaintenanceSnapshot,
  getMaintenanceState,
  trackHttpRequestEnd,
  trackHttpRequestStart,
} from "../services/maintenance.service";
import { sendError } from "../utils/response";

export interface MaintenanceMiddlewareOptions {
  /**
   * Exact paths (or path prefixes) that should be allowed even in maintenance.
   *
   * Prefix semantics: if a path in this list ends with `/*`, treat it as a
   * prefix match. Otherwise require exact match.
   */
  allowPaths?: string[];
}

function isMutatingMethod(method: string): boolean {
  switch (method.toUpperCase()) {
    case "POST":
    case "PUT":
    case "PATCH":
    case "DELETE":
      return true;
    default:
      return false;
  }
}

function isAllowedPath(pathname: string, allowPaths: string[]): boolean {
  for (const rule of allowPaths) {
    if (rule.endsWith("/*")) {
      const prefix = rule.slice(0, -2);
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
      continue;
    }
    if (pathname === rule) return true;
  }
  return false;
}

/**
 * Global maintenance guard.
 *
 * - Allows reads during maintenance/draining.
 * - Blocks mutating requests with a stable 503 error.
 */
export function maintenanceMiddleware(
  options: MaintenanceMiddlewareOptions = {},
) {
  const allowPaths = options.allowPaths ?? ["/health", "/system/maintenance"];

  return async (c: Context, next: Next) => {
    const pathname = new URL(c.req.url).pathname;

    if (isAllowedPath(pathname, allowPaths)) {
      await next();
      return;
    }

    const mode = getMaintenanceState().mode;
    if (mode !== "running" && isMutatingMethod(c.req.method)) {
      const snapshot = getMaintenanceSnapshot();
      if (snapshot.retryAfterSeconds !== null) {
        c.header("Retry-After", String(snapshot.retryAfterSeconds));
      }

      const code = mode === "draining" ? "DRAINING" : "MAINTENANCE_MODE";
      const message =
        mode === "draining"
          ? "Service is draining"
          : "Service in maintenance mode";

      return sendError(c, code, message, 503, {
        severity: "retry",
        details: {
          mode: snapshot.mode,
          deadlineAt: snapshot.deadlineAt,
          retryAfterSeconds: snapshot.retryAfterSeconds,
        },
      });
    }

    trackHttpRequestStart();
    try {
      await next();
    } finally {
      trackHttpRequestEnd();
    }
  };
}
