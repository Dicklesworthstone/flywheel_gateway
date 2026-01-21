/**
 * Reference: NTM Is-Working Detection
 *
 * Pattern-based detection of whether an agent is actively working.
 * Adapted from ntm/internal/robot/is_working.go
 *
 * This is the DIRECT ANSWER to: "NEVER interrupt agents doing useful work!!!"
 *
 * Before ANY restart action, a controller agent must be able to ask:
 * "Is this agent actively working?" This pattern provides that answer
 * with structured, actionable output.
 */

import type {
  RobotResponse,
  WorkIndicators,
  RecommendationAction,
  ConfidenceLevel,
} from "./types";

// =============================================================================
// Is-Working Types
// =============================================================================

/**
 * Options for is-working check.
 */
export interface IsWorkingOptions {
  /** Agent/session identifier */
  agentId: string;

  /** Number of recent output lines to analyze */
  linesCaptured?: number;

  /** Include raw sample in output */
  verbose?: boolean;
}

/**
 * Default options for is-working check.
 */
export const defaultIsWorkingOptions: Required<
  Omit<IsWorkingOptions, "agentId">
> = {
  linesCaptured: 100,
  verbose: false,
};

/**
 * Work status for a single agent.
 */
export interface AgentWorkStatus {
  /** Detected agent type */
  agent_type: string;

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
  confidence: ConfidenceLevel;

  /** Matched indicator patterns */
  indicators: WorkIndicators;

  /** Recommended action */
  recommendation: RecommendationAction;

  /** Reason for recommendation */
  recommendation_reason: string;

  /** Raw output sample (verbose mode only) */
  raw_sample?: string;
}

/**
 * Summary statistics across all checked agents.
 */
export interface IsWorkingSummary {
  /** Total agents checked */
  total_agents: number;

  /** Agents actively working */
  working_count: number;

  /** Agents idle/waiting */
  idle_count: number;

  /** Agents rate limited */
  rate_limited_count: number;

  /** Agents with low context */
  context_low_count: number;

  /** Agents with errors */
  error_count: number;

  /** Agents grouped by recommendation */
  by_recommendation: Record<RecommendationAction, string[]>;
}

/**
 * Query parameters for reproducibility.
 */
export interface IsWorkingQuery {
  /** Requested agent IDs */
  agents_requested: string[];

  /** Lines captured per agent */
  lines_captured: number;
}

/**
 * Complete response for is-working check.
 */
export interface IsWorkingOutput extends RobotResponse {
  /** Query parameters */
  query: IsWorkingQuery;

  /** Work status per agent */
  agents: Record<string, AgentWorkStatus>;

  /** Aggregate summary */
  summary: IsWorkingSummary;
}

// =============================================================================
// Work Detection Patterns
// =============================================================================

/**
 * Patterns indicating active work.
 * Matched against recent agent output.
 */
