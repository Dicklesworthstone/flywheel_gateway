/**
 * Smart Retry with Backoff Profiles Service (bd-m4fk1)
 *
 * Provides configurable retry strategies per operation type:
 * - Strategies: exponential, linear, fixed, fibonacci
 * - Jitter modes: none, full, equal, decorrelated
 * - Circuit-breaker aware execution (`withRetry`)
 * - 5 built-in retry profiles + custom profile CRUD + delay simulation + metrics
 */

import { ulid } from "ulid";
import { z } from "zod";
import { getBreakerStatus } from "./circuit-breaker.service";
import { logger } from "./logger";

// ============================================================================
// Schemas & Types
// ============================================================================

export const RetryStrategySchema = z.enum([
  "exponential",
  "linear",
  "fixed",
  "fibonacci",
]);

export const JitterModeSchema = z.enum([
  "none",
  "full",
  "equal",
  "decorrelated",
]);

export const CreateRetryProfileSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(100),
  description: z.string().max(400).optional(),
  strategy: RetryStrategySchema.default("exponential"),
  jitter: JitterModeSchema.default("none"),
  jitterFactor: z.number().min(0).max(1).default(0.5),
  initialDelayMs: z.number().int().min(1).max(60_000).default(200),
  maxDelayMs: z.number().int().min(10).max(600_000).default(10_000),
  multiplier: z.number().min(1).max(20).default(2),
  maxAttempts: z.number().int().min(1).max(20).default(3),
  retryableErrors: z.array(z.string()).optional(),
  respectCircuitBreaker: z.boolean().default(true),
  circuitName: z.string().optional(),
});

export type RetryStrategy = z.infer<typeof RetryStrategySchema>;
export type JitterMode = z.infer<typeof JitterModeSchema>;
export type CreateRetryProfileInput = z.input<typeof CreateRetryProfileSchema>;

export interface RetryProfile {
  id: string;
  name: string;
  description?: string;
  strategy: RetryStrategy;
  jitter: JitterMode;
  jitterFactor: number;
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  maxAttempts: number;
  retryableErrors?: string[];
  respectCircuitBreaker: boolean;
  circuitName?: string;
  builtIn: boolean;
}

export interface RetryExecutionResult<T> {
  success: boolean;
  value?: T;
  error?: string;
  attempts: number;
  delaysMs: number[];
  totalDurationMs: number;
  circuitShortCircuited?: boolean;
}

// ============================================================================
// Built-In Profiles & State
// ============================================================================

const BUILT_IN_PROFILES: RetryProfile[] = [
  {
    id: "api_rate_limit",
    name: "api_rate_limit",
    description: "Exponential backoff for LLM/API 429 rate limits",
    strategy: "exponential",
    jitter: "equal",
    jitterFactor: 0.3,
    initialDelayMs: 1000,
    maxDelayMs: 30_000,
    multiplier: 2,
    maxAttempts: 5,
    retryableErrors: ["RATE_LIMIT", "429", "TOO_MANY_REQUESTS"],
    respectCircuitBreaker: true,
    builtIn: true,
  },
  {
    id: "network_timeout",
    name: "network_timeout",
    description: "Fibonacci backoff for transient network timeouts",
    strategy: "fibonacci",
    jitter: "full",
    jitterFactor: 0.5,
    initialDelayMs: 250,
    maxDelayMs: 8000,
    multiplier: 2,
    maxAttempts: 4,
    retryableErrors: ["TIMEOUT", "ECONNRESET", "ETIMEDOUT"],
    respectCircuitBreaker: true,
    builtIn: true,
  },
  {
    id: "file_lock_transient",
    name: "file_lock_transient",
    description:
      "Fast linear retry for transient file reservation/lock contention",
    strategy: "linear",
    jitter: "none",
    jitterFactor: 0.2,
    initialDelayMs: 50,
    maxDelayMs: 500,
    multiplier: 1,
    maxAttempts: 4,
    retryableErrors: ["EBUSY", "EAGAIN", "LOCK_CONTENTION"],
    respectCircuitBreaker: false,
    builtIn: true,
  },
  {
    id: "db_busy",
    name: "db_busy",
    description: "Decorrelated jitter retry for SQLite SQLITE_BUSY contention",
    strategy: "exponential",
    jitter: "decorrelated",
    jitterFactor: 0.5,
    initialDelayMs: 25,
    maxDelayMs: 1500,
    multiplier: 2,
    maxAttempts: 6,
    retryableErrors: ["SQLITE_BUSY", "DATABASE_LOCKED"],
    respectCircuitBreaker: false,
    builtIn: true,
  },
  {
    id: "webhook_delivery",
    name: "webhook_delivery",
    description: "Exponential retry for outbound webhook delivery",
    strategy: "exponential",
    jitter: "equal",
    jitterFactor: 0.25,
    initialDelayMs: 500,
    maxDelayMs: 60_000,
    multiplier: 2,
    maxAttempts: 4,
    retryableErrors: ["502", "503", "504", "TIMEOUT"],
    respectCircuitBreaker: true,
    builtIn: true,
  },
];

