/**
 * CLI Command Logging Standards
 *
 * Provides standardized structured logging for CLI tool invocations.
 * All tool clients (br, bv, cass, cm, ntm, dcg, etc.) MUST use these
 * utilities to ensure consistent, auditable, and secure logging.
 *
 * Required fields for CLI command logs:
 * - tool: string       - Tool identifier (e.g., "br", "bv", "dcg")
 * - command: string    - Command name (e.g., "list", "ready", "triage")
 * - args: string[]     - Command arguments (redacted for sensitive data)
 * - latencyMs: number  - Execution time in milliseconds
 * - exitCode: number   - Process exit code
 * - correlationId: string - Request correlation ID for tracing
 *
 * Optional fields:
 * - stdout: string     - Truncated stdout (for debugging, max 500 chars)
 * - stderr: string     - Truncated stderr (for errors, max 500 chars)
 * - timedOut: boolean  - Whether the command timed out
 * - cwd: string        - Working directory (if non-default)
 *
 * Redaction rules:
 * - Args containing sensitive patterns are redacted
 * - Stdout/stderr are truncated to prevent log bloat
 * - Passwords, tokens, API keys are replaced with [REDACTED]
 */

import { getCorrelationId, getLogger } from "../middleware/correlation";
import { redactCommand, redactSensitive } from "./redaction";

// ============================================================================
// Types
// ============================================================================

/**
 * Standard fields for CLI command execution logging.
 */
export interface CliCommandLogFields {
  /** Tool identifier (e.g., "br", "bv", "dcg", "cass") */
  tool: string;
  /** Subcommand or action (e.g., "list", "ready", "triage") */
  command: string;
  /** Command arguments (will be redacted for sensitive data) */
  args: string[];
  /** Execution time in milliseconds */
  latencyMs: number;
  /** Process exit code */
  exitCode: number;
  /** Request correlation ID */
  correlationId: string;
  /** Truncated stdout (optional, for debugging) */
  stdout?: string;
  /** Truncated stderr (optional, for error context) */
  stderr?: string;
  /** Whether the command timed out */
  timedOut?: boolean;
  /** Working directory (optional, if non-default) */
  cwd?: string;
}

/**
 * Input for creating CLI command log fields.
 */
export interface CliCommandLogInput {
  tool: string;
  command: string;
  args: string[];
  latencyMs: number;
  exitCode: number;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  cwd?: string;
}

/**
 * Result-specific log fields for higher-level operations.
 */
