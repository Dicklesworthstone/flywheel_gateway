import path from "node:path";
import type {
  BvClient,
  BvCommandResult,
  BvCommandRunner,
  BvGraphOptions,
  BvGraphResult,
  BvInsightsResult,
  BvPlanResult,
  BvTriageResult,
} from "@flywheel/flywheel-clients";
import { createBvClient } from "@flywheel/flywheel-clients";
import { getLogger } from "../middleware/correlation";
import {
  createToolLogger,
  logCliCommand,
  logCliWarning,
} from "../utils/cli-logging";

interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const DEFAULT_TRIAGE_TTL_MS = 30000;

function resolveProjectRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith(`${path.sep}apps${path.sep}gateway`)) {
    return path.resolve(cwd, "../..");
  }
  return cwd;
}

export function getBvProjectRoot(): string {
  return (
    process.env["BV_PROJECT_ROOT"] ??
    process.env["BEADS_PROJECT_ROOT"] ??
    resolveProjectRoot()
  );
}

/**
 * Safely read a stream up to a limit, draining excess to avoid pipe blocking.
 */
async function readStreamSafe(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let totalBytes = 0;
  const drainLimit = maxBytes * 5; // Allow draining some excess to let process exit

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.length;

      if (content.length < maxBytes) {
        content += decoder.decode(value, { stream: true });
      }

      // If we've read way too much, stop draining to prevent CPU/time waste
      if (totalBytes > drainLimit) {
        await reader.cancel();
        break;
      }
    }
  } catch {
    // Ignore stream errors (e.g. process killed)
  } finally {
    reader.releaseLock();
  }

  // Flush any remaining bytes
  if (content.length < maxBytes) {
    content += decoder.decode();
  }

  return content.length > maxBytes ? content.slice(0, maxBytes) : content;
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<BvCommandResult> {
  const cwd = options.cwd ?? getBvProjectRoot();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  const start = performance.now();
  const proc = Bun.spawn([command, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill(9); // SIGKILL
  }, timeoutMs);

  // Start reading output immediately to prevent pipe deadlocks
  // Use safe reader to prevent OOM
  const stdoutPromise = readStreamSafe(proc.stdout, maxOutputBytes);
  const stderrPromise = readStreamSafe(proc.stderr, maxOutputBytes);

  await proc.exited;
  clearTimeout(timer);

  const stdout = await stdoutPromise;
  const stderr = await stderrPromise;

  const latencyMs = Math.round(performance.now() - start);
  const exitCode = proc.exitCode ?? -1;

  if (timedOut) {
    logCliWarning(
      { tool: "bv", command, args, latencyMs, exitCode, timedOut: true },
      "bv command timed out",
    );
  } else {
    logCliCommand(
      { tool: "bv", command, args, exitCode, latencyMs },
      "bv command completed",
    );
  }

  return {
    stdout,
    stderr,
    exitCode,
  };
}

// Create a scoped logger for bv operations
const bvLogger = createToolLogger("bv");

export function createBvCommandRunner(
  executor: typeof runCommand = runCommand,
): BvCommandRunner {
  return {
    run: (command, args, options) => executor(command, args, options),
  };
}

let cachedClient: BvClient | undefined;
let cachedTriage: { data: BvTriageResult; fetchedAt: number } | undefined;

export function getBvClient(): BvClient {
  if (!cachedClient) {
    cachedClient = createBvClient({
      runner: createBvCommandRunner(),
      cwd: getBvProjectRoot(),
    });
  }
  return cachedClient;
}

export function clearBvCache(): void {
  cachedTriage = undefined;
}

export async function getBvTriage(options?: {
  timeoutMs?: number;
  maxOutputBytes?: number;
}): Promise<BvTriageResult> {
  const log = getLogger();
  const ttlMs = Number(
    process.env["BV_TRIAGE_TTL_MS"] ?? DEFAULT_TRIAGE_TTL_MS,
  );
  if (
    cachedTriage &&
    Date.now() - cachedTriage.fetchedAt < Math.max(0, ttlMs)
  ) {
    log.debug({ ttlMs }, "BV triage cache hit");
    return cachedTriage.data;
  }

  const start = performance.now();
  const data = await getBvClient().getTriage({
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.maxOutputBytes !== undefined
      ? { maxOutputBytes: options.maxOutputBytes }
      : {}),
  });
  const latencyMs = Math.round(performance.now() - start);
  bvLogger.result("bv --robot-triage", latencyMs, "bv triage fetched", {
    dataHash: data.data_hash,
  });
  cachedTriage = { data, fetchedAt: Date.now() };
  return data;
}

export async function getBvInsights(): Promise<BvInsightsResult> {
  const start = performance.now();
  const data = await getBvClient().getInsights();
  const latencyMs = Math.round(performance.now() - start);
  bvLogger.result("bv --robot-insights", latencyMs, "bv insights fetched", {
    dataHash: data.data_hash,
  });
  return data;
}

export async function getBvPlan(): Promise<BvPlanResult> {
  const start = performance.now();
  const data = await getBvClient().getPlan();
  const latencyMs = Math.round(performance.now() - start);
  bvLogger.result("bv --robot-plan", latencyMs, "bv plan fetched", {
    dataHash: data.data_hash,
  });
  return data;
}

export async function getBvGraph(
  options?: BvGraphOptions,
): Promise<BvGraphResult> {
  const start = performance.now();
  const data = await getBvClient().getGraph(options);
  const latencyMs = Math.round(performance.now() - start);
  bvLogger.result("bv --robot-graph", latencyMs, "bv graph fetched", {
    format: options?.format ?? "json",
    rootId: options?.rootId,
    dataHash: data.data_hash,
  });
  return data;
}
