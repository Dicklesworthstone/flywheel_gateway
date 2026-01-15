/**
 * Supervisor Service - Daemon process management.
 *
 * Provides:
 * - Start/stop/restart for allowlisted daemons
 * - Health checks with automatic restart
 * - Log streaming and collection
 * - WebSocket events for status changes
 */

import type { Subprocess } from "bun";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import type { Channel } from "../ws/channels";
import { getHub } from "../ws/hub";
import { logger } from "./logger";

// ============================================================================
// Types
// ============================================================================

export type RestartPolicy = "always" | "on-failure" | "never";

export type DaemonStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

export interface DaemonSpec {
  name: string;
  command: string[];
  port?: number;
  healthEndpoint?: string;
  restartPolicy: RestartPolicy;
  maxRestarts: number;
  restartDelayMs: number;
  env?: Record<string, string>;
}

export interface DaemonState {
  name: string;
  status: DaemonStatus;
  pid?: number;
  port?: number;
  startedAt?: Date;
  stoppedAt?: Date;
  restartCount: number;
  lastHealthCheck?: Date;
  lastError?: string;
  uptime?: number;
}

export interface DaemonLogEntry {
  timestamp: Date;
  level: "stdout" | "stderr";
  message: string;
}

export interface SupervisorEvent {
  type:
    | "daemon.started"
    | "daemon.stopped"
    | "daemon.failed"
    | "daemon.health_changed"
    | "daemon.restarting";
  data: {
    name: string;
    status: DaemonStatus;
    pid?: number;
    port?: number;
    error?: string;
    restartCount?: number;
  };
}

// ============================================================================
// Default Daemon Specifications
// ============================================================================

const DEFAULT_SPECS: DaemonSpec[] = [
  {
    name: "agent-mail",
    command: ["mcp-agent-mail", "serve"],
    port: 8765,
    healthEndpoint: "/health",
    restartPolicy: "always",
    maxRestarts: 5,
    restartDelayMs: 1000,
  },
  {
    name: "cm-server",
    command: ["cm", "serve"],
    port: 8766,
    healthEndpoint: "/health",
    restartPolicy: "always",
    maxRestarts: 5,
    restartDelayMs: 1000,
  },
  {
    name: "bd-daemon",
    command: ["bd", "daemon"],
    restartPolicy: "on-failure",
    maxRestarts: 3,
    restartDelayMs: 2000,
  },
];

// ============================================================================
// Supervisor Service Class
// ============================================================================

export class SupervisorService {
  private daemons = new Map<string, DaemonState>();
  private processes = new Map<string, Subprocess>();
  private specs = new Map<string, DaemonSpec>();
  private logs = new Map<string, DaemonLogEntry[]>();
  private healthCheckIntervals = new Map<
    string,
    ReturnType<typeof setInterval>
  >();
  private startingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private restartTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private started = false;

  private static readonly MAX_LOG_ENTRIES = 1000;
  private static readonly HEALTH_CHECK_INTERVAL = 5000;

  constructor(specs: DaemonSpec[] = DEFAULT_SPECS) {
    for (const spec of specs) {
      this.specs.set(spec.name, spec);
      this.logs.set(spec.name, []);
    }
  }

  // ==========================================================================
  // Lifecycle Methods
  // ==========================================================================

  /**
   * Start all configured daemons.
   */
  async startAll(): Promise<void> {
    const correlationId = getCorrelationId();
    const log = getLogger();

    log.info(
      { correlationId, daemonCount: this.specs.size },
      "Starting all daemons",
    );

    for (const spec of this.specs.values()) {
      try {
        await this.startDaemon(spec.name);
      } catch (error) {
        log.error(
          { correlationId, daemon: spec.name, error },
          "Failed to start daemon",
        );
      }
    }

    this.started = true;
  }

  /**
   * Stop all running daemons.
   */
  async stopAll(): Promise<void> {
    const correlationId = getCorrelationId();
    const log = getLogger();

    log.info({ correlationId }, "Stopping all daemons");

    for (const name of this.specs.keys()) {
      try {
        await this.stopDaemon(name);
      } catch (error) {
        log.error(
          { correlationId, daemon: name, error },
          "Failed to stop daemon",
        );
      }
    }

    this.started = false;
  }

