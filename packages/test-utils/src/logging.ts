export type TestLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface TestLogEntry {
  level: TestLogLevel;
  message: string;
  timestamp: string;
  meta?: Record<string, unknown>;
}

export interface TestLogger {
  trace: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  entries: TestLogEntry[];
}

const LOG_LEVELS: TestLogLevel[] = ['trace', 'debug', 'info', 'warn', 'error'];

export function createTestLogger(): TestLogger {
  const entries: TestLogEntry[] = [];
  const log = (level: TestLogLevel, message: string, meta?: Record<string, unknown>) => {
    entries.push({
      level,
      message,
      timestamp: new Date().toISOString(),
      meta
    });
  };

  return {
    entries,
    trace: (message, meta) => log('trace', message, meta),
    debug: (message, meta) => log('debug', message, meta),
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta)
  };
}

export function captureTestLogs(): { logger: TestLogger; logs: TestLogEntry[] } {
  const logger = createTestLogger();
  return { logger, logs: logger.entries };
}

export function assertLogContains(
  logs: TestLogEntry[],
  matcher: { level?: TestLogLevel; message?: string }
): void {
  const hit = logs.some((entry) => {
    if (matcher.level && entry.level !== matcher.level) {
      return false;
    }
    if (matcher.message && !entry.message.includes(matcher.message)) {
      return false;
    }
    return true;
  });

  if (!hit) {
    throw new Error(
      `Expected logs to contain entry with level=${matcher.level ?? '*'} and message~=${
        matcher.message ?? '*'
      }`
    );
  }
}

export function getTestLogSummary(logs: TestLogEntry[]): Record<TestLogLevel, number> {
  return LOG_LEVELS.reduce(
    (acc, level) => {
      acc[level] = logs.filter((entry) => entry.level === level).length;
      return acc;
    },
    {} as Record<TestLogLevel, number>
  );
}
