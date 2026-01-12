/**
 * Confidence Scorer - Calculates confidence scores for resolution suggestions.
 *
 * The confidence score (0-100) indicates how certain the system is about a recommendation.
 * Higher scores allow for auto-resolution, while lower scores require human review.
 *
 * Score ranges:
 * - 90-100: Very high confidence - Auto-apply allowed
 * - 70-89: High confidence - Auto-apply with notification
 * - 50-69: Moderate confidence - Requires agent confirmation
 * - 30-49: Low confidence - Requires human review
 * - 0-29: Very low confidence - Escalate immediately
 */

import type {
  BvPriorityInfo,
  CassHistoryInfo,
  CheckpointProgressInfo,
  ConfidenceAdjustment,
  ConfidenceFactors,
  ResolutionStrategyType,
  ResourceIdentifier,
} from "@flywheel/shared/types";
import { getCorrelationId, getLogger } from "../middleware/correlation";

// ============================================================================
// Types
// ============================================================================

/**
 * Input data for confidence scoring.
 */
export interface ConfidenceScoringInput {
  /** Strategy being scored */
  strategy: ResolutionStrategyType;
  /** Priority info for requesting agent */
  requestingAgentPriority?: BvPriorityInfo;
  /** Priority info for holding agent */
  holdingAgentPriority?: BvPriorityInfo;
  /** Progress info for holding agent */
  holdingAgentProgress?: CheckpointProgressInfo;
  /** Historical resolution data */
  cassHistory?: CassHistoryInfo;
  /** Resources being contested */
  contestedResources: ResourceIdentifier[];
  /** Whether there's deadline pressure */
  hasDeadlinePressure: boolean;
  /** Strategy-specific score from strategy selector */
  strategySpecificScore: number;
}

/**
 * Result of confidence scoring.
 */
export interface ConfidenceScoringResult {
  /** Final confidence score (0-100) */
  score: number;
  /** Breakdown of contributing factors */
  breakdown: ConfidenceFactors;
  /** Interpretation of the score */
  interpretation: ConfidenceInterpretation;
}

/**
 * Human-readable interpretation of confidence score.
 */
