/**
 * Cost Tracker Service
 *
 * Core service for recording, calculating, and querying cost data.
 * Handles real-time cost tracking with automatic aggregation.
 */

import {
  createCursor,
  DEFAULT_PAGINATION,
  decodeCursor,
} from "@flywheel/shared/api/pagination";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/connection";
import { costAggregates, costRecords, modelRateCards } from "../db/schema";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import type {
  ComplexityTier,
  CostBreakdown,
  CostFilter,
  CostRecord,
  CostRecordInput,
  CostRecordListResponse,
  CostTrend,
  ModelRateCard,
  ProviderId,
} from "../models/cost";
import { DEFAULT_RATE_CARDS } from "../models/cost";
import { logger } from "./logger";

// ============================================================================
// In-memory cache for rate cards (refreshed periodically)
// ============================================================================

/** Cached rate cards for fast lookup */
let rateCardCache = new Map<string, ModelRateCard>();
let rateCardCacheLastRefresh = 0;
const RATE_CARD_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get rate card cache key.
 */
function getRateCardKey(model: string, provider: ProviderId): string {
  return `${provider}:${model}`;
}

/**
 * Refresh rate card cache from database.
 */
async function refreshRateCardCache(): Promise<void> {
  const now = Date.now();
  if (now - rateCardCacheLastRefresh < RATE_CARD_CACHE_TTL_MS) {
    return;
  }

  try {
    const cards = await db
      .select()
      .from(modelRateCards)
      .where(
        and(
          lte(modelRateCards.effectiveDate, new Date()),
          sql`(${modelRateCards.expiresAt} IS NULL OR ${modelRateCards.expiresAt} > ${new Date()})`,
        ),
      );

    const newCache = new Map<string, ModelRateCard>();
    for (const card of cards) {
      const rateCard: ModelRateCard = {
        model: card.model,
        provider: card.provider as ProviderId,
        promptCostPer1kTokens: card.promptCostPer1kTokens,
        completionCostPer1kTokens: card.completionCostPer1kTokens,
        effectiveDate: card.effectiveDate,
      };
      if (card.cachedPromptCostPer1kTokens !== null) {
        rateCard.cachedPromptCostPer1kTokens = card.cachedPromptCostPer1kTokens;
      }
      if (card.expiresAt) {
        rateCard.expiresAt = card.expiresAt;
      }
      newCache.set(
        getRateCardKey(card.model, card.provider as ProviderId),
        rateCard,
      );
    }

    // Add default rate cards for missing models
    for (const defaultCard of DEFAULT_RATE_CARDS) {
      const key = getRateCardKey(defaultCard.model, defaultCard.provider);
      if (!newCache.has(key)) {
        newCache.set(key, defaultCard);
      }
    }

    rateCardCache = newCache;
    rateCardCacheLastRefresh = now;
    logger.debug(
      { cacheSize: rateCardCache.size },
      "Rate card cache refreshed",
    );
  } catch (error) {
    logger.error({ error }, "Failed to refresh rate card cache");
    // Use defaults on error
    if (rateCardCache.size === 0) {
      for (const defaultCard of DEFAULT_RATE_CARDS) {
        rateCardCache.set(
          getRateCardKey(defaultCard.model, defaultCard.provider),
          defaultCard,
        );
      }
    }
  }
}

/**
 * Get rate card for a model.
 */
export async function getRateCard(
  model: string,
  provider: ProviderId,
): Promise<ModelRateCard | undefined> {
  await refreshRateCardCache();

  // Try exact match
  const key = getRateCardKey(model, provider);
  if (rateCardCache.has(key)) {
    return rateCardCache.get(key);
  }

  // Try prefix match (e.g., "claude-3-opus-20240229" matches "claude-3-opus")
  for (const [_cacheKey, card] of rateCardCache) {
    if (model.startsWith(card.model) && card.provider === provider) {
      return card;
    }
  }

  return undefined;
}

// ============================================================================
// Cost Calculation
// ============================================================================

/**
 * Calculate cost in millicents from token counts.
 */
