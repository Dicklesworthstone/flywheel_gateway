export type TestLogLevel = "trace" | "debug" | "info" | "warn" | "error";

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

const LOG_LEVELS: TestLogLevel[] = ["trace", "debug", "info", "warn", "error"];

export function createTestLogger(): TestLogger {
  const entries: TestLogEntry[] = [];
  const log = (
    level: TestLogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ) => {
    // Build entry conditionally (for exactOptionalPropertyTypes)
    const entry: TestLogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
    };
    if (meta !== undefined) entry.meta = meta;
    entries.push(entry);
  };

  return {
    entries,
    trace: (message, meta) => log("trace", message, meta),
    debug: (message, meta) => log("debug", message, meta),
    info: (message, meta) => log("info", message, meta),
    warn: (message, meta) => log("warn", message, meta),
    error: (message, meta) => log("error", message, meta),
  };
}

export function captureTestLogs(): {
  logger: TestLogger;
  logs: TestLogEntry[];
} {
  const logger = createTestLogger();
  return { logger, logs: logger.entries };
}

export function assertLogContains(
  logs: TestLogEntry[],
  matcher: { level?: TestLogLevel; message?: string },
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
      `Expected logs to contain entry with level=${matcher.level ?? "*"} and message~=${
        matcher.message ?? "*"
      }`,
    );
  }
}

export function getTestLogSummary(
  logs: TestLogEntry[],
): Record<TestLogLevel, number> {
  return LOG_LEVELS.reduce(
    (acc, level) => {
      acc[level] = logs.filter((entry) => entry.level === level).length;
      return acc;
    },
    {} as Record<TestLogLevel, number>,
  );
}

// ============================================================================
// CI Flake Tracking & Playwright Failure Artifact Capture (bd-1r6vi, bd-3540m, bd-gpov5)
// ============================================================================

export type FlakeFailureCategory =
  | "timeout"
  | "navigation"
  | "selector"
  | "server_5xx"
  | "assertion"
  | "unknown";

export interface TestAttemptRecord {
  testName: string;
  attempt: number;
  passed: boolean;
  durationMs: number;
  errorMessage?: string;
  correlationId?: string;
}

export interface FlakeSummaryReport {
  generatedAt: string;
  totalTests: number;
  passedFirstTry: number;
  flakyRecoveredOnRetry: number;
  permanentlyFailed: number;
  flakeRatePercent: number;
  failureCategories: Record<FlakeFailureCategory, number>;
  flakyTestNames: string[];
}

export interface FailureDiagnosticBundle {
  testName: string;
  category: FlakeFailureCategory;
  errorMessage: string;
  correlationId: string | null;
  correlatedGatewayLogs: TestLogEntry[];
  artifacts: {
    tracePath: string | null;
    screenshotPath: string | null;
    videoPath: string | null;
  };
  capturedAt: string;
}

export function categorizeTestFailure(
  errorMessage: string,
): FlakeFailureCategory {
  const lower = errorMessage.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "timeout";
  }
  if (
    lower.includes("page.goto") ||
    lower.includes("net::err_") ||
    lower.includes("navigation")
  ) {
    return "navigation";
  }
  if (
    lower.includes("locator") ||
    lower.includes("selector") ||
    lower.includes("waiting for element")
  ) {
    return "selector";
  }
  if (
    lower.includes("500") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504") ||
    lower.includes("internal server error")
  ) {
    return "server_5xx";
  }
  if (lower.includes("expect(") || lower.includes("assertion")) {
    return "assertion";
  }
  return "unknown";
}

export function generateFlakeReport(
  attempts: TestAttemptRecord[],
): FlakeSummaryReport {
  const byTest = new Map<string, TestAttemptRecord[]>();
  const failureCategories: Record<FlakeFailureCategory, number> = {
    timeout: 0,
    navigation: 0,
    selector: 0,
    server_5xx: 0,
    assertion: 0,
    unknown: 0,
  };

  for (const rec of attempts) {
    const list = byTest.get(rec.testName) ?? [];
    list.push(rec);
    byTest.set(rec.testName, list);
    if (!rec.passed && rec.errorMessage) {
      const cat = categorizeTestFailure(rec.errorMessage);
      failureCategories[cat]++;
    }
  }

  let passedFirstTry = 0;
  let flakyRecoveredOnRetry = 0;
  let permanentlyFailed = 0;
  const flakyTestNames: string[] = [];

  for (const [testName, runs] of byTest.entries()) {
    const anyFailed = runs.some((r) => !r.passed);
    const anyPassed = runs.some((r) => r.passed);
    if (!anyFailed && anyPassed) {
      passedFirstTry++;
    } else if (anyFailed && anyPassed) {
      flakyRecoveredOnRetry++;
      flakyTestNames.push(testName);
    } else {
      permanentlyFailed++;
    }
  }

  const totalTests = byTest.size;
  const flakeRatePercent =
    totalTests > 0
      ? Number(((flakyRecoveredOnRetry / totalTests) * 100).toFixed(2))
      : 0;

  return {
    generatedAt: new Date().toISOString(),
    totalTests,
    passedFirstTry,
    flakyRecoveredOnRetry,
    permanentlyFailed,
    flakeRatePercent,
    failureCategories,
    flakyTestNames,
  };
}

export function captureFailureDiagnosticBundle(params: {
  testName: string;
  errorMessage: string;
  gatewayLogs: TestLogEntry[];
  correlationId?: string;
  tracePath?: string;
  screenshotPath?: string;
  videoPath?: string;
}): FailureDiagnosticBundle {
  const correlatedGatewayLogs = params.correlationId
    ? params.gatewayLogs.filter(
        (l) => l.meta?.["correlationId"] === params.correlationId,
      )
    : params.gatewayLogs;

  return {
    testName: params.testName,
    category: categorizeTestFailure(params.errorMessage),
    errorMessage: params.errorMessage,
    correlationId: params.correlationId ?? null,
    correlatedGatewayLogs,
    artifacts: {
      tracePath: params.tracePath ?? null,
      screenshotPath: params.screenshotPath ?? null,
      videoPath: params.videoPath ?? null,
    },
    capturedAt: new Date().toISOString(),
  };
}
