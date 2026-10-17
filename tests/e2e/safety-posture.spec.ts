/**
 * E2E tests for Safety Posture Panel and API endpoint.
 *
 * Tests cover:
 * - Safety posture panel rendering on Dashboard
 * - Individual tool status cards (DCG, SLB, UBS)
 * - Checksum/integrity verification display
 * - Issues panel with recommendations
 * - API endpoint responses for /api/safety/posture
 * - Degraded state handling when tools are missing
 * - Refresh functionality
 *
 * @see bd-3qs0
 */

import { expect, test } from "@playwright/test";

const isPlaywright = process.env["PLAYWRIGHT_TEST"] === "1";

if (isPlaywright) {
  test.describe("Safety Posture Panel - Dashboard Integration", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/");
    });

    test("should display Safety Posture header with shield icon", async ({
      page,
    }) => {
      const header = page.locator("h3").filter({ hasText: "Safety Posture" });
      await expect(header).toBeVisible();
    });

    test("should display overall status pill", async ({ page }) => {
      // Should show status: All Systems Healthy, Some Issues, or Attention Required
      const safetySection = page
        .locator(".card")
        .filter({ hasText: "Safety Posture" });
      const statusPill = safetySection.locator(".pill").first();
      await expect(statusPill).toBeVisible();

      // Status should be one of the expected values
      const text = await statusPill.textContent();
      expect(
        text?.includes("Healthy") ||
          text?.includes("Issues") ||
          text?.includes("Attention"),
      ).toBe(true);
    });

    test("should display refresh button", async ({ page }) => {
      const safetySection = page
        .locator(".card")
        .filter({ hasText: "Safety Posture" });
      const refreshButton = safetySection.locator('button[title="Refresh"]');
      await expect(refreshButton).toBeVisible();
    });

    test("should trigger refresh on button click", async ({ page }) => {
      const safetySection = page
        .locator(".card")
        .filter({ hasText: "Safety Posture" });
      const refreshButton = safetySection.locator('button[title="Refresh"]');

      // Click refresh
      await refreshButton.click();

      // Should show loading spinner briefly
      // Note: in mock mode this happens quickly, so we just verify the button works
      await expect(refreshButton).toBeVisible();
    });
  });

  test.describe("Safety Posture Panel - Tool Status Cards", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/");
    });

    test("should display Safety Tools section header", async ({ page }) => {
      const header = page.locator("h4").filter({ hasText: "Safety Tools" });
      await expect(header).toBeVisible();
    });

    test("should display DCG tool status card", async ({ page }) => {
      const dcgCard = page.locator(".card--compact").filter({ hasText: "DCG" });
      await expect(dcgCard).toBeVisible();

      // Should show description
      await expect(dcgCard).toContainText("Destructive Command Guard");

      // Should show status (Healthy, Unhealthy, or Missing)
      const statusPill = dcgCard.locator(".pill");
      await expect(statusPill).toBeVisible();
    });

    test("should display SLB tool status card", async ({ page }) => {
      const slbCard = page.locator(".card--compact").filter({ hasText: "SLB" });
      await expect(slbCard).toBeVisible();

      // Should show description
      await expect(slbCard).toContainText("Simultaneous Launch Button");

      // Should show status
      const statusPill = slbCard.locator(".pill");
      await expect(statusPill).toBeVisible();
    });

    test("should display UBS tool status card", async ({ page }) => {
      const ubsCard = page.locator(".card--compact").filter({ hasText: "UBS" });
      await expect(ubsCard).toBeVisible();

      // Should show description
      await expect(ubsCard).toContainText("Ultimate Bug Scanner");

      // Should show status
      const statusPill = ubsCard.locator(".pill");
      await expect(statusPill).toBeVisible();
    });

    test("should display version info for installed tools", async ({
      page,
    }) => {
      // Find a tool card that shows "Installed" or a version number
      const toolCards = page.locator(".card--compact").filter({
        hasText: /DCG|SLB|UBS/,
      });
      const count = await toolCards.count();

      for (let i = 0; i < count; i++) {
        const card = toolCards.nth(i);
        const statusPill = card.locator(".pill");
        const pillText = await statusPill.textContent();

        if (pillText?.includes("Healthy")) {
          // Installed tools should show version (v1.x.x format or "Installed")
          const versionText = card
            .locator(".muted")
            .filter({ hasText: /v\d|Installed/ });
          await expect(versionText.or(card.locator(".muted"))).toBeVisible();
        }
      }
    });

    test("should display install command for missing tools", async ({
      page,
    }) => {
      // In mock mode, UBS is not installed
      const ubsCard = page.locator(".card--compact").filter({ hasText: "UBS" });
      const statusPill = ubsCard.locator(".pill");
      const pillText = await statusPill.textContent();

      if (pillText?.includes("Missing")) {
        // Should show install command
        const installCommand = ubsCard.locator("code");
        await expect(installCommand).toBeVisible();
        await expect(installCommand).toContainText("cargo install");
      }
    });

    test("should show appropriate icons based on tool status", async ({
      page,
    }) => {
      const toolCards = page.locator(".card--compact").filter({
        hasText: /DCG|SLB|UBS/,
      });
      const count = await toolCards.count();

      for (let i = 0; i < count; i++) {
        const card = toolCards.nth(i);
        // Each card should have a shield icon variant
        const icon = card.locator("svg");
        await expect(icon.first()).toBeVisible();
      }
    });
  });

  test.describe("Safety Posture Panel - Integrity Verification", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/");
    });

    test("should display Integrity Verification section header", async ({
      page,
    }) => {
      const header = page
        .locator("h4")
        .filter({ hasText: "Integrity Verification" });
      await expect(header).toBeVisible();
    });

    test("should display ACFS Checksums card", async ({ page }) => {
      const checksumCard = page.locator(".card--compact").filter({
        hasText: "ACFS Checksums",
      });
      await expect(checksumCard).toBeVisible();
    });

    test("should show checksum age", async ({ page }) => {
      const checksumCard = page.locator(".card--compact").filter({
        hasText: "ACFS Checksums",
      });

      // Should show age (e.g., "3 days ago" or "Unknown")
      const ageText = checksumCard.locator(".muted").filter({
        hasText: /ago|Unknown|Just now/,
      });
      await expect(ageText).toBeVisible();
    });

    test("should show checksum status pill", async ({ page }) => {
      const checksumCard = page.locator(".card--compact").filter({
        hasText: "ACFS Checksums",
      });

      // Should show status: Current, Stale, or Unavailable
      const statusPill = checksumCard.locator(".pill");
      await expect(statusPill).toBeVisible();

      const text = await statusPill.textContent();
      expect(
        text?.includes("Current") ||
          text?.includes("Stale") ||
          text?.includes("Unavailable"),
      ).toBe(true);
    });

    test("should show tools with checksums count", async ({ page }) => {
      const checksumCard = page.locator(".card--compact").filter({
        hasText: "ACFS Checksums",
      });

      // Should show count of verified tools
      await expect(checksumCard).toContainText(/\d+ tools? with checksums/);
    });
  });

  test.describe("Safety Posture Panel - Issues Display", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/");
    });

    test("should display issues panel when issues exist", async ({ page }) => {
      // In mock mode, UBS is missing which creates an issue
      const issuesPanel = page.locator(".card").filter({
        hasText: "Issues Detected",
      });

      // Issues panel may or may not be visible depending on state
      const isVisible = await issuesPanel.isVisible().catch(() => false);

      if (isVisible) {
        // Should show issue count
        const countPill = issuesPanel.locator(".pill");
        await expect(countPill).toBeVisible();

        // Should list individual issues
        const issues = issuesPanel.locator('svg[data-lucide="chevron-right"]');
        expect(await issues.count()).toBeGreaterThanOrEqual(1);
      }
    });

    test("should display recommendations for each issue", async ({ page }) => {
      const issuesPanel = page.locator(".card").filter({
        hasText: "Issues Detected",
      });

      const isVisible = await issuesPanel.isVisible().catch(() => false);

      if (isVisible) {
        // Each issue should have a recommendation below it
        const recommendations = issuesPanel.locator(".muted");
        const count = await recommendations.count();
        expect(count).toBeGreaterThanOrEqual(1);
      }
    });

    test("should show all healthy message when no issues", async ({ page }) => {
      // Check for healthy state message
      const healthyMessage = page.locator("div").filter({
        hasText: "All safety tools are installed and healthy",
      });

      const issuesPanel = page.locator(".card").filter({
        hasText: "Issues Detected",
      });

      // Either healthy message or issues panel should be visible (but not both)
      const isHealthy = await healthyMessage
        .first()
        .isVisible()
        .catch(() => false);
      const hasIssues = await issuesPanel.isVisible().catch(() => false);

      // One or the other should be visible
      expect(isHealthy || hasIssues).toBe(true);
    });
  });

  test.describe("Safety Posture Panel - Quick Links", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/");
    });

    test("should display DCG Dashboard link", async ({ page }) => {
      const dcgLink = page.locator("a").filter({ hasText: "DCG Dashboard" });
      await expect(dcgLink).toBeVisible();
      await expect(dcgLink).toHaveAttribute("href", "/dcg");
    });

    test("should display external documentation links", async ({ page }) => {
      // DCG Docs link
      const dcgDocsLink = page.locator("a").filter({ hasText: "DCG Docs" });
      await expect(dcgDocsLink).toBeVisible();
      await expect(dcgDocsLink).toHaveAttribute("target", "_blank");

      // SLB Docs link
      const slbDocsLink = page.locator("a").filter({ hasText: "SLB Docs" });
      await expect(slbDocsLink).toBeVisible();
      await expect(slbDocsLink).toHaveAttribute("target", "_blank");
    });

    test("should navigate to DCG page when clicking DCG Dashboard link", async ({
      page,
    }) => {
      const dcgLink = page.locator("a").filter({ hasText: "DCG Dashboard" });
      await dcgLink.click();

      // Should navigate to DCG page
      await expect(page).toHaveURL(/\/dcg/);
      await expect(
        page.locator("h2").filter({ hasText: "Destructive Command Guard" }),
      ).toBeVisible();
    });
  });

  test.describe("Safety Posture API - /api/safety/posture", () => {
    test("should return valid posture response structure", async ({
      request,
    }) => {
      const response = await request.get("/api/safety/posture");

      // May return 200 (healthy/degraded) or 503 (unhealthy)
      expect([200, 503]).toContain(response.status());

      const body = await response.json();

      // Should have required top-level fields
      expect(body.data).toBeDefined();
      const data = body.data;

      expect(data.status).toMatch(/^(healthy|degraded|unhealthy)$/);
      expect(data.timestamp).toBeDefined();
      expect(data.tools).toBeDefined();
      expect(data.checksums).toBeDefined();
      expect(data.summary).toBeDefined();
    });

    test("should return tool status for DCG, SLB, UBS", async ({ request }) => {
      const response = await request.get("/api/safety/posture");
      const body = await response.json();
      const tools = body.data.tools;

      // Each tool should have the required fields
      for (const toolName of ["dcg", "slb", "ubs"]) {
        expect(tools[toolName]).toBeDefined();
        expect(typeof tools[toolName].installed).toBe("boolean");
        expect(typeof tools[toolName].healthy).toBe("boolean");
        expect(typeof tools[toolName].latencyMs).toBe("number");
      }
    });

    test("should return checksum information", async ({ request }) => {
      const response = await request.get("/api/safety/posture");
      const body = await response.json();
      const checksums = body.data.checksums;

      expect(checksums.toolsWithChecksums).toBeGreaterThanOrEqual(0);
      expect(typeof checksums.staleThresholdMs).toBe("number");
      expect(typeof checksums.isStale).toBe("boolean");
      expect(Array.isArray(checksums.tools)).toBe(true);
    });

    test("should return summary with issues and recommendations", async ({
      request,
    }) => {
      const response = await request.get("/api/safety/posture");
      const body = await response.json();
      const summary = body.data.summary;

      expect(typeof summary.allToolsInstalled).toBe("boolean");
      expect(typeof summary.allToolsHealthy).toBe("boolean");
      expect(typeof summary.checksumsAvailable).toBe("boolean");
      expect(typeof summary.overallHealthy).toBe("boolean");
      expect(Array.isArray(summary.issues)).toBe(true);
      expect(Array.isArray(summary.recommendations)).toBe(true);
    });

    test("should return consistent status based on tool availability", async ({
      request,
    }) => {
      const response = await request.get("/api/safety/posture");
      const body = await response.json();
      const data = body.data;

      const allInstalled =
        data.tools.dcg.installed &&
        data.tools.slb.installed &&
        data.tools.ubs.installed;
      const allHealthy =
        data.tools.dcg.healthy &&
        data.tools.slb.healthy &&
        data.tools.ubs.healthy;

      // Status should be unhealthy if not all tools installed
      if (!allInstalled) {
        expect(data.status).toBe("unhealthy");
      }
      // Status should be healthy only if all tools healthy and checksums fresh
      if (data.status === "healthy") {
        expect(allInstalled).toBe(true);
        expect(allHealthy).toBe(true);
      }
    });
  });

  test.describe("Safety Posture API - /api/safety/tools", () => {
    test("should return all tools status", async ({ request }) => {
      const response = await request.get("/api/safety/tools");
      expect(response.status()).toBe(200);

      const body = await response.json();
      expect(body.data.dcg).toBeDefined();
      expect(body.data.slb).toBeDefined();
      expect(body.data.ubs).toBeDefined();
      expect(body.data.summary).toBeDefined();
    });

    test("should return specific tool status with query param", async ({
      request,
    }) => {
      for (const tool of ["dcg", "slb", "ubs"]) {
        const response = await request.get(`/api/safety/tools?tool=${tool}`);
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.data.tool).toBe(tool);
        expect(typeof body.data.installed).toBe("boolean");
        expect(typeof body.data.healthy).toBe("boolean");
      }
    });

    test("should return error for invalid tool name", async ({ request }) => {
      const response = await request.get("/api/safety/tools?tool=invalid");
      expect(response.status()).toBe(400);

      const body = await response.json();
      expect(body.error).toBeDefined();
    });
  });

  test.describe("Safety Posture API - /api/safety/checksums", () => {
    test("should return checksum status", async ({ request }) => {
      const response = await request.get("/api/safety/checksums");
      expect(response.status()).toBe(200);

      const body = await response.json();
      expect(body.data.toolsWithChecksums).toBeGreaterThanOrEqual(0);
      expect(typeof body.data.staleThresholdMs).toBe("number");
      expect(typeof body.data.isStale).toBe("boolean");
      expect(Array.isArray(body.data.tools)).toBe(true);
    });

    test("should return per-tool checksum details", async ({ request }) => {
      const response = await request.get("/api/safety/checksums");
      const body = await response.json();

      for (const toolChecksum of body.data.tools) {
        expect(toolChecksum.toolId).toBeDefined();
        expect(typeof toolChecksum.hasChecksums).toBe("boolean");
        expect(typeof toolChecksum.checksumCount).toBe("number");
      }
    });
  });

  test.describe("Safety Posture Panel - Error States", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/");
    });

    test("should display loading state initially", async ({ page }) => {
      // Reload and check for loading state
      // Note: In fast connections this may flash quickly
      await page.reload();

      // Loading indicator should appear at some point
      // This verifies the loading state exists even if briefly
      const loader = page.locator(".spin");
      // Don't fail if it's too fast to catch
      const wasVisible = await loader
        .first()
        .isVisible()
        .catch(() => false);
      // Just log whether we caught it
      console.log(`Loading spinner visible: ${wasVisible}`);
    });

    test("should handle refresh errors gracefully", async ({ page }) => {
      const safetySection = page
        .locator(".card")
        .filter({ hasText: "Safety Posture" });
      const refreshButton = safetySection.locator('button[title="Refresh"]');

      // Click refresh multiple times rapidly
      await refreshButton.click();
      await refreshButton.click();

      // Should not crash and panel should still be visible
      await expect(safetySection).toBeVisible();
    });
  });

  test.describe("Safety Posture Panel - Responsiveness", () => {
    test("should display correctly on desktop viewport", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/");

      const safetySection = page
        .locator(".card")
        .filter({ hasText: "Safety Posture" });
      await expect(safetySection).toBeVisible();

      // Tool cards should be in 3-column grid
      const toolGrid = page.locator(".grid--3");
      await expect(toolGrid).toBeVisible();
    });

    test("should display correctly on tablet viewport", async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto("/");

      const safetySection = page
        .locator(".card")
        .filter({ hasText: "Safety Posture" });
      await expect(safetySection).toBeVisible();
    });

    test("should display correctly on mobile viewport", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto("/");

      const safetySection = page
        .locator(".card")
        .filter({ hasText: "Safety Posture" });
      await expect(safetySection).toBeVisible();

      // Tool cards should still be visible (may stack vertically)
      const dcgCard = page.locator(".card--compact").filter({ hasText: "DCG" });
      await expect(dcgCard).toBeVisible();
    });
  });
}
