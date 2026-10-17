/**
 * DCG Statistics Service - Database-backed statistics for Destructive Command Guard.
 *
 * Provides real-time statistics by querying the database instead of using
 * in-memory data. Includes time-based filtering, trends, and comprehensive metrics.
 */

import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { dcgAllowlist, dcgBlocks, dcgPendingExceptions } from "../db/schema";
import { getCorrelationId, getLogger } from "../middleware/correlation";

// ============================================================================
// Types
// ============================================================================

export interface DCGOverviewStats {
  /** Total blocks all time */
  totalBlocks: number;
  /** Blocks in the last 24 hours */
  blocksLast24h: number;
  /** Blocks in the last 7 days */
  blocksLast7d: number;
  /** Blocks in the last 30 days */
  blocksLast30d: number;
  /** Number of blocks marked as false positives */
  falsePositiveCount: number;
  /** False positive rate (0-1) */
  falsePositiveRate: number;
  /** Total allowlist entries */
  allowlistSize: number;
  /** Pending exceptions awaiting approval */
  pendingExceptionsCount: number;
}

export interface DCGTrendStats {
  /** Percentage change vs previous 24h */
  trendVs24h: number;
  /** Percentage change vs previous 7d */
  trendVs7d: number;
  /** Percentage change vs previous 30d */
  trendVs30d: number;
  /** Direction of trend */
  trendDirection: "increasing" | "decreasing" | "stable";
}

export interface DCGPatternStats {
  /** Top blocked patterns with counts */
  topPatterns: Array<{ pattern: string; count: number }>;
  /** Top agents triggering blocks */
  topAgents: Array<{ agentId: string; count: number }>;
}

export interface DCGTimeSeriesPoint {
  /** ISO date string (YYYY-MM-DD) */
  date: string;
  /** Block count for that day */
  count: number;
}

export interface DCGDistributionStats {
  byPack: Record<string, number>;
  bySeverity: Record<string, number>;
}

export interface DCGFullStats {
  overview: DCGOverviewStats;
  trends: DCGTrendStats;
  patterns: DCGPatternStats;
  distributions: DCGDistributionStats;
  timeSeries: {
    last7Days: DCGTimeSeriesPoint[];
    last30Days: DCGTimeSeriesPoint[];
  };
  generatedAt: string;
}

// ============================================================================
// Time Helpers
// ============================================================================

function getTimeAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function getDaysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function formatDateKey(date: Date): string {
  // ISO string format is "YYYY-MM-DDTHH:mm:ss.sssZ", split always returns date part
  return date.toISOString().split("T")[0] ?? "";
}

// ============================================================================
// Statistics Functions
// ============================================================================

/**
 * Get distribution statistics (pack and severity counts).
 */
export async function getDistributionStats(): Promise<DCGDistributionStats> {
  const [blocksByPackResult, blocksBySeverityResult] = await Promise.all([
    // Query pack distribution
    db
      .select({ pack: dcgBlocks.pack, count: count() })
      .from(dcgBlocks)
      .where(sql`${dcgBlocks.pack} IS NOT NULL`)
      .groupBy(dcgBlocks.pack),
    // Query severity distribution
    db
      .select({ severity: dcgBlocks.severity, count: count() })
      .from(dcgBlocks)
      .where(sql`${dcgBlocks.severity} IS NOT NULL`)
      .groupBy(dcgBlocks.severity),
  ]);

  const byPack: Record<string, number> = {};
  for (const row of blocksByPackResult) {
    if (row.pack) {
      byPack[row.pack] = row.count;
    }
  }

  const bySeverity: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const row of blocksBySeverityResult) {
    if (row.severity) {
      bySeverity[row.severity] = row.count;
    }
  }

  return { byPack, bySeverity };
}

/**
 * Get overview statistics from the database.
 */
