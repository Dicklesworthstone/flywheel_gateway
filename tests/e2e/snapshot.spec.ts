/**
 * E2E tests for Snapshot Summary panel on the Dashboard.
 *
 * Validates:
 * - Snapshot panel renders with mocked API data
 * - Degraded/partial data states are surfaced in the UI
 * - Network requests and console errors are logged for diagnostics
 */

import { expect, test, type Page } from "@playwright/test";
import type { SystemSnapshot } from "@flywheel/shared";

const isPlaywright = process.env["PLAYWRIGHT_TEST"] === "1";

function buildSnapshot(overrides: Partial<SystemSnapshot>): SystemSnapshot {
  const now = new Date().toISOString();

  const base: SystemSnapshot = {
    meta: {
      schemaVersion: "1.0.0",
      generatedAt: now,
      generationDurationMs: 25,
      gatewayVersion: "0.1.0",
    },
    summary: {
      status: "healthy",
      ntm: "healthy",
      agentMail: "healthy",
      beads: "healthy",
      tools: "healthy",
      healthyCount: 4,
      degradedCount: 0,
      unhealthyCount: 0,
      unknownCount: 0,
      issues: [],
    },
    ntm: {
      capturedAt: now,
      available: true,
      version: "0.3.0",
      sessions: [],
      summary: {
        totalSessions: 0,
        totalAgents: 0,
        attachedCount: 0,
        byAgentType: {
          claude: 0,
          codex: 0,
          gemini: 0,
          cursor: 0,
          windsurf: 0,
          aider: 0,
        },
      },
      alerts: [],
    },
    agentMail: {
      capturedAt: now,
      available: true,
      status: "healthy",
      agents: [],
      reservations: [],
      messages: {
        total: 0,
        unread: 0,
        byPriority: { low: 0, normal: 0, high: 0, urgent: 0 },
      },
    },
    beads: {
      capturedAt: now,
      brAvailable: true,
      bvAvailable: true,
      statusCounts: {
        open: 0,
        inProgress: 0,
        blocked: 0,
        closed: 0,
        total: 0,
      },
      typeCounts: {
        bug: 0,
        feature: 0,
        task: 0,
        epic: 0,
        chore: 0,
      },
      priorityCounts: {
        p0: 0,
        p1: 0,
        p2: 0,
        p3: 0,
        p4: 0,
      },
      actionableCount: 0,
      topRecommendations: [],
      quickWins: [],
      blockersToClean: [],
    },
    tools: {
      capturedAt: now,
      dcg: { installed: true, version: "1.0.0", healthy: true, latencyMs: 4 },
      slb: { installed: true, version: "1.0.0", healthy: true, latencyMs: 4 },
      ubs: { installed: true, version: "1.0.0", healthy: true, latencyMs: 4 },
      status: "healthy",
      registryGeneratedAt: now,
      registryAgeMs: 0,
      toolsWithChecksums: 0,
      checksumsStale: false,
      checksumStatuses: [],
      issues: [],
      recommendations: [],
    },
  };

  return {
    ...base,
    ...overrides,
    summary: { ...base.summary, ...(overrides.summary ?? {}) },
    ntm: { ...base.ntm, ...(overrides.ntm ?? {}) },
    agentMail: { ...base.agentMail, ...(overrides.agentMail ?? {}) },
    beads: { ...base.beads, ...(overrides.beads ?? {}) },
    tools: { ...base.tools, ...(overrides.tools ?? {}) },
  };
}

async function mockSnapshotResponse(page: Page, snapshot: SystemSnapshot) {
  await page.route("**/api/system/snapshot**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: snapshot }),
    });
  });
}

if (isPlaywright) {
  test.describe("Snapshot - Summary Panel", () => {
    test.beforeEach(async ({ page }) => {
      // Ensure mock mode does not override API response
      await page.addInitScript(() => {
        window.localStorage.setItem("fw-mock-mode", "false");
      });

      // Log snapshot requests for debugging
      page.on("request", (request) => {
        if (request.url().includes("/api/system/snapshot")) {
          console.log(`[REQ] ${request.method()} ${request.url()}`);
        }
      });
      page.on("response", (response) => {
        if (response.url().includes("/api/system/snapshot")) {
          console.log(`[RES] ${response.status()} ${response.url()}`);
        }
      });
    });

    test("should render snapshot summary panel", async ({ page }) => {
      const snapshot = buildSnapshot({});
      await mockSnapshotResponse(page, snapshot);

      await page.goto("/");

      const panel = page.getByTestId("snapshot-summary-panel");
      const headerCard = panel
        .locator(".card")
        .filter({ hasText: "System Status" });
      await expect(headerCard).toBeVisible();
      const headerStatus = headerCard.locator(".card__header");
      await expect(
        headerStatus.getByText("All Systems Healthy", { exact: true }),
      ).toBeVisible();

      await expect(
        panel.getByRole("heading", { name: "Safety Tools" }),
      ).toBeVisible();
      await expect(
        panel.getByRole("heading", { name: "Work Queue" }),
      ).toBeVisible();

      await test.info().attach("snapshot-dom", {
        body: await page.content(),
        contentType: "text/html",
      });
    });

    test("should surface degraded state when sources are missing", async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          consoleErrors.push(msg.text());
        }
      });

      const degradedSnapshot = buildSnapshot({
        summary: {
          status: "degraded",
          agentMail: "unhealthy",
          tools: "degraded",
          healthyCount: 2,
          degradedCount: 1,
          unhealthyCount: 1,
          issues: [
            "Agent Mail server is not running",
            "UBS (Ultimate Bug Scanner) is not installed",
          ],
        },
        agentMail: {
          available: false,
          status: "unhealthy",
        },
        tools: {
          status: "degraded",
          ubs: { installed: false, version: null, healthy: false, latencyMs: 6 },
          issues: ["UBS (Ultimate Bug Scanner) is not installed"],
          recommendations: ["Install UBS for static analysis scanning: cargo install ubs"],
        },
      });

      await mockSnapshotResponse(page, degradedSnapshot);
      await page.goto("/");

      const panel = page.getByTestId("snapshot-summary-panel");
      const headerCard = panel
        .locator(".card")
        .filter({ hasText: "System Status" });
      await expect(headerCard).toBeVisible();
      const headerStatus = headerCard.locator(".card__header");
      await expect(
        headerStatus.getByText("Degraded", { exact: true }),
      ).toBeVisible();

      await expect(
        panel.locator(".card").filter({ hasText: "Issue" }).first(),
      ).toBeVisible();
      await expect(
        panel.getByText("Agent Mail server is not running"),
      ).toBeVisible();
      await expect(
        panel.getByText("UBS (Ultimate Bug Scanner) is not installed"),
      ).toBeVisible();

      await expect(
        panel.locator(".card").filter({ hasText: "No active agents" }),
      ).toBeVisible();
      await page.waitForTimeout(500);

      const criticalErrors = consoleErrors.filter(
        (e) =>
          !e.includes("ResizeObserver") &&
          !e.includes("net::") &&
          !e.includes("favicon") &&
          !e.includes("WebSocket") &&
          !e.includes("ws://") &&
          !e.includes("websocket-context"),
      );
      expect(criticalErrors).toHaveLength(0);

      await test.info().attach("snapshot-degraded-dom", {
        body: await page.content(),
        contentType: "text/html",
      });
    });
  });
}
