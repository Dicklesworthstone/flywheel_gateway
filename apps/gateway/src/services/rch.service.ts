/**
 * RCH (Remote Compilation Helper) Service
 *
 * Provides access to the rch CLI for offloading compilation commands
 * to remote workers. Useful for agents to check status, manage workers,
 * and run diagnostics.
 *
 * CLI: https://github.com/Dicklesworthstone/remote_compilation_helper
 */

import { getLogger } from "../middleware/correlation";

const MAX_LOG_BYTES = 5 * 1024 * 1024;

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
    // Ignore errors
  } finally {
    reader.releaseLock();
  }

  if (content.length < maxBytes) {
    content += decoder.decode();
  }

  if (content.length > maxBytes) {
    content = content.slice(0, maxBytes) + "\n[TRUNCATED]";
  }

  return content;
}

// ============================================================================
// Types
// ============================================================================

export interface RchResponse<T = unknown> {
  version: string;
  command: string;
  success: boolean;
  data: T;
  error?: string;
}

export interface RchDoctorCheck {
  category: string;
  name: string;
  status: "pass" | "warning" | "fail" | "skip";
  message: string;
  details?: string;
  suggestion?: string;
  fixable?: boolean;
}

export interface RchDoctor {
  checks: RchDoctorCheck[];
  summary?: {
    total: number;
    passed: number;
    warnings: number;
    failed: number;
  };
  fixes_applied?: string[];
}

export interface RchWorker {
  name: string;
  host: string;
  port?: number;
  user?: string;
  status?: "online" | "offline" | "busy" | "unknown";
  cpu_cores?: number;
  memory_gb?: number;
  last_seen?: string;
  jobs_completed?: number;
}

export interface RchAgent {
  name: string;
  pid?: number;
  status?: string;
  cwd?: string;
  started_at?: string;
}

export interface RchStatus {
  daemon_running?: boolean;
  daemon_pid?: number;
  hook_installed?: boolean;
  workers_online?: number;
  workers_total?: number;
  jobs_pending?: number;
  jobs_running?: number;
  jobs_completed_today?: number;
}

export interface RchHealthStatus {
  available: boolean;
  version?: string;
  daemonRunning: boolean;
  hookInstalled: boolean;
  workersOnline: number;
  workersTotal: number;
  passedChecks: number;
  failedChecks: number;
}

// ============================================================================
// CLI Execution Helper
// ============================================================================

async function executeRchCommand<T = unknown>(
  args: string[],
  options: { timeout?: number; maxOutputSize?: number } = {},
): Promise<RchResponse<T>> {
  const { timeout = 30000, maxOutputSize = 5 * 1024 * 1024 } = options;
  const log = getLogger();

  try {
    // Add --json flag for structured output
    const fullArgs = [...args, "--json"];

    const proc = Bun.spawn(["rch", ...fullArgs], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });

    // Set up timeout with cleanup
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        proc.kill();
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);
    });

    // Wait for command or timeout
    const resultPromise = (async () => {
      const stdout = await readStreamSafe(proc.stdout, maxOutputSize);
      const stderr = await readStreamSafe(proc.stderr, maxOutputSize);
      await proc.exited;

      const output = stdout;

      // Parse JSON response
      try {
        return JSON.parse(output.trim()) as RchResponse<T>;
      } catch {
        // If parsing fails, create an error response
        log.error(
          { stdout: output.slice(0, 200), stderr },
          "Failed to parse rch output",
        );
        return {
          version: "unknown",
          command: args.join(" "),
          success: false,
          data: { stdout: output, stderr } as T,
          error: "Failed to parse rch output as JSON",
        };
      }
    })();

    try {
      return await Promise.race([resultPromise, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  } catch (error) {
    return {
      version: "unknown",
      command: args.join(" "),
      success: false,
      data: {
        error: error instanceof Error ? error.message : "Unknown error",
      } as T,
      error: "Failed to execute rch command",
    };
  }
}

// ============================================================================
// Detection
// ============================================================================

export async function isRchAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["rch", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    return exitCode === 0;
  } catch {
    return false;
  }
}

