/**
 * CostBreakdownChart - Horizontal bar chart for cost breakdown by dimension.
 *
 * Shows cost distribution by model, agent, project, or provider.
 */

import { useMemo, useState } from "react";
import "./CostBreakdownChart.css";

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

interface CostBreakdownChartProps {
  /** Breakdown items to display */
  items: BreakdownItem[];
  /** Dimension being displayed */
  dimension: "model" | "agent" | "project" | "provider";
  /** Total cost formatted string */
  formattedTotalCost: string;
  /** Chart title */
  title?: string;
  /** Whether data is loading */
  isLoading?: boolean;
  /** Max items to show before collapsing */
  maxItems?: number;
}

type Dimension = "model" | "agent" | "project" | "provider";

export function CostBreakdownChart({
  items,
  dimension,
  formattedTotalCost,
  title = "Cost Breakdown",
  isLoading = false,
  maxItems = 5,
}: CostBreakdownChartProps) {
  const [selectedDimension, setSelectedDimension] =
    useState<Dimension>(dimension);
  const [showAll, setShowAll] = useState(false);

  // Display items (limited or all)
  const displayItems = useMemo(() => {
    if (showAll || items.length <= maxItems) return items;
    return items.slice(0, maxItems);
  }, [items, showAll, maxItems]);

  // Color palette for bars
  const barColors = [
    "var(--accent)",
    "var(--positive)",
    "var(--warning)",
    "#6366f1",
    "#ec4899",
    "#8b5cf6",
    "#14b8a6",
    "#f97316",
  ];

  const getTrendIcon = (trend?: "up" | "down" | "stable") => {
    if (trend === "up") return "\u2191";
    if (trend === "down") return "\u2193";
    return "\u2192";
  };

  const getTrendClass = (trend?: "up" | "down" | "stable") => {
    if (trend === "up") return "cost-breakdown__trend--up";
    if (trend === "down") return "cost-breakdown__trend--down";
    return "cost-breakdown__trend--stable";
  };

  if (isLoading) {
    return (
      <div className="cost-breakdown cost-breakdown--loading">
        <div className="cost-breakdown__header">
          <h3>{title}</h3>
        </div>
        <div className="cost-breakdown__skeleton">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="cost-breakdown__skeleton-row">
              <div className="skeleton-text skeleton-text--label" />
              <div
                className="skeleton-bar"
                style={{ width: `${100 - i * 15}%` }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="cost-breakdown cost-breakdown--empty">
        <div className="cost-breakdown__header">
          <h3>{title}</h3>
        </div>
        <p className="cost-breakdown__empty-message">
          No breakdown data available
        </p>
      </div>
    );
  }

  return (
    <div className="cost-breakdown">
      <div className="cost-breakdown__header">
        <div>
          <h3>{title}</h3>
          <span className="cost-breakdown__total">
            Total: {formattedTotalCost}
          </span>
        </div>
        <div className="cost-breakdown__dimensions">
          {(["model", "agent", "project", "provider"] as Dimension[]).map(
            (dim) => (
              <button
                key={dim}
                type="button"
                className={`cost-breakdown__dim-btn ${
                  selectedDimension === dim
                    ? "cost-breakdown__dim-btn--active"
                    : ""
                }`}
                onClick={() => setSelectedDimension(dim)}
              >
                {dim.charAt(0).toUpperCase() + dim.slice(1)}
              </button>
            ),
          )}
        </div>
      </div>

      <div className="cost-breakdown__list">
        {displayItems.map((item, index) => (
          <div key={item.key} className="cost-breakdown__item">
            <div className="cost-breakdown__item-header">
              <span className="cost-breakdown__label">{item.label}</span>
              <div className="cost-breakdown__values">
                <span className="cost-breakdown__cost">
                  {item.formattedCost}
                </span>
                {item.trend && item.trendPercent !== undefined && (
                  <span
                    className={`cost-breakdown__trend ${getTrendClass(item.trend)}`}
                  >
                    {getTrendIcon(item.trend)}{" "}
                    {Math.abs(item.trendPercent).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
            <div className="cost-breakdown__bar-container">
              <div
                className="cost-breakdown__bar"
                style={{
                  width: `${item.percentageOfTotal}%`,
                  backgroundColor: barColors[index % barColors.length],
                }}
              />
            </div>
            <div className="cost-breakdown__item-footer">
              <span className="cost-breakdown__percent">
                {item.percentageOfTotal.toFixed(1)}%
              </span>
              <span className="cost-breakdown__requests">
                {item.requestCount.toLocaleString()} requests
              </span>
            </div>
          </div>
        ))}
      </div>

      {items.length > maxItems && (
        <button
          type="button"
          className="cost-breakdown__show-more"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? "Show less" : `Show ${items.length - maxItems} more`}
        </button>
      )}
    </div>
  );
}
