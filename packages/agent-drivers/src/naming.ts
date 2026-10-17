/**
 * Naming Utilities - Deterministic naming for agent sessions.
 *
 * Provides deterministic, user-friendly naming for NTM sessions and panes
 * that enables end-to-end tracing between Gateway and execution backends.
 *
 * ## Naming Scheme
 *
 * Session names follow the pattern: `fw-<project>-<agent>-<hash6>`
 *
 * Where:
 * - `fw` prefix identifies Flywheel-managed sessions
 * - `<project>` is derived from the working directory (max 16 chars)
 * - `<agent>` is the agent name or provider (max 12 chars)
 * - `<hash6>` is a 6-character deterministic hash from agent ID + config
 *
 * Example: `fw-gateway-claude-x7k3mq`
 *
 * ## Pane Naming
 *
 * Panes follow NTM convention: `<session>:<window>.<pane>`
 * The first agent uses `<session>:0.0`
 *
 * ## End-to-End Tracing
 *
 * | Gateway Field | NTM Field | Mapping |
 * |---------------|-----------|---------|
 * | agent.id | - | Full agent ID (agent_xxx_hash) |
 * | agent.config.name | session name | Via naming function |
 * | agent.config.workingDirectory | session cwd | Passed to NTM |
 * | agent.config.provider | - | Part of session name |
 *
 * To trace an agent:
 * 1. Gateway logs include `agentId` and `sessionName`
 * 2. NTM logs include session name
 * 3. The hash suffix is deterministic from agent ID
 */

import type { AgentConfig } from "./types";

/**
 * Characters used for the deterministic hash suffix.
 * Lowercase + digits for tmux-friendly names.
 */
const HASH_CHARSET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Generate a deterministic hash string from input.
 * Uses a simple FNV-1a-like algorithm for fast, consistent hashing.
 */
function deterministicHash(input: string, length: number): string {
  // FNV-1a hash constants for 32-bit
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  // Convert to positive number and map to charset
  hash = hash >>> 0; // Convert to unsigned 32-bit
  let result = "";
  const charsetLen = HASH_CHARSET.length;

  for (let i = 0; i < length; i++) {
    result += HASH_CHARSET[hash % charsetLen];
    hash = Math.floor(hash / charsetLen);
    // Add more entropy by mixing in position
    if (hash === 0) {
      hash = 2166136261 ^ (i * 31);
    }
  }

  return result;
}

/**
 * Sanitize a string for use in tmux session names.
 * Removes/replaces characters that are problematic in tmux.
 */
