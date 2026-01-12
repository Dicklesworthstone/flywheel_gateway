/**
 * Canonical API Response Envelope Types.
 *
 * Provides standardized response envelopes for all REST API endpoints:
 * - ApiResponse<T> for single resource responses
 * - ApiListResponse<T> for collection/list responses
 * - ApiErrorResponse for error responses
 *
 * All responses include:
 * - object: Type identifier for the response
 * - requestId: Unique identifier for debugging/support
 * - timestamp: ISO 8601 timestamp
 */

import type { AIHintSeverity } from "../errors/types";

// ============================================================================
// Object Type Constants
// ============================================================================

/**
 * Canonical object type identifiers used across the API.
 * These provide consistent type identification in response envelopes.
 */
export const ObjectTypes = {
  /** Single agent instance */
  AGENT: "agent",
  /** Agent checkpoint state */
  CHECKPOINT: "checkpoint",
  /** File reservation */
  RESERVATION: "reservation",
  /** Reservation conflict */
  CONFLICT: "conflict",
  /** Beads issue/task */
  BEAD: "bead",
  /** Agent mail message */
  MESSAGE: "message",
  /** Developer utility status */
  UTILITY: "utility",
  /** API account */
  ACCOUNT: "account",
  /** Alert instance */
  ALERT: "alert",
  /** Alert rule */
  ALERT_RULE: "alert_rule",
  /** History entry */
  HISTORY: "history",
  /** Metric data point */
  METRIC: "metric",
  /** Fleet repository */
  FLEET_REPO: "fleet_repo",
  /** Agent sweep session */
  SWEEP_SESSION: "sweep_session",
  /** Agent sweep plan */
  SWEEP_PLAN: "sweep_plan",
  /** Agent sweep log entry */
  SWEEP_LOG: "sweep_log",
  /** Sync operation */
  SYNC_OP: "sync_op",
  /** DCG block event */
  DCG_BLOCK: "dcg_block",
  /** DCG allowlist rule */
  DCG_ALLOWLIST: "dcg_allowlist",
  /** DCG pending exception */
  DCG_EXCEPTION: "dcg_exception",
  /** Context pack */
  CONTEXT_PACK: "context_pack",
  /** Mail thread */
  THREAD: "thread",
  /** List collection */
  LIST: "list",
  /** Error response */
  ERROR: "error",
} as const;

/** Type for object type values */
export type ObjectType = (typeof ObjectTypes)[keyof typeof ObjectTypes];

// ============================================================================
// Single Resource Response Envelope
// ============================================================================

/**
 * Envelope for single resource responses.
 *
 * @template T The resource type
 *
 * @example
 * ```typescript
 * const response: ApiResponse<Agent> = {
 *   object: "agent",
 *   data: { id: "agent_123", status: "ready", ... },
 *   requestId: "req_abc123",
 *   timestamp: "2024-01-15T10:30:00.000Z",
 *   links: {
 *     self: "/agents/agent_123",
 *     checkpoints: "/agents/agent_123/checkpoints"
 *   }
 * };
 * ```
 */
export interface ApiResponse<T> {
  /**
   * The resource type identifier (e.g., "agent", "checkpoint").
   * Used by clients to determine response structure.
   */
  object: string;

  /**
   * The resource data.
   * Shape depends on the object type.
   */
  data: T;

  /**
   * Unique request identifier for debugging and support.
   * Format: req_{12-char-random}
   */
  requestId: string;

  /**
   * ISO 8601 timestamp of when the response was generated.
   */
  timestamp: string;

  /**
   * Optional HATEOAS links for resource navigation.
   * Keys are link relations, values are URLs.
   */
  links?: Record<string, string>;
}

// ============================================================================
// List Response Envelope
// ============================================================================

/**
 * Envelope for list/collection responses.
 * Supports cursor-based pagination.
 *
 * @template T The item type
 *
 * @example
 * ```typescript
 * const response: ApiListResponse<Agent> = {
 *   object: "list",
 *   data: [{ id: "agent_1", ... }, { id: "agent_2", ... }],
 *   hasMore: true,
 *   nextCursor: "cursor_xyz",
 *   total: 150,
 *   url: "/agents",
 *   requestId: "req_abc123",
 *   timestamp: "2024-01-15T10:30:00.000Z"
 * };
 * ```
 */
export interface ApiListResponse<T> {
  /**
   * Always "list" for collections.
   */
  object: "list";

  /**
   * Array of items in this page.
   */
  data: T[];

  /**
   * Whether more items exist beyond this page.
   * If true, use nextCursor to fetch the next page.
   */
  hasMore: boolean;

  /**
   * Pagination cursor for next page.
   * Only present when hasMore is true.
   */
  nextCursor?: string;

  /**
   * Pagination cursor for previous page.
   * Used for backward navigation.
   */
  prevCursor?: string;

