import { describe, expect, test } from "bun:test";
import { BvClientError, createBvClient } from "../index";

function createRunner(stdout: string, exitCode = 0) {
  const calls: { command: string; args: string[] }[] = [];
  return {
    calls,
    run: async (command: string, args: string[]) => {
      calls.push({ command, args });
      return {
        stdout,
        stderr: exitCode === 0 ? "" : "boom",
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
      const key = args.join(" ");
      const entry = map[key] ?? { stdout: "", exitCode: 1 };
      return {
        stdout: entry.stdout,
        stderr: entry.exitCode === 0 ? "" : "boom",
        exitCode: entry.exitCode ?? 0,
      };
    },
  };
}

describe("BV client", () => {
  test("parses triage output", async () => {
    const payload = {
      generated_at: "2026-01-10T00:00:00Z",
      data_hash: "hash",
      triage: {
        recommendations: [
          {
            id: "bead-1",
            title: "Test",
            type: "feature",
            score: 0.9,
            reasons: ["impactful"],
          },
        ],
      },
    };
    const runner = createRunner(JSON.stringify(payload));
    const client = createBvClient({ runner });

    const result = await client.getTriage();
    expect(result.triage.recommendations?.[0]?.id).toBe("bead-1");
    expect(runner.calls[0]?.args).toEqual(["--robot-triage"]);
  });

  test("throws on command failure", async () => {
    const runner = createRunner("", 1);
    const client = createBvClient({ runner });

    let thrown: unknown;
    try {
      await client.getTriage();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BvClientError);
    expect((thrown as BvClientError).kind).toBe("command_failed");
  });

  test("throws on invalid JSON", async () => {
    const runner = createRunner("not-json");
    const client = createBvClient({ runner });

    let thrown: unknown;
    try {
      await client.getTriage();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BvClientError);
    expect((thrown as BvClientError).kind).toBe("parse_error");
  });

  test("fetches insights and plan", async () => {
    const runner = createRunnerWithMap({
      "--robot-insights": {
        stdout: JSON.stringify({ generated_at: "2026-01-10T00:00:00Z" }),
        exitCode: 0,
      },
      "--robot-plan": {
        stdout: JSON.stringify({ generated_at: "2026-01-10T00:00:00Z" }),
        exitCode: 0,
      },
    });
    const client = createBvClient({ runner });

    await client.getInsights();
    await client.getPlan();

    expect(runner.calls[0]?.args).toEqual(["--robot-insights"]);
    expect(runner.calls[1]?.args).toEqual(["--robot-plan"]);
  });
});
