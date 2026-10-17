/**
 * Global Error Handler Middleware.
 *
 * Catches all uncaught errors and returns standardized API error responses.
 * This ensures consistent error formatting even when individual route handlers
 * forget to wrap their code in try-catch blocks.
 */

import type { Context } from "hono";
import type { ZodError } from "zod";
import {
  sendError,
  sendInternalError,
  sendValidationError,
} from "../utils/response";
import { isZodError, transformZodError } from "../utils/validation";
import { getCorrelationId, getLogger } from "./correlation";

/**
 * Global error handler for the Hono app.
 *
 * Handles the following error types:
 * - ZodError: Returns 400 with validation errors
 * - SyntaxError (JSON): Returns 400 with invalid request error
 * - All other errors: Returns 500 with internal error
 *
 * All errors are logged with correlation ID for debugging.
 *
 * @example
 * ```typescript
 * const app = new Hono();
 * app.onError(globalErrorHandler);
 * ```
 */
export function globalErrorHandler(err: Error, c: Context): Response {
  const log = getLogger();
  const correlationId = getCorrelationId();

  // Handle Zod validation errors
  if (isZodError(err)) {
    log.warn({ correlationId, error: err }, "Validation error in route");
    return sendValidationError(c, transformZodError(err as ZodError));
  }

  // Handle JSON parsing errors
  if (err instanceof SyntaxError && err.message.includes("JSON")) {
    log.warn({ correlationId, error: err }, "JSON parsing error in route");
    return sendError(c, "INVALID_REQUEST", "Invalid JSON in request body", 400);
  }

  // Handle all other errors as internal errors
  log.error(
    { correlationId, error: err, stack: err.stack },
    "Unhandled error in route",
  );
  return sendInternalError(c);
}

/**
 * Middleware factory for global error handling.
 *
 * This is an alternative to using app.onError() directly.
 * It wraps the error handler in a middleware format.
 *
 * @deprecated Use globalErrorHandler with app.onError() instead
 */
export function errorHandlerMiddleware() {
  return async (c: Context, next: () => Promise<void>) => {
    try {
      await next();
    } catch (err) {
      if (err instanceof Error) {
        return globalErrorHandler(err, c);
      }
      // Unknown error type, wrap it
      const wrappedError = new Error(String(err));
      return globalErrorHandler(wrappedError, c);
    }
  };
}
