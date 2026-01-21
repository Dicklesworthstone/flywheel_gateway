/**
 * Reference: NTM Agent Health Monitoring
 *
 * Comprehensive agent health assessment combining local state with provider usage.
 * Adapted from ntm/internal/robot/agent_health.go
 *
 * This pattern enables sophisticated controller decisions like:
 * - "Agent is idle but account is at 90% - wait before sending more work"
 * - "Agent looks idle but provider is at capacity - switch accounts"
 */

import type {
  RobotResponse,
  WorkIndicators,
  HealthGrade,
  RecommendationAction,
  ProviderUsageInfo,
} from "./types";

// =============================================================================
// Agent Health Types
// =============================================================================

/**
 * Options for agent health check.
 */
export interface AgentHealthOptions {
  /** Agent/session identifier */
  agentId: string;

  /** Number of recent output lines to analyze */
  linesCaptured?: number;

  /** Whether to query provider for usage data */
  includeProviderUsage?: boolean;

  /** Timeout for provider queries in ms */
  providerTimeout?: number;

  /** Include raw sample in output for debugging */
  verbose?: boolean;
}

/**
 * Default options for agent health check.
 */
export const defaultAgentHealthOptions: Required<
  Omit<AgentHealthOptions, "agentId">
> = {
  linesCaptured: 100,
  includeProviderUsage: true,
  providerTimeout: 10000,
  verbose: false,
};

/**
 * Local state information parsed from agent output.
 */
export interface LocalStateInfo {
  /** Whether agent is actively working */
  is_working: boolean;

  /** Whether agent is idle/waiting */
  is_idle: boolean;

  /** Whether agent hit rate limit */
  is_rate_limited: boolean;

  /** Whether context window is low */
  is_context_low: boolean;

  /** Remaining context percentage if detectable */
  context_remaining?: number;

  /** Confidence in this assessment (0-1) */
  confidence: number;

  /** Matched indicator patterns */
  indicators: WorkIndicators;
}

/**
 * Health status for a single agent/pane.
 */
export interface AgentHealthStatus {
  /** Detected agent type (claude-code, codex, gemini, etc.) */
  agent_type: string;

  /** Parsed local state */
  local_state: LocalStateInfo;

  /** Provider usage if available */
  provider_usage?: ProviderUsageInfo;

  /** Health score (0-100) */
  health_score: number;

  /** Letter grade */
  health_grade: HealthGrade;

  /** List of detected issues */
  issues: string[];

  /** Recommended action */
  recommendation: RecommendationAction;

  /** Reason for recommendation */
  recommendation_reason: string;

  /** Raw output sample (verbose mode only) */
  raw_sample?: string;
}

/**
 * Provider statistics aggregated across agents.
 */
export interface ProviderStats {
  /** Number of accounts in use */
  accounts: number;

  /** Average usage percentage */
  avg_used_percent: number;

  /** Agent indices using this provider */
  agents_using: string[];
}

/**
 * Fleet-wide health summary.
 */
export interface FleetHealthSummary {
  /** Total number of agents */
  total_agents: number;

  /** Agents in healthy state */
  healthy_count: number;

  /** Agents with warnings */
  warning_count: number;

  /** Agents in critical state */
  critical_count: number;

  /** Average health score */
  avg_health_score: number;

  /** Overall fleet grade */
  overall_grade: HealthGrade;
}

/**
 * Query parameters for reproducibility.
 */
export interface AgentHealthQuery {
  /** Requested agent IDs */
  agents_requested: string[];

  /** Lines captured per agent */
  lines_captured: number;

  /** Whether provider usage was queried */
  provider_enabled: boolean;
}

/**
 * Complete response for agent health check.
 */
export interface AgentHealthOutput extends RobotResponse {
  /** Query parameters */
  query: AgentHealthQuery;

  /** Whether provider usage API is available */
  provider_available: boolean;

  /** Health status per agent */
  agents: Record<string, AgentHealthStatus>;

  /** Aggregated provider statistics */
  provider_summary: Record<string, ProviderStats>;

  /** Fleet-wide health summary */
  fleet_health: FleetHealthSummary;
}

// =============================================================================
// Health Score Calculation
// =============================================================================

