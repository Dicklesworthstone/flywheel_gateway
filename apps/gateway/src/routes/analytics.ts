/**
 * Analytics Routes - REST API endpoints for agent performance analytics.
 *
 * Provides endpoints for:
 * - Agent performance summaries
 * - Productivity, quality, and efficiency metrics
 * - Model comparison reports
 * - Fleet-wide analytics overview
 * - AI-powered recommendations
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import {
  type AnalyticsPeriod,
  getAgentPerformanceSummary,
  getFleetAnalytics,
  getModelComparisonReport,
  getProductivityMetrics,
  getQualityMetrics,
  getSuccessRateMetrics,
  getTaskDurationMetrics,
  getTokenEfficiencyMetrics,
} from "../services/agent-analytics.service";
import {
  sendError,
  sendInternalError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";
import { getLinkContext } from "../utils/links";

const analytics = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const PeriodSchema = z.enum(["1h", "24h", "7d", "30d"]).default("24h");

const AnalyticsQuerySchema = z.object({
  period: PeriodSchema,
});

// ============================================================================
// Error Handler
// ============================================================================

function handleError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof z.ZodError) {
    return sendValidationError(c, transformZodError(error));
  }

  log.error({ error }, "Unexpected error in analytics route");
  return sendInternalError(c);
}

// ============================================================================
// Fleet Analytics
// ============================================================================

/**
 * GET /analytics/fleet - Get fleet-wide analytics overview
 */
