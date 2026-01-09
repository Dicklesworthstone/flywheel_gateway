import pino from "pino";

const isDev = process.env["NODE_ENV"] !== "production";
const logLevel = process.env["LOG_LEVEL"] ?? (isDev ? "debug" : "info");

/**
 * Base pino logger instance configured for Flywheel Gateway.
 *
 * - JSON output in production for log aggregation
 * - Pretty output in development for readability
 * - Configurable log level via LOG_LEVEL env var
 */
export const logger = pino({
  level: logLevel,
  base: {
    service: "flywheel-gateway",
    pid: process.pid,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname,service",
      },
    },
  }),
});

/**
 * Create a child logger with additional context bindings.
 */
export function createChildLogger(bindings: pino.Bindings): pino.Logger {
  return logger.child(bindings);
}

export type Logger = pino.Logger;