/**
 * Calculate health score from local state and provider usage.
 *
 * Scoring factors:
 * - Base score: 100
 * - Rate limited: -40
 * - Context low: -30
 * - Stalled: -25
 * - Provider usage > 80%: -20
 * - Provider usage > 90%: -15 additional
 * - Low confidence: -10
 */
export function calculateHealthScore(
  localState: LocalStateInfo,
  providerUsage?: ProviderUsageInfo
): number {
  let score = 100;

  // Local state penalties
  if (localState.is_rate_limited) {
    score -= 40;
  }

  if (localState.is_context_low) {
    score -= 30;
  }

  // Provider usage penalties
  if (providerUsage?.primary_window?.used_percent) {
    const usage = providerUsage.primary_window.used_percent;
    if (usage > 90) {
      score -= 35;
    } else if (usage > 80) {
      score -= 20;
    } else if (usage > 70) {
      score -= 10;
    }
  }

  // Low confidence penalty
  if (localState.confidence < 0.5) {
    score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Determine recommendation based on health assessment.
 */
export function determineRecommendation(
  localState: LocalStateInfo,
  providerUsage?: ProviderUsageInfo
): { action: RecommendationAction; reason: string } {
  // Working agents should not be interrupted
  if (localState.is_working && localState.confidence > 0.7) {
    return {
      action: "WAIT",
      reason: "Agent is actively working with high confidence",
    };
  }

  // Rate limited agents need to wait
  if (localState.is_rate_limited) {
    return {
      action: "CHECK_RATE_LIMIT",
      reason: "Agent appears rate limited",
    };
  }

  // Context low needs rotation
  if (localState.is_context_low) {
    return {
      action: "ROTATE_CONTEXT",
      reason: `Context window at ${localState.context_remaining ?? "unknown"}%`,
    };
  }

  // Provider at capacity
  if (
    providerUsage?.primary_window?.used_percent &&
    providerUsage.primary_window.used_percent > 90
  ) {
    return {
      action: "CHECK_RATE_LIMIT",
      reason: `Provider usage at ${providerUsage.primary_window.used_percent}%`,
    };
  }

  // Idle and ready
  if (localState.is_idle) {
    return {
      action: "SEND_PROMPT",
      reason: "Agent is idle and ready for work",
    };
  }

  // Low confidence - investigate
  if (localState.confidence < 0.3) {
    return {
      action: "INVESTIGATE",
      reason: "Unable to determine agent state with confidence",
    };
  }

  // Default to restart for stalled agents
  return {
    action: "RESTART",
    reason: "Agent appears stalled or unresponsive",
  };
}

// =============================================================================
// Fleet Health Aggregation
// =============================================================================

/**
 * Calculate fleet-wide health summary from individual agent statuses.
 */
export function calculateFleetHealth(
  agentStatuses: Record<string, AgentHealthStatus>
): FleetHealthSummary {
  const agents = Object.values(agentStatuses);
  const total = agents.length;

  if (total === 0) {
    return {
      total_agents: 0,
      healthy_count: 0,
      warning_count: 0,
      critical_count: 0,
      avg_health_score: 0,
      overall_grade: "F",
    };
  }

  let healthyCount = 0;
  let warningCount = 0;
  let criticalCount = 0;
  let totalScore = 0;

  for (const agent of agents) {
    totalScore += agent.health_score;

    if (agent.health_score >= 75) {
      healthyCount++;
    } else if (agent.health_score >= 40) {
      warningCount++;
    } else {
      criticalCount++;
    }
  }

  const avgScore = totalScore / total;

  // Overall grade is affected by critical agents
  let overallGrade: HealthGrade;
  if (criticalCount > total * 0.3) {
    overallGrade = "D";
  } else if (criticalCount > 0 || warningCount > total * 0.5) {
    overallGrade = "C";
  } else if (warningCount > 0) {
    overallGrade = "B";
  } else {
    overallGrade = "A";
  }

  return {
    total_agents: total,
    healthy_count: healthyCount,
    warning_count: warningCount,
    critical_count: criticalCount,
    avg_health_score: Math.round(avgScore),
    overall_grade: overallGrade,
  };
}
