/**
 * CostTrendChart - Line chart for historical cost trends.
 *
 * Shows cost over time with interactive tooltips and period selection.
 */

import { useMemo, useState } from "react";
import "./CostTrendChart.css";

interface TrendDataPoint {
  date: string;
  costUnits: number;
  formattedCost: string;
  requestCount: number;
}

interface CostTrendChartProps {
  /** Daily trend data points */
  data: TrendDataPoint[];
  /** Chart title */
  title?: string;
  /** Whether data is loading */
  isLoading?: boolean;
  /** Error message if any */
  error?: string;
}

type Period = "7d" | "14d" | "30d";

export function CostTrendChart({
  data,
  title = "Cost Trend",
  isLoading = false,
  error,
}: CostTrendChartProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<Period>("7d");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Filter data based on selected period
  const filteredData = useMemo(() => {
    const days =
      selectedPeriod === "7d" ? 7 : selectedPeriod === "14d" ? 14 : 30;
    return data.slice(-days);
  }, [data, selectedPeriod]);

  // Calculate chart dimensions and scaling
  const chartMetrics = useMemo(() => {
    if (filteredData.length === 0) {
      return { maxCost: 0, minCost: 0, totalCost: 0, avgCost: 0 };
    }

    const costs = filteredData.map((d) => d.costUnits);
    const maxCost = Math.max(...costs);
    const minCost = Math.min(...costs);
    const totalCost = costs.reduce((sum, c) => sum + c, 0);
    const avgCost = totalCost / costs.length;

    return { maxCost, minCost, totalCost, avgCost };
  }, [filteredData]);

  // Generate SVG path for the line chart
  const pathData = useMemo(() => {
    if (filteredData.length < 2 || chartMetrics.maxCost === 0) return "";

    const height = 150;
    const width = 100; // Percentage width
    const padding = 5;
    const effectiveHeight = height - padding * 2;

    const points = filteredData.map((d, i) => {
      const x = (i / (filteredData.length - 1)) * width;
      const y =
        padding + effectiveHeight * (1 - d.costUnits / chartMetrics.maxCost);
      return `${x},${y}`;
    });

    return `M ${points.join(" L ")}`;
  }, [filteredData, chartMetrics.maxCost]);

  // Generate area fill path
  const areaPath = useMemo(() => {
    if (!pathData) return "";
    return `${pathData} L 100,150 L 0,150 Z`;
  }, [pathData]);

  if (isLoading) {
    return (
      <div className="cost-trend-chart cost-trend-chart--loading">
        <div className="cost-trend-chart__header">
          <h3>{title}</h3>
        </div>
        <div className="cost-trend-chart__skeleton">
          <div className="skeleton-bar" style={{ height: "60%" }} />
          <div className="skeleton-bar" style={{ height: "80%" }} />
          <div className="skeleton-bar" style={{ height: "40%" }} />
          <div className="skeleton-bar" style={{ height: "70%" }} />
          <div className="skeleton-bar" style={{ height: "55%" }} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cost-trend-chart cost-trend-chart--error">
        <div className="cost-trend-chart__header">
          <h3>{title}</h3>
        </div>
        <p className="cost-trend-chart__error-message">{error}</p>
      </div>
    );
  }

  if (filteredData.length === 0) {
    return (
      <div className="cost-trend-chart cost-trend-chart--empty">
        <div className="cost-trend-chart__header">
          <h3>{title}</h3>
        </div>
        <p className="cost-trend-chart__empty-message">
          No cost data available
        </p>
      </div>
    );
  }

  return (
    <div className="cost-trend-chart">
      <div className="cost-trend-chart__header">
        <h3>{title}</h3>
        <div className="cost-trend-chart__periods">
          {(["7d", "14d", "30d"] as Period[]).map((period) => (
            <button
              key={period}
              type="button"
              className={`cost-trend-chart__period-btn ${
                selectedPeriod === period
                  ? "cost-trend-chart__period-btn--active"
                  : ""
              }`}
              onClick={() => setSelectedPeriod(period)}
            >
              {period}
            </button>
          ))}
        </div>
      </div>

      <div className="cost-trend-chart__chart">
        <svg viewBox="0 0 100 150" preserveAspectRatio="none">
          <title>Cost trend chart</title>
          {/* Gradient definition */}
          <defs>
            <linearGradient id="costGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Area fill */}
          <path d={areaPath} fill="url(#costGradient)" />
          {/* Line */}
          <path
            d={pathData}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          {/* Data points */}
          {filteredData.map((d, i) => {
            const x = (i / (filteredData.length - 1)) * 100;
            const y = 5 + 140 * (1 - d.costUnits / chartMetrics.maxCost);
            return (
              <circle
                key={d.date}
                cx={x}
                cy={y}
                r={hoveredIndex === i ? 4 : 2}
                fill="var(--accent)"
                className="cost-trend-chart__point"
                tabIndex={0}
                aria-label={`Data point for ${d.date}`}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                onFocus={() => setHoveredIndex(i)}
                onBlur={() => setHoveredIndex(null)}
              />
            );
          })}
        </svg>

        {/* Tooltip */}
        {hoveredIndex !== null && filteredData[hoveredIndex] && (
          <div
            className="cost-trend-chart__tooltip"
            style={{
              left: `${(hoveredIndex / (filteredData.length - 1)) * 100}%`,
            }}
          >
            <span className="cost-trend-chart__tooltip-date">
              {new Date(filteredData[hoveredIndex]!.date).toLocaleDateString()}
            </span>
            <span className="cost-trend-chart__tooltip-cost">
              {filteredData[hoveredIndex]!.formattedCost}
            </span>
            <span className="cost-trend-chart__tooltip-requests">
              {filteredData[hoveredIndex]!.requestCount} requests
            </span>
          </div>
        )}
      </div>

      {/* X-axis labels */}
      <div className="cost-trend-chart__x-axis">
        <span>
          {new Date(filteredData[0]!.date).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
        <span>
          {new Date(
            filteredData[filteredData.length - 1]!.date,
          ).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
      </div>
    </div>
  );
}
