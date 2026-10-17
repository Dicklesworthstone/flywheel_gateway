import { describe, expect, test } from "bun:test";
import type { ErrorCode } from "../codes";
import {
  AI_HINTS,
  createConflictError,
  createGatewayError,
  createNotFoundError,
  createRateLimitError,
  createValidationError,
  DEFAULT_ERROR_MESSAGES,
  ERROR_CODE_LIST,
  fromCode,
  HTTP_STATUS_MAP,
} from "../index";

function expectAllCodesCovered<T extends Record<string, unknown>>(record: T) {
  const keys = Object.keys(record);
  expect(keys.length).toBe(ERROR_CODE_LIST.length);
}

describe("error code registry", () => {
  test("error codes are unique", () => {
    const unique = new Set(ERROR_CODE_LIST);
    expect(unique.size).toBe(ERROR_CODE_LIST.length);
  });

  test("HTTP status mapping covers all error codes", () => {
    expectAllCodesCovered(HTTP_STATUS_MAP);
  });

  test("AI hints cover all error codes", () => {
    expectAllCodesCovered(AI_HINTS);
  });
});

describe("GatewayError factory", () => {
  const code: ErrorCode = "AGENT_NOT_FOUND";

  test("createGatewayError populates required fields", () => {
    const err = createGatewayError(code, "Agent missing", {
      context: { correlationId: "corr-123" },
    });

    expect(err.code).toBe(code);
    expect(err.message).toBe("Agent missing");
    expect(err.httpStatus).toBe(HTTP_STATUS_MAP[code]);
    expect(err.aiHint).toEqual(AI_HINTS[code]);
    expect(err.context?.correlationId).toBe("corr-123");
    expect(err.context?.timestamp).toBeTruthy();
  });

  test("fromCode uses default message", () => {
    const err = fromCode(code);
    expect(err.message).toBe(DEFAULT_ERROR_MESSAGES[code]);
  });

  test("createValidationError includes field details", () => {
    const err = createValidationError("INVALID_REQUEST", [
      { path: "input.model", message: "Required" },
    ]);

    expect(err.details?.["validation"]).toEqual({
      fields: [{ path: "input.model", message: "Required" }],
    });
  });

  test("createNotFoundError includes resource details", () => {
    const err = createNotFoundError("AGENT_NOT_FOUND", "agent", "agent-123");
    expect(err.details?.["resourceType"]).toBe("agent");
    expect(err.details?.["resourceId"]).toBe("agent-123");
  });

  test("createConflictError includes conflict details", () => {
    const err = createConflictError(
      "AGENT_ALREADY_EXISTS",
      "agent",
      "agent-999",
    );
    expect(err.details?.["resourceType"]).toBe("agent");
    expect(err.details?.["conflictingResourceId"]).toBe("agent-999");
  });

  test("createRateLimitError sets retry hint", () => {
    const err = createRateLimitError("RATE_LIMIT_EXCEEDED", 5000);
    expect(err.aiHint.retryAfterMs).toBe(5000);
    expect(err.details?.["retryAfterMs"]).toBe(5000);
  });
});
