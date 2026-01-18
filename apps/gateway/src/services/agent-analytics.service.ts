/**
 * Agent Analytics Service - Core analytics computation for agent performance.
 *
 * Provides comprehensive agent performance analytics including:
 * - Productivity metrics (tasks completed, success rate, duration)
 * - Quality metrics (error rate, rollback rate, conflict rate)
 * - Efficiency metrics (tokens per task, usage per task)
 * - Model comparison reports
 * - AI-powered recommendations
 */

import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../db";
import { agents as agentsTable, history as historyTable } from "../db/schema";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import { analyticsCache, generateCacheKey } from "./query-cache";

// ============================================================================
// Types
// ============================================================================

export type AnalyticsPeriod = "1h" | "24h" | "7d" | "30d";

export type TrendDirection = "improving" | "stable" | "declining";

export interface SuccessRateMetric {
  agentId: string;
  period: AnalyticsPeriod;
  totalTasks: number;
  successfulTasks: number;
  successRate: number;
  trend: TrendDirection;
  percentileRank: number;
}

export interface TaskDurationMetric {
  agentId: string;
  period: AnalyticsPeriod;
  median: number;
  p95: number;
  p99: number;
  avgDuration: number;
  byComplexity: Record<string, number>;
}

export interface TokenEfficiencyMetric {
  agentId: string;
  model: string;
  avgTokensPerTask: number;
  avgPromptTokens: number;
  avgCompletionTokens: number;
  efficiencyScore: number;
  vsFleetAverage: number;
}

export interface QualityMetric {
  agentId: string;
  period: AnalyticsPeriod;
  errorRate: number;
  errorsByCategory: Record<string, number>;
  meanTimeBetweenErrors: number;
  conflictRate: number;
  conflictsResolved: number;
}

export interface ProductivityMetric {
  agentId: string;
  period: AnalyticsPeriod;
  tasksCompleted: number;
  successfulTasks: number;
  failedTasks: number;
  avgDurationMs: number;
  totalTokens: number;
}

export interface ModelPerformance {
  model: string;
  tasksCompleted: number;
  successRate: number;
  avgDurationSeconds: number;
  avgTokensUsed: number;
  avgCostUnits: number;
  qualityScore: number;
}

export interface ModelComparisonReport {
  period: { start: Date; end: Date };
  models: ModelPerformance[];
  taskTypeBreakdown: Array<{
    taskType: string;
    modelPerformance: Record<string, number>;
  }>;
  recommendations: string[];
}

export interface PerformanceRecommendation {
  id: string;
  agentId: string;
  category: "configuration" | "model_selection" | "workload" | "prompt";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  expectedImprovement: string;
  evidence: Array<{ metric: string; value: number; threshold: number }>;
  actions: string[];
}

export interface AgentPerformanceSummary {
  agentId: string;
  agentName?: string;
  model?: string;
  period: AnalyticsPeriod;
  productivity: ProductivityMetric;
  quality: QualityMetric;
  efficiency: TokenEfficiencyMetric;
  successRate: SuccessRateMetric;
  duration: TaskDurationMetric;
  recommendations: PerformanceRecommendation[];
}

export interface AnalyticsQueryOptions {
  agentId?: string;
  model?: string;
  period?: AnalyticsPeriod;
  startDate?: Date;
  endDate?: Date;
}

// ============================================================================
// Constants
// ============================================================================

const PERIOD_MS: Record<AnalyticsPeriod, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

// ============================================================================
// Helper Functions
// ============================================================================

function getPeriodDates(period: AnalyticsPeriod): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end.getTime() - PERIOD_MS[period]);
  return { start, end };
}

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)]!;
}

function calculateTrend(current: number, previous: number): TrendDirection {
  if (previous === 0) return current > 0 ? "improving" : "stable";
  const change = ((current - previous) / previous) * 100;
  if (change > 5) return "improving";
  if (change < -5) return "declining";
  return "stable";
}

