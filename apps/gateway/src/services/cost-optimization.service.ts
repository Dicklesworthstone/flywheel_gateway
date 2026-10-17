/**
 * Cost Optimization Service
 *
 * Analyzes usage patterns and generates recommendations for reducing costs.
 * Identifies opportunities for model switches, caching, batching, and consolidation.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/connection";
import { costRecords, optimizationRecommendations } from "../db/schema";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import type {
  ImplementationStatus,
  OptimizationCategory,
  OptimizationRecommendation,
  OptimizationSummary,
  ProviderId,
  RiskLevel,
} from "../models/cost";

// ============================================================================
// Recommendation ID Generation
// ============================================================================

/**
 * Generate a unique recommendation ID.
 */
function generateRecommendationId(): string {
  const randomBytes = new Uint8Array(6);
  crypto.getRandomValues(randomBytes);
  const random = Array.from(randomBytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 8);
  return `rec_${Date.now()}_${random}`;
}

// ============================================================================
// Model Cost Comparison
// ============================================================================

/**
 * Model tier information for optimization suggestions.
 */
interface ModelTier {
  model: string;
  provider: ProviderId;
  tier: "premium" | "standard" | "economy";
  relativeCost: number; // 1.0 = baseline
  capabilities: string[];
}

const MODEL_TIERS: ModelTier[] = [
  // Anthropic
  {
    model: "claude-opus-4",
    provider: "anthropic",
    tier: "premium",
    relativeCost: 10.0,
    capabilities: ["complex-reasoning", "creative", "analysis", "coding"],
  },
  {
    model: "claude-sonnet-4",
    provider: "anthropic",
    tier: "standard",
    relativeCost: 2.0,
    capabilities: ["reasoning", "coding", "analysis"],
  },
  {
    model: "claude-3-5-haiku",
    provider: "anthropic",
    tier: "economy",
    relativeCost: 0.1,
    capabilities: ["simple-tasks", "classification", "extraction"],
  },
  // OpenAI
  {
    model: "gpt-4o",
    provider: "openai",
    tier: "premium",
    relativeCost: 8.0,
    capabilities: ["complex-reasoning", "creative", "analysis"],
  },
  {
    model: "gpt-4o-mini",
    provider: "openai",
    tier: "economy",
    relativeCost: 0.3,
    capabilities: ["simple-tasks", "coding", "extraction"],
  },
  // Google
  {
    model: "gemini-1.5-pro",
    provider: "google",
    tier: "standard",
    relativeCost: 3.0,
    capabilities: ["reasoning", "analysis", "long-context"],
  },
  {
    model: "gemini-2.0-flash",
    provider: "google",
    tier: "economy",
    relativeCost: 0.15,
    capabilities: ["simple-tasks", "fast-response"],
  },
];

/**
 * Get model tier information.
 */
function getModelTier(model: string): ModelTier | undefined {
  return MODEL_TIERS.find(
    (t) => model === t.model || model.startsWith(t.model),
  );
}

/**
 * Find cheaper alternative models.
 */
function findCheaperAlternatives(model: string): ModelTier[] {
  const currentTier = getModelTier(model);
  if (!currentTier) return [];

  return MODEL_TIERS.filter(
    (t) =>
      t.relativeCost < currentTier.relativeCost &&
      t.provider === currentTier.provider,
  ).sort((a, b) => b.relativeCost - a.relativeCost);
}

// ============================================================================
// Recommendation Generators
// ============================================================================

/**
 * Analyze model usage and generate model optimization recommendations.
 */
