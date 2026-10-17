import pino from "pino";

const isDev = process.env["NODE_ENV"] !== "production";
const logLevel = process.env["LOG_LEVEL"] ?? (isDev ? "debug" : "info");

const baseBindings = {
  service: "flywheel-gateway",
  pid: process.pid,
};

const isBun = typeof process.versions?.bun === "string";

/**
 * Create the base logger. We ALWAYS use sync mode (no transport) now because:
 * 1. pino-pretty transport can cause issues in parallel test execution
 * 2. The async worker logger may not have child() immediately available
 * 3. JSON logs are fine for development and can be piped to pino-pretty externally
 *
 * To get pretty logs during development, run:
 *   bun dev | npx pino-pretty
 */
const baseLogger = pino({
  level: logLevel,
  base: baseBindings,
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Capture the native child() function before we override it below.
// Otherwise, `ensureChild()` would call itself in non-Bun runtimes.
const nativeChild =
  typeof baseLogger.child === "function"
    ? baseLogger.child.bind(baseLogger)
    : undefined;

/**
 * Defensive wrapper that ensures child() method is always available.
 * If the base logger doesn't have child() for some reason, we return
 * a new logger instance with the bindings as base.
 */
function ensureChild(bindings: pino.Bindings): pino.Logger {
  if (!isBun && nativeChild) {
    return nativeChild(bindings);
  }
  // Fallback: create a new logger with the bindings.
  // In Bun, baseLogger.child can hang, so we always use the safe path.
  return pino({
    level: logLevel,
    base: {
      ...baseBindings,
      ...bindings,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

/**
 * Exported logger with guaranteed child() method.
 */
export const logger: pino.Logger = Object.assign(baseLogger, {
  child: ensureChild,
});

/**
 * Create a child logger with additional context bindings.
 */
export function createChildLogger(bindings: pino.Bindings): pino.Logger {
  return ensureChild(bindings);
}

export interface Logger {
  info: pino.LogFn;
  warn: pino.LogFn;
  debug: pino.LogFn;
  error: pino.LogFn;
  child: (bindings: pino.Bindings) => Logger;
}
