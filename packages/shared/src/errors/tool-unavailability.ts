/**
 * Unified Tool Unavailability Taxonomy
 *
 * Standardizes tool-unavailable errors across detection, health, and tool client
 * services. Provides a shared vocabulary for why a tool is unavailable, maps CLI
 * exit codes and stderr patterns to the taxonomy, and ensures consistent HTTP
 * codes and UI labels.
 */

// ============================================================================
// Taxonomy
// ============================================================================

/**
 * Canonical reasons a tool can be unavailable.
 * Ordered roughly from most to least common.
 */
export type ToolUnavailabilityReason =
  | "not_installed"
  | "not_in_path"
  | "permission_denied"
  | "version_unsupported"
  | "auth_required"
  | "auth_expired"
  | "config_missing"
  | "config_invalid"
  | "dependency_missing"
  | "mcp_unreachable"
  | "spawn_failed"
  | "timeout"
  | "crash"
  | "unknown";

/**
 * Metadata for each unavailability reason: HTTP status, UI label, and
 * whether the issue is likely transient (retryable).
 */
export interface UnavailabilityMeta {
  httpStatus: number;
  label: string;
  retryable: boolean;
}

export const UNAVAILABILITY_META: Record<
  ToolUnavailabilityReason,
  UnavailabilityMeta
> = {
  not_installed: { httpStatus: 404, label: "Not Installed", retryable: false },
  not_in_path: { httpStatus: 404, label: "Not in PATH", retryable: false },
  permission_denied: {
    httpStatus: 403,
    label: "Permission Denied",
    retryable: false,
  },
  version_unsupported: {
    httpStatus: 422,
    label: "Version Unsupported",
    retryable: false,
  },
  auth_required: { httpStatus: 401, label: "Auth Required", retryable: false },
  auth_expired: { httpStatus: 401, label: "Auth Expired", retryable: false },
  config_missing: {
    httpStatus: 404,
    label: "Config Missing",
    retryable: false,
  },
  config_invalid: {
    httpStatus: 422,
    label: "Config Invalid",
    retryable: false,
  },
  dependency_missing: {
    httpStatus: 424,
    label: "Dependency Missing",
    retryable: false,
  },
  mcp_unreachable: {
    httpStatus: 503,
    label: "MCP Unreachable",
    retryable: true,
  },
  spawn_failed: { httpStatus: 500, label: "Spawn Failed", retryable: true },
  timeout: { httpStatus: 408, label: "Timeout", retryable: true },
  crash: { httpStatus: 500, label: "Crashed", retryable: true },
  unknown: { httpStatus: 500, label: "Unknown Error", retryable: true },
};

// ============================================================================
// Classifier
// ============================================================================

export interface ClassificationInput {
  exitCode?: number;
  stderr?: string;
  stdout?: string;
  error?: Error | string;
}

/**
 * Lowercase stderr patterns mapped to unavailability reasons.
 * Order matters — first match wins.
 */
const STDERR_PATTERNS: Array<[RegExp, ToolUnavailabilityReason]> = [
  // Permission
  [/permission denied/i, "permission_denied"],
  [/eacces/i, "permission_denied"],
  [/operation not permitted/i, "permission_denied"],

  // Auth
  [/not logged in/i, "auth_required"],
  [/not authenticated/i, "auth_required"],
  [/unauthorized/i, "auth_required"],
  [/no api key/i, "auth_required"],
  [/missing credentials/i, "auth_required"],
  [/invalid.*token/i, "auth_expired"],
  [/token.*expired/i, "auth_expired"],
  [/authentication.*expired/i, "auth_expired"],

  // Config (before generic "not found" to avoid false matches)
  [/config.*not found/i, "config_missing"],
  [/missing.*config/i, "config_missing"],
  [/no configuration/i, "config_missing"],
  [/invalid.*config/i, "config_invalid"],
  [/configuration.*error/i, "config_invalid"],

  // Not installed / not found
  [/command not found/i, "not_installed"],
  [/not found/i, "not_installed"],
  [/no such file or directory/i, "not_installed"],
  [/is not recognized/i, "not_installed"], // Windows
  [/not installed/i, "not_installed"],

  // Version
  [/unsupported version/i, "version_unsupported"],
  [/version.*not supported/i, "version_unsupported"],
  [/requires.*version/i, "version_unsupported"],
  [/minimum.*version/i, "version_unsupported"],
  [/upgrade required/i, "version_unsupported"],

  // Dependencies
  [/missing.*dependency/i, "dependency_missing"],
  [/requires.*installed/i, "dependency_missing"],
  [/prerequisite.*not met/i, "dependency_missing"],

  // MCP
  [/mcp.*unreachable/i, "mcp_unreachable"],
  [/mcp.*connection.*refused/i, "mcp_unreachable"],
  [/mcp.*connection.*failed/i, "mcp_unreachable"],
  [/econnrefused/i, "mcp_unreachable"],

  // Crash
  [/segfault/i, "crash"],
  [/segmentation fault/i, "crash"],
  [/fatal error/i, "crash"],
  [/panic/i, "crash"],
  [/core dumped/i, "crash"],
  [/aborted/i, "crash"],
];

/**
 * Map known CLI exit codes to unavailability reasons.
 * Many tools use these conventions:
 *   1  = general error
 *   2  = misuse / unavailable
 *   126 = permission denied (cannot execute)
 *   127 = command not found
 *   128+N = killed by signal N
 */
const EXIT_CODE_MAP: Record<number, ToolUnavailabilityReason> = {
  126: "permission_denied",
  127: "not_installed",
  // Signal-based exits
  134: "crash", // SIGABRT
  139: "crash", // SIGSEGV
};

/**
 * Classify a tool error into a canonical unavailability reason.
 *
 * Priority:
 *   1. stderr pattern match (most specific)
 *   2. Exit code mapping
 *   3. Error message pattern match
 *   4. Fallback to "unknown"
 */
export function classifyToolUnavailability(
  input: ClassificationInput,
): ToolUnavailabilityReason {
  const stderr = input.stderr ?? "";
  const errorMsg =
    typeof input.error === "string"
      ? input.error
      : (input.error?.message ?? "");
  const combined = `${stderr} ${errorMsg}`;

  // 1. Check stderr + error message patterns
  for (const [pattern, reason] of STDERR_PATTERNS) {
    if (pattern.test(combined)) {
      return reason;
    }
  }

  // 2. Check exit code
  if (input.exitCode != null && input.exitCode in EXIT_CODE_MAP) {
    return EXIT_CODE_MAP[input.exitCode]!;
  }

  // 3. Exit code 2 often means "unavailable" in many CLI tools
  if (input.exitCode === 2) {
    return "not_installed";
  }

  return "unknown";
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get the HTTP status code for a tool unavailability reason.
 */
export function getUnavailabilityHttpStatus(
  reason: ToolUnavailabilityReason,
): number {
  return UNAVAILABILITY_META[reason].httpStatus;
}

/**
 * Get the UI display label for a tool unavailability reason.
 */
export function getUnavailabilityLabel(
  reason: ToolUnavailabilityReason,
): string {
  return UNAVAILABILITY_META[reason].label;
}

/**
 * Whether the unavailability is potentially transient and worth retrying.
 */
export function isRetryableUnavailability(
  reason: ToolUnavailabilityReason,
): boolean {
  return UNAVAILABILITY_META[reason].retryable;
}

/**
 * All valid unavailability reason values.
 */
export const UNAVAILABILITY_REASONS: ToolUnavailabilityReason[] = Object.keys(
  UNAVAILABILITY_META,
) as ToolUnavailabilityReason[];
