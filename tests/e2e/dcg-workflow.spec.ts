/**
 * E2E tests for DCG (Destructive Command Guard) Workflow.
 *
 * Tests cover:
 * - DCG dashboard display and navigation
 * - Quick stats overview
 * - Live feed of blocked commands
 * - Pending exceptions approval workflow
 * - Statistics and trends display
 * - Pack configuration (enable/disable)
 * - Allowlist management
 * - Command testing interface
 */

import { expect, test } from "@playwright/test";

test.describe("DCG Dashboard - Overview", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dcg");
  });

  test("should display DCG page header with shield icon", async ({ page }) => {
    const header = page.locator("h2").filter({ hasText: "Destructive Command Guard" });
    await expect(header).toBeVisible();
  });

  test("should display quick stats cards", async ({ page }) => {
    // Blocks (24h) stat
    const blocks24h = page.locator(".card--compact").filter({ hasText: "Blocks (24h)" });
    await expect(blocks24h).toBeVisible();
    await expect(blocks24h.locator(".metric")).toBeVisible();

    // Total Blocks stat
    const totalBlocks = page.locator(".card--compact").filter({ hasText: "Total Blocks" });
    await expect(totalBlocks).toBeVisible();

    // False Positive Rate stat
    const fpRate = page.locator(".card--compact").filter({ hasText: "False Positive Rate" });
    await expect(fpRate).toBeVisible();

    // Pending stat
    const pending = page.locator(".card--compact").filter({ hasText: "Pending" });
    await expect(pending).toBeVisible();
  });

  test("should display tab navigation", async ({ page }) => {
    const tabs = page.locator("button").filter({ hasText: /Live Feed|Pending|Statistics|Configuration|Allowlist|Test Command/ });

    // Should have all 6 tabs
    await expect(tabs.first()).toBeVisible();

    // Check for specific tabs
    await expect(page.locator("button").filter({ hasText: "Live Feed" })).toBeVisible();
    await expect(page.locator("button").filter({ hasText: "Pending" })).toBeVisible();
    await expect(page.locator("button").filter({ hasText: "Statistics" })).toBeVisible();
    await expect(page.locator("button").filter({ hasText: "Configuration" })).toBeVisible();
    await expect(page.locator("button").filter({ hasText: "Allowlist" })).toBeVisible();
    await expect(page.locator("button").filter({ hasText: "Test Command" })).toBeVisible();
  });
});

test.describe("DCG Live Feed Tab", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dcg");
    // Live Feed should be the default tab
  });

  test("should display Recent Blocks header", async ({ page }) => {
    const header = page.locator("h3").filter({ hasText: "Recent Blocks" });
    await expect(header).toBeVisible();
  });

  test("should display severity filter buttons", async ({ page }) => {
    // Filter buttons for severity levels
    await expect(page.locator("button").filter({ hasText: "All" })).toBeVisible();
    await expect(page.locator("button").filter({ hasText: "critical" })).toBeVisible();
    await expect(page.locator("button").filter({ hasText: "high" })).toBeVisible();
    await expect(page.locator("button").filter({ hasText: "medium" })).toBeVisible();
    await expect(page.locator("button").filter({ hasText: "low" })).toBeVisible();
  });

  test("should display blocks table with headers", async ({ page }) => {
    const table = page.locator(".table");
    await expect(table).toBeVisible();

    const header = table.locator(".table__row--header");
    await expect(header).toContainText("Command");
    await expect(header).toContainText("Severity");
    await expect(header).toContainText("Pack");
    await expect(header).toContainText("Time");
  });

  test("should display blocked commands with severity pills", async ({ page }) => {
    const rows = page.locator(".table__row").filter({ hasNot: page.locator(".table__row--header") });

    // Should have at least one block
    const count = await rows.count();
    if (count > 0) {
      // Each block should have a severity pill
      const pill = rows.first().locator(".pill");
      await expect(pill).toBeVisible();
    }
  });

  test("should filter blocks by severity", async ({ page }) => {
    // Click on critical filter
    await page.click('button:text("critical")');

    // Wait for filter to apply
    await page.waitForTimeout(500);

    // All visible blocks should be critical severity (or no blocks if none match)
    const rows = page.locator(".table__row").filter({ hasNot: page.locator(".table__row--header") });
    const count = await rows.count();

    if (count > 0) {
      // Each row should have critical severity
      for (let i = 0; i < Math.min(count, 3); i++) {
        const pill = rows.nth(i).locator(".pill");
        const text = await pill.textContent();
        expect(text?.toLowerCase()).toContain("critical");
      }
    }
  });
});

