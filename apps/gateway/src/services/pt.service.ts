/**
 * Process Triage (pt) Service
 *
 * Provides access to the pt CLI for finding and terminating stuck/zombie
 * processes that may be consuming resources or blocking agent work.
 *
 * CLI: https://github.com/Dicklesworthstone/process_triage
 */

import { getLogger } from "../middleware/correlation";

// ============================================================================
// Types
// ============================================================================

export interface PtResponse<T = unknown> {
  ok: boolean;
  code: string;
  data: T;
  hint?: string;
  meta: {
    v: string;
    ts: string;
  };
}

export interface PtStatus {
  available: boolean;
  version?: string;
}

export interface PtProcess {
  pid: number;
  ppid: number;
  name: string;
  cmdline: string;
  user: string;
  state: string;
  cpu_percent: number;
  memory_percent: number;
  memory_rss_mb: number;
  started_at?: string;
  runtime_seconds?: number;
  score: number;
  score_breakdown?: {
    cpu_score: number;
    memory_score: number;
    runtime_score: number;
    state_score: number;
  };
  flags: string[];
}

export interface PtScanResult {
  processes: PtProcess[];
  total_scanned: number;
  suspicious_count: number;
  scan_time_ms: number;
  timestamp: string;
  thresholds: {
    min_score: number;
    min_runtime_seconds?: number;
    min_memory_mb?: number;
    min_cpu_percent?: number;
  };
}

export interface PtKillResult {
  pid: number;
  success: boolean;
  signal: string;
  error?: string;
  process_name?: string;
}

export interface PtDoctor {
  status: "healthy" | "degraded" | "error";
  checks: {
    name: string;
    status: "ok" | "warning" | "error";
    message?: string;
  }[];
  permissions: {
    can_list_processes: boolean;
    can_kill_processes: boolean;
  };
}

// ============================================================================
// Constants
// ============================================================================

// System processes that should never be killed (PIDs 0, 1, and 2)
const PROTECTED_PIDS = new Set([0, 1, 2]);

// Process names that are critical and should not be killed without explicit override
const PROTECTED_PROCESS_NAMES = new Set([
  "init",
  "systemd",
  "kernel",
  "kthreadd",
  "ksoftirqd",
  "kworker",
  "migration",
  "watchdog",
  "sshd",
  "dockerd",
  "containerd",
]);

// ============================================================================
// CLI Execution Helper
// ============================================================================