function generateRecommendationId(): string {
  const timestamp = Date.now().toString(36);
  const randomBytes = new Uint8Array(4);
  crypto.getRandomValues(randomBytes);
  const random = Array.from(randomBytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 6);
  return `rec_${timestamp}_${random}`;
}

// ============================================================================
// Core Analytics Functions
// ============================================================================

/**
 * Get productivity metrics for an agent.
 * Results are cached for 30 seconds to reduce database load.
 */
export async function getProductivityMetrics(
  agentId: string,
  period: AnalyticsPeriod = "24h",
): Promise<ProductivityMetric> {
  const cacheKey = generateCacheKey("productivity", { agentId, period });

  return analyticsCache.getOrCompute(cacheKey, async () => {
    const { start, end } = getPeriodDates(period);

    const rows = await db
      .select()
      .from(historyTable)
      .where(
        and(
          eq(historyTable.agentId, agentId),
          gte(historyTable.createdAt, start),
          lte(historyTable.createdAt, end),
        ),
      );

    let successfulTasks = 0;
    let failedTasks = 0;
    let totalDuration = 0;
    let totalTokens = 0;

    for (const row of rows) {
      const output = row.output as Record<string, unknown> | null;
      const input = row.input as Record<string, unknown> | null;
      const outcome = output?.["outcome"] as string | undefined;

      if (outcome === "success") {
        successfulTasks++;
      } else if (outcome === "failure" || outcome === "timeout") {
        failedTasks++;
      }

      totalDuration += row.durationMs;
      totalTokens +=
        ((input?.["promptTokens"] as number) ?? 0) +
        ((output?.["responseTokens"] as number) ?? 0);
    }

    const tasksCompleted = successfulTasks + failedTasks;

    return {
      agentId,
      period,
      tasksCompleted,
      successfulTasks,
      failedTasks,
      avgDurationMs: tasksCompleted > 0 ? totalDuration / tasksCompleted : 0,
      totalTokens,
    };
  }) as Promise<ProductivityMetric>;
}

/**
 * Get success rate metrics for an agent.
 */
export async function getSuccessRateMetrics(
  agentId: string,
  period: AnalyticsPeriod = "24h",
): Promise<SuccessRateMetric> {
  const productivity = await getProductivityMetrics(agentId, period);

  // Get previous period for trend
  const previousPeriodMs = PERIOD_MS[period];
  const { start: prevStart, end: prevEnd } = {
    end: new Date(Date.now() - previousPeriodMs),
    start: new Date(Date.now() - 2 * previousPeriodMs),
  };

  const prevRows = await db
    .select()
    .from(historyTable)
    .where(
      and(
        eq(historyTable.agentId, agentId),
        gte(historyTable.createdAt, prevStart),
        lte(historyTable.createdAt, prevEnd),
      ),
    );

  let prevSuccessful = 0;
  let prevTotal = 0;
  for (const row of prevRows) {
    const output = row.output as Record<string, unknown> | null;
    const outcome = output?.["outcome"] as string | undefined;
    if (outcome === "success") prevSuccessful++;
    if (
      outcome === "success" ||
      outcome === "failure" ||
      outcome === "timeout"
    ) {
      prevTotal++;
    }
  }

  const currentRate =
    productivity.tasksCompleted > 0
      ? (productivity.successfulTasks / productivity.tasksCompleted) * 100
      : 0;
  const previousRate = prevTotal > 0 ? (prevSuccessful / prevTotal) * 100 : 0;

  // TODO: Calculate percentile rank vs fleet (needs all agents' data)
  const percentileRank = 50; // Placeholder

  return {
    agentId,
    period,
    totalTasks: productivity.tasksCompleted,
    successfulTasks: productivity.successfulTasks,
    successRate: currentRate,
    trend: calculateTrend(currentRate, previousRate),
    percentileRank,
  };
}

/**
 * Get task duration metrics for an agent.
 * Results are cached for 30 seconds to reduce database load.
 */
