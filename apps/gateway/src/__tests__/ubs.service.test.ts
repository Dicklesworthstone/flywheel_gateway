import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { _resetUBSStore, createUBSService } from "../services/ubs.service";

describe("UBSService store pruning", () => {
  const originalSpawn = Bun.spawn;

  beforeEach(() => {
    _resetUBSStore();
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
    _resetUBSStore();
  });

  test("bounds in-memory scan/history growth by pruning old scans", async () => {
    Bun.spawn = ((args: string[], options: Record<string, unknown>) => {
      const encoder = new TextEncoder();
      const makeStream = (text: string) =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(text));
            controller.close();
          },
        });

      const stdout = JSON.stringify({
        findings: [
          {
            file: "src/example.ts",
            line: 1,
            column: 1,
            message: "Example finding",
            category: "test",
            severity: "low",
            confidence: 1.0,
          },
        ],
        summary: {
          files_scanned: 1,
          total: 1,
          critical: 0,
          high: 0,
          medium: 0,
          low: 1,
          by_category: { test: 1 },
        },
        exit_code: 0,
      });

      const proc = {
        stdout: makeStream(stdout),
        stderr: makeStream(""),
        exited: Promise.resolve(0),
        exitCode: 0,
        kill: () => {},
      } as unknown as ReturnType<typeof Bun.spawn>;

      void args;
      void options;
      return proc;
    }) as typeof Bun.spawn;

    const service = createUBSService(process.cwd());

    // Create more scans than the in-memory limit to force pruning.
    for (let i = 0; i < 60; i++) {
      await service.runScan({ paths: ["src/"] });
    }

    const stats = service.getStats();
    expect(stats.totalScans).toBe(50);
    expect(stats.totalFindings).toBe(50);
  });
});
