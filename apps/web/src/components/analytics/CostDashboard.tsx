/**
 * CostDashboard - Main cost analytics dashboard component.
 *
 * Provides comprehensive cost visibility with:
 * - Summary metrics cards
 * - Budget gauges
 * - Cost trends
 * - Breakdown by dimension
 * - 30-day forecasts
 * - Optimization recommendations
 */

import { useEffect, useState } from "react";
import { StatusPill } from "../ui/StatusPill";
import { BudgetGauge } from "./BudgetGauge";
import { CostBreakdownChart } from "./CostBreakdownChart";
import { CostForecastChart } from "./CostForecastChart";
import { CostTrendChart } from "./CostTrendChart";
import { OptimizationRecommendations } from "./OptimizationRecommendations";
import "./CostDashboard.css";

// API types matching backend responses
interface CostSummary {
  totalCostUnits: number;
  formattedTotalCost: string;
  formattedAvgCost: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  requestCount: number;
  successCount: number;
  failureCount: number;
  avgCostPerRequest: number;
}

interface BudgetStatus {
  budgetId: string;
  budgetName: string;
  period?: "daily" | "weekly" | "monthly" | "yearly";
  amountUnits?: number;
  formattedBudget?: string;
  periodStart: string;
  periodEnd: string;
  usedUnits: number;
  usedPercent: number;
  remainingUnits: number;
  formattedUsed: string;
  formattedRemaining: string;
  burnRateUnitsPerDay: number;
  projectedExceed: boolean;
  daysUntilExhausted?: number;
  status: string;
}

interface CostCapEntry {
  id: string;
  workspaceId: string;
  name: string;
  period: string;
  limitUsd: number;
  currentSpendUsd: number;
  softThresholdPercent: number;
  hardAction: string;
  enabled: boolean;
}

interface TrendDataPoint {
  date: string;
  costUnits: number;
  formattedCost: string;
  requestCount: number;
}

interface BreakdownItem {
  key: string;
  label: string;
  totalCostUnits: number;
  percentageOfTotal: number;
  formattedCost: string;
  requestCount: number;
  trend?: "up" | "down" | "stable";
  trendPercent?: number;
}

interface CostBreakdown {
  dimension: string;
  totalCostUnits: number;
  formattedTotalCost: string;
  items: BreakdownItem[];
}

interface DailyForecast {
  date: string;
  predictedCostUnits: number;
  formattedPredicted: string;
  lowerBoundUnits: number;
  upperBoundUnits: number;
  confidence: number;
}

interface Forecast {
  id: string;
  forecastDate: string;
  horizonDays: number;
  totalForecastUnits: number;
  formattedForecast: string;
  confidence95: { lower: number; upper: number };
  methodology: string;
  trendDirection: "up" | "down" | "stable";
  trendStrength: number;
  seasonalityDetected?: boolean;
  accuracyMetrics?: { mape?: number; rmse?: number };
  dailyForecasts: DailyForecast[];
}

interface Recommendation {
  id: string;
  category:
    | "model_optimization"
    | "caching"
    | "batching"
    | "context_optimization"
    | "consolidation"
    | "scheduling"
    | "rate_limiting";
  title: string;
  description: string;
  estimatedSavingsUnits: number;
  formattedSavings: string;
  savingsPercent: number;
  confidence: number;
  risk: "low" | "medium" | "high";
  status: "pending" | "in_progress" | "implemented" | "rejected" | "failed";
  priority: number;
  implementation?: string;
}

interface OptimizationSummary {
  totalRecommendations: number;
  totalPotentialSavingsUnits: number;
  formattedPotentialSavings: string;
  implementedSavingsUnits: number;
  formattedImplementedSavings: string;
  topRecommendations: Recommendation[];
}

type BreakdownDimension = "model" | "agent" | "provider" | "project";

// API helper
const API_BASE = "/api/cost-analytics";

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  }
  const data = await response.json();
  return data.data ?? data;
}

function extractList<T>(val: T[] | { items?: T[]; caps?: T[] } | null): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (Array.isArray(val.items)) return val.items;
  if (Array.isArray(val.caps)) return val.caps;
  return [];
}

