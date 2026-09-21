/**
 * CM Service - Cass-Memory (Procedural Memory) integration for Flywheel Gateway.
 *
 * Provides access to procedural memory (rules and history) using the cm CLI.
 * Used for retrieving contextual guidance for agent tasks.
 */

import {
  type CMClient,
  CMClientError,
  type CMClientOptions,
  type CMContextOptions,
  type CMContextResult,
  type CMDoctorOptions,
  type CMDoctorResult,
  type CMOutcomeOptions,
  type CMOutcomeResult,
  type CMPlaybookBullet,
  type CMPlaybookListOptions,
  type CMPlaybookListResult,
  type CMQuickstartResult,
  type CMStatsResult,
  createBunCMCommandRunner,
  createCMClient,
} from "@flywheel/flywheel-clients";
import { getCorrelationId, getLogger } from "../middleware/correlation";

// ============================================================================
// Types
// ============================================================================

export interface CMServiceConfig {
  /** Working directory for cm commands */
  cwd?: string;
  /** Default timeout in milliseconds */
  timeout?: number;
  /** Whether CM is enabled (default: true) */
  enabled?: boolean;
}

export interface CMServiceStatus {
  available: boolean;
  healthy: boolean;
  version?: string;
  overallStatus?: "healthy" | "degraded" | "unhealthy";
  error?: string;
}

// Re-export types from client
export type {
  CMContextOptions,
  CMContextResult,
  CMDoctorOptions,
  CMDoctorResult,
  CMOutcomeOptions,
  CMOutcomeResult,
  CMPlaybookBullet,
  CMPlaybookListOptions,
  CMPlaybookListResult,
  CMQuickstartResult,
  CMStatsResult,
};

// ============================================================================
// Singleton Client
// ============================================================================

let _cmClient: CMClient | null = null;
let _cmConfig: CMServiceConfig = {};

/**
 * Initialize the CM client with configuration.
 */
export function initCMService(config: CMServiceConfig = {}): void {
  _cmConfig = config;
  if (config.enabled === false) {
    _cmClient = null;
    return;
  }

  const runner = createBunCMCommandRunner();
  const clientOptions: CMClientOptions = {
    runner,
    timeout: config.timeout ?? 30000,
  };
  if (config.cwd !== undefined) {
    clientOptions.cwd = config.cwd;
  }
  _cmClient = createCMClient(clientOptions);
}

/**
 * Get the CM client instance.
 * Returns null if CM is disabled or not initialized.
 */
export function getCMClient(): CMClient | null {
  return _cmClient;
}

/**
 * Check if CM is enabled and initialized.
 */