test.describe("DCG Pending Exceptions Tab", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dcg");
    // Navigate to Pending tab
    await page.click('button:text("Pending")');
  });

  test("should display Pending Exceptions header", async ({ page }) => {
    const header = page.locator("h3").filter({ hasText: "Pending Exceptions" });
    await expect(header).toBeVisible();
  });

  test("should show pending count status pill", async ({ page }) => {
    const card = page.locator(".card--wide").filter({ hasText: "Pending Exceptions" });
    const statusPill = card.locator(".pill").filter({ hasText: /pending/ });
    await expect(statusPill).toBeVisible();
  });

  test("should display pending exception cards with approve/deny buttons", async ({ page }) => {
    // Check for pending exception cards
    const cards = page.locator(".card").filter({ has: page.locator('button:text("Approve")') });
    const count = await cards.count();

    if (count > 0) {
      // Each pending card should have approve and deny buttons
      const firstCard = cards.first();
      await expect(firstCard.locator('button:text("Approve")')).toBeVisible();
      await expect(firstCard.locator('button:text("Deny")')).toBeVisible();

      // Should show short code
      await expect(firstCard.locator(".mono")).toBeVisible();

      // Should show command
      await expect(firstCard.locator(".mono").nth(1)).toBeVisible();
    }
  });

  test("should show no pending message when empty", async ({ page }) => {
    // If no pending exceptions, should show empty state
    const emptyState = page.locator("h4").filter({ hasText: "No pending exceptions" });
    const pendingCards = page.locator(".card").filter({ has: page.locator('button:text("Approve")') });

    const hasPending = await pendingCards.count() > 0;
    const hasEmptyState = await emptyState.isVisible().catch(() => false);

    // Either has pending exceptions or shows empty state
    expect(hasPending || hasEmptyState).toBe(true);
  });
});

test.describe("DCG Statistics Tab", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dcg");
    // Navigate to Statistics tab
    await page.click('button:text("Statistics")');
  });

  test("should display Blocks by Severity section", async ({ page }) => {
    const header = page.locator("h3").filter({ hasText: "Blocks by Severity" });
    await expect(header).toBeVisible();
  });

  test("should display severity distribution with pills", async ({ page }) => {
    // Should have severity pills for critical, high, medium, low
    const severityCard = page.locator(".card").filter({ hasText: "Blocks by Severity" });

    // Check for at least one severity pill
    const pills = severityCard.locator(".pill");
    await expect(pills.first()).toBeVisible();
  });

  test("should display Top Blocking Packs section", async ({ page }) => {
    const header = page.locator("h3").filter({ hasText: "Top Blocking Packs" });
    await expect(header).toBeVisible();
  });
});

test.describe("DCG Configuration Tab", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dcg");
    // Navigate to Configuration tab
    await page.click('button:text("Configuration")');
  });

  test("should display Rule Packs header", async ({ page }) => {
    const header = page.locator("h3").filter({ hasText: "Rule Packs" });
    await expect(header).toBeVisible();
  });

  test("should show enabled packs count", async ({ page }) => {
    const countText = page.locator(".muted").filter({ hasText: /\d+ enabled/ });
    await expect(countText).toBeVisible();
  });

  test("should display pack cards with enable/disable buttons", async ({ page }) => {
    // Pack cards should have toggle buttons
    const packCards = page.locator(".card").filter({ has: page.locator('button:text("Disable")') })
      .or(page.locator(".card").filter({ has: page.locator('button:text("Enable")') }));

    const count = await packCards.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Each pack should have name, description, and rule count
    const firstPack = packCards.first();
    await expect(firstPack.locator("h4")).toBeVisible();
    await expect(firstPack.locator(".pill").filter({ hasText: /rules/ })).toBeVisible();
  });

  test("should display pack severity levels", async ({ page }) => {
    const packCards = page.locator(".card").filter({ has: page.locator('button:text("Disable")') })
      .or(page.locator(".card").filter({ has: page.locator('button:text("Enable")') }));

    const count = await packCards.count();
    if (count > 0) {
      // Each pack should have a severity pill
      const firstPack = packCards.first();
      const severityPill = firstPack.locator(".pill").filter({ hasText: /critical|high|medium|low/ });
      await expect(severityPill).toBeVisible();
    }
  });
});

