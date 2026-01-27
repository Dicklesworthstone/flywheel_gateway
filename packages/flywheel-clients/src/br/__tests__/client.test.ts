import { describe, expect, test } from "bun:test";
import { BrClientError, createBrClient } from "../index";

function createRunner(stdout: string, exitCode = 0) {
  const calls: { command: string; args: string[] }[] = [];
  return {
    calls,
    run: async (command: string, args: string[]) => {
      calls.push({ command, args });
      return {
        stdout,
        stderr: exitCode === 0 ? "" : "error from br",
        exitCode,
      };
    },
  };
}

function createRunnerWithMap(
  map: Record<string, { stdout: string; exitCode?: number }>,
) {
  const calls: { command: string; args: string[] }[] = [];
  return {
    calls,
    run: async (command: string, args: string[]) => {
      calls.push({ command, args });
      // Match based on the first argument (subcommand)
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

describe("BR client", () => {
  describe("ready command", () => {
    test("parses ready output as issue list", async () => {
      const issues = [
        { id: "bd-123", title: "Test issue", status: "open", priority: 2 },
      ];
      const runner = createRunner(JSON.stringify(issues));
      const client = createBrClient({ runner });

      const result = await client.ready();

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("bd-123");
      expect(result[0]?.title).toBe("Test issue");
      expect(runner.calls[0]?.args).toContain("ready");
      expect(runner.calls[0]?.args).toContain("--json");
    });

    test("passes optional parameters", async () => {
      const runner = createRunner("[]");
      const client = createBrClient({ runner });

      await client.ready({
        limit: 10,
        assignee: "alice",
        unassigned: true,
        labels: ["bug", "urgent"],
        sort: "priority",
      });

      const args = runner.calls[0]?.args ?? [];
      expect(args).toContain("--limit");
      expect(args).toContain("10");
      expect(args).toContain("--assignee");
      expect(args).toContain("alice");
      expect(args).toContain("--unassigned");
      expect(args).toContain("--label");
      expect(args).toContain("--sort");
      expect(args).toContain("priority");
    });
  });

  describe("list command", () => {
    test("parses list output as issue array", async () => {
      const issues = [
        { id: "bd-1", title: "First", status: "open" },
        { id: "bd-2", title: "Second", status: "closed" },
      ];
      const runner = createRunner(JSON.stringify(issues));
      const client = createBrClient({ runner });

      const result = await client.list();

      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe("bd-1");
      expect(result[1]?.status).toBe("closed");
      expect(runner.calls[0]?.args).toContain("list");
    });

    test("handles single issue wrapped as array", async () => {
      const issue = { id: "bd-single", title: "Single issue" };
      const runner = createRunner(JSON.stringify(issue));
      const client = createBrClient({ runner });

      const result = await client.list();

      // Should handle single object as array of one
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("bd-single");
    });
  });

  describe("show command", () => {
    test("fetches issue by ID", async () => {
      const issue = { id: "bd-abc", title: "Show test", description: "Details" };
      const runner = createRunner(JSON.stringify([issue]));
      const client = createBrClient({ runner });

      const result = await client.show("bd-abc");

      expect(result[0]?.id).toBe("bd-abc");
      expect(runner.calls[0]?.args).toContain("show");
      expect(runner.calls[0]?.args).toContain("bd-abc");
    });

    test("supports multiple IDs", async () => {
      const issues = [
        { id: "bd-1", title: "First" },
        { id: "bd-2", title: "Second" },
      ];
      const runner = createRunner(JSON.stringify(issues));
      const client = createBrClient({ runner });

      const result = await client.show(["bd-1", "bd-2"]);

      expect(result).toHaveLength(2);
      expect(runner.calls[0]?.args).toContain("bd-1");
      expect(runner.calls[0]?.args).toContain("bd-2");
    });
  });

  describe("create command", () => {
    test("creates issue and returns result", async () => {
      const created = { id: "bd-new", title: "New issue" };
      const runner = createRunner(JSON.stringify(created));
      const client = createBrClient({ runner });

      const result = await client.create({ title: "New issue", type: "task" });

      expect(result.id).toBe("bd-new");
      expect(runner.calls[0]?.args).toContain("create");
      expect(runner.calls[0]?.args).toContain("New issue");
      expect(runner.calls[0]?.args).toContain("--type");
      expect(runner.calls[0]?.args).toContain("task");
    });

    test("passes optional fields", async () => {
      const runner = createRunner(JSON.stringify({ id: "bd-x", title: "X" }));
      const client = createBrClient({ runner });

      await client.create({
        title: "With options",
        priority: 1,
        labels: ["feat", "api"],
        parent: "bd-epic",
      });

      const args = runner.calls[0]?.args ?? [];
      expect(args).toContain("--priority");
      expect(args).toContain("1");
      expect(args).toContain("--labels");
      expect(args).toContain("feat,api");
      expect(args).toContain("--parent");
      expect(args).toContain("bd-epic");
    });
  });

  describe("update command", () => {
    test("updates issue fields", async () => {
      const updated = { id: "bd-upd", title: "Updated", status: "in_progress" };
      const runner = createRunner(JSON.stringify([updated]));
      const client = createBrClient({ runner });

      const result = await client.update("bd-upd", { status: "in_progress" });

      expect(result[0]?.status).toBe("in_progress");
      expect(runner.calls[0]?.args).toContain("update");
      expect(runner.calls[0]?.args).toContain("bd-upd");
      expect(runner.calls[0]?.args).toContain("--status");
    });
  });

  describe("close command", () => {
    test("closes issue with reason", async () => {
      const closed = { id: "bd-cls", title: "Closed", status: "closed" };
      const runner = createRunner(JSON.stringify([closed]));
      const client = createBrClient({ runner });

      const result = await client.close("bd-cls", { reason: "done" });

      expect(result[0]?.status).toBe("closed");
      expect(runner.calls[0]?.args).toContain("close");
      expect(runner.calls[0]?.args).toContain("--reason");
      expect(runner.calls[0]?.args).toContain("done");
    });
  });

  describe("syncStatus command", () => {
    test("parses sync status", async () => {
      const status = {
        dirty_count: 0,
        jsonl_exists: true,
        jsonl_newer: false,
      };
      const runner = createRunner(JSON.stringify(status));
      const client = createBrClient({ runner });

      const result = await client.syncStatus();

      expect(result.dirty_count).toBe(0);
      expect(result.jsonl_exists).toBe(true);
      expect(runner.calls[0]?.args).toContain("sync");
      expect(runner.calls[0]?.args).toContain("--status");
    });
  });

  describe("error handling", () => {
    test("throws BrClientError on command failure", async () => {
      const runner = createRunner("", 1);
      const client = createBrClient({ runner });

      let thrown: unknown;
      try {
        await client.ready();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(BrClientError);
      expect((thrown as BrClientError).kind).toBe("command_failed");
    });

    test("throws parse_error on invalid JSON", async () => {
      const runner = createRunner("not valid json {");
      const client = createBrClient({ runner });

      let thrown: unknown;
      try {
        await client.ready();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(BrClientError);
      expect((thrown as BrClientError).kind).toBe("parse_error");
    });

    test("throws validation_error on schema mismatch", async () => {
      // Missing required 'id' field
      const runner = createRunner(JSON.stringify([{ title: "No id" }]));
      const client = createBrClient({ runner });

      let thrown: unknown;
      try {
        await client.ready();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(BrClientError);
      expect((thrown as BrClientError).kind).toBe("validation_error");
    });

    test("error includes details for diagnostics", async () => {
      const runner = createRunner("", 42);
      const client = createBrClient({ runner });

      let thrown: unknown;
      try {
        await client.list();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(BrClientError);
      const details = (thrown as BrClientError).details;
      expect(details?.exitCode).toBe(42);
      expect(details?.args).toBeDefined();
    });
  });

  describe("global options", () => {
    test("passes db option from client config", async () => {
      const runner = createRunner("[]");
      const client = createBrClient({ runner, db: "/custom/path.db" });

      await client.list();

      expect(runner.calls[0]?.args).toContain("--db");
      expect(runner.calls[0]?.args).toContain("/custom/path.db");
    });

    test("passes actor option", async () => {
      const runner = createRunner("[]");
      const client = createBrClient({ runner, actor: "test-agent" });

      await client.ready();

      expect(runner.calls[0]?.args).toContain("--actor");
      expect(runner.calls[0]?.args).toContain("test-agent");
    });

    test("disables auto-import when configured", async () => {
      const runner = createRunner("[]");
      const client = createBrClient({ runner, autoImport: false });

      await client.list();

      expect(runner.calls[0]?.args).toContain("--no-auto-import");
    });
  });

  describe("JSON extraction from mixed output", () => {
    test("extracts JSON from output with log lines", async () => {
      const logLines = "2026-01-27T10:00:00Z INFO Starting br...\n";
      const json = JSON.stringify([{ id: "bd-1", title: "Test" }]);
      const runner = createRunner(logLines + json);
      const client = createBrClient({ runner });

      const result = await client.list();

      expect(result[0]?.id).toBe("bd-1");
    });
  });
});
