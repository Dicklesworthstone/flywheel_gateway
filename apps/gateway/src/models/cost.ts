/**
 * Cost Analytics Data Model
 *
 * Defines structures for cost tracking, budgets, forecasting, and optimization.
 */

// ============================================================================
// Provider and Model Types
// ============================================================================

/**
 * AI provider identifiers.
 */
export type ProviderId = "anthropic" | "openai" | "google" | "local";

/**
 * Complexity tier for cost attribution.
 */
export type ComplexityTier = "simple" | "moderate" | "complex";

/**
 * Cost trend direction.
 */
export type CostTrend = "up" | "down" | "stable";

// ============================================================================
// Cost Records
// ============================================================================

/**
 * Individual cost record for API usage.
 */
export interface CostRecord {
  id: string;
  timestamp: Date;

  // Attribution dimensions
  organizationId?: string;
  projectId?: string;
  agentId?: string;
  taskId?: string;
  sessionId?: string;

  // Model info
  model: string;
  provider: ProviderId;

  // Token breakdown
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;

  // Cost calculation (in millicents to avoid floating point)
  promptCostUnits: number;
  completionCostUnits: number;
  cachedCostUnits: number;
  totalCostUnits: number;

  // Context
  taskType?: string;
  complexityTier?: ComplexityTier;
  success: boolean;

  // Request metadata
  requestDurationMs?: number;
  correlationId?: string;
}

/**
 * Input for recording a cost event.
 */
export interface CostRecordInput {
  organizationId?: string;
  projectId?: string;
  agentId?: string;
  taskId?: string;
  sessionId?: string;
  model: string;
  provider: ProviderId;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  taskType?: string;
  complexityTier?: ComplexityTier;
  success: boolean;
  requestDurationMs?: number;
  correlationId?: string;
}

// ============================================================================
// Cost Aggregates
// ============================================================================

/**
 * Aggregation period types.
 */
export type AggregationPeriod = "minute" | "hour" | "day" | "week" | "month";

/**
 * Cost aggregate for a time period.
 */
export interface CostAggregate {
  id: string;
  period: AggregationPeriod;
  periodStart: Date;
  periodEnd: Date;

  // Scope (optional - null means global)
  organizationId?: string;
  projectId?: string;
  agentId?: string;

  // Totals
  totalCostUnits: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;

  // Request stats
  requestCount: number;
  successCount: number;
  failureCount: number;

  // By model breakdown (JSON)
  byModel: Record<string, { costUnits: number; tokens: number; count: number }>;

  // By provider breakdown (JSON)
  byProvider: Record<
    ProviderId,
    { costUnits: number; tokens: number; count: number }
  >;
}

/**
 * Cost breakdown by a specific dimension.
 */
export interface CostBreakdown {
  dimension: "model" | "agent" | "project" | "taskType" | "provider";
  items: Array<{
    key: string;
    label: string;
    totalCostUnits: number;
    percentageOfTotal: number;
    requestCount: number;
    avgCostPerRequest: number;
    totalTokens: number;
    costPer1kTokens: number;
    trend: CostTrend;
    trendPercent: number;
  }>;
  totalCostUnits: number;
  period: { start: Date; end: Date };
}

// ============================================================================
// Budget Management
// ============================================================================

/**
 * Budget period types.
 */
export type BudgetPeriod = "daily" | "weekly" | "monthly" | "yearly";

/**
 * Budget action when exceeded.
 */
export type BudgetAction = "alert" | "throttle" | "block";

/**
 * Budget configuration.
 */
export interface Budget {
  id: string;
  name: string;
  organizationId?: string;
  projectId?: string;

  // Budget config
  period: BudgetPeriod;
  amountUnits: number; // Budget amount in millicents
  alertThresholds: number[]; // e.g., [50, 75, 90, 100]
  actionOnExceed: BudgetAction;
  rollover: boolean;

  // Dates
  effectiveDate: Date;
  expiresAt?: Date;
  enabled: boolean;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Current budget status.
 */
export interface BudgetStatus {
  budget: Budget;
  periodStart: Date;
  periodEnd: Date;

  // Usage
  usedUnits: number;
  usedPercent: number;
  remainingUnits: number;

