import { describe, expect, test } from "bun:test";
import { PtClientError, createPtClient } from "../index";

function createRunner(stdout: string, exitCode = 0) {
  const calls: { command: string; args: string[] }[] = [];
  return {
    calls,
    run: async (command: string, args: string[]) => {
      calls.push({ command, args });
      return {
        stdout,
        stderr: exitCode === 0 ? "" : "pt error",
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

describe("PT client", () => {
  describe("doctor command", () => {
    test("parses doctor output", async () => {
      const data = {
        status: "healthy",
        checks: [
          { name: "process_list", status: "ok" },
          { name: "permissions", status: "ok" },
        ],
        permissions: {
          can_list_processes: true,
          can_kill_processes: true,
        },
      };
      const runner = createRunner(envelope(data));
      const client = createPtClient({ runner });

      const result = await client.doctor();

      expect(result.status).toBe("healthy");
      expect(result.permissions.can_list_processes).toBe(true);
      expect(result.permissions.can_kill_processes).toBe(true);
      expect(runner.calls[0]?.args).toContain("doctor");
      expect(runner.calls[0]?.args).toContain("--json");
    });

    test("handles degraded status with limited permissions", async () => {
      const data = {
        status: "degraded",
        checks: [
          { name: "process_list", status: "ok" },
          {
            name: "permissions",
            status: "warning",
            message: "Cannot kill processes",
          },
        ],
        permissions: {
          can_list_processes: true,
          can_kill_processes: false,
        },
      };
      const runner = createRunner(envelope(data));
      const client = createPtClient({ runner });

      const result = await client.doctor();

      expect(result.status).toBe("degraded");
      expect(result.permissions.can_kill_processes).toBe(false);
    });
  });

  describe("scan command", () => {
    test("parses scan results", async () => {
      const data = {
        processes: [
          {
            pid: 12345,
            ppid: 1,
            name: "stuck_process",
            cmdline: "/usr/bin/stuck_process --daemon",
            user: "root",
            state: "D",
            cpu_percent: 99.5,
            memory_percent: 45.2,
            memory_rss_mb: 1024,
            started_at: "2026-01-26T00:00:00Z",
            runtime_seconds: 86400,
            score: 85,
            score_breakdown: {
              cpu_score: 30,
              memory_score: 25,
              runtime_score: 20,
              state_score: 10,
            },
            flags: ["high_cpu", "long_running", "uninterruptible"],
          },
        ],
        total_scanned: 500,
        suspicious_count: 1,
        scan_time_ms: 150,
        timestamp: "2026-01-27T00:00:00Z",
        thresholds: {
          min_score: 50,
        },
      };
      const runner = createRunner(envelope(data));
      const client = createPtClient({ runner });

      const result = await client.scan();

      expect(result.processes).toHaveLength(1);
      expect(result.processes[0]?.pid).toBe(12345);
      expect(result.processes[0]?.score).toBe(85);
      expect(result.processes[0]?.flags).toContain("high_cpu");
      expect(result.suspicious_count).toBe(1);
      expect(runner.calls[0]?.args).toContain("scan");
    });

    test("passes minScore option", async () => {
      const data = {
        processes: [],
        total_scanned: 100,
        suspicious_count: 0,
        scan_time_ms: 50,
        timestamp: "2026-01-27T00:00:00Z",
        thresholds: { min_score: 70 },
      };
      const runner = createRunner(envelope(data));
      const client = createPtClient({ runner });

      await client.scan({ minScore: 70 });

      expect(runner.calls[0]?.args).toContain("--min-score");
      expect(runner.calls[0]?.args).toContain("70");
    });

    test("passes minRuntimeSeconds option", async () => {
      const data = {
        processes: [],
        total_scanned: 100,
        suspicious_count: 0,
        scan_time_ms: 50,
        timestamp: "2026-01-27T00:00:00Z",
        thresholds: { min_score: 50, min_runtime_seconds: 3600 },
      };
      const runner = createRunner(envelope(data));
      const client = createPtClient({ runner });

      await client.scan({ minRuntimeSeconds: 3600 });

      expect(runner.calls[0]?.args).toContain("--min-runtime");
      expect(runner.calls[0]?.args).toContain("3600");
    });

    test("passes minMemoryMb option", async () => {
      const data = {
        processes: [],
        total_scanned: 100,
        suspicious_count: 0,
        scan_time_ms: 50,
        timestamp: "2026-01-27T00:00:00Z",
        thresholds: { min_score: 50, min_memory_mb: 512 },
      };
      const runner = createRunner(envelope(data));
      const client = createPtClient({ runner });

      await client.scan({ minMemoryMb: 512 });

      expect(runner.calls[0]?.args).toContain("--min-memory");
      expect(runner.calls[0]?.args).toContain("512");
    });

    test("passes minCpuPercent option", async () => {
      const data = {
        processes: [],
        total_scanned: 100,
        suspicious_count: 0,
        scan_time_ms: 50,
        timestamp: "2026-01-27T00:00:00Z",
        thresholds: { min_score: 50, min_cpu_percent: 80 },
      };
      const runner = createRunner(envelope(data));
      const client = createPtClient({ runner });

      await client.scan({ minCpuPercent: 80 });

      expect(runner.calls[0]?.args).toContain("--min-cpu");
      expect(runner.calls[0]?.args).toContain("80");
    });

    test("passes namePattern option", async () => {
      const data = {
        processes: [],
        total_scanned: 50,
        suspicious_count: 0,
        scan_time_ms: 30,
        timestamp: "2026-01-27T00:00:00Z",
        thresholds: { min_score: 50 },
      };
      const runner = createRunner(envelope(data));
      const client = createPtClient({ runner });

      await client.scan({ namePattern: "node.*" });

      expect(runner.calls[0]?.args).toContain("--name");
      expect(runner.calls[0]?.args).toContain("node.*");
    });

    test("passes excludePattern option", async () => {
      const data = {
        processes: [],
        total_scanned: 400,
        suspicious_count: 0,
        scan_time_ms: 100,
        timestamp: "2026-01-27T00:00:00Z",
        thresholds: { min_score: 50 },
      };
      const runner = createRunner(envelope(data));
      const client = createPtClient({ runner });

      await client.scan({ excludePattern: "systemd.*" });

      expect(runner.calls[0]?.args).toContain("--exclude");
      expect(runner.calls[0]?.args).toContain("systemd.*");
    });

    test("passes limit option", async () => {
      const data = {
        processes: [],
        total_scanned: 500,
        suspicious_count: 0,
        scan_time_ms: 150,
        timestamp: "2026-01-27T00:00:00Z",
        thresholds: { min_score: 50 },
      };
      const runner = createRunner(envelope(data));
      const client = createPtClient({ runner });

      await client.scan({ limit: 10 });

      expect(runner.calls[0]?.args).toContain("--limit");
      expect(runner.calls[0]?.args).toContain("10");
    });
  });

  describe("status command", () => {
    test("returns status with permissions", async () => {
      const calls: string[][] = [];
      const runner = {
        run: async (_command: string, args: string[]) => {
          calls.push(args);
          if (args.includes("--version")) {
            return { stdout: "pt v1.2.3", stderr: "", exitCode: 0 };
          }
          const data = {
            status: "healthy",
            checks: [],
            permissions: {
              can_list_processes: true,
              can_kill_processes: false,
            },
          };
          return { stdout: envelope(data), stderr: "", exitCode: 0 };
        },
      };
      const client = createPtClient({ runner });

      const result = await client.status();

      expect(result.available).toBe(true);
      expect(result.version).toBe("1.2.3");
      expect(result.canListProcesses).toBe(true);
      expect(result.canKillProcesses).toBe(false);
    });

    test("returns unavailable status on error", async () => {
      const runner = createRunner("", 1);
      const client = createPtClient({ runner });

      const result = await client.status();

      expect(result.available).toBe(false);
      expect(result.canListProcesses).toBe(false);
      expect(result.canKillProcesses).toBe(false);
    });
  });

  describe("isAvailable", () => {
    test("returns true when doctor succeeds", async () => {
      const data = {
        status: "healthy",
        checks: [],
        permissions: {
          can_list_processes: true,
          can_kill_processes: true,
        },
      };
      const runner = createRunner(envelope(data));
      const client = createPtClient({ runner });

      const available = await client.isAvailable();

      expect(available).toBe(true);
    });

    test("returns false when doctor fails", async () => {
      const runner = createRunner("", 1);
      const client = createPtClient({ runner });

      const available = await client.isAvailable();

      expect(available).toBe(false);
    });
  });

  describe("error handling", () => {
    test("throws PtClientError on command failure", async () => {
      const runner = createRunner("", 1);
      const client = createPtClient({ runner });

      let thrown: unknown;
      try {
        await client.doctor();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(PtClientError);
      expect((thrown as PtClientError).kind).toBe("command_failed");
    });

    test("throws parse_error on invalid JSON", async () => {
      const runner = createRunner("not valid json {{");
      const client = createPtClient({ runner });

      let thrown: unknown;
      try {
        await client.doctor();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(PtClientError);
      expect((thrown as PtClientError).kind).toBe("parse_error");
    });

    test("throws validation_error on schema mismatch", async () => {
      // Missing required 'permissions' field
      const runner = createRunner(envelope({ status: "healthy", checks: [] }));
      const client = createPtClient({ runner });

      let thrown: unknown;
      try {
        await client.doctor();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(PtClientError);
      expect((thrown as PtClientError).kind).toBe("validation_error");
    });

    test("throws command_failed when envelope ok is false", async () => {
      const runner = createRunner(
        envelope({}, false, "ERR_PERMISSION", "Cannot access process list"),
      );
      const client = createPtClient({ runner });

      let thrown: unknown;
      try {
        await client.scan();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(PtClientError);
      expect((thrown as PtClientError).kind).toBe("command_failed");
    });

    test("error includes diagnostic details", async () => {
      const runner = createRunner("", 42);
      const client = createPtClient({ runner });

      let thrown: unknown;
      try {
        await client.scan();
      } catch (error) {
        thrown = error;
      }

      const details = (thrown as PtClientError).details;
      expect(details?.exitCode).toBe(42);
      expect(details?.args).toBeDefined();
    });
  });
});
