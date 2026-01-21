/**
 * Reference: NTM Smart Restart
 *
 * Safe restart mechanism that respects "NEVER interrupt agents doing useful work!!!"
 * Adapted from ntm/internal/robot/smart_restart.go
 *
 * Unlike a naive restart that blindly kills and relaunches, smart-restart:
 * 1. Checks first - Calls is-working before any action
 * 2. Refuses if working - Returns SKIPPED, does NOT interrupt
 * 3. Handles rate limits - Knows to wait rather than immediately restart
 * 4. Verifies success - Confirms new agent actually launched
 */

import type { RobotResponse, ConfidenceLevel } from "./types";
import type { AgentWorkStatus } from "./is-working";

// =============================================================================
// Restart Action Types
// =============================================================================

/**
 * Possible actions taken (or not taken) for a restart request.
 */
export type RestartActionType =
  | "RESTARTED" // Agent was successfully restarted
  | "SKIPPED" // Restart was skipped (agent working)
  | "WAITING" // Agent is rate-limited, should wait
  | "FAILED" // Restart attempt failed
  | "WOULD_RESTART"; // Dry-run: would restart if not dry-run

// =============================================================================
// Smart Restart Types
// =============================================================================

/**
 * Options for smart restart.
 */
export interface SmartRestartOptions {
  /** Agent/session identifier */
  agentId: string;

  /** Force restart even if working (dangerous!) */
  force?: boolean;

  /** Dry-run mode - show what would happen */
  dryRun?: boolean;

  /** Optional prompt to send after restart */
  prompt?: string;

  /** Lines to capture for pre-check */
  linesCaptured?: number;

  /** Include extra debugging info */
  verbose?: boolean;

  /** Time to wait after launch before verification (ms) */
  postWaitTime?: number;
}

/**
 * Default options for smart restart.
 */
export const defaultSmartRestartOptions: Required<
  Omit<SmartRestartOptions, "agentId" | "prompt">
> = {
  force: false,
  dryRun: false,
  linesCaptured: 100,
  verbose: false,
  postWaitTime: 6000,
};

/**
 * Pre-restart state assessment.
 */
export interface PreCheckInfo {
  /** Recommended action from is-working check */
  recommendation: string;

  /** Whether agent is actively working */
  is_working: boolean;

  /** Whether agent is idle */
  is_idle: boolean;

  /** Whether agent is rate limited */
  is_rate_limited: boolean;

  /** Whether context is low */
  is_context_low: boolean;

  /** Remaining context if available */
  context_remaining?: number;

  /** Confidence in assessment */
  confidence: ConfidenceLevel;

  /** Detected agent type */
  agent_type: string;
}

/**
 * Restart execution sequence details.
 */
export interface RestartSequence {
  /** Method used to exit the agent */
  exit_method: string;

  /** Time taken to exit (ms) */
  exit_duration_ms: number;

  /** Whether shell prompt was confirmed */
  shell_confirmed: boolean;

  /** Whether new agent was launched */
  agent_launched: boolean;

  /** Type of new agent */
  agent_type: string;

  /** Whether prompt was sent */
  prompt_sent?: boolean;
}

/**
 * Post-restart verification.
 */
export interface PostStateInfo {
  /** Whether agent is running */
  agent_running: boolean;

  /** Type of agent detected */
  agent_type: string;

  /** Confidence in detection */
  confidence: ConfidenceLevel;
}

/**
 * Information about rate-limit waiting.
 */
export interface WaitInfo {
  /** When rate limit resets */
  resets_at?: string;

  /** Seconds to wait */
  wait_seconds?: number;

  /** Human-readable suggestion */
  suggestion?: string;
}

/**
 * Action taken for a single agent.
 */
export interface RestartAction {
  /** Action type */
  action: RestartActionType;

  /** Reason for the action */
  reason: string;

  /** Warning message if applicable */
  warning?: string;

  /** Pre-restart check results */
  pre_check?: PreCheckInfo;

  /** Restart sequence details (if restarted) */
  restart_sequence?: RestartSequence;

  /** Post-restart verification (if restarted) */
  post_state?: PostStateInfo;

  /** Wait information (if waiting) */
  wait_info?: WaitInfo;

  /** Error message if failed */
  error?: string;
}

/**
 * Summary of restart actions across agents.
 */
export interface RestartSummary {
  /** Number successfully restarted */
  restarted: number;

  /** Number skipped (working) */
  skipped: number;

  /** Number waiting (rate limited) */
  waiting: number;

