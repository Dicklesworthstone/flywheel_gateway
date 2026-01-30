import type { ToolUnavailabilityReason } from "./tool-unavailability";
import { classifyToolUnavailability } from "./tool-unavailability";

export type CliErrorKind =
  | "command_failed"
  | "parse_error"
  | "validation_error"
  | "unavailable"
  | "timeout"
  | "not_installed";

export type CliErrorDetails = Record<string, unknown> & {
  tool?: string;
  command?: string;
  args?: string[];
  exitCode?: number;
  stderr?: string;
  stdout?: string;
  cause?: string;
  /** Canonical unavailability reason from the shared taxonomy. */
  unavailabilityReason?: ToolUnavailabilityReason;
};

export class CliClientError extends Error {
  readonly kind: CliErrorKind;
  readonly details?: CliErrorDetails;

  constructor(kind: CliErrorKind, message: string, details?: CliErrorDetails) {
    super(message);
    this.name = "CliClientError";
    this.kind = kind;
    if (details) {
      // Auto-classify unavailability reason when not explicitly provided
      if (!details.unavailabilityReason && (kind === "unavailable" || kind === "not_installed" || kind === "command_failed")) {
        details.unavailabilityReason = classifyToolUnavailability({
          ...(details.exitCode !== undefined
            ? { exitCode: details.exitCode }
            : {}),
          ...(details.stderr !== undefined ? { stderr: details.stderr } : {}),
          ...(details.stdout !== undefined ? { stdout: details.stdout } : {}),
          ...(details.cause !== undefined ? { error: details.cause } : {}),
        });
      }
      this.details = details;
    }
  }
}

export function isCliClientError(value: unknown): value is CliClientError {
  return value instanceof CliClientError;
}
