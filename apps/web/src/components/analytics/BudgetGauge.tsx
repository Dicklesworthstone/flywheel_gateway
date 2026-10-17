/**
 * BudgetGauge - Visual circular progress indicator for budget status.
 *
 * Shows budget usage as a percentage with color-coded status:
 * - Green: <50%
 * - Yellow: 50-80%
 * - Orange: 80-95%
 * - Red: >95%
 */

import { useMemo } from "react";
import "./BudgetGauge.css";

interface BudgetGaugeProps {
  /** Current usage as a percentage (0-100+) */
  usedPercent: number;
  /** Budget amount in formatted string */
  formattedBudget: string;
  /** Used amount in formatted string */
  formattedUsed: string;
  /** Remaining amount in formatted string */
  formattedRemaining: string;
  /** Budget name */
  name: string;
  /** Budget period */
  period: "daily" | "weekly" | "monthly" | "yearly";
  /** Days until budget is projected to be exhausted */
  daysUntilExhausted?: number;
  /** Whether budget is projected to exceed */
  projectedExceed?: boolean;
  /** Burn rate per day formatted */
  burnRateFormatted?: string;
}

export function BudgetGauge({
  usedPercent,
  formattedBudget,
  formattedUsed,
  formattedRemaining,
  name,
  period,
  daysUntilExhausted,
  projectedExceed,
  burnRateFormatted,
}: BudgetGaugeProps) {
  // Determine status color based on usage percentage
  const statusClass = useMemo(() => {
    if (usedPercent >= 95) return "budget-gauge--critical";
    if (usedPercent >= 80) return "budget-gauge--warning";
    if (usedPercent >= 50) return "budget-gauge--caution";
    return "budget-gauge--healthy";
  }, [usedPercent]);

  // Calculate SVG arc parameters
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const clampedPercent = Math.min(usedPercent, 100);
  const strokeDashoffset =
    circumference - (clampedPercent / 100) * circumference;

  const periodLabel = {
    daily: "Today",
    weekly: "This Week",
    monthly: "This Month",
    yearly: "This Year",
  }[period];

  return (
    <div className={`budget-gauge ${statusClass}`}>
      <div className="budget-gauge__header">
        <h4 className="budget-gauge__name">{name}</h4>
        <span className="budget-gauge__period">{periodLabel}</span>
      </div>

      <div className="budget-gauge__visual">
        <svg viewBox="0 0 100 100" className="budget-gauge__svg">
          <title>Budget gauge visualization</title>
          {/* Background circle */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="var(--border)"
            strokeWidth="8"
          />
          {/* Progress arc */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            className="budget-gauge__progress"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            transform="rotate(-90 50 50)"
          />
        </svg>
        <div className="budget-gauge__center">
          <span className="budget-gauge__percent">
            {Math.round(usedPercent)}%
          </span>
          <span className="budget-gauge__label">used</span>
        </div>
      </div>

      <div className="budget-gauge__details">
        <div className="budget-gauge__row">
          <span className="budget-gauge__key">Budget</span>
          <span className="budget-gauge__value">{formattedBudget}</span>
        </div>
        <div className="budget-gauge__row">
          <span className="budget-gauge__key">Used</span>
          <span className="budget-gauge__value budget-gauge__value--used">
            {formattedUsed}
          </span>
        </div>
        <div className="budget-gauge__row">
          <span className="budget-gauge__key">Remaining</span>
          <span className="budget-gauge__value budget-gauge__value--remaining">
            {formattedRemaining}
          </span>
        </div>
        {burnRateFormatted && (
          <div className="budget-gauge__row">
            <span className="budget-gauge__key">Burn rate</span>
            <span className="budget-gauge__value">{burnRateFormatted}/day</span>
          </div>
        )}
      </div>

      {projectedExceed && daysUntilExhausted !== undefined && (
        <div className="budget-gauge__alert">
          {daysUntilExhausted <= 0
            ? "Budget exhausted!"
            : `Projected to exceed in ${daysUntilExhausted} day${daysUntilExhausted === 1 ? "" : "s"}`}
        </div>
      )}
    </div>
  );
}
