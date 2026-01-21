/**
 * Reference: NTM Robot Types
 *
 * Standard type definitions for robot-mode JSON output.
 * Adapted from ntm/internal/robot/types.go
 *
 * These types define the contract for machine-readable API responses
 * that AI agents and automation tools can reliably parse.
 */

// =============================================================================
// Robot Response Envelope
// =============================================================================

/**
 * Standard envelope for all robot-mode responses.
 * Every robot command output extends this base type.
 */
export interface RobotResponse {
  /** Whether the operation succeeded */
  success: boolean;

  /** ISO8601 timestamp of when the response was generated */
  timestamp: string;

  /** NTM version that generated this response */
  version: string;

  /** Error message if success is false */
  error?: string;

  /** Machine-readable error code */
  error_code?: string;

  /** Human-readable hint for resolving the error */
  hint?: string;
}

// =============================================================================
// Error Codes
// =============================================================================

/**
 * Standard error codes for robot-mode responses.
 * Use these for programmatic error handling.
 */
export const ErrorCodes = {
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  PANE_NOT_FOUND: "PANE_NOT_FOUND",
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  INVALID_INPUT: "INVALID_INPUT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  TIMEOUT: "TIMEOUT",
  RATE_LIMITED: "RATE_LIMITED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  CONFLICT: "CONFLICT",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// =============================================================================
// Agent Activity States
// =============================================================================

/**
 * Fine-grained activity states for agent panes.
 * Matches ntm's ActivityState type.
 */
export type ActivityState =
  | "idle" // Waiting for input
  | "thinking" // Processing, showing spinner/animation
  | "working" // Actively writing code/output
  | "tool_calling" // Executing a tool
  | "waiting_input" // Blocked on user input
  | "error" // In error state
  | "stalled" // No activity for extended period
  | "rate_limited" // Hit provider rate limit
  | "context_low"; // Context window nearly exhausted

/**
 * Confidence level for state detection.
 * Higher values indicate more certain detection.
 */
export type ConfidenceLevel = number; // 0.0 to 1.0

// =============================================================================
// Work Indicators
// =============================================================================

/**
 * Patterns that matched during work detection.
 * Used for debugging and confidence assessment.
 */
export interface WorkIndicators {
  /** Patterns indicating active work */
  work: string[];

  /** Patterns indicating rate limiting */
  limit: string[];
}

// =============================================================================
// Health Grades
// =============================================================================

/**
 * Letter grades for health assessment.
 * A = excellent, F = critical
 */
export type HealthGrade = "A" | "B" | "C" | "D" | "F";

/**
 * Convert health score (0-100) to letter grade.
 */
export function scoreToGrade(score: number): HealthGrade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

// =============================================================================
// Recommendations
// =============================================================================

/**
 * Action recommendations for agent management.
 */
export type RecommendationAction =
  | "WAIT" // Agent is working, do not interrupt
  | "RESTART" // Agent is idle/stalled, safe to restart
  | "SEND_PROMPT" // Agent is ready for new work
  | "CHECK_RATE_LIMIT" // May be rate limited
  | "ROTATE_CONTEXT" // Context window low, rotate
  | "INVESTIGATE"; // Unusual state, needs investigation

// =============================================================================
// Provider Usage
// =============================================================================

/**
 * Rate window information from provider usage tracking.
 */
export interface RateWindowInfo {
  /** Percentage of rate limit used (0-100) */
  used_percent?: number;

  /** Window duration in minutes */
  window_minutes?: number;

  /** ISO8601 timestamp when window resets */
  resets_at?: string;

  /** Human-readable reset description */
  reset_description?: string;
}

/**
 * Provider operational status.
 */
export interface ProviderStatus {
  /** Whether provider API is operational */
  operational: boolean;

  /** Status message from provider */
  message?: string;
}

/**
 * Complete provider usage information.
 */
export interface ProviderUsageInfo {
  /** Provider name (anthropic, openai, google) */
  provider: string;

  /** Account identifier if available */
  account?: string;

  /** Data source (caut, api, cache) */
  source?: string;

  /** Primary rate window */
  primary_window?: RateWindowInfo;

  /** Provider operational status */
  status?: ProviderStatus;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new successful robot response.
 */
export function createRobotResponse(version: string): RobotResponse {
  return {
    success: true,
    timestamp: new Date().toISOString(),
    version,
  };
}

/**
 * Create a new error robot response.
 */
export function createErrorResponse(
  version: string,
  error: string,
  code: ErrorCode,
  hint?: string
): RobotResponse {
  return {
    success: false,
    timestamp: new Date().toISOString(),
    version,
    error,
    error_code: code,
    hint,
  };
}
