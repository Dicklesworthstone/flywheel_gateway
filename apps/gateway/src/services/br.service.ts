/**
 * br (Beads) Service
 *
 * Gateway service layer for br CLI operations.
 * Provides typed CRUD wrappers + ready/list/show/close/update/sync.
 */

import path from "node:path";
import type {
  BrClient,
  BrCloseOptions,
  BrCommandOptions,
  BrCommandResult,
  BrCommandRunner,
  BrCreateInput,
  BrIssue,
  BrListOptions,
  BrReadyOptions,
  BrSyncOptions,
  BrSyncResult,
  BrSyncStatus,
  BrUpdateInput,
} from "@flywheel/flywheel-clients";
import { createBrClient } from "@flywheel/flywheel-clients";
import {
  createToolLogger,
  logCliCommand,
  logCliWarning,
} from "../utils/cli-logging";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

// ============================================================================
// Helpers
// ============================================================================

function resolveProjectRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith(`${path.sep}apps${path.sep}gateway`)) {
    return path.resolve(cwd, "../..");
  }
  return cwd;
}

export function getBrProjectRoot(): string {
  return (
    process.env["BR_PROJECT_ROOT"] ??
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
  const drainLimit = maxBytes * 5;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.length;

      if (content.length < maxBytes) {
        content += decoder.decode(value, { stream: true });
      }

      if (totalBytes > drainLimit) {
        await reader.cancel();
        break;
      }
    }
  } catch {
    // Ignore stream errors
  } finally {
    reader.releaseLock();
  }

  return content.length > maxBytes ? content.slice(0, maxBytes) : content;
}

// ============================================================================
// Command Runner
// ============================================================================

interface RunOptions {
  cwd?: string;
  timeout?: number;
  maxOutputBytes?: number;
}

export async function runBrCommand(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<BrCommandResult> {
  const cwd = options.cwd ?? getBrProjectRoot();
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
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
    proc.kill(9);
  }, timeoutMs);

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
      { tool: "br", command, args, latencyMs, exitCode, timedOut: true },
      "br command timed out",
    );
  } else {
    logCliCommand(
      { tool: "br", command, args, exitCode, latencyMs },
      "br command completed",
    );
  }

  return {
    stdout,
    stderr,
    exitCode,
  };
}

// Create a scoped logger for br operations
const brLogger = createToolLogger("br");

export function createBrCommandRunner(
  executor: typeof runBrCommand = runBrCommand,
): BrCommandRunner {
  return {
    run: (command, args, options) => executor(command, args, options),
  };
}

// ============================================================================
// Client Management
// ============================================================================

let cachedClient: BrClient | undefined;

export function getBrClient(): BrClient {
  if (!cachedClient) {
    cachedClient = createBrClient({
      runner: createBrCommandRunner(),
      cwd: getBrProjectRoot(),
    });
  }
  return cachedClient;
}

/**
 * Test-only escape hatch to avoid cross-file mock.module() pollution.
 *
 * Prefer dependency injection where possible, but this keeps unit tests fast and
 * isolated without mocking the shared @flywheel/flywheel-clients module.
 */
export function setBrClientForTesting(client: BrClient | undefined): void {
  cachedClient = client;
}

