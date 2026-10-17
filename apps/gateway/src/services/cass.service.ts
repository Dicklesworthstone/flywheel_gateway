/**
 * CASS Service - Cross-Agent Session Search integration for Flywheel Gateway.
 *
 * Provides search across agent session histories using the cass CLI.
 * Used by context.service.ts for building search sections.
 */

import {
  type CassClient,
  CassClientError,
  type CassClientOptions,
  type CassExpandOptions,
  type CassExpandResult,
  type CassHealth,
  type CassSearchHit,
  type CassSearchOptions,
  type CassSearchResult,
  type CassViewOptions,
  type CassViewResult,
  createBunCassCommandRunner,
  createCassClient,
} from "@flywheel/flywheel-clients";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  CircuitBreakerOpenError,
  CircuitBreakerTimeoutError,
  configureBreaker,
  runThroughCircuitBreaker,
  withCircuitBreaker,
} from "./circuit-breaker.service";

// ============================================================================
// Types
// ============================================================================

export interface CassServiceConfig {
  /** Working directory for cass commands */
  cwd?: string;
  /** Default timeout in milliseconds */
  timeout?: number;
  /** Whether CASS is enabled (default: true) */
  enabled?: boolean;
}

export interface CassSearchRequest {
  query: string;
  options?: CassSearchOptions;
}

export interface CassServiceStatus {
  available: boolean;
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}

// Re-export types from client
export type {
  CassExpandOptions,
  CassExpandResult,
  CassHealth,
  CassSearchHit,
  CassSearchOptions,
  CassSearchResult,
  CassViewOptions,
  CassViewResult,
};

// ============================================================================
// Singleton Client
// ============================================================================

let _cassClient: CassClient | null = null;
let _cassConfig: CassServiceConfig = {};

/**
 * Initialize the CASS client with configuration.
 */
export function initCassService(config: CassServiceConfig = {}): void {
  _cassConfig = config;
  if (config.enabled === false) {
    _cassClient = null;
    return;
  }

  const runner = createBunCassCommandRunner();
  const clientOptions: CassClientOptions = {
    runner,
    timeout: config.timeout ?? 30000,
  };
  if (config.cwd !== undefined) {
    clientOptions.cwd = config.cwd;
  }
  _cassClient = createCassClient(clientOptions);

  // CASS operations can legitimately take longer than the breaker defaults.
  configureBreaker("cass", {
    timeoutMs: clientOptions.timeout ?? 30_000,
  });
}

/**
 * Get the CASS client instance.
 * Returns null if CASS is disabled or not initialized.
 */
export function getCassClient(): CassClient | null {
  return _cassClient;
}

/**
 * Check if CASS is enabled and initialized.
 */
export function isCassEnabled(): boolean {
  return _cassClient !== null;
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Get CASS service status.
 */
export async function getCassStatus(): Promise<CassServiceStatus> {
  const log = getLogger();
  const correlationId = getCorrelationId();

  if (!_cassClient) {
    return {
      available: false,
      healthy: false,
      error: "CASS is not initialized",
    };
  }
  const cass = _cassClient;

  try {
    const health = await runThroughCircuitBreaker(
      "cass",
      () => cass.health({ includeMeta: true }),
      { isSuccess: (h) => h.healthy },
    );
    return {
      available: true,
      healthy: health.healthy,
      latencyMs: health.latency_ms,
    };
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      return {
        available: false,
        healthy: false,
        error: "CASS circuit breaker open",
      };
    }
    if (error instanceof CircuitBreakerTimeoutError) {
      return {
        available: true,
        healthy: false,
        error: `CASS health check timed out after ${error.timeoutMs}ms`,
      };
    }
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    log.warn(
      { correlationId, error: errorMessage },
      "CASS health check failed",
    );
    return {
      available: false,
      healthy: false,
      error: errorMessage,
    };
  }
}

/**
 * Check if CASS is available (fast check).
 */
export async function isCassAvailable(): Promise<boolean> {
  if (!_cassClient) {
    return false;
  }
  const cass = _cassClient;
  const { result } = await withCircuitBreaker(
    "cass",
    () => cass.isAvailable(),
    false,
  );
  return result;
}

/**
 * Search across agent sessions.
 */