  /**
   * Start a specific daemon.
   */
  async startDaemon(name: string): Promise<DaemonState> {
    const correlationId = getCorrelationId();
    const log = getLogger();

    const spec = this.specs.get(name);
    if (!spec) {
      throw new DaemonNotFoundError(name);
    }

    // Check if already running
    const existingState = this.daemons.get(name);
    if (
      existingState &&
      (existingState.status === "running" ||
        existingState.status === "starting")
    ) {
      log.warn({ correlationId, daemon: name }, "Daemon already running");
      return existingState;
    }

    log.info(
      { correlationId, daemon: name, command: spec.command },
      "Starting daemon",
    );

    // Initialize state
    const state: DaemonState = {
      name,
      status: "starting",
      restartCount: existingState?.restartCount ?? 0,
      startedAt: new Date(),
      ...(spec.port && { port: spec.port }),
    };
    this.daemons.set(name, state);

    try {
      // Spawn the process
      const proc = Bun.spawn(spec.command, {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ...spec.env },
        onExit: (_proc, exitCode) => {
          this.handleExit(name, exitCode);
        },
      });

      this.processes.set(name, proc);
      state.pid = proc.pid;

      // Start collecting logs
      this.collectLogs(name, proc);

      // Start health checks if endpoint configured
      if (spec.healthEndpoint && spec.port) {
        this.startHealthCheck(name);
      } else {
        // No health endpoint - assume running after short delay
        // Track the timeout so we can clear it if daemon exits
        this.clearStartingTimeout(name);
        const timeout = setTimeout(() => {
          this.startingTimeouts.delete(name);
          const currentState = this.daemons.get(name);
          if (currentState && currentState.status === "starting") {
            currentState.status = "running";
            this.emitEvent("daemon.started", currentState);
          }
        }, 500);
        this.startingTimeouts.set(name, timeout);
      }

      log.info(
        { correlationId, daemon: name, pid: proc.pid },
        "Daemon process started",
      );
      return state;
    } catch (error) {
      state.status = "failed";
      state.lastError =
        error instanceof Error ? error.message : "Unknown error";
      this.emitEvent("daemon.failed", state);
      throw error;
    }
  }

  /**
   * Stop a specific daemon.
   */
  async stopDaemon(name: string): Promise<DaemonState> {
    const correlationId = getCorrelationId();
    const log = getLogger();

    const spec = this.specs.get(name);
    if (!spec) {
      throw new DaemonNotFoundError(name);
    }

    const state = this.daemons.get(name);
    if (!state || state.status === "stopped") {
      log.warn({ correlationId, daemon: name }, "Daemon not running");
      return state ?? { name, status: "stopped", restartCount: 0 };
    }

    log.info(
      { correlationId, daemon: name, pid: state.pid },
      "Stopping daemon",
    );

    // Stop health checks and pending restarts
    this.stopHealthCheck(name);
    this.clearRestartTimeout(name);

    // Update state
    state.status = "stopping";

    // Kill the process
    const proc = this.processes.get(name);
    if (proc) {
      try {
        proc.kill();
      } catch {
        // Process may already be dead
      }
      this.processes.delete(name);
    }

    state.status = "stopped";
    state.stoppedAt = new Date();
    delete state.pid;

    this.emitEvent("daemon.stopped", state);

    log.info({ correlationId, daemon: name }, "Daemon stopped");
    return state;
  }

  /**
   * Restart a specific daemon.
   */
  async restartDaemon(name: string): Promise<DaemonState> {
    const correlationId = getCorrelationId();
    const log = getLogger();

    log.info({ correlationId, daemon: name }, "Restarting daemon");

    await this.stopDaemon(name);

    // Reset restart count on manual restart
    const state = this.daemons.get(name);
    if (state) {
      state.restartCount = 0;
    }

    // Small delay before restart
    await Bun.sleep(500);

    return this.startDaemon(name);
  }

  // ==========================================================================
  // Status Methods
  // ==========================================================================

  /**
   * Get status of all daemons.
   */
  getStatus(): DaemonState[] {
    const result: DaemonState[] = [];

    for (const spec of this.specs.values()) {
      const state = this.daemons.get(spec.name);
      if (state) {
        // Calculate uptime
        if (state.status === "running" && state.startedAt) {
          state.uptime = Math.floor(
            (Date.now() - state.startedAt.getTime()) / 1000,
          );
        }
        result.push({ ...state });
      } else {
        result.push({
          name: spec.name,
          status: "stopped",
          restartCount: 0,
          ...(spec.port && { port: spec.port }),
        });
      }
    }

    return result;
  }

  /**
   * Get status of a specific daemon.
   */
  getDaemonStatus(name: string): DaemonState {
    const spec = this.specs.get(name);
    if (!spec) {
      throw new DaemonNotFoundError(name);
    }

    const state = this.daemons.get(name);
    if (state) {
      if (state.status === "running" && state.startedAt) {
        state.uptime = Math.floor(
          (Date.now() - state.startedAt.getTime()) / 1000,
        );
      }
      return { ...state };
    }

    return {
      name,
      status: "stopped",
      restartCount: 0,
      ...(spec.port && { port: spec.port }),
    };
  }

  /**
   * Get logs for a specific daemon.
   */
  getLogs(name: string, limit = 100): DaemonLogEntry[] {
    const spec = this.specs.get(name);
    if (!spec) {
      throw new DaemonNotFoundError(name);
    }

    const logs = this.logs.get(name) ?? [];
    return logs.slice(-limit);
  }

  /**
   * Check if supervisor has started.
   */
  isStarted(): boolean {
    return this.started;
  }

  /**
   * Get list of available daemon names.
   */
  getDaemonNames(): string[] {
    return Array.from(this.specs.keys());
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private handleExit(name: string, exitCode: number | null): void {
    const correlationId = getCorrelationId();
    const log = getLogger();

    const spec = this.specs.get(name);
    const state = this.daemons.get(name);

    if (!spec || !state) return;

    // If we're stopping, don't restart
    if (state.status === "stopping") {
      return;
    }

    log.warn({ correlationId, daemon: name, exitCode }, "Daemon exited");

    state.status = "stopped";
    state.stoppedAt = new Date();
    delete state.pid;

    // Clear any pending starting timeout and health checks
    this.clearStartingTimeout(name);
    this.stopHealthCheck(name);

    // Check restart policy
    const shouldRestart =
      spec.restartPolicy === "always" ||
      (spec.restartPolicy === "on-failure" && exitCode !== 0);

    if (shouldRestart && state.restartCount < spec.maxRestarts) {
      state.restartCount++;
      state.status = "starting";

      log.info(
        {
          correlationId,
          daemon: name,
          restartCount: state.restartCount,
          maxRestarts: spec.maxRestarts,
        },
        "Scheduling daemon restart",
      );

      this.emitEvent("daemon.restarting", state);

      // Schedule restart (track timeout so stopDaemon can cancel it)
      this.clearRestartTimeout(name);
      const restartTimeout = setTimeout(async () => {
        this.restartTimeouts.delete(name);
        try {
          await this.startDaemon(name);
        } catch (error) {
          log.error(
            { correlationId, daemon: name, error },
            "Failed to restart daemon",
          );
        }
      }, spec.restartDelayMs);
      this.restartTimeouts.set(name, restartTimeout);
    } else if (shouldRestart) {
      state.status = "failed";
      state.lastError = `Max restarts (${spec.maxRestarts}) exceeded`;

      log.error(
        { correlationId, daemon: name, restartCount: state.restartCount },
        "Daemon max restarts exceeded",
      );
      this.emitEvent("daemon.failed", state);
    } else {
      state.status = "stopped";
      this.emitEvent("daemon.stopped", state);
    }
  }

  private startHealthCheck(name: string): void {
    const spec = this.specs.get(name);
    if (!spec || !spec.healthEndpoint || !spec.port) return;

    // Clear any existing interval
    this.stopHealthCheck(name);

    const interval = setInterval(async () => {
      await this.checkHealth(name);
    }, SupervisorService.HEALTH_CHECK_INTERVAL);

    this.healthCheckIntervals.set(name, interval);

    // Also do an immediate check
    this.checkHealth(name);
  }

  private stopHealthCheck(name: string): void {
    const interval = this.healthCheckIntervals.get(name);
    if (interval) {
      clearInterval(interval);
      this.healthCheckIntervals.delete(name);
    }
  }

  private clearStartingTimeout(name: string): void {
    const timeout = this.startingTimeouts.get(name);
    if (timeout) {
      clearTimeout(timeout);
      this.startingTimeouts.delete(name);
    }
  }

  private clearRestartTimeout(name: string): void {
    const timeout = this.restartTimeouts.get(name);
    if (timeout) {
      clearTimeout(timeout);
      this.restartTimeouts.delete(name);
    }
  }

  private async checkHealth(name: string): Promise<void> {
    const spec = this.specs.get(name);
    const state = this.daemons.get(name);

    if (!spec || !state || !spec.healthEndpoint || !spec.port) return;

    try {
      const res = await fetch(
        `http://localhost:${spec.port}${spec.healthEndpoint}`,
        {
          signal: AbortSignal.timeout(3000),
        },
      );

      state.lastHealthCheck = new Date();

      if (res.ok) {
        if (state.status === "starting") {
          state.status = "running";
          this.emitEvent("daemon.started", state);
        }
      } else if (state.status === "running") {
        // Health check failed while running
        logger.warn(
          { daemon: name, status: res.status },
          "Daemon health check failed",
        );
      }
    } catch {
      // Health check failed - daemon may still be starting
      if (state.status === "running") {
        logger.warn(
          { daemon: name },
          "Daemon health check failed (connection error)",
        );
      }
    }
  }

  private collectLogs(name: string, proc: Subprocess): void {
    const logs = this.logs.get(name) ?? [];

    // Read stdout
    const stdout = proc.stdout;
    if (stdout && typeof stdout !== "number") {
      this.readStream(stdout, (line) => {
        this.addLog(logs, "stdout", line);
      });
    }

    // Read stderr
    const stderr = proc.stderr;
    if (stderr && typeof stderr !== "number") {
      this.readStream(stderr, (line) => {
        this.addLog(logs, "stderr", line);
      });
    }
  }

  private async readStream(
    stream: ReadableStream<Uint8Array>,
    callback: (line: string) => void,
  ): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.trim()) {
            callback(this.redactSecrets(line));
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        callback(this.redactSecrets(buffer));
      }
    } catch {
      // Stream closed
    }
  }

  private addLog(
    logs: DaemonLogEntry[],
    level: "stdout" | "stderr",
    message: string,
  ): void {
    logs.push({
      timestamp: new Date(),
      level,
      message,
    });

    // Trim logs to max size
    if (logs.length > SupervisorService.MAX_LOG_ENTRIES) {
      logs.splice(0, logs.length - SupervisorService.MAX_LOG_ENTRIES);
    }
  }

  private redactSecrets(message: string): string {
    // Redact common secret patterns
    return message
      .replace(
        /(?:api[_-]?key|token|password|secret|auth)[=:]\s*["']?[^\s"']+["']?/gi,
        "[REDACTED]",
      )
      .replace(/sk-[a-zA-Z0-9]{20,}/g, "sk-[REDACTED]")
      .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer [REDACTED]");
  }

  private emitEvent(type: SupervisorEvent["type"], state: DaemonState): void {
    const data: SupervisorEvent["data"] = {
      name: state.name,
      status: state.status,
    };
    if (state.pid !== undefined) data.pid = state.pid;
    if (state.port !== undefined) data.port = state.port;
    if (state.lastError !== undefined) data.error = state.lastError;
    if (state.restartCount !== undefined)
      data.restartCount = state.restartCount;

    const event: SupervisorEvent = { type, data };

    // Publish to WebSocket
    try {
      const channel: Channel = { type: "system:supervisor" };
      getHub().publish(channel, type, event.data, {
        correlationId: getCorrelationId(),
      });
    } catch {
      // Hub may not be initialized yet
    }

    logger.info({ event }, "Supervisor event emitted");
  }
}

// ============================================================================
// Error Classes
// ============================================================================

export class DaemonNotFoundError extends Error {
  public override name = "DaemonNotFoundError";
  public daemonName: string;

  constructor(daemonName: string) {
    super(`Daemon not found: ${daemonName}`);
    this.daemonName = daemonName;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let supervisorInstance: SupervisorService | null = null;

/**
 * Get the supervisor service singleton.
 */
export function getSupervisor(): SupervisorService {
  if (!supervisorInstance) {
    supervisorInstance = new SupervisorService();
  }
  return supervisorInstance;
}

/**
 * Initialize supervisor with custom specs (for testing).
 */
export function initializeSupervisor(specs?: DaemonSpec[]): SupervisorService {
  supervisorInstance = new SupervisorService(specs);
  return supervisorInstance;
}

/**
 * Clear the supervisor singleton (for testing).
 */
export function _clearSupervisor(): void {
  supervisorInstance = null;
}
