import { describe, expect, test } from "bun:test";
import {
  CMClientError,
  createCMClient,
  type CMCommandRunner,
  type CMContextResult,
  type CMQuickstartResult,
  type CMStatsResult,
  type CMPlaybookListResult,
  type CMDoctorResult,
  type CMOutcomeResult,
} from "../index";

/**
 * Helper to create a mock command runner with predefined responses
 */
function createRunner(
  stdout: string,
  exitCode = 0,
): CMCommandRunner & {
  calls: Array<{ command: string; args: string[] }>;
} {
  const calls: Array<{ command: string; args: string[] }> = [];
  return {
    calls,
    run: async (command: string, args: string[]) => {
      calls.push({ command, args });
      return {
        stdout,
        stderr: exitCode === 0 ? "" : "error output",
        exitCode,
      };
    },
  };
}

/**
 * Helper to create runner that responds differently based on command/args
 */
function createRunnerWithMap(
  map: Record<string, { stdout: string; exitCode?: number }>,
): CMCommandRunner & { calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = [];
  return {
    calls,
    run: async (command: string, args: string[]) => {
      calls.push({ command, args });
      // Try matching by command subcommand (e.g., "context my-task --json")
      const key = args.join(" ");
      for (const [pattern, entry] of Object.entries(map)) {
        if (key.includes(pattern) || pattern === key) {
          return {
            stdout: entry.stdout,
            stderr: entry.exitCode === 0 ? "" : "error",
            exitCode: entry.exitCode ?? 0,
          };
        }
      }
      return {
        stdout: "",
        stderr: "No matching response",
        exitCode: 1,
      };
    },
  };
}

// Sample CM responses for tests
const sampleContextResult: CMContextResult = {
  success: true,
  task: "implement feature X",
  relevantBullets: [
    {
      id: "rule-001",
      text: "Always use TypeScript strict mode",
      category: "coding",
      scope: "typescript",
      state: "active",
      kind: "rule",
      confidence: 0.95,
      sourceCount: 5,
      score: 0.9,
    },
    {
      id: "rule-002",
      text: "Prefer functional components in React",
      category: "coding",
      scope: "react",
      state: "active",
      kind: "rule",
      confidence: 0.85,
      score: 0.8,
    },
  ],
  antiPatterns: [
    {
      id: "anti-001",
      text: "Avoid using any type",
      category: "coding",
      state: "active",
      kind: "anti-pattern",
      confidence: 0.9,
      score: 0.85,
    },
  ],
  historySnippets: [
    {
      source_path: "/path/to/session.json",
      line_number: 42,
      agent: "claude",
      workspace: "my-project",
      snippet: "Fixed TypeScript error by adding strict types",
      score: 0.75,
    },
  ],
};

const sampleQuickstartResult: CMQuickstartResult = {
  success: true,
  summary: "CM provides procedural memory for AI assistants",
  oneCommand: "cm context 'my task'",
  expectations: {
    input: "Task description or context",
    output: "Relevant rules and history",
  },
  whatItReturns: ["Relevant rules", "Anti-patterns", "History snippets"],
  doNotDo: ["Ignore returned rules", "Skip context queries"],
  protocol: {
    start: "Query context at session start",
    end: "Record outcome at session end",
  },
  examples: ["cm context 'fix bug in auth'", "cm outcome success rule-001"],
};

const sampleStatsResult: CMStatsResult = {
  success: true,
  total: 42,
  byScope: {
    typescript: 15,
    react: 12,
    python: 10,
    general: 5,
  },
  byState: {
    active: 35,
    deprecated: 5,
    pending: 2,
  },
  byKind: {
    rule: 30,
    "anti-pattern": 8,
    procedure: 4,
  },
  scoreDistribution: {
    excellent: 10,
    good: 20,
    neutral: 8,
    atRisk: 4,
  },
  topPerformers: [
    {
      id: "rule-001",
      text: "Always use TypeScript strict mode",
      score: 0.95,
    },
  ],
  mostHelpful: [
    {
      id: "rule-002",
      text: "Prefer functional components",
      helpfulCount: 15,
    },
  ],
  atRiskCount: 4,
  staleCount: 2,
};

const samplePlaybookListResult: CMPlaybookListResult = {
  success: true,
  bullets: [
    {
      id: "rule-001",
      text: "Always use TypeScript strict mode",
      category: "coding",
      scope: "typescript",
      state: "active",
      kind: "rule",
    },
    {
      id: "rule-002",
      text: "Prefer functional components",
      category: "coding",
      scope: "react",
      state: "active",
      kind: "rule",
    },
  ],
};

const sampleDoctorResult: CMDoctorResult = {
  success: true,
  version: "1.2.3",
  generatedAt: "2026-01-12T00:00:00Z",
  overallStatus: "healthy",
  checks: [
    {
      category: "database",
      item: "Connection",
      status: "pass",
      message: "Database connection healthy",
    },
    {
      category: "rules",
      item: "Stale rules",
      status: "warn",
      message: "2 rules haven't been applied in 30 days",
      details: { count: 2 },
    },
  ],
};

