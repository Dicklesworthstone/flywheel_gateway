/**
 * Response Wrapper Utility Functions.
 *
 * Provides convenience functions to wrap data into canonical API response
 * envelopes. Use these to ensure consistent response structure across
 * all endpoints.
 */

import { AI_HINTS } from "../errors/ai-hints";
import type { ErrorCode } from "../errors/codes";
import type {
  ApiError,
  ApiErrorResponse,
  ApiListResponse,
  ApiResponse,
} from "./envelope";

// ============================================================================
// Request ID Generation
// ============================================================================

/**
 * Generate a unique request ID.
 * Format: req_{12-char-alphanumeric}
 */
export function generateRequestId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = new Uint8Array(12);
  crypto.getRandomValues(randomBytes);
  let result = "req_";
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(randomBytes[i]! % chars.length);
  }
  return result;
}

// ============================================================================
// Single Resource Wrapper
// ============================================================================

/**
 * Options for wrapping a single resource.
 */
export interface WrapResourceOptions {
  /** HATEOAS links for resource navigation */
  links?: Record<string, string>;
  /** Pre-generated request ID (generated if not provided) */
  requestId?: string;
  /** Custom timestamp (uses current time if not provided) */
  timestamp?: string;
}

/**
 * Wrap a resource in the canonical API response envelope.
 *
 * @param objectType - The resource type identifier (e.g., "agent", "checkpoint")
 * @param data - The resource data
 * @param options - Optional configuration
 * @returns Wrapped response envelope
 *
 * @example
 * ```typescript
 * const agent = { id: "agent_123", status: "ready" };
 * const response = wrapResource("agent", agent, {
 *   links: { self: "/agents/agent_123" }
 * });
 * ```
 */
export function wrapResource<T>(
  objectType: string,
  data: T,
  options: WrapResourceOptions = {},
): ApiResponse<T> {
  const response: ApiResponse<T> = {
    object: objectType,
    data,
    requestId: options.requestId ?? generateRequestId(),
    timestamp: options.timestamp ?? new Date().toISOString(),
  };

  if (options.links) {
    response.links = options.links;
  }

  return response;
}

// ============================================================================
// List Wrapper
// ============================================================================

/**
 * Options for wrapping a list of resources.
 */
export interface WrapListOptions {
  /** Whether more items exist beyond this page */
  hasMore?: boolean;
  /** Cursor for the next page (when hasMore is true) */
  nextCursor?: string;
  /** Cursor for the previous page */
  prevCursor?: string;
  /** Total count of items across all pages */
  total?: number;
  /** Count of unread/unacknowledged items */
  unreadCount?: number;
  /** URL for this list endpoint (without pagination params) */
  url: string;
  /** Pre-generated request ID (generated if not provided) */
  requestId?: string;
  /** Custom timestamp (uses current time if not provided) */
  timestamp?: string;
}

/**
 * Wrap a list of items in the canonical API list response envelope.
 *
 * @param data - Array of items
 * @param options - Configuration including url and pagination
 * @returns Wrapped list response envelope
 *
 * @example
 * ```typescript
 * const agents = [{ id: "agent_1" }, { id: "agent_2" }];
 * const response = wrapList(agents, {
 *   url: "/agents",
 *   hasMore: true,
 *   nextCursor: "cursor_abc",
 *   total: 150
 * });
 * ```
 */
export function wrapList<T>(
  data: T[],
  options: WrapListOptions,
): ApiListResponse<T> {
  const response: ApiListResponse<T> = {
    object: "list",
    data,
    hasMore: options.hasMore ?? false,
    url: options.url,
    requestId: options.requestId ?? generateRequestId(),
    timestamp: options.timestamp ?? new Date().toISOString(),
  };

  if (options.nextCursor) {
    response.nextCursor = options.nextCursor;
  }

  if (options.prevCursor) {
    response.prevCursor = options.prevCursor;
  }

  if (options.total !== undefined) {
    response.total = options.total;
  }

  if (options.unreadCount !== undefined) {
    response.unreadCount = options.unreadCount;
  }

  return response;
}

// ============================================================================
// Error Wrapper
// ============================================================================

/**
 * Options for wrapping an error.
 */
export interface WrapErrorOptions {
  /** Error code from taxonomy or custom code */
  code: ErrorCode | string;
  /** Human-readable error message */
  message: string;
  /** Specific field/parameter that caused the error */
  param?: string;
  /** Pre-generated request ID (generated if not provided) */
  requestId?: string;
  /** Custom timestamp (uses current time if not provided) */
  timestamp?: string;
  /** Additional error details */
  details?: Record<string, unknown>;
  /** Override severity (uses AI hint default if not provided) */
  severity?: "terminal" | "recoverable" | "retry";
  /** Override hint (uses AI hint default if not provided) */
  hint?: string;
  /** Override alternative approach (uses AI hint default if not provided) */
  alternative?: string;
  /** Example of valid input/usage that would succeed */
  example?: unknown;
}

