import { describe, expect, test } from "bun:test";
import { NtmClientError, createNtmClient } from "../index";

function createRunner(stdout: string, exitCode = 0) {
  const calls: { command: string; args: string[] }[] = [];
  return {
    calls,
    run: async (command: string, args: string[]) => {
      calls.push({ command, args });
      return {
        stdout,
        stderr: exitCode === 0 ? "" : "ntm error",
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
      // Match based on first arg that starts with --robot
      const robotArg = args.find((a) => a.startsWith("--robot")) ?? "";
      const entry = map[robotArg] ?? { stdout: "", exitCode: 1 };
      return {
        stdout: entry.stdout,
        stderr: entry.exitCode === 0 ? "" : "error",
        exitCode: entry.exitCode ?? 0,
      };
    },
  };
}

describe("NTM client", () => {
  describe("status command", () => {
    test("parses status output with sessions", async () => {
      const payload = {
        generated_at: "2026-01-27T00:00:00Z",
        system: {
          version: "1.0.0",
          commit: "abc123",
          build_date: "2026-01-01",
          go_version: "1.22",
          os: "linux",
          arch: "amd64",
          tmux_available: true,
        },
        sessions: [
          {
            name: "dev",
            exists: true,
            attached: false,
            windows: 3,
            panes: 6,
            agents: [],
          },
        ],
        summary: {
          total_sessions: 1,
          total_agents: 0,
          attached_count: 0,
          claude_count: 0,
          codex_count: 0,
          gemini_count: 0,
          cursor_count: 0,
          windsurf_count: 0,
          aider_count: 0,
        },
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createNtmClient({ runner });

      const result = await client.status();

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]?.name).toBe("dev");
      expect(result.system.tmux_available).toBe(true);
      expect(runner.calls[0]?.args).toContain("--robot-status");
      expect(runner.calls[0]?.args).toContain("--robot-format=json");
    });
  });

  describe("context command", () => {
    test("parses context output for session", async () => {
      const payload = {
        success: true,
        timestamp: "2026-01-27T00:00:00Z",
        session: "dev",
        captured_at: "2026-01-27T00:00:00Z",
        agents: [
          {
            pane: "%0",
            pane_idx: 0,
            agent_type: "claude",
            model: "opus-4",
            estimated_tokens: 50000,
            with_overhead: 55000,
            context_limit: 200000,
            usage_percent: 27.5,
            usage_level: "normal",
            confidence: "high",
            state: "active",
          },
        ],
        summary: {
          total_agents: 1,
          high_usage_count: 0,
          avg_usage: 27.5,
        },
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createNtmClient({ runner });

      const result = await client.context("dev");

      expect(result.session).toBe("dev");
      expect(result.agents[0]?.agent_type).toBe("claude");
      expect(result.agents[0]?.usage_percent).toBe(27.5);
      expect(runner.calls[0]?.args).toContain("--robot-context=dev");
    });

    test("passes lines option", async () => {
      const payload = {
        success: true,
        timestamp: "2026-01-27T00:00:00Z",
        session: "test",
        captured_at: "2026-01-27T00:00:00Z",
        agents: [],
        summary: { total_agents: 0, high_usage_count: 0, avg_usage: 0 },
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createNtmClient({ runner });

      await client.context("test", { lines: 100 });

      expect(runner.calls[0]?.args).toContain("--lines");
      expect(runner.calls[0]?.args).toContain("100");
    });
  });

  describe("snapshot command", () => {
    test("parses full snapshot output", async () => {
      const payload = {
        ts: "2026-01-27T00:00:00Z",
        sessions: [
          {
            name: "flywheel",
            attached: true,
            agents: [
              {
                pane: "%1",
                type: "claude",
                type_confidence: 0.95,
                type_method: "prompt_scan",
                state: "working",
                last_output_age_sec: 5,
                output_tail_lines: 20,
                pending_mail: 0,
              },
            ],
          },
        ],
        alerts: [],
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createNtmClient({ runner });

      const result = await client.snapshot();

      expect("ts" in result).toBe(true);
      if ("sessions" in result && Array.isArray(result.sessions)) {
        const sessions = result.sessions as Array<{
          agents?: Array<{ type?: string }>;
        }>;
        expect(sessions[0]?.agents?.[0]?.type).toBe("claude");
      }
      expect(runner.calls[0]?.args).toContain("--robot-snapshot");
    });

    test("parses delta snapshot with since parameter", async () => {
      const payload = {
        ts: "2026-01-27T00:01:00Z",
        since: "2026-01-27T00:00:00Z",
        changes: [{ type: "agent_state", session: "dev", pane: "%0" }],
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createNtmClient({ runner });

      const result = await client.snapshot({ since: "2026-01-27T00:00:00Z" });

      expect("since" in result).toBe(true);
      if ("changes" in result) {
        expect(result.changes).toHaveLength(1);
      }
      expect(runner.calls[0]?.args).toContain("--since");
    });
  });

  describe("tail command", () => {
    test("parses tail output with pane content", async () => {
      const payload = {
        success: true,
        timestamp: "2026-01-27T00:00:00Z",
        session: "dev",
        captured_at: "2026-01-27T00:00:00Z",
        panes: {
          "%0": {
            type: "claude",
            state: "working",
            lines: ["Processing...", "Done."],
            truncated: false,
          },
        },
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createNtmClient({ runner });

      const result = await client.tail("dev");

      expect(result.panes["%0"]?.lines).toContain("Done.");
      expect(runner.calls[0]?.args).toContain("--robot-tail=dev");
    });
  });

  describe("health command", () => {
    test("parses session health output", async () => {
      const payload = {
        success: true,
        session: "dev",
        checked_at: "2026-01-27T00:00:00Z",
        agents: [
          {
            pane: 0,
            agent_type: "codex",
            health: "healthy",
            idle_since_seconds: 10,
            restarts: 0,
            rate_limit_count: 0,
            backoff_remaining: 0,
            confidence: 0.9,
          },
        ],
        summary: {
          total: 1,
          healthy: 1,
          degraded: 0,
          unhealthy: 0,
          rate_limited: 0,
        },
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createNtmClient({ runner });

      const result = await client.health("dev");

      expect(result.summary.healthy).toBe(1);
      expect(result.agents[0]?.health).toBe("healthy");
    });
  });

  describe("isWorking command", () => {
    test("parses is-working output", async () => {
      const payload = {
        success: true,
        timestamp: "2026-01-27T00:00:00Z",
        query: {
          agents_requested: ["claude", "codex"],
          lines_captured: 50,
        },
        agents: {
          "dev:%0": {
            agent_type: "claude",
            is_working: true,
            is_idle: false,
            is_rate_limited: false,
            is_context_low: false,
            confidence: 0.85,
            indicators: { work: ["editing", "thinking"], limit: [] },
            recommendation: "continue",
            recommendation_reason: "Agent is actively working",
          },
        },
        summary: {
          total_agents: 1,
          working_count: 1,
          idle_count: 0,
          rate_limited_count: 0,
          context_low_count: 0,
          error_count: 0,
          by_recommendation: { continue: ["dev:%0"] },
        },
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createNtmClient({ runner });

      const result = await client.isWorking();

      expect(result.summary.working_count).toBe(1);
      expect(result.agents["dev:%0"]?.is_working).toBe(true);
    });
  });

  describe("isAvailable", () => {
    test("returns true when ntm responds", async () => {
      const runner = createRunner("ntm version 1.0.0");
      const client = createNtmClient({ runner });

      const available = await client.isAvailable();

      expect(available).toBe(true);
      expect(runner.calls[0]?.args).toContain("--version");
    });

    test("returns false when ntm not found", async () => {
      const runner = createRunner("", 127);
      const client = createNtmClient({ runner });

      const available = await client.isAvailable();

      expect(available).toBe(false);
    });
  });

  describe("error handling", () => {
    test("throws NtmClientError on command failure", async () => {
      const runner = createRunner("", 1);
      const client = createNtmClient({ runner });

      let thrown: unknown;
      try {
        await client.status();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(NtmClientError);
      expect((thrown as NtmClientError).kind).toBe("command_failed");
    });

    test("throws unavailable on exit code 2", async () => {
      const runner = createRunner("", 2);
      const client = createNtmClient({ runner });

      let thrown: unknown;
      try {
        await client.status();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(NtmClientError);
      expect((thrown as NtmClientError).kind).toBe("unavailable");
    });

    test("throws parse_error on invalid JSON", async () => {
      const runner = createRunner("not json {{");
      const client = createNtmClient({ runner });

      let thrown: unknown;
      try {
        await client.status();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(NtmClientError);
      expect((thrown as NtmClientError).kind).toBe("parse_error");
    });

    test("throws validation_error on schema mismatch", async () => {
      // Missing required 'generated_at' field
      const runner = createRunner(JSON.stringify({ sessions: [] }));
      const client = createNtmClient({ runner });

      let thrown: unknown;
      try {
        await client.status();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(NtmClientError);
      expect((thrown as NtmClientError).kind).toBe("validation_error");
    });

    test("error includes diagnostic details", async () => {
      const runner = createRunner("", 5);
      const client = createNtmClient({ runner });

      let thrown: unknown;
      try {
        await client.context("dev");
      } catch (error) {
        thrown = error;
      }

      const details = (thrown as NtmClientError).details;
      expect(details?.exitCode).toBe(5);
      expect(details?.args).toBeDefined();
    });
  });

  describe("command arguments", () => {
    test("files command passes window and limit", async () => {
      const payload = {
        success: true,
        timestamp: "2026-01-27T00:00:00Z",
        session: "dev",
        time_window: "1h",
        count: 0,
        changes: [],
        summary: {
          total_changes: 0,
          unique_files: 0,
          by_agent: {},
          by_operation: {},
        },
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createNtmClient({ runner });

      await client.files("dev", { window: "24h", limit: 100 });

      expect(runner.calls[0]?.args).toContain("--files-window");
      expect(runner.calls[0]?.args).toContain("24h");
      expect(runner.calls[0]?.args).toContain("--files-limit");
      expect(runner.calls[0]?.args).toContain("100");
    });

    test("metrics command passes period", async () => {
      const payload = {
        success: true,
        timestamp: "2026-01-27T00:00:00Z",
        session: "dev",
        period: "1h",
        token_usage: {
          total_tokens: 0,
          total_cost_usd: 0,
          by_agent: {},
          by_model: {},
          context_current_percent: {},
        },
        agent_stats: {},
        session_stats: {
          total_prompts: 0,
          total_agents: 0,
          active_agents: 0,
          session_duration: "0s",
          files_changed: 0,
        },
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createNtmClient({ runner });

      await client.metrics("dev", { period: "24h" });

      expect(runner.calls[0]?.args).toContain("--metrics-period");
      expect(runner.calls[0]?.args).toContain("24h");
    });
  });
});
