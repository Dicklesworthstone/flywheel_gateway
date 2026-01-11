import { describe, expect, it } from "bun:test";
import { createBvCommandRunner, runCommand } from "../services/bv.service";

describe("BV service runner", () => {
  it("propagates non-zero exit codes", async () => {
    const runner = createBvCommandRunner(async () => ({
      stdout: "",
      stderr: "no bv",
      exitCode: 127,
    }));

    const result = await runner.run("bv", ["--robot-triage"]);
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toBe("no bv");
  });

  it("returns output even when stderr is present", async () => {
    const runner = createBvCommandRunner(async () => ({
      stdout: '{"ok":true}',
      stderr: "warning",
      exitCode: 0,
    }));

    const result = await runner.run("bv", ["--robot-triage"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('{"ok":true}');
    expect(result.stderr).toBe("warning");
  });

  it("times out when process hangs", async () => {
    const originalSpawn = Bun.spawn;
    const restore = () => {
      Bun.spawn = originalSpawn;
    };

    Bun.spawn = ((args: string[], options: Record<string, unknown>) => {
      const encoder = new TextEncoder();
      const makeStream = () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(""));
            controller.close();
          },
        });
      // Create a resolvable promise that kill() will resolve
      let resolveExited: () => void;
      const exitedPromise = new Promise<void>((resolve) => {
        resolveExited = resolve;
      });
      const proc = {
        stdout: makeStream(),
        stderr: makeStream(),
        exited: exitedPromise,
        exitCode: null,
        kill: () => {
          // When killed, resolve the exited promise after a tick
          setTimeout(() => resolveExited(), 0);
        },
      } as unknown as ReturnType<typeof Bun.spawn>;
      void options;
      void args;
      return proc;
    }) as typeof Bun.spawn;

    try {
      const result = await runCommand("bv", ["--robot-triage"], {
        timeoutMs: 10,
      });
      expect(result.exitCode).toBe(-1);
    } finally {
      restore();
    }
  });
});
