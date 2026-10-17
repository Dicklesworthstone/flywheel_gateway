/**
 * Logging Framework Demo Tests
 * Part of bd-1vr1.5: Playwright logging + diagnostics framework
 *
 * This file demonstrates the enhanced logging fixtures.
 * Run with: bun run test:e2e tests/e2e/logging-demo.spec.ts
 *
 * Check logs in: tests/e2e/logs/
 */

import { expect, logMarker, test } from "./lib/fixtures";

const isPlaywright = process.env["PLAYWRIGHT_TEST"] === "1";

if (isPlaywright) {
  test.describe("Logging Framework Demo", () => {
    test("captures console logs automatically", async ({ loggedPage }) => {
      await loggedPage.goto("/");

      // These will appear in the structured log output
      await loggedPage.evaluate(() => {
        console.log("Test log message");
        console.warn("Test warning message");
        console.info("Test info message");
      });

      // Add a marker for easier log navigation
      logMarker(loggedPage, "after console logs");

      await expect(loggedPage.locator("body")).toBeVisible();
    });

    test("captures network requests", async ({ loggedPage }) => {
      // Navigate and let it make API calls
      await loggedPage.goto("/");

      // Wait for any initial API calls
      await loggedPage.waitForTimeout(1000);

      // The structured reporter will capture all network requests
      // including timing, headers, and response status

      await expect(loggedPage.locator("body")).toBeVisible();
    });

    test("captures WebSocket messages on dashboard", async ({ loggedPage }) => {
      // Navigate to a page that uses WebSockets
      await loggedPage.goto("/");

      // Wait for WebSocket connection to establish
      await loggedPage.waitForTimeout(2000);

      // Any WebSocket messages will be captured via CDP
      // (Chromium-only feature)

      await expect(loggedPage.locator("body")).toBeVisible();
    });

    test("captures page errors", async ({ loggedPage }) => {
      await loggedPage.goto("/");

      // Intentionally trigger a page error for demo
      await loggedPage.evaluate(() => {
        // This will be captured as a page error
        setTimeout(() => {
          throw new Error("Intentional test error for logging demo");
        }, 100);
      });

      await loggedPage.waitForTimeout(200);
      await expect(loggedPage.locator("body")).toBeVisible();
    });

    test("captures performance metrics", async ({ loggedPage }) => {
      await loggedPage.goto("/");

      // Wait for page to fully load
      await loggedPage.waitForLoadState("networkidle");

      // Performance timing metrics will be captured:
      // - pageLoadTime
      // - firstContentfulPaint
      // - largestContentfulPaint
      // - cumulativeLayoutShift

      await expect(loggedPage.locator("body")).toBeVisible();
    });

    test("produces useful logs on failure", async ({ loggedPage }) => {
      await loggedPage.goto("/agents");

      // Add some context that will help debug if this fails
      await loggedPage.evaluate(() => {
        console.log("[Test Context] About to check for agents header");
      });

      // This assertion should pass
      await expect(
        loggedPage.locator("h3").filter({ hasText: "Agents" }),
      ).toBeVisible();

      // Add more context
      await loggedPage.evaluate(() => {
        console.log("[Test Context] Header found, checking table");
      });

      await expect(loggedPage.locator(".table")).toBeVisible();
    });
  });

  test.describe("Logging with Direct Page Access", () => {
    test("can still use regular page fixture", async ({ page }) => {
      // Regular page fixture still works
      // Just won't have automatic logging
      await page.goto("/");
      await expect(page.locator("body")).toBeVisible();
    });

    test("can access logger directly", async ({ loggedPage, testLogger }) => {
      await loggedPage.goto("/");

      // Access the logger directly for custom logging needs
      const summary = testLogger.getSummary();
      console.log(
        `[Manual Check] Network requests so far: ${summary.networkRequests}`,
      );

      await expect(loggedPage.locator("body")).toBeVisible();
    });
  });
}