  // Burn rate
  burnRateUnitsPerDay: number;
  projectedEndOfPeriodUnits: number;
  projectedExceed: boolean;
  daysUntilExhausted?: number;

  // Comparison
  previousPeriodUnits?: number;
  changePercent?: number;

  // Thresholds
  currentThreshold: number; // Highest threshold crossed
  alertsTriggered: number[];

  // Status
  status: "healthy" | "warning" | "critical" | "exceeded";
  lastUpdatedAt: Date;
}

/**
 * Budget creation/update input.
 */
export interface BudgetInput {
  name: string;
  organizationId?: string;
  projectId?: string;
  period: BudgetPeriod;
  amountUnits: number;
  alertThresholds?: number[];
  actionOnExceed?: BudgetAction;
  rollover?: boolean;
  effectiveDate?: Date;
  expiresAt?: Date;
  enabled?: boolean;
}

// ============================================================================
// Cost Forecasting
// ============================================================================

/**
 * Forecasting methodology.
 */
export type ForecastMethodology =
  | "linear"
  | "arima"
  | "prophet"
  | "exponential"
  | "ensemble";

/**
 * Daily forecast point.
 */
export interface DailyForecast {
  date: Date;
  predictedCostUnits: number;
  lowerBoundUnits: number;
  upperBoundUnits: number;
  confidence: number; // 0-1
}

/**
 * Complete cost forecast.
 */
export interface CostForecast {
  id: string;
  forecastDate: Date;
  horizonDays: number;

  // Scope
  organizationId?: string;
  projectId?: string;

  // Forecast data
  dailyForecasts: DailyForecast[];
  totalForecastUnits: number;
  confidenceInterval95: {
    lower: number;
    upper: number;
  };

  // Methodology
  methodology: ForecastMethodology;
  accuracyMetrics: {
    mape: number; // Mean Absolute Percentage Error
    rmse: number; // Root Mean Square Error
  };

  // Historical basis
  historicalDaysUsed: number;
  seasonalityDetected: boolean;
  trendDirection: CostTrend;
  trendStrength: number; // 0-1

  createdAt: Date;
}

/**
 * Scenario analysis for forecasting.
 */
export interface ForecastScenario {
  name: string;
  description: string;
  adjustmentPercent: number; // e.g., -20 for 20% reduction
  totalForecastUnits: number;
  dailyForecasts: DailyForecast[];
}

// ============================================================================
// Cost Optimization
// ============================================================================

/**
 * Optimization recommendation category.
 */
export type OptimizationCategory =
  | "model_optimization"
  | "caching"
  | "batching"
  | "context_optimization"
  | "consolidation"
  | "scheduling"
  | "rate_limiting";

/**
 * Risk level for recommendations.
 */
export type RiskLevel = "low" | "medium" | "high";

/**
 * Implementation status.
 */
export type ImplementationStatus =
  | "pending"
  | "in_progress"
  | "implemented"
  | "rejected"
  | "failed";

/**
 * Optimization recommendation.
 */
export interface OptimizationRecommendation {
  id: string;
  category: OptimizationCategory;
  title: string;
  description: string;

  // Savings estimation
  currentCostUnits: number;
  optimizedCostUnits: number;
  estimatedSavingsUnits: number;
  savingsPercent: number;
  confidence: number; // 0-1

  // Implementation
  implementation: string;
  risk: RiskLevel;
  effortHours?: number;
  prerequisites?: string[];

  // Scope
  organizationId?: string;
  projectId?: string;
  affectedAgents?: string[];
  affectedModels?: string[];

  // Status
  status: ImplementationStatus;
  implementedAt?: Date;
  implementedBy?: string;
  rejectedReason?: string;

  // Validation
  actualSavingsUnits?: number;
  validatedAt?: Date;

  // Metadata
  priority: number; // 1-5, higher = more important
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Optimization summary.
 */
export interface OptimizationSummary {
  totalRecommendations: number;
  byCategory: Record<OptimizationCategory, number>;
  totalPotentialSavingsUnits: number;
  implementedSavingsUnits: number;
  pendingRecommendations: OptimizationRecommendation[];
}

// ============================================================================
// Cost Dashboard
// ============================================================================

/**
 * Cost dashboard overview.
 */
export interface CostDashboard {
  timestamp: Date;
  correlationId?: string;