const profilesStore = new Map<string, RetryProfile>();
const forcedOpenCircuits = new Set<string>();
const retryMetrics = {
  totalExecutions: 0,
  totalSuccesses: 0,
  totalExhausted: 0,
  totalAttempts: 0,
};

function ensureBuiltInProfiles(): void {
  if (profilesStore.size === 0) {
    for (const p of BUILT_IN_PROFILES) {
      profilesStore.set(p.id, structuredClone(p));
    }
  }
}

// ============================================================================
// Delay & Jitter Calculation
// ============================================================================

function fibonacci(n: number): number {
  if (n <= 1) return 1;
  if (n === 2) return 1;
  let a = 1;
  let b = 1;
  for (let i = 3; i <= n; i++) {
    const c = a + b;
    a = b;
    b = c;
  }
  return b;
}

export function calculateDelay(
  attempt: number,
  profile: {
    strategy: RetryStrategy;
    initialDelayMs: number;
    maxDelayMs?: number;
    multiplier?: number;
  },
  _previousDelayMs: number = 0,
): number {
  const step = Math.max(1, attempt);
  const initial = profile.initialDelayMs;
  const mult = profile.multiplier ?? 2;
  let raw = initial;

  switch (profile.strategy) {
    case "fixed":
      raw = initial;
      break;
    case "linear":
      raw = initial * step;
      break;
    case "exponential":
      raw = initial * mult ** (step - 1);
      break;
    case "fibonacci":
      raw = initial * fibonacci(step);
      break;
  }

  if (profile.maxDelayMs !== undefined) {
    return Math.min(raw, profile.maxDelayMs);
  }
  return raw;
}

export function applyJitter(
  delayMs: number,
  jitter: JitterMode,
  previousDelayMs: number = 0,
  options: {
    jitterFactor?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    randomFn?: () => number;
  } = {},
): number {
  const rand = options.randomFn ? options.randomFn() : Math.random();
  switch (jitter) {
    case "none":
      return delayMs;
    case "full":
      return Math.round(rand * delayMs);
    case "equal": {
      const factor = options.jitterFactor ?? 0.5;
      const minDelay = delayMs * (1 - factor);
      return Math.round(minDelay + rand * (delayMs - minDelay));
    }
    case "decorrelated": {
      const min = options.initialDelayMs ?? 100;
      const prev = Math.max(min, previousDelayMs);
      const maxRange = prev * 3;
      const val = Math.round(min + rand * (maxRange - min));
      return options.maxDelayMs !== undefined
        ? Math.min(val, options.maxDelayMs)
        : val;
    }
  }
}

// ============================================================================
// Retry Executor (`withRetry`)
// ============================================================================

