/**
 * Rationale Generator - Generates human-readable explanations for resolution suggestions.
 *
 * Produces clear, actionable explanations that help agents and humans understand:
 * - Why a particular strategy was recommended
 * - What evidence supports the recommendation
 * - What risks exist and how they're mitigated
 * - What the expected outcome is
 */

import type {
  BvPriorityInfo,
  CheckpointProgressInfo,
  ConfidenceFactors,
  ResolutionStrategy,
  ResolutionStrategyType,
  ResourceIdentifier,
  RiskAssessment,
} from "@flywheel/shared/types";
import { getCorrelationId, getLogger } from "../middleware/correlation";

// ============================================================================
// Types
// ============================================================================

/**
 * Input for generating a rationale.
 */
export interface RationaleInput {
  /** Strategy being explained */
  strategy: ResolutionStrategy;
  /** Confidence score and breakdown */
  confidence: number;
  confidenceBreakdown: ConfidenceFactors;
  /** Agent information */
  requestingAgentId: string;
  holdingAgentId?: string;
  /** Priority information */
  requestingPriority?: BvPriorityInfo;
  holdingPriority?: BvPriorityInfo;
  /** Progress information */
  holdingProgress?: CheckpointProgressInfo;
  /** Resources involved */
  contestedResources: ResourceIdentifier[];
  /** Historical success rate */
  historicalSuccessRate?: number;
  historicalSampleSize?: number;
  /** Risks identified */
  risks: RiskAssessment[];
  /** Whether auto-resolution is eligible */
  autoResolutionEligible: boolean;
}

/**
 * Generated rationale structure.
 */
export interface GeneratedRationale {
  /** Main summary line */
  summary: string;
  /** Detailed explanation paragraphs */
  details: string[];
  /** Key supporting evidence */
  evidence: string[];
  /** Risk summary */
  riskSummary: string;
  /** Full formatted text */
  fullText: string;
}

// ============================================================================
// Main Generator Function
// ============================================================================

/**
 * Generate a human-readable rationale for a resolution suggestion.
 */
export function generateRationale(input: RationaleInput): GeneratedRationale {
  const log = getLogger().child({
    service: "rationale-generator",
    strategy: input.strategy.type,
    correlationId: getCorrelationId(),
  });

  const summary = generateSummary(input);
  const details = generateDetails(input);
  const evidence = generateEvidence(input);
  const riskSummary = generateRiskSummary(input.risks);
  const fullText = formatFullRationale(summary, details, evidence, riskSummary);

  log.debug(
    {
      summaryLength: summary.length,
      detailsCount: details.length,
      evidenceCount: evidence.length,
    },
    "Rationale generated",
  );

  return {
    summary,
    details,
    evidence,
    riskSummary,
    fullText,
  };
}

// ============================================================================
// Summary Generation
// ============================================================================

/**
 * Generate the main summary line.
 */
function generateSummary(input: RationaleInput): string {
  const strategyLabel = getStrategyLabel(input.strategy.type);
  const confidence = input.confidence;

  return `Recommending ${strategyLabel} strategy (confidence: ${confidence}/100)`;
}

/**
 * Get human-readable label for a strategy type.
 */
function getStrategyLabel(type: ResolutionStrategyType): string {
  switch (type) {
    case "wait":
      return "WAIT";
    case "split":
      return "SPLIT";
    case "transfer":
      return "TRANSFER";
    case "coordinate":
      return "COORDINATE";
    case "escalate":
      return "ESCALATE";
  }
}

// ============================================================================
// Detail Generation
// ============================================================================

/**
 * Generate detailed explanation paragraphs.
 */
function generateDetails(input: RationaleInput): string[] {
  const details: string[] = [];

  // Strategy-specific opening
  details.push(getStrategyOpeningDetail(input));

  // Priority comparison
  if (input.requestingPriority || input.holdingPriority) {
    details.push(getPriorityDetail(input));
  }

  // Progress information
  if (input.holdingProgress) {
    details.push(getProgressDetail(input));
  }

  // Historical context
  if (
    input.historicalSuccessRate !== undefined &&
    input.historicalSampleSize !== undefined
  ) {
    details.push(getHistoricalDetail(input));
  }

  // Auto-resolution eligibility
  if (input.autoResolutionEligible) {
    details.push(
      "This conflict qualifies for automatic resolution based on confidence level and risk assessment.",
    );
  }

  return details;
}

/**
 * Get strategy-specific opening detail.
 */
