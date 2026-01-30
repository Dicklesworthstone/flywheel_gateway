/**
 * Agent Health Service
 *
 * Comprehensive agent health monitoring combining local state assessment
 * with provider usage tracking.
 *
 * Based on patterns from NTM's robot/agent_health.go
 *
 * Key principles:
 * - NEVER interrupt agents doing useful work
 * - Combine local state + provider usage for complete picture
 * - Provide actionable recommendations
 */

import { getLogger } from "../middleware/correlation";

// =============================================================================
// Types
// =============================================================================

/**
 * Activity state for an agent.
 */
export type ActivityState =
  | "idle"
  | "thinking"
  | "working"
  | "tool_calling"
  | "waiting_input"
  | "error"
  | "stalled"
  | "rate_limited"
  | "context_low";

/**
 * Recommended action based on health assessment.
 */
export type RecommendationAction =
  | "WAIT" // Agent is working, do not interrupt
  | "RESTART" // Agent is idle/stalled, safe to restart
  | "SEND_PROMPT" // Agent is ready for new work
  | "CHECK_RATE_LIMIT" // May be rate limited
  | "ROTATE_CONTEXT" // Context window low
  | "INVESTIGATE"; // Unusual state, needs investigation

/**
 * Health grade (A-F).
 */
export type HealthGrade = "A" | "B" | "C" | "D" | "F";

/**
 * Patterns that matched during work detection.
 */
export interface WorkIndicators {
  work: string[];
  limit: string[];
}

/**
 * Local state assessment from output analysis.
 */
export interface LocalStateInfo {
  is_working: boolean;
  is_idle: boolean;
  is_rate_limited: boolean;
  is_context_low: boolean;
  context_remaining?: number;
  confidence: number;
  indicators: WorkIndicators;
  activity_state: ActivityState;
}

/**
 * Provider usage information.
 */
export interface ProviderUsageInfo {
  provider: string;
  account?: string;
  used_percent?: number;
  resets_at?: string;
  operational: boolean;
}

/**
 * Complete health status for an agent.
 */
export interface AgentHealthStatus {
  agent_id: string;
  agent_type: string;
  local_state: LocalStateInfo;
  provider_usage?: ProviderUsageInfo;
  health_score: number;
  health_grade: HealthGrade;
  issues: string[];
  recommendation: RecommendationAction;
  recommendation_reason: string;
  last_updated: Date;
}

/**
 * Fleet-wide health summary.
 */
export interface FleetHealthSummary {
  total_agents: number;
  healthy_count: number;
  warning_count: number;
  critical_count: number;
  avg_health_score: number;
  overall_grade: HealthGrade;
  by_recommendation: Record<RecommendationAction, string[]>;
}

// =============================================================================
// Pattern Definitions
// =============================================================================

/**
 * Patterns indicating active work.
 */
