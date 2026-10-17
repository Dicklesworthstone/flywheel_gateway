/**
 * Drizzle ORM Pagination Helper.
 *
 * Provides utilities for cursor-based pagination with Drizzle queries.
 * Supports both forward and backward pagination with proper cursor handling.
 */

import {
  createCursor,
  decodeCursor,
  type NormalizedPaginationParams,
  type PaginationMeta,
} from "@flywheel/shared/api/pagination";
import { and, asc, desc, gt, lt, type SQL } from "drizzle-orm";
import type {
  SQLiteColumn,
  SQLiteTableWithColumns,
} from "drizzle-orm/sqlite-core";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for paginated query execution.
 */
export interface PaginateOptions<T> {
  /**
   * Normalized pagination parameters (from normalizePaginationParams).
   */
  params: NormalizedPaginationParams;

  /**
   * Column to use for cursor-based keyset pagination.
   * Typically the primary key (id) column.
   */
  idColumn: SQLiteColumn;

  /**
   * Column to sort by (default: same as idColumn).
   * Should have an index for performance.
   */
  sortColumn?: SQLiteColumn;

  /**
   * Sort direction (default: "desc" for newest first).
   */
  sortDirection?: "asc" | "desc";

  /**
   * Function to extract ID from a result item.
   * Default: assumes item has `id` property.
   */
  getIdFn?: (item: T) => string;

  /**
   * Function to extract sort value from a result item.
   * Used for more stable cursor generation.
   */
  getSortValueFn?: (item: T) => string | number;
}

/**
 * Result of a paginated query.
 */
export interface PaginatedResult<T> {
  /**
   * Items for the current page.
   */
  items: T[];

  /**
   * Pagination metadata.
   */
  pagination: PaginationMeta;
}

// ============================================================================
// Cursor-based WHERE Clause Builder
// ============================================================================

/**
 * Build a WHERE clause for cursor-based pagination.
 *
 * @param cursor - Cursor value to paginate from
 * @param idColumn - Column to compare against
 * @param direction - Pagination direction
 * @param sortDirection - Sort order (asc/desc)
 * @returns SQL condition or undefined if no cursor
 */
export function buildCursorCondition(
  cursor: string | undefined,
  idColumn: SQLiteColumn,
  direction: "forward" | "backward",
  sortDirection: "asc" | "desc" = "desc",
): SQL | undefined {
  if (!cursor) {
    return undefined;
  }

  const payload = decodeCursor(cursor);
  if (!payload) {
    // Invalid/expired cursor - treat as no cursor
    return undefined;
  }

  // Determine comparison operator based on direction and sort
  // For desc sort: forward = lt, backward = gt
  // For asc sort: forward = gt, backward = lt
  const isDescending = sortDirection === "desc";
  const isForward = direction === "forward";

  if (isDescending) {
    // Descending order: newest first
    // Forward: get items OLDER than cursor (id < cursor.id)
    // Backward: get items NEWER than cursor (id > cursor.id)
    return isForward ? lt(idColumn, payload.id) : gt(idColumn, payload.id);
  }
  // Ascending order: oldest first
  // Forward: get items NEWER than cursor (id > cursor.id)
  // Backward: get items OLDER than cursor (id < cursor.id)
  return isForward ? gt(idColumn, payload.id) : lt(idColumn, payload.id);
}

/**
 * Get the sort order for a query based on direction.
 *
 * @param column - Column to sort
 * @param direction - Pagination direction
 * @param sortDirection - Base sort order
 * @returns Drizzle orderBy expression
 */
export function getPaginatedOrderBy(
  column: SQLiteColumn,
  direction: "forward" | "backward",
  sortDirection: "asc" | "desc" = "desc",
) {
  // For backward pagination, reverse the sort order
  const effectiveDirection =
    direction === "backward"
      ? sortDirection === "asc"
        ? "desc"
        : "asc"
      : sortDirection;

  return effectiveDirection === "desc" ? desc(column) : asc(column);
}

// ============================================================================
// High-level Pagination Helper
// ============================================================================

