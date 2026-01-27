import { describe, expect, test } from "bun:test";
import { AprClientError, createAprClient } from "../index";

function createRunner(stdout: string, exitCode = 0) {
  const calls: { command: string; args: string[] }[] = [];
  return {
    calls,
    run: async (command: string, args: string[]) => {
      calls.push({ command, args });
      return {
        stdout,
        stderr: exitCode === 0 ? "" : "apr error",
        exitCode,
      };
    },
  };
}

function envelope(
  data: unknown,
  ok = true,
  code = "OK",
  hint?: string,
): string {
  return JSON.stringify({
    ok,
    code,
    data,
    hint,
    meta: { v: "1.0.0", ts: "2026-01-27T00:00:00Z" },
  });
}

describe("APR client", () => {
  describe("getStatus command", () => {
    test("parses status response", async () => {
      const data = {
        configured: true,
        default_workflow: "main",
        workflow_count: 2,
        workflows: ["main", "backup"],
        oracle_available: true,
        oracle_method: "anthropic",
        config_dir: "/home/user/.config/apr",
        apr_home: "/home/user/.apr",
      };
      const runner = createRunner(envelope(data));
      const client = createAprClient({ runner });

      const result = await client.getStatus();

      expect(result.configured).toBe(true);
      expect(result.workflows).toHaveLength(2);
      expect(result.oracle_available).toBe(true);
      expect(runner.calls[0]?.args).toContain("robot");
      expect(runner.calls[0]?.args).toContain("status");
    });
  });

  describe("listWorkflows command", () => {
    test("parses workflows list", async () => {
      const data = {
        workflows: [
          {
            name: "main",
            description: "Primary workflow",
            path: "/path/to/main",
            rounds: 5,
            last_run: "2026-01-26T10:00:00Z",
          },
        ],
      };
      const runner = createRunner(envelope(data));
      const client = createAprClient({ runner });

      const result = await client.listWorkflows();

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("main");
      expect(result[0]?.rounds).toBe(5);
      expect(runner.calls[0]?.args).toContain("workflows");
    });

    test("returns empty array when no workflows", async () => {
      const runner = createRunner(envelope({}));
      const client = createAprClient({ runner });

      const result = await client.listWorkflows();

      expect(result).toHaveLength(0);
    });
  });

  describe("getRound command", () => {
    test("fetches round by number", async () => {
      const data = {
        round: 3,
        workflow: "main",
        status: "completed",
        created_at: "2026-01-27T00:00:00Z",
        completed_at: "2026-01-27T00:01:00Z",
        content: "# Plan content",
        metrics: {
          word_count: 500,
          section_count: 4,
          code_block_count: 2,
          convergence_score: 0.85,
        },
      };
      const runner = createRunner(envelope(data));
      const client = createAprClient({ runner });

      const result = await client.getRound(3);

      expect(result.round).toBe(3);
      expect(result.status).toBe("completed");
      expect(result.metrics?.convergence_score).toBe(0.85);
      expect(runner.calls[0]?.args).toContain("show");
      expect(runner.calls[0]?.args).toContain("3");
    });

    test("passes workflow option", async () => {
      const data = {
        round: 1,
        workflow: "backup",
        status: "pending",
      };
      const runner = createRunner(envelope(data));
      const client = createAprClient({ runner });

      await client.getRound(1, { workflow: "backup" });

      expect(runner.calls[0]?.args).toContain("-w");
      expect(runner.calls[0]?.args).toContain("backup");
    });

    test("passes includeImpl option", async () => {
      const data = {
        round: 1,
        workflow: "main",
        status: "completed",
      };
      const runner = createRunner(envelope(data));
      const client = createAprClient({ runner });

      await client.getRound(1, { includeImpl: true });

      expect(runner.calls[0]?.args).toContain("-i");
    });
  });

  describe("validateRound command", () => {
    test("returns valid when ok", async () => {
      const runner = createRunner(envelope({}));
      const client = createAprClient({ runner });

      const result = await client.validateRound(2);

      expect(result.valid).toBe(true);
      expect(result.issues).toBeUndefined();
      expect(runner.calls[0]?.args).toContain("validate");
      expect(runner.calls[0]?.args).toContain("2");
    });

    test("returns issues when not valid", async () => {
      const data = { issues: ["Missing section", "Invalid format"] };
      const runner = createRunner(envelope(data, false, "VALIDATION_ERROR"));
      const client = createAprClient({ runner });

      const result = await client.validateRound(2);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain("Missing section");
    });

    test("uses hint when no issues", async () => {
      const runner = createRunner(
        envelope({}, false, "VALIDATION_ERROR", "Parse error on line 5"),
      );
      const client = createAprClient({ runner });

      const result = await client.validateRound(2);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain("Parse error on line 5");
    });
  });

  describe("runRound command", () => {
    test("runs revision round", async () => {
      const data = {
        round: 4,
        workflow: "main",
        status: "completed",
        completed_at: "2026-01-27T00:05:00Z",
      };
      const runner = createRunner(envelope(data));
      const client = createAprClient({ runner });

      const result = await client.runRound(4);

      expect(result.round).toBe(4);
      expect(result.status).toBe("completed");
      expect(runner.calls[0]?.args).toContain("run");
      expect(runner.calls[0]?.args).toContain("4");
    });
  });

  describe("getHistory command", () => {
    test("fetches workflow history", async () => {
      const data = {
        workflow: "main",
        rounds: [
          { round: 1, workflow: "main", status: "completed" },
          { round: 2, workflow: "main", status: "completed" },
        ],
        total: 2,
      };
      const runner = createRunner(envelope(data));
      const client = createAprClient({ runner });

      const result = await client.getHistory();

      expect(result.total).toBe(2);
      expect(result.rounds).toHaveLength(2);
      expect(runner.calls[0]?.args).toContain("history");
    });

    test("passes workflow option", async () => {
      const data = { workflow: "backup", rounds: [], total: 0 };
      const runner = createRunner(envelope(data));
      const client = createAprClient({ runner });

      await client.getHistory({ workflow: "backup" });

      expect(runner.calls[0]?.args).toContain("-w");
      expect(runner.calls[0]?.args).toContain("backup");
    });
  });

  describe("diffRounds command", () => {
    test("diffs two rounds", async () => {
      const data = {
        round_a: 1,
        round_b: 2,
        workflow: "main",
        additions: 15,
        deletions: 3,
        changes: ["+ Added section", "- Removed paragraph"],
      };
      const runner = createRunner(envelope(data));
      const client = createAprClient({ runner });

      const result = await client.diffRounds(1, 2);

      expect(result.additions).toBe(15);
      expect(result.deletions).toBe(3);
      expect(result.changes).toHaveLength(2);
      expect(runner.calls[0]?.args).toContain("diff");
      expect(runner.calls[0]?.args).toContain("1");
      expect(runner.calls[0]?.args).toContain("2");
    });

    test("diffs single round against previous", async () => {
      const data = {
        round_a: 2,
        round_b: 3,
        workflow: "main",
        additions: 5,
        deletions: 1,
        changes: [],
      };
      const runner = createRunner(envelope(data));
      const client = createAprClient({ runner });

      await client.diffRounds(3);

      expect(runner.calls[0]?.args).toContain("diff");
      expect(runner.calls[0]?.args).toContain("3");
      expect(runner.calls[0]?.args).not.toContain("2");
    });
  });

  describe("getIntegrationPrompt command", () => {
    test("fetches integration prompt", async () => {
      const data = {
        round: 3,
        workflow: "main",
        prompt: "Integrate the following changes...",
        include_impl: false,
      };
      const runner = createRunner(envelope(data));
      const client = createAprClient({ runner });

      const result = await client.getIntegrationPrompt(3);

      expect(result.prompt).toContain("Integrate");
      expect(result.include_impl).toBe(false);
      expect(runner.calls[0]?.args).toContain("integrate");
    });
  });

  describe("getStats command", () => {
    test("fetches workflow stats", async () => {
      const data = {
        word_count: 2500,
        section_count: 12,
        code_block_count: 8,
        convergence_score: 0.92,
        convergence_trend: [0.7, 0.8, 0.85, 0.92],
      };
      const runner = createRunner(envelope(data));
      const client = createAprClient({ runner });

      const result = await client.getStats();

      expect(result.word_count).toBe(2500);
      expect(result.convergence_score).toBe(0.92);
      expect(result.convergence_trend).toHaveLength(4);
      expect(runner.calls[0]?.args).toContain("stats");
    });
  });

  describe("isAvailable", () => {
    test("returns true when apr responds", async () => {
      const runner = createRunner("apr v1.0.0");
      const client = createAprClient({ runner });

      const available = await client.isAvailable();

      expect(available).toBe(true);
      expect(runner.calls[0]?.args).toContain("--version");
    });

    test("returns false when apr fails", async () => {
      const runner = createRunner("", 127);
      const client = createAprClient({ runner });

      const available = await client.isAvailable();

      expect(available).toBe(false);
    });
  });

  describe("getVersion", () => {
    test("extracts version from output", async () => {
      const runner = createRunner("apr v1.2.3");
      const client = createAprClient({ runner });

      const version = await client.getVersion();

      expect(version).toBe("1.2.3");
    });

    test("returns null when version not found", async () => {
      const runner = createRunner("", 1);
      const client = createAprClient({ runner });

      const version = await client.getVersion();

      expect(version).toBeNull();
    });
  });

  describe("error handling", () => {
    test("throws AprClientError on command failure", async () => {
      const runner = createRunner("", 1);
      const client = createAprClient({ runner });

      let thrown: unknown;
      try {
        await client.getStatus();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(AprClientError);
      expect((thrown as AprClientError).kind).toBe("command_failed");
    });

    test("throws parse_error on invalid JSON", async () => {
      const runner = createRunner("not json {{");
      const client = createAprClient({ runner });

      let thrown: unknown;
      try {
        await client.getStatus();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(AprClientError);
      expect((thrown as AprClientError).kind).toBe("parse_error");
    });

    test("throws validation_error on schema mismatch", async () => {
      // Missing required 'configured' field
      const runner = createRunner(envelope({ workflows: [] }));
      const client = createAprClient({ runner });

      let thrown: unknown;
      try {
        await client.getStatus();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(AprClientError);
      expect((thrown as AprClientError).kind).toBe("validation_error");
    });

    test("throws command_failed when envelope ok is false", async () => {
      const runner = createRunner(
        envelope({}, false, "ERR_CONFIG", "Config not found"),
      );
      const client = createAprClient({ runner });

      let thrown: unknown;
      try {
        await client.getStatus();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(AprClientError);
      expect((thrown as AprClientError).kind).toBe("command_failed");
      expect((thrown as AprClientError).details?.hint).toBe("Config not found");
    });

    test("error includes diagnostic details", async () => {
      const runner = createRunner("", 42);
      const client = createAprClient({ runner });

      let thrown: unknown;
      try {
        await client.getHistory();
      } catch (error) {
        thrown = error;
      }

      const details = (thrown as AprClientError).details;
      expect(details?.exitCode).toBe(42);
      expect(details?.args).toBeDefined();
    });
  });

  describe("command options", () => {
    test("passes cwd option", async () => {
      const calls: { cwd?: string }[] = [];
      const runner = {
        run: async (
          _command: string,
          _args: string[],
          options?: { cwd?: string },
        ) => {
          calls.push({ cwd: options?.cwd });
          const data = {
            configured: true,
            default_workflow: "main",
            workflow_count: 0,
            workflows: [],
            oracle_available: false,
            oracle_method: "none",
            config_dir: "",
            apr_home: "",
          };
          return { stdout: envelope(data), stderr: "", exitCode: 0 };
        },
      };
      const client = createAprClient({ runner, cwd: "/custom/path" });

      await client.getStatus();

      expect(calls[0]?.cwd).toBe("/custom/path");
    });

    test("passes timeout option", async () => {
      const calls: { timeout?: number }[] = [];
      const runner = {
        run: async (
          _command: string,
          _args: string[],
          options?: { timeout?: number },
        ) => {
          calls.push({ timeout: options?.timeout });
          const data = {
            configured: true,
            default_workflow: "main",
            workflow_count: 0,
            workflows: [],
            oracle_available: false,
            oracle_method: "none",
            config_dir: "",
            apr_home: "",
          };
          return { stdout: envelope(data), stderr: "", exitCode: 0 };
        },
      };
      const client = createAprClient({ runner, timeout: 30000 });

      await client.getStatus({ timeout: 10000 });

      expect(calls[0]?.timeout).toBe(10000);
    });
  });
});
