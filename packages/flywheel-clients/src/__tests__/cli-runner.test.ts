/**
 * Unit tests for shared CLI runner + client parsing (bd-9v6g)
 *
 * Tests cover:
 * - Runner timeouts (with fast sleep command)
 * - Output caps (stdout/stderr truncation)
 * - JSON parsing (valid, invalid, empty)
 * - Error mapping (spawn_failed, timeout, parse_error, validation_error)
 * - Detailed logging assertions for failure paths
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  CliCommandError,
  createBunCliRunner,
  parseJson,
  parseJsonWithSchema,
} from "../cli-runner";
import type { CliCommandResult, CliCommandRunner } from "../cli-runner";

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Create a mock runner that returns fixed responses
 */
function createMockRunner(result: Partial<CliCommandResult>): CliCommandRunner {
  return {
    run: async () => {
      const response: CliCommandResult = {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        exitCode: result.exitCode ?? 0,
      };
      if (result.stdoutTruncated !== undefined)
        response.stdoutTruncated = result.stdoutTruncated;
      if (result.stderrTruncated !== undefined)
        response.stderrTruncated = result.stderrTruncated;
      if (result.timedOut !== undefined) response.timedOut = result.timedOut;
      return response;
    },
  };
}

/**
 * Create a mock runner that throws CliCommandError
 */
function createThrowingRunner(
  kind: "spawn_failed" | "timeout" | "parse_error" | "validation_error",
  message: string,
): CliCommandRunner {
  return {
    run: async () => {
      throw new CliCommandError(kind, message, { command: "test" });
    },
  };
}

// =============================================================================
// JSON Parsing Tests
// =============================================================================

describe("parseJson", () => {
  test("parses valid JSON object", () => {
    const input = '{"key": "value", "num": 42}';
    const result = parseJson<{ key: string; num: number }>(input, "test");
    expect(result).toEqual({ key: "value", num: 42 });
  });

  test("parses valid JSON array", () => {
    const input = "[1, 2, 3]";
    const result = parseJson<number[]>(input, "test");
    expect(result).toEqual([1, 2, 3]);
  });

  test("parses valid JSON primitives", () => {
    expect(parseJson<string>('"hello"', "test")).toBe("hello");
    expect(parseJson<number>("42", "test")).toBe(42);
    expect(parseJson<boolean>("true", "test")).toBe(true);
    expect(parseJson<null>("null", "test")).toBe(null);
  });

  test("throws parse_error for invalid JSON", () => {
    let error: CliCommandError | undefined;
    try {
      parseJson("{not valid json}", "test context");
    } catch (e) {
      error = e as CliCommandError;
    }

    expect(error).toBeInstanceOf(CliCommandError);
    expect(error?.kind).toBe("parse_error");
    expect(error?.message).toBe("Failed to parse test context");
    expect(error?.details?.stdout).toBe("{not valid json}");
    expect(error?.details?.cause).toBeDefined();
  });

  test("throws parse_error for empty string", () => {
    let error: CliCommandError | undefined;
    try {
      parseJson("", "empty test");
    } catch (e) {
      error = e as CliCommandError;
    }

    expect(error).toBeInstanceOf(CliCommandError);
    expect(error?.kind).toBe("parse_error");
    expect(error?.message).toBe("Failed to parse empty test");
  });

  test("throws parse_error for truncated JSON", () => {
    let error: CliCommandError | undefined;
    try {
      parseJson('{"key": "value", "incomplete', "truncated test");
    } catch (e) {
      error = e as CliCommandError;
    }

    expect(error).toBeInstanceOf(CliCommandError);
    expect(error?.kind).toBe("parse_error");
  });

  test("truncates stdout snippet in error details", () => {
    const longInput = "x".repeat(1000);
    let error: CliCommandError | undefined;
    try {
      parseJson(longInput, "long test", 100);
    } catch (e) {
      error = e as CliCommandError;
    }

    expect(error?.details?.stdout).toHaveLength(100);
  });

  test("uses default maxSnippet of 500 chars", () => {
    const longInput = "x".repeat(1000);
    let error: CliCommandError | undefined;
    try {
      parseJson(longInput, "default snippet test");
    } catch (e) {
      error = e as CliCommandError;
    }

    expect(error?.details?.stdout).toHaveLength(500);
  });
});

// =============================================================================
// JSON Schema Validation Tests
// =============================================================================