export async function getTaskDurationMetrics(
  agentId: string,
  period: AnalyticsPeriod = "24h",
): Promise<TaskDurationMetric> {
  const cacheKey = generateCacheKey("duration", { agentId, period });

  return analyticsCache.getOrCompute(cacheKey, async () => {
    const { start, end } = getPeriodDates(period);

    const rows = await db
      .select()
      .from(historyTable)
      .where(
        and(
          eq(historyTable.agentId, agentId),
          gte(historyTable.createdAt, start),
          lte(historyTable.createdAt, end),
        ),
      );

    const durations: number[] = [];
    const byComplexity: Record<string, number[]> = {
      simple: [],
      medium: [],
      complex: [],
    };

    for (const row of rows) {
      if (row.durationMs > 0) {
        durations.push(row.durationMs);

        // Categorize by duration as proxy for complexity
        if (row.durationMs < 5000) {
          byComplexity["simple"]?.push(row.durationMs);
        } else if (row.durationMs < 30000) {
          byComplexity["medium"]?.push(row.durationMs);
        } else {
          byComplexity["complex"]?.push(row.durationMs);
        }
      }
    }

    const avgByComplexity: Record<string, number> = {};
    for (const [complexity, values] of Object.entries(byComplexity)) {
      avgByComplexity[complexity] =
        values.length > 0
          ? values.reduce((a, b) => a + b, 0) / values.length
          : 0;
    }

    return {
      agentId,
      period,
      median: calculatePercentile(durations, 50),
      p95: calculatePercentile(durations, 95),
      p99: calculatePercentile(durations, 99),
      avgDuration:
        durations.length > 0
          ? durations.reduce((a, b) => a + b, 0) / durations.length
          : 0,
      byComplexity: avgByComplexity,
    };
  }) as Promise<TaskDurationMetric>;
}

/**
 * Get quality metrics for an agent.
 * Results are cached for 30 seconds to reduce database load.
 */
export async function getQualityMetrics(
  agentId: string,
  period: AnalyticsPeriod = "24h",
): Promise<QualityMetric> {
  const cacheKey = generateCacheKey("quality", { agentId, period });

  return analyticsCache.getOrCompute(cacheKey, async () => {
    const { start, end } = getPeriodDates(period);

    const rows = await db
      .select()
      .from(historyTable)
      .where(
        and(
          eq(historyTable.agentId, agentId),
          gte(historyTable.createdAt, start),
          lte(historyTable.createdAt, end),
        ),
      );

    let totalTasks = 0;
    let errorCount = 0;
    const errorsByCategory: Record<string, number> = {};
    const errorTimestamps: number[] = [];

    for (const row of rows) {
      const output = row.output as Record<string, unknown> | null;
      const outcome = output?.["outcome"] as string | undefined;
      const error = output?.["error"] as string | undefined;

      if (
        outcome === "success" ||
        outcome === "failure" ||
        outcome === "timeout"
      ) {
        totalTasks++;
      }

      if (outcome === "failure" || outcome === "timeout") {
        errorCount++;
        errorTimestamps.push(row.createdAt.getTime());

        // Categorize error
        let category = "unknown";
        if (error) {
          if (error.includes("timeout")) category = "timeout";
          else if (error.includes("tool")) category = "tool_failure";
          else if (error.includes("model") || error.includes("API"))
            category = "model_error";
          else if (error.includes("cancel")) category = "user_cancel";
          else category = "other";
        }
        errorsByCategory[category] = (errorsByCategory[category] ?? 0) + 1;
      }
    }

    // Calculate mean time between errors
    let mtbe = 0;
    if (errorTimestamps.length > 1) {
      errorTimestamps.sort((a, b) => a - b);
      let totalGap = 0;
      for (let i = 1; i < errorTimestamps.length; i++) {
        totalGap += errorTimestamps[i]! - errorTimestamps[i - 1]!;
      }
      mtbe = totalGap / (errorTimestamps.length - 1);
    }

    return {
      agentId,
      period,
      errorRate: totalTasks > 0 ? (errorCount / totalTasks) * 100 : 0,
      errorsByCategory,
      meanTimeBetweenErrors: mtbe,
      conflictRate: 0, // TODO: Get from reservation/conflict service
      conflictsResolved: 0,
    };
  }) as Promise<QualityMetric>;
}

