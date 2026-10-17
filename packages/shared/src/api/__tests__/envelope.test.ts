/**
 * Tests for API Response Envelope Types.
 */

import { describe, expect, it } from "bun:test";
import {
  type ApiErrorResponse,
  type ApiListResponse,
  type ApiResponse,
  deriveErrorCategory,
  type ErrorCategory,
  isApiErrorResponse,
  isApiListResponse,
  isApiResponse,
  isSuccessResponse,
  ObjectTypes,
} from "../envelope";

describe("ObjectTypes", () => {
  it("should have all expected object types", () => {
    expect(ObjectTypes.AGENT).toBe("agent");
    expect(ObjectTypes.CHECKPOINT).toBe("checkpoint");
    expect(ObjectTypes.RESERVATION).toBe("reservation");
    expect(ObjectTypes.LIST).toBe("list");
    expect(ObjectTypes.ERROR).toBe("error");
  });

  it("should be readonly/const", () => {
    // TypeScript would prevent reassignment, but we can verify values exist
    expect(Object.keys(ObjectTypes).length).toBeGreaterThan(10);
  });
});

describe("isApiResponse", () => {
  it("should return true for valid single resource response", () => {
    const response: ApiResponse<{ id: string }> = {
      object: "agent",
      data: { id: "agent_123" },
      requestId: "req_abc123",
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    expect(isApiResponse(response)).toBe(true);
  });

  it("should return true for response with links", () => {
    const response: ApiResponse<{ id: string }> = {
      object: "checkpoint",
      data: { id: "cp_123" },
      requestId: "req_abc123",
      timestamp: "2024-01-15T10:30:00.000Z",
      links: {
        self: "/checkpoints/cp_123",
        agent: "/agents/agent_123",
      },
    };
    expect(isApiResponse(response)).toBe(true);
  });

  it("should return false for list response", () => {
    const listResponse = {
      object: "list",
      data: [],
      hasMore: false,
      url: "/agents",
      requestId: "req_abc123",
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    expect(isApiResponse(listResponse)).toBe(false);
  });

  it("should return false for error response", () => {
    const errorResponse = {
      object: "error",
      error: { code: "TEST", message: "test" },
      requestId: "req_abc123",
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    expect(isApiResponse(errorResponse)).toBe(false);
  });

  it("should return false for null", () => {
    expect(isApiResponse(null)).toBe(false);
  });

  it("should return false for undefined", () => {
    expect(isApiResponse(undefined)).toBe(false);
  });

  it("should return false for primitives", () => {
    expect(isApiResponse("string")).toBe(false);
    expect(isApiResponse(123)).toBe(false);
    expect(isApiResponse(true)).toBe(false);
  });

  it("should return false for missing required fields", () => {
    expect(isApiResponse({ object: "agent" })).toBe(false);
    expect(isApiResponse({ object: "agent", data: {} })).toBe(false);
    expect(
      isApiResponse({ object: "agent", data: {}, requestId: "req_123" }),
    ).toBe(false);
  });
});

describe("isApiListResponse", () => {
  it("should return true for valid list response", () => {
    const response: ApiListResponse<{ id: string }> = {
      object: "list",
      data: [{ id: "1" }, { id: "2" }],
      hasMore: true,
      nextCursor: "cursor_xyz",
      total: 100,
      url: "/agents",
      requestId: "req_abc123",
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    expect(isApiListResponse(response)).toBe(true);
  });

  it("should return true for empty list response", () => {
    const response: ApiListResponse<never> = {
      object: "list",
      data: [],
      hasMore: false,
      url: "/agents",
      requestId: "req_abc123",
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    expect(isApiListResponse(response)).toBe(true);
  });

  it("should return true for list without optional fields", () => {
    const response = {
      object: "list",
      data: [{ id: "1" }],
      hasMore: false,
      url: "/agents",
      requestId: "req_abc123",
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    expect(isApiListResponse(response)).toBe(true);
  });

  it("should return false for single resource response", () => {
    const response = {
      object: "agent",
      data: { id: "agent_123" },
      requestId: "req_abc123",
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    expect(isApiListResponse(response)).toBe(false);
  });

  it("should return false for error response", () => {
    const response = {
      object: "error",
      error: { code: "TEST", message: "test" },
      requestId: "req_abc123",
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    expect(isApiListResponse(response)).toBe(false);
  });

  it("should return false for missing required fields", () => {
    expect(isApiListResponse({ object: "list" })).toBe(false);
    expect(isApiListResponse({ object: "list", data: [] })).toBe(false);
    expect(
      isApiListResponse({ object: "list", data: [], hasMore: false }),
    ).toBe(false);
  });

  it("should return false when data is not an array", () => {
    expect(
      isApiListResponse({
        object: "list",
        data: {},
        hasMore: false,
        url: "/test",
        requestId: "req_123",
        timestamp: "2024-01-15T10:30:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("isApiErrorResponse", () => {
  it("should return true for valid error response", () => {
    const response: ApiErrorResponse = {
      object: "error",
      error: {
        code: "AGENT_NOT_FOUND",
        message: "Agent not found",
        severity: "terminal",
        hint: "Check the agent ID",
        alternative: "List agents first",
      },
      requestId: "req_abc123",
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    expect(isApiErrorResponse(response)).toBe(true);
  });

  it("should return true for minimal error response", () => {
    const response: ApiErrorResponse = {
      object: "error",
      error: {
        code: "VALIDATION_FAILED",
        message: "Invalid request",
      },
      requestId: "req_abc123",
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    expect(isApiErrorResponse(response)).toBe(true);
  });

  it("should return true for error with param field", () => {
    const response: ApiErrorResponse = {
      object: "error",
      error: {
        code: "VALIDATION_FAILED",
        message: "Invalid value",
        param: "status",
        severity: "recoverable",
      },
      requestId: "req_abc123",
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    expect(isApiErrorResponse(response)).toBe(true);
  });

  it("should return false for single resource response", () => {
    const response = {
      object: "agent",
      data: { id: "agent_123" },
      requestId: "req_abc123",
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    expect(isApiErrorResponse(response)).toBe(false);
  });

  it("should return false for list response", () => {
    const response = {
      object: "list",
      data: [],
      hasMore: false,
      url: "/agents",
      requestId: "req_abc123",
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    expect(isApiErrorResponse(response)).toBe(false);
  });

  it("should return false for missing error field", () => {
    expect(
      isApiErrorResponse({
        object: "error",
        requestId: "req_123",
        timestamp: "2024-01-15T10:30:00.000Z",
      }),
    ).toBe(false);
  });

  it("should return false for error with missing code", () => {
    expect(
      isApiErrorResponse({
        object: "error",
        error: { message: "test" },
        requestId: "req_123",
        timestamp: "2024-01-15T10:30:00.000Z",
      }),
    ).toBe(false);
  });

  it("should return false for error with missing message", () => {
    expect(
      isApiErrorResponse({
        object: "error",
        error: { code: "TEST" },
        requestId: "req_123",
        timestamp: "2024-01-15T10:30:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("isSuccessResponse", () => {
  it("should return true for single resource response", () => {
    const response: ApiResponse<{ id: string }> = {
      object: "agent",
      data: { id: "agent_123" },
      requestId: "req_abc123",
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    expect(isSuccessResponse(response)).toBe(true);
  });

  it("should return true for list response", () => {
    const response: ApiListResponse<{ id: string }> = {
      object: "list",
      data: [{ id: "1" }],
      hasMore: false,
      url: "/agents",
      requestId: "req_abc123",
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    expect(isSuccessResponse(response)).toBe(true);
  });

  it("should return false for error response", () => {
    const response: ApiErrorResponse = {
      object: "error",
      error: {
        code: "TEST",
        message: "test",
      },
      requestId: "req_abc123",
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    expect(isSuccessResponse(response)).toBe(false);
  });
});

describe("Type Compatibility", () => {
  it("should allow typed data in ApiResponse", () => {
    interface Agent {
      id: string;
      status: "ready" | "executing";
      model: string;
    }

    const response: ApiResponse<Agent> = {
      object: "agent",
      data: {
        id: "agent_123",
        status: "ready",
        model: "claude-3-opus",
      },
      requestId: "req_abc123",
      timestamp: "2024-01-15T10:30:00.000Z",
    };

    // TypeScript should allow accessing typed fields
    expect(response.data.id).toBe("agent_123");
    expect(response.data.status).toBe("ready");
  });

  it("should allow typed data in ApiListResponse", () => {
    interface Checkpoint {
      id: string;
      agentId: string;
      createdAt: string;
    }

    const response: ApiListResponse<Checkpoint> = {
      object: "list",
      data: [
        { id: "cp_1", agentId: "agent_123", createdAt: "2024-01-15T10:00:00Z" },
        { id: "cp_2", agentId: "agent_123", createdAt: "2024-01-15T10:30:00Z" },
      ],
      hasMore: false,
      url: "/agents/agent_123/checkpoints",
      requestId: "req_abc123",
      timestamp: "2024-01-15T10:30:00.000Z",
    };

    // TypeScript should allow accessing typed fields
    const firstCheckpoint = response.data[0];
    expect(firstCheckpoint?.id).toBe("cp_1");
  });

  it("should allow all severity levels in ApiError", () => {
    const terminalError: ApiErrorResponse = {
      object: "error",
      error: {
        code: "AGENT_TERMINATED",
        message: "Agent has terminated",
        severity: "terminal",
      },
      requestId: "req_1",
      timestamp: "2024-01-15T10:30:00.000Z",
    };

    const recoverableError: ApiErrorResponse = {
      object: "error",
      error: {
        code: "VALIDATION_FAILED",
        message: "Invalid input",
        severity: "recoverable",
      },
      requestId: "req_2",
      timestamp: "2024-01-15T10:30:00.000Z",
    };

    const retryError: ApiErrorResponse = {
      object: "error",
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests",
        severity: "retry",
      },
      requestId: "req_3",
      timestamp: "2024-01-15T10:30:00.000Z",
    };

    expect(terminalError.error.severity).toBe("terminal");
    expect(recoverableError.error.severity).toBe("recoverable");
    expect(retryError.error.severity).toBe("retry");
  });

  it("should allow category and recoverable fields in ApiError", () => {
    const error: ApiErrorResponse = {
      object: "error",
      error: {
        code: "AGENT_NOT_FOUND",
        message: "Agent not found",
        category: "agent",
        recoverable: false,
        severity: "terminal",
        hint: "Check the agent ID",
      },
      requestId: "req_abc123",
      timestamp: "2024-01-15T10:30:00.000Z",
    };

    expect(error.error.category).toBe("agent");
    expect(error.error.recoverable).toBe(false);
  });
});

describe("deriveErrorCategory", () => {
  it("should derive 'agent' category from AGENT_ codes", () => {
    expect(deriveErrorCategory("AGENT_NOT_FOUND")).toBe("agent");
    expect(deriveErrorCategory("AGENT_ALREADY_EXISTS")).toBe("agent");
    expect(deriveErrorCategory("AGENT_TERMINATED")).toBe("agent");
  });

  it("should derive 'spawn' category from SPAWN_ codes", () => {
    expect(deriveErrorCategory("SPAWN_FAILED")).toBe("spawn");
    expect(deriveErrorCategory("SPAWN_QUOTA_EXCEEDED")).toBe("spawn");
  });

  it("should derive 'driver' category from DRIVER_ codes", () => {
    expect(deriveErrorCategory("DRIVER_NOT_FOUND")).toBe("driver");
    expect(deriveErrorCategory("DRIVER_INIT_FAILED")).toBe("driver");
  });

  it("should derive 'websocket' category from WS_ codes", () => {
    expect(deriveErrorCategory("WS_CONNECTION_FAILED")).toBe("websocket");
    expect(deriveErrorCategory("WS_RATE_LIMITED")).toBe("websocket");
  });

  it("should derive 'auth' category from AUTH_ codes", () => {
    expect(deriveErrorCategory("AUTH_TOKEN_INVALID")).toBe("auth");
    expect(deriveErrorCategory("AUTH_TOKEN_EXPIRED")).toBe("auth");
  });

  it("should derive 'rate_limit' category from rate/quota codes", () => {
    expect(deriveErrorCategory("RATE_LIMIT_EXCEEDED")).toBe("rate_limit");
    expect(deriveErrorCategory("RATE_LIMITED")).toBe("rate_limit");
    expect(deriveErrorCategory("QUOTA_EXCEEDED")).toBe("rate_limit");
  });

  it("should derive 'account' category from ACCOUNT_ and BYOA codes", () => {
    expect(deriveErrorCategory("ACCOUNT_NOT_FOUND")).toBe("account");
    expect(deriveErrorCategory("BYOA_REQUIRED")).toBe("account");
  });

  it("should derive 'validation' category from validation-related codes", () => {
    expect(deriveErrorCategory("VALIDATION_FAILED")).toBe("validation");
    expect(deriveErrorCategory("INVALID_REQUEST")).toBe("validation");
    expect(deriveErrorCategory("MISSING_REQUIRED_FIELD")).toBe("validation");
  });

  it("should derive 'safety' category from DCG/approval codes", () => {
    expect(deriveErrorCategory("DCG_BLOCKED")).toBe("safety");
    expect(deriveErrorCategory("APPROVAL_REQUIRED")).toBe("safety");
    expect(deriveErrorCategory("SAFETY_VIOLATION")).toBe("safety");
  });

  it("should derive 'system' category from internal/system codes", () => {
    expect(deriveErrorCategory("SYSTEM_UNAVAILABLE")).toBe("system");
    expect(deriveErrorCategory("INTERNAL_ERROR")).toBe("system");
    expect(deriveErrorCategory("NOT_IMPLEMENTED")).toBe("system");
  });

  it("should default to 'system' for unknown codes", () => {
    expect(deriveErrorCategory("UNKNOWN_ERROR")).toBe("system");
    expect(deriveErrorCategory("CUSTOM_ERROR")).toBe("system");
  });

  it("should be case-insensitive", () => {
    expect(deriveErrorCategory("agent_not_found")).toBe("agent");
    expect(deriveErrorCategory("Agent_Not_Found")).toBe("agent");
  });
});

describe("ErrorCategory type", () => {
  it("should include all expected categories", () => {
    // Verify that all documented categories exist by assigning them
    const categories: ErrorCategory[] = [
      "agent",
      "spawn",
      "driver",
      "websocket",
      "auth",
      "rate_limit",
      "account",
      "provisioning",
      "reservation",
      "checkpoint",
      "mail",
      "bead",
      "scanner",
      "daemon",
      "validation",
      "safety",
      "fleet",
      "system",
    ];

    // If any category doesn't exist, TypeScript would error
    expect(categories.length).toBe(18);
  });
});