describe("parseJsonWithSchema", () => {
  const TestSchema = z.object({
    id: z.string(),
    count: z.number(),
    tags: z.array(z.string()).optional(),
  });

  test("parses and validates conforming JSON", () => {
    const input = '{"id": "abc", "count": 5, "tags": ["a", "b"]}';
    const result = parseJsonWithSchema(input, TestSchema, "schema test");

    expect(result).toEqual({ id: "abc", count: 5, tags: ["a", "b"] });
  });

  test("parses JSON with optional fields missing", () => {
    const input = '{"id": "xyz", "count": 0}';
    const result = parseJsonWithSchema(input, TestSchema, "minimal test");

    expect(result).toEqual({ id: "xyz", count: 0 });
  });

  test("throws validation_error for schema mismatch", () => {
    const input = '{"id": 123, "count": "not a number"}'; // Wrong types
    let error: CliCommandError | undefined;
    try {
      parseJsonWithSchema(input, TestSchema, "invalid schema test");
    } catch (e) {
      error = e as CliCommandError;
    }

    expect(error).toBeInstanceOf(CliCommandError);
    expect(error?.kind).toBe("validation_error");
    expect(error?.message).toBe("Invalid invalid schema test response");
    expect(error?.details?.["issues"]).toBeDefined();
    expect(Array.isArray(error?.details?.["issues"])).toBe(true);
  });

  test("throws validation_error for missing required fields", () => {
    const input = '{"id": "abc"}'; // Missing "count"
    let error: CliCommandError | undefined;
    try {
      parseJsonWithSchema(input, TestSchema, "missing field test");
    } catch (e) {
      error = e as CliCommandError;
    }

    expect(error).toBeInstanceOf(CliCommandError);
    expect(error?.kind).toBe("validation_error");
    expect(error?.details?.["issues"]).toHaveLength(1);
  });

  test("includes Zod issues in error details", () => {
    const input = '{"id": "abc", "count": "bad"}';
    let error: CliCommandError | undefined;
    try {
      parseJsonWithSchema(input, TestSchema, "issues test");
    } catch (e) {
      error = e as CliCommandError;
    }

    const issues = error?.details?.["issues"] as z.ZodIssue[];
    expect(issues).toBeDefined();
    expect(issues[0]?.path).toContain("count");
    expect(issues[0]?.message).toContain("number");
  });

  test("throws parse_error for invalid JSON (before schema validation)", () => {
    let error: CliCommandError | undefined;
    try {
      parseJsonWithSchema("{invalid", TestSchema, "parse first test");
    } catch (e) {
      error = e as CliCommandError;
    }

    expect(error?.kind).toBe("parse_error");
  });
});

// =============================================================================
// CliCommandError Tests
// =============================================================================

describe("CliCommandError", () => {
  test("constructs with kind and message", () => {
    const error = new CliCommandError("timeout", "Operation timed out");

    expect(error.name).toBe("CliCommandError");
    expect(error.kind).toBe("timeout");
    expect(error.message).toBe("Operation timed out");
    expect(error.details).toBeUndefined();
  });

  test("constructs with details", () => {
    const error = new CliCommandError("spawn_failed", "Failed to spawn", {
      command: "foo",
      args: ["--bar"],
      cause: "ENOENT",
    });

    expect(error.details).toEqual({
      command: "foo",
      args: ["--bar"],
      cause: "ENOENT",
    });
  });

  test("supports all error kinds", () => {
    const kinds = [
      "spawn_failed",
      "timeout",
      "parse_error",
      "validation_error",
      "command_failed",
      "unavailable",
      "not_installed",
    ] as const;

    for (const kind of kinds) {
      const error = new CliCommandError(kind, `Error: ${kind}`);
      expect(error.kind).toBe(kind);
    }
  });
});

// =============================================================================
// Bun CLI Runner Integration Tests (uses real processes)
// =============================================================================

