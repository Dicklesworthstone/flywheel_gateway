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
};

export class CliClientError extends Error {
  readonly kind: CliErrorKind;
  readonly details?: CliErrorDetails;

  constructor(kind: CliErrorKind, message: string, details?: CliErrorDetails) {
    super(message);
    this.name = "CliClientError";
    this.kind = kind;
    if (details) {
      this.details = details;
    }
  }
}

export function isCliClientError(value: unknown): value is CliClientError {
  return value instanceof CliClientError;
}
