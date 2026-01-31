/**
 * Shared Error Handler Utility.
 *
 * Provides a factory function for creating consistent route error handlers.
 * Routes can use the base handler or extend it with domain-specific error handling.
 *
 * @example Basic usage:
 * ```typescript
 * const handleError = createRouteErrorHandler("history");
 *
 * route.get("/", async (c) => {
 *   try {
 *     // ... handler logic
 *   } catch (error) {
 *     return handleError(error, c);
 *   }
 * });
 * ```
 *
 * @example With domain-specific errors:
 * ```typescript
 * import { DCGPackNotFoundError, DCGNotAvailableError } from "../services/dcg";
 *
 * const handleError = createRouteErrorHandler("dcg", [
 *   {
 *     match: (err) => err instanceof DCGPackNotFoundError,
 *     handle: (err, c) => sendNotFound(c, "pack", (err as DCGPackNotFoundError).packId),
 *   },
 *   {
 *     match: (err) => err instanceof DCGNotAvailableError,
 *     handle: (_, c) => sendError(c, "DCG_NOT_AVAILABLE", "DCG CLI is not available", 503),
 *   },
 * ]);
 * ```
 */

import type { Context } from "hono";
import type { ZodError } from "zod";
import { getLogger } from "../middleware/correlation";
import { sendError, sendInternalError, sendValidationError } from "./response";
import { isZodError, transformZodError } from "./validation";

/**
 * Domain-specific error handler definition.
 */
export interface DomainErrorHandler {
  /**
   * Predicate to check if this handler matches the error.
   */
  match: (error: unknown) => boolean;

  /**
   * Handler function that returns the appropriate response.
   * Return null/undefined to fall through to the next handler.
   */
  handle: (error: unknown, c: Context) => Response | undefined;
}

/**
 * Route error handler function type.
 */
export type RouteErrorHandler = (error: unknown, c: Context) => Response;

/**
 * Create an error handler for a route.
 *
 * The handler processes errors in the following order:
 * 1. Domain-specific handlers (if provided)
 * 2. ZodError → 400 validation error
 * 3. JSON SyntaxError → 400 invalid request
 * 4. All other errors → 500 internal error with logging
 *
 * @param routeName - Name of the route for logging context
 * @param domainHandlers - Optional array of domain-specific error handlers
 * @returns Error handler function
 */
export function createRouteErrorHandler(
  routeName: string,
  domainHandlers?: DomainErrorHandler[],
): RouteErrorHandler {
  return function handleError(error: unknown, c: Context): Response {
    const log = getLogger();

    // Try domain-specific handlers first
    if (domainHandlers && domainHandlers.length > 0) {
      for (const handler of domainHandlers) {
        if (handler.match(error)) {
          const result = handler.handle(error, c);
          if (result) {
            return result;
          }
        }
      }
    }

    // Handle Zod validation errors
    if (isZodError(error)) {
      return sendValidationError(c, transformZodError(error as ZodError));
    }

    // Handle JSON parsing errors
    if (error instanceof SyntaxError && error.message.includes("JSON")) {
      return sendError(
        c,
        "INVALID_REQUEST",
        "Invalid JSON in request body",
        400,
      );
    }

    // Log and return internal error for all other cases
    log.error({ error }, `Unexpected error in ${routeName} route`);
    return sendInternalError(c);
  };
}

/**
 * Pre-configured error handler for routes that only need base handling.
 * Use createRouteErrorHandler() when you need domain-specific errors.
 */
export const baseHandleError = createRouteErrorHandler("unknown");