export function clearBrCache(): void {
  cachedClient = undefined;
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * List ready (unblocked, not deferred) issues.
 */
export async function getBrReady(options?: BrReadyOptions): Promise<BrIssue[]> {
  const start = performance.now();
  const issues = await getBrClient().ready(options);
  const latencyMs = Math.round(performance.now() - start);
  brLogger.result("br ready", latencyMs, "br ready fetched", {
    count: issues.length,
  });
  return issues;
}

/**
 * List issues with filtering options.
 */
export async function getBrList(options?: BrListOptions): Promise<BrIssue[]> {
  const start = performance.now();
  const issues = await getBrClient().list(options);
  const latencyMs = Math.round(performance.now() - start);
  brLogger.result("br list", latencyMs, "br list fetched", {
    count: issues.length,
  });
  return issues;
}

/**
 * Show details of one or more issues by ID.
 */
export async function getBrShow(
  ids: string | string[],
  options?: BrCommandOptions,
): Promise<BrIssue[]> {
  const start = performance.now();
  const issues = await getBrClient().show(ids, options);
  const latencyMs = Math.round(performance.now() - start);
  brLogger.result("br show", latencyMs, "br show fetched", {
    ids: Array.isArray(ids) ? ids : [ids],
    count: issues.length,
  });
  return issues;
}

/**
 * Create a new issue.
 */
export async function createBrIssue(
  input: BrCreateInput,
  options?: BrCommandOptions,
): Promise<BrIssue> {
  const start = performance.now();
  const issue = await getBrClient().create(input, options);
  const latencyMs = Math.round(performance.now() - start);
  brLogger.result("br create", latencyMs, "br issue created", {
    id: issue.id,
    title: input.title,
  });
  return issue;
}

/**
 * Update one or more issues.
 */
export async function updateBrIssues(
  ids: string | string[],
  input: BrUpdateInput,
  options?: BrCommandOptions,
): Promise<BrIssue[]> {
  const start = performance.now();
  const issues = await getBrClient().update(ids, input, options);
  const latencyMs = Math.round(performance.now() - start);
  brLogger.result("br update", latencyMs, "br issues updated", {
    ids: Array.isArray(ids) ? ids : [ids],
    count: issues.length,
  });
  return issues;
}

/**
 * Close one or more issues.
 */
export async function closeBrIssues(
  ids: string | string[],
  options?: BrCloseOptions,
): Promise<BrIssue[]> {
  const start = performance.now();
  const issues = await getBrClient().close(ids, options);
  const latencyMs = Math.round(performance.now() - start);
  brLogger.result("br close", latencyMs, "br issues closed", {
    ids: Array.isArray(ids) ? ids : [ids],
    count: issues.length,
  });
  return issues;
}

// ============================================================================
// Sync Operations
// ============================================================================

/**
 * Get sync status (dirty count, last export/import times).
 */
export async function getBrSyncStatus(
  options?: BrCommandOptions,
): Promise<BrSyncStatus> {
  const start = performance.now();
  const status = await getBrClient().syncStatus(options);
  const latencyMs = Math.round(performance.now() - start);
  brLogger.result("br sync --status", latencyMs, "br sync status fetched", {
    dirtyCount: status.dirty_count,
  });
  return status;
}

/**
 * Run sync operation (export, import, or merge).
 */
export async function syncBr(options?: BrSyncOptions): Promise<BrSyncResult> {
  const start = performance.now();
  const result = await getBrClient().sync(options);
  const latencyMs = Math.round(performance.now() - start);
  brLogger.result("br sync", latencyMs, "br sync completed", {
    mode: options?.mode ?? "default",
  });
  return result;
}

// ============================================================================
// Service Interface
// ============================================================================

export interface BrService {
  ready: (options?: BrReadyOptions) => Promise<BrIssue[]>;
  list: (options?: BrListOptions) => Promise<BrIssue[]>;
  show: (
    ids: string | string[],
    options?: BrCommandOptions,
  ) => Promise<BrIssue[]>;
  create: (
    input: BrCreateInput,
    options?: BrCommandOptions,
  ) => Promise<BrIssue>;
  update: (
    ids: string | string[],
    input: BrUpdateInput,
    options?: BrCommandOptions,
  ) => Promise<BrIssue[]>;
  close: (
    ids: string | string[],
    options?: BrCloseOptions,
  ) => Promise<BrIssue[]>;
  syncStatus: (options?: BrCommandOptions) => Promise<BrSyncStatus>;
  sync: (options?: BrSyncOptions) => Promise<BrSyncResult>;
}

export function createBrService(): BrService {
  return {
    ready: getBrReady,
    list: getBrList,
    show: getBrShow,
    create: createBrIssue,
    update: updateBrIssues,
    close: closeBrIssues,
    syncStatus: getBrSyncStatus,
    sync: syncBr,
  };
}
