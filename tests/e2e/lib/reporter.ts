/**
 * E2E Logging Framework - Custom Playwright Reporter
 * Part of bd-1vr1.5: Playwright logging + diagnostics framework
 *
 * Emits structured JSON logs per test and aggregates run summaries.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import type { RunSummary, TestError, TestLogBundle, TestStep } from "./types";

interface ReporterOptions {
  outputDir?: string;
  includeConsole?: boolean;
  includeNetwork?: boolean;
  includeWebSocket?: boolean;
  verbose?: boolean;
}

export default class StructuredReporter implements Reporter {
  private options: Required<ReporterOptions>;
  private runId: string;
  private startTime: number = 0;
  private tests: TestLogBundle[] = [];
  private config: FullConfig | null = null;

  constructor(options: ReporterOptions = {}) {
    this.options = {
      outputDir: options.outputDir ?? "tests/e2e/logs",
      includeConsole: options.includeConsole ?? true,
      includeNetwork: options.includeNetwork ?? true,
      includeWebSocket: options.includeWebSocket ?? true,
      verbose: options.verbose ?? false,
    };
    this.runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  onBegin(config: FullConfig, _suite: Suite): void {
    this.config = config;
    this.startTime = Date.now();
    this.tests = [];

    // Ensure output directory exists
    const outputDir = this.options.outputDir;
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    if (this.options.verbose) {
      console.log(`\n[E2E Reporter] Run started: ${this.runId}`);
      console.log(`[E2E Reporter] Output dir: ${outputDir}`);
    }
  }

  onTestBegin(test: TestCase, _result: TestResult): void {
    if (this.options.verbose) {
      console.log(`[E2E Reporter] Test started: ${test.title}`);
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const logBundle = this.buildLogBundle(test, result);
    this.tests.push(logBundle);

    // Write individual test log
    this.writeTestLog(logBundle);

    if (this.options.verbose) {
      const statusIcon =
        result.status === "passed"
          ? "\u2713"
          : result.status === "failed"
            ? "\u2717"
            : "\u25CB";
      console.log(
        `[E2E Reporter] ${statusIcon} ${test.title} (${result.duration}ms)`,
      );
    }
  }

  onEnd(result: FullResult): void {
    const summary = this.buildRunSummary(result);
    this.writeRunSummary(summary);

    if (this.options.verbose) {
      console.log(`\n[E2E Reporter] Run completed: ${this.runId}`);
      console.log(
        `[E2E Reporter] Results: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped`,
      );
      console.log(`[E2E Reporter] Logs written to: ${this.options.outputDir}`);
    }
  }

  private buildLogBundle(test: TestCase, result: TestResult): TestLogBundle {
    // Get logging data from test attachments (if fixture attached it)
    const loggingAttachment = result.attachments.find(
      (a) => a.name === "__e2e_logging_data__",
    );
    let loggingData: Partial<TestLogBundle> = {};

    if (loggingAttachment?.body) {
      try {
        loggingData = JSON.parse(loggingAttachment.body.toString());
      } catch {
        // Ignore parse errors
      }
    }

    // Build steps from result
    const steps: TestStep[] = result.steps.map((step) => ({
      title: step.title,
      startTime: step.startTime.getTime(),
      duration: step.duration,
      status: step.error ? "failed" : "passed",
      error: step.error?.message,
    }));

    // Build error info
    let error: TestError | undefined;
    if (result.error) {
      error = {
        message: result.error.message ?? "Unknown error",
        stack: result.error.stack,
        snippet: result.error.snippet,
        location: result.error.location
          ? {
              file: result.error.location.file,
              line: result.error.location.line,
              column: result.error.location.column,
            }
          : undefined,
      };
    }

    // Get artifact paths
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

    // Get browser/project info
    const project = test.parent?.project();
    const browser = project?.name ?? "unknown";
    const viewport = project?.use?.viewport;
    const baseURL =
      (project?.use?.baseURL as string | undefined) ??
      this.config?.projects[0]?.use?.baseURL;

    return {
      testId: test.id,
      testTitle: test.title,
      testFile: test.location.file,
      suiteName: test.parent?.title,
      status: result.status === "interrupted" ? "failed" : result.status,
      duration: result.duration,
      startTime: result.startTime.getTime(),
      endTime: result.startTime.getTime() + result.duration,
      retryCount: result.retry,
      browser,
      viewport: viewport
        ? { width: viewport.width, height: viewport.height }
        : undefined,
      baseURL: baseURL as string | undefined,

      // Include logging data from fixture
      console: this.options.includeConsole ? (loggingData.console ?? []) : [],
      network: this.options.includeNetwork ? (loggingData.network ?? []) : [],
      webSocket: this.options.includeWebSocket
        ? (loggingData.webSocket ?? [])
        : [],
      pageErrors: loggingData.pageErrors ?? [],
      timing: loggingData.timing ?? {
        testStartTime: result.startTime.getTime(),
        testEndTime: result.startTime.getTime() + result.duration,
      },

      artifacts: Object.keys(artifacts).length > 0 ? artifacts : undefined,
      annotations: test.annotations,
      steps,
      error,
    };
  }

  private buildRunSummary(_result: FullResult): RunSummary {
    const endTime = Date.now();
    const projects = [...new Set(this.tests.map((t) => t.browser))];

    return {
      runId: this.runId,
      startTime: this.startTime,
      endTime,
      duration: endTime - this.startTime,
      totalTests: this.tests.length,
      passed: this.tests.filter((t) => t.status === "passed").length,
      failed: this.tests.filter((t) => t.status === "failed").length,
      skipped: this.tests.filter((t) => t.status === "skipped").length,
      timedOut: this.tests.filter((t) => t.status === "timedOut").length,
      flaky: this.tests.filter((t) => t.retryCount > 0 && t.status === "passed")
        .length,
      projects,
      workers: this.config?.workers ?? 1,
      tests: this.tests,
    };
  }

  private writeTestLog(bundle: TestLogBundle): void {
    const outputDir = this.options.outputDir;
    const runDir = join(outputDir, this.runId);

    if (!existsSync(runDir)) {
      mkdirSync(runDir, { recursive: true });
    }

    // Create deterministic filename from test
    const testFile = basename(bundle.testFile, ".ts");
    const safeTitlePart = bundle.testTitle
      .replace(/[^a-zA-Z0-9]/g, "-")
      .slice(0, 50);
    const filename = `${testFile}--${safeTitlePart}--${bundle.browser}.json`;

    writeFileSync(
      join(runDir, filename),
      JSON.stringify(bundle, null, 2),
      "utf-8",
    );
  }

  private writeRunSummary(summary: RunSummary): void {
    const outputDir = this.options.outputDir;

    // Write full summary to run directory
    const runDir = join(outputDir, this.runId);
    writeFileSync(
      join(runDir, "summary.json"),
      JSON.stringify(summary, null, 2),
      "utf-8",
    );

    // Write compact summary to root (for quick access)
    const compactSummary = {
      runId: summary.runId,
      startTime: summary.startTime,
      endTime: summary.endTime,
      duration: summary.duration,
      totalTests: summary.totalTests,
      passed: summary.passed,
      failed: summary.failed,
      skipped: summary.skipped,
      timedOut: summary.timedOut,
      flaky: summary.flaky,
      projects: summary.projects,
      failedTests: summary.tests
        .filter((t) => t.status === "failed")
        .map((t) => ({
          title: t.testTitle,
          file: t.testFile,
          error: t.error?.message,
        })),
    };

    writeFileSync(
      join(outputDir, "latest-run.json"),
      JSON.stringify(compactSummary, null, 2),
      "utf-8",
    );
  }
}
