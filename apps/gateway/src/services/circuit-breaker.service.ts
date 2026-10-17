/**
 * Circuit Breaker (tool/service dependency guard)
 *
 * Prevents noisy repeated failures when dependencies (CLI tools, MCP services,
 * etc.) are unavailable. Uses an OPEN backoff window (optionally exponential)
 * and a HALF_OPEN probe mode to detect recovery.
 *
 * States:
 *   CLOSED    → normal operation, checks go through
 *   OPEN      → dependency is known-bad, calls short-circuit (fail-fast)
 *   HALF_OPEN → backoff elapsed, allow limited probes to test recovery
 *
 * Transition rules:
 *   CLOSED  + failureThreshold consecutive failures  → OPEN
 *   OPEN    + reset/backoff elapsed                  → HALF_OPEN
 *   HALF_OPEN + successThreshold successes           → CLOSED (reset)
 *   HALF_OPEN + any failure                          → OPEN (backoff increased)
 */

import type { Channel } from "../ws/channels";
import { getHub } from "../ws/hub";
import { logger } from "./logger";

// ============================================================================
// Types
// ============================================================================

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  /** Consecutive failures before opening the circuit. Default: 5 */
  failureThreshold?: number;
  /** Alias for initialBackoffMs (preferred name). Default: 30_000 (30s) */
  resetTimeoutMs?: number;
  /** Successes needed in HALF_OPEN to close the circuit. Default: 2 */
  successThreshold?: number;
  /** Per-attempt timeout (ms) applied by the breaker. Default: 10_000 (10s) */
  timeoutMs?: number;
  /** Initial backoff in ms when circuit opens. Default: 30_000 (30s) */
  initialBackoffMs?: number;
  /** Maximum backoff in ms. Default: 300_000 (5min) */
  maxBackoffMs?: number;
  /** Backoff multiplier. Default: 2 */
  backoffMultiplier?: number;
  /** Max concurrent probes in HALF_OPEN. Default: 1 */
  halfOpenMaxConcurrent?: number;
}

export interface CircuitBreakerStatus {
  tool: string;
  state: CircuitState;
  failureCount: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailedAt: Date | null;
  lastSucceededAt: Date | null;
  nextRetryAt: Date | null;
  currentBackoffMs: number;
  halfOpenInFlight: number;
  totalChecks: number;
  totalFailures: number;
  totalSuccesses: number;
}

// ============================================================================
// Circuit Breaker
// ============================================================================

interface BreakerState {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailedAt: Date | null;
  lastSucceededAt: Date | null;
  nextRetryAt: Date | null;
  currentBackoffMs: number;
  halfOpenInFlight: number;
  totalChecks: number;
  totalFailures: number;
  totalSuccesses: number;
}

interface NormalizedCircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  backoffMultiplier: number;
  halfOpenMaxConcurrent: number;
}

const DEFAULT_CONFIG: NormalizedCircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeoutMs: 10_000,
  initialBackoffMs: 30_000,
  maxBackoffMs: 300_000,
  backoffMultiplier: 2,
  halfOpenMaxConcurrent: 1,
};

/** Per-tool circuit breaker states. */
const breakers = new Map<string, BreakerState>();

/** Global config (can be overridden per-tool). */
const toolConfigs = new Map<string, NormalizedCircuitBreakerConfig>();

function normalizeConfig(
  config: CircuitBreakerConfig,
): NormalizedCircuitBreakerConfig {
  const resetTimeoutMs = config.resetTimeoutMs;
  const initialBackoffMs = config.initialBackoffMs;

  return {
    ...DEFAULT_CONFIG,
    ...config,
    initialBackoffMs:
      resetTimeoutMs ?? initialBackoffMs ?? DEFAULT_CONFIG.initialBackoffMs,
  };
}

function getConfig(tool: string): NormalizedCircuitBreakerConfig {
  return toolConfigs.get(tool) ?? DEFAULT_CONFIG;
}

function getOrCreateBreaker(tool: string): BreakerState {
  let b = breakers.get(tool);
  if (!b) {
    b = {
      state: "CLOSED",
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastFailedAt: null,
      lastSucceededAt: null,
      nextRetryAt: null,
      currentBackoffMs: getConfig(tool).initialBackoffMs,
      halfOpenInFlight: 0,
      totalChecks: 0,
      totalFailures: 0,
      totalSuccesses: 0,
    };
    breakers.set(tool, b);
  }
  return b;
}