/**
 * Wrap an error in the canonical API error response envelope.
 *
 * Automatically includes AI hints for known error codes from the
 * error taxonomy. Custom hints can be provided to override defaults.
 *
 * @param options - Error configuration
 * @returns Wrapped error response envelope
 *
 * @example
 * ```typescript
 * // With known error code (includes AI hints automatically)
 * const error = wrapError({
 *   code: "AGENT_NOT_FOUND",
 *   message: "Agent agent_123 not found"
 * });
 *
 * // With validation error and param
 * const validationError = wrapError({
 *   code: "VALIDATION_FAILED",
 *   message: "Invalid status value",
 *   param: "status"
 * });
 * ```
 */
export function wrapError(options: WrapErrorOptions): ApiErrorResponse {
  // Look up AI hints for known error codes
  const aiHint = AI_HINTS[options.code as ErrorCode];

  // Build error object
  const error: ApiError = {
    code: options.code,
    message: options.message,
  };

  // Add severity (from options, AI hint, or default)
  const severity = options.severity ?? aiHint?.severity;
  if (severity) {
    error.severity = severity;
  }

  // Add hint (from options or AI hint)
  const hint = options.hint ?? aiHint?.suggestedAction;
  if (hint) {
    error.hint = hint;
  }

  // Add alternative (from options or AI hint)
  const alternative = options.alternative ?? aiHint?.alternativeApproach;
  if (alternative) {
    error.alternative = alternative;
  }

  // Add example of valid input
  if (options.example !== undefined) {
    error.example = options.example;
  }

  // Add optional fields
  if (options.param) {
    error.param = options.param;
  }

  if (options.details) {
    error.details = options.details;
  }

  return {
    object: "error",
    error,
    requestId: options.requestId ?? generateRequestId(),
    timestamp: options.timestamp ?? new Date().toISOString(),
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a "created" response (HTTP 201) for newly created resources.
 *
 * @param objectType - The resource type identifier
 * @param data - The created resource data
 * @param selfUrl - URL for the created resource
 * @param options - Additional options
 * @returns Wrapped response with self link
 */
export function wrapCreated<T>(
  objectType: string,
  data: T,
  selfUrl: string,
  options: Omit<WrapResourceOptions, "links"> = {},
): ApiResponse<T> {
  return wrapResource(objectType, data, {
    ...options,
    links: { self: selfUrl },
  });
}

/**
 * Create an empty list response.
 *
 * @param url - URL for the list endpoint
 * @param options - Additional options
 * @returns Empty list response envelope
 */
export function wrapEmptyList<T = never>(
  url: string,
  options: Omit<WrapListOptions, "url" | "hasMore"> = {},
): ApiListResponse<T> {
  return wrapList<T>([], {
    ...options,
    url,
    hasMore: false,
    total: 0,
  });
}

/**
 * Create a validation error response for multiple field errors.
 *
 * @param errors - Array of field errors with path and message
 * @param options - Additional options
 * @returns Validation error response envelope
 */
export function wrapValidationError(
  errors: Array<{ path: string; message: string; code?: string }>,
  options: Pick<WrapErrorOptions, "requestId" | "timestamp"> = {},
): ApiErrorResponse {
  const firstError = errors[0];
  const message =
    errors.length === 1
      ? firstError?.message ?? "Validation failed"
      : `Validation failed: ${errors.length} errors`;

  const errorOptions: WrapErrorOptions = {
    code: "VALIDATION_FAILED",
    message,
    details: { errors },
    severity: "recoverable",
    hint: "Fix the validation errors in your request and retry.",
    ...options,
  };

  // Only add param if it exists (exactOptionalPropertyTypes compatibility)
  if (firstError?.path) {
    errorOptions.param = firstError.path;
  }

  return wrapError(errorOptions);
}

/**
 * Create a not found error response.
 *
 * @param resourceType - Type of resource that wasn't found
 * @param identifier - ID or identifier of the missing resource
 * @param options - Additional options
 * @returns Not found error response envelope
 */
export function wrapNotFound(
  resourceType: string,
  identifier: string,
  options: Pick<WrapErrorOptions, "requestId" | "timestamp"> = {},
): ApiErrorResponse {
  const code = `${resourceType.toUpperCase()}_NOT_FOUND` as ErrorCode;
  return wrapError({
    code,
    message: `${resourceType} '${identifier}' not found`,
    severity: "terminal",
    hint: `Verify the ${resourceType} ID exists or create a new ${resourceType}.`,
    ...options,
  });
}
