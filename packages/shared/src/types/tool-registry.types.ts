/**
 * Shared Tool Registry Types
 *
 * Public-safe, minimal schema used by gateway + web to describe tools and agents.
 * Keep fields generic and avoid embedding private infrastructure details.
 */

export type ToolCategory = "agent" | "tool";

export type ToolTag = string;

export type ToolPriority = "required" | "recommended" | "optional";

export type InstallMode = "interactive" | "easy" | "manual";

export interface InstallSpec {
  /** Primary command to execute (e.g. "curl", "npm", "pip") */
  command: string;
  /** Arguments to pass to the command */
  args?: string[] | undefined;
  /** Optional install URL for manual steps or scripts */
  url?: string | undefined;
  /** Optional mode hint for UI */
  mode?: InstallMode | undefined;
  /** Whether the install requires elevated privileges */
  requiresSudo?: boolean | undefined;
  /** Additional instructions for humans */
  notes?: string | undefined;
}

export interface VerificationSpec {
  /** Command to verify installation (e.g. ["tool", "--version"]) */
  command?: string[] | undefined;
  /** Acceptable exit codes (defaults to [0] if omitted) */
  expectedExitCodes?: number[] | undefined;
  /** Optional minimum version constraint */
  minVersion?: string | undefined;
  /** Regex string to extract a version from stdout */
  versionRegex?: string | undefined;
  /** Timeout override for verification */
  timeoutMs?: number | undefined;
}

export type InstalledCheckRunAs = "root" | "user";

export interface InstalledCheckSpec {
  /** Command to check if tool is installed (e.g. ["command", "-v", "tool"]) */
  command: string[];
  /** Privilege context for execution */
  run_as?: InstalledCheckRunAs | undefined;
  /** Timeout for check execution in ms (default: 5000) */
  timeoutMs?: number | undefined;
  /** Max output bytes to capture (default: 4096) */
  outputCapBytes?: number | undefined;
}

/**
 * Verified installer specification from ACFS manifest.
 * Preferred over generic InstallSpec when present.
 * Contains only public-safe fields (no private paths).
 */
export interface VerifiedInstallerSpec {
  /** Install runner command (e.g. "curl", "bash", "npm") */
  runner: string;
  /** Arguments to pass to the runner */
  args?: string[] | undefined;
  /** Fallback URL for manual installation if automated fails */
  fallback_url?: string | undefined;
  /** Whether to run the installer in tmux (for interactive installs) */
  run_in_tmux?: boolean | undefined;
}

export interface ToolDefinition {
  /** Stable identifier (e.g. "agents.claude", "tools.bv") */
  id: string;
  /** Short name used in detection/services (e.g. "claude", "bv") */
  name: string;
  /** Human-friendly display name */
  displayName?: string | undefined;
  /** Short description */
  description?: string | undefined;
  /** Tool category for UI grouping */
  category: ToolCategory;
  /** Optional tags such as "critical", "recommended" */
  tags?: ToolTag[] | undefined;
  /** Whether the tool is optional */
  optional?: boolean | undefined;
  /** Whether enabled by default in a stack */
  enabledByDefault?: boolean | undefined;
  /** Installation phase/order (lower = earlier) */
  phase?: number | undefined;
  /** Documentation URL */
  docsUrl?: string | undefined;
  /** Installation steps */
  install?: InstallSpec[] | undefined;
  /** Verified installer from ACFS manifest (preferred over install) */
  verifiedInstaller?: VerifiedInstallerSpec | undefined;
  /** Verification instructions */
  verify?: VerificationSpec | undefined;
  /** Installed check instructions (for detection) */
  installedCheck?: InstalledCheckSpec | undefined;
  /** Checksums for install artifacts (public-safe) */
  checksums?: Record<string, string> | undefined;
}

export interface ToolRegistry {
  /** Schema version for compatibility */
  schemaVersion: string;
  /** Registry source (e.g. "acfs") */
  source?: string | undefined;
  /** When the registry was generated */
  generatedAt?: string | undefined;
  /** Tool definitions */
  tools: ToolDefinition[];
}
