/**
 * Canonical Pagination Types and Utilities.
 *
 * Provides cursor-based pagination support for list endpoints:
 * - PaginationParams: Request parameters for pagination
 * - PaginationMeta: Response metadata for pagination
 * - Cursor encoding/decoding for opaque cursor values
 * - Utility functions for normalizing pagination params
 *
 * Cursor-based pagination is preferred over offset-based because:
 * - Stable results when data changes between requests
 * - Better performance with large datasets (no OFFSET scan)
 * - Consistent behavior for real-time data streams
 */

// ============================================================================
// Pagination Request Types
// ============================================================================

/**
 * Pagination parameters accepted in request query strings.
 * Following Stripe API conventions.
 *
 * @example
 * ```typescript
 * // Forward pagination
 * GET /agents?limit=10&starting_after=cursor_abc
 *
 * // Backward pagination
 * GET /agents?limit=10&ending_before=cursor_xyz
 * ```
 */
export interface PaginationParams {
  /**
   * Maximum number of items to return.
   * Default: 50, Maximum: 100
   */
  limit?: number;

  /**
   * Cursor for forward pagination.
   * Returns items created after this cursor (exclusive).
   */
  startingAfter?: string;

  /**
   * Cursor for backward pagination.
   * Returns items created before this cursor (exclusive).
   */
  endingBefore?: string;
}

/**
 * Direction of pagination.
 */
export type PaginationDirection = "forward" | "backward";

/**
 * Validated and normalized pagination parameters.
 * Used internally after validating request params.
 */
export interface NormalizedPaginationParams {
  /**
   * Validated limit (capped at maxLimit).
   */
  limit: number;

  /**
   * Decoded cursor (if provided).
   */
  cursor?: string;

  /**
   * Pagination direction based on which cursor was provided.
   * - forward: startingAfter was provided or no cursor
   * - backward: endingBefore was provided
   */
  direction: PaginationDirection;
}

// ============================================================================
// Pagination Response Types
// ============================================================================

/**
 * Pagination metadata returned in list responses.
 * Complements ApiListResponse from envelope.ts.
 */
export interface PaginationMeta {
  /**
   * Whether more items exist beyond this page.
   */
  hasMore: boolean;

  /**
   * Cursor for fetching the next page (if hasMore is true).
   * Use with starting_after parameter.
   */
  nextCursor?: string;

  /**
   * Cursor for fetching the previous page (if applicable).
   * Use with ending_before parameter.
   */
  prevCursor?: string;

  /**
   * Total count of items (optional).
   * May be omitted for performance on large collections.
   */
  total?: number;
}

// ============================================================================
// Cursor Encoding/Decoding
// ============================================================================

/**
 * Internal structure of encoded cursors.
 * Cursors are opaque to clients but internally contain:
 * - Resource ID for keyset pagination
 * - Sort value for stable ordering
 * - Creation timestamp for expiration
 */
export interface CursorPayload {
  /**
   * Resource ID for keyset pagination.
   */
  id: string;

  /**
   * Sort field value for stable ordering.
   * Typically a timestamp or sequence number.
   */
  sortValue?: string | number;

  /**
   * Timestamp when cursor was created (ms since epoch).
   * Used for cursor expiration.
   */
  createdAt: number;
}

/**
 * Default cursor expiration time in milliseconds.
 * Cursors older than this are considered invalid.
 * Default: 24 hours
 */
export const CURSOR_EXPIRATION_MS = 24 * 60 * 60 * 1000;

/**
 * Encode a cursor payload into an opaque string.
 * Uses base64url encoding for URL-safe cursors.
 *
 * @param payload - Cursor data to encode
 * @returns Opaque cursor string
 *
 * @example
 * ```typescript
 * const cursor = encodeCursor({
 *   id: "agent_123",
 *   sortValue: 1705123456789,
 *   createdAt: Date.now()
 * });
 * // Returns: "<opaque base64url cursor>"
 * ```
 */
export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json).toString("base64url");
}

/**
 * Decode an opaque cursor string to its payload.
 * Returns undefined if the cursor is invalid or expired.
 *
 * @param cursor - Opaque cursor string to decode
 * @param expirationMs - Custom expiration time (default: CURSOR_EXPIRATION_MS)
 * @returns Decoded payload or undefined if invalid/expired
 *
 * @example
 * ```typescript
 * const cursor = encodeCursor({ id: "agent_123", createdAt: Date.now() });
 * const payload = decodeCursor(cursor);
 * if (payload) {
 *   console.log(payload.id); // "agent_123"
 * }
 * ```
 */
export function decodeCursor(
  cursor: string,
  expirationMs: number = CURSOR_EXPIRATION_MS,
): CursorPayload | undefined {
  try {
    const json = Buffer.from(cursor, "base64url").toString();
    const payload = JSON.parse(json) as unknown;

    // Validate structure
    if (typeof payload !== "object" || payload === null) {
      return undefined;
    }

    const obj = payload as Record<string, unknown>;

    // id is required
    if (typeof obj["id"] !== "string" || obj["id"].length === 0) {
      return undefined;
    }

    // createdAt is required and must be a number
    if (typeof obj["createdAt"] !== "number") {
      return undefined;
    }

    // Check expiration
    const age = Date.now() - obj["createdAt"];
    if (age > expirationMs) {
      return undefined;
    }

    // sortValue is optional but must be string or number if present
    if (
      obj["sortValue"] !== undefined &&
      typeof obj["sortValue"] !== "string" &&
      typeof obj["sortValue"] !== "number"
    ) {
      return undefined;
    }

    const result: CursorPayload = {
      id: obj["id"] as string,
      createdAt: obj["createdAt"] as number,
    };
    if (obj["sortValue"] !== undefined) {
      result.sortValue = obj["sortValue"] as string | number;
    }
    return result;
  } catch {
    // Invalid base64 or JSON
    return undefined;
  }
}

