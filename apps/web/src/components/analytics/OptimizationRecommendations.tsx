/**
 * OptimizationRecommendations - Card list for AI-powered cost optimization recommendations.
 *
 * Shows actionable recommendations with estimated savings and implementation guidance.
 */

import { useState } from "react";
import "./OptimizationRecommendations.css";

type RecommendationCategory =
  | "model_optimization"
  | "caching"
  | "batching"
  | "context_optimization"
  | "consolidation"
  | "scheduling"
  | "rate_limiting";

type RecommendationStatus =
  | "pending"
  | "in_progress"
  | "implemented"
  | "rejected"
  | "failed";

type RiskLevel = "low" | "medium" | "high";

interface Recommendation {
  id: string;
  category: RecommendationCategory;
  title: string;
  description: string;
  estimatedSavingsUnits: number;
  formattedSavings: string;
  savingsPercent: number;
  confidence: number;
  risk: RiskLevel;
  status: RecommendationStatus;
  priority: number;
  implementation?: string;
}

interface OptimizationRecommendationsProps {
  /** List of recommendations */
  recommendations: Recommendation[];
  /** Total potential savings formatted */
  formattedPotentialSavings: string;
  /** Implemented savings formatted */
  formattedImplementedSavings: string;
  /** Callback when status is updated */
  onStatusUpdate?: (id: string, status: RecommendationStatus) => void;
  /** Whether data is loading */
  isLoading?: boolean;
  /** Maximum recommendations to show initially */
  maxInitial?: number;
}

const categoryLabels: Record<RecommendationCategory, string> = {
  model_optimization: "Model Optimization",
  caching: "Caching",
  batching: "Batching",
  context_optimization: "Context Optimization",
  consolidation: "Consolidation",
  scheduling: "Scheduling",
  rate_limiting: "Rate Limiting",
};

const categoryIcons: Record<RecommendationCategory, string> = {
  model_optimization: "\u2699\uFE0F",
  caching: "\uD83D\uDCBE",
  batching: "\uD83D\uDCE6",
  context_optimization: "\uD83D\uDCDD",
  consolidation: "\uD83D\uDD17",
  scheduling: "\u23F0",
  rate_limiting: "\u26A1",
};

const statusLabels: Record<RecommendationStatus, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  implemented: "Implemented",
  rejected: "Rejected",
  failed: "Failed",
};

export function OptimizationRecommendations({
  recommendations,
  formattedPotentialSavings,
  formattedImplementedSavings,
  onStatusUpdate,
  isLoading = false,
  maxInitial = 5,
}: OptimizationRecommendationsProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Filter and sort recommendations
  const sortedRecs = [...recommendations].sort((a, b) => {
    // Pending first, then by priority, then by savings
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (a.status !== "pending" && b.status === "pending") return 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.estimatedSavingsUnits - a.estimatedSavingsUnits;
  });

  const displayRecs = showAll ? sortedRecs : sortedRecs.slice(0, maxInitial);

  const getRiskClass = (risk: RiskLevel) => {
    return `optimization-rec__risk--${risk}`;
  };

  const getStatusClass = (status: RecommendationStatus) => {
    return `optimization-rec__status--${status}`;
  };

  if (isLoading) {
    return (
      <div className="optimization-recs optimization-recs--loading">
        <div className="optimization-recs__header">
          <h3>Optimization Recommendations</h3>
        </div>
        <div className="optimization-recs__skeleton">
          {[1, 2, 3].map((i) => (
            <div key={i} className="optimization-recs__skeleton-card" />
          ))}
        </div>
      </div>
    );
  }

  if (recommendations.length === 0) {
    return (
      <div className="optimization-recs optimization-recs--empty">
        <div className="optimization-recs__header">
          <h3>Optimization Recommendations</h3>
        </div>
        <div className="optimization-recs__empty-message">
          <p>No optimization opportunities detected.</p>
          <p className="muted">
            Recommendations are generated based on usage patterns. Check back
            after more activity.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="optimization-recs">
      <div className="optimization-recs__header">
        <div>
          <h3>Optimization Recommendations</h3>
          <div className="optimization-recs__summary">
            <span className="optimization-recs__potential">
              Potential: <strong>{formattedPotentialSavings}</strong>
            </span>
            <span className="optimization-recs__implemented">
              Saved: <strong>{formattedImplementedSavings}</strong>
            </span>
          </div>
        </div>
        <span className="optimization-recs__count">
          {recommendations.filter((r) => r.status === "pending").length} pending
        </span>
      </div>

      <div className="optimization-recs__list">
        {displayRecs.map((rec) => (
          <div
            key={rec.id}
            className={`optimization-rec ${expandedId === rec.id ? "optimization-rec--expanded" : ""}`}
          >
            <button
              type="button"
              className="optimization-rec__header"
              onClick={() =>
                setExpandedId(expandedId === rec.id ? null : rec.id)
              }
            >
              <div className="optimization-rec__icon">
                {categoryIcons[rec.category]}
              </div>
              <div className="optimization-rec__main">
                <div className="optimization-rec__title-row">
                  <span className="optimization-rec__title">{rec.title}</span>
                  <span
                    className={`optimization-rec__status ${getStatusClass(rec.status)}`}
                  >
                    {statusLabels[rec.status]}
                  </span>
                </div>
                <div className="optimization-rec__meta-row">
                  <span className="optimization-rec__category">
                    {categoryLabels[rec.category]}
                  </span>
                  <span
                    className={`optimization-rec__risk ${getRiskClass(rec.risk)}`}
                  >
                    {rec.risk} risk
                  </span>
                  <span className="optimization-rec__confidence">
                    {Math.round(rec.confidence * 100)}% confidence
                  </span>
                </div>
              </div>
              <div className="optimization-rec__savings">
                <span className="optimization-rec__savings-amount">
                  {rec.formattedSavings}
                </span>
                <span className="optimization-rec__savings-percent">
                  -{rec.savingsPercent.toFixed(1)}%
                </span>
              </div>
              <span className="optimization-rec__expand-icon">
                {expandedId === rec.id ? "\u25B2" : "\u25BC"}
              </span>
            </button>

            {expandedId === rec.id && (
              <div className="optimization-rec__details">
                <p className="optimization-rec__description">
                  {rec.description}
                </p>
                {rec.implementation && (
                  <div className="optimization-rec__implementation">
                    <strong>Implementation:</strong>
                    <p>{rec.implementation}</p>
                  </div>
                )}
                {rec.status === "pending" && onStatusUpdate && (
                  <div className="optimization-rec__actions">
                    <button
                      type="button"
                      className="optimization-rec__action optimization-rec__action--primary"
                      onClick={() => onStatusUpdate(rec.id, "in_progress")}
                    >
                      Start Implementation
                    </button>
                    <button
                      type="button"
                      className="optimization-rec__action optimization-rec__action--secondary"
                      onClick={() => onStatusUpdate(rec.id, "rejected")}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {sortedRecs.length > maxInitial && (
        <button
          type="button"
          className="optimization-recs__show-more"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll
            ? "Show less"
            : `Show ${sortedRecs.length - maxInitial} more recommendations`}
        </button>
      )}
    </div>
  );
}
