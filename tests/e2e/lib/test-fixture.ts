/**
 * E2E Test Fixture - Extended Test with Auto-Logging
 * Part of bd-1vr1.5: Playwright logging + diagnostics framework
 *
 * Extends base Playwright test with automatic logging capabilities.
 * Use this instead of importing directly from @playwright/test.
 */

import { test as base, expect } from "@playwright/test";
import { registerTestLogData } from "./e2e-reporter";
import { createTestLogger, type TestLogger } from "./logging";

// Declare the extended fixtures
type TestFixtures = {
  /** Test logger instance for the current test */
  testLogger: TestLogger;
  /** Helper to log custom events */
  logEvent: (message: string, level?: "info" | "warn" | "error") => void;
  /** Helper to add custom metadata */
  addMetadata: (key: string, value: unknown) => void;
};

/**
 * Extended test with automatic logging.
 *
 * Usage:
 * ```ts
 * import { test, expect } from './lib/test-fixture';
 *
 * test('my test', async ({ page, testLogger }) => {
 *   await page.goto('/');
 *   // Logging is automatic!
 * });
 * ```
 */
export const test = base.extend<TestFixtures>({
  // Test logger fixture - auto-attaches to page
  testLogger: async ({ page }, use, testInfo) => {
    const testId = `test-${testInfo.testId}`;
    const logger = createTestLogger({
      testId,
      title: testInfo.title,
      file: testInfo.file,
    });

    // Attach logging listeners before test runs
    await logger.attachToPage(page);

    // Run the test
    await use(logger);

    // Capture final timing metrics after test
    await logger.captureTimingMetrics(page);
    logger.finalize(page);

    // Register log data with reporter
    registerTestLogData(testId, logger.getLogData());
  },

  // Helper to log custom events
  logEvent: async ({ testLogger: _testLogger }, use) => {
    const logFn = (message: string, level: "info" | "warn" | "error" = "info") => {
      // Add to internal console array via page evaluation won't work here
      // So we store custom events separately
      console.log(`[Test Event - ${level.toUpperCase()}] ${message}`);
    };
    await use(logFn);
  },

  // Helper to add custom metadata
  addMetadata: async (_fixtures, use, testInfo) => {
    const metadataFn = (key: string, value: unknown) => {
      testInfo.annotations.push({
        type: "metadata",
        description: JSON.stringify({ [key]: value }),
      });
    };
    await use(metadataFn);
  },
});

// Re-export types
export type { TestLogger } from "./logging";
export type {
  ConsoleEntry,
  NetworkEntry,
  PageErrorEntry,
  RunSummary,
  TestLogBundle,
  TimingMetrics,
  WebSocketEntry,
} from "./types";
// Re-export expect for convenience
export { expect };

/**
 * Test with auto-screenshot on failure (enhanced).
 *
 * Use this for tests where you want explicit screenshot checkpoints.
 */
export const testWithScreenshots = test.extend({
  // Auto-capture screenshot at checkpoints
  page: async ({ page }, use, testInfo) => {
    let screenshotIndex = 0;

    // Add checkpoint method to page
    const originalGoto = page.goto.bind(page);
    page.goto = async (url, options) => {
      const result = await originalGoto(url, options);
      // Auto-screenshot after navigation
      if (testInfo.config.preserveOutput === "always") {
        await page.screenshot({
          path: testInfo.outputPath(`checkpoint-${++screenshotIndex}-navigation.png`),
        });
      }
      return result;
    };

    await use(page);
  },
});

/**
 * Helper to create a test group with consistent logging.
 */
export function describeWithLogging(name: string, fn: () => void): void {
  test.describe(name, () => {
    test.beforeEach(async ({ testLogger: _testLogger }) => {
      // Logger is automatically attached via fixture
      console.log(`📝 Starting test in group: ${name}`);
    });

    test.afterEach(async ({ testLogger }) => {
      const summary = testLogger.getSummary();
      if (summary.consoleErrors > 0 || summary.pageErrors > 0) {
        console.log(
          `⚠️ Test had ${summary.consoleErrors} console errors and ${summary.pageErrors} page errors`,
        );
      }
    });

    fn();
  });
}

/**
 * Helper to wait for network idle with logging.
 */
export async function waitForNetworkIdleWithLogging(
  page: {
    waitForLoadState: (state: string, options?: { timeout?: number }) => Promise<void>;
    waitForTimeout: (ms: number) => Promise<void>;
  },
  options?: { timeout?: number; idleTime?: number },
): Promise<void> {
  const timeout = options?.timeout ?? 30000;
  const idleTime = options?.idleTime ?? 500;

  await page.waitForLoadState("networkidle", { timeout });

  // Additional wait for any pending requests
  await page.waitForTimeout(idleTime);
}