  // Current period summary
  currentPeriod: {
    start: Date;
    end: Date;
    totalCostUnits: number;
    totalTokens: number;
    requestCount: number;
  };

  // Trends
  trends: {
    daily: Array<{ date: Date; costUnits: number }>;
    hourly: Array<{ hour: Date; costUnits: number }>;
    byModel: CostBreakdown;
    byProvider: CostBreakdown;
  };

  // Budgets
  budgets: BudgetStatus[];

  // Forecast
  forecast?: CostForecast;

  // Top spenders
  topAgents: Array<{
    agentId: string;
    agentName?: string;
    costUnits: number;
    requestCount: number;
  }>;

  // Recommendations
  recommendations: OptimizationRecommendation[];
}

// ============================================================================
// Rate Cards
// ============================================================================

/**
 * Model rate card for cost calculation.
 */
export interface ModelRateCard {
  model: string;
  provider: ProviderId;
  promptCostPer1kTokens: number; // In millicents
  completionCostPer1kTokens: number;
  cachedPromptCostPer1kTokens?: number;
  effectiveDate: Date;
  expiresAt?: Date;
}

/**
 * Default rate cards (fallback if not configured).
 * Note: These are placeholder values - actual rates should be configured externally.
 */
export const DEFAULT_RATE_CARDS: ModelRateCard[] = [
  // Anthropic models
  {
    model: "claude-opus-4",
    provider: "anthropic",
    promptCostPer1kTokens: 15000, // $15.00 per 1M = 1500 millicents per 1k
    completionCostPer1kTokens: 75000,
    cachedPromptCostPer1kTokens: 1500,
    effectiveDate: new Date("2024-01-01"),
  },
  {
    model: "claude-sonnet-4",
    provider: "anthropic",
    promptCostPer1kTokens: 3000,
    completionCostPer1kTokens: 15000,
    cachedPromptCostPer1kTokens: 300,
    effectiveDate: new Date("2024-01-01"),
  },
  {
    model: "claude-3-5-haiku",
    provider: "anthropic",
    promptCostPer1kTokens: 80,
    completionCostPer1kTokens: 400,
    cachedPromptCostPer1kTokens: 8,
    effectiveDate: new Date("2024-01-01"),
  },
  // OpenAI models
  {
    model: "gpt-4o",
    provider: "openai",
    promptCostPer1kTokens: 2500,
    completionCostPer1kTokens: 10000,
    effectiveDate: new Date("2024-01-01"),
  },
  {
    model: "gpt-4o-mini",
    provider: "openai",
    promptCostPer1kTokens: 150,
    completionCostPer1kTokens: 600,
    effectiveDate: new Date("2024-01-01"),
  },
  // Google models
  {
    model: "gemini-2.0-flash",
    provider: "google",
    promptCostPer1kTokens: 75,
    completionCostPer1kTokens: 300,
    effectiveDate: new Date("2024-01-01"),
  },
  {
    model: "gemini-1.5-pro",
    provider: "google",
    promptCostPer1kTokens: 1250,
    completionCostPer1kTokens: 5000,
    effectiveDate: new Date("2024-01-01"),
  },
];

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Filter for cost queries.
 */
export interface CostFilter {
  organizationId?: string;
  projectId?: string;
  agentId?: string;
  model?: string;
  provider?: ProviderId;
  taskType?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  startingAfter?: string;
  endingBefore?: string;
}

/**
 * Response with pagination for cost records.
 */
export interface CostRecordListResponse {
  records: CostRecord[];
  hasMore: boolean;
  total: number;
  nextCursor?: string;
  prevCursor?: string;
}

// ============================================================================
// Events
// ============================================================================

/**
 * Cost-related WebSocket event types.
 */
export type CostEventType =
  | "cost:recorded"
  | "cost:aggregate_updated"
  | "budget:threshold_crossed"
  | "budget:exceeded"
  | "forecast:updated"
  | "recommendation:created"
  | "recommendation:implemented";

/**
 * Cost event payload.
 */
export interface CostEvent {
  type: CostEventType;
  timestamp: Date;
  correlationId?: string;
  data:
    | CostRecord
    | CostAggregate
    | BudgetStatus
    | CostForecast
    | OptimizationRecommendation;
}
