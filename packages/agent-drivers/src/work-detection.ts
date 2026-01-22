/**
 * Work Detection Patterns - Based on NTM robot/is-working.go patterns.
 *
 * Provides pattern-based detection of agent activity state from terminal output.
 * Used by drivers that don't have structured events (e.g., tmux driver).
 *
 * Key principle: NEVER interrupt agents doing useful work.
 */

import type { ActivityState } from "./types";

// =============================================================================
// Pattern Definitions
// =============================================================================

/**
 * Patterns indicating active work by category.
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
    /Grep|Glob|Read|Write|Edit/i,
  ],
  thinking: [
    /Thinking\.\.\./i,
    /Processing/i,
    /Analyzing/i,
    /Let me/i,
    /I'll/i,
    /I will/i,
    /Looking at/i,
    /Considering/i,
  ],
  streaming: [/```/, /^\s*[+-]\s+/m, /^\s*\d+\./m],
  claude: [
    /Claude is thinking/i,
    /Analyzing request/i,
    /antml:thinking/i,
    /antml:function/i,
    /antml:invoke/i,
  ],
  codex: [/Codex is processing/i, /Generating code/i, /CODEX>/i],
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
  /\$\s*$/m,
  /What would you like/i,
  /How can I help/i,
  /Enter.*command/i,
  /human turn/i,
  /<human>/i,
  /\[human\]/i,
];

// =============================================================================
// Types
// =============================================================================

/**
 * Result of work detection analysis.
 */
export interface WorkDetectionResult {
  /** Detected activity state */
  activityState: ActivityState;
  /** Is the agent actively working (should not be interrupted) */
  isWorking: boolean;
  /** Is the agent idle (safe to send new work) */
  isIdle: boolean;
  /** Is the agent rate limited */
  isRateLimited: boolean;
  /** Is the context window running low */
  isContextLow: boolean;
  /** Detected context remaining percentage (if found) */
  contextRemainingPercent?: number;
  /** Confidence in the detection (0-1) */
  confidence: number;
  /** Patterns that matched (for debugging) */
  matchedPatterns: string[];
}

// =============================================================================
// Detection Functions
// =============================================================================

/**
 * Detect work state from agent output using pattern matching.
 *
 * @param output - Recent terminal output to analyze
 * @param agentType - Optional agent type for type-specific patterns
 * @returns Detection result with activity state and confidence
 */
export function detectWorkState(
  output: string,
  agentType?: string,
): WorkDetectionResult {
  const matchedPatterns: string[] = [];

  let workScore = 0;
  let idleScore = 0;
  let limitScore = 0;
  let contextLowScore = 0;
  let contextRemainingPercent: number | undefined;

  // Check work patterns
  for (const [category, patterns] of Object.entries(WORK_PATTERNS)) {
    // Skip agent-specific patterns if not that agent type
    if (
      agentType &&
      ["claude", "codex", "gemini"].includes(category) &&
      !agentType.toLowerCase().includes(category)
    ) {
      continue;
    }

    for (const pattern of patterns) {
      if (pattern.test(output)) {
        matchedPatterns.push(`work:${category}`);
        workScore += 1;
      }
    }
  }

  // Check rate limit patterns
  for (const pattern of RATE_LIMIT_PATTERNS) {
    if (pattern.test(output)) {
      matchedPatterns.push("limit:rate");
      limitScore += 2; // Rate limits are more definitive
    }
  }

  // Check context patterns
  for (const pattern of CONTEXT_PATTERNS) {
    const match = output.match(pattern);
    if (match) {
      matchedPatterns.push("context:low");
      contextLowScore += 1;
      if (match[1]) {
        contextRemainingPercent = parseInt(match[1], 10);
      }
    }
  }

  // Check idle patterns
  for (const pattern of IDLE_PATTERNS) {
    if (pattern.test(output)) {
      matchedPatterns.push("idle");
      idleScore += 1;
    }
  }

  // Calculate confidence based on total matches
  const totalMatches = workScore + idleScore + limitScore + contextLowScore;
  const confidence =
    totalMatches === 0 ? 0.1 : Math.min(0.95, 0.3 + totalMatches * 0.1);

  // Determine states
  const isRateLimited = limitScore > 0;
  const isContextLow =
    contextLowScore > 0 || (contextRemainingPercent ?? 100) < 20;
  const isWorking = workScore > idleScore && !isRateLimited;
  const isIdle = idleScore > workScore || (workScore === 0 && idleScore > 0);

  // Determine activity state
  let activityState: ActivityState = "idle";
  if (isRateLimited) {
    activityState = "stalled"; // Rate limited is effectively stalled
  } else if (isWorking) {
    activityState = workScore > 2 ? "working" : "thinking";
  } else if (isIdle) {
    activityState = "idle";
  }

  const result: WorkDetectionResult = {
    activityState,
    isWorking,
    isIdle,
    isRateLimited,
    isContextLow,
    confidence,
    matchedPatterns,
  };

  // Only include contextRemainingPercent if defined
  if (contextRemainingPercent !== undefined) {
    result.contextRemainingPercent = contextRemainingPercent;
  }

  return result;
}

/**
 * Quick check if agent appears to be working (should not be interrupted).
 *
 * @param output - Recent terminal output to analyze
 * @returns true if agent appears to be doing useful work
 */
export function isAgentWorking(output: string): boolean {
  const result = detectWorkState(output);
  return result.isWorking && result.confidence > 0.5;
}

/**
 * Quick check if agent appears idle (safe to send new work).
 *
 * @param output - Recent terminal output to analyze
 * @returns true if agent appears idle and ready for input
 */
export function isAgentIdle(output: string): boolean {
  const result = detectWorkState(output);
  return result.isIdle && result.confidence > 0.5;
}
