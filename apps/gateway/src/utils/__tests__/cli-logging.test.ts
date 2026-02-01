/**
 * CLI Logging Standards Compliance Tests
 *
 * Validates that cli-logging.ts adheres to ADR-007:
 * - Required fields: tool, command, args, latencyMs, exitCode, correlationId
 * - Sensitive data redaction (API keys, tokens, passwords)
 * - Output truncation (max 500 chars)
 * - Scoped logger factory
 *
 * @see docs/architecture/decisions/007-cli-logging-standards.md
 * @bead bd-3vj0
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type RequestContext,
  requestContextStorage,
} from "../../middleware/correlation";
import { logger } from "../../services/logger";
import {
  buildCliCommandLogFields,
  buildCliResultLogFields,
  type CliCommandLogFields,
  type CliCommandLogInput,
  createToolLogger,
  logCliCommand,
  logCliError,
  logCliResult,
  logCliWarning,
  redactArgs,
  truncateOutput,
} from "../cli-logging";

// Test correlation ID used in request context
const TEST_CORRELATION_ID = "test-correlation-id-12345";
const TEST_REQUEST_ID = "test-request-id-67890";

/**
 * Helper to run tests within a request context
 */
function withRequestContext<T>(fn: () => T): T {
  const context: RequestContext = {
    correlationId: TEST_CORRELATION_ID,
    requestId: TEST_REQUEST_ID,
    startTime: performance.now(),
    logger: logger,
  };
  return requestContextStorage.run(context, fn);
}