/**
 * Get token efficiency metrics for an agent.
 * Results are cached for 30 seconds to reduce database load.
 */
export async function getTokenEfficiencyMetrics(
  agentId: string,
  model?: string,
): Promise<TokenEfficiencyMetric> {
  const cacheKey = generateCacheKey("efficiency", { agentId, model });

  return analyticsCache.getOrCompute(cacheKey, async () => {
    // Get agent info to determine model
    const agentRows = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId))
      .limit(1);

    const agentModel = model ?? agentRows[0]?.model ?? "unknown";

    // Get recent history
    const { start, end } = getPeriodDates("7d");
    const rows = await db
      .select()
      .from(historyTable)
      .where(
        and(
          eq(historyTable.agentId, agentId),
          gte(historyTable.createdAt, start),
          lte(historyTable.createdAt, end),
        ),
      );

    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let taskCount = 0;

    for (const row of rows) {
      const input = row.input as Record<string, unknown> | null;
      const output = row.output as Record<string, unknown> | null;
      const outcome = output?.["outcome"] as string | undefined;

      if (outcome === "success" || outcome === "failure") {
        taskCount++;
        totalPromptTokens += (input?.["promptTokens"] as number) ?? 0;
        totalCompletionTokens += (output?.["responseTokens"] as number) ?? 0;
      }
    }

    const avgPromptTokens = taskCount > 0 ? totalPromptTokens / taskCount : 0;
    const avgCompletionTokens =
      taskCount > 0 ? totalCompletionTokens / taskCount : 0;
    const avgTokensPerTask = avgPromptTokens + avgCompletionTokens;

    // Calculate efficiency score (0-100 based on tokens per successful task)
    // Lower tokens = higher efficiency
    const efficiencyScore = Math.max(
      0,
      Math.min(100, 100 - avgTokensPerTask / 100),
    );

    return {
      agentId,
      model: agentModel,
      avgTokensPerTask,
      avgPromptTokens,
      avgCompletionTokens,
      efficiencyScore,
      vsFleetAverage: 0, // TODO: Calculate vs fleet
    };
  }) as Promise<TokenEfficiencyMetric>;
}

/**
 * Get full performance summary for an agent.
 */
export async function getAgentPerformanceSummary(
  agentId: string,
  period: AnalyticsPeriod = "24h",
): Promise<AgentPerformanceSummary> {
  const log = getLogger();

  const [productivity, quality, efficiency, successRate, duration] =
    await Promise.all([
      getProductivityMetrics(agentId, period),
      getQualityMetrics(agentId, period),
      getTokenEfficiencyMetrics(agentId),
      getSuccessRateMetrics(agentId, period),
      getTaskDurationMetrics(agentId, period),
    ]);

  // Get agent info
  const agentRows = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId))
    .limit(1);

  const agent = agentRows[0];
  const agentName = agent?.task ?? undefined;
  const model = agent?.model ?? undefined;

  // Generate recommendations
  const recommendations = generateRecommendations(
    agentId,
    productivity,
    quality,
    efficiency,
    successRate,
    duration,
  );

  log.info(
    {
      correlationId: getCorrelationId(),
      agentId,
      period,
      tasksCompleted: productivity.tasksCompleted,
      successRate: successRate.successRate,
    },
    "Agent performance summary generated",
  );

  const summary: AgentPerformanceSummary = {
    agentId,
    period,
    productivity,
    quality,
    efficiency,
    successRate,
    duration,
    recommendations,
  };
  if (agentName !== undefined) {
    summary.agentName = agentName;
  }
  if (model !== undefined) {
    summary.model = model;
  }
  return summary;
}

