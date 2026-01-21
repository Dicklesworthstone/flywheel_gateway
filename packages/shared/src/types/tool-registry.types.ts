/**
 * Shared Tool Registry Types
 *
 * Public-safe, minimal schema used by gateway + web to describe tools and agents.
 * Keep fields generic and avoid embedding private infrastructure details.
 */

export type ToolCategory = "agent" | "tool";

export type ToolTag = string;

export type InstallMode = "interactive" | "easy" | "manual";

export interface InstallSpec {
  /** Primary command to execute (e.g. "curl", "npm", "pip") */
  command: string;
  /** Arguments to pass to the command */
  args?: string[];
  /** Optional install URL for manual steps or scripts */
  url?: string;
  /** Optional mode hint for UI */
  mode?: InstallMode;
  /** Whether the install requires elevated privileges */
  requiresSudo?: boolean;
  /** Additional instructions for humans */
  notes?: string;
}

export interface VerificationSpec {
  /** Command to verify installation (e.g. ["tool", "--version"]) */
  command?: string[];
  /** Acceptable exit codes (defaults to [0] if omitted) */
  expectedExitCodes?: number[];
  /** Optional minimum version constraint */
  minVersion?: string;
  /** Regex string to extract a version from stdout */
  versionRegex?: string;
  /** Timeout override for verification */
  timeoutMs?: number;
}

export interface ToolDefinition {
  /** Stable identifier (e.g. "agents.claude", "tools.bv") */
  id: string;
  /** Short name used in detection/services (e.g. "claude", "bv") */
  name: string;
  /** Human-friendly display name */
  displayName?: string;
  /** Short description */
  description?: string;
  /** Tool category for UI grouping */
  category: ToolCategory;
  /** Optional tags such as "critical", "recommended" */
  tags?: ToolTag[];
  /** Whether the tool is optional */
  optional?: boolean;
  /** Whether enabled by default in a stack */
  enabledByDefault?: boolean;
  /** Documentation URL */
  docsUrl?: string;
  /** Installation steps */
  install?: InstallSpec[];
  /** Verification instructions */
  verify?: VerificationSpec;
  /** Checksums for install artifacts (public-safe) */
  checksums?: Record<string, string>;
}

export interface ToolRegistry {
  /** Schema version for compatibility */
  schemaVersion: string;
  /** Registry source (e.g. "acfs") */
  source?: string;
  /** When the registry was generated */
  generatedAt?: string;
  /** Tool definitions */
  tools: ToolDefinition[];
}
