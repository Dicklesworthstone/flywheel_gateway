import { describe, expect, test } from "bun:test";
import { CaamClientError, createCaamClient } from "../index";

function createRunner(stdout: string, exitCode = 0) {
  const calls: { command: string; args: string[] }[] = [];
  return {
    calls,
    run: async (command: string, args: string[]) => {
      calls.push({ command, args });
      return {
        stdout,
        stderr: exitCode === 0 ? "" : "caam error",
        exitCode,
      };
    },
  };
}

describe("CAAM client", () => {
  describe("status command", () => {
    test("parses status output with tools", async () => {
      const payload = {
        tools: [
          {
            tool: "claude",
            logged_in: true,
            active_profile: "work",
            health: {
              status: "healthy",
              error_count: 0,
            },
            identity: {
              email: "user@example.com",
              plan_type: "pro",
            },
          },
        ],
        warnings: [],
        recommendations: [],
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createCaamClient({ runner });

      const result = await client.status();

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]?.tool).toBe("claude");
      expect(result.tools[0]?.logged_in).toBe(true);
      expect(result.tools[0]?.active_profile).toBe("work");
      expect(runner.calls[0]?.args).toContain("status");
      expect(runner.calls[0]?.args).toContain("--json");
    });

    test("passes provider filter", async () => {
      const payload = { tools: [], warnings: [] };
      const runner = createRunner(JSON.stringify(payload));
      const client = createCaamClient({ runner });

      await client.status({ provider: "cursor" });

      expect(runner.calls[0]?.args).toContain("cursor");
    });
  });

  describe("activate command", () => {
    test("activates profile and returns result", async () => {
      const payload = {
        success: true,
        tool: "claude",
        profile: "personal",
        previous_profile: "work",
        source: "vault",
        refreshed: true,
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createCaamClient({ runner });

      const result = await client.activate({
        provider: "claude",
        profile: "personal",
      });

      expect(result.success).toBe(true);
      expect(result.profile).toBe("personal");
      expect(result.previous_profile).toBe("work");
      expect(runner.calls[0]?.args).toContain("activate");
      expect(runner.calls[0]?.args).toContain("claude");
      expect(runner.calls[0]?.args).toContain("personal");
    });

    test("includes rotation info when available", async () => {
      const payload = {
        success: true,
        tool: "claude",
        profile: "backup",
        rotation: {
          algorithm: "least_recent",
          selected: "backup",
          alternatives: [
            { profile: "main", score: 0.8 },
            { profile: "backup", score: 0.9 },
          ],
        },
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createCaamClient({ runner });

      const result = await client.activate({
        provider: "claude",
        profile: "backup",
      });

      expect(result.rotation?.algorithm).toBe("least_recent");
      expect(result.rotation?.alternatives).toHaveLength(2);
    });
  });

  describe("backup command", () => {
    test("backs up auth files", async () => {
      const payload = {
        success: true,
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createCaamClient({ runner });

      const result = await client.backup({
        provider: "cursor",
        name: "pre-update",
      });

      expect(result.success).toBe(true);
      expect(runner.calls[0]?.args).toContain("backup");
      expect(runner.calls[0]?.args).toContain("cursor");
      expect(runner.calls[0]?.args).toContain("pre-update");
    });
  });

  describe("isAvailable", () => {
    test("returns true when caam responds", async () => {
      const payload = { tools: [] };
      const runner = createRunner(JSON.stringify(payload));
      const client = createCaamClient({ runner });

      const available = await client.isAvailable();

      expect(available).toBe(true);
    });

    test("returns false when caam fails", async () => {
      const runner = createRunner("", 1);
      const client = createCaamClient({ runner });

      const available = await client.isAvailable();

      expect(available).toBe(false);
    });
  });

  describe("error handling", () => {
    test("throws CaamClientError on command failure", async () => {
      const runner = createRunner("", 1);
      const client = createCaamClient({ runner });

      let thrown: unknown;
      try {
        await client.status();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(CaamClientError);
      expect((thrown as CaamClientError).kind).toBe("command_failed");
    });

    test("throws parse_error on invalid JSON", async () => {
      const runner = createRunner("not json");
      const client = createCaamClient({ runner });

      let thrown: unknown;
      try {
        await client.status();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(CaamClientError);
      expect((thrown as CaamClientError).kind).toBe("parse_error");
    });

    test("throws validation_error on schema mismatch", async () => {
      // Missing required 'tools' array
      const runner = createRunner(JSON.stringify({ warnings: [] }));
      const client = createCaamClient({ runner });

      let thrown: unknown;
      try {
        await client.status();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(CaamClientError);
      expect((thrown as CaamClientError).kind).toBe("validation_error");
    });

    test("error includes diagnostic details", async () => {
      const runner = createRunner("", 42);
      const client = createCaamClient({ runner });

      let thrown: unknown;
      try {
        await client.status();
      } catch (error) {
        thrown = error;
      }

      const details = (thrown as CaamClientError).details;
      expect(details?.exitCode).toBe(42);
    });
  });
});
