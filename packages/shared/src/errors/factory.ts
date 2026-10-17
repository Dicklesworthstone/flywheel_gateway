import { AI_HINTS } from "./ai-hints";
import type { ErrorCode } from "./codes";
import { DEFAULT_ERROR_MESSAGES, getHttpStatus } from "./codes";
import type {
  AIHint,
  ErrorContext,
  ErrorContextInput,
  GatewayErrorOptions,
  ValidationErrorDetails,
  ValidationFieldError,
} from "./types";

export class GatewayError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly aiHint: AIHint;
  readonly context?: ErrorContext;
  readonly details?: Record<string, unknown>;
  override cause?: unknown;

  constructor(code: ErrorCode, message: string, options?: GatewayErrorOptions) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.httpStatus = options?.httpStatus ?? getHttpStatus(code);
    this.aiHint = options?.aiHint ?? AI_HINTS[code];

    const context = normalizeContext(options?.context);
    if (context) {
      this.context = context;
    }

    if (options?.details) {
      this.details = options.details;
    }

    if (options && "cause" in options) {
      this.cause = options.cause;
    }
  }
}

/** Create a GatewayError with explicit message and options. */
export function createGatewayError(
  code: ErrorCode,
  message: string,
  options?: GatewayErrorOptions,
): GatewayError {
  return new GatewayError(code, message, options);
}

/** Create a GatewayError using the default message for the code. */
export function fromCode(
  code: ErrorCode,
  options?: GatewayErrorOptions,
): GatewayError {
  return new GatewayError(code, DEFAULT_ERROR_MESSAGES[code], options);
}

/** Create a validation error with field-level details. */
export function createValidationError(
  code: ErrorCode,
  fields: ValidationFieldError[],
  options?: GatewayErrorOptions,
): GatewayError {
  const details: ValidationErrorDetails = { fields };
  return new GatewayError(code, DEFAULT_ERROR_MESSAGES[code], {
    ...options,
    details: {
      ...(options?.details ?? {}),
      validation: details,
    },
  });
}

/** Create a not-found error for a specific resource. */
export function createNotFoundError(
  code: ErrorCode,
  resourceType: string,
  resourceId?: string,
  options?: GatewayErrorOptions,
): GatewayError {
  return new GatewayError(code, DEFAULT_ERROR_MESSAGES[code], {
    ...options,
    details: {
      ...(options?.details ?? {}),
      resourceType,
      resourceId,
    },
  });
}

/** Create a conflict error for a specific resource. */
export function createConflictError(
  code: ErrorCode,
  resourceType: string,
  conflictingResourceId?: string,
  options?: GatewayErrorOptions,
): GatewayError {
  return new GatewayError(code, DEFAULT_ERROR_MESSAGES[code], {
    ...options,
    details: {
      ...(options?.details ?? {}),
      resourceType,
      conflictingResourceId,
    },
  });
}

/** Create a rate-limit error with optional retry-after hint. */
export function createRateLimitError(
  code: ErrorCode,
  retryAfterMs?: number,
  options?: GatewayErrorOptions,
): GatewayError {
  const baseHint = AI_HINTS[code];
  const finalRetryAfterMs = retryAfterMs ?? baseHint.retryAfterMs;

  // Build hint without optional undefined values to satisfy exactOptionalPropertyTypes
  const aiHint: AIHint = {
    severity: baseHint.severity,
    suggestedAction: baseHint.suggestedAction,
  };
  if (finalRetryAfterMs !== undefined) {
    aiHint.retryAfterMs = finalRetryAfterMs;
  }
  if (baseHint.alternativeApproach !== undefined) {
    aiHint.alternativeApproach = baseHint.alternativeApproach;
  }

  return new GatewayError(code, DEFAULT_ERROR_MESSAGES[code], {
    ...options,
    aiHint,
    details: {
      ...(options?.details ?? {}),
      retryAfterMs,
    },
  });
}

function normalizeContext(input?: ErrorContextInput): ErrorContext | undefined {
  if (!input) {
    return undefined;
  }
  return {
    ...input,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}