function sanitizeForTmux(input: string, maxLength: number): string {
  return (
    input
      // Replace path separators and common special chars with hyphen
      .replace(/[/\\:@#$%^&*()+=[\]{}|;'"<>,?!`~]/g, "-")
      // Collapse multiple hyphens
      .replace(/-+/g, "-")
      // Remove leading/trailing hyphens
      .replace(/^-|-$/g, "")
      // Convert to lowercase
      .toLowerCase()
      // Truncate to max length
      .slice(0, maxLength)
      // Ensure we don't end with a partial word (cut at hyphen if possible)
      .replace(/-[^-]{0,2}$/, "")
  );
}

/**
 * Extract project name from a working directory path.
 *
 * Examples:
 * - /home/user/projects/flywheel_gateway → flywheel-gateway
 * - /dp/flywheel_gateway → flywheel-gateway
 * - /Users/dev/code/my-project → my-project
 */
export function extractProjectName(workingDirectory: string): string {
  // Get the last non-empty path segment
  const segments = workingDirectory.split(/[/\\]/).filter((s) => s.length > 0);
  const lastSegment = segments[segments.length - 1] ?? "project";

  // Sanitize and limit length
  return sanitizeForTmux(lastSegment, 16);
}

/**
 * Generate a deterministic agent suffix from an agent's unique ID.
 *
 * The suffix is:
 * - Deterministic: same ID always produces same suffix
 * - Collision-resistant: different IDs produce different suffixes
 * - Short: 6 characters for readability
 */
export function generateAgentSuffix(agentId: string): string {
  return deterministicHash(agentId, 6);
}

/**
 * Options for generating an NTM session name.
 */
export interface NtmSessionNameOptions {
  /** The agent configuration */
  config: AgentConfig;
  /** Override the project name (otherwise derived from workingDirectory) */
  projectName?: string;
}

/**
 * Generate a deterministic NTM session name from agent configuration.
 *
 * The session name is designed to be:
 * - Deterministic: same config always produces same name
 * - User-friendly: includes project and agent context
 * - Unique: hash suffix prevents collisions
 * - Traceable: can be correlated with Gateway logs
 *
 * @example
 * ```typescript
 * const sessionName = generateNtmSessionName({
 *   config: {
 *     id: "agent_12345_abc123",
 *     name: "TaskRunner",
 *     provider: "claude",
 *     model: "claude-opus-4",
 *     workingDirectory: "/dp/flywheel_gateway"
 *   }
 * });
 * // Returns: "fw-flywheel-gateway-taskrunner-x7k3mq"
 * ```
 */
export function generateNtmSessionName(options: NtmSessionNameOptions): string {
  const { config, projectName } = options;

  // Derive project name from working directory if not provided
  const project = projectName ?? extractProjectName(config.workingDirectory);

  // Use agent name if provided, otherwise use provider
  const agentLabel = config.name
    ? sanitizeForTmux(config.name, 12)
    : config.provider;

  // Generate deterministic suffix from agent ID
  const suffix = generateAgentSuffix(config.id);

  // Combine into session name
  // Format: fw-<project>-<agent>-<hash6>
  return `fw-${project}-${agentLabel}-${suffix}`;
}

/**
 * Generate the primary pane ID for an NTM session.
 *
 * For single-agent sessions, this returns the first pane: `<session>:0.0`
 */
export function generateNtmPaneId(sessionName: string): string {
  return `${sessionName}:0.0`;
}

/**
 * Parse an NTM session name to extract components.
 *
 * @returns Parsed components or null if not a valid Flywheel session name
 */
export function parseNtmSessionName(sessionName: string): {
  project: string;
  agent: string;
  suffix: string;
} | null {
  // Expected format: fw-<project>-<agent>-<suffix>
  const match = sessionName.match(/^fw-(.+)-([a-z0-9]+)-([a-z0-9]{6})$/);
  if (!match) return null;

  // The middle parts (project-agent) need to be split
  // We know the suffix is 6 chars at the end, so work backwards
  const parts = sessionName.slice(3).split("-"); // Remove "fw-" prefix
  if (parts.length < 3) return null;

  const suffix = parts[parts.length - 1]!;
  const agent = parts[parts.length - 2]!;
  const project = parts.slice(0, -2).join("-");

  return { project, agent, suffix };
}

/**
 * Mapping entry for end-to-end tracing documentation.
 */
export interface AgentNtmMapping {
  /** Gateway agent ID */
  agentId: string;
  /** NTM session name */
  sessionName: string;
  /** NTM pane ID */
  paneId: string;
  /** Project name */
  project: string;
  /** Agent label (name or provider) */
  agentLabel: string;
  /** Deterministic suffix */
  suffix: string;
}

/**
 * Create a complete mapping entry for an agent.
 *
 * This is useful for logging and debugging to show the full
 * correlation between Gateway and NTM identifiers.
 */
export function createAgentNtmMapping(config: AgentConfig): AgentNtmMapping {
  const sessionName = generateNtmSessionName({ config });
  const paneId = generateNtmPaneId(sessionName);
  const parsed = parseNtmSessionName(sessionName);

  return {
    agentId: config.id,
    sessionName,
    paneId,
    project: parsed?.project ?? extractProjectName(config.workingDirectory),
    agentLabel: parsed?.agent ?? config.name ?? config.provider,
    suffix: parsed?.suffix ?? generateAgentSuffix(config.id),
  };
}