  /** Number failed */
  failed: number;

  /** Number that would restart (dry-run) */
  would_restart?: number;

  /** Agents grouped by action */
  agents_by_action: Record<RestartActionType, string[]>;
}

/**
 * Complete response for smart restart.
 */
export interface SmartRestartOutput extends RobotResponse {
  /** Timestamp of the operation */
  timestamp: string;

  /** Whether this was a dry run */
  dry_run: boolean;

  /** Whether force mode was used */
  force: boolean;

  /** Actions taken per agent */
  actions: Record<string, RestartAction>;

  /** Summary of all actions */
  summary: RestartSummary;
}

// =============================================================================
// Smart Restart Logic
// =============================================================================

/**
 * Determine restart action based on pre-check state.
 */
export function determineRestartAction(
  preCheck: PreCheckInfo,
  options: { force?: boolean; dryRun?: boolean }
): RestartAction {
  // Force mode - restart regardless (with warning)
  if (options.force) {
    const action: RestartAction = {
      action: options.dryRun ? "WOULD_RESTART" : "RESTARTED",
      reason: "Force mode enabled",
    };

    if (preCheck.is_working) {
      action.warning = `FORCED restart of working agent (confidence: ${(preCheck.confidence * 100).toFixed(0)}%)`;
    }

    action.pre_check = preCheck;
    return action;
  }

  // CORE PRINCIPLE: Never interrupt working agents
  if (preCheck.is_working && preCheck.confidence > 0.5) {
    return {
      action: "SKIPPED",
      reason: `Agent is actively working (confidence: ${(preCheck.confidence * 100).toFixed(0)}%)`,
      pre_check: preCheck,
    };
  }

  // Rate limited - wait rather than restart
  if (preCheck.is_rate_limited) {
    return {
      action: "WAITING",
      reason: "Agent is rate limited - wait for reset",
      pre_check: preCheck,
      wait_info: {
        suggestion: "Wait for rate limit to reset before restarting",
      },
    };
  }

  // Safe to restart
  return {
    action: options.dryRun ? "WOULD_RESTART" : "RESTARTED",
    reason: preCheck.is_idle
      ? "Agent is idle, safe to restart"
      : "Agent appears stalled, restarting",
    pre_check: preCheck,
  };
}

/**
 * Calculate summary from individual actions.
 */
export function calculateRestartSummary(
  actions: Record<string, RestartAction>
): RestartSummary {
  const agentsByAction: Record<RestartActionType, string[]> = {
    RESTARTED: [],
    SKIPPED: [],
    WAITING: [],
    FAILED: [],
    WOULD_RESTART: [],
  };

  for (const [agentId, action] of Object.entries(actions)) {
    agentsByAction[action.action].push(agentId);
  }

  const summary: RestartSummary = {
    restarted: agentsByAction.RESTARTED.length,
    skipped: agentsByAction.SKIPPED.length,
    waiting: agentsByAction.WAITING.length,
    failed: agentsByAction.FAILED.length,
    agents_by_action: agentsByAction,
  };

  // Only include would_restart if non-zero (for exactOptionalPropertyTypes)
  if (agentsByAction.WOULD_RESTART.length > 0) {
    summary.would_restart = agentsByAction.WOULD_RESTART.length;
  }

  return summary;
}

// =============================================================================
// Exit Sequences
// =============================================================================

/**
 * Agent-specific exit key sequences.
 * These are the safest ways to exit each agent type.
 */
export const EXIT_SEQUENCES: Record<
  string,
  { keys: string[]; description: string }
> = {
  "claude-code": {
    keys: ["Escape", "Escape", "/exit", "Enter"],
    description: "Double-escape to cancel, /exit command",
  },
  codex: {
    keys: ["Ctrl+C", "Ctrl+D"],
    description: "Interrupt then exit",
  },
  gemini: {
    keys: ["Ctrl+C", "/quit", "Enter"],
    description: "Interrupt then /quit command",
  },
  default: {
    keys: ["Ctrl+C", "Ctrl+C", "Ctrl+D"],
    description: "Double interrupt then exit",
  },
};

/**
 * Get exit sequence for agent type.
 */
export function getExitSequence(
  agentType: string,
): { keys: string[]; description: string } {
  const sequence = EXIT_SEQUENCES[agentType] ?? EXIT_SEQUENCES["default"];
  if (!sequence) {
    // Fallback if no default found
    return { keys: ["Ctrl+C"], description: "Interrupt" };
  }
  return sequence;
}
