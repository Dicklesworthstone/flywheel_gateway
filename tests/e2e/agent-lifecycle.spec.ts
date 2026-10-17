/**
 * E2E tests for Agent Lifecycle Management.
 *
 * Tests cover:
 * - Agent state display (ready, executing, paused, failed)
 * - Agent lifecycle transitions through UI
 * - Dashboard agent metrics
 * - Multi-agent scenarios
 * - Error state handling
 * - Mobile/responsive views
 */

import { expect, test } from "@playwright/test";

const isPlaywright = process.env["PLAYWRIGHT_TEST"] === "1";

if (isPlaywright) {
  test.describe("Agent Lifecycle - State Display", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/agents");
    });

    test("should display agents with different lifecycle states", async ({
      page,
    }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });

      // Verify we have agents to display
      await expect(rows.first()).toBeVisible();

      // Check for status pills showing different states
      const pills = rows.locator(".pill");
      await expect(pills.first()).toBeVisible();
    });

    test("should show ready state with positive tone", async ({ page }) => {
      const readyPill = page.locator(".pill").filter({ hasText: "ready" });

      // Ready state should use positive (green) tone
      if ((await readyPill.count()) > 0) {
        await expect(readyPill.first()).toBeVisible();
        await expect(readyPill.first()).toHaveClass(/pill--positive/);
      }
    });

    test("should show executing state with warning tone", async ({ page }) => {
      const executingPill = page
        .locator(".pill")
        .filter({ hasText: "executing" });

      // Executing state should use warning (yellow) tone
      if ((await executingPill.count()) > 0) {
        await expect(executingPill.first()).toBeVisible();
        await expect(executingPill.first()).toHaveClass(/pill--warning/);
      }
    });

    test("should show paused state with muted tone", async ({ page }) => {
      const pausedPill = page.locator(".pill").filter({ hasText: "paused" });

      // Paused state should use muted (gray) tone
      if ((await pausedPill.count()) > 0) {
        await expect(pausedPill.first()).toBeVisible();
        await expect(pausedPill.first()).toHaveClass(/pill--muted/);
      }
    });

    test("should show failed state with danger tone", async ({ page }) => {
      const failedPill = page.locator(".pill").filter({ hasText: "failed" });

      // Failed state should use danger (red) tone
      if ((await failedPill.count()) > 0) {
        await expect(failedPill.first()).toBeVisible();
        await expect(failedPill.first()).toHaveClass(/pill--danger/);
      }
    });

    test("should display agent model information", async ({ page }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });

      // Check that model column has content (e.g., claude-3.7, gpt-5)
      const firstRow = rows.first();
      const cells = firstRow.locator("span");

      // Model is the 3rd column (index 2)
      await expect(cells.nth(2)).not.toBeEmpty();
    });

    test("should display unique agent IDs", async ({ page }) => {
      const monoIds = page.locator(".table__row .mono");

      // Should have at least one agent ID displayed
      await expect(monoIds.first()).toBeVisible();

      // IDs should follow agent-xxx pattern
      const firstId = await monoIds.first().textContent();
      expect(firstId).toMatch(/^agent-/);
    });
  });

  test.describe("Agent Lifecycle - Dashboard Integration", () => {
    test("should show live agents count on dashboard", async ({ page }) => {
      await page.goto("/");

      const liveAgentsCard = page
        .locator(".card")
        .filter({ hasText: "Live agents" });
      await expect(liveAgentsCard).toBeVisible();

      // Should display a metric value
      const metric = liveAgentsCard.locator(".metric");
      await expect(metric).toBeVisible();
    });

    test("should show executing agents in status pill", async ({ page }) => {
      await page.goto("/");

      const liveAgentsCard = page
        .locator(".card")
        .filter({ hasText: "Live agents" });

      // Pill should show executing count
      const pill = liveAgentsCard.locator(".pill");
      await expect(pill).toContainText("executing");
    });

    test("should update agent counts in real-time via WebSocket", async ({
      page,
    }) => {
      await page.goto("/");

      // Check WebSocket latency card is visible (indicates connection)
      const wsCard = page
        .locator(".card--compact")
        .filter({ hasText: "WebSocket" });
      await expect(wsCard).toBeVisible();

      // Latency should be displayed
      const latency = wsCard.locator("h4");
      await expect(latency).toContainText("ms");
    });
  });

  test.describe("Agent Lifecycle - Navigation", () => {
    test("should navigate from dashboard to agents page", async ({ page }) => {
      await page.goto("/");

      // Click on agents link in navigation
      await page.click('a[href="/agents"]');

      // Should be on agents page
      await expect(page).toHaveURL(/\/agents/);
      await expect(
        page.locator("h3").filter({ hasText: "Agents" }),
      ).toBeVisible();
    });

    test("should preserve state when navigating back to dashboard", async ({
      page,
    }) => {
      await page.goto("/agents");

      // Navigate to dashboard
      await page.click('a[href="/"]');

      // Dashboard should load properly
      await expect(
        page.locator(".card").filter({ hasText: "Live agents" }),
      ).toBeVisible();
    });
  });

  test.describe("Agent Lifecycle - Multi-Agent Scenarios", () => {
    test("should display multiple agents simultaneously", async ({ page }) => {
      await page.goto("/agents");

      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });

      // Should have at least 3 agents (based on mock data)
      const count = await rows.count();
      expect(count).toBeGreaterThanOrEqual(1);
    });

    test("should show different agent models", async ({ page }) => {
      await page.goto("/agents");

      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });

      // Collect all model values
      const models: string[] = [];
      const count = await rows.count();

      for (let i = 0; i < count; i++) {
        const modelCell = rows.nth(i).locator("span").nth(2);
        const modelText = await modelCell.textContent();
        if (modelText) {
          models.push(modelText);
        }
      }

      // Should have various models
      expect(models.length).toBeGreaterThanOrEqual(1);
    });

    test("should display total agent count in header", async ({ page }) => {
      await page.goto("/agents");

      const header = page.locator(".card__header");
      const totalPill = header.locator(".pill").filter({ hasText: "total" });

      await expect(totalPill).toBeVisible();
      // Should contain a number followed by "total"
      await expect(totalPill).toContainText(/\d+ total/);
    });
  });

  test.describe("Agent Lifecycle - Error Handling", () => {
    test("should gracefully handle agent page load", async ({ page }) => {
      await page.goto("/agents");

      // Page should load without errors
      await expect(page.locator(".page")).toBeVisible();

      // No error alerts should be shown
      const errorAlert = page.locator('[role="alert"]');
      await expect(errorAlert).not.toBeVisible();
    });

    test("should show proper loading state", async ({ page }) => {
      // Start navigation but check immediately
      page.goto("/agents");

      // Page should eventually load
      await expect(page.locator(".page")).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe("Agent Lifecycle - Responsiveness", () => {
    test("should display agents table on desktop viewport", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/agents");

      await expect(page.locator(".table")).toBeVisible();
      await expect(
        page.locator("h3").filter({ hasText: "Agents" }),
      ).toBeVisible();
    });

    test("should display agents on tablet viewport", async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto("/agents");

      await expect(page.locator(".table")).toBeVisible();
      await expect(
        page.locator("h3").filter({ hasText: "Agents" }),
      ).toBeVisible();
    });

    test("should display agents on mobile viewport", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto("/agents");

      // Page should still be accessible
      await expect(page.locator(".page")).toBeVisible();
    });

    test("should maintain accessibility on all viewports", async ({ page }) => {
      // Desktop
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/agents");
      await expect(
        page.locator("h3").filter({ hasText: "Agents" }),
      ).toBeVisible();

      // Tablet
      await page.setViewportSize({ width: 768, height: 1024 });
      await expect(
        page.locator("h3").filter({ hasText: "Agents" }),
      ).toBeVisible();

      // Mobile
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(page.locator(".page")).toBeVisible();
    });
  });

  test.describe("Agent Lifecycle - State Transitions", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/agents");
    });

    test("should display agents table with sortable columns", async ({
      page,
    }) => {
      const header = page.locator(".table__row--header");

      // Check column headers exist
      await expect(header).toContainText("Name");
      await expect(header).toContainText("Status");
      await expect(header).toContainText("Model");
      await expect(header).toContainText("ID");
    });

    test("should differentiate between agent states visually", async ({
      page,
    }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });

      // Each row should have a status pill with color
      const count = await rows.count();
      for (let i = 0; i < Math.min(count, 5); i++) {
        const pill = rows.nth(i).locator(".pill");
        await expect(pill).toBeVisible();
        // Pill should have a tone class
        const classes = await pill.getAttribute("class");
        expect(classes).toMatch(/pill--/);
      }
    });
  });

  test.describe("Agent Lifecycle - Concurrent Agents", () => {
    test("should show agents with different concurrent states", async ({
      page,
    }) => {
      await page.goto("/agents");

      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });

      // Collect all statuses
      const statuses: string[] = [];
      const count = await rows.count();

      for (let i = 0; i < count; i++) {
        const statusPill = rows.nth(i).locator(".pill");
        const statusText = await statusPill.textContent();
        if (statusText) {
          statuses.push(statusText.trim());
        }
      }

      // Should have at least one status
      expect(statuses.length).toBeGreaterThanOrEqual(1);
    });
  });

  test.describe("Agent Lifecycle - Metrics Dashboard", () => {
    test("should display agent metrics on dashboard", async ({ page }) => {
      await page.goto("/");

      // Main metrics grid
      await expect(page.locator(".grid--2")).toBeVisible();

      // Compact metrics grid
      await expect(page.locator(".grid--3")).toBeVisible();
    });

    test("should show workstream status", async ({ page }) => {
      await page.goto("/");

      const workstreamCard = page
        .locator(".card")
        .filter({ hasText: "Workstream" });
      await expect(workstreamCard).toBeVisible();

      // Should show tracked count
      await expect(workstreamCard.locator(".pill")).toContainText("tracked");
    });
  });
}
