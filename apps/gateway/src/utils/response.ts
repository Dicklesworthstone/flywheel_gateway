/**
 * Hono Response Helpers.
 *
 * Provides convenient response helpers for Hono route handlers that
 * automatically wrap data in canonical API response envelopes and
 * include correlation IDs.
 */

import type { Context, TypedResponse } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  type ApiErrorResponse,
  type ApiListResponse,
  type ApiResponse,
  type WrapErrorOptions,
  type WrapListOptions,
  type WrapResourceOptions,
  wrapCreated,
  wrapEmptyList,
  wrapError,
  wrapList,
  wrapNotFound,
  wrapResource,
  wrapValidationError,
} from "@flywheel/shared";
import { getCorrelationId } from "../middleware/correlation";

// ============================================================================
// Single Resource Responses
// ============================================================================

/**
 * Send a wrapped single resource response.
 *
 * @param c - Hono context
 * @param objectType - The resource type identifier
 * @param data - The resource data
 * @param status - HTTP status code (default: 200)
 * @param options - Additional wrapper options
 * @returns JSON response with wrapped envelope
 *
 * @example
 * ```typescript
 * app.get("/agents/:id", async (c) => {
 *   const agent = await getAgent(c.req.param("id"));
 *   return sendResource(c, "agent", agent);
 * });
 * ```
 */
export function sendResource<T>(
  c: Context,
  objectType: string,
  data: T,
  status: ContentfulStatusCode = 200,
  options: Omit<WrapResourceOptions, "requestId"> = {},
) {
  const requestId = getCorrelationId();
  return c.json(
    wrapResource(objectType, data, { ...options, requestId }),
    status,
  );
}

/**
 * Send a wrapped created resource response (HTTP 201).
 *
 * @param c - Hono context
 * @param objectType - The resource type identifier
 * @param data - The created resource data
 * @param selfUrl - URL for the created resource
 * @param options - Additional wrapper options
 * @returns JSON response with created envelope
 *
 * @example
 * ```typescript
 * app.post("/agents", async (c) => {
 *   const agent = await createAgent(c.req.json());
 *   return sendCreated(c, "agent", agent, `/agents/${agent.id}`);
 * });
 * ```
 */
export function sendCreated<T>(
  c: Context,
  objectType: string,
  data: T,
  selfUrl: string,
  options: Omit<WrapResourceOptions, "requestId" | "links"> = {},
) {
  const requestId = getCorrelationId();
  return c.json(wrapCreated(objectType, data, selfUrl, { ...options, requestId }), 201);
}

// ============================================================================
// List Responses
// ============================================================================

/**
 * Send a wrapped list response.
 *
 * @param c - Hono context
 * @param data - Array of items
 * @param options - Pagination options (hasMore, nextCursor, total)
 * @returns JSON response with list envelope
 *
 * @example
 * ```typescript
 * app.get("/agents", async (c) => {
 *   const { agents, hasMore, cursor, total } = await listAgents();
 *   return sendList(c, agents, { hasMore, nextCursor: cursor, total });
 * });
 * ```
 */
export function sendList<T>(
  c: Context,
  data: T[],
  options: Omit<WrapListOptions, "url" | "requestId"> = {},
) {
  const requestId = getCorrelationId();
  const url = new URL(c.req.url).pathname;
  return c.json(wrapList(data, { ...options, url, requestId }));
}

/**
 * Send an empty list response.
 *
 * @param c - Hono context
 * @returns JSON response with empty list envelope
 *
 * @example
 * ```typescript
 * if (agents.length === 0) {
 *   return sendEmptyList(c);
 * }
 * ```
 */
export function sendEmptyList<T = never>(c: Context) {
  const requestId = getCorrelationId();
  const url = new URL(c.req.url).pathname;
  return c.json(wrapEmptyList<T>(url, { requestId }));
}

// ============================================================================
// Error Responses
// ============================================================================