export interface ConfidenceInterpretation {
  /** Level label */
  level: "very_high" | "high" | "moderate" | "low" | "very_low";
  /** Whether auto-resolution is allowed */
  autoResolutionAllowed: boolean;
  /** What action is recommended */
  recommendedAction: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum points for priority differential factor */
const MAX_PRIORITY_POINTS = 20;

/** Maximum points for progress certainty factor */
const MAX_PROGRESS_POINTS = 15;

/** Maximum points for historical match factor */
const MAX_HISTORY_POINTS = 25;

/** Maximum points for resource criticality factor */
const MAX_CRITICALITY_POINTS = 20;

/** Maximum points for time pressure factor */
const MAX_TIME_POINTS = 20;

/** Threshold scores for different confidence levels */
const CONFIDENCE_THRESHOLDS = {
  VERY_HIGH: 90,
  HIGH: 70,
  MODERATE: 50,
  LOW: 30,
};

/** Priority numeric values for comparison */
const PRIORITY_VALUES: Record<string, number> = {
  P0: 4,
  P1: 3,
  P2: 2,
  P3: 1,
  P4: 0,
};

// ============================================================================
// Main Scoring Function
// ============================================================================

/**
 * Calculate confidence score for a resolution strategy.
 */
export function calculateConfidence(
  input: ConfidenceScoringInput,
): ConfidenceScoringResult {
  const log = getLogger().child({
    service: "confidence-scorer",
    strategy: input.strategy,
    correlationId: getCorrelationId(),
  });

  const adjustments: ConfidenceAdjustment[] = [];

  // Calculate each factor
  const priorityDifferential = calculatePriorityDifferential(
    input.requestingAgentPriority,
    input.holdingAgentPriority,
    adjustments,
  );

  const progressCertainty = calculateProgressCertainty(
    input.holdingAgentProgress,
    adjustments,
  );

  const historicalMatch = calculateHistoricalMatch(
    input.strategy,
    input.cassHistory,
    adjustments,
  );

  const resourceCriticality = calculateResourceCriticality(
    input.contestedResources,
    adjustments,
  );

  const timePressure = calculateTimePressure(
    input.hasDeadlinePressure,
    input.requestingAgentPriority?.deadline,
    adjustments,
  );

  // Calculate base score from factors
  const baseScore =
    priorityDifferential +
    progressCertainty +
    historicalMatch +
    resourceCriticality +
    timePressure;

  // Apply adjustments
  const totalAdjustment = adjustments.reduce((sum, adj) => sum + adj.delta, 0);
  let finalScore = Math.max(0, Math.min(100, baseScore + totalAdjustment));

  // Apply strategy-specific modifier
  finalScore = applyStrategyModifier(
    finalScore,
    input.strategy,
    input.strategySpecificScore,
  );

  const breakdown: ConfidenceFactors = {
    priorityDifferential,
    progressCertainty,
    historicalMatch,
    resourceCriticality,
    timePressure,
    adjustments,
  };

  const interpretation = interpretScore(finalScore);

  log.debug(
    {
      finalScore,
      baseScore,
      totalAdjustment,
      breakdown: {
        priorityDifferential,
        progressCertainty,
        historicalMatch,
        resourceCriticality,
        timePressure,
      },
      adjustmentCount: adjustments.length,
    },
    "Confidence score calculated",
  );

  return {
    score: Math.round(finalScore),
    breakdown,
    interpretation,
  };
}

// ============================================================================
// Factor Calculators
// ============================================================================

/**
 * Calculate priority differential score.
 * Higher score when there's a clear priority difference.
 */
function calculatePriorityDifferential(
  requesting?: BvPriorityInfo,
  holding?: BvPriorityInfo,
  adjustments?: ConfidenceAdjustment[],
): number {
  if (!requesting && !holding) {
    adjustments?.push({
      reason: "no_priority_data",
      delta: -5,
    });
    return MAX_PRIORITY_POINTS / 2; // Neutral score
  }

  if (!requesting || !holding) {
    adjustments?.push({
      reason: "partial_priority_data",
      delta: -3,
    });
    return MAX_PRIORITY_POINTS * 0.6;
  }

  const requestingValue = PRIORITY_VALUES[requesting.priority] ?? 2;
  const holdingValue = PRIORITY_VALUES[holding.priority] ?? 2;
  const diff = Math.abs(requestingValue - holdingValue);

  // Clear priority differential = high confidence
  // Same priority = lower confidence (harder to decide)
  if (diff >= 2) {
    return MAX_PRIORITY_POINTS; // Clear winner
  }
  if (diff === 1) {
    return MAX_PRIORITY_POINTS * 0.75; // Slight difference
  }

  // Same priority - check urgency scores if available
  if (requesting.urgency !== undefined && holding.urgency !== undefined) {
    const urgencyDiff = Math.abs(requesting.urgency - holding.urgency);
    if (urgencyDiff > 0.5) {
      return MAX_PRIORITY_POINTS * 0.65;
    }
  }

  adjustments?.push({
    reason: "equal_priority_ambiguity",
    delta: -5,
  });

  return MAX_PRIORITY_POINTS * 0.4; // Hard to decide
}

/**
 * Calculate progress certainty score.
 * Higher score when we have clear progress data.
 */
function calculateProgressCertainty(
  progress?: CheckpointProgressInfo,
  adjustments?: ConfidenceAdjustment[],
): number {
  if (!progress) {
    adjustments?.push({
      reason: "no_progress_data",
      delta: -3,
    });
    return MAX_PROGRESS_POINTS * 0.5;
  }

  // More complete = more confidence
  const progressScore = progress.progressPercentage / 100;

  // Recent checkpoint = more confidence in data freshness
  let freshnessBonus = 0;
  if (progress.lastCheckpointAt) {
    const ageMs = Date.now() - progress.lastCheckpointAt.getTime();
    if (ageMs < 60000) {
      // Less than 1 minute old
      freshnessBonus = 2;
    } else if (ageMs < 300000) {
      // Less than 5 minutes old
      freshnessBonus = 1;
    }
  }

  // High progress (>80%) or low progress (<20%) = clearer decision
  let clarityScore: number;
  if (progressScore >= 0.8) {
    clarityScore = MAX_PROGRESS_POINTS - 2 + freshnessBonus;
  } else if (progressScore <= 0.2) {
    clarityScore = MAX_PROGRESS_POINTS - 3 + freshnessBonus;
  } else {
    // Middle range is harder to decide
    clarityScore = MAX_PROGRESS_POINTS * 0.6 + freshnessBonus;
  }

  // Having estimated remaining time increases confidence
  if (progress.estimatedRemainingMs !== undefined) {
    adjustments?.push({
      reason: "has_time_estimate",
      delta: 2,
    });
  }

  return Math.min(MAX_PROGRESS_POINTS, clarityScore);
}

/**
 * Calculate historical pattern match score.
 * Higher score when we have relevant historical data showing success.
 */
function calculateHistoricalMatch(
  strategy: ResolutionStrategyType,
  history?: CassHistoryInfo,
  adjustments?: ConfidenceAdjustment[],
): number {
  if (!history || history.similarConflictCount === 0) {
    adjustments?.push({
      reason: "no_historical_data",
      delta: -5,
    });
    return MAX_HISTORY_POINTS * 0.4;
  }

  // Find success rate for this strategy
  const strategyOutcome = history.strategyOutcomes.find(
    (o) => o.strategy === strategy,
  );

  if (!strategyOutcome) {
    adjustments?.push({
      reason: "no_strategy_history",
      delta: -3,
    });
    return MAX_HISTORY_POINTS * 0.5;
  }

  const totalAttempts =
    strategyOutcome.successCount + strategyOutcome.failureCount;
  if (totalAttempts === 0) {
    return MAX_HISTORY_POINTS * 0.5;
  }

  const successRate = strategyOutcome.successCount / totalAttempts;

  // Scale by relevance score
  const relevanceMultiplier = (history.relevanceScore ?? 50) / 100;

  // More historical data = more confidence in the rate
  const sampleSizeMultiplier = Math.min(1, totalAttempts / 10);

  const score =
    MAX_HISTORY_POINTS *
    successRate *
    relevanceMultiplier *
    sampleSizeMultiplier;

  // Bonus for high success rate with good sample size
  if (successRate >= 0.9 && totalAttempts >= 10) {
    adjustments?.push({
      reason: "strong_historical_success",
      delta: 5,
    });
  } else if (successRate < 0.5 && totalAttempts >= 5) {
    adjustments?.push({
      reason: "poor_historical_success",
      delta: -5,
    });
  }

  return Math.min(MAX_HISTORY_POINTS, score);
}

/**
 * Calculate resource criticality score.
 * Higher score when resources are low-risk (easier to resolve).
 */
function calculateResourceCriticality(
  resources: ResourceIdentifier[],
  adjustments?: ConfidenceAdjustment[],
): number {
  if (resources.length === 0) {
    return MAX_CRITICALITY_POINTS; // No resources = no risk
  }

  const criticalCount = resources.filter((r) => r.critical).length;
  const protectedCount = resources.filter((r) => r.protected).length;

  if (criticalCount > 0) {
    adjustments?.push({
      reason: "critical_resources_involved",
      delta: -10,
    });
    return MAX_CRITICALITY_POINTS * 0.3;
  }

  if (protectedCount > 0) {
    adjustments?.push({
      reason: "protected_resources_involved",
      delta: -5,
    });
    return MAX_CRITICALITY_POINTS * 0.5;
  }

  // More resources = slightly more risk
  const resourcePenalty = Math.min(5, resources.length - 1);

  return MAX_CRITICALITY_POINTS - resourcePenalty;
}

/**
 * Calculate time pressure score.
 * Higher score when there's clear time pressure (easier decision).
 */
function calculateTimePressure(
  hasDeadlinePressure: boolean,
  deadline?: Date,
  adjustments?: ConfidenceAdjustment[],
): number {
  if (!hasDeadlinePressure) {
    // No time pressure = neutral confidence
    return MAX_TIME_POINTS * 0.6;
  }

  if (!deadline) {
    // Has pressure but no specific deadline
    return MAX_TIME_POINTS * 0.7;
  }

  const msUntilDeadline = deadline.getTime() - Date.now();

  // Very close deadline = clear need to act
  if (msUntilDeadline < 3600000) {
    // Less than 1 hour
    adjustments?.push({
      reason: "imminent_deadline",
      delta: 5,
    });
    return MAX_TIME_POINTS;
  }
  if (msUntilDeadline < 86400000) {
    // Less than 24 hours
    return MAX_TIME_POINTS * 0.85;
  }
  if (msUntilDeadline < 604800000) {
    // Less than 1 week
    return MAX_TIME_POINTS * 0.7;
  }

  // Far deadline = less urgency
  return MAX_TIME_POINTS * 0.5;
}

// ============================================================================
// Strategy Modifier
// ============================================================================

/**
 * Apply strategy-specific confidence modifier.
 * Some strategies inherently have higher/lower confidence.
 */
function applyStrategyModifier(
  score: number,
  strategy: ResolutionStrategyType,
  strategySpecificScore: number,
): number {
  // Weight the strategy-specific score
  const strategyWeight = 0.3;
  const baseWeight = 0.7;

  let modifiedScore =
    score * baseWeight + strategySpecificScore * strategyWeight;

  // Strategy-specific adjustments
  switch (strategy) {
    case "wait":
      // Wait is generally safe, slight confidence boost
      modifiedScore *= 1.05;
      break;
    case "escalate":
      // Escalate means we're uncertain, reduce confidence representation
      modifiedScore *= 0.9;
      break;
    case "transfer":
      // Transfer requires holder cooperation, slight penalty
      modifiedScore *= 0.95;
      break;
    case "split":
      // Split requires both agents to support it
      modifiedScore *= 0.92;
      break;
    case "coordinate":
      // Coordinate is complex, slight penalty
      modifiedScore *= 0.9;
      break;
  }

  return Math.max(0, Math.min(100, modifiedScore));
}

// ============================================================================
// Score Interpretation
// ============================================================================

/**
 * Interpret a confidence score into actionable guidance.
 */
function interpretScore(score: number): ConfidenceInterpretation {
  if (score >= CONFIDENCE_THRESHOLDS.VERY_HIGH) {
    return {
      level: "very_high",
      autoResolutionAllowed: true,
      recommendedAction: "Auto-apply resolution",
    };
  }
  if (score >= CONFIDENCE_THRESHOLDS.HIGH) {
    return {
      level: "high",
      autoResolutionAllowed: true,
      recommendedAction: "Auto-apply with notification",
    };
  }
  if (score >= CONFIDENCE_THRESHOLDS.MODERATE) {
    return {
      level: "moderate",
      autoResolutionAllowed: false,
      recommendedAction: "Request agent confirmation",
    };
  }
  if (score >= CONFIDENCE_THRESHOLDS.LOW) {
    return {
      level: "low",
      autoResolutionAllowed: false,
      recommendedAction: "Request human review",
    };
  }
  return {
    level: "very_low",
    autoResolutionAllowed: false,
    recommendedAction: "Escalate immediately",
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a score meets the threshold for auto-resolution.
 */
export function meetsAutoResolutionThreshold(score: number): boolean {
  return score >= CONFIDENCE_THRESHOLDS.HIGH;
}

/**
 * Get the confidence level label for a score.
 */
export function getConfidenceLevel(
  score: number,
): "very_high" | "high" | "moderate" | "low" | "very_low" {
  return interpretScore(score).level;
}

/**
 * Calculate a quick confidence estimate without full analysis.
 * Used for initial strategy filtering.
 */
export function quickConfidenceEstimate(
  strategy: ResolutionStrategyType,
  hasHistoricalData: boolean,
  hasPriorityData: boolean,
  hasProgressData: boolean,
): number {
  let estimate = 50; // Base estimate

  // Data availability bonuses
  if (hasHistoricalData) estimate += 15;
  if (hasPriorityData) estimate += 10;
  if (hasProgressData) estimate += 10;

  // Strategy adjustments
  switch (strategy) {
    case "wait":
      estimate += 5;
      break;
    case "escalate":
      estimate -= 10;
      break;
    case "transfer":
      estimate -= 5;
      break;
    case "split":
      estimate -= 8;
      break;
    case "coordinate":
      estimate -= 10;
      break;
  }

  return Math.max(0, Math.min(100, estimate));
}
