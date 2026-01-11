/**
 * Tests for Response Wrapper Utilities.
 */

import { describe, expect, it } from "bun:test";
import {
  generateRequestId,
  wrapCreated,
  wrapEmptyList,
  wrapError,
  wrapList,
  wrapNotFound,
  wrapResource,
  wrapValidationError,
} from "../response-utils";

describe("generateRequestId", () => {
  it("should generate request ID with correct prefix", () => {
    const id = generateRequestId();
    expect(id.startsWith("req_")).toBe(true);
  });

  it("should generate request ID with correct length", () => {
    const id = generateRequestId();
    expect(id.length).toBe(16); // "req_" + 12 chars
  });

  it("should generate unique request IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateRequestId());
    }
    expect(ids.size).toBe(100);
  });

  it("should only use alphanumeric characters", () => {
    const id = generateRequestId();
    const suffix = id.substring(4);
    expect(/^[a-z0-9]+$/.test(suffix)).toBe(true);
  });
});

describe("wrapResource", () => {
  it("should create valid resource envelope", () => {
    const data = { id: "test_123", name: "Test" };
    const response = wrapResource("test", data);

    expect(response.object).toBe("test");
    expect(response.data).toEqual(data);
    expect(response.requestId).toBeDefined();
    expect(response.timestamp).toBeDefined();
  });

  it("should use provided requestId", () => {
    const data = { id: "test_123" };
    const response = wrapResource("test", data, { requestId: "req_custom123" });

    expect(response.requestId).toBe("req_custom123");
  });

  it("should use provided timestamp", () => {
    const data = { id: "test_123" };
    const timestamp = "2024-01-15T10:30:00.000Z";
    const response = wrapResource("test", data, { timestamp });

    expect(response.timestamp).toBe(timestamp);
  });

  it("should include links when provided", () => {
    const data = { id: "test_123" };
    const links = { self: "/tests/test_123", parent: "/tests" };
    const response = wrapResource("test", data, { links });

    expect(response.links).toEqual(links);
  });

  it("should not include links when not provided", () => {
    const data = { id: "test_123" };
    const response = wrapResource("test", data);

    expect(response.links).toBeUndefined();
  });

  it("should handle complex data types", () => {
    const data = {
      id: "complex_123",
      nested: { value: 42, array: [1, 2, 3] },
      date: new Date().toISOString(),
    };
    const response = wrapResource("complex", data);

    expect(response.data).toEqual(data);
  });
});

describe("wrapList", () => {
  it("should create valid list envelope", () => {
    const data = [{ id: "1" }, { id: "2" }];
    const response = wrapList(data, { url: "/items" });

    expect(response.object).toBe("list");
    expect(response.data).toEqual(data);
    expect(response.hasMore).toBe(false);
    expect(response.url).toBe("/items");
    expect(response.requestId).toBeDefined();
    expect(response.timestamp).toBeDefined();
  });

  it("should include pagination when provided", () => {
    const data = [{ id: "1" }];
    const response = wrapList(data, {
      url: "/items",
      hasMore: true,
      nextCursor: "cursor_abc",
      total: 100,
    });

    expect(response.hasMore).toBe(true);
    expect(response.nextCursor).toBe("cursor_abc");
    expect(response.total).toBe(100);
  });

  it("should not include optional fields when not provided", () => {
    const data = [{ id: "1" }];
    const response = wrapList(data, { url: "/items" });

    expect(response.nextCursor).toBeUndefined();
    expect(response.total).toBeUndefined();
  });

  it("should handle empty list", () => {
    const response = wrapList([], { url: "/items" });

    expect(response.data).toEqual([]);
    expect(response.hasMore).toBe(false);
  });

  it("should use provided requestId", () => {
    const response = wrapList([], {
      url: "/items",
      requestId: "req_custom123",
    });

    expect(response.requestId).toBe("req_custom123");
  });
});

describe("wrapError", () => {
  it("should create valid error envelope", () => {
    const response = wrapError({
      code: "TEST_ERROR",
      message: "Test error message",
    });

    expect(response.object).toBe("error");
    expect(response.error.code).toBe("TEST_ERROR");
    expect(response.error.message).toBe("Test error message");
    expect(response.requestId).toBeDefined();
    expect(response.timestamp).toBeDefined();
  });

  it("should include AI hints for known error codes", () => {
    const response = wrapError({
      code: "AGENT_NOT_FOUND",
      message: "Agent not found",
    });

    expect(response.error.severity).toBe("terminal");
    expect(response.error.hint).toBeDefined();
  });

  it("should include param when provided", () => {
    const response = wrapError({
      code: "VALIDATION_FAILED",
      message: "Invalid value",
      param: "status",
    });

    expect(response.error.param).toBe("status");
  });

  it("should include details when provided", () => {
    const details = { field: "email", reason: "invalid format" };
    const response = wrapError({
      code: "VALIDATION_FAILED",
      message: "Invalid email",
      details,
    });

    expect(response.error.details).toEqual(details);
  });

  it("should allow overriding severity", () => {
    const response = wrapError({
      code: "CUSTOM_ERROR",
      message: "Custom error",
      severity: "terminal",
    });

    expect(response.error.severity).toBe("terminal");
  });

  it("should allow overriding hint", () => {
    const response = wrapError({
      code: "CUSTOM_ERROR",
      message: "Custom error",
      hint: "Custom hint for this error",
    });

    expect(response.error.hint).toBe("Custom hint for this error");
  });

  it("should allow overriding alternative", () => {
    const response = wrapError({
      code: "CUSTOM_ERROR",
      message: "Custom error",
      alternative: "Try a different approach",
    });

    expect(response.error.alternative).toBe("Try a different approach");
  });
});