export class CircuitBreakerOpenError extends Error {
  override readonly name = "CircuitBreakerOpenError";
  constructor(public readonly tool: string) {
    super(`Circuit breaker OPEN for ${tool}`);
  }
}

export class CircuitBreakerTimeoutError extends Error {
  override readonly name = "CircuitBreakerTimeoutError";
  constructor(
    public readonly tool: string,
    public readonly timeoutMs: number,
  ) {
    super(`Circuit breaker timeout for ${tool} after ${timeoutMs}ms`);
  }
}

function publishCircuitStateChanged(
  tool: string,
  previousState: CircuitState,
): void {
  try {
    const hub = getHub();
    const channel: Channel = { type: "system:circuits" };
    hub.publish(
      channel,
      "circuit.state_changed",
      { tool, previousState, status: getBreakerStatus(tool) },
      {},
    );
  } catch {
    // Hub may not be initialized in all contexts
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Configure the circuit breaker for a specific tool.
 */
export function configureBreaker(
  tool: string,
  config: CircuitBreakerConfig,
): void {
  toolConfigs.set(tool, normalizeConfig(config));
}

/**
 * Check whether a health check should be attempted for this tool.
 *
 * Returns `true` if the check should proceed, `false` if the circuit
 * is open and the caller should use the cached failure.
 */
export function shouldCheck(tool: string): boolean {
  const b = getOrCreateBreaker(tool);
  const cfg = getConfig(tool);

  if (b.state === "CLOSED") return true;

  if (b.state === "OPEN") {
    // Check if backoff has elapsed
    if (b.nextRetryAt && Date.now() >= b.nextRetryAt.getTime()) {
      const previousState = b.state;
      b.state = "HALF_OPEN";
      b.consecutiveSuccesses = 0;
      // Keep failure counters for observability, but don't let them affect
      // HALF_OPEN probe gating.
      logger.info(
        { tool, previousBackoffMs: b.currentBackoffMs },
        "circuit-breaker: transitioning to HALF_OPEN",
      );
      publishCircuitStateChanged(tool, previousState);
      return true;
    }
    return false;
  }

  // HALF_OPEN: allow limited concurrent probes
  return b.halfOpenInFlight < cfg.halfOpenMaxConcurrent;
}

/**
 * Record a successful health check result.
 */
export function recordSuccess(tool: string): void {
  const b = getOrCreateBreaker(tool);
  const prevState = b.state;
  const cfg = getConfig(tool);

  b.totalChecks++;
  b.totalSuccesses++;
  b.consecutiveSuccesses++;
  b.consecutiveFailures = 0;
  b.lastSucceededAt = new Date();

  if (prevState === "HALF_OPEN") {
    if (b.consecutiveSuccesses < cfg.successThreshold) {
      // Stay HALF_OPEN until we see enough consecutive successes.
      logger.info(
        {
          tool,
          consecutiveSuccesses: b.consecutiveSuccesses,
          successThreshold: cfg.successThreshold,
        },
        "circuit-breaker: HALF_OPEN success (waiting for threshold)",
      );
      return;
    }
  }

  if (prevState === "HALF_OPEN" || prevState === "OPEN") {
    b.state = "CLOSED";
    b.currentBackoffMs = cfg.initialBackoffMs;
    b.nextRetryAt = null;
    logger.info(
      { tool, previousState: prevState },
      "circuit-breaker: CLOSED (recovered)",
    );
    publishCircuitStateChanged(tool, prevState);
  }
}

/**
 * Record a failed health check result.
 */
export function recordFailure(tool: string): void {
  const b = getOrCreateBreaker(tool);
  const prevState = b.state;
  const cfg = getConfig(tool);

  b.totalChecks++;
  b.totalFailures++;
  b.consecutiveFailures++;
  b.consecutiveSuccesses = 0;
  b.lastFailedAt = new Date();

  if (b.state === "HALF_OPEN") {
    // Probe failed, re-open with doubled backoff
    b.state = "OPEN";
    b.currentBackoffMs = Math.min(
      b.currentBackoffMs * cfg.backoffMultiplier,
      cfg.maxBackoffMs,
    );
    b.nextRetryAt = new Date(Date.now() + b.currentBackoffMs);
    logger.warn(
      { tool, backoffMs: b.currentBackoffMs },
      "circuit-breaker: OPEN (probe failed, backoff increased)",
    );
    publishCircuitStateChanged(tool, prevState);
    return;
  }

  if (b.state === "CLOSED" && b.consecutiveFailures >= cfg.failureThreshold) {
    b.state = "OPEN";
    b.nextRetryAt = new Date(Date.now() + b.currentBackoffMs);
    logger.warn(
      {
        tool,
        failures: b.consecutiveFailures,
        backoffMs: b.currentBackoffMs,
      },
      "circuit-breaker: OPEN (failure threshold reached)",
    );
    publishCircuitStateChanged(tool, prevState);
  }
}

async function runWithTimeout<T>(
  tool: string,
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fn();
  }

  const opPromise = fn();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      reject(new CircuitBreakerTimeoutError(tool, timeoutMs));
    }, timeoutMs);
  });

  try {
    return (await Promise.race([opPromise, timeoutPromise])) as T;
  } catch (error) {
    // Prevent an unhandled rejection if the underlying promise rejects after timeout.
    if (timedOut) {
      void opPromise.catch(() => undefined);
    }
    throw error;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export async function runThroughCircuitBreaker<T>(
  tool: string,
  checkFn: () => Promise<T>,
  options?: { isSuccess?: (result: T) => boolean; timeoutMs?: number },
): Promise<T> {
  if (!shouldCheck(tool)) {
    throw new CircuitBreakerOpenError(tool);
  }

  const b = getOrCreateBreaker(tool);
  const acquiredHalfOpenPermit = b.state === "HALF_OPEN";
  if (acquiredHalfOpenPermit) {
    b.halfOpenInFlight++;
  }

  const cfg = getConfig(tool);
  const timeoutMs = options?.timeoutMs ?? cfg.timeoutMs;

  try {
    const result = await runWithTimeout(tool, checkFn, timeoutMs);
    const isSuccess = options?.isSuccess?.(result) ?? true;
    if (isSuccess) {
      recordSuccess(tool);
    } else {
      recordFailure(tool);
    }
    return result;
  } catch (error) {
    recordFailure(tool);
    throw error;
  } finally {
    if (acquiredHalfOpenPermit) {
      b.halfOpenInFlight = Math.max(0, b.halfOpenInFlight - 1);
    }
  }
}

/**
 * Execute a health check function through the circuit breaker.
 *
 * If the circuit is open, returns the cached failure immediately.
 * Otherwise runs the check and records the result.
 */
export async function withCircuitBreaker<T>(
  tool: string,
  checkFn: () => Promise<T>,
  fallbackValue: T,
  options?: { isSuccess?: (result: T) => boolean },
): Promise<{ result: T; fromCache: boolean; error?: unknown }> {
  try {
    const result = await runThroughCircuitBreaker(tool, checkFn, options);
    return { result, fromCache: false };
  } catch (error) {
    return { result: fallbackValue, fromCache: true, error };
  }
}

/**
 * Get the current status of a tool's circuit breaker.
 */
export function getBreakerStatus(tool: string): CircuitBreakerStatus {
  const b = getOrCreateBreaker(tool);
  return {
    tool,
    state: b.state,
    failureCount: b.consecutiveFailures,
    consecutiveFailures: b.consecutiveFailures,
    consecutiveSuccesses: b.consecutiveSuccesses,
    lastFailedAt: b.lastFailedAt,
    lastSucceededAt: b.lastSucceededAt,
    nextRetryAt: b.nextRetryAt,
    currentBackoffMs: b.currentBackoffMs,
    halfOpenInFlight: b.halfOpenInFlight,
    totalChecks: b.totalChecks,
    totalFailures: b.totalFailures,
    totalSuccesses: b.totalSuccesses,
  };
}

/**
 * Get status for all tracked circuit breakers.
 */
export function getAllBreakerStatuses(): CircuitBreakerStatus[] {
  const statuses: CircuitBreakerStatus[] = [];
  breakers.forEach((_state, tool) => {
    statuses.push(getBreakerStatus(tool));
  });
  return statuses;
}

/**
 * Manually reset a circuit breaker to CLOSED state.
 */
export function resetBreaker(tool: string): void {
  const b = breakers.get(tool);
  if (b) {
    const previousState = b.state;
    const cfg = getConfig(tool);
    b.state = "CLOSED";
    b.consecutiveFailures = 0;
    b.consecutiveSuccesses = 0;
    b.halfOpenInFlight = 0;
    b.currentBackoffMs = cfg.initialBackoffMs;
    b.nextRetryAt = null;
    logger.info({ tool }, "circuit-breaker: manually reset to CLOSED");
    if (previousState !== "CLOSED") {
      publishCircuitStateChanged(tool, previousState);
    }
  }
}

/**
 * Clear all breaker state (for testing).
 */
export function _clearAllBreakers(): void {
  breakers.clear();
  toolConfigs.clear();
}