export async function calculateCost(
  model: string,
  provider: ProviderId,
  promptTokens: number,
  completionTokens: number,
  cachedTokens = 0,
): Promise<{
  promptCostUnits: number;
  completionCostUnits: number;
  cachedCostUnits: number;
  totalCostUnits: number;
}> {
  const rateCard = await getRateCard(model, provider);

  if (!rateCard) {
    // Return zero cost with warning if no rate card found
    logger.warn(
      { model, provider },
      "No rate card found for model, using zero cost",
    );
    return {
      promptCostUnits: 0,
      completionCostUnits: 0,
      cachedCostUnits: 0,
      totalCostUnits: 0,
    };
  }

  // Calculate costs (rate is per 1k tokens, in millicents)
  // IMPORTANT: cachedTokens are a SUBSET of promptTokens that hit the cache.
  // We charge non-cached prompt tokens at full rate, cached tokens at cached rate.
  const nonCachedPromptTokens = Math.max(0, promptTokens - cachedTokens);
  const promptCostUnits = Math.round(
    (nonCachedPromptTokens / 1000) * rateCard.promptCostPer1kTokens,
  );
  const completionCostUnits = Math.round(
    (completionTokens / 1000) * rateCard.completionCostPer1kTokens,
  );
  const cachedCostUnits = Math.round(
    (cachedTokens / 1000) *
      (rateCard.cachedPromptCostPer1kTokens ?? rateCard.promptCostPer1kTokens),
  );

  return {
    promptCostUnits,
    completionCostUnits,
    cachedCostUnits,
    totalCostUnits: promptCostUnits + completionCostUnits + cachedCostUnits,
  };
}

// ============================================================================
// Cost Recording
// ============================================================================

/**
 * Generate a unique cost record ID.
 */
function generateCostRecordId(): string {
  const randomBytes = new Uint8Array(6);
  crypto.getRandomValues(randomBytes);
  const random = Array.from(randomBytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 8);
  return `cost_${Date.now()}_${random}`;
}

/**
 * Record a cost event.
 */
export async function recordCost(input: CostRecordInput): Promise<CostRecord> {
  const correlationId = input.correlationId ?? getCorrelationId();
  const log = getLogger();
  const timestamp = new Date();

  // Calculate costs
  const costs = await calculateCost(
    input.model,
    input.provider,
    input.promptTokens,
    input.completionTokens,
    input.cachedTokens ?? 0,
  );

  const id = generateCostRecordId();
  const record: CostRecord = {
    id,
    timestamp,
    model: input.model,
    provider: input.provider,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    cachedTokens: input.cachedTokens ?? 0,
    ...costs,
    success: input.success,
    correlationId,
  };
  if (input.organizationId) record.organizationId = input.organizationId;
  if (input.projectId) record.projectId = input.projectId;
  if (input.agentId) record.agentId = input.agentId;
  if (input.taskId) record.taskId = input.taskId;
  if (input.sessionId) record.sessionId = input.sessionId;
  if (input.taskType) record.taskType = input.taskType;
  if (input.complexityTier) record.complexityTier = input.complexityTier;
  if (input.requestDurationMs !== undefined)
    record.requestDurationMs = input.requestDurationMs;

  // Insert into database
  await db.insert(costRecords).values({
    id: record.id,
    timestamp: record.timestamp,
    organizationId: record.organizationId ?? null,
    projectId: record.projectId ?? null,
    agentId: record.agentId ?? null,
    taskId: record.taskId ?? null,
    sessionId: record.sessionId ?? null,
    model: record.model,
    provider: record.provider,
    promptTokens: record.promptTokens,
    completionTokens: record.completionTokens,
    cachedTokens: record.cachedTokens,
    promptCostUnits: record.promptCostUnits,
    completionCostUnits: record.completionCostUnits,
    cachedCostUnits: record.cachedCostUnits,
    totalCostUnits: record.totalCostUnits,
    taskType: record.taskType ?? null,
    complexityTier: record.complexityTier ?? null,
    success: record.success,
    requestDurationMs: record.requestDurationMs ?? null,
    correlationId: record.correlationId ?? null,
  });

  log.debug({
    type: "cost:recorded",
    correlationId,
    costRecordId: id,
    model: record.model,
    totalCostUnits: record.totalCostUnits,
    promptTokens: record.promptTokens,
    completionTokens: record.completionTokens,
  });

  return record;
}