/**
 * Get model comparison report.
 *
 * Uses a single batch query with JOIN instead of per-agent queries
 * to avoid N+1 query pattern.
 * Results are cached for 2 minutes to reduce database load.
 */
export async function getModelComparisonReport(
  period: AnalyticsPeriod = "7d",
): Promise<ModelComparisonReport> {
  const cacheKey = generateCacheKey("models", { period });

  return analyticsCache.getOrCompute(cacheKey, async () => {
    const { start, end } = getPeriodDates(period);

    // Get all agents with their models in one query
    const agents = await db.select().from(agentsTable);

    // Build agent ID to model lookup
    const agentModelMap = new Map<string, string>();
    for (const agent of agents) {
      agentModelMap.set(
        agent.id,
        (agent.model as string | undefined) ?? "unknown",
      );
    }

    // Single batch query for all history in the period
    const allHistory = await db
      .select()
      .from(historyTable)
      .where(
        and(
          gte(historyTable.createdAt, start),
          lte(historyTable.createdAt, end),
        ),
      );

    const modelStats = new Map<
      string,
      {
        tasks: number;
        successful: number;
        totalDuration: number;
        totalTokens: number;
      }
    >();

    // Process all history rows, grouping by model
    for (const row of allHistory) {
      const model = agentModelMap.get(row.agentId) ?? "unknown";
      if (!modelStats.has(model)) {
        modelStats.set(model, {
          tasks: 0,
          successful: 0,
          totalDuration: 0,
          totalTokens: 0,
        });
      }

      const output = row.output as Record<string, unknown> | null;
      const input = row.input as Record<string, unknown> | null;
      const outcome = output?.["outcome"] as string | undefined;

      if (outcome === "success" || outcome === "failure") {
        const stats = modelStats.get(model)!;
        stats.tasks++;
        if (outcome === "success") stats.successful++;
        stats.totalDuration += row.durationMs;
        stats.totalTokens +=
          ((input?.["promptTokens"] as number) ?? 0) +
          ((output?.["responseTokens"] as number) ?? 0);
      }
    }

    const models: ModelPerformance[] = [];
    for (const [model, stats] of modelStats) {
      if (stats.tasks > 0) {
        models.push({
          model,
          tasksCompleted: stats.tasks,
          successRate: (stats.successful / stats.tasks) * 100,
          avgDurationSeconds: stats.totalDuration / stats.tasks / 1000,
          avgTokensUsed: stats.totalTokens / stats.tasks,
          avgCostUnits: stats.totalTokens / stats.tasks / 1000, // Simplified cost
          qualityScore: (stats.successful / stats.tasks) * 100,
        });
      }
    }

    // Sort by quality score
    models.sort((a, b) => b.qualityScore - a.qualityScore);

    // Generate recommendations
    const recommendations: string[] = [];
    if (models.length >= 2) {
      const best = models[0]!;
      const worst = models[models.length - 1]!;
      if (best.successRate - worst.successRate > 10) {
        recommendations.push(
          `Consider using ${best.model} for complex tasks - ${best.successRate.toFixed(1)}% success rate vs ${worst.successRate.toFixed(1)}% for ${worst.model}`,
        );
      }
      if (best.avgDurationSeconds < worst.avgDurationSeconds * 0.7) {
        recommendations.push(
          `${best.model} is ${((1 - best.avgDurationSeconds / worst.avgDurationSeconds) * 100).toFixed(0)}% faster than ${worst.model}`,
        );
      }
    }

    return {
      period: { start, end },
      models,
      taskTypeBreakdown: [], // TODO: Implement task type tracking
      recommendations,
    };
  }) as Promise<ModelComparisonReport>;
}

/**
 * Generate performance recommendations based on metrics.
 */