/**
 * Execute a paginated query with cursor-based pagination.
 *
 * This is a helper that applies pagination to an existing query builder.
 * Fetch limit+1 items to determine if there are more results.
 *
 * @param queryFn - Function that executes the query with provided conditions
 * @param options - Pagination options
 * @returns Paginated result with items and metadata
 *
 * @example
 * ```typescript
 * const result = await paginate(
 *   async (conditions, limit, orderBy) => {
 *     return db
 *       .select()
 *       .from(agents)
 *       .where(and(eq(agents.status, "active"), ...conditions))
 *       .orderBy(orderBy)
 *       .limit(limit);
 *   },
 *   {
 *     params: normalizedParams,
 *     idColumn: agents.id,
 *     sortColumn: agents.createdAt,
 *     sortDirection: "desc",
 *   }
 * );
 * ```
 */
export async function paginate<T>(
  queryFn: (
    cursorCondition: SQL | undefined,
    limit: number,
    orderBy: ReturnType<typeof asc | typeof desc>,
  ) => Promise<T[]>,
  options: PaginateOptions<T>,
): Promise<PaginatedResult<T>> {
  const {
    params,
    idColumn,
    sortColumn,
    sortDirection = "desc",
    getIdFn = (item: T) => (item as unknown as { id: string }).id,
    getSortValueFn,
  } = options;

  // Build cursor condition
  const cursorCondition = buildCursorCondition(
    params.cursor,
    idColumn,
    params.direction,
    sortDirection,
  );

  // Get sort order (reversed for backward pagination)
  const effectiveSortColumn = sortColumn ?? idColumn;
  const orderBy = getPaginatedOrderBy(
    effectiveSortColumn,
    params.direction,
    sortDirection,
  );

  // Fetch one extra to check if there are more
  const fetchLimit = params.limit + 1;
  let items = await queryFn(cursorCondition, fetchLimit, orderBy);

  // For backward pagination, reverse results back to normal order
  if (params.direction === "backward") {
    items = items.reverse();
  }

  // Build pagination metadata
  const hasMore = items.length > params.limit;
  const pageItems = hasMore ? items.slice(0, params.limit) : items;

  const pagination: PaginationMeta = {
    hasMore,
  };

  // Generate cursors for navigation
  if (pageItems.length > 0) {
    const lastItem = pageItems[pageItems.length - 1]!;
    if (hasMore) {
      pagination.nextCursor = createCursor(
        getIdFn(lastItem),
        getSortValueFn ? getSortValueFn(lastItem) : undefined,
      );
    }

    const firstItem = pageItems[0]!;
    pagination.prevCursor = createCursor(
      getIdFn(firstItem),
      getSortValueFn ? getSortValueFn(firstItem) : undefined,
    );
  }

  return {
    items: pageItems,
    pagination,
  };
}

/**
 * Simple pagination helper for basic queries.
 * For more complex queries with joins, use the paginate() function.
 *
 * @param db - Drizzle database instance
 * @param table - Table to query
 * @param options - Pagination options
 * @param additionalConditions - Additional WHERE conditions
 * @returns Paginated result
 *
 * @example
 * ```typescript
 * const result = await paginateTable(db, agents, {
 *   params: normalizedParams,
 *   idColumn: agents.id,
 * }, [eq(agents.status, "active")]);
 * ```
 */
export async function paginateTable<
  TTable extends SQLiteTableWithColumns<{
    name: string;
    schema: undefined;
    columns: Record<string, SQLiteColumn>;
    dialect: "sqlite";
  }>,
>(
  db: {
    select: () => {
      from: (table: TTable) => {
        where: (condition: SQL | undefined) => {
          orderBy: (orderBy: ReturnType<typeof asc | typeof desc>) => {
            limit: (limit: number) => Promise<TTable["$inferSelect"][]>;
          };
        };
      };
    };
  },
  table: TTable,
  options: PaginateOptions<TTable["$inferSelect"]>,
  additionalConditions: (SQL | undefined)[] = [],
): Promise<PaginatedResult<TTable["$inferSelect"]>> {
  return paginate(async (cursorCondition, limit, orderBy) => {
    const conditions = [...additionalConditions, cursorCondition].filter(
      (c): c is SQL => c !== undefined,
    );
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return db
      .select()
      .from(table)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(limit);
  }, options);
}