// ============================================================================
// Cost Queries
// ============================================================================

/**
 * Get cost records with filtering and pagination.
 */
export async function getCostRecords(
  filter?: CostFilter,
): Promise<CostRecordListResponse> {
  const conditions = [];

  if (filter?.organizationId) {
    conditions.push(eq(costRecords.organizationId, filter.organizationId));
  }
  if (filter?.projectId) {
    conditions.push(eq(costRecords.projectId, filter.projectId));
  }
  if (filter?.agentId) {
    conditions.push(eq(costRecords.agentId, filter.agentId));
  }
  if (filter?.model) {
    conditions.push(eq(costRecords.model, filter.model));
  }
  if (filter?.provider) {
    conditions.push(eq(costRecords.provider, filter.provider));
  }
  if (filter?.since) {
    conditions.push(gte(costRecords.timestamp, filter.since));
  }
  if (filter?.until) {
    conditions.push(lte(costRecords.timestamp, filter.until));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(costRecords)
    .where(whereClause);
  const total = countResult[0]?.count ?? 0;

  // Determine limit and offset
  const limit = filter?.limit ?? DEFAULT_PAGINATION.limit;
  let offset = 0;

  if (filter?.startingAfter) {
    const decoded = decodeCursor(filter.startingAfter);
    if (decoded) {
      // Find the position of the cursor record
      const cursorRecord = await db
        .select({ timestamp: costRecords.timestamp })
        .from(costRecords)
        .where(eq(costRecords.id, decoded.id))
        .limit(1);

      if (cursorRecord.length > 0) {
        const cursorTimestamp = cursorRecord[0]!.timestamp;
        const countBefore = await db
          .select({ count: sql<number>`count(*)` })
          .from(costRecords)
          .where(and(whereClause, gte(costRecords.timestamp, cursorTimestamp)));
        offset = countBefore[0]?.count ?? 0;
      }
    }
  }

  // Fetch records (limit + 1 to determine hasMore)
  const rows = await db
    .select()
    .from(costRecords)
    .where(whereClause)
    .orderBy(desc(costRecords.timestamp))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;

  const records: CostRecord[] = resultRows.map((row) => {
    const record: CostRecord = {
      id: row.id,
      timestamp: row.timestamp,
      model: row.model,
      provider: row.provider as ProviderId,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      cachedTokens: row.cachedTokens,
      promptCostUnits: row.promptCostUnits,
      completionCostUnits: row.completionCostUnits,
      cachedCostUnits: row.cachedCostUnits,
      totalCostUnits: row.totalCostUnits,
      success: row.success,
    };
    if (row.organizationId) record.organizationId = row.organizationId;
    if (row.projectId) record.projectId = row.projectId;
    if (row.agentId) record.agentId = row.agentId;
    if (row.taskId) record.taskId = row.taskId;
    if (row.sessionId) record.sessionId = row.sessionId;
    if (row.taskType) record.taskType = row.taskType;
    if (row.complexityTier !== null)
      record.complexityTier = row.complexityTier as ComplexityTier;
    if (row.requestDurationMs !== null)
      record.requestDurationMs = row.requestDurationMs;
    if (row.correlationId) record.correlationId = row.correlationId;
    return record;
  });

  const result: CostRecordListResponse = {
    records,
    hasMore,
    total,
  };

  if (resultRows.length > 0) {
    const lastItem = resultRows[resultRows.length - 1]!;
    const firstItem = resultRows[0]!;

    if (hasMore) {
      result.nextCursor = createCursor(lastItem.id);
    }
    if (offset > 0) {
      result.prevCursor = createCursor(firstItem.id);
    }
  }

  return result;
}

/**
 * Get cost summary for a time period.
 */
export async function getCostSummary(filter?: CostFilter): Promise<{
  totalCostUnits: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  requestCount: number;
  successCount: number;
  failureCount: number;
  avgCostPerRequest: number;
}> {
  const conditions = [];

  if (filter?.organizationId) {
    conditions.push(eq(costRecords.organizationId, filter.organizationId));
  }
  if (filter?.projectId) {
    conditions.push(eq(costRecords.projectId, filter.projectId));
  }
  if (filter?.agentId) {
    conditions.push(eq(costRecords.agentId, filter.agentId));
  }
  if (filter?.since) {
    conditions.push(gte(costRecords.timestamp, filter.since));
  }
  if (filter?.until) {
    conditions.push(lte(costRecords.timestamp, filter.until));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db
    .select({
      totalCostUnits: sql<number>`coalesce(sum(${costRecords.totalCostUnits}), 0)`,
      promptTokens: sql<number>`coalesce(sum(${costRecords.promptTokens}), 0)`,
      completionTokens: sql<number>`coalesce(sum(${costRecords.completionTokens}), 0)`,
      cachedTokens: sql<number>`coalesce(sum(${costRecords.cachedTokens}), 0)`,
      requestCount: sql<number>`count(*)`,
      successCount: sql<number>`sum(case when ${costRecords.success} = 1 then 1 else 0 end)`,
      failureCount: sql<number>`sum(case when ${costRecords.success} = 0 then 1 else 0 end)`,
    })
    .from(costRecords)
    .where(whereClause);

  const row = result[0] ?? {
    totalCostUnits: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    requestCount: 0,
    successCount: 0,
    failureCount: 0,
  };

  // Note: cachedTokens is a SUBSET of promptTokens (see calculateCost comment),
  // so we don't add it again to avoid double-counting
  const totalTokens = row.promptTokens + row.completionTokens;
  const avgCostPerRequest =
    row.requestCount > 0 ? row.totalCostUnits / row.requestCount : 0;

  return {
    totalCostUnits: row.totalCostUnits,
    totalTokens,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    cachedTokens: row.cachedTokens,
    requestCount: row.requestCount,
    successCount: row.successCount ?? 0,
    failureCount: row.failureCount ?? 0,
    avgCostPerRequest,
  };
}

/**
 * Get cost breakdown by dimension.
 */
export async function getCostBreakdown(
  dimension: "model" | "agent" | "project" | "provider",
  filter?: CostFilter,
): Promise<CostBreakdown> {
  const conditions = [];

  if (filter?.organizationId) {
    conditions.push(eq(costRecords.organizationId, filter.organizationId));
  }
  if (filter?.projectId) {
    conditions.push(eq(costRecords.projectId, filter.projectId));
  }
  if (filter?.since) {
    conditions.push(gte(costRecords.timestamp, filter.since));
  }
  if (filter?.until) {
    conditions.push(lte(costRecords.timestamp, filter.until));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Map dimension to column
  const dimensionColumn = {
    model: costRecords.model,
    agent: costRecords.agentId,
    project: costRecords.projectId,
    provider: costRecords.provider,
  }[dimension];

  const result = await db
    .select({
      key: dimensionColumn,
      totalCostUnits: sql<number>`sum(${costRecords.totalCostUnits})`,
      requestCount: sql<number>`count(*)`,
      // Note: cachedTokens is a SUBSET of promptTokens, so we don't add it to avoid double-counting
      totalTokens: sql<number>`sum(${costRecords.promptTokens} + ${costRecords.completionTokens})`,
    })
    .from(costRecords)
    .where(whereClause)
    .groupBy(dimensionColumn)
    .orderBy(sql`sum(${costRecords.totalCostUnits}) desc`);

  const totalCostUnits = result.reduce(
    (sum, row) => sum + row.totalCostUnits,
    0,
  );

  const items = result.map((row) => {
    const key = row.key ?? "unknown";
    const percentage =
      totalCostUnits > 0 ? (row.totalCostUnits / totalCostUnits) * 100 : 0;
    const avgCostPerRequest =
      row.requestCount > 0 ? row.totalCostUnits / row.requestCount : 0;
    const costPer1kTokens =
      row.totalTokens > 0 ? (row.totalCostUnits / row.totalTokens) * 1000 : 0;

    return {
      key,
      label: key,
      totalCostUnits: row.totalCostUnits,
      percentageOfTotal: percentage,
      requestCount: row.requestCount,
      avgCostPerRequest,
      totalTokens: row.totalTokens,
      costPer1kTokens,
      trend: "stable" as CostTrend, // Would need historical comparison for real trend
      trendPercent: 0,
    };
  });

  return {
    dimension,
    items,
    totalCostUnits,
    period: {
      start: filter?.since ?? new Date(0),
      end: filter?.until ?? new Date(),
    },
  };
}

/**
 * Get hourly cost trend data.
 */
export async function getHourlyCostTrend(
  filter?: CostFilter,
  hours = 24,
): Promise<Array<{ hour: Date; costUnits: number; requestCount: number }>> {
  const now = new Date();
  const since =
    filter?.since ?? new Date(now.getTime() - hours * 60 * 60 * 1000);

  const conditions = [gte(costRecords.timestamp, since)];

  if (filter?.organizationId) {
    conditions.push(eq(costRecords.organizationId, filter.organizationId));
  }
  if (filter?.projectId) {
    conditions.push(eq(costRecords.projectId, filter.projectId));
  }
  if (filter?.until) {
    conditions.push(lte(costRecords.timestamp, filter.until));
  }

  const result = await db
    .select({
      hour: sql<string>`strftime('%Y-%m-%d %H:00:00', ${costRecords.timestamp})`,
      costUnits: sql<number>`sum(${costRecords.totalCostUnits})`,
      requestCount: sql<number>`count(*)`,
    })
    .from(costRecords)
    .where(and(...conditions))
    .groupBy(sql`strftime('%Y-%m-%d %H:00:00', ${costRecords.timestamp})`)
    .orderBy(sql`strftime('%Y-%m-%d %H:00:00', ${costRecords.timestamp})`);

  return result.map((row) => ({
    hour: new Date(row.hour),
    costUnits: row.costUnits,
    requestCount: row.requestCount,
  }));
}

/**
 * Get daily cost trend data.
 */
export async function getDailyCostTrend(
  filter?: CostFilter,
  days = 30,
): Promise<Array<{ date: Date; costUnits: number; requestCount: number }>> {
  const now = new Date();
  const since =
    filter?.since ?? new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const conditions = [gte(costRecords.timestamp, since)];

  if (filter?.organizationId) {
    conditions.push(eq(costRecords.organizationId, filter.organizationId));
  }
  if (filter?.projectId) {
    conditions.push(eq(costRecords.projectId, filter.projectId));
  }
  if (filter?.until) {
    conditions.push(lte(costRecords.timestamp, filter.until));
  }

  const result = await db
    .select({
      date: sql<string>`date(${costRecords.timestamp})`,
      costUnits: sql<number>`sum(${costRecords.totalCostUnits})`,
      requestCount: sql<number>`count(*)`,
    })
    .from(costRecords)
    .where(and(...conditions))
    .groupBy(sql`date(${costRecords.timestamp})`)
    .orderBy(sql`date(${costRecords.timestamp})`);

  return result.map((row) => ({
    date: new Date(row.date),
    costUnits: row.costUnits,
    requestCount: row.requestCount,
  }));
}

/**
 * Get top spending agents.
 */
export async function getTopSpendingAgents(
  filter?: CostFilter,
  limit = 10,
): Promise<
  Array<{
    agentId: string;
    totalCostUnits: number;
    requestCount: number;
    avgCostPerRequest: number;
  }>
> {
  const conditions = [sql`${costRecords.agentId} IS NOT NULL`];

  if (filter?.organizationId) {
    conditions.push(eq(costRecords.organizationId, filter.organizationId));
  }
  if (filter?.projectId) {
    conditions.push(eq(costRecords.projectId, filter.projectId));
  }
  if (filter?.since) {
    conditions.push(gte(costRecords.timestamp, filter.since));
  }
  if (filter?.until) {
    conditions.push(lte(costRecords.timestamp, filter.until));
  }

  const result = await db
    .select({
      agentId: costRecords.agentId,
      totalCostUnits: sql<number>`sum(${costRecords.totalCostUnits})`,
      requestCount: sql<number>`count(*)`,
    })
    .from(costRecords)
    .where(and(...conditions))
    .groupBy(costRecords.agentId)
    .orderBy(sql`sum(${costRecords.totalCostUnits}) desc`)
    .limit(limit);

  return result.map((row) => ({
    agentId: row.agentId!,
    totalCostUnits: row.totalCostUnits,
    requestCount: row.requestCount,
    avgCostPerRequest:
      row.requestCount > 0 ? row.totalCostUnits / row.requestCount : 0,
  }));
}

// ============================================================================
// Rate Card Management
// ============================================================================

/**
 * Add or update a rate card.
 */
export async function upsertRateCard(
  rateCard: Omit<ModelRateCard, "effectiveDate"> & { effectiveDate?: Date },
): Promise<ModelRateCard> {
  const now = new Date();
  const effectiveDate = rateCard.effectiveDate ?? now;

  const id = `rate_${rateCard.provider}_${rateCard.model}_${effectiveDate.getTime()}`;

  await db
    .insert(modelRateCards)
    .values({
      id,
      model: rateCard.model,
      provider: rateCard.provider,
      promptCostPer1kTokens: rateCard.promptCostPer1kTokens,
      completionCostPer1kTokens: rateCard.completionCostPer1kTokens,
      cachedPromptCostPer1kTokens: rateCard.cachedPromptCostPer1kTokens ?? null,
      effectiveDate,
      expiresAt: rateCard.expiresAt ?? null,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [
        modelRateCards.model,
        modelRateCards.provider,
        modelRateCards.effectiveDate,
      ],
      set: {
        promptCostPer1kTokens: rateCard.promptCostPer1kTokens,
        completionCostPer1kTokens: rateCard.completionCostPer1kTokens,
        cachedPromptCostPer1kTokens:
          rateCard.cachedPromptCostPer1kTokens ?? null,
        expiresAt: rateCard.expiresAt ?? null,
      },
    });

  // Invalidate cache
  rateCardCacheLastRefresh = 0;

  return {
    ...rateCard,
    effectiveDate,
  };
}

/**
 * Get all rate cards.
 */
export async function getAllRateCards(): Promise<ModelRateCard[]> {
  const rows = await db
    .select()
    .from(modelRateCards)
    .orderBy(desc(modelRateCards.effectiveDate));

  return rows.map((row) => {
    const rateCard: ModelRateCard = {
      model: row.model,
      provider: row.provider as ProviderId,
      promptCostPer1kTokens: row.promptCostPer1kTokens,
      completionCostPer1kTokens: row.completionCostPer1kTokens,
      effectiveDate: row.effectiveDate,
    };
    if (row.cachedPromptCostPer1kTokens !== null) {
      rateCard.cachedPromptCostPer1kTokens = row.cachedPromptCostPer1kTokens;
    }
    if (row.expiresAt) {
      rateCard.expiresAt = row.expiresAt;
    }
    return rateCard;
  });
}

// ============================================================================
// Cost Formatting Utilities
// ============================================================================

/**
 * Format cost units (millicents) to display string.
 */
export function formatCostUnits(units: number): string {
  // Convert millicents to dollars
  const dollars = units / 100000;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

/**
 * Convert dollars to cost units (millicents).
 */
export function dollarsToUnits(dollars: number): number {
  return Math.round(dollars * 100000);
}

/**
 * Convert cost units to dollars.
 */
export function unitsToDollars(units: number): number {
  return units / 100000;
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Clear all cost data (for testing).
 */
export async function clearCostData(): Promise<void> {
  await db.delete(costRecords);
  await db.delete(costAggregates);
  rateCardCache.clear();
  rateCardCacheLastRefresh = 0;
}