export function openCircuitForTesting(circuitName: string): void {
  forcedOpenCircuits.add(circuitName);
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  profileInput: Partial<CreateRetryProfileInput> & { name?: string },
  context: {
    operationType?: string;
    correlationId?: string;
    circuitName?: string;
    sleepFn?: (ms: number) => Promise<void>;
  } = {},
): Promise<RetryExecutionResult<T>> {
  ensureBuiltInProfiles();
  const profile = CreateRetryProfileSchema.parse({
    name: profileInput.name ?? "adhoc",
    ...profileInput,
  });

  const startMs = Date.now();
  const sleep =
    context.sleepFn ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 5))));

  retryMetrics.totalExecutions++;
  const circuitName = context.circuitName ?? profile.circuitName;

  if (profile.respectCircuitBreaker && circuitName) {
    const breakerStatus = getBreakerStatus(circuitName);
    if (forcedOpenCircuits.has(circuitName) || breakerStatus.state === "OPEN") {
      retryMetrics.totalExhausted++;
      return {
        success: false,
        error: `Circuit breaker '${circuitName}' is OPEN`,
        attempts: 0,
        delaysMs: [],
        totalDurationMs: Date.now() - startMs,
        circuitShortCircuited: true,
      };
    }
  }

  let attempts = 0;
  let prevDelay = 0;
  const delaysMs: number[] = [];
  let lastErrorMsg = "Unknown error";

  while (attempts < profile.maxAttempts) {
    attempts++;
    retryMetrics.totalAttempts++;

    logger.info(
      {
        profileName: profile.name,
        attempt: attempts,
        maxAttempts: profile.maxAttempts,
        operationType: context.operationType ?? "generic",
        correlationId: context.correlationId,
      },
      "retry.attempt_started",
    );

    try {
      const value = await operation(attempts);
      retryMetrics.totalSuccesses++;
      const totalDurationMs = Date.now() - startMs;
      logger.info(
        {
          profileName: profile.name,
          attempts,
          totalDurationMs,
          correlationId: context.correlationId,
        },
        "retry.success",
      );
      return {
        success: true,
        value,
        attempts,
        delaysMs,
        totalDurationMs,
      };
    } catch (err) {
      lastErrorMsg = err instanceof Error ? err.message : String(err);

      // Check if error is retryable when retryableErrors list is configured
      if (profile.retryableErrors?.length) {
        const isRetryable = profile.retryableErrors.some((token) =>
          lastErrorMsg.includes(token),
        );
        if (!isRetryable) {
          retryMetrics.totalExhausted++;
          return {
            success: false,
            error: lastErrorMsg,
            attempts,
            delaysMs,
            totalDurationMs: Date.now() - startMs,
          };
        }
      }

      if (attempts < profile.maxAttempts) {
        const baseDelay = calculateDelay(attempts, profile, prevDelay);
        const jittered = applyJitter(baseDelay, profile.jitter, prevDelay, {
          jitterFactor: profile.jitterFactor,
          initialDelayMs: profile.initialDelayMs,
          maxDelayMs: profile.maxDelayMs,
        });
        prevDelay = jittered;
        delaysMs.push(jittered);

        logger.info(
          {
            profileName: profile.name,
            attempt: attempts,
            errorMessage: lastErrorMsg,
            nextDelayMs: jittered,
            strategy: profile.strategy,
            correlationId: context.correlationId,
          },
          "retry.attempt_failed",
        );

        await sleep(jittered);
      }
    }
  }

  retryMetrics.totalExhausted++;
  const totalDurationMs = Date.now() - startMs;
  logger.warn(
    {
      profileName: profile.name,
      maxAttempts: profile.maxAttempts,
      totalDurationMs,
      finalError: lastErrorMsg,
      correlationId: context.correlationId,
    },
    "retry.exhausted",
  );

  return {
    success: false,
    error: lastErrorMsg,
    attempts,
    delaysMs,
    totalDurationMs,
  };
}

// ============================================================================
// Profile CRUD & Simulation
// ============================================================================

export function listRetryProfiles(): RetryProfile[] {
  ensureBuiltInProfiles();
  return Array.from(profilesStore.values());
}

export function getRetryProfile(idOrName: string): RetryProfile | undefined {
  ensureBuiltInProfiles();
  return (
    profilesStore.get(idOrName) ??
    Array.from(profilesStore.values()).find((p) => p.name === idOrName)
  );
}

export function createRetryProfile(
  input: CreateRetryProfileInput,
): RetryProfile {
  ensureBuiltInProfiles();
  const parsed = CreateRetryProfileSchema.parse(input);
  const id = parsed.id ?? `rpf_${ulid()}`;
  const profile: RetryProfile = {
    id,
    name: parsed.name,
    ...(parsed.description !== undefined && {
      description: parsed.description,
    }),
    strategy: parsed.strategy,
    jitter: parsed.jitter,
    jitterFactor: parsed.jitterFactor,
    initialDelayMs: parsed.initialDelayMs,
    maxDelayMs: parsed.maxDelayMs,
    multiplier: parsed.multiplier,
    maxAttempts: parsed.maxAttempts,
    ...(parsed.retryableErrors !== undefined && {
      retryableErrors: parsed.retryableErrors,
    }),
    respectCircuitBreaker: parsed.respectCircuitBreaker,
    ...(parsed.circuitName !== undefined && {
      circuitName: parsed.circuitName,
    }),
    builtIn: false,
  };
  profilesStore.set(id, profile);
  return profile;
}

export function simulateRetryDelays(
  idOrName: string,
  attemptsCount?: number,
):
  | { profile: RetryProfile; delays: number[]; totalDelayMs: number }
  | undefined {
  const profile = getRetryProfile(idOrName);
  if (!profile) return undefined;
  const count = attemptsCount ?? profile.maxAttempts;
  const delays: number[] = [];
  let prev = 0;

  for (let i = 1; i <= count; i++) {
    const base = calculateDelay(i, profile, prev);
    prev = base;
    delays.push(base);
  }

  return {
    profile,
    delays,
    totalDelayMs: delays.reduce((a, b) => a + b, 0),
  };
}

export function getRetryMetrics() {
  return { ...retryMetrics };
}

export function clearSmartRetryForTesting(): void {
  profilesStore.clear();
  forcedOpenCircuits.clear();
  retryMetrics.totalExecutions = 0;
  retryMetrics.totalSuccesses = 0;
  retryMetrics.totalExhausted = 0;
  retryMetrics.totalAttempts = 0;
}