const WORK_PATTERNS = {
  tool_calling: [
    /Using tool:/i,
    /Tool call:/i,
    /Running.*\.\.\./i,
    /Executing/i,
    /Applying changes/i,
    /Writing to/i,
    /Creating file/i,
    /Editing file/i,
    /Reading file/i,
    /Searching/i,
  ],
  thinking: [
    /Thinking\.\.\./i,
    /Processing/i,
    /Analyzing/i,
    /Let me/i,
    /I'll/i,
    /I will/i,
    /Looking at/i,
  ],
  streaming: [/```/, /^\s*[+-]\s+/m, /^\s*\d+\./m],
  claude: [/Claude is thinking/i, /Analyzing request/i],
  codex: [/Codex is processing/i, /Generating code/i],
  gemini: [/Gemini is working/i, /Generating response/i],
};

/**
 * Patterns indicating rate limiting.
 */
const RATE_LIMIT_PATTERNS = [
  /rate limit/i,
  /too many requests/i,
  /429/i,
  /quota exceeded/i,
  /capacity reached/i,
  /try again/i,
  /wait.*seconds/i,
  /retry after/i,
];

/**
 * Patterns indicating context window issues.
 */
const CONTEXT_PATTERNS = [
  /context.*(\d+)%/i,
  /running low on context/i,
  /context window.*full/i,
  /approaching context limit/i,
  /token.*limit/i,
];

/**
 * Patterns indicating idle state.
 */
const IDLE_PATTERNS = [
  /waiting for/i,
  /ready for/i,
  /^>\s*$/m,
  /What would you like/i,
  /How can I help/i,
  /Enter.*command/i,
  /human turn/i,
];

// =============================================================================
// In-Memory Storage
// =============================================================================

/** Health status cache per agent */
const healthCache = new Map<string, AgentHealthStatus>();

/** Output samples for analysis */
const outputSamples = new Map<string, string[]>();

/** Maximum output lines to keep for analysis */
const MAX_OUTPUT_LINES = 100;

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Update the output sample for an agent.
 * Called when new output is received.
 */
export function pushOutputSample(agentId: string, output: string): void {
  let lines = outputSamples.get(agentId) || [];

  // Split new output into lines to ensure granular retention
  // Handle various newline formats
  let newLines = output.split(/\r?\n/);

  // Optimization: If newLines is huge, only keep the tail
  // This prevents potential stack overflow from spreading too many arguments
  if (newLines.length > MAX_OUTPUT_LINES) {
    newLines = newLines.slice(-MAX_OUTPUT_LINES);
  }

  // Combine
  lines = lines.concat(newLines);

  // Keep only recent lines
  if (lines.length > MAX_OUTPUT_LINES) {
    lines = lines.slice(-MAX_OUTPUT_LINES);
  }

  outputSamples.set(agentId, lines);
}

/**
 * Get the recent output sample for an agent.
 */
export function getOutputSample(agentId: string): string {
  const lines = outputSamples.get(agentId) || [];
  return lines.join("\n");
}

/**
 * Clear output sample for an agent.
 */
export function clearOutputSample(agentId: string): void {
  outputSamples.delete(agentId);
}

/**
 * Detect work state from agent output.
 */
export function detectWorkState(
  output: string,
  _agentType?: string,
): LocalStateInfo {
  const indicators: WorkIndicators = {
    work: [],
    limit: [],
  };

  let workScore = 0;
  let idleScore = 0;
  let limitScore = 0;
  let contextLowScore = 0;
  let contextRemaining: number | undefined;

  // Check work patterns
  for (const [category, patterns] of Object.entries(WORK_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(output)) {
        indicators.work.push(`${category}:${pattern.source.substring(0, 20)}`);
        workScore += 1;
      }
    }
  }

  // Check rate limit patterns
  for (const pattern of RATE_LIMIT_PATTERNS) {
    if (pattern.test(output)) {
      indicators.limit.push(pattern.source.substring(0, 20));
      limitScore += 2;
    }
  }

  // Check context patterns
  for (const pattern of CONTEXT_PATTERNS) {
    // Create global regex to find all matches (latest is most relevant)
    const flags = pattern.flags.includes("g")
      ? pattern.flags
      : `${pattern.flags}g`;
    const globalPattern = new RegExp(pattern.source, flags);
    const matches = Array.from(output.matchAll(globalPattern));

    if (matches.length > 0) {
      contextLowScore += 1;
      const lastMatch = matches[matches.length - 1];
      if (lastMatch?.[1]) {
        contextRemaining = parseInt(lastMatch[1], 10);
      }
    }
  }

  // Check idle patterns
  for (const pattern of IDLE_PATTERNS) {
    if (pattern.test(output)) {
      idleScore += 1;
    }
  }

  // Calculate confidence
  const totalMatches = workScore + idleScore + limitScore + contextLowScore;
  const confidence =
    totalMatches === 0 ? 0.1 : Math.min(0.95, 0.3 + totalMatches * 0.1);

  // Determine states
  const is_rate_limited = limitScore > 0;
  const is_context_low = contextLowScore > 0 || (contextRemaining ?? 100) < 20;
  const is_working = workScore > idleScore && !is_rate_limited;
  const is_idle = idleScore > workScore || (workScore === 0 && idleScore > 0);

  // Determine activity state
  let activity_state: ActivityState = "idle";
  if (is_rate_limited) {
    activity_state = "rate_limited";
  } else if (is_context_low) {
    activity_state = "context_low";
  } else if (is_working) {
    activity_state = workScore > 2 ? "working" : "thinking";
  } else if (is_idle) {
    activity_state = "idle";
  }

  const result: LocalStateInfo = {
    is_working,
    is_idle,
    is_rate_limited,
    is_context_low,
    confidence,
    indicators,
    activity_state,
  };

  // Only include context_remaining if defined (for exactOptionalPropertyTypes)
  if (contextRemaining !== undefined) {
    result.context_remaining = contextRemaining;
  }

  return result;
}

/**
 * Calculate health score from local state and provider usage.
 */
export function calculateHealthScore(
  localState: LocalStateInfo,
  providerUsage?: ProviderUsageInfo,
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
  if (providerUsage?.used_percent) {
    const usage = providerUsage.used_percent;
    if (usage > 90) {
      score -= 35;
    } else if (usage > 80) {
      score -= 20;
    } else if (usage > 70) {
      score -= 10;
    }
  }

  // Provider not operational
  if (providerUsage && !providerUsage.operational) {
    score -= 25;
  }

  // Low confidence penalty
  if (localState.confidence < 0.5) {
    score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Convert health score to letter grade.
 */
export function scoreToGrade(score: number): HealthGrade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

/**
 * Determine recommendation based on health assessment.
 */
export function determineRecommendation(
  localState: LocalStateInfo,
  providerUsage?: ProviderUsageInfo,
): { action: RecommendationAction; reason: string } {
  // CORE PRINCIPLE: NEVER interrupt working agents
  if (localState.is_working && localState.confidence > 0.5) {
    return {
      action: "WAIT",
      reason: `Agent is actively working (confidence: ${(localState.confidence * 100).toFixed(0)}%)`,
    };
  }

  // Rate limited - wait for reset
  if (localState.is_rate_limited) {
    return {
      action: "CHECK_RATE_LIMIT",
      reason: "Agent is rate limited, check provider status",
    };
  }

  // Context low - needs rotation
  if (localState.is_context_low) {
    return {
      action: "ROTATE_CONTEXT",
      reason: `Context window at ${localState.context_remaining ?? "unknown"}%`,
    };
  }

  // Provider at capacity
  if (providerUsage?.used_percent && providerUsage.used_percent > 90) {
    return {
      action: "CHECK_RATE_LIMIT",
      reason: `Provider usage at ${providerUsage.used_percent}%`,
    };
  }

  // Idle - can send new work
  if (localState.is_idle) {
    return {
      action: "SEND_PROMPT",
      reason: "Agent is idle and waiting for input",
    };
  }

  // Low confidence - investigate
  if (localState.confidence < 0.3) {
    return {
      action: "INVESTIGATE",
      reason: "Cannot determine agent state with confidence",
    };
  }

  // Default: safe to restart
  return {
    action: "RESTART",
    reason: "Agent appears stalled, safe to restart",
  };
}

/**
 * Get health status for an agent.
 */
export function getAgentHealth(
  agentId: string,
  agentType?: string,
  providerUsage?: ProviderUsageInfo,
): AgentHealthStatus {
  const log = getLogger();
  const output = getOutputSample(agentId);
  const localState = detectWorkState(output, agentType);
  const healthScore = calculateHealthScore(localState, providerUsage);
  const { action, reason } = determineRecommendation(localState, providerUsage);

  // Collect issues
  const issues: string[] = [];
  if (localState.is_rate_limited) {
    issues.push("Rate limited");
  }
  if (localState.is_context_low) {
    issues.push(`Context low (${localState.context_remaining ?? "unknown"}%)`);
  }
  if (providerUsage && !providerUsage.operational) {
    issues.push("Provider not operational");
  }
  if (localState.confidence < 0.3) {
    issues.push("Low confidence in state detection");
  }

  const status: AgentHealthStatus = {
    agent_id: agentId,
    agent_type: agentType || "unknown",
    local_state: localState,
    health_score: healthScore,
    health_grade: scoreToGrade(healthScore),
    issues,
    recommendation: action,
    recommendation_reason: reason,
    last_updated: new Date(),
  };

  // Only include provider_usage if defined (for exactOptionalPropertyTypes)
  if (providerUsage !== undefined) {
    status.provider_usage = providerUsage;
  }

  // Cache the status
  healthCache.set(agentId, status);

  log.debug(
    {
      agentId,
      healthScore,
      recommendation: action,
      issues,
    },
    "Agent health assessed",
  );

  return status;
}

/**
 * Get cached health status for an agent.
 */
export function getCachedAgentHealth(
  agentId: string,
): AgentHealthStatus | undefined {
  return healthCache.get(agentId);
}

/**
 * Clear health status for an agent.
 */
export function clearAgentHealth(agentId: string): void {
  healthCache.delete(agentId);
  outputSamples.delete(agentId);
}

/**
 * Check if it's safe to restart an agent (is NOT working).
 */
export function isSafeToRestart(
  agentId: string,
  agentType?: string,
  providerUsage?: ProviderUsageInfo,
): { safe: boolean; reason: string } {
  const health = getAgentHealth(agentId, agentType, providerUsage);

  if (health.recommendation === "WAIT") {
    return {
      safe: false,
      reason: health.recommendation_reason,
    };
  }

  if (
    health.recommendation === "RESTART" ||
    health.recommendation === "SEND_PROMPT"
  ) {
    return {
      safe: true,
      reason: health.recommendation_reason,
    };
  }

  // For other recommendations (CHECK_RATE_LIMIT, ROTATE_CONTEXT, INVESTIGATE)
  // it's technically safe but may not be ideal
  return {
    safe: true,
    reason: `${health.recommendation}: ${health.recommendation_reason}`,
  };
}

/**
 * Calculate fleet-wide health summary.
 */
export function getFleetHealthSummary(agentIds: string[]): FleetHealthSummary {
  const byRecommendation: Record<RecommendationAction, string[]> = {
    WAIT: [],
    RESTART: [],
    SEND_PROMPT: [],
    CHECK_RATE_LIMIT: [],
    ROTATE_CONTEXT: [],
    INVESTIGATE: [],
  };

  let healthyCount = 0;
  let warningCount = 0;
  let criticalCount = 0;
  let totalScore = 0;

  for (const agentId of agentIds) {
    const health = healthCache.get(agentId);
    if (!health) continue;

    totalScore += health.health_score;
    byRecommendation[health.recommendation].push(agentId);

    if (health.health_score >= 75) {
      healthyCount++;
    } else if (health.health_score >= 40) {
      warningCount++;
    } else {
      criticalCount++;
    }
  }

  const total = agentIds.length;
  const avgScore = total > 0 ? totalScore / total : 0;

  // Overall grade affected by critical agents
  let overallGrade: HealthGrade;
  if (total === 0) {
    overallGrade = "A";
  } else if (criticalCount > total * 0.3) {
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
    by_recommendation: byRecommendation,
  };
}