analytics.get("/fleet", async (c) => {
  try {
    const query = AnalyticsQuerySchema.safeParse({
      period: c.req.query("period"),
    });

    if (!query.success) {
      return sendValidationError(c, transformZodError(query.error));
    }

    const period = query.data.period as AnalyticsPeriod;
    const result = await getFleetAnalytics(period);

    const ctx = getLinkContext(c);
    return sendResource(c, "fleet_analytics", {
      ...result,
      period,
      links: {
        self: `${ctx.baseUrl}/analytics/fleet`,
        models: `${ctx.baseUrl}/analytics/models`,
      },
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Model Comparison
// ============================================================================

/**
 * GET /analytics/models - Get model comparison report
 */
analytics.get("/models", async (c) => {
  try {
    const query = AnalyticsQuerySchema.safeParse({
      period: c.req.query("period"),
    });

    if (!query.success) {
      return sendValidationError(c, transformZodError(query.error));
    }

    const period = query.data.period as AnalyticsPeriod;
    const report = await getModelComparisonReport(period);

    const ctx = getLinkContext(c);
    return sendResource(c, "model_comparison", {
      period: {
        start: report.period.start.toISOString(),
        end: report.period.end.toISOString(),
      },
      models: report.models,
      taskTypeBreakdown: report.taskTypeBreakdown,
      recommendations: report.recommendations,
      links: {
        self: `${ctx.baseUrl}/analytics/models`,
        fleet: `${ctx.baseUrl}/analytics/fleet`,
      },
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Agent Performance Summary
// ============================================================================

/**
 * GET /analytics/agents/:agentId - Get full performance summary for an agent
 */
analytics.get("/agents/:agentId", async (c) => {
  try {
    const agentId = c.req.param("agentId");
    const query = AnalyticsQuerySchema.safeParse({
      period: c.req.query("period"),
    });

    if (!query.success) {
      return sendValidationError(c, transformZodError(query.error));
    }

    const period = query.data.period as AnalyticsPeriod;
    const summary = await getAgentPerformanceSummary(agentId, period);

    const ctx = getLinkContext(c);
    return sendResource(c, "agent_performance", {
      agentId: summary.agentId,
      agentName: summary.agentName,
      model: summary.model,
      period: summary.period,
      productivity: summary.productivity,
      quality: summary.quality,
      efficiency: summary.efficiency,
      successRate: summary.successRate,
      duration: summary.duration,
      recommendations: summary.recommendations,
      links: {
        self: `${ctx.baseUrl}/analytics/agents/${agentId}`,
        productivity: `${ctx.baseUrl}/analytics/agents/${agentId}/productivity`,
        quality: `${ctx.baseUrl}/analytics/agents/${agentId}/quality`,
        efficiency: `${ctx.baseUrl}/analytics/agents/${agentId}/efficiency`,
        agent: `${ctx.baseUrl}/agents/${agentId}`,
      },
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /analytics/agents/:agentId/productivity - Get productivity metrics
 */
analytics.get("/agents/:agentId/productivity", async (c) => {
  try {
    const agentId = c.req.param("agentId");
    const query = AnalyticsQuerySchema.safeParse({
      period: c.req.query("period"),
    });

    if (!query.success) {
      return sendValidationError(c, transformZodError(query.error));
    }

    const period = query.data.period as AnalyticsPeriod;
    const metrics = await getProductivityMetrics(agentId, period);

    const ctx = getLinkContext(c);
    return sendResource(c, "productivity_metrics", {
      ...metrics,
      links: {
        self: `${ctx.baseUrl}/analytics/agents/${agentId}/productivity`,
        summary: `${ctx.baseUrl}/analytics/agents/${agentId}`,
      },
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /analytics/agents/:agentId/quality - Get quality metrics
 */
analytics.get("/agents/:agentId/quality", async (c) => {
  try {
    const agentId = c.req.param("agentId");
    const query = AnalyticsQuerySchema.safeParse({
      period: c.req.query("period"),
    });

    if (!query.success) {
      return sendValidationError(c, transformZodError(query.error));
    }

    const period = query.data.period as AnalyticsPeriod;
    const metrics = await getQualityMetrics(agentId, period);

    const ctx = getLinkContext(c);
    return sendResource(c, "quality_metrics", {
      ...metrics,
      links: {
        self: `${ctx.baseUrl}/analytics/agents/${agentId}/quality`,
        summary: `${ctx.baseUrl}/analytics/agents/${agentId}`,
      },
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /analytics/agents/:agentId/efficiency - Get efficiency metrics
 */
analytics.get("/agents/:agentId/efficiency", async (c) => {
  try {
    const agentId = c.req.param("agentId");
    const metrics = await getTokenEfficiencyMetrics(agentId);

    const ctx = getLinkContext(c);
    return sendResource(c, "efficiency_metrics", {
      ...metrics,
      links: {
        self: `${ctx.baseUrl}/analytics/agents/${agentId}/efficiency`,
        summary: `${ctx.baseUrl}/analytics/agents/${agentId}`,
      },
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /analytics/agents/:agentId/success-rate - Get success rate metrics
 */
analytics.get("/agents/:agentId/success-rate", async (c) => {
  try {
    const agentId = c.req.param("agentId");
    const query = AnalyticsQuerySchema.safeParse({
      period: c.req.query("period"),
    });

    if (!query.success) {
      return sendValidationError(c, transformZodError(query.error));
    }

    const period = query.data.period as AnalyticsPeriod;
    const metrics = await getSuccessRateMetrics(agentId, period);

    const ctx = getLinkContext(c);
    return sendResource(c, "success_rate_metrics", {
      ...metrics,
      links: {
        self: `${ctx.baseUrl}/analytics/agents/${agentId}/success-rate`,
        summary: `${ctx.baseUrl}/analytics/agents/${agentId}`,
      },
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /analytics/agents/:agentId/duration - Get task duration metrics
 */
analytics.get("/agents/:agentId/duration", async (c) => {
  try {
    const agentId = c.req.param("agentId");
    const query = AnalyticsQuerySchema.safeParse({
      period: c.req.query("period"),
    });

    if (!query.success) {
      return sendValidationError(c, transformZodError(query.error));
    }

    const period = query.data.period as AnalyticsPeriod;
    const metrics = await getTaskDurationMetrics(agentId, period);

    const ctx = getLinkContext(c);
    return sendResource(c, "duration_metrics", {
      ...metrics,
      links: {
        self: `${ctx.baseUrl}/analytics/agents/${agentId}/duration`,
        summary: `${ctx.baseUrl}/analytics/agents/${agentId}`,
      },
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /analytics/agents/:agentId/recommendations - Get recommendations only
 */
analytics.get("/agents/:agentId/recommendations", async (c) => {
  try {
    const agentId = c.req.param("agentId");
    const query = AnalyticsQuerySchema.safeParse({
      period: c.req.query("period"),
    });

    if (!query.success) {
      return sendValidationError(c, transformZodError(query.error));
    }

    const period = query.data.period as AnalyticsPeriod;
    const summary = await getAgentPerformanceSummary(agentId, period);

    const ctx = getLinkContext(c);
    return sendList(
      c,
      summary.recommendations.map((rec) => ({
        ...rec,
        links: {
          agent: `${ctx.baseUrl}/analytics/agents/${agentId}`,
        },
      })),
      { total: summary.recommendations.length },
    );
  } catch (error) {
    return handleError(error, c);
  }
});

export { analytics };