export function CostDashboard() {
  // State for all data
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [budgetStatuses, setBudgetStatuses] = useState<BudgetStatus[]>([]);
  const [costCaps, setCostCaps] = useState<CostCapEntry[]>([]);
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([]);
  const [dimension, setDimension] = useState<BreakdownDimension>("model");
  const [breakdown, setBreakdown] = useState<CostBreakdown | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [optimizationSummary, setOptimizationSummary] =
    useState<OptimizationSummary | null>(null);

  // Loading and error states
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch all data
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      // Fetch all data in parallel; settle each request so we can show partial data when possible.
      const results = await Promise.allSettled([
        fetchJSON<CostSummary>(`${API_BASE}/summary`),
        fetchJSON<BudgetStatus[] | { items: BudgetStatus[] }>(
          `${API_BASE}/budget-statuses`,
        ),
        fetchJSON<TrendDataPoint[] | { items: TrendDataPoint[] }>(
          `${API_BASE}/trends/daily?days=30`,
        ),
        fetchJSON<CostBreakdown>(`${API_BASE}/breakdown/model`),
        fetchJSON<Forecast>(`${API_BASE}/forecasts/latest`),
        fetchJSON<Recommendation[] | { items: Recommendation[] }>(
          `${API_BASE}/recommendations`,
        ),
        fetchJSON<OptimizationSummary>(`${API_BASE}/recommendations/summary`),
        fetchJSON<CostCapEntry[] | { caps: CostCapEntry[] }>("/api/cost-caps"),
      ]);

      const [
        summaryRes,
        budgetsRes,
        trendRes,
        breakdownRes,
        forecastRes,
        recsRes,
        optSummaryRes,
        capsRes,
      ] = results;

      const coreResults = [
        summaryRes,
        budgetsRes,
        trendRes,
        breakdownRes,
        forecastRes,
        recsRes,
        optSummaryRes,
      ];

      if (coreResults.every((result) => result.status === "rejected")) {
        const detail = coreResults
          .map((result) =>
            result.status === "rejected"
              ? result.reason instanceof Error
                ? result.reason.message
                : String(result.reason)
              : null,
          )
          .filter((msg): msg is string => Boolean(msg))
          .join("; ");

        setError(detail || "Failed to load cost data");
        setLoading(false);
        return;
      }

      if (summaryRes.status === "fulfilled") {
        setSummary(summaryRes.value);
      }

      if (budgetsRes.status === "fulfilled") {
        setBudgetStatuses(extractList(budgetsRes.value));
      }

      if (trendRes.status === "fulfilled") {
        setTrendData(extractList(trendRes.value));
      }

      if (breakdownRes.status === "fulfilled") {
        setBreakdown(breakdownRes.value);
      }

      if (forecastRes.status === "fulfilled" && forecastRes.value) {
        setForecast(forecastRes.value);
      }

      if (recsRes.status === "fulfilled") {
        setRecommendations(extractList(recsRes.value));
      }

      if (optSummaryRes.status === "fulfilled") {
        setOptimizationSummary(optSummaryRes.value);
      }

      if (capsRes.status === "fulfilled") {
        setCostCaps(extractList(capsRes.value));
      }

      setLoading(false);
    }

    fetchData();
  }, []);

  // Switch breakdown dimension
  const handleDimensionChange = async (nextDim: BreakdownDimension) => {
    setDimension(nextDim);
    const res = await fetchJSON<CostBreakdown>(
      `${API_BASE}/breakdown/${nextDim}`,
    ).catch(() => null);
    if (res) {
      setBreakdown(res);
    }
  };

  // Generate a new 30-day forecast on demand
  const handleGenerateForecast = async () => {
    setActionBusy("forecast");
    try {
      await fetchJSON(`${API_BASE}/forecasts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horizonDays: 30, methodology: "ensemble" }),
      });
      const latest = await fetchJSON<Forecast>(
        `${API_BASE}/forecasts/latest`,
      ).catch(() => null);
      if (latest) {
        setForecast(latest);
      }
    } catch {
      // Ignore error
    } finally {
      setActionBusy(null);
    }
  };

  // Generate optimization recommendations on demand
  const handleGenerateRecommendations = async () => {
    setActionBusy("recommendations");
    try {
      await fetchJSON(`${API_BASE}/recommendations/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daysBack: 30 }),
      });
      const [recsRes, optRes] = await Promise.all([
        fetchJSON<Recommendation[] | { items: Recommendation[] }>(
          `${API_BASE}/recommendations`,
        ).catch(() => null),
        fetchJSON<OptimizationSummary>(
          `${API_BASE}/recommendations/summary`,
        ).catch(() => null),
      ]);
      if (recsRes) setRecommendations(extractList(recsRes));
      if (optRes) setOptimizationSummary(optRes);
    } catch {
      // Ignore error
    } finally {
      setActionBusy(null);
    }
  };

  // Handle recommendation status update
  const handleRecommendationStatusUpdate = async (
    id: string,
    status: string,
  ) => {
    const updateResponse = await fetch(
      `${API_BASE}/recommendations/${id}/status`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      },
    ).catch((err) => {
      console.error("[CostDashboard] Failed to update recommendation status", {
        id,
        status,
        err,
      });
      return null;
    });

    if (!updateResponse?.ok) return;

    // Refresh recommendations
    const recsRes = await fetchJSON<
      Recommendation[] | { items: Recommendation[] }
    >(`${API_BASE}/recommendations`).catch((err) => {
      console.error("[CostDashboard] Failed to refresh recommendations", {
        err,
      });
      return null;
    });

    if (!recsRes) return;

    setRecommendations(extractList(recsRes));
  };

  if (loading) {
    return (
      <div className="cost-dashboard cost-dashboard--loading">
        <div className="cost-dashboard__loading-message">
          Loading cost analytics...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cost-dashboard cost-dashboard--error">
        <div className="cost-dashboard__error-message">
          <h3>Failed to load cost data</h3>
          <p>{error}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="cost-dashboard">
      {/* Summary Cards */}
      <section className="cost-dashboard__summary">
        <div className="card card--metric">
          <div className="card__header">
            <h3>Total Cost (30d)</h3>
            <StatusPill tone="muted">All models</StatusPill>
          </div>
          <p className="metric">{summary?.formattedTotalCost ?? "$0.00"}</p>
          <p className="muted">
            {(summary?.requestCount ?? 0).toLocaleString()} requests
          </p>
        </div>

        <div className="card card--metric">
          <div className="card__header">
            <h3>Avg Cost/Request</h3>
            <StatusPill tone="muted">30d avg</StatusPill>
          </div>
          <p className="metric">{summary?.formattedAvgCost ?? "$0.00"}</p>
          <p className="muted">
            {Math.round(
              ((summary?.successCount ?? 0) /
                Math.max(summary?.requestCount ?? 1, 1)) *
                100,
            )}
            % success rate
          </p>
        </div>

        <div className="card card--metric">
          <div className="card__header">
            <h3>Token Usage</h3>
            <StatusPill tone="muted">30d total</StatusPill>
          </div>
          <p className="metric">
            {((summary?.totalTokens ?? 0) / 1000000).toFixed(2)}M
          </p>
          <p className="muted">
            {((summary?.cachedTokens ?? 0) / 1000000).toFixed(2)}M cached (
            {summary?.totalTokens
              ? Math.round((summary.cachedTokens / summary.totalTokens) * 100)
              : 0}
            %)
          </p>
        </div>

        <div className="card card--metric">
          <div className="card__header">
            <h3>Potential Savings</h3>
            <StatusPill tone="positive">
              {recommendations.length} suggestions
            </StatusPill>
          </div>
          <p className="metric">
            {optimizationSummary?.formattedPotentialSavings ?? "$0.00"}
          </p>
          <p className="muted">
            {optimizationSummary?.formattedImplementedSavings ?? "$0.00"}{" "}
            already saved
          </p>
        </div>
      </section>

      {/* Toolbar Actions */}
      <section
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
          marginBottom: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="muted" style={{ fontSize: "13px" }}>
            Breakdown by:
          </span>
          {(
            ["model", "agent", "provider", "project"] as BreakdownDimension[]
          ).map((dim) => (
            <button
              key={dim}
              type="button"
              className={`btn btn--sm ${dimension === dim ? "btn--primary" : "btn--secondary"}`}
              onClick={() => handleDimensionChange(dim)}
            >
              {dim.charAt(0).toUpperCase() + dim.slice(1)}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            className="btn btn--sm btn--secondary"
            onClick={handleGenerateForecast}
            disabled={actionBusy === "forecast"}
          >
            {actionBusy === "forecast"
              ? "Generating..."
              : "Generate 30d Forecast"}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--secondary"
            onClick={handleGenerateRecommendations}
            disabled={actionBusy === "recommendations"}
          >
            {actionBusy === "recommendations"
              ? "Scanning..."
              : "Scan for Optimizations"}
          </button>
        </div>
      </section>

      {/* Budget Gauges */}
      {budgetStatuses.length > 0 && (
        <section className="cost-dashboard__budgets">
          <h2>Budget Status</h2>
          <div className="cost-dashboard__budget-grid">
            {budgetStatuses.slice(0, 4).map((budget) => {
              const fallbackBudgetUsd =
                budget.usedPercent > 0
                  ? ((budget.usedUnits / budget.usedPercent) * 100) / 100000
                  : (budget.amountUnits ?? 0) / 100000;
              return (
                <BudgetGauge
                  key={budget.budgetId}
                  name={budget.budgetName}
                  period={budget.period ?? "monthly"}
                  usedPercent={budget.usedPercent}
                  formattedBudget={
                    budget.formattedBudget ?? `$${fallbackBudgetUsd.toFixed(2)}`
                  }
                  formattedUsed={budget.formattedUsed ?? "$0.00"}
                  formattedRemaining={budget.formattedRemaining ?? "$0.00"}
                  {...(budget.daysUntilExhausted !== undefined && {
                    daysUntilExhausted: budget.daysUntilExhausted,
                  })}
                  projectedExceed={budget.projectedExceed}
                  burnRateFormatted={`$${((budget.burnRateUnitsPerDay ?? 0) / 100000).toFixed(2)}`}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Active Workspace Cost Caps */}
      {costCaps.length > 0 && (
        <section style={{ marginBottom: "24px" }}>
          <div className="card">
            <div className="card__header">
              <h3>Enforced Cost Caps & Auto-Throttle Policies</h3>
              <StatusPill tone="positive">{costCaps.length} active</StatusPill>
            </div>
            <div className="grid grid--3">
              {costCaps.map((cap) => {
                const pct =
                  cap.limitUsd > 0
                    ? Math.round((cap.currentSpendUsd / cap.limitUsd) * 100)
                    : 0;
                return (
                  <div key={cap.id} className="card card--compact">
                    <div className="card__header">
                      <strong>{cap.name}</strong>
                      <StatusPill
                        tone={
                          pct >= 100
                            ? "danger"
                            : pct >= cap.softThresholdPercent
                              ? "warning"
                              : "positive"
                        }
                      >
                        {cap.hardAction}
                      </StatusPill>
                    </div>
                    <p className="muted" style={{ margin: "4px 0" }}>
                      ${cap.currentSpendUsd.toFixed(2)} / $
                      {cap.limitUsd.toFixed(2)} ({pct}% of {cap.period} cap)
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Charts Section */}
      <section className="cost-dashboard__charts">
        <div className="cost-dashboard__chart-row">
          <CostTrendChart data={trendData} title="Cost Trend" />
          {breakdown && (
            <CostBreakdownChart
              items={breakdown.items}
              dimension={
                (breakdown.dimension as BreakdownDimension) || dimension
              }
              formattedTotalCost={breakdown.formattedTotalCost}
              title={`Cost by ${dimension.charAt(0).toUpperCase() + dimension.slice(1)}`}
            />
          )}
        </div>
      </section>

      {/* Forecast Section */}
      {forecast && (
        <section className="cost-dashboard__forecast">
          <CostForecastChart
            dailyForecasts={forecast.dailyForecasts}
            formattedForecast={forecast.formattedForecast}
            totalForecastUnits={forecast.totalForecastUnits}
            confidence95={forecast.confidence95}
            trendDirection={forecast.trendDirection}
            trendStrength={forecast.trendStrength}
            methodology={forecast.methodology}
            {...(forecast.seasonalityDetected !== undefined && {
              seasonalityDetected: forecast.seasonalityDetected,
            })}
            {...(forecast.accuracyMetrics !== undefined && {
              accuracyMetrics: forecast.accuracyMetrics,
            })}
          />
        </section>
      )}

      {/* Recommendations Section */}
      <section className="cost-dashboard__recommendations">
        <OptimizationRecommendations
          recommendations={recommendations}
          formattedPotentialSavings={
            optimizationSummary?.formattedPotentialSavings ?? "$0.00"
          }
          formattedImplementedSavings={
            optimizationSummary?.formattedImplementedSavings ?? "$0.00"
          }
          onStatusUpdate={handleRecommendationStatusUpdate}
        />
      </section>
    </div>
  );
}
