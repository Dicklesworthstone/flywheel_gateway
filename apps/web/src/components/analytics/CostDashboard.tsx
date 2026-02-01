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

// API helper
const API_BASE = "/api/cost-analytics";

async function fetchJSON<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  }
  const data = await response.json();
  return data.data ?? data;
}

export function CostDashboard() {
  // State for all data
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [budgetStatuses, setBudgetStatuses] = useState<BudgetStatus[]>([]);
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([]);
  const [breakdown, setBreakdown] = useState<CostBreakdown | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [optimizationSummary, setOptimizationSummary] =
    useState<OptimizationSummary | null>(null);

  // Loading and error states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch all data
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        // Fetch all data in parallel
        const [
          summaryRes,
          budgetsRes,
          trendRes,
          breakdownRes,
          forecastRes,
          recsRes,
          optSummaryRes,
        ] = await Promise.allSettled([
          fetchJSON<CostSummary>(`${API_BASE}/summary`),
          fetchJSON<{ items: BudgetStatus[] }>(`${API_BASE}/budget-statuses`),
          fetchJSON<{ items: TrendDataPoint[] }>(
            `${API_BASE}/trends/daily?days=30`,
          ),
          fetchJSON<CostBreakdown>(`${API_BASE}/breakdown/model`),
          fetchJSON<Forecast>(`${API_BASE}/forecasts/latest`),
          fetchJSON<{ items: Recommendation[] }>(`${API_BASE}/recommendations`),
          fetchJSON<OptimizationSummary>(`${API_BASE}/recommendations/summary`),
        ]);

        // Handle summary
        if (summaryRes.status === "fulfilled") {
          setSummary(summaryRes.value);
        }

        // Handle budgets
        if (budgetsRes.status === "fulfilled") {
          setBudgetStatuses(budgetsRes.value.items ?? []);
        }

        // Handle trend
        if (trendRes.status === "fulfilled") {
          setTrendData(trendRes.value.items ?? []);
        }

        // Handle breakdown
        if (breakdownRes.status === "fulfilled") {
          setBreakdown(breakdownRes.value);
        }

        // Handle forecast
        if (forecastRes.status === "fulfilled" && forecastRes.value) {
          setForecast(forecastRes.value);
        }

        // Handle recommendations
        if (recsRes.status === "fulfilled") {
          setRecommendations(recsRes.value.items ?? []);
        }

        // Handle optimization summary
        if (optSummaryRes.status === "fulfilled") {
          setOptimizationSummary(optSummaryRes.value);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load cost data",
        );
      }

      setLoading(false);
    }

    fetchData();
  }, []);

  // Handle recommendation status update
  const handleRecommendationStatusUpdate = async (
    id: string,
    status: string,
  ) => {
    try {
      await fetch(`${API_BASE}/recommendations/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      // Refresh recommendations
      const recsRes = await fetchJSON<{ items: Recommendation[] }>(
        `${API_BASE}/recommendations`,
      );
      setRecommendations(recsRes.items ?? []);
    } catch (err) {
      console.error("Failed to update recommendation status:", err);
    }
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
              ((summary?.successCount ?? 0) / (summary?.requestCount ?? 1)) *
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

      {/* Budget Gauges */}
      {budgetStatuses.length > 0 && (
        <section className="cost-dashboard__budgets">
          <h2>Budget Status</h2>
          <div className="cost-dashboard__budget-grid">
            {budgetStatuses.slice(0, 4).map((budget) => (
              <BudgetGauge
                key={budget.budgetId}
                name={budget.budgetName}
                period="monthly"
                usedPercent={budget.usedPercent}
                formattedBudget={`$${(((budget.usedUnits / budget.usedPercent) * 100) / 100000).toFixed(2)}`}
                formattedUsed={budget.formattedUsed}
                formattedRemaining={budget.formattedRemaining}
                {...(budget.daysUntilExhausted !== undefined && {
                  daysUntilExhausted: budget.daysUntilExhausted,
                })}
                projectedExceed={budget.projectedExceed}
                burnRateFormatted={`$${(budget.burnRateUnitsPerDay / 100000).toFixed(2)}`}
              />
            ))}
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
              dimension="model"
              formattedTotalCost={breakdown.formattedTotalCost}
              title="Cost by Model"
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
