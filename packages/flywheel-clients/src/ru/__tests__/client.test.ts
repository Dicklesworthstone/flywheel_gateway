import { describe, expect, test } from "bun:test";
import {
  createRuClient,
  RuClientError,
  type RuCommandRunner,
  type RuCommandResult,
} from "../index";

// ============================================================================
// Test Helpers
// ============================================================================

function createRunner(
  stdout: string,
  exitCode = 0,
): {
  calls: {
    command: string;
    args: string[];
    options?: { cwd?: string; timeout?: number };
  }[];
  run: RuCommandRunner["run"];
} {
  const calls: {
    command: string;
    args: string[];
    options?: { cwd?: string; timeout?: number };
  }[] = [];
  return {
    calls,
    run: async (command, args, options) => {
      // Only include options property if defined (exactOptionalPropertyTypes)
      const call: {
        command: string;
        args: string[];
        options?: { cwd?: string; timeout?: number };
      } = { command, args };
      if (options !== undefined) {
        call.options = options;
      }
      calls.push(call);
      return {
        stdout,
        stderr: exitCode === 0 ? "" : "error from ru",
        exitCode,
      };
    },
  };
}

function createRunnerWithMap(
  map: Record<string, { stdout: string; exitCode?: number }>,
): {
  calls: { command: string; args: string[] }[];
  run: RuCommandRunner["run"];
} {
  const calls: { command: string; args: string[] }[] = [];
  return {
    calls,
    run: async (command, args) => {
      calls.push({ command, args });
      // Match based on first argument (subcommand)
      const subcommand = args[0] ?? "";
      const entry = map[subcommand] ?? { stdout: "", exitCode: 1 };
      return {
        stdout: entry.stdout,
        stderr: entry.exitCode === 0 ? "" : "error",
        exitCode: entry.exitCode ?? 0,
      };
    },
  };
}

// ============================================================================
// Version Command Tests
// ============================================================================

