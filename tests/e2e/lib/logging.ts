/**
 * E2E Logging Framework - Core Logging Utilities
 * Part of bd-1vr1.5: Playwright logging + diagnostics framework
 *
 * Captures browser console, network, WebSocket, page errors, and timing metrics.
 */

import type { CDPSession, Page } from "@playwright/test";
import type {
  ConsoleEntry,
  NetworkEntry,
  PageErrorEntry,
  TestLogBundle,
  TimingMetrics,
  WebSocketEntry,
} from "./types";

export class TestLogger {
  readonly testId: string;
  readonly testTitle: string;
  readonly testFile: string;

  private console: ConsoleEntry[] = [];
  private network: NetworkEntry[] = [];
  private webSocket: WebSocketEntry[] = [];
  private pageErrors: PageErrorEntry[] = [];
  private timing: TimingMetrics;
  private cdpSession: CDPSession | null = null;

  constructor(testId: string, testTitle: string, testFile: string) {
    this.testId = testId;
    this.testTitle = testTitle;
    this.testFile = testFile;
    this.timing = { testStartTime: Date.now() };
  }

  /**
   * Attach logging listeners to a page.
   * Call this after page is created but before navigation.
   */
  async attachToPage(page: Page): Promise<void> {
    // Console events
    page.on("console", (msg) => {
      this.console.push({
        timestamp: Date.now(),
        type: msg.type() as ConsoleEntry["type"],
        text: msg.text(),
        location: msg.location()
          ? {
              url: msg.location().url,
              lineNumber: msg.location().lineNumber,
              columnNumber: msg.location().columnNumber,
            }
          : undefined,
      });
    });

    // Page errors (uncaught exceptions)
    page.on("pageerror", (error) => {
      this.pageErrors.push({
        timestamp: Date.now(),
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
    });

    // Network request/response tracking
    page.on("request", (request) => {
      const entry: NetworkEntry = {
        timestamp: Date.now(),
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
        timing: {
          startTime: Date.now(),
        },
      };

      // Get headers if available
      try {
        entry.requestHeaders = request.headers();
      } catch {
        // Headers may not be available
      }

      this.network.push(entry);
    });

    page.on("response", (response) => {
      const url = response.url();
      const entry = this.network.find((n) => n.url === url && !n.status);
      if (entry) {
        entry.status = response.status();
        entry.statusText = response.statusText();
        if (entry.timing) {
          entry.timing.responseEnd = Date.now();
          entry.timing.duration =
            entry.timing.responseEnd - entry.timing.startTime;
        }
        try {
          entry.responseHeaders = response.headers();
        } catch {
          // Headers may not be available
        }
      }
    });

    page.on("requestfailed", (request) => {
      const url = request.url();
      const entry = this.network.find((n) => n.url === url && !n.failed);
      if (entry) {
        entry.failed = true;
        entry.failureReason = request.failure()?.errorText;
      }
    });

    // WebSocket tracking via CDP
    try {
      this.cdpSession = await page.context().newCDPSession(page);

      this.cdpSession.on("Network.webSocketCreated", (event) => {
        this.webSocket.push({
          timestamp: Date.now(),
          url: event.url,
          type: "open",
        });
      });

      this.cdpSession.on(
        "Network.webSocketClosed",
        (event: { requestId?: string }) => {
          this.webSocket.push({
            timestamp: Date.now(),
            url: event.requestId || "unknown",
            type: "close",
          });
        },
      );

      this.cdpSession.on("Network.webSocketFrameReceived", (event) => {
        this.webSocket.push({
          timestamp: Date.now(),
          url: event.requestId || "unknown",
          type: "message",
          direction: "receive",
          payload: event.response?.payloadData?.slice(0, 1000), // Limit payload size
          opcode: event.response?.opcode,
        });
      });

      this.cdpSession.on("Network.webSocketFrameSent", (event) => {
        this.webSocket.push({
          timestamp: Date.now(),
          url: event.requestId || "unknown",
          type: "message",
          direction: "send",
          payload: event.response?.payloadData?.slice(0, 1000),
          opcode: event.response?.opcode,
        });
      });

      this.cdpSession.on("Network.webSocketFrameError", (event) => {
        this.webSocket.push({
          timestamp: Date.now(),
          url: event.requestId || "unknown",
          type: "error",
          payload: event.errorMessage,
        });
      });

      await this.cdpSession.send("Network.enable");
    } catch {
      // CDP not available (Firefox, WebKit)
      // WebSocket logging will be limited
    }
  }

  /**
   * Capture performance timing metrics from the page.
   */
  async captureTimingMetrics(page: Page): Promise<void> {
    try {
      const metrics = await page.evaluate(() => {
        const perf = window.performance;
        const timing = perf.timing;
        const entries = perf.getEntriesByType("paint");
        const lcpEntries = perf.getEntriesByType(
          "largest-contentful-paint",
        ) as PerformanceEntry[];
        const layoutShift = perf.getEntriesByType(
          "layout-shift",
        ) as PerformanceEntry[];

        return {
          pageLoadTime: timing.loadEventEnd - timing.navigationStart,
          firstContentfulPaint:
            entries.find((e) => e.name === "first-contentful-paint")
              ?.startTime ?? 0,
          largestContentfulPaint:
            lcpEntries.length > 0
              ? ((lcpEntries[lcpEntries.length - 1] as { startTime?: number })
                  .startTime ?? 0)
              : 0,
          cumulativeLayoutShift: layoutShift.reduce(
            (sum, e) => sum + ((e as { value?: number }).value ?? 0),
            0,
          ),
        };
      });

      this.timing = {
        ...this.timing,
        ...metrics,
      };
    } catch {
      // Page may be closed or navigation in progress
    }
  }

  /**
   * Mark end of test and capture final metrics.
   */
  finalize(page?: Page): void {
    this.timing.testEndTime = Date.now();

    if (page) {
      // Fire and forget - don't await
      this.captureTimingMetrics(page).catch(() => {});
    }

    // Clean up CDP session
    if (this.cdpSession) {
      this.cdpSession.detach().catch(() => {});
      this.cdpSession = null;
    }
  }

  /**
   * Get log data for the test.
   */
  getLogData(): Pick<
    TestLogBundle,
    "console" | "network" | "webSocket" | "pageErrors" | "timing"
  > {
    return {
      console: this.console,
      network: this.network,
      webSocket: this.webSocket,
      pageErrors: this.pageErrors,
      timing: this.timing,
    };
  }

  /**
   * Get summary statistics.
   */
  getSummary(): {
    consoleErrors: number;
    networkRequests: number;
    failedRequests: number;
    webSocketMessages: number;
    pageErrors: number;
  } {
    return {
      consoleErrors: this.console.filter((c) => c.type === "error").length,
      networkRequests: this.network.length,
      failedRequests: this.network.filter((n) => n.failed).length,
      webSocketMessages: this.webSocket.filter((w) => w.type === "message")
        .length,
      pageErrors: this.pageErrors.length,
    };
  }
}

/**
 * Create a logger for a test.
 */
export function createTestLogger(testInfo: {
  testId: string;
  title: string;
  file: string;
}): TestLogger {
  return new TestLogger(testInfo.testId, testInfo.title, testInfo.file);
}