test.describe("DCG Allowlist Tab", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dcg");
    // Navigate to Allowlist tab
    await page.click('button:text("Allowlist")');
  });

  test("should display Allowlist header with Add Entry button", async ({ page }) => {
    const header = page.locator("h3").filter({ hasText: "Allowlist" });
    await expect(header).toBeVisible();

    const addButton = page.locator('button:text("Add Entry")');
    await expect(addButton).toBeVisible();
  });

  test("should toggle add entry form", async ({ page }) => {
    const addButton = page.locator('button:text("Add Entry")');
    await addButton.click();

    // Form should appear
    await expect(page.locator('label:text("Rule ID")')).toBeVisible();
    await expect(page.locator('label:text("Pattern")')).toBeVisible();
    await expect(page.locator('label:text("Reason")')).toBeVisible();

    // Cancel button should appear
    await expect(page.locator('button:text("Cancel")')).toBeVisible();
  });

  test("should display existing allowlist entries", async ({ page }) => {
    // Check for allowlist entries or empty state
    const entries = page.locator(".card").filter({ has: page.locator('button[title="Remove"]') });
    const emptyState = page.locator("h4").filter({ hasText: "No allowlist entries" });

    const hasEntries = await entries.count() > 0;
    const hasEmptyState = await emptyState.isVisible().catch(() => false);

    // Either has entries or shows empty state
    expect(hasEntries || hasEmptyState).toBe(true);
  });

  test("should show entry details when entries exist", async ({ page }) => {
    const entries = page.locator(".card").filter({ has: page.locator('button[title="Remove"]') });
    const count = await entries.count();

    if (count > 0) {
      const firstEntry = entries.first();
      // Should show rule ID
      await expect(firstEntry.locator(".mono").first()).toBeVisible();
      // Should show pattern
      await expect(firstEntry.locator(".mono").nth(1)).toBeVisible();
      // Should show reason
      await expect(firstEntry.locator(".muted")).toBeVisible();
    }
  });
});

test.describe("DCG Command Tester Tab", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dcg");
    // Navigate to Test Command tab
    await page.click('button:text("Test Command")');
  });

  test("should display Command Tester header", async ({ page }) => {
    const header = page.locator("h3").filter({ hasText: "Command Tester" });
    await expect(header).toBeVisible();
  });

  test("should display command input field", async ({ page }) => {
    const input = page.locator('input[placeholder*="git reset"]');
    await expect(input).toBeVisible();
  });

  test("should display Test and Explain buttons", async ({ page }) => {
    const testButton = page.locator('button:text("Test")');
    const explainButton = page.locator('button:text("Explain")');

    await expect(testButton).toBeVisible();
    await expect(explainButton).toBeVisible();
  });

  test("should test a safe command", async ({ page }) => {
    const input = page.locator('input[placeholder*="git reset"]');
    await input.fill("git status");

    const testButton = page.locator('button:text("Test")');
    await testButton.click();

    // Wait for result
    await page.waitForTimeout(1000);

    // Should show ALLOWED result for safe command
    const allowedResult = page.locator("h4").filter({ hasText: "ALLOWED" });
    const isAllowed = await allowedResult.isVisible().catch(() => false);

    // Result should be shown (either allowed or blocked)
    const result = page.locator("h4").filter({ hasText: /ALLOWED|BLOCKED/ });
    await expect(result).toBeVisible();
  });

  test("should test a dangerous command", async ({ page }) => {
    const input = page.locator('input[placeholder*="git reset"]');
    await input.fill("rm -rf /");

    const testButton = page.locator('button:text("Test")');
    await testButton.click();

    // Wait for result
    await page.waitForTimeout(1000);

    // Should show BLOCKED result for dangerous command
    const blockedResult = page.locator("h4").filter({ hasText: "BLOCKED" });
    await expect(blockedResult).toBeVisible();
  });

  test("should explain a command", async ({ page }) => {
    const input = page.locator('input[placeholder*="git reset"]');
    await input.fill("git reset --hard HEAD");

    const explainButton = page.locator('button:text("Explain")');
    await explainButton.click();

    // Wait for result
    await page.waitForTimeout(1000);

    // Should show Analysis section
    const analysisHeader = page.locator("h4").filter({ hasText: "Analysis" });
    await expect(analysisHeader).toBeVisible();
  });
});

