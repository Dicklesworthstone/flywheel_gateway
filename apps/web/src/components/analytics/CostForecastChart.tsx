/**
 * CostForecastChart - Line chart for 30-day cost forecasts with confidence intervals.
 *
 * Shows predicted costs with upper/lower bounds and trend indicators.
 */

import { useMemo, useState } from "react";
import "./CostForecastChart.css";

interface DailyForecast {
  date: string;
  predictedCostUnits: number;
  formattedPredicted: string;
  lowerBoundUnits: number;
  upperBoundUnits: number;
  confidence: number;
}

interface CostForecastChartProps {
  /** Daily forecast data */
  dailyForecasts: DailyForecast[];
  /** Total forecast formatted */
  formattedForecast: string;
  /** Total forecast units */
  totalForecastUnits: number;
  /** 95% confidence interval */
  confidence95: { lower: number; upper: number };
  /** Trend direction */
  trendDirection: "up" | "down" | "stable";
  /** Trend strength (0-1) */
  trendStrength: number;
  /** Methodology used */
  methodology: string;
  /** Whether seasonality was detected */
  seasonalityDetected?: boolean;
  /** Accuracy metrics */
  accuracyMetrics?: { mape?: number; rmse?: number };
  /** Whether data is loading */
  isLoading?: boolean;
  /** Error message */
  error?: string;
}