function getStrategyOpeningDetail(input: RationaleInput): string {
  const params = input.strategy.params;

  switch (input.strategy.type) {
    case "wait": {
      const waitParams = params as { estimatedWaitMs?: number };
      const waitTime = formatDuration(waitParams.estimatedWaitMs ?? 0);
      return (
        `Agent ${input.holdingAgentId ?? "holder"} currently holds the reservation. ` +
        `Estimated wait time: ${waitTime}.`
      );
    }

    case "split": {
      const splitParams = params as { proposedPartitions?: unknown[] };
      const partitionCount = splitParams.proposedPartitions?.length ?? 0;
      return (
        `Resource can be divided into ${partitionCount} non-overlapping segments ` +
        `allowing both agents to proceed in parallel.`
      );
    }

    case "transfer": {
      const transferParams = params as {
        fromAgentId?: string;
        toAgentId?: string;
      };
      return (
        `Recommending ${transferParams.fromAgentId ?? "holder"} transfer resource ownership ` +
        `to ${transferParams.toAgentId ?? "requester"} based on priority differential.`
      );
    }

    case "coordinate": {
      const coordParams = params as { coordinationProtocol?: string };
      const protocol = coordParams.coordinationProtocol ?? "turn-based";
      return `Both agents can work on this resource using ${protocol} coordination protocol.`;
    }

    case "escalate": {
      const escParams = params as {
        escalationTarget?: string;
        urgency?: string;
      };
      const target = escParams.escalationTarget ?? "project-lead";
      const urgency = escParams.urgency ?? "normal";
      return `Escalating to ${target} with ${urgency} urgency due to conflict complexity.`;
    }
  }
}

/**
 * Get priority comparison detail.
 */
function getPriorityDetail(input: RationaleInput): string {
  const reqPriority = input.requestingPriority?.priority ?? "unknown";
  const holdPriority = input.holdingPriority?.priority ?? "unknown";

  if (reqPriority === "unknown" && holdPriority === "unknown") {
    return "Priority information is unavailable for both agents.";
  }

  if (reqPriority === holdPriority) {
    return `Both agents have ${reqPriority} priority level.`;
  }

  const reqValue = getPriorityValue(reqPriority);
  const holdValue = getPriorityValue(holdPriority);

  if (reqValue > holdValue) {
    return `Your priority (${reqPriority}) is higher than holder's (${holdPriority}).`;
  }
  return `Your priority (${reqPriority}) is lower than holder's (${holdPriority}).`;
}

/**
 * Get numeric priority value for comparison.
 */
function getPriorityValue(priority: string): number {
  const values: Record<string, number> = {
    P0: 4,
    P1: 3,
    P2: 2,
    P3: 1,
    P4: 0,
  };
  return values[priority] ?? 2;
}

/**
 * Get progress detail.
 */
function getProgressDetail(input: RationaleInput): string {
  // biome-ignore lint/style/noNonNullAssertion: caller guarantees holdingProgress exists
  const progress = input.holdingProgress!;
  const percentage = progress.progressPercentage;
  const remaining = progress.estimatedRemainingMs;

  let detail = `Current progress: ${percentage}% complete`;

  if (remaining !== undefined) {
    detail += ` (estimated ${formatDuration(remaining)} remaining)`;
  }

  detail += ".";

  return detail;
}

/**
 * Get historical success detail.
 */
function getHistoricalDetail(input: RationaleInput): string {
  // biome-ignore lint/style/noNonNullAssertion: caller guarantees these exist
  const rate = input.historicalSuccessRate!;
  // biome-ignore lint/style/noNonNullAssertion: caller guarantees these exist
  const sample = input.historicalSampleSize!;

  const successCount = Math.round(rate * sample);

  return `Historical data: ${successCount}/${sample} similar conflicts resolved successfully with this strategy.`;
}

// ============================================================================
// Evidence Generation
// ============================================================================

/**
 * Generate key evidence points.
 */
function generateEvidence(input: RationaleInput): string[] {
  const evidence: string[] = [];

  // Resource evidence
  if (input.contestedResources.length > 0) {
    const resourceList = input.contestedResources
      .slice(0, 3)
      .map((r) => r.path)
      .join(", ");
    evidence.push(`Contested resources: ${resourceList}`);
  }

  // Confidence factor evidence
  const breakdown = input.confidenceBreakdown;

  if (breakdown.priorityDifferential >= 15) {
    evidence.push("Clear priority differential supports recommendation");
  }

  if (breakdown.progressCertainty >= 12) {
    evidence.push("High certainty on current progress state");
  }

  if (breakdown.historicalMatch >= 20) {
    evidence.push("Strong historical pattern match");
  }

  if (breakdown.resourceCriticality >= 15) {
    evidence.push("Resources are low-risk");
  } else if (breakdown.resourceCriticality < 10) {
    evidence.push("Critical/protected resources require careful handling");
  }

  if (breakdown.timePressure >= 15) {
    evidence.push("Time pressure favors quick resolution");
  }

  // Adjustment evidence
  for (const adj of breakdown.adjustments) {
    if (adj.delta >= 5) {
      evidence.push(`Positive factor: ${formatAdjustmentReason(adj.reason)}`);
    } else if (adj.delta <= -5) {
      evidence.push(`Caution: ${formatAdjustmentReason(adj.reason)}`);
    }
  }

  return evidence;
}