describe("RU client", () => {
  describe("version command", () => {
    test("parses JSON version output", async () => {
      const versionInfo = {
        version: "1.2.3",
        commit: "abc123",
        date: "2026-01-27",
      };
      const runner = createRunner(JSON.stringify(versionInfo));
      const client = createRuClient({ runner });

      const result = await client.version();

      expect(result.version).toBe("1.2.3");
      expect(result.commit).toBe("abc123");
      expect(runner.calls[0]?.args).toContain("--version");
      expect(runner.calls[0]?.args).toContain("--json");
    });

    test("falls back to plain text version parsing", async () => {
      const runner = createRunner("ru v1.5.0");
      const client = createRuClient({ runner });

      const result = await client.version();

      expect(result.version).toBe("1.5.0");
    });

    test("throws on command failure", async () => {
      const runner = createRunner("", 1);
      const client = createRuClient({ runner });

      let thrown: unknown;
      try {
        await client.version();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(RuClientError);
      expect((thrown as RuClientError).kind).toBe("command_failed");
    });
  });

  // ============================================================================
  // Status Command Tests
  // ============================================================================

  describe("status command", () => {
    test("parses fleet status", async () => {
      const status = {
        repos: 10,
        cloned: 8,
        dirty: 1,
        synced: 7,
        last_sync: "2026-01-27T12:00:00Z",
      };
      const runner = createRunner(JSON.stringify(status));
      const client = createRuClient({ runner });

      const result = await client.status();

      expect(result.repos).toBe(10);
      expect(result.cloned).toBe(8);
      expect(result.dirty).toBe(1);
      expect(runner.calls[0]?.args).toContain("status");
      expect(runner.calls[0]?.args).toContain("--json");
    });

    test("throws on command failure", async () => {
      const runner = createRunner("", 1);
      const client = createRuClient({ runner });

      let thrown: unknown;
      try {
        await client.status();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(RuClientError);
      expect((thrown as RuClientError).kind).toBe("command_failed");
    });
  });

  // ============================================================================
  // List Command Tests
  // ============================================================================

  describe("list command", () => {
    test("parses repo list", async () => {
      const repos = [
        { name: "repo1", fullName: "owner/repo1", cloned: true },
        { name: "repo2", fullName: "owner/repo2", cloned: false },
      ];
      const runner = createRunner(JSON.stringify(repos));
      const client = createRuClient({ runner });

      const result = await client.list();

      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe("repo1");
      expect(result[0]?.fullName).toBe("owner/repo1");
      expect(runner.calls[0]?.args).toContain("list");
      expect(runner.calls[0]?.args).toContain("--json");
    });

    test("handles single repo as array", async () => {
      const repo = { name: "single-repo", fullName: "owner/single-repo" };
      const runner = createRunner(JSON.stringify(repo));
      const client = createRuClient({ runner });

      const result = await client.list();

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("single-repo");
    });

    test("handles empty output as empty array", async () => {
      const runner = createRunner("");
      const client = createRuClient({ runner });

      const result = await client.list();

      expect(result).toEqual([]);
    });

    test("passes filter options", async () => {
      const runner = createRunner("[]");
      const client = createRuClient({ runner });

      await client.list({
        group: "backend",
        owner: "myorg",
        clonedOnly: true,
      });

      const args = runner.calls[0]?.args ?? [];
      expect(args).toContain("--group");
      expect(args).toContain("backend");
      expect(args).toContain("--owner");
      expect(args).toContain("myorg");
      expect(args).toContain("--cloned");
    });

    test("throws on command failure", async () => {
      const runner = createRunner("", 1);
      const client = createRuClient({ runner });

      let thrown: unknown;
      try {
        await client.list();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(RuClientError);
      expect((thrown as RuClientError).kind).toBe("command_failed");
    });

    test("throws on invalid JSON", async () => {
      const runner = createRunner("not valid json {");
      const client = createRuClient({ runner });

      let thrown: unknown;
      try {
        await client.list();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(RuClientError);
      expect((thrown as RuClientError).kind).toBe("parse_error");
    });
  });

  // ============================================================================
  // Sync Command Tests
  // ============================================================================

  describe("sync command", () => {
    test("syncs repository and parses result", async () => {
      const syncResult = {
        success: true,
        repo: "owner/repo",
        commit: "def456",
        commits: 3,
        files: 12,
      };
      const runner = createRunner(JSON.stringify(syncResult));
      const client = createRuClient({ runner });

      const result = await client.sync("owner/repo");

      expect(result.success).toBe(true);
      expect(result.commit).toBe("def456");
      expect(result.commits).toBe(3);
      expect(runner.calls[0]?.args).toContain("sync");
      expect(runner.calls[0]?.args).toContain("--json");
      expect(runner.calls[0]?.args).toContain("owner/repo");
    });

    test("passes force and dryRun options", async () => {
      const runner = createRunner(JSON.stringify({ success: true }));
      const client = createRuClient({ runner });

      await client.sync("owner/repo", { force: true, dryRun: true });

      const args = runner.calls[0]?.args ?? [];
      expect(args).toContain("--force");
      expect(args).toContain("--dry-run");
    });

    test("captures error in result on non-zero exit", async () => {
      const runner = createRunner(JSON.stringify({ success: false }), 1);
      const client = createRuClient({ runner });

      const result = await client.sync("owner/repo");

      expect(result.error).toBeDefined();
    });

    test("throws on parse error with non-zero exit", async () => {
      const runner = createRunner("not json", 1);
      const client = createRuClient({ runner });

      let thrown: unknown;
      try {
        await client.sync("owner/repo");
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(RuClientError);
      expect((thrown as RuClientError).kind).toBe("command_failed");
    });
  });

  // ============================================================================
  // Sweep Phase 1 Tests
  // ============================================================================

  describe("sweepPhase1 command", () => {
    test("runs phase 1 analysis", async () => {
      const phase1Result = {
        phase: "1",
        success: true,
        repo: "owner/repo",
        message: "Analysis complete",
        duration_ms: 1500,
      };
      const runner = createRunner(JSON.stringify(phase1Result));
      const client = createRuClient({ runner });

      const result = await client.sweepPhase1("owner/repo");

      expect(result.success).toBe(true);
      expect(result.phase).toBe("1");
      const args = runner.calls[0]?.args ?? [];
      expect(args).toContain("agent-sweep");
      expect(args).toContain("--phase");
      expect(args).toContain("1");
      expect(args).toContain("--json");
      expect(args).toContain("--timeout");
      expect(args).toContain("owner/repo");
    });

    test("passes dryRun option", async () => {
      const runner = createRunner(JSON.stringify({ success: true }));
      const client = createRuClient({ runner });

      await client.sweepPhase1("owner/repo", { dryRun: true });

      const args = runner.calls[0]?.args ?? [];
      expect(args).toContain("--dry-run");
    });

    test("uses custom timeout", async () => {
      const runner = createRunner(JSON.stringify({ success: true }));
      const client = createRuClient({ runner });

      await client.sweepPhase1("owner/repo", { timeout: 600000 });

      const args = runner.calls[0]?.args ?? [];
      expect(args).toContain("--timeout");
      expect(args).toContain("600000");
    });

    test("captures error on non-zero exit", async () => {
      const runner = createRunner(JSON.stringify({ success: false }), 1);
      const client = createRuClient({ runner });

      const result = await client.sweepPhase1("owner/repo");

      expect(result.error).toBeDefined();
    });
  });

  // ============================================================================
  // Sweep Phase 2 Tests
  // ============================================================================

  describe("sweepPhase2 command", () => {
    test("runs phase 2 planning", async () => {
      const phase2Result = {
        phase: "2",
        success: true,
        repo: "owner/repo",
        plan: { actions: [{ type: "commit" }] },
        duration_ms: 3000,
      };
      const runner = createRunner(JSON.stringify(phase2Result));
      const client = createRuClient({ runner });

      const result = await client.sweepPhase2("owner/repo");

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      const args = runner.calls[0]?.args ?? [];
      expect(args).toContain("agent-sweep");
      expect(args).toContain("--phase");
      expect(args).toContain("2");
      expect(args).toContain("--json");
      expect(args).toContain("--timeout");
    });

    test("has longer default timeout", async () => {
      const runner = createRunner(JSON.stringify({ success: true }));
      const client = createRuClient({ runner });

      await client.sweepPhase2("owner/repo");

      // Phase 2 CLI timeout is 600000ms (10 minutes), runner adds 5s buffer
      const options = runner.calls[0]?.options;
      expect(options?.timeout).toBe(605000);
    });
  });

  // ============================================================================
  // Sweep Phase 3 Tests
  // ============================================================================

  describe("sweepPhase3 command", () => {
    test("runs phase 3 execution with plan file", async () => {
      const phase3Result = {
        phase: "3",
        success: true,
        repo: "owner/repo",
        message: "Execution complete",
        duration_ms: 2000,
      };
      const runner = createRunner(JSON.stringify(phase3Result));
      const client = createRuClient({ runner });

      const result = await client.sweepPhase3(
        "owner/repo",
        "/path/to/plan.json",
      );

      expect(result.success).toBe(true);
      const args = runner.calls[0]?.args ?? [];
      expect(args).toContain("agent-sweep");
      expect(args).toContain("--phase");
      expect(args).toContain("3");
      expect(args).toContain("--json");
      expect(args).toContain("--timeout");
      expect(args).toContain("--plan-file");
      expect(args).toContain("/path/to/plan.json");
      expect(args).toContain("owner/repo");
    });

    test("passes autoApprove option", async () => {
      const runner = createRunner(JSON.stringify({ success: true }));
      const client = createRuClient({ runner });

      await client.sweepPhase3("owner/repo", "/path/to/plan.json", {
        autoApprove: true,
      });

      const args = runner.calls[0]?.args ?? [];
      expect(args).toContain("--auto-approve");
    });

    test("passes dryRun option", async () => {
      const runner = createRunner(JSON.stringify({ success: true }));
      const client = createRuClient({ runner });

      await client.sweepPhase3("owner/repo", "/path/to/plan.json", {
        dryRun: true,
      });

      const args = runner.calls[0]?.args ?? [];
      expect(args).toContain("--dry-run");
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe("error handling", () => {
    test("throws RuClientError on command failure", async () => {
      const runner = createRunner("", 1);
      const client = createRuClient({ runner });

      let thrown: unknown;
      try {
        await client.status();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(RuClientError);
      expect((thrown as RuClientError).kind).toBe("command_failed");
    });

    test("throws parse_error on invalid JSON", async () => {
      const runner = createRunner("not valid json {");
      const client = createRuClient({ runner });

      let thrown: unknown;
      try {
        await client.status();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(RuClientError);
      expect((thrown as RuClientError).kind).toBe("parse_error");
    });

    test("error includes diagnostic details", async () => {
      const runner = createRunner("", 42);
      const client = createRuClient({ runner });

      let thrown: unknown;
      try {
        await client.status();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(RuClientError);
      const details = (thrown as RuClientError).details;
      expect(details?.exitCode).toBe(42);
    });
  });

  // ============================================================================
  // Global Options Tests
  // ============================================================================

  describe("global options", () => {
    test("passes cwd option from client config", async () => {
      const runner = createRunner(JSON.stringify({ repos: 0 }));
      const client = createRuClient({ runner, cwd: "/custom/path" });

      await client.status();

      const options = runner.calls[0]?.options;
      expect(options?.cwd).toBe("/custom/path");
    });

    test("passes timeout option from client config", async () => {
      const runner = createRunner(JSON.stringify({ repos: 0 }));
      const client = createRuClient({ runner, timeout: 30000 });

      await client.status();

      const options = runner.calls[0]?.options;
      expect(options?.timeout).toBe(30000);
    });

    test("per-call options override client config", async () => {
      const runner = createRunner(JSON.stringify({ repos: 0 }));
      const client = createRuClient({
        runner,
        cwd: "/default",
        timeout: 10000,
      });

      await client.status({ cwd: "/override", timeout: 5000 });

      const options = runner.calls[0]?.options;
      expect(options?.cwd).toBe("/override");
      expect(options?.timeout).toBe(5000);
    });
  });

  // ============================================================================
  // JSON Extraction Tests
  // ============================================================================

  describe("JSON extraction", () => {
    test("extracts JSON from output with leading text", async () => {
      const jsonData = { repos: 5 };
      const stdout = `Some debug output\n${JSON.stringify(jsonData)}`;
      const runner = createRunner(stdout);
      const client = createRuClient({ runner });

      const result = await client.status();

      expect(result.repos).toBe(5);
    });

    test("extracts JSON from output with trailing text", async () => {
      const jsonData = { repos: 5 };
      const stdout = `${JSON.stringify(jsonData)}\nSome trailing text`;
      const runner = createRunner(stdout);
      const client = createRuClient({ runner });

      const result = await client.status();

      expect(result.repos).toBe(5);
    });

    test("extracts JSON array from mixed output", async () => {
      const jsonData = [{ name: "repo1" }];
      const stdout = `Loading...\n${JSON.stringify(jsonData)}\nDone.`;
      const runner = createRunner(stdout);
      const client = createRuClient({ runner });

      const result = await client.list();

      expect(result[0]?.name).toBe("repo1");
    });
  });
});