async function analyzeModelOptimization(
  daysBack: number = 30,
  filter?: { organizationId?: string; projectId?: string },
): Promise<OptimizationRecommendation[]> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const recommendations: OptimizationRecommendation[] = [];

  const conditions = [gte(costRecords.timestamp, since)];
  if (filter?.organizationId) {
    conditions.push(eq(costRecords.organizationId, filter.organizationId));
  }
  if (filter?.projectId) {
    conditions.push(eq(costRecords.projectId, filter.projectId));
  }

  // Get usage by model and task type
  const usageByModel = await db
    .select({
      model: costRecords.model,
      taskType: costRecords.taskType,
      totalCost: sql<number>`sum(${costRecords.totalCostUnits})`,
      requestCount: sql<number>`count(*)`,
      successRate: sql<number>`avg(case when ${costRecords.success} = 1 then 100 else 0 end)`,
      avgTokens: sql<number>`avg(${costRecords.promptTokens} + ${costRecords.completionTokens})`,
    })
    .from(costRecords)
    .where(and(...conditions))
    .groupBy(costRecords.model, costRecords.taskType);

  for (const usage of usageByModel) {
    const modelTier = getModelTier(usage.model);
    if (!modelTier || modelTier.tier !== "premium") {
      continue;
    }

    const alternatives = findCheaperAlternatives(usage.model);
    if (alternatives.length === 0) {
      continue;
    }

    const bestAlternative = alternatives[0]!;
    const savingsPercent =
      ((modelTier.relativeCost - bestAlternative.relativeCost) /
        modelTier.relativeCost) *
      100;
    const estimatedSavings = Math.round(
      usage.totalCost * (savingsPercent / 100),
    );

    // Only recommend if savings are significant
    if (estimatedSavings < 10000) {
      // $0.10 minimum
      continue;
    }

    const taskDesc = usage.taskType ?? "general";
    recommendations.push({
      id: generateRecommendationId(),
      category: "model_optimization",
      title: `Switch ${taskDesc} tasks to ${bestAlternative.model}`,
      description: `Analysis shows ${usage.requestCount} ${taskDesc} tasks last ${daysBack} days used ${usage.model}. These tasks have ${usage.successRate?.toFixed(0) ?? "N/A"}% success rate with ${bestAlternative.model} at ${savingsPercent.toFixed(0)}% lower cost.`,
      currentCostUnits: usage.totalCost,
      optimizedCostUnits: usage.totalCost - estimatedSavings,
      estimatedSavingsUnits: estimatedSavings,
      savingsPercent,
      confidence: usage.successRate && usage.successRate > 90 ? 0.85 : 0.7,
      implementation: `Update agent configuration to route ${taskDesc} tasks to ${bestAlternative.model}`,
      risk: "low",
      affectedModels: [usage.model, bestAlternative.model],
      ...(filter?.organizationId && { organizationId: filter.organizationId }),
      ...(filter?.projectId && { projectId: filter.projectId }),
      status: "pending",
      priority:
        estimatedSavings > 100000 ? 5 : estimatedSavings > 50000 ? 4 : 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  return recommendations;
}

/**
 * Analyze caching opportunities.
 */
async function analyzeCachingOpportunities(
  daysBack: number = 30,
  filter?: { organizationId?: string; projectId?: string },
): Promise<OptimizationRecommendation[]> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const recommendations: OptimizationRecommendation[] = [];

  const conditions = [gte(costRecords.timestamp, since)];
  if (filter?.organizationId) {
    conditions.push(eq(costRecords.organizationId, filter.organizationId));
  }
  if (filter?.projectId) {
    conditions.push(eq(costRecords.projectId, filter.projectId));
  }

  // Look for patterns with high prompt token usage and low cached tokens
  const cachingAnalysis = await db
    .select({
      model: costRecords.model,
      totalPromptTokens: sql<number>`sum(${costRecords.promptTokens})`,
      totalCachedTokens: sql<number>`sum(${costRecords.cachedTokens})`,
      totalPromptCost: sql<number>`sum(${costRecords.promptCostUnits})`,
      requestCount: sql<number>`count(*)`,
      avgPromptTokens: sql<number>`avg(${costRecords.promptTokens})`,
    })
    .from(costRecords)
    .where(and(...conditions))
    .groupBy(costRecords.model);

  for (const analysis of cachingAnalysis) {
    const cacheRate =
      analysis.totalPromptTokens > 0
        ? analysis.totalCachedTokens / analysis.totalPromptTokens
        : 0;

    // Recommend caching if cache rate is low and there's significant volume
    if (
      cacheRate < 0.1 &&
      analysis.totalPromptTokens > 100000 &&
      analysis.avgPromptTokens > 1000
    ) {
      // Estimate 50% of prompt tokens could be cached at 90% discount
      const potentialCachedTokens = analysis.totalPromptTokens * 0.5;
      const currentCostForThose =
        (potentialCachedTokens / analysis.totalPromptTokens) *
        analysis.totalPromptCost;
      const savingsPercent = 75; // Cached tokens typically 75-90% cheaper
      const estimatedSavings = Math.round(
        currentCostForThose * (savingsPercent / 100),
      );

      if (estimatedSavings < 5000) continue;

      recommendations.push({
        id: generateRecommendationId(),
        category: "caching",
        title: `Enable prompt caching for ${analysis.model}`,
        description: `Detected ${analysis.requestCount.toLocaleString()} requests with ${(analysis.avgPromptTokens).toFixed(0)} avg prompt tokens. Only ${(cacheRate * 100).toFixed(1)}% are currently cached. Enabling prompt caching could save up to ${savingsPercent}% on cacheable tokens.`,
        currentCostUnits: analysis.totalPromptCost,
        optimizedCostUnits: analysis.totalPromptCost - estimatedSavings,
        estimatedSavingsUnits: estimatedSavings,
        savingsPercent,
        confidence: 0.8,
        implementation:
          "Enable cache_control in API calls for system prompts and common context",
        risk: "low",
        affectedModels: [analysis.model],
        ...(filter?.organizationId && {
          organizationId: filter.organizationId,
        }),
        ...(filter?.projectId && { projectId: filter.projectId }),
        status: "pending",
        priority: 4,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  return recommendations;
}

/**
 * Analyze agent consolidation opportunities.
 */
async function analyzeConsolidation(
  daysBack: number = 30,
  filter?: { organizationId?: string; projectId?: string },
): Promise<OptimizationRecommendation[]> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const recommendations: OptimizationRecommendation[] = [];

  const conditions = [
    gte(costRecords.timestamp, since),
    sql`${costRecords.agentId} IS NOT NULL`,
  ];
  if (filter?.organizationId) {
    conditions.push(eq(costRecords.organizationId, filter.organizationId));
  }
  if (filter?.projectId) {
    conditions.push(eq(costRecords.projectId, filter.projectId));
  }

  // Analyze agent utilization
  const agentUsage = await db
    .select({
      agentId: costRecords.agentId,
      totalCost: sql<number>`sum(${costRecords.totalCostUnits})`,
      requestCount: sql<number>`count(*)`,
      distinctDays: sql<number>`count(distinct date(${costRecords.timestamp}))`,
    })
    .from(costRecords)
    .where(and(...conditions))
    .groupBy(costRecords.agentId);

  // Find low-utilization agents
  const lowUtilizationAgents = agentUsage.filter(
    (a) => a.distinctDays < daysBack * 0.1 || a.requestCount < 10,
  );

  if (lowUtilizationAgents.length >= 3) {
    const totalCostOfLowUtil = lowUtilizationAgents.reduce(
      (sum, a) => sum + a.totalCost,
      0,
    );
    const estimatedSavings = Math.round(totalCostOfLowUtil * 0.3);

    recommendations.push({
      id: generateRecommendationId(),
      category: "consolidation",
      title: `Consolidate ${lowUtilizationAgents.length} low-utilization agents`,
      description: `Found ${lowUtilizationAgents.length} agents with <10% utilization. Consolidating to fewer agents could reduce overhead and improve resource efficiency.`,
      currentCostUnits: totalCostOfLowUtil,
      optimizedCostUnits: totalCostOfLowUtil - estimatedSavings,
      estimatedSavingsUnits: estimatedSavings,
      savingsPercent: 30,
      confidence: 0.7,
      implementation:
        "Migrate workloads from low-utilization agents and retire unused instances",
      risk: "medium",
      effortHours: 4,
      affectedAgents: lowUtilizationAgents
        .map((a) => a.agentId)
        .filter((id): id is string => id !== null),
      ...(filter?.organizationId && { organizationId: filter.organizationId }),
      ...(filter?.projectId && { projectId: filter.projectId }),
      status: "pending",
      priority: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  return recommendations;
}

/**
 * Analyze scheduling optimization opportunities.
 */
async function analyzeScheduling(
  daysBack: number = 30,
  filter?: { organizationId?: string; projectId?: string },
): Promise<OptimizationRecommendation[]> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const recommendations: OptimizationRecommendation[] = [];

  const conditions = [gte(costRecords.timestamp, since)];
  if (filter?.organizationId) {
    conditions.push(eq(costRecords.organizationId, filter.organizationId));
  }
  if (filter?.projectId) {
    conditions.push(eq(costRecords.projectId, filter.projectId));
  }

  // Analyze usage by hour of day
  const hourlyUsage = await db
    .select({
      hour: sql<number>`strftime('%H', ${costRecords.timestamp})`,
      totalCost: sql<number>`sum(${costRecords.totalCostUnits})`,
      requestCount: sql<number>`count(*)`,
    })
    .from(costRecords)
    .where(and(...conditions))
    .groupBy(sql`strftime('%H', ${costRecords.timestamp})`);

  if (hourlyUsage.length < 12) {
    return recommendations;
  }

  // Find peak hours (top 25%)
  const sortedByUsage = [...hourlyUsage].sort(
    (a, b) => b.totalCost - a.totalCost,
  );
  const peakHours = sortedByUsage.slice(
    0,
    Math.ceil(hourlyUsage.length * 0.25),
  );
  const offPeakHours = sortedByUsage.slice(
    Math.ceil(hourlyUsage.length * 0.25),
  );

  const peakCost = peakHours.reduce((sum, h) => sum + h.totalCost, 0);
  const offPeakCost = offPeakHours.reduce((sum, h) => sum + h.totalCost, 0);

  // If peak hours have significantly more cost, suggest off-peak scheduling
  if (peakCost > offPeakCost * 2 && peakCost > 50000) {
    const potentialShift = peakCost * 0.3; // Assume 30% could be shifted
    const estimatedSavings = Math.round(potentialShift * 0.5); // Batch API is 50% cheaper

    recommendations.push({
      id: generateRecommendationId(),
      category: "scheduling",
      title: "Shift non-urgent tasks to off-peak hours",
      description: `Peak hours (${peakHours.map((h) => h.hour).join(", ")}) account for ${((peakCost / (peakCost + offPeakCost)) * 100).toFixed(0)}% of costs. Shifting non-urgent tasks to off-peak hours and using batch API could reduce costs.`,
      currentCostUnits: peakCost,
      optimizedCostUnits: peakCost - estimatedSavings,
      estimatedSavingsUnits: estimatedSavings,
      savingsPercent: 50,
      confidence: 0.65,
      implementation:
        "Configure batch queue for non-urgent tasks to process during off-peak hours with batch API",
      risk: "low",
      ...(filter?.organizationId && { organizationId: filter.organizationId }),
      ...(filter?.projectId && { projectId: filter.projectId }),
      status: "pending",
      priority: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  return recommendations;
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Generate all optimization recommendations.
 */
export async function generateRecommendations(options?: {
  organizationId?: string;
  projectId?: string;
  daysBack?: number;
}): Promise<OptimizationRecommendation[]> {
  const correlationId = getCorrelationId();
  const log = getLogger();

  const daysBack = options?.daysBack ?? 30;
  const filter: { organizationId?: string; projectId?: string } = {
    ...(options?.organizationId && { organizationId: options.organizationId }),
    ...(options?.projectId && { projectId: options.projectId }),
  };

  const allRecommendations: OptimizationRecommendation[] = [];

  // Run all analyzers
  const [modelRecs, cachingRecs, consolidationRecs, schedulingRecs] =
    await Promise.all([
      analyzeModelOptimization(daysBack, filter),
      analyzeCachingOpportunities(daysBack, filter),
      analyzeConsolidation(daysBack, filter),
      analyzeScheduling(daysBack, filter),
    ]);

  allRecommendations.push(
    ...modelRecs,
    ...cachingRecs,
    ...consolidationRecs,
    ...schedulingRecs,
  );

  // Store recommendations in database
  const now = new Date();
  for (const rec of allRecommendations) {
    await db.insert(optimizationRecommendations).values({
      id: rec.id,
      category: rec.category,
      title: rec.title,
      description: rec.description,
      currentCostUnits: rec.currentCostUnits,
      optimizedCostUnits: rec.optimizedCostUnits,
      estimatedSavingsUnits: rec.estimatedSavingsUnits,
      savingsPercent: rec.savingsPercent,
      confidence: rec.confidence,
      implementation: rec.implementation,
      risk: rec.risk,
      effortHours: rec.effortHours ?? null,
      prerequisites: rec.prerequisites
        ? JSON.stringify(rec.prerequisites)
        : null,
      organizationId: rec.organizationId ?? null,
      projectId: rec.projectId ?? null,
      affectedAgents: rec.affectedAgents
        ? JSON.stringify(rec.affectedAgents)
        : null,
      affectedModels: rec.affectedModels
        ? JSON.stringify(rec.affectedModels)
        : null,
      status: rec.status,
      priority: rec.priority,
      createdAt: now,
      updatedAt: now,
    });
  }

  log.info({
    type: "recommendations:generated",
    correlationId,
    count: allRecommendations.length,
    totalPotentialSavings: allRecommendations.reduce(
      (sum, r) => sum + r.estimatedSavingsUnits,
      0,
    ),
  });

  return allRecommendations;
}

/**
 * Get optimization recommendations.
 */
export async function getRecommendations(filter?: {
  organizationId?: string;
  projectId?: string;
  category?: OptimizationCategory;
  status?: ImplementationStatus;
  limit?: number;
}): Promise<OptimizationRecommendation[]> {
  const conditions = [];

  if (filter?.organizationId) {
    conditions.push(
      eq(optimizationRecommendations.organizationId, filter.organizationId),
    );
  }
  if (filter?.projectId) {
    conditions.push(
      eq(optimizationRecommendations.projectId, filter.projectId),
    );
  }
  if (filter?.category) {
    conditions.push(eq(optimizationRecommendations.category, filter.category));
  }
  if (filter?.status) {
    conditions.push(eq(optimizationRecommendations.status, filter.status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = filter?.limit ?? 50;

  const rows = await db
    .select()
    .from(optimizationRecommendations)
    .where(whereClause)
    .orderBy(
      desc(optimizationRecommendations.priority),
      desc(optimizationRecommendations.estimatedSavingsUnits),
    )
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    category: row.category as OptimizationCategory,
    title: row.title,
    description: row.description,
    currentCostUnits: row.currentCostUnits,
    optimizedCostUnits: row.optimizedCostUnits,
    estimatedSavingsUnits: row.estimatedSavingsUnits,
    savingsPercent: row.savingsPercent,
    confidence: row.confidence,
    implementation: row.implementation,
    risk: row.risk as RiskLevel,
    ...(row.effortHours !== null && { effortHours: row.effortHours }),
    ...(row.prerequisites && {
      prerequisites: JSON.parse(row.prerequisites) as string[],
    }),
    ...(row.organizationId !== null && { organizationId: row.organizationId }),
    ...(row.projectId !== null && { projectId: row.projectId }),
    ...(row.affectedAgents && {
      affectedAgents: JSON.parse(row.affectedAgents) as string[],
    }),
    ...(row.affectedModels && {
      affectedModels: JSON.parse(row.affectedModels) as string[],
    }),
    status: row.status as ImplementationStatus,
    ...(row.implementedAt !== null && { implementedAt: row.implementedAt }),
    ...(row.implementedBy !== null && { implementedBy: row.implementedBy }),
    ...(row.rejectedReason !== null && { rejectedReason: row.rejectedReason }),
    ...(row.actualSavingsUnits !== null && {
      actualSavingsUnits: row.actualSavingsUnits,
    }),
    ...(row.validatedAt !== null && { validatedAt: row.validatedAt }),
    priority: row.priority,
    ...(row.expiresAt !== null && { expiresAt: row.expiresAt }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

/**
 * Get optimization summary.
 */
export async function getOptimizationSummary(filter?: {
  organizationId?: string;
  projectId?: string;
}): Promise<OptimizationSummary> {
  const recommendations = await getRecommendations({
    ...filter,
    limit: 1000,
  });

  const byCategory: Record<OptimizationCategory, number> = {
    model_optimization: 0,
    caching: 0,
    batching: 0,
    context_optimization: 0,
    consolidation: 0,
    scheduling: 0,
    rate_limiting: 0,
  };

  let totalPotentialSavings = 0;
  let implementedSavings = 0;
  const pendingRecommendations: OptimizationRecommendation[] = [];

  for (const rec of recommendations) {
    byCategory[rec.category]++;

    if (rec.status === "pending" || rec.status === "in_progress") {
      totalPotentialSavings += rec.estimatedSavingsUnits;
      pendingRecommendations.push(rec);
    } else if (rec.status === "implemented") {
      implementedSavings += rec.actualSavingsUnits ?? rec.estimatedSavingsUnits;
    }
  }

  return {
    totalRecommendations: recommendations.length,
    byCategory,
    totalPotentialSavingsUnits: totalPotentialSavings,
    implementedSavingsUnits: implementedSavings,
    pendingRecommendations: pendingRecommendations.slice(0, 10),
  };
}

/**
 * Update recommendation status.
 */
export async function updateRecommendationStatus(
  recommendationId: string,
  status: ImplementationStatus,
  details?: {
    implementedBy?: string;
    rejectedReason?: string;
    actualSavingsUnits?: number;
  },
): Promise<OptimizationRecommendation | undefined> {
  const now = new Date();

  const updateFields: Record<string, unknown> = {
    status,
    updatedAt: now,
  };

  if (status === "implemented") {
    updateFields["implementedAt"] = now;
    if (details?.implementedBy)
      updateFields["implementedBy"] = details.implementedBy;
    if (details?.actualSavingsUnits !== undefined)
      updateFields["actualSavingsUnits"] = details.actualSavingsUnits;
    updateFields["validatedAt"] = now;
  } else if (status === "rejected") {
    if (details?.rejectedReason)
      updateFields["rejectedReason"] = details.rejectedReason;
  }

  // Check if recommendation exists before updating
  const existing = await db
    .select()
    .from(optimizationRecommendations)
    .where(eq(optimizationRecommendations.id, recommendationId))
    .limit(1);

  if (existing.length === 0) {
    return undefined;
  }

  await db
    .update(optimizationRecommendations)
    .set(updateFields)
    .where(eq(optimizationRecommendations.id, recommendationId));

  const rows = await db
    .select()
    .from(optimizationRecommendations)
    .where(eq(optimizationRecommendations.id, recommendationId))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;

  return {
    id: row.id,
    category: row.category as OptimizationCategory,
    title: row.title,
    description: row.description,
    currentCostUnits: row.currentCostUnits,
    optimizedCostUnits: row.optimizedCostUnits,
    estimatedSavingsUnits: row.estimatedSavingsUnits,
    savingsPercent: row.savingsPercent,
    confidence: row.confidence,
    implementation: row.implementation,
    risk: row.risk as RiskLevel,
    ...(row.effortHours !== null && { effortHours: row.effortHours }),
    status: row.status as ImplementationStatus,
    ...(row.implementedAt !== null && { implementedAt: row.implementedAt }),
    ...(row.implementedBy !== null && { implementedBy: row.implementedBy }),
    ...(row.rejectedReason !== null && { rejectedReason: row.rejectedReason }),
    ...(row.actualSavingsUnits !== null && {
      actualSavingsUnits: row.actualSavingsUnits,
    }),
    ...(row.validatedAt !== null && { validatedAt: row.validatedAt }),
    priority: row.priority,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Clear all optimization data (for testing).
 */
export async function clearOptimizationData(): Promise<void> {
  await db.delete(optimizationRecommendations);
}