export function CostForecastChart({
  dailyForecasts,
  formattedForecast,
  totalForecastUnits: _totalForecastUnits,
  confidence95: _confidence95,
  trendDirection,
  trendStrength,
  methodology,
  seasonalityDetected,
  accuracyMetrics,
  isLoading = false,
  error,
}: CostForecastChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Calculate chart dimensions and scaling
  const chartMetrics = useMemo(() => {
    if (dailyForecasts.length === 0) {
      return { maxValue: 0, minValue: 0 };
    }

    const allValues = dailyForecasts.flatMap((d) => [
      d.upperBoundUnits,
      d.lowerBoundUnits,
      d.predictedCostUnits,
    ]);
    const maxValue = Math.max(...allValues);
    const minValue = Math.min(...allValues);

    return { maxValue, minValue };
  }, [dailyForecasts]);

  // Generate SVG paths
  const paths = useMemo(() => {
    if (dailyForecasts.length < 2 || chartMetrics.maxValue === 0) {
      return { predicted: "", confidence: "" };
    }

    const height = 150;
    const width = 100;
    const padding = 5;
    const effectiveHeight = height - padding * 2;
    const valueRange = chartMetrics.maxValue - chartMetrics.minValue || 1;

    const getY = (value: number) =>
      padding +
      effectiveHeight * (1 - (value - chartMetrics.minValue) / valueRange);

    // Predicted line path
    const predictedPoints = dailyForecasts.map((d, i) => {
      const x = (i / (dailyForecasts.length - 1)) * width;
      const y = getY(d.predictedCostUnits);
      return `${x},${y}`;
    });
    const predicted = `M ${predictedPoints.join(" L ")}`;

    // Confidence interval area
    const upperPoints = dailyForecasts.map((d, i) => {
      const x = (i / (dailyForecasts.length - 1)) * width;
      const y = getY(d.upperBoundUnits);
      return `${x},${y}`;
    });
    const lowerPoints = dailyForecasts
      .map((d, i) => {
        const x = (i / (dailyForecasts.length - 1)) * width;
        const y = getY(d.lowerBoundUnits);
        return `${x},${y}`;
      })
      .reverse();
    const confidence = `M ${upperPoints.join(" L ")} L ${lowerPoints.join(" L ")} Z`;

    return { predicted, confidence };
  }, [dailyForecasts, chartMetrics]);

  const getTrendIcon = () => {
    if (trendDirection === "up") return "\u2191";
    if (trendDirection === "down") return "\u2193";
    return "\u2192";
  };

  const getTrendLabel = () => {
    const strength =
      trendStrength > 0.7
        ? "Strong"
        : trendStrength > 0.3
          ? "Moderate"
          : "Slight";
    return `${strength} ${trendDirection} trend`;
  };

  if (isLoading) {
    return (
      <div className="cost-forecast cost-forecast--loading">
        <div className="cost-forecast__header">
          <h3>30-Day Forecast</h3>
        </div>
        <div className="cost-forecast__skeleton">
          <div className="skeleton-chart" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cost-forecast cost-forecast--error">
        <div className="cost-forecast__header">
          <h3>30-Day Forecast</h3>
        </div>
        <p className="cost-forecast__error-message">{error}</p>
      </div>
    );
  }

  if (dailyForecasts.length === 0) {
    return (
      <div className="cost-forecast cost-forecast--empty">
        <div className="cost-forecast__header">
          <h3>30-Day Forecast</h3>
        </div>
        <p className="cost-forecast__empty-message">
          Not enough historical data to generate forecast. Need at least 7 days.
        </p>
      </div>
    );
  }

  return (
    <div className="cost-forecast">
      <div className="cost-forecast__header">
        <div>
          <h3>30-Day Forecast</h3>
          <div className="cost-forecast__summary">
            <span className="cost-forecast__total">{formattedForecast}</span>
            <span
              className={`cost-forecast__trend cost-forecast__trend--${trendDirection}`}
            >
              {getTrendIcon()} {getTrendLabel()}
            </span>
          </div>
        </div>
        <div className="cost-forecast__meta">
          <span className="cost-forecast__methodology">{methodology}</span>
          {seasonalityDetected && (
            <span className="cost-forecast__seasonality">
              Seasonality detected
            </span>
          )}
        </div>
      </div>

      <div className="cost-forecast__chart">
        <svg viewBox="0 0 100 150" preserveAspectRatio="none">
          <title>Cost forecast chart</title>
          {/* Confidence interval area */}
          <path
            d={paths.confidence}
            className="cost-forecast__confidence-area"
          />
          {/* Predicted line */}
          <path
            d={paths.predicted}
            fill="none"
            className="cost-forecast__predicted-line"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          {/* Data points */}
          {dailyForecasts.map((d, i) => {
            const denominator = dailyForecasts.length > 1 ? dailyForecasts.length - 1 : 1;
            const x = (i / denominator) * 100;
            const valueRange =
              chartMetrics.maxValue - chartMetrics.minValue || 1;
            const y =
              5 +
              140 *
                (1 -
                  (d.predictedCostUnits - chartMetrics.minValue) / valueRange);
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: SVG circle with focus handlers is valid for chart accessibility
              <circle
                key={d.date}
                cx={x}
                cy={y}
                r={hoveredIndex === i ? 4 : 2}
                className="cost-forecast__point"
                tabIndex={0}
                aria-label={`Forecast point for ${d.date}`}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                onFocus={() => setHoveredIndex(i)}
                onBlur={() => setHoveredIndex(null)}
              />
            );
          })}
        </svg>

        {/* Tooltip */}
        {hoveredIndex !== null && dailyForecasts[hoveredIndex] && (
          <div
            className="cost-forecast__tooltip"
            style={{
              left: `${(hoveredIndex / (dailyForecasts.length > 1 ? dailyForecasts.length - 1 : 1)) * 100}%`,
            }}
          >
            <span className="cost-forecast__tooltip-date">
              {new Date(
                dailyForecasts[hoveredIndex]?.date,
              ).toLocaleDateString()}
            </span>
            <span className="cost-forecast__tooltip-predicted">
              {dailyForecasts[hoveredIndex]?.formattedPredicted}
            </span>
            <span className="cost-forecast__tooltip-confidence">
              {dailyForecasts[hoveredIndex]?.confidence.toFixed(0)}% confidence
            </span>
          </div>
        )}
      </div>

      {/* Legend and metrics */}
      <div className="cost-forecast__footer">
        <div className="cost-forecast__legend">
          <div className="cost-forecast__legend-item">
            <span className="cost-forecast__legend-line cost-forecast__legend-line--predicted" />
            <span>Predicted</span>
          </div>
          <div className="cost-forecast__legend-item">
            <span className="cost-forecast__legend-area" />
            <span>95% Confidence</span>
          </div>
        </div>
        {accuracyMetrics?.mape !== undefined && (
          <div className="cost-forecast__accuracy">
            MAPE: {accuracyMetrics.mape.toFixed(1)}%
          </div>
        )}
      </div>
    </div>
  );
}