export const WORK_PATTERNS = {
  // Tool execution indicators
  tool_calling: [
    /Using tool:/i,
    /Tool call:/i,
    /Running.*\.\.\./i,
    /Executing/i,
    /Applying changes/i,
    /Writing to/i,
    /Creating file/i,
    /Editing file/i,
  ],

  // Thinking/processing indicators
  thinking: [
    /Thinking\.\.\./i,
    /Processing/i,
    /Analyzing/i,
    /Searching/i,
    /Reading/i,
    /Let me/i,
    /I'll/i,
    /I will/i,
  ],

  // Active output generation
  streaming: [
    /```/,
    /^\s*[+-]\s+/m, // Diff lines
    /^\s*\d+\./m, // Numbered lists being generated
  ],

  // Model-specific working indicators
  claude: [/Claude is thinking/i, /Analyzing request/i],
  codex: [/Codex is processing/i, /Generating code/i],
  gemini: [/Gemini is working/i, /Generating response/i],
} as const;

/**
 * Patterns indicating rate limiting.
 */
export const RATE_LIMIT_PATTERNS = [
  /rate limit/i,
  /too many requests/i,
  /429/i,
  /quota exceeded/i,
  /capacity reached/i,
  /try again/i,
  /wait.*seconds/i,
  /retry after/i,
] as const;

/**
 * Patterns indicating low context.
 */
export const CONTEXT_LOW_PATTERNS = [
  /context.*(\d+)%/i, // "context at 15%"
  /running low on context/i,
  /context window.*full/i,
  /approaching context limit/i,
] as const;

/**
 * Patterns indicating idle/waiting state.
 */
export const IDLE_PATTERNS = [
  /waiting for/i,
  /ready for/i,
  /^>\s*$/m, // Prompt character alone
  /What would you like/i,
  /How can I help/i,
  /Enter.*command/i,
] as const;

// =============================================================================
// Detection Logic
// =============================================================================

/**
 * Detect work state from agent output.
 */
export function detectWorkState(
  output: string,
  agentType?: string
): {
  is_working: boolean;
  is_idle: boolean;
  is_rate_limited: boolean;
  is_context_low: boolean;
  context_remaining?: number;
  confidence: ConfidenceLevel;
  indicators: WorkIndicators;
} {
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
    for (const pattern of patterns as readonly RegExp[]) {
      if (pattern.test(output)) {
        indicators.work.push(`${category}:${pattern.source}`);
        workScore += 1;
      }
    }
  }

  // Check rate limit patterns
  for (const pattern of RATE_LIMIT_PATTERNS) {
    if (pattern.test(output)) {
      indicators.limit.push(pattern.source);
      limitScore += 2; // Rate limit patterns are stronger signals
    }
  }

  // Check context patterns
  for (const pattern of CONTEXT_LOW_PATTERNS) {
    const match = output.match(pattern);
    if (match) {
      contextLowScore += 1;
      // Try to extract percentage
      if (match[1]) {
        contextRemaining = parseInt(match[1], 10);
      }
    }
  }

  // Check idle patterns
  for (const pattern of IDLE_PATTERNS) {
    if (pattern.test(output)) {
      idleScore += 1;
    }
  }

  // Calculate confidence based on pattern matches
  const totalMatches = workScore + idleScore + limitScore + contextLowScore;
  const confidence =
    totalMatches === 0 ? 0.1 : Math.min(0.95, 0.3 + totalMatches * 0.1);

  // Determine states
  const is_rate_limited = limitScore > 0;
  const is_context_low = contextLowScore > 0 || (contextRemaining ?? 100) < 20;
  const is_working = workScore > idleScore && !is_rate_limited;
  const is_idle = idleScore > workScore || (workScore === 0 && idleScore > 0);

  const result: {
    is_working: boolean;
    is_idle: boolean;
    is_rate_limited: boolean;
    is_context_low: boolean;
    context_remaining?: number;
    confidence: number;
    indicators: WorkIndicators;
  } = {
    is_working,
    is_idle,
    is_rate_limited,
    is_context_low,
    confidence,
    indicators,
  };

  // Only include context_remaining if defined (for exactOptionalPropertyTypes)
  if (contextRemaining !== undefined) {
    result.context_remaining = contextRemaining;
  }

  return result;
}

/**
 * Determine recommendation based on detected state.
 */
export function determineWorkRecommendation(state: {
  is_working: boolean;
  is_idle: boolean;
  is_rate_limited: boolean;
  is_context_low: boolean;
  confidence: ConfidenceLevel;
}): { action: RecommendationAction; reason: string } {
  // NEVER interrupt working agents
  if (state.is_working && state.confidence > 0.5) {
    return {
      action: "WAIT",
      reason: `Agent is actively working (confidence: ${(state.confidence * 100).toFixed(0)}%)`,
    };
  }

  // Rate limited - wait for reset
  if (state.is_rate_limited) {
    return {
      action: "CHECK_RATE_LIMIT",
      reason: "Agent is rate limited, check provider status",
    };
  }

  // Context low - needs rotation
  if (state.is_context_low) {
    return {
      action: "ROTATE_CONTEXT",
      reason: "Agent context window is low",
    };
  }

  // Idle - can send new work
  if (state.is_idle) {
    return {
      action: "SEND_PROMPT",
      reason: "Agent is idle and waiting for input",
    };
  }

  // Low confidence - needs investigation
  if (state.confidence < 0.3) {
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

// =============================================================================
// Summary Calculation
// =============================================================================

/**
 * Calculate summary from individual agent statuses.
 */
export function calculateIsWorkingSummary(
  agentStatuses: Record<string, AgentWorkStatus>
): IsWorkingSummary {
  const byRecommendation: Record<RecommendationAction, string[]> = {
    WAIT: [],
    RESTART: [],
    SEND_PROMPT: [],
    CHECK_RATE_LIMIT: [],
    ROTATE_CONTEXT: [],
    INVESTIGATE: [],
  };

  let workingCount = 0;
  let idleCount = 0;
  let rateLimitedCount = 0;
  let contextLowCount = 0;
  let errorCount = 0;

  for (const [agentId, status] of Object.entries(agentStatuses)) {
    if (status.is_working) workingCount++;
    if (status.is_idle) idleCount++;
    if (status.is_rate_limited) rateLimitedCount++;
    if (status.is_context_low) contextLowCount++;

    byRecommendation[status.recommendation].push(agentId);
  }

  return {
    total_agents: Object.keys(agentStatuses).length,
    working_count: workingCount,
    idle_count: idleCount,
    rate_limited_count: rateLimitedCount,
    context_low_count: contextLowCount,
    error_count: errorCount,
    by_recommendation: byRecommendation,
  };
}