const sampleOutcomeResult: CMOutcomeResult = {
  success: true,
  message: "Outcome recorded successfully",
  recorded: 3,
};

describe("CM Client", () => {
  describe("isAvailable", () => {
    test("returns true when cm --version succeeds", async () => {
      const runner = createRunner("cm v1.2.3");
      const client = createCMClient({ runner });

      const available = await client.isAvailable();

      expect(available).toBe(true);
      expect(runner.calls[0]?.command).toBe("cm");
      expect(runner.calls[0]?.args).toContain("--version");
    });

    test("returns false when cm --version fails", async () => {
      const runner = createRunner("", 127);
      const client = createCMClient({ runner });

      const available = await client.isAvailable();

      expect(available).toBe(false);
    });
  });

  describe("context", () => {
    test("retrieves context for a task", async () => {
      const runner = createRunner(JSON.stringify(sampleContextResult));
      const client = createCMClient({ runner });

      const result = await client.context("implement feature X");

      expect(result.success).toBe(true);
      expect(result.task).toBe("implement feature X");
      expect(result.relevantBullets).toHaveLength(2);
      expect(result.antiPatterns).toHaveLength(1);
      expect(result.historySnippets).toHaveLength(1);
      expect(runner.calls[0]?.args).toContain("context");
      expect(runner.calls[0]?.args).toContain("implement feature X");
      expect(runner.calls[0]?.args).toContain("--json");
    });

    test("passes context options correctly", async () => {
      const runner = createRunner(JSON.stringify(sampleContextResult));
      const client = createCMClient({ runner });

      await client.context("my task", {
        workspace: "my-project",
        top: 10,
        history: 5,
        days: 30,
        session: "session-123",
        logContext: true,
      });

      expect(runner.calls[0]?.args).toContain("--workspace");
      expect(runner.calls[0]?.args).toContain("my-project");
      expect(runner.calls[0]?.args).toContain("--top");
      expect(runner.calls[0]?.args).toContain("10");
      expect(runner.calls[0]?.args).toContain("--history");
      expect(runner.calls[0]?.args).toContain("5");
      expect(runner.calls[0]?.args).toContain("--days");
      expect(runner.calls[0]?.args).toContain("30");
      expect(runner.calls[0]?.args).toContain("--session");
      expect(runner.calls[0]?.args).toContain("session-123");
      expect(runner.calls[0]?.args).toContain("--log-context");
    });

    test("includes confidence scores in returned rules", async () => {
      const runner = createRunner(JSON.stringify(sampleContextResult));
      const client = createCMClient({ runner });

      const result = await client.context("my task");

      expect(result.relevantBullets[0]?.confidence).toBe(0.95);
      expect(result.relevantBullets[1]?.confidence).toBe(0.85);
    });
  });

  describe("quickstart", () => {
    test("retrieves quickstart documentation", async () => {
      const runner = createRunner(JSON.stringify(sampleQuickstartResult));
      const client = createCMClient({ runner });

      const result = await client.quickstart();

      expect(result.success).toBe(true);
      expect(result.summary).toContain("procedural memory");
      expect(result.oneCommand).toBe("cm context 'my task'");
      expect(result.whatItReturns).toHaveLength(3);
      expect(runner.calls[0]?.args).toContain("quickstart");
      expect(runner.calls[0]?.args).toContain("--json");
    });
  });

  describe("stats", () => {
    test("retrieves playbook statistics", async () => {
      const runner = createRunner(JSON.stringify(sampleStatsResult));
      const client = createCMClient({ runner });

      const result = await client.stats();

      expect(result.success).toBe(true);
      expect(result.total).toBe(42);
      expect(result.byScope.typescript).toBe(15);
      expect(result.byState.active).toBe(35);
      expect(result.scoreDistribution.excellent).toBe(10);
      expect(result.topPerformers).toHaveLength(1);
      expect(runner.calls[0]?.args).toContain("stats");
    });
  });

  describe("listPlaybook", () => {
    test("lists playbook bullets", async () => {
      const runner = createRunner(JSON.stringify(samplePlaybookListResult));
      const client = createCMClient({ runner });

      const result = await client.listPlaybook();

      expect(result.success).toBe(true);
      expect(result.bullets).toHaveLength(2);
      expect(result.bullets[0]?.id).toBe("rule-001");
      expect(runner.calls[0]?.args).toContain("playbook");
      expect(runner.calls[0]?.args).toContain("list");
    });

    test("passes filter options correctly", async () => {
      const runner = createRunner(JSON.stringify(samplePlaybookListResult));
      const client = createCMClient({ runner });

      await client.listPlaybook({
        category: "coding",
        scope: "typescript",
        state: "active",
        kind: "rule",
        limit: 20,
      });

      expect(runner.calls[0]?.args).toContain("--category");
      expect(runner.calls[0]?.args).toContain("coding");
      expect(runner.calls[0]?.args).toContain("--scope");
      expect(runner.calls[0]?.args).toContain("typescript");
      expect(runner.calls[0]?.args).toContain("--state");
      expect(runner.calls[0]?.args).toContain("active");
      expect(runner.calls[0]?.args).toContain("--kind");
      expect(runner.calls[0]?.args).toContain("rule");
      expect(runner.calls[0]?.args).toContain("--limit");
      expect(runner.calls[0]?.args).toContain("20");
    });
  });

  describe("doctor", () => {
    test("runs health diagnostics", async () => {
      const runner = createRunner(JSON.stringify(sampleDoctorResult));
      const client = createCMClient({ runner });

      const result = await client.doctor();

      expect(result.success).toBe(true);
      expect(result.overallStatus).toBe("healthy");
      expect(result.version).toBe("1.2.3");
      expect(result.checks).toHaveLength(2);
      expect(result.checks[0]?.status).toBe("pass");
      expect(result.checks[1]?.status).toBe("warn");
    });

    test("passes fix option when requested", async () => {
      const runner = createRunner(JSON.stringify(sampleDoctorResult));
      const client = createCMClient({ runner });

      await client.doctor({ fix: true });

      expect(runner.calls[0]?.args).toContain("--fix");
    });
  });

  describe("outcome", () => {
    test("records session outcome", async () => {
      const runner = createRunner(JSON.stringify(sampleOutcomeResult));
      const client = createCMClient({ runner });

      const result = await client.outcome("success", ["rule-001", "rule-002"]);

      expect(result.success).toBe(true);
      expect(result.recorded).toBe(3);
      expect(runner.calls[0]?.args).toContain("outcome");
      expect(runner.calls[0]?.args).toContain("success");
      expect(runner.calls[0]?.args).toContain("rule-001,rule-002");
    });

    test("passes session option when provided", async () => {
      const runner = createRunner(JSON.stringify(sampleOutcomeResult));
      const client = createCMClient({ runner });

      await client.outcome("failure", ["rule-001"], { session: "session-456" });

      expect(runner.calls[0]?.args).toContain("--session");
      expect(runner.calls[0]?.args).toContain("session-456");
    });

    test("handles partial outcome status", async () => {
      const runner = createRunner(JSON.stringify(sampleOutcomeResult));
      const client = createCMClient({ runner });

      await client.outcome("partial", ["rule-001"]);

      expect(runner.calls[0]?.args).toContain("partial");
    });
  });

  describe("error handling", () => {
    test("throws CMClientError on command failure", async () => {
      const runner = createRunner("", 1);
      const client = createCMClient({ runner });

      let thrown: unknown;
      try {
        await client.context("my task");
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(CMClientError);
      expect((thrown as CMClientError).kind).toBe("command_failed");
    });

    test("throws CMClientError on parse error", async () => {
      const runner = createRunner("not-valid-json");
      const client = createCMClient({ runner });

      let thrown: unknown;
      try {
        await client.context("my task");
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(CMClientError);
      expect((thrown as CMClientError).kind).toBe("parse_error");
    });

    test("throws CMClientError on validation error", async () => {
      const runner = createRunner(JSON.stringify({ invalid: "response" }));
      const client = createCMClient({ runner });

      let thrown: unknown;
      try {
        await client.context("my task");
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(CMClientError);
      expect((thrown as CMClientError).kind).toBe("validation_error");
    });

    test("CMClientError includes kind and details", () => {
      const error = new CMClientError("command_failed", "Test error", {
        exitCode: 127,
        stderr: "cm: command not found",
      });

      expect(error.kind).toBe("command_failed");
      expect(error.message).toBe("Test error");
      expect(error.details?.exitCode).toBe(127);
    });
  });

  describe("client options", () => {
    test("uses provided cwd", async () => {
      const runner = createRunner(JSON.stringify(sampleContextResult));
      let capturedOptions: { cwd?: string } | undefined;
      const runnerWithCapture: CMCommandRunner = {
        run: async (command, args, options) => {
          capturedOptions = options;
          return runner.run(command, args, options);
        },
      };
      const client = createCMClient({
        runner: runnerWithCapture,
        cwd: "/custom/path",
      });

      await client.context("my task");

      expect(capturedOptions?.cwd).toBe("/custom/path");
    });

    test("uses custom timeout", async () => {
      const runner = createRunner(JSON.stringify(sampleContextResult));
      let capturedTimeout: number | undefined;
      const runnerWithCapture: CMCommandRunner = {
        run: async (command, args, options) => {
          capturedTimeout = options?.timeout;
          return runner.run(command, args, options);
        },
      };
      const client = createCMClient({
        runner: runnerWithCapture,
        timeout: 60000,
      });

      await client.context("my task");

      expect(capturedTimeout).toBe(60000);
    });
  });
});