export interface CliResultLogFields {
  /** Tool identifier */
  tool: string;
  /** High-level operation (e.g., "br ready", "bv --robot-triage") */
  operation: string;
  /** Result count (e.g., number of issues returned) */
  count?: number;
  /** Execution time in milliseconds */
  latencyMs: number;
  /** Request correlation ID */
  correlationId: string;
  /** Additional context-specific fields */
  [key: string]: unknown;
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum length for stdout/stderr in logs */
const MAX_OUTPUT_LOG_LENGTH = 500;

/** Patterns that indicate sensitive args (case-insensitive) */
const SENSITIVE_ARG_PATTERNS = [
  /^--?(?:password|passwd|secret|token|api[_-]?key|auth|key)=/i,
  /^--?(?:authorization|bearer|credentials)=/i,
];

// ============================================================================
// Utilities
// ============================================================================

/**
 * Redact sensitive arguments from a CLI command.
 * Replaces values of sensitive flags with [REDACTED].
 */
export function redactArgs(args: string[]): string[] {
  return args.map((arg) => {
    // Check if arg matches sensitive patterns
    for (const pattern of SENSITIVE_ARG_PATTERNS) {
      if (pattern.test(arg)) {
        const eqIndex = arg.indexOf("=");
        if (eqIndex > 0) {
          return `${arg.slice(0, eqIndex + 1)}[REDACTED]`;
        }
        return "[REDACTED]";
      }
    }
    // Apply general command redaction
    return redactCommand(arg);
  });
}

/**
 * Truncate output for logging.
 * Prevents log bloat from large command outputs.
 */
export function truncateOutput(
  output: string | undefined,
  maxLength = MAX_OUTPUT_LOG_LENGTH,
): string | undefined {
  if (!output) return undefined;
  if (output.length <= maxLength) return output;
  return `${output.slice(0, maxLength)}... [truncated, ${output.length} total bytes]`;
}

/**
 * Build standardized CLI command log fields.
 * Automatically includes correlation ID from request context.
 */
export function buildCliCommandLogFields(
  input: CliCommandLogInput,
): CliCommandLogFields {
  const fields: CliCommandLogFields = {
    tool: input.tool,
    command: input.command,
    args: redactArgs(input.args),
    latencyMs: input.latencyMs,
    exitCode: input.exitCode,
    correlationId: getCorrelationId(),
  };

  // Add optional fields only if present
  if (input.stdout) {
    const truncated = truncateOutput(input.stdout);
    if (truncated) fields.stdout = truncated;
  }
  if (input.stderr) {
    const truncated = truncateOutput(input.stderr);
    if (truncated) fields.stderr = truncated;
  }
  if (input.timedOut) {
    fields.timedOut = true;
  }
  if (input.cwd) {
    fields.cwd = input.cwd;
  }

  return fields;
}

/**
 * Build result log fields for higher-level operations.
 */
export function buildCliResultLogFields(
  tool: string,
  operation: string,
  latencyMs: number,
  extra?: Record<string, unknown>,
): CliResultLogFields {
  return {
    tool,
    operation,
    latencyMs,
    correlationId: getCorrelationId(),
    ...redactSensitive(extra ?? {}),
  };
}

// ============================================================================
// Logging Functions
// ============================================================================

/**
 * Log a CLI command execution at debug level.
 * Use this for low-level command execution details.
 */
export function logCliCommand(input: CliCommandLogInput, message: string): void {
  const log = getLogger();
  const fields = buildCliCommandLogFields(input);
  log.debug(fields, message);
}

/**
 * Log a CLI command completion at info level.
 * Use this for successful operation completions.
 */
export function logCliResult(
  tool: string,
  operation: string,
  latencyMs: number,
  message: string,
  extra?: Record<string, unknown>,
): void {
  const log = getLogger();
  const fields = buildCliResultLogFields(tool, operation, latencyMs, extra);
  log.info(fields, message);
}

/**
 * Log a CLI command warning (e.g., timeout, non-zero exit).
 */
export function logCliWarning(
  input: CliCommandLogInput,
  message: string,
): void {
  const log = getLogger();
  const fields = buildCliCommandLogFields(input);
  log.warn(fields, message);
}

/**
 * Log a CLI command error.
 */
export function logCliError(
  input: CliCommandLogInput,
  message: string,
  error?: Error,
): void {
  const log = getLogger();
  const fields = buildCliCommandLogFields(input);
  if (error) {
    log.error({ ...fields, error }, message);
  } else {
    log.error(fields, message);
  }
}

// ============================================================================
// Convenience Wrappers
// ============================================================================

/**
 * Create a scoped logger for a specific tool.
 * Returns functions pre-configured with the tool name.
 */
export function createToolLogger(tool: string) {
  return {
    /**
     * Log command execution at debug level.
     */
    command(
      command: string,
      args: string[],
      result: { exitCode: number; latencyMs: number; stdout?: string; stderr?: string; timedOut?: boolean },
      message: string,
    ): void {
      logCliCommand(
        {
          tool,
          command,
          args,
          ...result,
        },
        message,
      );
    },

    /**
     * Log successful operation at info level.
     */
    result(
      operation: string,
      latencyMs: number,
      message: string,
      extra?: Record<string, unknown>,
    ): void {
      logCliResult(tool, operation, latencyMs, message, extra);
    },

    /**
     * Log warning (timeout, unexpected exit code).
     */
    warning(
      command: string,
      args: string[],
      result: { exitCode: number; latencyMs: number; timedOut?: boolean },
      message: string,
    ): void {
      logCliWarning({ tool, command, args, ...result }, message);
    },

    /**
     * Log error.
     */
    error(
      command: string,
      args: string[],
      result: { exitCode: number; latencyMs: number; stderr?: string },
      message: string,
      error?: Error,
    ): void {
      logCliError({ tool, command, args, ...result }, message, error);
    },
  };
}
