/**
 * E2E Logging Framework - Playwright Fixtures
 * Part of bd-1vr1.5: Playwright logging + diagnostics framework
 *
 * Provides extended test fixtures with automatic logging capture.
 */

import { test as base, type Page, type TestInfo } from "@playwright/test";
import { TestLogger } from "./logging";

/**
 * Extended test fixtures with logging support.
 */
export interface LoggingFixtures {
  /**
   * Page with automatic logging attached.
   * Console, network, WebSocket, and page errors are captured automatically.
   */
  loggedPage: Page;

  /**
   * Direct access to the test logger for manual logging operations.
   */
  testLogger: TestLogger;
}

/**
 * Extended test with logging fixtures.
 *
 * Usage:
 * ```ts
 * import { test, expect } from "./lib/fixtures";
 *
 * test("my test", async ({ loggedPage }) => {
 *   await loggedPage.goto("/");
 *   // All console, network, WebSocket events are automatically captured
 * });
 * ```
 */
export const test = base.extend<LoggingFixtures>({
  testLogger: async (_fixtures, use, testInfo) => {
    const logger = new TestLogger(
      testInfo.testId,
      testInfo.title,
      testInfo.file,
    );
    await use(logger);
  },

  loggedPage: async ({ page, testLogger }, use, testInfo) => {
    // Attach logging to the page
    await testLogger.attachToPage(page);

    // Use the page
    await use(page);

    // Finalize logging and capture metrics
    testLogger.finalize(page);

    // Attach log data to test info for reporter
    const logData = testLogger.getLogData();
    await testInfo.attach("__e2e_logging_data__", {
      contentType: "application/json",
      body: Buffer.from(JSON.stringify(logData)),
    });

    // Log summary if verbose mode or test failed
    const summary = testLogger.getSummary();
    if (testInfo.status === "failed" || process.env["E2E_VERBOSE"] === "1") {
      console.log(`\n[E2E Log Summary] ${testInfo.title}`);
      console.log(`  Console errors: ${summary.consoleErrors}`);
      console.log(
        `  Network requests: ${summary.networkRequests} (${summary.failedRequests} failed)`,
      );
      console.log(`  WebSocket messages: ${summary.webSocketMessages}`);
      console.log(`  Page errors: ${summary.pageErrors}`);
    }
  },
});

/**
 * Re-export expect for convenience.
 */
export { expect } from "@playwright/test";

/**
 * Helper to create a unique test file name prefix.
 */
export function getTestPrefix(testInfo: TestInfo): string {
  const file =
    testInfo.file.split("/").pop()?.replace(".spec.ts", "") ?? "test";
  const title = testInfo.title.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 30);
  return `${file}--${title}`;
}

/**
 * Helper to add a marker in the logs (useful for debugging).
 */
export function logMarker(page: Page, message: string): void {
  // This will show up in console logs
  page.evaluate((msg) => console.log(`[E2E MARKER] ${msg}`), message);
}