export function isCMEnabled(): boolean {
  return _cmClient !== null;
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Get CM service status.
 */
export async function getCMStatus(): Promise<CMServiceStatus> {
  const log = getLogger();
  const correlationId = getCorrelationId();

  if (!_cmClient) {
    return {
      available: false,
      healthy: false,
      error: "CM is not initialized",
    };
  }

  try {
    const doctor = await _cmClient.doctor();
    const result: CMServiceStatus = {
      available: true,
      healthy: doctor.overallStatus === "healthy",
      overallStatus: doctor.overallStatus,
    };
    if (doctor.version !== undefined) {
      result.version = doctor.version;
    }
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    log.warn({ correlationId, error: errorMessage }, "CM health check failed");
    return {
      available: false,
      healthy: false,
      error: errorMessage,
    };
  }
}

/**
 * Check if CM is available (fast check).
 */
export async function isCMAvailable(): Promise<boolean> {
  if (!_cmClient) {
    return false;
  }
  return _cmClient.isAvailable();
}

/**
 * Get context (rules and history) for a task.
 */
export async function getTaskContext(
  task: string,
  options?: CMContextOptions,
): Promise<CMContextResult> {
  const log = getLogger();
  const correlationId = getCorrelationId();
  const startTime = performance.now();

  if (!_cmClient) {
    throw new CMClientError("unavailable", "CM is not initialized");
  }

  try {
    const result = await _cmClient.context(task, options);

    log.info(
      {
        correlationId,
        task,
        rulesCount: result.relevantBullets.length,
        antiPatternsCount: result.antiPatterns.length,
        historyCount: result.historySnippets.length,
        durationMs: Math.round(performance.now() - startTime),
      },
      "CM context retrieved",
    );

    return result;
  } catch (error) {
    log.error(
      {
        correlationId,
        task,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Math.round(performance.now() - startTime),
      },
      "CM context retrieval failed",
    );
    throw error;
  }
}

/**
 * Get quickstart/self-documentation.
 */
export async function getQuickstart(): Promise<CMQuickstartResult> {
  const log = getLogger();
  const correlationId = getCorrelationId();

  if (!_cmClient) {
    throw new CMClientError("unavailable", "CM is not initialized");
  }

  try {
    const result = await _cmClient.quickstart();
    log.debug({ correlationId }, "CM quickstart retrieved");
    return result;
  } catch (error) {
    log.error(
      {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      },
      "CM quickstart failed",
    );
    throw error;
  }
}

/**
 * Get playbook statistics.
 */
export async function getPlaybookStats(): Promise<CMStatsResult> {
  const log = getLogger();
  const correlationId = getCorrelationId();

  if (!_cmClient) {
    throw new CMClientError("unavailable", "CM is not initialized");
  }

  try {
    const result = await _cmClient.stats();
    log.debug({ correlationId, total: result.total }, "CM playbook stats retrieved");
    return result;
  } catch (error) {
    log.error(
      {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      },
      "CM stats failed",
    );
    throw error;
  }
}

/**
 * List playbook rules.
 */
export async function listPlaybookRules(
  options?: CMPlaybookListOptions,
): Promise<CMPlaybookListResult> {
  const log = getLogger();
  const correlationId = getCorrelationId();

  if (!_cmClient) {
    throw new CMClientError("unavailable", "CM is not initialized");
  }

  try {
    const result = await _cmClient.listPlaybook(options);
    log.debug({ correlationId, count: result.bullets.length }, "CM playbook rules listed");
    return result;
  } catch (error) {
    log.error(
      {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      },
      "CM playbook list failed",
    );
    throw error;
  }
}

/**
 * Run health diagnostics.
 */
export async function runDiagnostics(options?: CMDoctorOptions): Promise<CMDoctorResult> {
  const log = getLogger();
  const correlationId = getCorrelationId();

  if (!_cmClient) {
    throw new CMClientError("unavailable", "CM is not initialized");
  }

  try {
    const result = await _cmClient.doctor(options);
    log.info(
      {
        correlationId,
        overallStatus: result.overallStatus,
        checksCount: result.checks.length,
      },
      "CM diagnostics completed",
    );
    return result;
  } catch (error) {
    log.error(
      {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      },
      "CM diagnostics failed",
    );
    throw error;
  }
}

/**
 * Record session outcome for implicit feedback.
 */
export async function recordOutcome(
  status: "success" | "failure" | "partial",
  ruleIds: string[],
  options?: CMOutcomeOptions,
): Promise<CMOutcomeResult> {
  const log = getLogger();
  const correlationId = getCorrelationId();

  if (!_cmClient) {
    throw new CMClientError("unavailable", "CM is not initialized");
  }

  try {
    const result = await _cmClient.outcome(status, ruleIds, options);
    log.info(
      {
        correlationId,
        status,
        ruleCount: ruleIds.length,
        recorded: result.recorded,
      },
      "CM outcome recorded",
    );
    return result;
  } catch (error) {
    log.error(
      {
        correlationId,
        status,
        ruleIds,
        error: error instanceof Error ? error.message : String(error),
      },
      "CM outcome recording failed",
    );
    throw error;
  }
}

// Re-export the error class for route handlers
export { CMClientError };
