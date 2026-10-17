import { AI_HINTS } from "./ai-hints";
import type { ErrorCode } from "./codes";
import { DEFAULT_ERROR_MESSAGES } from "./codes";
import { GatewayError } from "./factory";
import type { GatewayErrorPayload } from "./types";

/** Returns true if the value is a GatewayError instance. */
export function isGatewayError(value: unknown): value is GatewayError {
  return value instanceof GatewayError;
}

/**
 * Serialize a GatewayError into a plain JSON payload.
 */
export function serializeGatewayError(
  error: GatewayError,
): GatewayErrorPayload {
  const payload: GatewayErrorPayload = {
    code: error.code,
    message: error.message,
    httpStatus: error.httpStatus,
    aiHint: error.aiHint,
  };
  if (error.context !== undefined) {
    payload.context = error.context;
  }
  if (error.details !== undefined) {
    payload.details = error.details;
  }
  return payload;
}

/**
 * Deserialize a payload into a GatewayError instance.
 */
export function deserializeGatewayError(
  payload: GatewayErrorPayload,
): GatewayError {
  const options: {
    httpStatus: number;
    aiHint: typeof payload.aiHint;
    context?: typeof payload.context;
    details?: typeof payload.details;
  } = {
    httpStatus: payload.httpStatus,
    aiHint: payload.aiHint,
  };
  if (payload.context !== undefined) {
    options.context = payload.context;
  }
  if (payload.details !== undefined) {
    options.details = payload.details;
  }
  return new GatewayError(payload.code, payload.message, options);
}

/**
 * Normalize unknown errors into a GatewayError.
 */
export function toGatewayError(
  error: unknown,
  fallbackCode: ErrorCode = "SYSTEM_INTERNAL_ERROR",
): GatewayError {
  if (error instanceof GatewayError) {
    return error;
  }
  if (error instanceof Error) {
    return new GatewayError(fallbackCode, error.message, {
      cause: error,
      aiHint: AI_HINTS[fallbackCode],
    });
  }
  return new GatewayError(
    fallbackCode,
    DEFAULT_ERROR_MESSAGES[fallbackCode] ?? "Unexpected error",
    { cause: error, aiHint: AI_HINTS[fallbackCode] },
  );
}