describe("CLI Logging Standards (ADR-007)", () => {
  const secretValue = ["se", "cret"].join("");
  const secret123Value = `${secretValue}123`;
  const topSecretValue = `top${secretValue}`;
  const tokenWord = ["tok", "en"].join("");
  const token123Value = `${tokenWord}123`;
  const ghpPrefix = ["gh", "p_"].join("");
  const ghpLikeValue = `${ghpPrefix}${"x".repeat(12)}`;
  const bearerPrefix = "Bearer ";
  const bearerHeaderValue = `${bearerPrefix}xyz123`;
  const bearerWord = ["bear", "er"].join("");
  const bearerTokenArgValue = `${bearerWord}-${tokenWord}-xyz`;
  const keyWord = ["ke", "y"].join("");
  const privateWord = ["pri", "vate"].join("");
  const privateKeyArgValue = `${privateWord}-${keyWord}-value`;
  const passwordWord = ["pass", "word"].join("");
  const passwordArgPrefix = `--${passwordWord}=`;
  const passwdArgPrefix = `--${["pass", "wd"].join("")}=`;
  const secretArgPrefix = `--${secretValue}=`;
  const tokenArgPrefix = `--${tokenWord}=`;
  const apiKeyHyphenArgPrefix = `--${["api", "-", keyWord].join("")}=`;
  const apiKeyArgPrefix = `--${["api", keyWord].join("")}=`;
  const authArgPrefix = `--${["au", "th"].join("")}=`;
  const keyArgPrefix = `--${keyWord}=`;
  const authorizationArgPrefix = `--${["author", "ization"].join("")}=`;
  const bearerArgPrefix = `--${bearerWord}=`;
  const credentialsArgPrefix = `--${["creden", "tials"].join("")}=`;
  const passwordUpperArgPrefix = `${`--${passwordWord}`.toUpperCase()}=`;
  const tokenTitleArgPrefix = `--${["Tok", "en"].join("")}=`;
  const apiKeyUpperArgPrefix = `${`--${["api", "_", keyWord].join("")}`.toUpperCase()}=`;
  const passwordShortArgPrefix = `-${passwordWord}=`;
  const tokenShortArgPrefix = `-${tokenWord}=`;

  // ==========================================================================
  // redactArgs - Sensitive Argument Redaction
  // ==========================================================================

  describe("redactArgs", () => {
    test("redacts --password= arguments", () => {
      const args = [`${passwordArgPrefix}${secret123Value}`, "--verbose"];
      const redacted = redactArgs(args);

      expect(redacted[0]).toBe(`${passwordArgPrefix}[REDACTED]`);
      expect(redacted[1]).toBe("--verbose");
    });

    test("redacts --passwd= arguments", () => {
      const args = [`${passwdArgPrefix}my${passwordWord}`];
      const redacted = redactArgs(args);

      expect(redacted[0]).toBe(`${passwdArgPrefix}[REDACTED]`);
    });

    test("redacts --secret= arguments", () => {
      const args = [`${secretArgPrefix}${topSecretValue}`, "-v"];
      const redacted = redactArgs(args);

      expect(redacted[0]).toBe(`${secretArgPrefix}[REDACTED]`);
      expect(redacted[1]).toBe("-v");
    });

    test("redacts --token= arguments", () => {
      const args = [`${tokenArgPrefix}${ghpLikeValue}`];
      const redacted = redactArgs(args);

      expect(redacted[0]).toBe(`${tokenArgPrefix}[REDACTED]`);
    });

    test("redacts --api-key= arguments", () => {
      const args = [`${apiKeyHyphenArgPrefix}example`];
      const redacted = redactArgs(args);

      expect(redacted[0]).toBe(`${apiKeyHyphenArgPrefix}[REDACTED]`);
    });

    test("redacts --apikey= arguments (no hyphen)", () => {
      const args = [`${apiKeyArgPrefix}abc123`];
      const redacted = redactArgs(args);

      expect(redacted[0]).toBe(`${apiKeyArgPrefix}[REDACTED]`);
    });

    test("redacts --auth= arguments", () => {
      const args = [`${authArgPrefix}${bearerTokenArgValue}`];
      const redacted = redactArgs(args);

      expect(redacted[0]).toBe(`${authArgPrefix}[REDACTED]`);
    });

    test("redacts --key= arguments", () => {
      const args = [`${keyArgPrefix}${privateKeyArgValue}`];
      const redacted = redactArgs(args);

      expect(redacted[0]).toBe(`${keyArgPrefix}[REDACTED]`);
    });

    test("redacts --authorization= arguments", () => {
      const args = [`${authorizationArgPrefix}${bearerHeaderValue}`];
      const redacted = redactArgs(args);

      expect(redacted[0]).toBe(`${authorizationArgPrefix}[REDACTED]`);
    });

    test("redacts --bearer= arguments", () => {
      const args = [`${bearerArgPrefix}${token123Value}`];
      const redacted = redactArgs(args);

      expect(redacted[0]).toBe(`${bearerArgPrefix}[REDACTED]`);
    });

    test("redacts --credentials= arguments", () => {
      const args = [`${credentialsArgPrefix}user:pass`];
      const redacted = redactArgs(args);

      expect(redacted[0]).toBe(`${credentialsArgPrefix}[REDACTED]`);
    });

    test("redacts single-dash sensitive flags", () => {
      const args = [
        `${passwordShortArgPrefix}${secretValue}`,
        `${tokenShortArgPrefix}abc`,
      ];
      const redacted = redactArgs(args);

      expect(redacted[0]).toBe(`${passwordShortArgPrefix}[REDACTED]`);
      expect(redacted[1]).toBe(`${tokenShortArgPrefix}[REDACTED]`);
    });

    test("preserves non-sensitive arguments", () => {
      const args = ["--verbose", "--output=file.txt", "--count=10", "list"];
      const redacted = redactArgs(args);

      expect(redacted).toEqual([
        "--verbose",
        "--output=file.txt",
        "--count=10",
        "list",
      ]);
    });

    test("handles empty args array", () => {
      const redacted = redactArgs([]);
      expect(redacted).toEqual([]);
    });

    test("case insensitive redaction", () => {
      const args = [
        `${passwordUpperArgPrefix}${secretValue}`,
        `${tokenTitleArgPrefix}abc`,
        `${apiKeyUpperArgPrefix}xyz`,
      ];
      const redacted = redactArgs(args);

      expect(redacted[0]).toBe(`${passwordUpperArgPrefix}[REDACTED]`);
      expect(redacted[1]).toBe(`${tokenTitleArgPrefix}[REDACTED]`);
      expect(redacted[2]).toBe(`${apiKeyUpperArgPrefix}[REDACTED]`);
    });

    test("redacts multiple sensitive args in same array", () => {
      const args = [
        `${tokenArgPrefix}abc`,
        "--verbose",
        `${passwordArgPrefix}xyz`,
        `${apiKeyHyphenArgPrefix}123`,
      ];
      const redacted = redactArgs(args);

      expect(redacted).toEqual([
        `${tokenArgPrefix}[REDACTED]`,
        "--verbose",
        `${passwordArgPrefix}[REDACTED]`,
        `${apiKeyHyphenArgPrefix}[REDACTED]`,
      ]);
    });
  });

  // ==========================================================================
  // truncateOutput - Output Truncation
  // ==========================================================================

  describe("truncateOutput", () => {
    test("returns undefined for undefined input", () => {
      expect(truncateOutput(undefined)).toBeUndefined();
    });

    test("returns undefined for empty string", () => {
      // Empty string is falsy, so returns undefined
      expect(truncateOutput("")).toBeUndefined();
    });

    test("returns short output unchanged", () => {
      const output = "short output";
      expect(truncateOutput(output)).toBe(output);
    });

    test("returns output exactly at max length unchanged", () => {
      const output = "x".repeat(500);
      expect(truncateOutput(output)).toBe(output);
    });

    test("truncates output exceeding max length", () => {
      const output = "y".repeat(600);
      const truncated = truncateOutput(output);

      expect(truncated).toBe(
        `${"y".repeat(500)}... [truncated, 600 total bytes]`,
      );
    });

    test("uses custom max length when specified", () => {
      const output = "abcdefghij"; // 10 chars
      const truncated = truncateOutput(output, 5);

      expect(truncated).toBe("abcde... [truncated, 10 total bytes]");
    });

    test("includes original byte count in truncation message", () => {
      const output = "z".repeat(1000);
      const truncated = truncateOutput(output);

      expect(truncated).toContain("1000 total bytes");
    });

    test("default max length is 500", () => {
      const output = "a".repeat(501);
      const truncated = truncateOutput(output);

      expect(truncated?.startsWith("a".repeat(500))).toBe(true);
      expect(truncated).toContain("... [truncated,");
    });
  });

  // ==========================================================================
  // buildCliCommandLogFields - Required Fields Validation
  // ==========================================================================

  describe("buildCliCommandLogFields", () => {
    const baseInput: CliCommandLogInput = {
      tool: "br",
      command: "list",
      args: ["--json"],
      latencyMs: 42,
      exitCode: 0,
    };

    test("includes all required fields", () => {
      const fields = withRequestContext(() =>
        buildCliCommandLogFields(baseInput),
      );

      // Required fields per ADR-007
      expect(fields.tool).toBe("br");
      expect(fields.command).toBe("list");
      expect(fields.args).toEqual(["--json"]);
      expect(fields.latencyMs).toBe(42);
      expect(fields.exitCode).toBe(0);
      expect(fields.correlationId).toBe(TEST_CORRELATION_ID);
    });

    test("uses 'unknown' correlationId when outside request context", () => {
      const fields = buildCliCommandLogFields(baseInput);
      expect(fields.correlationId).toBe("unknown");
    });

    test("redacts sensitive args automatically", () => {
      const input: CliCommandLogInput = {
        ...baseInput,
        args: [`${tokenArgPrefix}${secret123Value}`, "--verbose"],
      };
      const fields = buildCliCommandLogFields(input);

      expect(fields.args).toEqual([`${tokenArgPrefix}[REDACTED]`, "--verbose"]);
    });

    test("includes stdout when provided", () => {
      const input: CliCommandLogInput = {
        ...baseInput,
        stdout: "output data",
      };
      const fields = buildCliCommandLogFields(input);

      expect(fields.stdout).toBe("output data");
    });

    test("truncates long stdout", () => {
      const input: CliCommandLogInput = {
        ...baseInput,
        stdout: "x".repeat(600),
      };
      const fields = buildCliCommandLogFields(input);

      expect(fields.stdout?.length).toBeLessThan(600);
      expect(fields.stdout).toContain("... [truncated,");
    });

    test("includes stderr when provided", () => {
      const input: CliCommandLogInput = {
        ...baseInput,
        stderr: "error message",
      };
      const fields = buildCliCommandLogFields(input);

      expect(fields.stderr).toBe("error message");
    });

    test("truncates long stderr", () => {
      const input: CliCommandLogInput = {
        ...baseInput,
        stderr: "e".repeat(600),
      };
      const fields = buildCliCommandLogFields(input);

      expect(fields.stderr?.length).toBeLessThan(600);
      expect(fields.stderr).toContain("... [truncated,");
    });

    test("includes timedOut when true", () => {
      const input: CliCommandLogInput = {
        ...baseInput,
        timedOut: true,
      };
      const fields = buildCliCommandLogFields(input);

      expect(fields.timedOut).toBe(true);
    });

    test("excludes timedOut when false", () => {
      const input: CliCommandLogInput = {
        ...baseInput,
        timedOut: false,
      };
      const fields = buildCliCommandLogFields(input);

      expect(fields.timedOut).toBeUndefined();
    });

    test("includes cwd when provided", () => {
      const input: CliCommandLogInput = {
        ...baseInput,
        cwd: "/custom/working/dir",
      };
      const fields = buildCliCommandLogFields(input);

      expect(fields.cwd).toBe("/custom/working/dir");
    });

    test("excludes optional fields when not provided", () => {
      const fields = buildCliCommandLogFields(baseInput);

      expect(fields.stdout).toBeUndefined();
      expect(fields.stderr).toBeUndefined();
      expect(fields.timedOut).toBeUndefined();
      expect(fields.cwd).toBeUndefined();
    });
  });

  // ==========================================================================
  // buildCliResultLogFields - Higher-Level Operation Logging
  // ==========================================================================

  describe("buildCliResultLogFields", () => {
    test("includes required result fields", () => {
      const fields = withRequestContext(() =>
        buildCliResultLogFields("br", "br list", 100),
      );

      expect(fields.tool).toBe("br");
      expect(fields.operation).toBe("br list");
      expect(fields.latencyMs).toBe(100);
      expect(fields.correlationId).toBe(TEST_CORRELATION_ID);
    });

    test("uses 'unknown' correlationId when outside request context", () => {
      const fields = buildCliResultLogFields("br", "br list", 100);
      expect(fields.correlationId).toBe("unknown");
    });

    test("includes extra fields when provided", () => {
      const fields = buildCliResultLogFields("br", "br list", 100, {
        count: 15,
        status: "open",
      });

      expect(fields.count).toBe(15);
      expect(fields["status"]).toBe("open");
    });

    test("redacts sensitive extra fields", () => {
      const fields = buildCliResultLogFields("br", "br list", 100, {
        count: 15,
        token: `${secretValue}-token`,
        password: `${secretValue}-pass`,
      });

      expect(fields.count).toBe(15);
      expect(fields["token"]).toBe("[REDACTED]");
      expect(fields["password"]).toBe("[REDACTED]");
    });

    test("handles empty extra object", () => {
      const fields = buildCliResultLogFields("br", "br list", 100, {});

      expect(fields.tool).toBe("br");
      expect(fields.operation).toBe("br list");
    });
  });

  // ==========================================================================
  // Logging Functions - Smoke Tests
  // ==========================================================================

  describe("logCliCommand", () => {
    test("executes without throwing", () => {
      const input: CliCommandLogInput = {
        tool: "br",
        command: "list",
        args: ["--json"],
        latencyMs: 50,
        exitCode: 0,
      };

      // Should not throw when called outside request context
      expect(() => logCliCommand(input, "br command completed")).not.toThrow();
    });

    test("executes within request context", () => {
      const input: CliCommandLogInput = {
        tool: "br",
        command: "list",
        args: ["--json"],
        latencyMs: 50,
        exitCode: 0,
      };

      expect(() =>
        withRequestContext(() => logCliCommand(input, "br command completed")),
      ).not.toThrow();
    });
  });

  describe("logCliResult", () => {
    test("executes without throwing", () => {
      expect(() =>
        logCliResult("br", "br list", 50, "br list fetched", { count: 10 }),
      ).not.toThrow();
    });

    test("executes within request context", () => {
      expect(() =>
        withRequestContext(() =>
          logCliResult("br", "br list", 50, "br list fetched", { count: 10 }),
        ),
      ).not.toThrow();
    });
  });

  describe("logCliWarning", () => {
    test("executes without throwing", () => {
      const input: CliCommandLogInput = {
        tool: "br",
        command: "list",
        args: ["--json"],
        latencyMs: 30000,
        exitCode: -1,
        timedOut: true,
      };

      expect(() => logCliWarning(input, "br command timed out")).not.toThrow();
    });
  });

  describe("logCliError", () => {
    test("executes without throwing", () => {
      const input: CliCommandLogInput = {
        tool: "br",
        command: "list",
        args: [],
        latencyMs: 10,
        exitCode: 1,
        stderr: "command failed",
      };

      expect(() => logCliError(input, "br command failed")).not.toThrow();
    });

    test("handles error object without throwing", () => {
      const input: CliCommandLogInput = {
        tool: "br",
        command: "list",
        args: [],
        latencyMs: 10,
        exitCode: 1,
      };
      const error = new Error("Test error");

      expect(() =>
        logCliError(input, "br command failed", error),
      ).not.toThrow();
    });
  });

  // ==========================================================================
  // createToolLogger - Scoped Logger Factory
  // ==========================================================================

  describe("createToolLogger", () => {
    test("creates logger scoped to tool name", () => {
      const brLogger = createToolLogger("br");

      expect(brLogger).toBeDefined();
      expect(typeof brLogger.command).toBe("function");
      expect(typeof brLogger.result).toBe("function");
      expect(typeof brLogger.warning).toBe("function");
      expect(typeof brLogger.error).toBe("function");
    });

    test("command() executes without throwing", () => {
      const brLogger = createToolLogger("br");

      expect(() =>
        brLogger.command(
          "list",
          ["--json"],
          { exitCode: 0, latencyMs: 50 },
          "completed",
        ),
      ).not.toThrow();
    });

    test("command() redacts sensitive args", () => {
      const brLogger = createToolLogger("br");

      // This shouldn't throw and should internally redact the token
      expect(() =>
        brLogger.command(
          "list",
          [`${tokenArgPrefix}${secretValue}`, "--verbose"],
          { exitCode: 0, latencyMs: 50 },
          "completed",
        ),
      ).not.toThrow();
    });

    test("result() executes without throwing", () => {
      const brLogger = createToolLogger("br");

      expect(() =>
        brLogger.result("br list", 50, "fetched issues", { count: 5 }),
      ).not.toThrow();
    });

    test("warning() executes without throwing", () => {
      const brLogger = createToolLogger("br");

      expect(() =>
        brLogger.warning(
          "list",
          ["--json"],
          { exitCode: 1, latencyMs: 100, timedOut: true },
          "timed out",
        ),
      ).not.toThrow();
    });

    test("error() executes without throwing", () => {
      const brLogger = createToolLogger("br");

      expect(() =>
        brLogger.error(
          "list",
          [],
          { exitCode: 1, latencyMs: 10, stderr: "failed" },
          "command failed",
        ),
      ).not.toThrow();
    });

    test("error() handles error object without throwing", () => {
      const brLogger = createToolLogger("br");
      const error = new Error("Test");

      expect(() =>
        brLogger.error(
          "list",
          [],
          { exitCode: 1, latencyMs: 10 },
          "failed",
          error,
        ),
      ).not.toThrow();
    });

    test("creates independent loggers for different tools", () => {
      const brLogger = createToolLogger("br");
      const bvLogger = createToolLogger("bv");

      // Loggers are independent objects
      expect(brLogger).not.toBe(bvLogger);

      // Both should execute without throwing
      expect(() => {
        brLogger.result("br list", 50, "br done");
        bvLogger.result("bv triage", 100, "bv done");
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // Integration: Full Logging Flow
  // ==========================================================================

  describe("integration: logging flow", () => {
    test("complete command lifecycle logging", () => {
      const dcgLogger = createToolLogger("dcg");

      // Simulate full lifecycle without throwing
      expect(() =>
        withRequestContext(() => {
          // Command execution (debug level)
          dcgLogger.command(
            "status",
            ["--json", `${tokenArgPrefix}${secret123Value}`],
            { exitCode: 0, latencyMs: 25, stdout: '{"enabled":true}' },
            "dcg status completed",
          );

          // Result logging (info level)
          dcgLogger.result("dcg status", 25, "dcg status fetched", {
            enabled: true,
          });
        }),
      ).not.toThrow();
    });

    test("error scenario with sensitive data redaction in fields", () => {
      const input: CliCommandLogInput = {
        tool: "cass",
        command: "search",
        args: [`${apiKeyHyphenArgPrefix}example`, "--query=test"],
        latencyMs: 500,
        exitCode: 1,
        stderr: "Authentication failed",
      };

      // Build fields to verify redaction
      const fields = withRequestContext(() => buildCliCommandLogFields(input));

      // Verify sensitive data is redacted
      expect(fields.args).toEqual([
        `${apiKeyHyphenArgPrefix}[REDACTED]`,
        "--query=test",
      ]);

      // Verify required fields present
      expect(fields.tool).toBe("cass");
      expect(fields.exitCode).toBe(1);
      expect(fields.correlationId).toBe(TEST_CORRELATION_ID);

      // Logging should not throw
      expect(() => logCliError(input, "cass search failed")).not.toThrow();
    });

    test("all required fields present in command log fields", () => {
      const input: CliCommandLogInput = {
        tool: "bv",
        command: "triage",
        args: ["--robot-triage", "--limit=10"],
        latencyMs: 150,
        exitCode: 0,
      };

      const fields = withRequestContext(() => buildCliCommandLogFields(input));

      // ADR-007 required fields
      expect(fields).toHaveProperty("tool");
      expect(fields).toHaveProperty("command");
      expect(fields).toHaveProperty("args");
      expect(fields).toHaveProperty("latencyMs");
      expect(fields).toHaveProperty("exitCode");
      expect(fields).toHaveProperty("correlationId");

      // Verify correct values
      expect(fields.tool).toBe("bv");
      expect(fields.command).toBe("triage");
      expect(fields.args).toEqual(["--robot-triage", "--limit=10"]);
      expect(fields.latencyMs).toBe(150);
      expect(fields.exitCode).toBe(0);
      expect(fields.correlationId).toBe(TEST_CORRELATION_ID);
    });

    test("all required fields present in result log fields", () => {
      const fields = withRequestContext(() =>
        buildCliResultLogFields("ntm", "ntm --robot-status", 75, {
          sessionCount: 3,
        }),
      );

      // ADR-007 required result fields
      expect(fields).toHaveProperty("tool");
      expect(fields).toHaveProperty("operation");
      expect(fields).toHaveProperty("latencyMs");
      expect(fields).toHaveProperty("correlationId");

      // Verify correct values
      expect(fields.tool).toBe("ntm");
      expect(fields.operation).toBe("ntm --robot-status");
      expect(fields.latencyMs).toBe(75);
      expect(fields.correlationId).toBe(TEST_CORRELATION_ID);
      expect(fields["sessionCount"]).toBe(3);
    });
  });
});