export async function getRchVersion(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["rch", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    // Extract version from output
    const versionMatch = stdout.match(/v?(\d+\.\d+\.\d+)/);
    return versionMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

// ============================================================================
// Status Functions
// ============================================================================

/**
 * Run doctor check to get system health and configuration status.
 */
export async function getDoctor(): Promise<RchDoctor> {
  const response = await executeRchCommand<RchDoctor>(["doctor"]);

  if (!response.success) {
    throw new Error(response.error ?? `rch doctor failed`);
  }

  return response.data;
}

/**
 * Get rch system status.
 */
export async function getStatus(): Promise<RchStatus> {
  const response = await executeRchCommand<RchStatus>(["status"]);

  if (!response.success) {
    throw new Error(response.error ?? `rch status failed`);
  }

  return response.data;
}

/**
 * Get combined health status.
 */
export async function getHealth(): Promise<RchHealthStatus> {
  try {
    const [doctor, version] = await Promise.all([getDoctor(), getRchVersion()]);

    let status: RchStatus = {};
    try {
      status = await getStatus();
    } catch {
      // Status might fail if daemon not running
    }

    const passedChecks =
      doctor.summary?.passed ??
      doctor.checks?.filter((c) => c.status === "pass").length ??
      0;
    const failedChecks =
      doctor.summary?.failed ??
      doctor.checks?.filter((c) => c.status === "fail").length ??
      0;

    const health: RchHealthStatus = {
      available: true,
      daemonRunning: status.daemon_running ?? false,
      hookInstalled: status.hook_installed ?? false,
      workersOnline: status.workers_online ?? 0,
      workersTotal: status.workers_total ?? 0,
      passedChecks,
      failedChecks,
    };
    if (version !== null) health.version = version;
    return health;
  } catch {
    return {
      available: false,
      daemonRunning: false,
      hookInstalled: false,
      workersOnline: 0,
      workersTotal: 0,
      passedChecks: 0,
      failedChecks: 0,
    };
  }
}

// ============================================================================
// Worker Functions
// ============================================================================

/**
 * List configured workers.
 */
export async function listWorkers(): Promise<RchWorker[]> {
  const response = await executeRchCommand<{ workers: RchWorker[] }>([
    "workers",
    "list",
  ]);

  if (!response.success) {
    throw new Error(response.error ?? `rch workers list failed`);
  }

  return response.data.workers ?? [];
}

// ============================================================================
// Agent Functions
// ============================================================================

/**
 * List detected agents.
 */
export async function listAgents(): Promise<RchAgent[]> {
  const response = await executeRchCommand<{ agents: RchAgent[] }>([
    "agents",
    "list",
  ]);

  if (!response.success) {
    throw new Error(response.error ?? `rch agents list failed`);
  }

  return response.data.agents ?? [];
}

// ============================================================================
// Service Interface
// ============================================================================

export interface RchService {
  /** Check if rch CLI is available */
  isAvailable(): Promise<boolean>;

  /** Get rch CLI version */
  getVersion(): Promise<string | null>;

  /** Get system status */
  getStatus(): Promise<RchStatus>;

  /** Run doctor check */
  getDoctor(): Promise<RchDoctor>;

  /** Get combined health status */
  getHealth(): Promise<RchHealthStatus>;

  /** List configured workers */
  listWorkers(): Promise<RchWorker[]>;

  /** List detected agents */
  listAgents(): Promise<RchAgent[]>;
}

export function createRchService(): RchService {
  return {
    isAvailable: isRchAvailable,
    getVersion: getRchVersion,
    getStatus,
    getDoctor,
    getHealth,
    listWorkers,
    listAgents,
  };
}

// ============================================================================
// Singleton
// ============================================================================

let serviceInstance: RchService | null = null;

export function getRchService(): RchService {
  if (!serviceInstance) {
    serviceInstance = createRchService();
  }
  return serviceInstance;
}