describe("createBunCliRunner", () => {
  test("runs simple command and captures stdout", async () => {
    const runner = createBunCliRunner();
    const result = await runner.run("echo", ["hello"]);

    expect(result.stdout.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("captures exit code on failure", async () => {
    const runner = createBunCliRunner();
    const result = await runner.run("sh", ["-c", "exit 42"]);

    expect(result.exitCode).toBe(42);
  });

  test("captures stderr on error", async () => {
    const runner = createBunCliRunner();
    const result = await runner.run("sh", ["-c", "echo error >&2; exit 1"]);

    expect(result.stderr.trim()).toBe("error");
    expect(result.exitCode).toBe(1);
  });

  test("respects cwd option", async () => {
    const runner = createBunCliRunner();
    const result = await runner.run("pwd", [], { cwd: "/tmp" });

    expect(result.stdout.trim()).toBe("/tmp");
  });

  test("merges environment variables", async () => {
    const runner = createBunCliRunner({ env: { DEFAULT_VAR: "default" } });
    const result = await runner.run(
      "sh",
      ["-c", "echo $TEST_VAR:$DEFAULT_VAR"],
      {
        env: { TEST_VAR: "value" },
      },
    );

    expect(result.stdout.trim()).toBe("value:default");
  });

  test("sets NO_COLOR=1 by default", async () => {
    const runner = createBunCliRunner();
    const result = await runner.run("sh", ["-c", "echo $NO_COLOR"]);

    expect(result.stdout.trim()).toBe("1");
  });
});

// =============================================================================
// Timeout Tests (uses real processes with short timeout)
// =============================================================================

describe("createBunCliRunner timeouts", () => {
  test("times out on slow command", async () => {
    const runner = createBunCliRunner({ timeoutMs: 50 });

    let error: CliCommandError | undefined;
    try {
      await runner.run("sleep", ["10"]);
    } catch (e) {
      error = e as CliCommandError;
    }

    expect(error).toBeInstanceOf(CliCommandError);
    expect(error?.kind).toBe("timeout");
    expect(error?.message).toBe("Command timed out");
    expect(error?.details?.["timeoutMs"]).toBe(50);
  });

  test("completes before timeout on fast command", async () => {
    const runner = createBunCliRunner({ timeoutMs: 5000 });
    const result = await runner.run("echo", ["fast"]);

    expect(result.stdout.trim()).toBe("fast");
    expect(result.timedOut).toBeUndefined();
  });

  test("uses per-command timeout override", async () => {
    const runner = createBunCliRunner({ timeoutMs: 5000 }); // Long default

    let error: CliCommandError | undefined;
    try {
      await runner.run("sleep", ["10"], { timeoutMs: 50 }); // Short override
    } catch (e) {
      error = e as CliCommandError;
    }

    expect(error?.kind).toBe("timeout");
    expect(error?.details?.["timeoutMs"]).toBe(50);
  });

  test("uses default timeout when not specified", async () => {
    const runner = createBunCliRunner(); // 30s default

    // Just verify it doesn't timeout immediately
    const result = await runner.run("echo", ["quick"]);
    expect(result.stdout.trim()).toBe("quick");
  });
});

// =============================================================================
// Output Cap Tests (uses real processes with byte limits)
// =============================================================================

describe("createBunCliRunner output caps", () => {
  test("truncates stdout exceeding maxOutputBytes", async () => {
    const runner = createBunCliRunner({ maxOutputBytes: 100 });
    // Generate ~1000 bytes of output
    const result = await runner.run("sh", [
      "-c",
      'yes "1234567890" | head -100',
    ]);

    expect(result.stdout.length).toBeLessThanOrEqual(100);
    expect(result.stdoutTruncated).toBe(true);
  });

  test("truncates stderr exceeding maxOutputBytes", async () => {
    const runner = createBunCliRunner({ maxOutputBytes: 100 });
    // Generate ~1000 bytes of stderr
    const result = await runner.run("sh", [
      "-c",
      'yes "1234567890" | head -100 >&2',
    ]);

    expect(result.stderr.length).toBeLessThanOrEqual(100);
    expect(result.stderrTruncated).toBe(true);
  });

  test("does not set truncated flag when under limit", async () => {
    const runner = createBunCliRunner({ maxOutputBytes: 10000 });
    const result = await runner.run("echo", ["hello"]);

    expect(result.stdoutTruncated).toBeUndefined();
    expect(result.stderrTruncated).toBeUndefined();
  });

  test("per-command maxOutputBytes override works", async () => {
    const runner = createBunCliRunner({ maxOutputBytes: 10000 }); // Large default
    const result = await runner.run(
      "sh",
      ["-c", 'yes "1234567890" | head -100'],
      { maxOutputBytes: 50 }, // Small override
    );

    expect(result.stdout.length).toBeLessThanOrEqual(50);
    expect(result.stdoutTruncated).toBe(true);
  });

  test("handles simultaneous stdout and stderr truncation", async () => {
    const runner = createBunCliRunner({ maxOutputBytes: 50 });
    const result = await runner.run("sh", [
      "-c",
      'yes "stdout" | head -50 & yes "stderr" | head -50 >&2 & wait',
    ]);

    expect(result.stdout.length).toBeLessThanOrEqual(50);
    expect(result.stderr.length).toBeLessThanOrEqual(50);
  });
});

// =============================================================================
// Spawn Failure Tests
// =============================================================================

describe("createBunCliRunner spawn failures", () => {
  test("throws spawn_failed for non-existent command", async () => {
    const runner = createBunCliRunner();

    let error: CliCommandError | undefined;
    try {
      await runner.run("nonexistent_command_xyz_123", []);
    } catch (e) {
      error = e as CliCommandError;
    }

    expect(error).toBeInstanceOf(CliCommandError);
    expect(error?.kind).toBe("spawn_failed");
    expect(error?.message).toBe("Failed to spawn command");
    expect(error?.details?.command).toBe("nonexistent_command_xyz_123");
  });
});

// =============================================================================
// Mock Runner Pattern Tests
// =============================================================================

describe("mock runner patterns", () => {
  test("mock runner returns fixed result", async () => {
    const runner = createMockRunner({
      stdout: '{"status": "ok"}',
      stderr: "",
      exitCode: 0,
    });

    const result = await runner.run("any", ["args"]);
    expect(result.stdout).toBe('{"status": "ok"}');
    expect(result.exitCode).toBe(0);
  });

  test("mock runner with truncation flags", async () => {
    const runner = createMockRunner({
      stdout: "truncated...",
      stdoutTruncated: true,
      stderrTruncated: false,
    });

    const result = await runner.run("test", []);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(false);
  });

  test("mock runner with timeout flag", async () => {
    const runner = createMockRunner({
      stdout: "",
      timedOut: true,
      exitCode: -1,
    });

    const result = await runner.run("slow", []);
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(-1);
  });

  test("throwing runner propagates error", async () => {
    const runner = createThrowingRunner("timeout", "Test timeout");

    let error: CliCommandError | undefined;
    try {
      await runner.run("test", []);
    } catch (e) {
      error = e as CliCommandError;
    }

    expect(error?.kind).toBe("timeout");
    expect(error?.message).toBe("Test timeout");
  });
});

// =============================================================================
// Logging Assertions (verify error details are actionable)
// =============================================================================

describe("error detail logging", () => {
  test("timeout error includes command info", async () => {
    const runner = createBunCliRunner({ timeoutMs: 10 });

    let error: CliCommandError | undefined;
    try {
      await runner.run("sleep", ["100"]);
    } catch (e) {
      error = e as CliCommandError;
    }

    // Verify error details are actionable for logging/debugging
    expect(error?.details?.["command"]).toBe("sleep");
    expect(error?.details?.["args"]).toEqual(["100"]);
    expect(error?.details?.["timeoutMs"]).toBe(10);
  });

  test("spawn_failed error includes cause", async () => {
    const runner = createBunCliRunner();

    let error: CliCommandError | undefined;
    try {
      await runner.run("this_command_does_not_exist", ["--flag"]);
    } catch (e) {
      error = e as CliCommandError;
    }

    expect(error?.details?.["command"]).toBe("this_command_does_not_exist");
    expect(error?.details?.["args"]).toEqual(["--flag"]);
    expect(error?.details?.["cause"]).toBeDefined();
  });

  test("parse_error includes stdout snippet", () => {
    let error: CliCommandError | undefined;
    try {
      parseJson("{malformed json with context data}", "test op");
    } catch (e) {
      error = e as CliCommandError;
    }

    expect(error?.details?.["stdout"]).toBe(
      "{malformed json with context data}",
    );
    expect(error?.details?.["cause"]).toBeDefined();
  });

  test("validation_error includes Zod issues", () => {
    const schema = z.object({ required: z.string() });

    let error: CliCommandError | undefined;
    try {
      parseJsonWithSchema("{}", schema, "test validation");
    } catch (e) {
      error = e as CliCommandError;
    }

    const issues = error?.details?.["issues"] as z.ZodIssue[];
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toEqual(["required"]);
    expect(issues[0]?.code).toBe("invalid_type");
  });
});