describe("wrapCreated", () => {
  it("should create response with self link", () => {
    const data = { id: "new_123", name: "New Item" };
    const response = wrapCreated("item", data, "/items/new_123");

    expect(response.object).toBe("item");
    expect(response.data).toEqual(data);
    expect(response.links).toEqual({ self: "/items/new_123" });
  });

  it("should include requestId in response", () => {
    const data = { id: "new_123" };
    const response = wrapCreated("item", data, "/items/new_123", {
      requestId: "req_custom123",
    });

    expect(response.requestId).toBe("req_custom123");
  });
});

describe("wrapEmptyList", () => {
  it("should create empty list with total 0", () => {
    const response = wrapEmptyList("/items");

    expect(response.object).toBe("list");
    expect(response.data).toEqual([]);
    expect(response.hasMore).toBe(false);
    expect(response.total).toBe(0);
    expect(response.url).toBe("/items");
  });

  it("should use provided requestId", () => {
    const response = wrapEmptyList("/items", { requestId: "req_custom123" });

    expect(response.requestId).toBe("req_custom123");
  });
});

describe("wrapValidationError", () => {
  it("should create validation error with single field", () => {
    const errors = [{ path: "email", message: "Invalid email format" }];
    const response = wrapValidationError(errors);

    expect(response.error.code).toBe("VALIDATION_FAILED");
    expect(response.error.message).toBe("Invalid email format");
    expect(response.error.param).toBe("email");
    expect(response.error.details).toEqual({ errors });
  });

  it("should create validation error with multiple fields", () => {
    const errors = [
      { path: "email", message: "Invalid email" },
      { path: "password", message: "Too short" },
    ];
    const response = wrapValidationError(errors);

    expect(response.error.code).toBe("VALIDATION_FAILED");
    expect(response.error.message).toBe("Validation failed: 2 errors");
    expect(response.error.param).toBe("email"); // First error's path
    expect(response.error.details).toEqual({ errors });
  });

  it("should have recoverable severity", () => {
    const errors = [{ path: "field", message: "Error" }];
    const response = wrapValidationError(errors);

    expect(response.error.severity).toBe("recoverable");
  });

  it("should include hint for fixing errors", () => {
    const errors = [{ path: "field", message: "Error" }];
    const response = wrapValidationError(errors);

    expect(response.error.hint).toContain("Fix");
  });
});

describe("wrapNotFound", () => {
  it("should create not found error with correct code", () => {
    const response = wrapNotFound("agent", "agent_123");

    expect(response.error.code).toBe("AGENT_NOT_FOUND");
    expect(response.error.message).toBe("agent 'agent_123' not found");
    expect(response.error.severity).toBe("terminal");
  });

  it("should include hint for verification", () => {
    const response = wrapNotFound("checkpoint", "cp_456");

    expect(response.error.hint).toContain("Verify");
  });

  it("should handle different resource types", () => {
    const response = wrapNotFound("reservation", "res_789");

    expect(response.error.code).toBe("RESERVATION_NOT_FOUND");
    expect(response.error.message).toBe("reservation 'res_789' not found");
  });
});

describe("Response Type Safety", () => {
  it("should preserve data type in wrapResource", () => {
    interface Agent {
      id: string;
      status: "ready" | "executing";
    }

    const agent: Agent = { id: "agent_1", status: "ready" };
    const response = wrapResource<Agent>("agent", agent);

    // TypeScript should allow accessing typed fields
    expect(response.data.id).toBe("agent_1");
    expect(response.data.status).toBe("ready");
  });

  it("should preserve data type in wrapList", () => {
    interface Checkpoint {
      id: string;
      createdAt: string;
    }

    const checkpoints: Checkpoint[] = [
      { id: "cp_1", createdAt: "2024-01-15T10:00:00Z" },
    ];
    const response = wrapList<Checkpoint>(checkpoints, { url: "/checkpoints" });

    // TypeScript should allow accessing typed fields
    const first = response.data[0];
    expect(first?.id).toBe("cp_1");
  });
});