function generateRecommendations(
  agentId: string,
  productivity: ProductivityMetric,
  quality: QualityMetric,
  efficiency: TokenEfficiencyMetric,
  successRate: SuccessRateMetric,
  duration: TaskDurationMetric,
): PerformanceRecommendation[] {
  const recommendations: PerformanceRecommendation[] = [];

  // High error rate recommendation
  if (quality.errorRate > 20) {
    recommendations.push({
      id: generateRecommendationId(),
      agentId,
      category: "configuration",
      priority: "high",
      title: "High error rate detected",
      description: `Agent has ${quality.errorRate.toFixed(1)}% error rate. Consider reviewing system prompt or adding error handling examples.`,
      expectedImprovement: "10-20% reduction in errors",
      evidence: [
        { metric: "error_rate", value: quality.errorRate, threshold: 20 },
      ],
      actions: [
        "Review recent failed tasks for patterns",
        "Add error recovery examples to system prompt",
        "Consider enabling retry mechanism",
      ],
    });
  }

  // Low success rate recommendation
  if (successRate.successRate < 80 && productivity.tasksCompleted > 5) {
    recommendations.push({
      id: generateRecommendationId(),
      agentId,
      category: "prompt",
      priority: successRate.successRate < 50 ? "high" : "medium",
      title: "Below average success rate",
      description: `Success rate of ${successRate.successRate.toFixed(1)}% is below the 80% target.`,
      expectedImprovement: "15-25% improvement in success rate",
      evidence: [
        {
          metric: "success_rate",
          value: successRate.successRate,
          threshold: 80,
        },
      ],
      actions: [
        "Review task instructions for clarity",
        "Add more context to prompts",
        "Consider breaking complex tasks into smaller steps",
      ],
    });
  }

  // Declining trend recommendation
  if (successRate.trend === "declining") {
    recommendations.push({
      id: generateRecommendationId(),
      agentId,
      category: "workload",
      priority: "medium",
      title: "Performance declining",
      description:
        "Agent performance has been declining compared to previous period.",
      expectedImprovement: "Stabilize or improve performance",
      evidence: [],
      actions: [
        "Review recent changes to agent configuration",
        "Check for increased workload or complexity",
        "Monitor for external factors affecting performance",
      ],
    });
  }

  // High token usage recommendation
  if (efficiency.avgTokensPerTask > 5000) {
    recommendations.push({
      id: generateRecommendationId(),
      agentId,
      category: "configuration",
      priority: "low",
      title: "High token usage per task",
      description: `Average ${efficiency.avgTokensPerTask.toFixed(0)} tokens per task. Consider optimizing prompts for efficiency.`,
      expectedImprovement: "20-30% reduction in token usage",
      evidence: [
        {
          metric: "tokens_per_task",
          value: efficiency.avgTokensPerTask,
          threshold: 5000,
        },
      ],
      actions: [
        "Review prompt length and verbosity",
        "Consider using a faster model for simple tasks",
        "Implement context summarization",
      ],
    });
  }

  // Slow task completion recommendation
  if (duration.avgDuration > 60000) {
    // > 1 minute average
    recommendations.push({
      id: generateRecommendationId(),
      agentId,
      category: "workload",
      priority: "medium",
      title: "Slow average task completion",
      description: `Average task takes ${(duration.avgDuration / 1000).toFixed(1)}s. Consider task optimization.`,
      expectedImprovement: "30-50% reduction in task duration",
      evidence: [
        {
          metric: "avg_duration_ms",
          value: duration.avgDuration,
          threshold: 60000,
        },
      ],
      actions: [
        "Break complex tasks into smaller chunks",
        "Pre-compute context where possible",
        "Consider parallel tool execution",
      ],
    });
  }

  return recommendations;
}

/**
 * Get analytics for all agents (fleet overview).
 *
 * Uses a single batch query instead of per-agent queries
 * to avoid N+1 query pattern (was 2N queries, now 2 queries total).
 * Results are cached for 30 seconds to reduce database load.
 */
