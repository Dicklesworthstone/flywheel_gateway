/**
 * E2E tests for Dashboard page.
 */

import { expect, test } from "@playwright/test";

const isPlaywright = process.env["PLAYWRIGHT_TEST"] === "1";

if (isPlaywright) {

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should display live agents card", async ({ page }) => {
    const card = page.locator(".card").filter({ hasText: "Live agents" });
    await expect(card).toBeVisible();

    // Should show metric value
    await expect(card.locator(".metric")).toBeVisible();

    // Should show status pill with executing count
    await expect(card.locator(".pill")).toContainText("executing");
  });

  test("should display workstream card", async ({ page }) => {
    const card = page.locator(".card").filter({ hasText: "Workstream" });
    await expect(card).toBeVisible();

    // Should show metric value
    await expect(card.locator(".metric")).toBeVisible();

    // Should show tracked count
    await expect(card.locator(".pill")).toContainText("tracked");
  });

  test("should display WebSocket latency metric", async ({ page }) => {
    const card = page
      .locator(".card--compact")
      .filter({ hasText: "WebSocket" });
    await expect(card).toBeVisible();

    // Should show latency in ms
    await expect(card.locator("h4")).toContainText("ms");
  });

  test("should display audit metric", async ({ page }) => {
    const card = page.locator(".card--compact").filter({ hasText: "Audit" });
    await expect(card).toBeVisible();
  });

  test("should display coverage metric", async ({ page }) => {
    const card = page.locator(".card--compact").filter({ hasText: "Coverage" });
    await expect(card).toBeVisible();
    await expect(card.locator("h4")).toHaveText("Mock-first");
  });

  test("should have responsive grid layout", async ({ page }) => {
    // Main grid should use 2-column layout
    await expect(page.locator(".grid--2")).toBeVisible();

    // Secondary grid should use 3-column layout
    await expect(page.locator(".grid--3")).toBeVisible();
  });
});
}