/**
 * Send a wrapped error response.
 *
 * @param c - Hono context
 * @param code - Error code from taxonomy or custom code
 * @param message - Human-readable error message
 * @param status - HTTP status code
 * @param options - Additional error options
 * @returns JSON response with error envelope
 *
 * @example
 * ```typescript
 * return sendError(c, "AGENT_NOT_FOUND", "Agent not found", 404);
 * ```
 */
export function sendError(
  c: Context,
  code: string,
  message: string,
  status: ContentfulStatusCode,
  options: Omit<WrapErrorOptions, "code" | "message" | "requestId"> = {},
) {
  const requestId = getCorrelationId();
  return c.json(wrapError({ code, message, ...options, requestId }), status);
}

/**
 * Send a not found error response (HTTP 404).
 *
 * @param c - Hono context
 * @param resourceType - Type of resource that wasn't found
 * @param identifier - ID or identifier of the missing resource
 * @returns JSON response with not found error
 *
 * @example
 * ```typescript
 * if (!agent) {
 *   return sendNotFound(c, "agent", id);
 * }
 * ```
 */
export function sendNotFound(
  c: Context,
  resourceType: string,
  identifier: string,
) {
  const requestId = getCorrelationId();
  return c.json(wrapNotFound(resourceType, identifier, { requestId }), 404);
}

/**
 * Send a validation error response (HTTP 400).
 *
 * @param c - Hono context
 * @param errors - Array of validation errors
 * @returns JSON response with validation error
 *
 * @example
 * ```typescript
 * return sendValidationError(c, [
 *   { path: "status", message: "Invalid status value" },
 *   { path: "ttl", message: "TTL must be positive" }
 * ]);
 * ```
 */
export function sendValidationError(
  c: Context,
  errors: Array<{ path: string; message: string; code?: string }>,
) {
  const requestId = getCorrelationId();
  return c.json(wrapValidationError(errors, { requestId }), 400);
}

/**
 * Send an internal error response (HTTP 500).
 *
 * @param c - Hono context
 * @param message - Error message (default: "Internal server error")
 * @returns JSON response with internal error
 */
export function sendInternalError(c: Context, message = "Internal server error") {
  const requestId = getCorrelationId();
  return c.json(
    wrapError({
      code: "INTERNAL_ERROR",
      message,
      requestId,
      severity: "retry",
      hint: "Retry the request. If the issue persists, contact support.",
    }),
    500,
  );
}

/**
 * Send a conflict error response (HTTP 409).
 *
 * @param c - Hono context
 * @param code - Error code
 * @param message - Error message
 * @param options - Additional error options
 * @returns JSON response with conflict error
 */
export function sendConflict(
  c: Context,
  code: string,
  message: string,
  options: Omit<WrapErrorOptions, "code" | "message" | "requestId"> = {},
) {
  const requestId = getCorrelationId();
  return c.json(wrapError({ code, message, ...options, requestId }), 409);
}

/**
 * Send a forbidden error response (HTTP 403).
 *
 * @param c - Hono context
 * @param message - Error message (default: "Access denied")
 * @returns JSON response with forbidden error
 */
export function sendForbidden(c: Context, message = "Access denied") {
  const requestId = getCorrelationId();
  return c.json(
    wrapError({
      code: "FORBIDDEN",
      message,
      requestId,
      severity: "terminal",
      hint: "Check your permissions or use a different account.",
    }),
    403,
  );
}

/**
 * Send an unauthorized error response (HTTP 401).
 *
 * @param c - Hono context
 * @param message - Error message (default: "Authentication required")
 * @returns JSON response with unauthorized error
 */
export function sendUnauthorized(c: Context, message = "Authentication required") {
  const requestId = getCorrelationId();
  return c.json(
    wrapError({
      code: "UNAUTHORIZED",
      message,
      requestId,
      severity: "recoverable",
      hint: "Provide valid authentication credentials.",
    }),
    401,
  );
}
