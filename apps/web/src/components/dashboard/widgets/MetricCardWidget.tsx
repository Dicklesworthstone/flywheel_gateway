/**
 * MetricCardWidget - Single KPI display with trend indicator.
 *
 * Data shape expected:
 * {
 *   value: number | string,
 *   label?: string,
 *   unit?: string,
 *   trend?: { direction: 'up' | 'down' | 'stable', value: number, period: string },
 *   comparison?: { label: string, value: number | string },
 * }
 */

import type { Widget, WidgetData } from "@flywheel/shared";
import "./MetricCardWidget.css";

interface MetricData {
  value: number | string;
  label?: string;
  unit?: string;
  trend?: {
    direction: "up" | "down" | "stable";
    value: number;
    period: string;
  };
  comparison?: {
    label: string;
    value: number | string;
  };
}

interface MetricCardWidgetProps {
  widget: Widget;
  data: WidgetData;
}

export function MetricCardWidget({ widget, data }: MetricCardWidgetProps) {
  const metricData = data.data as MetricData | null;

  if (!metricData) {
    return (
      <div className="metric-card-widget metric-card-widget--empty">
        No data
      </div>
    );
  }

  const { value, label, unit, trend, comparison } = metricData;
  const normalizedTrend =
    typeof trend === "string"
      ? {
          direction: trend as "up" | "down" | "stable",
          value:
            typeof (metricData as { trendPercent?: number }).trendPercent ===
            "number"
              ? (metricData as { trendPercent: number }).trendPercent
              : 0,
          period: "vs previous",
        }
      : trend && typeof trend === "object"
        ? {
            direction: trend.direction ?? "stable",
            value: typeof trend.value === "number" ? trend.value : 0,
            period: trend.period ?? "",
          }
        : undefined;
  const thresholds = widget.config.thresholds;

  // Determine color based on thresholds
  let valueClass = "";
  if (thresholds && typeof value === "number") {
    if (thresholds.critical && value >= thresholds.critical) {
      valueClass = "metric-card-widget__value--critical";
    } else if (thresholds.warning && value >= thresholds.warning) {
      valueClass = "metric-card-widget__value--warning";
    }
  }

  // Format value
  const formattedValue =
    typeof value === "number"
      ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : value;

  return (
    <div className="metric-card-widget">
      {label && <div className="metric-card-widget__label">{label}</div>}

      <div className={`metric-card-widget__value ${valueClass}`}>
        {formattedValue}
        {unit && <span className="metric-card-widget__unit">{unit}</span>}
      </div>

      {normalizedTrend && (
        <div
          className={`metric-card-widget__trend metric-card-widget__trend--${normalizedTrend.direction}`}
        >
          <TrendIcon direction={normalizedTrend.direction} />
          <span>
            {normalizedTrend.direction !== "stable" && (
              <>
                {normalizedTrend.value > 0 ? "+" : ""}
                {normalizedTrend.value.toFixed(1)}%
              </>
            )}
            {normalizedTrend.direction === "stable" && "No change"}
          </span>
          <span className="metric-card-widget__trend-period">
            {normalizedTrend.period}
          </span>
        </div>
      )}

      {comparison && (
        <div className="metric-card-widget__comparison">
          <span className="metric-card-widget__comparison-label">
            {comparison.label}:
          </span>
          <span className="metric-card-widget__comparison-value">
            {typeof comparison.value === "number"
              ? comparison.value.toLocaleString()
              : comparison.value}
          </span>
        </div>
      )}
    </div>
  );
}

function TrendIcon({ direction }: { direction: "up" | "down" | "stable" }) {
  if (direction === "up") {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M7 17l5-5 5 5M7 7l5-5 5 5" />
      </svg>
    );
  }

  if (direction === "down") {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M7 7l5 5 5-5M7 17l5 5 5-5" />
      </svg>
    );
  }

  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>
  );
}