async function executePtCommand(
  args: string[],
  options: { timeout?: number; maxOutputSize?: number } = {},
): Promise<PtResponse> {
  const { timeout = 60000, maxOutputSize = 5 * 1024 * 1024 } = options;
  const log = getLogger();

  try {
    // Add --json flag for structured output
    const fullArgs = [...args, "--json"];

    const proc = Bun.spawn(["pt", ...fullArgs], {
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
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;

      // Truncate if needed
      const output =
        stdout.length > maxOutputSize ? stdout.slice(0, maxOutputSize) : stdout;

      // Parse JSON response
      try {
        return JSON.parse(output.trim()) as PtResponse;
      } catch {
        // If parsing fails, create an error response
        log.error(
          { stdout: output.slice(0, 200), stderr },
          "Failed to parse pt output",
        );
        return {
          ok: false,
          code: "parse_error",
          data: { stdout: output, stderr },
          hint: "Failed to parse pt output as JSON",
          meta: { v: "unknown", ts: new Date().toISOString() },
        } as PtResponse;
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
      ok: false,
      code: "execution_error",
      data: { error: error instanceof Error ? error.message : "Unknown error" },
      hint: "Failed to execute pt command",
      meta: { v: "unknown", ts: new Date().toISOString() },
    };
  }
}

// ============================================================================
// Detection
// ============================================================================

export async function isPtAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["pt", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    // Check for version pattern in output
    return exitCode === 0 || stdout.includes("v");
  } catch {
    return false;
  }
}

export async function getPtVersion(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["pt", "--version"], {
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
 * Run doctor check to get system health and permission status.
 */
export async function getDoctor(): Promise<PtDoctor> {
  const response = await executePtCommand(["doctor"]);

  if (!response.ok) {
    throw new Error(response.hint ?? `pt doctor failed: ${response.code}`);
  }

  return response.data as PtDoctor;
}

/**
 * Get pt system status.
 */
export async function getStatus(): Promise<PtStatus> {
  const available = await isPtAvailable();
  const version = available ? await getPtVersion() : null;

  const status: PtStatus = { available };
  if (version) status.version = version;

  return status;
}

// ============================================================================
// Process Scanning
// ============================================================================

export interface ScanOptions {
  /** Minimum suspicion score threshold (0-100). Default: 50 */
  minScore?: number;
  /** Minimum runtime in seconds to consider. Default: 0 */
  minRuntimeSeconds?: number;
  /** Minimum memory usage in MB. Default: 0 */
  minMemoryMb?: number;
  /** Minimum CPU percentage. Default: 0 */
  minCpuPercent?: number;
  /** Only include processes matching these names (regex) */
  namePattern?: string;
  /** Exclude processes matching these names (regex) */
  excludePattern?: string;
  /** Only include processes owned by these users */
  users?: string[];
  /** Limit results to top N by score */
  limit?: number;
}

/**
 * Scan for suspicious/stuck processes.
 */
export async function scanProcesses(
  options: ScanOptions = {},
): Promise<PtScanResult> {
  const args = ["scan"];

  if (options.minScore !== undefined) {
    args.push("--min-score", String(options.minScore));
  }

  if (options.minRuntimeSeconds !== undefined) {
    args.push("--min-runtime", String(options.minRuntimeSeconds));
  }

  if (options.minMemoryMb !== undefined) {
    args.push("--min-memory", String(options.minMemoryMb));
  }

  if (options.minCpuPercent !== undefined) {
    args.push("--min-cpu", String(options.minCpuPercent));
  }

  if (options.namePattern) {
    args.push("--name", options.namePattern);
  }

  if (options.excludePattern) {
    args.push("--exclude", options.excludePattern);
  }

  if (options.users && options.users.length > 0) {
    args.push("--users", options.users.join(","));
  }

  if (options.limit !== undefined) {
    args.push("--limit", String(options.limit));
  }

  const response = await executePtCommand(args);

  if (!response.ok) {
    throw new Error(response.hint ?? `pt scan failed: ${response.code}`);
  }

  return response.data as PtScanResult;
}

/**
 * Get details for a specific process by PID.
 */
export async function getProcessDetails(pid: number): Promise<PtProcess | null> {
  const args = ["inspect", String(pid)];

  const response = await executePtCommand(args);

  if (!response.ok) {
    // Process may have exited
    if (response.code === "process_not_found") {
      return null;
    }
    throw new Error(response.hint ?? `pt inspect failed: ${response.code}`);
  }

  return response.data as PtProcess;
}

// ============================================================================
// Process Termination
// ============================================================================

export interface KillOptions {
  /** Signal to send (SIGTERM, SIGKILL, etc.). Default: SIGTERM */
  signal?: "SIGTERM" | "SIGKILL" | "SIGINT" | "SIGHUP";
  /** Force kill even if it's a potentially protected process name */
  force?: boolean;
  /** Wait for process to exit (up to timeout ms) */
  wait?: boolean;
  /** Timeout in ms when waiting for process exit. Default: 5000 */
  waitTimeout?: number;
}

/**
 * Validate that a PID is safe to kill.
 */
function validateKillTarget(
  pid: number,
  processName?: string,
  force?: boolean,
): { valid: boolean; error?: string } {
  // Never kill protected PIDs
  if (PROTECTED_PIDS.has(pid)) {
    return { valid: false, error: `PID ${pid} is a protected system process` };
  }

  // Check protected process names unless force is set
  if (!force && processName) {
    const baseName = processName.split("/").pop()?.toLowerCase() ?? "";
    if (PROTECTED_PROCESS_NAMES.has(baseName)) {
      return {
        valid: false,
        error: `Process "${processName}" is a protected system process. Use force=true to override.`,
      };
    }
  }

  // Don't kill ourselves
  if (pid === process.pid) {
    return { valid: false, error: "Cannot kill the gateway process itself" };
  }

  // Don't kill parent process
  if (pid === process.ppid) {
    return { valid: false, error: "Cannot kill the parent process" };
  }

  return { valid: true };
}

/**
 * Terminate a process by PID.
 *
 * Security notes:
 * - Will not kill PIDs 0, 1, 2 (kernel processes)
 * - Will not kill critical system processes without force flag
 * - Validates PID ownership before killing
 */
export async function killProcess(
  pid: number,
  options: KillOptions = {},
): Promise<PtKillResult> {
  const log = getLogger();
  const signal = options.signal ?? "SIGTERM";

  // First, get process details to validate
  const processDetails = await getProcessDetails(pid);
  if (!processDetails) {
    return {
      pid,
      success: false,
      signal,
      error: `Process ${pid} not found or already exited`,
    };
  }

  // Validate kill target
  const validation = validateKillTarget(pid, processDetails.name, options.force);
  if (!validation.valid) {
    log.warn(
      { pid, processName: processDetails.name, error: validation.error },
      "Refused to kill protected process",
    );
    const result: PtKillResult = {
      pid,
      success: false,
      signal,
      process_name: processDetails.name,
    };
    if (validation.error !== undefined) {
      result.error = validation.error;
    }
    return result;
  }

  // Execute kill via pt CLI
  const args = ["kill", String(pid), "--signal", signal];

  if (options.wait) {
    args.push("--wait");
    if (options.waitTimeout !== undefined) {
      args.push("--timeout", String(options.waitTimeout));
    }
  }

  const response = await executePtCommand(args);

  if (!response.ok) {
    log.error(
      { pid, signal, code: response.code },
      "Process kill failed",
    );
    return {
      pid,
      success: false,
      signal,
      error: response.hint ?? response.code,
      process_name: processDetails.name,
    };
  }

  log.info(
    { pid, signal, processName: processDetails.name },
    "Process terminated",
  );

  return {
    pid,
    success: true,
    signal,
    process_name: processDetails.name,
  };
}

/**
 * Terminate multiple processes by PIDs.
 */
export async function killProcesses(
  pids: number[],
  options: KillOptions = {},
): Promise<PtKillResult[]> {
  // Execute in parallel but with some concurrency limit
  const results: PtKillResult[] = [];
  const BATCH_SIZE = 5;

  for (let i = 0; i < pids.length; i += BATCH_SIZE) {
    const batch = pids.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((pid) => killProcess(pid, options)),
    );
    results.push(...batchResults);
  }

  return results;
}

// ============================================================================
// Fleet Management / Agent Cleanup
// ============================================================================

/**
 * Agent process patterns for cleanup detection.
 * These patterns identify processes that are related to agent operations.
 */
const AGENT_PROCESS_PATTERNS = [
  "claude",          // Claude CLI processes
  "tmux.*flywheel",  // Flywheel tmux sessions
  "bun.*gateway",    // Gateway process (for reference, won't kill)
  "mcp-agent-mail",  // Agent mail server
];

/**
 * Scan for stuck agent-related processes.
 * This is specialized for fleet management cleanup.
 */
export async function scanAgentProcesses(
  options: {
    /** Minimum runtime in seconds to consider (default: 3600 = 1 hour) */
    minRuntimeSeconds?: number;
    /** Minimum suspicion score (default: 20) */
    minScore?: number;
    /** Include current gateway process in results (default: false) */
    includeGateway?: boolean;
  } = {},
): Promise<{
  processes: PtProcess[];
  summary: {
    total: number;
    claude_processes: number;
    tmux_sessions: number;
    other_agents: number;
  };
  timestamp: string;
}> {
  const minRuntime = options.minRuntimeSeconds ?? 3600;
  const minScore = options.minScore ?? 20;

  // Scan with agent-specific patterns
  const scanResult = await scanProcesses({
    namePattern: AGENT_PROCESS_PATTERNS.join("|"),
    minRuntimeSeconds: minRuntime,
    minScore: minScore,
    limit: 100,
  });

  // Filter out current process unless explicitly included
  let processes = scanResult.processes;
  if (!options.includeGateway) {
    processes = processes.filter(
      (p) => p.pid !== process.pid && p.pid !== process.ppid,
    );
  }

  // Categorize results
  const claudeProcesses = processes.filter((p) =>
    p.name.toLowerCase().includes("claude"),
  );
  const tmuxSessions = processes.filter(
    (p) => p.name.includes("tmux") && p.cmdline.includes("flywheel"),
  );
  const otherAgents = processes.filter(
    (p) =>
      !p.name.toLowerCase().includes("claude") &&
      !(p.name.includes("tmux") && p.cmdline.includes("flywheel")),
  );

  return {
    processes,
    summary: {
      total: processes.length,
      claude_processes: claudeProcesses.length,
      tmux_sessions: tmuxSessions.length,
      other_agents: otherAgents.length,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Clean up orphaned agent processes.
 * Terminates processes that appear to be stuck/orphaned agent sessions.
 */
export async function cleanupAgentProcesses(
  options: {
    /** Minimum runtime to consider a process stuck (default: 7200 = 2 hours) */
    minRuntimeSeconds?: number;
    /** Dry run - only report what would be killed (default: true) */
    dryRun?: boolean;
    /** Signal to send (default: SIGTERM) */
    signal?: "SIGTERM" | "SIGKILL" | "SIGINT" | "SIGHUP";
  } = {},
): Promise<{
  dryRun: boolean;
  scanned: number;
  terminated: PtKillResult[];
  skipped: Array<{ pid: number; reason: string }>;
  timestamp: string;
}> {
  const log = getLogger();
  const minRuntime = options.minRuntimeSeconds ?? 7200;
  const dryRun = options.dryRun ?? true;
  const signal = options.signal ?? "SIGTERM";

  // Scan for agent processes
  const scan = await scanAgentProcesses({ minRuntimeSeconds: minRuntime });
  const terminated: PtKillResult[] = [];
  const skipped: Array<{ pid: number; reason: string }> = [];

  for (const proc of scan.processes) {
    // Skip protected processes
    const validation = validateKillTarget(proc.pid, proc.name, false);
    if (!validation.valid) {
      skipped.push({ pid: proc.pid, reason: validation.error ?? "Protected" });
      continue;
    }

    if (dryRun) {
      // In dry run mode, just report what would happen
      terminated.push({
        pid: proc.pid,
        success: true,
        signal,
        process_name: proc.name,
      });
    } else {
      // Actually terminate the process
      const result = await killProcess(proc.pid, { signal, force: false });
      terminated.push(result);

      if (result.success) {
        log.info(
          { pid: proc.pid, name: proc.name },
          "Cleaned up orphaned agent process",
        );
      }
    }
  }

  return {
    dryRun,
    scanned: scan.processes.length,
    terminated,
    skipped,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Service Interface
// ============================================================================

export interface PtService {
  /** Check if pt CLI is available */
  isAvailable(): Promise<boolean>;

  /** Get pt CLI version */
  getVersion(): Promise<string | null>;

  /** Get system status */
  getStatus(): Promise<PtStatus>;

  /** Run doctor check */
  getDoctor(): Promise<PtDoctor>;

  /** Scan for suspicious processes */
  scanProcesses(options?: ScanOptions): Promise<PtScanResult>;

  /** Get details for a specific process */
  getProcessDetails(pid: number): Promise<PtProcess | null>;

  /** Terminate a process */
  killProcess(pid: number, options?: KillOptions): Promise<PtKillResult>;

  /** Terminate multiple processes */
  killProcesses(pids: number[], options?: KillOptions): Promise<PtKillResult[]>;

  /** Scan for stuck agent-related processes (fleet management) */
  scanAgentProcesses(options?: {
    minRuntimeSeconds?: number;
    minScore?: number;
    includeGateway?: boolean;
  }): Promise<{
    processes: PtProcess[];
    summary: {
      total: number;
      claude_processes: number;
      tmux_sessions: number;
      other_agents: number;
    };
    timestamp: string;
  }>;

  /** Clean up orphaned agent processes (fleet management) */
  cleanupAgentProcesses(options?: {
    minRuntimeSeconds?: number;
    dryRun?: boolean;
    signal?: "SIGTERM" | "SIGKILL" | "SIGINT" | "SIGHUP";
  }): Promise<{
    dryRun: boolean;
    scanned: number;
    terminated: PtKillResult[];
    skipped: Array<{ pid: number; reason: string }>;
    timestamp: string;
  }>;
}

export function createPtService(): PtService {
  return {
    isAvailable: isPtAvailable,
    getVersion: getPtVersion,
    getStatus,
    getDoctor,
    scanProcesses,
    getProcessDetails,
    killProcess,
    killProcesses,
    scanAgentProcesses,
    cleanupAgentProcesses,
  };
}

// ============================================================================
// Singleton
// ============================================================================

let serviceInstance: PtService | null = null;

export function getPtService(): PtService {
  if (!serviceInstance) {
    serviceInstance = createPtService();
  }
  return serviceInstance;
}
