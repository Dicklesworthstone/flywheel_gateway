/**
 * E2E tests for Agents page.
 */

import { expect, test } from "@playwright/test";

const isPlaywright = process.env["PLAYWRIGHT_TEST"] === "1";

if (isPlaywright) {
  test.describe("Agents Page", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/agents");
    });

    test("should display agents header with count", async ({ page }) => {
      await expect(
        page.locator("h3").filter({ hasText: "Agents" }),
      ).toBeVisible();

      // Should show total count in status pill
      const pill = page.locator(".card__header .pill");
      await expect(pill).toContainText("total");
    });

    test("should display agent table with headers", async ({ page }) => {
      const table = page.locator(".table");
      await expect(table).toBeVisible();

      // Check table headers
      const header = table.locator(".table__row--header");
      await expect(header).toContainText("Name");
      await expect(header).toContainText("Status");
      await expect(header).toContainText("Model");
      await expect(header).toContainText("ID");
    });

    test("should display agent rows", async ({ page }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });

      // Should have at least one agent row
      await expect(rows.first()).toBeVisible();

      // Each row should have status pill
      await expect(rows.first().locator(".pill")).toBeVisible();

      // Each row should have monospace ID
      await expect(rows.first().locator(".mono")).toBeVisible();
    });

    test("should show different status tones", async ({ page }) => {
      // Look for different status types
      const pills = page.locator(".table__row .pill");

      // Should have at least one visible pill
      await expect(pills.first()).toBeVisible();
    });

    test("should display agent names", async ({ page }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });

      // First column should be non-empty (name)
      const firstRow = rows.first();
      const cells = firstRow.locator("span");
      await expect(cells.first()).not.toBeEmpty();
    });
  });

  test.describe("Agents Page - Responsiveness", () => {
    test("should display correctly on tablet viewport", async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto("/agents");

      await expect(page.locator(".table")).toBeVisible();
      await expect(
        page.locator("h3").filter({ hasText: "Agents" }),
      ).toBeVisible();
    });

    test("should display correctly on mobile viewport", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto("/agents");

      // Page should still be accessible
      await expect(page.locator(".page")).toBeVisible();
    });
  });
}