  /**
   * Total count of items across all pages.
   * May be omitted for performance on large collections.
   */
  total?: number;

  /**
   * Count of unread/unacknowledged items.
   * Used for notification-style lists where read state matters.
   */
  unreadCount?: number;

  /**
   * URL for this list endpoint (without pagination params).
   */
  url: string;

  /**
   * Unique request identifier for debugging and support.
   */
  requestId: string;

  /**
   * ISO 8601 timestamp of when the response was generated.
   */
  timestamp: string;
}

// ============================================================================
// Error Response Envelope
// ============================================================================

/**
 * Error details within an error response.
 * Provides structured information for both humans and AI agents.
 */
export interface ApiError {
  /**
   * Error code from the error taxonomy.
   * Format: CATEGORY_SPECIFIC (e.g., AGENT_NOT_FOUND, VALIDATION_FAILED)
   */
  code: string;

  /**
   * Human-readable error message.
   * Should be suitable for display to end users.
   */
  message: string;

  /**
   * Error severity for AI agents.
   * - terminal: Cannot be retried, requires different approach
   * - recoverable: Can be fixed by the agent (e.g., fix request params)
   * - retry: Transient error, retry with same request may succeed
   */
  severity?: AIHintSeverity;

  /**
   * Suggested action to resolve the error.
   * Written for AI agents to understand next steps.
   */
  hint?: string;

  /**
   * Alternative approach if the current request cannot succeed.
   * Provides guidance on different paths to achieve the goal.
   */
  alternative?: string;

  /**
   * Example of valid input/usage that would succeed.
   * Helps clients understand the expected format.
   */
  example?: unknown;

  /**
   * Specific field/parameter that caused the error.
   * Useful for validation errors.
   */
  param?: string;

  /**
   * Additional error details.
   * Structure varies by error type.
   */
  details?: Record<string, unknown>;
}

/**
 * Envelope for error responses.
 * Provides consistent error structure across all endpoints.
 *
 * @example
 * ```typescript
 * const error: ApiErrorResponse = {
 *   object: "error",
 *   error: {
 *     code: "AGENT_NOT_FOUND",
 *     message: "Agent agent_123 not found",
 *     severity: "terminal",
 *     hint: "Verify the agent ID exists or create a new agent",
 *     alternative: "List available agents with GET /agents"
 *   },
 *   requestId: "req_abc123",
 *   timestamp: "2024-01-15T10:30:00.000Z"
 * };
 * ```
 */
export interface ApiErrorResponse {
  /**
   * Always "error" for error responses.
   */
  object: "error";

  /**
   * Error details.
   */
  error: ApiError;

  /**
   * Unique request identifier for support reference.
   */
  requestId: string;

  /**
   * ISO 8601 timestamp of when the error occurred.
   */
  timestamp: string;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a value is an ApiResponse.
 *
 * @param value - The value to check
 * @returns True if value matches ApiResponse structure
 */
export function isApiResponse<T>(value: unknown): value is ApiResponse<T> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj["object"] === "string" &&
    obj["object"] !== "error" &&
    obj["object"] !== "list" &&
    "data" in obj &&
    typeof obj["requestId"] === "string" &&
    typeof obj["timestamp"] === "string"
  );
}

/**
 * Type guard to check if a value is an ApiListResponse.
 *
 * @param value - The value to check
 * @returns True if value matches ApiListResponse structure
 */
export function isApiListResponse<T>(
  value: unknown,
): value is ApiListResponse<T> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    obj["object"] === "list" &&
    Array.isArray(obj["data"]) &&
    typeof obj["hasMore"] === "boolean" &&
    typeof obj["url"] === "string" &&
    typeof obj["requestId"] === "string" &&
    typeof obj["timestamp"] === "string"
  );
}

/**
 * Type guard to check if a value is an ApiErrorResponse.
 *
 * @param value - The value to check
 * @returns True if value matches ApiErrorResponse structure
 */
export function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (obj["object"] !== "error") {
    return false;
  }
  if (typeof obj["error"] !== "object" || obj["error"] === null) {
    return false;
  }
  const error = obj["error"] as Record<string, unknown>;
  return (
    typeof error["code"] === "string" &&
    typeof error["message"] === "string" &&
    typeof obj["requestId"] === "string" &&
    typeof obj["timestamp"] === "string"
  );
}

// ============================================================================
// Response Union Type
// ============================================================================

/**
 * Union type for all API responses.
 * Useful for generic response handling.
 */
export type ApiResponseUnion<T> =
  | ApiResponse<T>
  | ApiListResponse<T>
  | ApiErrorResponse;

/**
 * Type guard to check if a response is successful (not an error).
 *
 * @param value - The response to check
 * @returns True if the response is not an error
 */
export function isSuccessResponse<T>(
  value: ApiResponseUnion<T>,
): value is ApiResponse<T> | ApiListResponse<T> {
  return (value as ApiErrorResponse).object !== "error";
}