export async function getOverviewStats(): Promise<DCGOverviewStats> {
  const log = getLogger();
  const correlationId = getCorrelationId();

  try {
    const time24hAgo = getTimeAgo(24);
    const time7dAgo = getDaysAgo(7);
    const time30dAgo = getDaysAgo(30);

    // Execute all queries in parallel for performance
    const [
      totalBlocksResult,
      blocks24hResult,
      blocks7dResult,
      blocks30dResult,
      falsePositiveResult,
      allowlistResult,
      pendingResult,
    ] = await Promise.all([
      // Total blocks
      db.select({ count: count() }).from(dcgBlocks),
      // Blocks in last 24h
      db
        .select({ count: count() })
        .from(dcgBlocks)
        .where(gte(dcgBlocks.createdAt, time24hAgo)),
      // Blocks in last 7 days
      db
        .select({ count: count() })
        .from(dcgBlocks)
        .where(gte(dcgBlocks.createdAt, time7dAgo)),
      // Blocks in last 30 days
      db
        .select({ count: count() })
        .from(dcgBlocks)
        .where(gte(dcgBlocks.createdAt, time30dAgo)),
      // False positives
      db
        .select({ count: count() })
        .from(dcgBlocks)
        .where(eq(dcgBlocks.falsePositive, true)),
      // Allowlist size
      db.select({ count: count() }).from(dcgAllowlist),
      // Pending exceptions
      db
        .select({ count: count() })
        .from(dcgPendingExceptions)
        .where(eq(dcgPendingExceptions.status, "pending")),
    ]);

    const totalBlocks = totalBlocksResult[0]?.count ?? 0;
    const falsePositiveCount = falsePositiveResult[0]?.count ?? 0;

    return {
      totalBlocks,
      blocksLast24h: blocks24hResult[0]?.count ?? 0,
      blocksLast7d: blocks7dResult[0]?.count ?? 0,
      blocksLast30d: blocks30dResult[0]?.count ?? 0,
      falsePositiveCount,
      falsePositiveRate: totalBlocks > 0 ? falsePositiveCount / totalBlocks : 0,
      allowlistSize: allowlistResult[0]?.count ?? 0,
      pendingExceptionsCount: pendingResult[0]?.count ?? 0,
    };
  } catch (error) {
    log.warn(
      {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to get DCG overview stats from database, returning zeros",
    );
    return {
      totalBlocks: 0,
      blocksLast24h: 0,
      blocksLast7d: 0,
      blocksLast30d: 0,
      falsePositiveCount: 0,
      falsePositiveRate: 0,
      allowlistSize: 0,
      pendingExceptionsCount: 0,
    };
  }
}

/**
 * Calculate trend statistics comparing current period to previous period.
 */
export async function getTrendStats(): Promise<DCGTrendStats> {
  const log = getLogger();
  const correlationId = getCorrelationId();

  try {
    // Define time ranges
    const time24hAgo = getTimeAgo(24);
    const time48hAgo = getTimeAgo(48);
    const time7dAgo = getDaysAgo(7);
    const time14dAgo = getDaysAgo(14);
    const time30dAgo = getDaysAgo(30);
    const time60dAgo = getDaysAgo(60);

    // Query current and previous period counts
    const [
      current24hResult,
      previous24hResult,
      current7dResult,
      previous7dResult,
      current30dResult,
      previous30dResult,
    ] = await Promise.all([
      // Current 24h
      db
        .select({ count: count() })
        .from(dcgBlocks)
        .where(gte(dcgBlocks.createdAt, time24hAgo)),
      // Previous 24h (24-48h ago)
      db
        .select({ count: count() })
        .from(dcgBlocks)
        .where(
          and(
            gte(dcgBlocks.createdAt, time48hAgo),
            lt(dcgBlocks.createdAt, time24hAgo),
          ),
        ),
      // Current 7d
      db
        .select({ count: count() })
        .from(dcgBlocks)
        .where(gte(dcgBlocks.createdAt, time7dAgo)),
      // Previous 7d (7-14d ago)
      db
        .select({ count: count() })
        .from(dcgBlocks)
        .where(
          and(
            gte(dcgBlocks.createdAt, time14dAgo),
            lt(dcgBlocks.createdAt, time7dAgo),
          ),
        ),
      // Current 30d
      db
        .select({ count: count() })
        .from(dcgBlocks)
        .where(gte(dcgBlocks.createdAt, time30dAgo)),
      // Previous 30d (30-60d ago)
      db
        .select({ count: count() })
        .from(dcgBlocks)
        .where(
          and(
            gte(dcgBlocks.createdAt, time60dAgo),
            lt(dcgBlocks.createdAt, time30dAgo),
          ),
        ),
    ]);

    const current24h = current24hResult[0]?.count ?? 0;
    const previous24h = previous24hResult[0]?.count ?? 0;
    const current7d = current7dResult[0]?.count ?? 0;
    const previous7d = previous7dResult[0]?.count ?? 0;
    const current30d = current30dResult[0]?.count ?? 0;
    const previous30d = previous30dResult[0]?.count ?? 0;

    // Calculate percentage changes
    const calculateTrend = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };

    const trendVs24h = calculateTrend(current24h, previous24h);
    const trendVs7d = calculateTrend(current7d, previous7d);
    const trendVs30d = calculateTrend(current30d, previous30d);

    // Determine overall trend direction based on 7d trend
    let trendDirection: "increasing" | "decreasing" | "stable";
    if (trendVs7d > 10) {
      trendDirection = "increasing";
    } else if (trendVs7d < -10) {
      trendDirection = "decreasing";
    } else {
      trendDirection = "stable";
    }

    return {
      trendVs24h: Math.round(trendVs24h * 100) / 100,
      trendVs7d: Math.round(trendVs7d * 100) / 100,
      trendVs30d: Math.round(trendVs30d * 100) / 100,
      trendDirection,
    };
  } catch (error) {
    log.warn(
      {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to get DCG trend stats from database",
    );
    return {
      trendVs24h: 0,
      trendVs7d: 0,
      trendVs30d: 0,
      trendDirection: "stable",
    };
  }
}

/**
 * Get top patterns and agents from block history.
 */
export async function getPatternStats(limit = 10): Promise<DCGPatternStats> {
  const log = getLogger();
  const correlationId = getCorrelationId();

  try {
    // Get top patterns - group by pattern and count
    const topPatternsResult = await db
      .select({
        pattern: dcgBlocks.pattern,
        count: count(),
      })
      .from(dcgBlocks)
      .groupBy(dcgBlocks.pattern)
      .orderBy(sql`count(*) DESC`)
      .limit(limit);

    // Get top agents - group by createdBy and count
    const topAgentsResult = await db
      .select({
        agentId: dcgBlocks.createdBy,
        count: count(),
      })
      .from(dcgBlocks)
      .where(sql`${dcgBlocks.createdBy} IS NOT NULL`)
      .groupBy(dcgBlocks.createdBy)
      .orderBy(sql`count(*) DESC`)
      .limit(limit);

    return {
      topPatterns: topPatternsResult.map((r) => ({
        pattern: r.pattern,
        count: r.count,
      })),
      topAgents: topAgentsResult
        .filter((r) => r.agentId !== null)
        .map((r) => ({
          agentId: r.agentId!,
          count: r.count,
        })),
    };
  } catch (error) {
    log.warn(
      {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to get DCG pattern stats from database",
    );
    return {
      topPatterns: [],
      topAgents: [],
    };
  }
}

/**
 * Get time series data for blocks over time.
 */
export async function getTimeSeriesStats(): Promise<{
  last7Days: DCGTimeSeriesPoint[];
  last30Days: DCGTimeSeriesPoint[];
}> {
  const log = getLogger();
  const correlationId = getCorrelationId();

  try {
    const time30dAgo = getDaysAgo(30);

    // Get daily counts for the last 30 days
    // Note: Drizzle stores timestamps in seconds (not ms) for SQLite
    const dailyCountsResult = await db
      .select({
        date: sql<string>`strftime('%Y-%m-%d', datetime(${dcgBlocks.createdAt}, 'unixepoch'))`.as(
          "date",
        ),
        count: count(),
      })
      .from(dcgBlocks)
      .where(gte(dcgBlocks.createdAt, time30dAgo))
      .groupBy(
        sql`strftime('%Y-%m-%d', datetime(${dcgBlocks.createdAt}, 'unixepoch'))`,
      )
      .orderBy(sql`date ASC`);

    // Create a map of date -> count
    const countsByDate = new Map<string, number>();
    for (const row of dailyCountsResult) {
      countsByDate.set(row.date, row.count);
    }

    // Generate arrays for last 7 and 30 days, filling in zeros
    const last7Days: DCGTimeSeriesPoint[] = [];
    const last30Days: DCGTimeSeriesPoint[] = [];

    for (let i = 29; i >= 0; i--) {
      const date = getDaysAgo(i);
      const dateKey = formatDateKey(date);
      const dataCount = countsByDate.get(dateKey) ?? 0;

      last30Days.push({ date: dateKey, count: dataCount });

      if (i < 7) {
        last7Days.push({ date: dateKey, count: dataCount });
      }
    }

    return { last7Days, last30Days };
  } catch (error) {
    log.warn(
      {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to get DCG time series stats from database",
    );
    return { last7Days: [], last30Days: [] };
  }
}

/**
 * Get comprehensive DCG statistics.
 * This is the main function to call for full statistics.
 */
export async function getFullStats(): Promise<DCGFullStats> {
  const [overview, trends, patterns, distributions, timeSeries] =
    await Promise.all([
      getOverviewStats(),
      getTrendStats(),
      getPatternStats(),
      getDistributionStats(),
      getTimeSeriesStats(),
    ]);

  return {
    overview,
    trends,
    patterns,
    distributions,
    timeSeries,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Get simplified stats for backward compatibility with the existing getStats() function.
 * Maps the new comprehensive stats to the old DCGStats format.
 */
export async function getLegacyStats(): Promise<{
  totalBlocks: number;
  blocksByPack: Record<string, number>;
  blocksBySeverity: Record<string, number>;
  falsePositiveRate: number;
  topBlockedCommands: Array<{ command: string; count: number }>;
}> {
  const [overview, patterns, distributions] = await Promise.all([
    getOverviewStats(),
    getPatternStats(),
    getDistributionStats(),
  ]);

  return {
    totalBlocks: overview.totalBlocks,
    blocksByPack: distributions.byPack,
    blocksBySeverity: distributions.bySeverity,
    falsePositiveRate: overview.falsePositiveRate,
    topBlockedCommands: patterns.topPatterns.map((p) => ({
      command: p.pattern,
      count: p.count,
    })),
  };
}