export async function getFleetAnalytics(
  period: AnalyticsPeriod = "24h",
): Promise<{
  totalAgents: number;
  activeAgents: number;
  avgSuccessRate: number;
  totalTasksCompleted: number;
  topPerformers: Array<{ agentId: string; successRate: number }>;
  needsAttention: Array<{ agentId: string; issue: string }>;
}> {
  type FleetAnalyticsResult = {
    totalAgents: number;
    activeAgents: number;
    avgSuccessRate: number;
    totalTasksCompleted: number;
    topPerformers: Array<{ agentId: string; successRate: number }>;
    needsAttention: Array<{ agentId: string; issue: string }>;
  };

  const cacheKey = generateCacheKey("fleet", { period });

  return analyticsCache.getOrCompute(cacheKey, async () => {
    const { start, end } = getPeriodDates(period);

    // Two queries total: agents + all relevant history
    const agents = await db.select().from(agentsTable);

    const allHistory = await db
      .select()
      .from(historyTable)
      .where(
        and(
          gte(historyTable.createdAt, start),
          lte(historyTable.createdAt, end),
        ),
      );

    // Aggregate metrics per agent in-memory
    const agentMetrics = new Map<
      string,
      {
        successfulTasks: number;
        failedTasks: number;
        totalTasks: number;
        errorCount: number;
      }
    >();

    for (const row of allHistory) {
      if (!agentMetrics.has(row.agentId)) {
        agentMetrics.set(row.agentId, {
          successfulTasks: 0,
          failedTasks: 0,
          totalTasks: 0,
          errorCount: 0,
        });
      }

      const metrics = agentMetrics.get(row.agentId)!;
      const output = row.output as Record<string, unknown> | null;
      const outcome = output?.["outcome"] as string | undefined;

      if (outcome === "success") {
        metrics.successfulTasks++;
        metrics.totalTasks++;
      } else if (outcome === "failure" || outcome === "timeout") {
        metrics.failedTasks++;
        metrics.totalTasks++;
        metrics.errorCount++;
      }
    }

    let activeCount = 0;
    let totalSuccessRate = 0;
    let totalTasks = 0;
    const performanceData: Array<{
      agentId: string;
      successRate: number;
      errorRate: number;
      tasksCompleted: number;
    }> = [];

    for (const agent of agents) {
      const metrics = agentMetrics.get(agent.id);
      if (metrics && metrics.totalTasks > 0) {
        activeCount++;
        const successRate =
          (metrics.successfulTasks / metrics.totalTasks) * 100;
        const errorRate = (metrics.errorCount / metrics.totalTasks) * 100;
        totalSuccessRate += successRate;
        totalTasks += metrics.totalTasks;

        performanceData.push({
          agentId: agent.id,
          successRate,
          errorRate,
          tasksCompleted: metrics.totalTasks,
        });
      }
    }

    // Sort by success rate for top performers
    performanceData.sort((a, b) => b.successRate - a.successRate);

    const topPerformers = performanceData.slice(0, 5).map((p) => ({
      agentId: p.agentId,
      successRate: p.successRate,
    }));

    // Find agents needing attention
    const needsAttention: Array<{ agentId: string; issue: string }> = [];
    for (const p of performanceData) {
      if (p.successRate < 70 && p.tasksCompleted >= 3) {
        needsAttention.push({
          agentId: p.agentId,
          issue: `Low success rate: ${p.successRate.toFixed(1)}%`,
        });
      } else if (p.errorRate > 30) {
        needsAttention.push({
          agentId: p.agentId,
          issue: `High error rate: ${p.errorRate.toFixed(1)}%`,
        });
      }
    }

    return {
      totalAgents: agents.length,
      activeAgents: activeCount,
      avgSuccessRate: activeCount > 0 ? totalSuccessRate / activeCount : 0,
      totalTasksCompleted: totalTasks,
      topPerformers,
      needsAttention: needsAttention.slice(0, 5),
    };
  }) as Promise<FleetAnalyticsResult>;
}
