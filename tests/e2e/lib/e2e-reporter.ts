/**
 * E2E Custom Reporter - Structured Test Run Logs
 * Part of bd-1vr1.5: Playwright logging + diagnostics framework
 *
 * Generates deterministic, structured JSON log bundles per test
 * for debugging and analysis.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from "@playwright/test/reporter";
import type { RunSummary, TestError, TestLogBundle } from "./types";

interface E2EReporterOptions {
  /** Output directory for log bundles (default: tests/e2e/logs) */
  outputDir?: string;
  /** Include full network request/response bodies (default: false) */
  includeNetworkBodies?: boolean;
  /** Maximum payload size in bytes to capture (default: 10000) */
  maxPayloadSize?: number;
  /** Include console output in summary (default: true) */
  includeConsole?: boolean;
}

// Global storage for test log data (populated by test fixtures)
const testLogData = new Map<
  string,
  {
    console: unknown[];
    network: unknown[];
    webSocket: unknown[];
    pageErrors: unknown[];
    timing: unknown;
  }
>();

/**
 * Register log data for a test (called from test fixtures).
 */
export function registerTestLogData(
  testId: string,
  data: {
    console: unknown[];
    network: unknown[];
    webSocket: unknown[];
    pageErrors: unknown[];
    timing: unknown;
  },
): void {
  testLogData.set(testId, data);
}

/**
 * Custom Playwright reporter that generates structured JSON log bundles.
 */
export default class E2EReporter implements Reporter {
  private config: FullConfig | null = null;
  private suite: Suite | null = null;
  private outputDir: string;
  private options: E2EReporterOptions;
  private runId: string;
  private startTime: number = 0;
  private testResults: TestLogBundle[] = [];

  constructor(options: E2EReporterOptions = {}) {
    this.options = {
      outputDir: "tests/e2e/logs",
      includeNetworkBodies: false,
      maxPayloadSize: 10000,
      includeConsole: true,
      ...options,
    };
    this.outputDir = this.options.outputDir!;
    this.runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
    this.startTime = Date.now();

    // Ensure output directory exists
    mkdirSync(this.outputDir, { recursive: true });

    // Create run-specific directory
    const runDir = join(this.outputDir, this.runId);
    mkdirSync(runDir, { recursive: true });

    console.log(`\n📊 E2E Reporter: Logging to ${runDir}\n`);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const testId = this.getTestId(test);
    const logData = testLogData.get(testId);

    // Collect test steps
    const steps = this.collectSteps(result.steps);

    // Build test log bundle
    const bundle: TestLogBundle = {
      testId,
      testTitle: test.title,
      testFile: relative(process.cwd(), test.location.file),
      suiteName: test.parent?.title,
      status: this.mapStatus(result.status),
      duration: result.duration,
      startTime: result.startTime.getTime(),
      endTime: result.startTime.getTime() + result.duration,
      retryCount: result.retry,
      browser: test.parent?.project()?.name ?? "unknown",
      viewport: test.parent?.project()?.use?.viewport as
        | { width: number; height: number }
        | undefined,
      baseURL: test.parent?.project()?.use?.baseURL as string | undefined,

      console: (logData?.console ?? []) as TestLogBundle["console"],
      network: (logData?.network ?? []) as TestLogBundle["network"],
      webSocket: (logData?.webSocket ?? []) as TestLogBundle["webSocket"],
      pageErrors: (logData?.pageErrors ?? []) as TestLogBundle["pageErrors"],
      timing: (logData?.timing ?? {
        testStartTime: result.startTime.getTime(),
      }) as TestLogBundle["timing"],

      artifacts: this.collectArtifacts(result),
      annotations: test.annotations,
      steps,
      error: result.error ? this.formatError(result.error) : undefined,
    };

    this.testResults.push(bundle);

    // Write individual test log
    const testLogPath = join(
      this.outputDir,
      this.runId,
      `${this.sanitizeFilename(test.title)}-${testId.slice(-6)}.json`,
    );

    try {
      writeFileSync(testLogPath, JSON.stringify(bundle, null, 2));
    } catch {
      console.error(`Failed to write test log: ${testLogPath}`);
    }

    // Log summary to console
    this.logTestSummary(test, result, bundle);

    // Clean up stored data
    testLogData.delete(testId);
  }

