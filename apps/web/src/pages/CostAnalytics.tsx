/**
 * CostAnalytics Page - Cost tracking and optimization dashboard.
 *
 * Provides comprehensive visibility into AI usage costs with:
 * - Real-time cost tracking
 * - Budget management
 * - 30-day forecasting
 * - AI-powered optimization recommendations
 */

import { CostDashboard } from "../components/analytics";

export function CostAnalyticsPage() {
  return (
    <div className="page">
      <header className="page__header">
        <h1>Cost Analytics</h1>
        <p className="muted">
          Track usage, manage budgets, and optimize AI costs.
        </p>
      </header>

      <CostDashboard />
    </div>
  );
}