/**
 * Format adjustment reason for display.
 */
function formatAdjustmentReason(reason: string): string {
  const mappings: Record<string, string> = {
    no_priority_data: "No priority data available",
    partial_priority_data: "Partial priority data",
    equal_priority_ambiguity: "Equal priority creates ambiguity",
    no_progress_data: "No progress data available",
    has_time_estimate: "Time estimate available",
    no_historical_data: "No historical data",
    no_strategy_history: "No history for this strategy",
    strong_historical_success: "High historical success rate",
    poor_historical_success: "Low historical success rate",
    critical_resources_involved: "Critical resources involved",
    protected_resources_involved: "Protected resources involved",
    imminent_deadline: "Deadline is imminent",
  };

  return mappings[reason] ?? reason.replace(/_/g, " ");
}

// ============================================================================
// Risk Summary Generation
// ============================================================================

/**
 * Generate risk summary.
 */
function generateRiskSummary(risks: RiskAssessment[]): string {
  if (risks.length === 0) {
    return "Risk: Low - no significant risks identified";
  }

  const highRisks = risks.filter(
    (r) => r.severity === "high" || r.severity === "critical",
  );
  const mediumRisks = risks.filter((r) => r.severity === "medium");

  if (highRisks.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: length check guarantees element exists
    const firstHigh = highRisks[0]!;
    return `Risk: High - ${firstHigh.description}`;
  }

  if (mediumRisks.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: length check guarantees element exists
    const firstMedium = mediumRisks[0]!;
    return `Risk: Medium - ${firstMedium.description}`;
  }

  // biome-ignore lint/style/noNonNullAssertion: risks.length > 0 check at function start
  const lowRisk = risks[0]!;
  return `Risk: Low - ${lowRisk.description}`;
}

// ============================================================================
// Full Rationale Formatting
// ============================================================================

/**
 * Format all components into a full rationale text.
 */
function formatFullRationale(
  summary: string,
  details: string[],
  evidence: string[],
  riskSummary: string,
): string {
  const lines: string[] = [];

  // Summary line
  lines.push(`${summary}:`);

  // Details as bullet points
  for (const detail of details) {
    lines.push(` - ${detail}`);
  }

  // Evidence section
  if (evidence.length > 0) {
    lines.push("");
    lines.push("Evidence:");
    for (const item of evidence) {
      lines.push(` - ${item}`);
    }
  }

  // Risk line
  lines.push("");
  lines.push(riskSummary);

  return lines.join("\n");
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format duration in milliseconds to human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return "< 1 second";
  }

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  return `${hours} hour${hours === 1 ? "" : "s"} ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}`;
}

/**
 * Generate a short rationale for quick display.
 */
export function generateShortRationale(input: RationaleInput): string {
  const strategy = getStrategyLabel(input.strategy.type);
  const confidence = input.confidence;

  switch (input.strategy.type) {
    case "wait": {
      const params = input.strategy.params as { estimatedWaitMs?: number };
      const wait = formatDuration(params.estimatedWaitMs ?? 0);
      return `${strategy} (${confidence}%): Wait ${wait} for holder to complete`;
    }

    case "split":
      return `${strategy} (${confidence}%): Divide resources for parallel work`;

    case "transfer":
      return `${strategy} (${confidence}%): Priority difference supports transfer`;

    case "coordinate":
      return `${strategy} (${confidence}%): Both agents can collaborate`;

    case "escalate":
      return `${strategy} (${confidence}%): Human decision required`;
  }
}

/**
 * Generate rationale for an alternative strategy.
 */
export function generateAlternativeRationale(
  strategy: ResolutionStrategy,
  primaryStrategyType: ResolutionStrategyType,
): string {
  const label = getStrategyLabel(strategy.type);
  const score = strategy.score;

  const reasons: string[] = [];

  if (strategy.type === "escalate" && primaryStrategyType !== "escalate") {
    reasons.push("if automated resolution fails");
  }

  if (strategy.type === "wait" && primaryStrategyType !== "wait") {
    reasons.push("if you prefer to wait for holder");
  }

  if (strategy.type === "transfer" && primaryStrategyType !== "transfer") {
    reasons.push("if priority should take precedence");
  }

  if (strategy.type === "coordinate" && primaryStrategyType !== "coordinate") {
    reasons.push("if collaboration is preferred");
  }

  if (strategy.type === "split" && primaryStrategyType !== "split") {
    reasons.push("if resources can be partitioned");
  }

  const reason = reasons.length > 0 ? ` - ${reasons[0]}` : "";

  return `Alternative: ${label} (score: ${score})${reason}`;
}
