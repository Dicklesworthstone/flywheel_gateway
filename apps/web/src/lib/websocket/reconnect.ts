/**
 * WebSocket Reconnection with Exponential Backoff + Jitter
 *
 * Implements reconnection delays using exponential backoff with
 * full jitter to prevent thundering herd when multiple clients
 * reconnect simultaneously.
 */

export interface BackoffConfig {
  /** Base delay in milliseconds (default: 1000ms) */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (default: 30000ms) */
  maxDelayMs: number;
  /** Exponential multiplier (default: 2) */
  multiplier: number;
  /** Jitter factor 0-1, where 1 is full jitter (default: 1) */
  jitterFactor: number;
  /** Maximum number of reconnection attempts before giving up (default: 10) */
  maxAttempts: number;
}

export const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  multiplier: 2,
  jitterFactor: 1,
  maxAttempts: 10,
};

/**
 * Calculate the exponential backoff delay for a given attempt.
 *
 * Uses "full jitter" strategy as recommended by AWS:
 * https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 *
 * Formula: delay = random(0, min(maxDelay, baseDelay * multiplier^attempt))
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param config - Backoff configuration
 * @returns Delay in milliseconds
 */
export function calculateBackoff(
  attempt: number,
  config: Partial<BackoffConfig> = {},
): number {
  const { baseDelayMs, maxDelayMs, multiplier, jitterFactor } = {
    ...DEFAULT_BACKOFF_CONFIG,
    ...config,
  };

  // Calculate exponential delay
  const exponentialDelay = baseDelayMs * multiplier ** attempt;

  // Cap at maximum delay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Apply jitter: random value between (1 - jitterFactor) * delay and delay
  // Full jitter (jitterFactor = 1) means random between 0 and cappedDelay
  const minJitter = cappedDelay * (1 - jitterFactor);
  const jitteredDelay = minJitter + Math.random() * (cappedDelay - minJitter);

  return Math.floor(jitteredDelay);
}

/**
 * Check if reconnection should continue based on attempt count.
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param config - Backoff configuration
 * @returns True if should continue trying, false if max attempts reached
 */
export function shouldRetry(
  attempt: number,
  config: Partial<BackoffConfig> = {},
): boolean {
  const { maxAttempts } = { ...DEFAULT_BACKOFF_CONFIG, ...config };
  return attempt < maxAttempts;
}

/**
 * Connection state machine for WebSocket reconnection.
 */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

export interface ConnectionStatus {
  state: ConnectionState;
  /** Current reconnection attempt (0 when connected or disconnected) */
  attempt: number;
  /** Timestamp of last successful connection */
  lastConnectedAt: number | null;
  /** Timestamp of last disconnect */
  lastDisconnectedAt: number | null;
  /** Time until next reconnection attempt in ms (null if not reconnecting) */
  nextRetryInMs: number | null;
  /** Human-readable status hint */
  hint: string;
}

/**
 * Generate status hint based on connection state.
 */
export function getStatusHint(
  state: ConnectionState,
  attempt: number,
  maxAttempts: number,
): string {
  switch (state) {
    case "disconnected":
      return "Disconnected";
    case "connecting":
      return "Connecting...";
    case "connected":
      return "Connected";
    case "reconnecting":
      return `Reconnecting (attempt ${attempt + 1}/${maxAttempts})...`;
    case "failed":
      return "Connection failed. Click to retry.";
    default:
      return "Unknown state";
  }
}

/**
 * Create initial connection status.
 */
export function createInitialStatus(): ConnectionStatus {
  return {
    state: "disconnected",
    attempt: 0,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    nextRetryInMs: null,
    hint: "Disconnected",
  };
}