export async function searchSessions(
  query: string,
  options?: CassSearchOptions,
): Promise<CassSearchResult> {
  const log = getLogger();
  const correlationId = getCorrelationId();
  const startTime = performance.now();

  if (!_cassClient) {
    throw new CassClientError("unavailable", "CASS is not initialized");
  }
  const cass = _cassClient;

  try {
    const result = await runThroughCircuitBreaker("cass", () =>
      cass.search(query, options),
    );

    log.info(
      {
        correlationId,
        query,
        hitCount: result.count,
        totalMatches: result.total_matches,
        durationMs: Math.round(performance.now() - startTime),
      },
      "CASS search completed",
    );

    return result;
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      log.debug(
        { correlationId, query },
        "CASS search short-circuited (circuit breaker open)",
      );
      throw new CassClientError("unavailable", "CASS circuit breaker open", {
        operation: "search",
      });
    }
    if (error instanceof CircuitBreakerTimeoutError) {
      throw new CassClientError("timeout", "CASS request timed out", {
        operation: "search",
        timeoutMs: error.timeoutMs,
      });
    }
    log.error(
      {
        correlationId,
        query,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Math.round(performance.now() - startTime),
      },
      "CASS search failed",
    );
    throw error;
  }
}

/**
 * View session content at a specific line.
 */
export async function viewSessionLine(
  path: string,
  options: CassViewOptions,
): Promise<CassViewResult> {
  const log = getLogger();
  const correlationId = getCorrelationId();

  if (!_cassClient) {
    throw new CassClientError("unavailable", "CASS is not initialized");
  }
  const cass = _cassClient;

  try {
    const result = await runThroughCircuitBreaker("cass", () =>
      cass.view(path, options),
    );
    log.debug(
      { correlationId, path, line: options.line },
      "CASS view completed",
    );
    return result;
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      throw new CassClientError("unavailable", "CASS circuit breaker open", {
        operation: "view",
      });
    }
    if (error instanceof CircuitBreakerTimeoutError) {
      throw new CassClientError("timeout", "CASS request timed out", {
        operation: "view",
        timeoutMs: error.timeoutMs,
      });
    }
    log.error(
      {
        correlationId,
        path,
        line: options.line,
        error: error instanceof Error ? error.message : String(error),
      },
      "CASS view failed",
    );
    throw error;
  }
}

/**
 * Expand messages around a specific line in a session.
 */
export async function expandSessionContext(
  path: string,
  options: CassExpandOptions,
): Promise<CassExpandResult> {
  const log = getLogger();
  const correlationId = getCorrelationId();

  if (!_cassClient) {
    throw new CassClientError("unavailable", "CASS is not initialized");
  }
  const cass = _cassClient;

  try {
    const result = await runThroughCircuitBreaker("cass", () =>
      cass.expand(path, options),
    );
    log.debug(
      { correlationId, path, line: options.line },
      "CASS expand completed",
    );
    return result;
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      throw new CassClientError("unavailable", "CASS circuit breaker open", {
        operation: "expand",
      });
    }
    if (error instanceof CircuitBreakerTimeoutError) {
      throw new CassClientError("timeout", "CASS request timed out", {
        operation: "expand",
        timeoutMs: error.timeoutMs,
      });
    }
    log.error(
      {
        correlationId,
        path,
        line: options.line,
        error: error instanceof Error ? error.message : String(error),
      },
      "CASS expand failed",
    );
    throw error;
  }
}

/**
 * Search for related sessions given a source path.
 * Useful for finding similar work or prior solutions.
 */
export async function findRelatedSessions(
  sourcePath: string,
  options?: {
    limit?: number;
    days?: number;
  },
): Promise<CassSearchResult> {
  // Use the source path as the query to find related sessions
  return searchSessions(sourcePath, {
    limit: options?.limit ?? 5,
    days: options?.days ?? 30,
    fields: "summary",
  });
}

/**
 * Search with a token budget, automatically truncating results.
 */
export async function searchWithTokenBudget(
  query: string,
  tokenBudget: number,
  options?: Omit<CassSearchOptions, "maxTokens">,
): Promise<CassSearchResult> {
  return searchSessions(query, {
    ...options,
    maxTokens: tokenBudget,
  });
}