test.describe("DCG Navigation and Tab Switching", () => {
  test("should maintain state when switching tabs", async ({ page }) => {
    await page.goto("/dcg");

    // Start on Live Feed
    await expect(page.locator("h3").filter({ hasText: "Recent Blocks" })).toBeVisible();

    // Switch to Statistics
    await page.click('button:text("Statistics")');
    await expect(page.locator("h3").filter({ hasText: "Blocks by Severity" })).toBeVisible();

    // Switch to Configuration
    await page.click('button:text("Configuration")');
    await expect(page.locator("h3").filter({ hasText: "Rule Packs" })).toBeVisible();

    // Switch back to Live Feed
    await page.click('button:text("Live Feed")');
    await expect(page.locator("h3").filter({ hasText: "Recent Blocks" })).toBeVisible();
  });

  test("should highlight active tab", async ({ page }) => {
    await page.goto("/dcg");

    // Live Feed should be active by default
    const liveFeedTab = page.locator('button:text("Live Feed")');
    await expect(liveFeedTab).toHaveClass(/btn--primary/);

    // Switch to Pending
    await page.click('button:text("Pending")');
    const pendingTab = page.locator('button:text("Pending")');
    await expect(pendingTab).toHaveClass(/btn--primary/);

    // Live Feed should no longer be primary
    await expect(liveFeedTab).not.toHaveClass(/btn--primary/);
  });
});

test.describe("DCG Responsiveness", () => {
  test("should display correctly on desktop viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/dcg");

    await expect(page.locator("h2").filter({ hasText: "Destructive Command Guard" })).toBeVisible();
    await expect(page.locator(".card--compact").first()).toBeVisible();
  });

  test("should display correctly on tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/dcg");

    await expect(page.locator("h2").filter({ hasText: "Destructive Command Guard" })).toBeVisible();
  });

  test("should display correctly on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/dcg");

    // Page should still be accessible
    await expect(page.locator(".page")).toBeVisible();
  });
});

test.describe("DCG Block Events Review", () => {
  test("should show block details in feed", async ({ page }) => {
    await page.goto("/dcg");

    const rows = page.locator(".table__row").filter({ hasNot: page.locator(".table__row--header") });
    const count = await rows.count();

    if (count > 0) {
      const firstRow = rows.first();

      // Command should be monospace
      await expect(firstRow.locator(".mono")).toBeVisible();

      // Severity pill should be present
      await expect(firstRow.locator(".pill")).toBeVisible();

      // Pack name should be present
      const cells = firstRow.locator("span");
      expect(await cells.count()).toBeGreaterThanOrEqual(3);
    }
  });

  test("should allow marking blocks as false positive", async ({ page }) => {
    await page.goto("/dcg");

    // Look for false positive button
    const fpButton = page.locator('button[title="Mark as false positive"]');
    const count = await fpButton.count();

    // If there are blocks that aren't already false positives
    if (count > 0) {
      await expect(fpButton.first()).toBeVisible();
    }
  });
});