  onEnd(_result: FullResult): void {
    const endTime = Date.now();
    const duration = endTime - this.startTime;

    // Calculate stats
    const stats = this.testResults.reduce(
      (acc, t) => {
        acc.total++;
        acc[t.status]++;
        return acc;
      },
      { total: 0, passed: 0, failed: 0, skipped: 0, timedOut: 0 },
    );

    // Build run summary
    const summary: RunSummary = {
      runId: this.runId,
      startTime: this.startTime,
      endTime,
      duration,
      totalTests: stats.total,
      passed: stats.passed,
      failed: stats.failed,
      skipped: stats.skipped,
      timedOut: stats.timedOut,
      flaky: this.testResults.filter(
        (t) => t.retryCount > 0 && t.status === "passed",
      ).length,
      projects: [...new Set(this.testResults.map((t) => t.browser))],
      workers: this.config?.workers ?? 1,
      tests: this.testResults,
    };

    // Write run summary
    const summaryPath = join(this.outputDir, this.runId, "summary.json");
    try {
      writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
      console.log(`\n📊 Run summary written to: ${summaryPath}`);
    } catch {
      console.error(`Failed to write summary: ${summaryPath}`);
    }

    // Create latest symlink (for easy access)
    const latestPath = join(this.outputDir, "latest.json");
    try {
      writeFileSync(
        latestPath,
        JSON.stringify({ runId: this.runId, path: summaryPath }),
      );
    } catch {
      // Ignore symlink errors
    }

    // Print summary
    this.printRunSummary(summary);
  }

  private getTestId(test: TestCase): string {
    return `test-${test.id}`;
  }

  private mapStatus(status: TestResult["status"]): TestLogBundle["status"] {
    switch (status) {
      case "passed":
        return "passed";
      case "failed":
        return "failed";
      case "skipped":
        return "skipped";
      case "timedOut":
        return "timedOut";
      default:
        return "failed";
    }
  }

  private collectSteps(steps: TestStep[]): TestLogBundle["steps"] {
    return steps.map((step) => ({
      title: step.title,
      startTime: step.startTime.getTime(),
      duration: step.duration,
      status: step.error ? "failed" : "passed",
      error: step.error?.message,
    }));
  }

  private collectArtifacts(result: TestResult): TestLogBundle["artifacts"] {
    const artifacts: TestLogBundle["artifacts"] = {};

    for (const attachment of result.attachments) {
      if (attachment.name === "trace" && attachment.path) {
        artifacts.trace = attachment.path;
      } else if (attachment.name === "video" && attachment.path) {
        artifacts.video = attachment.path;
      } else if (attachment.name === "screenshot" && attachment.path) {
        artifacts.screenshots = artifacts.screenshots ?? [];
        artifacts.screenshots.push(attachment.path);
      }
    }

    return artifacts;
  }

  private formatError(error: { message?: string; stack?: string }): TestError {
    return {
      message: error.message ?? "Unknown error",
      stack: error.stack,
    };
  }

  private sanitizeFilename(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
  }

  private logTestSummary(
    test: TestCase,
    result: TestResult,
    bundle: TestLogBundle,
  ): void {
    const statusIcon =
      result.status === "passed"
        ? "✅"
        : result.status === "failed"
          ? "❌"
          : result.status === "skipped"
            ? "⏭️"
            : "⏱️";

    const summary = [
      `${statusIcon} ${test.title}`,
      `   Duration: ${result.duration}ms`,
      `   Console: ${bundle.console.length} entries (${bundle.console.filter((c) => c.type === "error").length} errors)`,
      `   Network: ${bundle.network.length} requests (${bundle.network.filter((n) => n.failed).length} failed)`,
      `   WebSocket: ${bundle.webSocket.length} messages`,
    ];

    if (bundle.pageErrors.length > 0) {
      summary.push(`   Page Errors: ${bundle.pageErrors.length}`);
    }

    if (result.error) {
      summary.push(
        `   Error: ${(result.error.message ?? "Unknown error").slice(0, 100)}`,
      );
    }

    console.log(summary.join("\n"));
  }

  private printRunSummary(summary: RunSummary): void {
    const lines = [
      `\n${"=".repeat(60)}`,
      "📊 E2E TEST RUN SUMMARY",
      "=".repeat(60),
      `Run ID: ${summary.runId}`,
      `Duration: ${(summary.duration / 1000).toFixed(2)}s`,
      `Projects: ${summary.projects.join(", ")}`,
      "",
      `Total: ${summary.totalTests}`,
      `  ✅ Passed: ${summary.passed}`,
      `  ❌ Failed: ${summary.failed}`,
      `  ⏭️  Skipped: ${summary.skipped}`,
      `  ⏱️  Timed Out: ${summary.timedOut}`,
      `  🔄 Flaky: ${summary.flaky}`,
    ];

    if (summary.failed > 0) {
      lines.push("");
      lines.push("Failed tests:");
      for (const test of summary.tests.filter((t) => t.status === "failed")) {
        lines.push(`  - ${test.testTitle}`);
        if (test.error?.message) {
          lines.push(`    ${test.error.message.slice(0, 80)}`);
        }
      }
    }

    lines.push("=".repeat(60));
    console.log(lines.join("\n"));
  }
}