/**
 * Create a cursor for a resource.
 * Convenience function that handles timestamp creation.
 *
 * @param id - Resource ID
 * @param sortValue - Optional sort field value
 * @returns Encoded cursor string
 *
 * @example
 * ```typescript
 * const cursor = createCursor("agent_123", agent.createdAt.getTime());
 * ```
 */
export function createCursor(id: string, sortValue?: string | number): string {
  const payload: CursorPayload = {
    id,
    createdAt: Date.now(),
  };
  if (sortValue !== undefined) {
    payload.sortValue = sortValue;
  }
  return encodeCursor(payload);
}

// ============================================================================
// Pagination Utilities
// ============================================================================

/**
 * Default pagination configuration.
 */
export interface PaginationDefaults {
  /**
   * Default limit when not specified.
   */
  limit: number;

  /**
   * Maximum allowed limit.
   */
  maxLimit: number;
}

/**
 * Standard pagination defaults.
 */
export const DEFAULT_PAGINATION: PaginationDefaults = {
  limit: 50,
  maxLimit: 100,
};

/**
 * Normalize and validate pagination parameters from a request.
 *
 * - Applies default limit if not specified
 * - Caps limit at maxLimit
 * - Determines pagination direction
 *
 * @param params - Raw pagination params from request
 * @param defaults - Default values (default: DEFAULT_PAGINATION)
 * @returns Normalized pagination parameters
 *
 * @example
 * ```typescript
 * const normalized = normalizePaginationParams({
 *   limit: 25,
 *   startingAfter: "cursor_abc"
 * });
 * // Returns: { limit: 25, cursor: "cursor_abc", direction: "forward" }
 *
 * const withDefaults = normalizePaginationParams({});
 * // Returns: { limit: 50, cursor: undefined, direction: "forward" }
 * ```
 */
export function normalizePaginationParams(
  params: PaginationParams,
  defaults: PaginationDefaults = DEFAULT_PAGINATION,
): NormalizedPaginationParams {
  // Apply limit constraints
  const limit = Math.min(
    Math.max(1, params.limit ?? defaults.limit),
    defaults.maxLimit,
  );

  // Determine direction and cursor
  // endingBefore takes precedence (backward pagination)
  if (params.endingBefore) {
    return {
      limit,
      cursor: params.endingBefore,
      direction: "backward",
    };
  }

  const result: NormalizedPaginationParams = {
    limit,
    direction: "forward",
  };
  if (params.startingAfter !== undefined) {
    result.cursor = params.startingAfter;
  }
  return result;
}

/**
 * Parse pagination params from query string values.
 * Handles string-to-number conversion for limit.
 *
 * @param query - Query string parameters (typically c.req.query())
 * @returns Parsed pagination params
 *
 * @example
 * ```typescript
 * // In a Hono route handler:
 * const params = parsePaginationQuery({
 *   limit: c.req.query("limit"),
 *   starting_after: c.req.query("starting_after"),
 *   ending_before: c.req.query("ending_before")
 * });
 * ```
 */
export function parsePaginationQuery(query: {
  limit?: string;
  starting_after?: string;
  ending_before?: string;
}): PaginationParams {
  const result: PaginationParams = {};

  if (query.limit) {
    const parsed = Number.parseInt(query.limit, 10);
    if (!Number.isNaN(parsed)) {
      result.limit = parsed;
    }
  }

  if (query.starting_after) {
    result.startingAfter = query.starting_after;
  }

  if (query.ending_before) {
    result.endingBefore = query.ending_before;
  }

  return result;
}

/**
 * Build pagination metadata from query results.
 *
 * @param items - Items returned from query
 * @param limit - Requested limit
 * @param getIdFn - Function to get ID from item (for cursor generation)
 * @param getSortValueFn - Optional function to get sort value from item
 * @returns Pagination metadata
 *
 * @example
 * ```typescript
 * // Fetch one extra item to check if there are more
 * const items = await query.limit(limit + 1);
 * const hasMore = items.length > limit;
 * const pageItems = hasMore ? items.slice(0, limit) : items;
 *
 * const meta = buildPaginationMeta(pageItems, limit, (item) => item.id);
 * ```
 */
export function buildPaginationMeta<T>(
  items: T[],
  limit: number,
  getIdFn: (item: T) => string,
  getSortValueFn?: (item: T) => string | number,
): PaginationMeta {
  const hasMore = items.length > limit;
  const pageItems = hasMore ? items.slice(0, limit) : items;

  const meta: PaginationMeta = {
    hasMore,
  };

  if (hasMore && pageItems.length > 0) {
    const lastItem = pageItems[pageItems.length - 1]!;
    meta.nextCursor = createCursor(
      getIdFn(lastItem),
      getSortValueFn ? getSortValueFn(lastItem) : undefined,
    );
  }

  if (pageItems.length > 0) {
    const firstItem = pageItems[0]!;
    meta.prevCursor = createCursor(
      getIdFn(firstItem),
      getSortValueFn ? getSortValueFn(firstItem) : undefined,
    );
  }

  return meta;
}
