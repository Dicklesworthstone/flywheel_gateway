/**
 * E2E tests for navigation and routing.
 */

import { expect, test } from "@playwright/test";

const isPlaywright = process.env["PLAYWRIGHT_TEST"] === "1";

if (isPlaywright) {

test.describe("Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should load dashboard by default", async ({ page }) => {
    // Dashboard should be the home page
    await expect(page).toHaveURL("/");

    // Should have the main layout with sidebar
    await expect(page.locator(".sidebar")).toBeVisible();

    // Dashboard content should be visible
    await expect(
      page.locator("h3").filter({ hasText: "Live agents" }),
    ).toBeVisible();
  });

  test("should navigate to Agents page", async ({ page }) => {
    // Click on Agents nav item
    await page.click('a[href="/agents"]');

    await expect(page).toHaveURL("/agents");
    await expect(
      page.locator("h3").filter({ hasText: "Agents" }),
    ).toBeVisible();
  });

  test("should navigate to Beads page", async ({ page }) => {
    await page.click('a[href="/beads"]');

    await expect(page).toHaveURL("/beads");
    // Beads page should load
    await expect(page.locator(".page")).toBeVisible();
  });

  test("should navigate to DCG page", async ({ page }) => {
    await page.click('a[href="/dcg"]');

    await expect(page).toHaveURL("/dcg");
    await expect(page.locator(".page")).toBeVisible();
  });

  test("should navigate to Fleet page", async ({ page }) => {
    await page.click('a[href="/fleet"]');

    await expect(page).toHaveURL("/fleet");
    await expect(page.locator(".page")).toBeVisible();
  });

  test("should navigate to Velocity page", async ({ page }) => {
    await page.click('a[href="/velocity"]');

    await expect(page).toHaveURL("/velocity");
    await expect(page.locator(".page")).toBeVisible();
  });

  test("should navigate to Collaboration page", async ({ page }) => {
    await page.click('a[href="/collaboration"]');

    await expect(page).toHaveURL("/collaboration");
    await expect(page.locator(".page")).toBeVisible();
  });

  test("should navigate to Settings page", async ({ page }) => {
    await page.click('a[href="/settings"]');

    await expect(page).toHaveURL("/settings");
    await expect(page.locator(".page")).toBeVisible();
  });

  test("should highlight active nav link", async ({ page }) => {
    // Dashboard link should be active by default
    await expect(page.locator('a[href="/"].nav-link--active')).toBeVisible();

    // Navigate to agents
    await page.click('a[href="/agents"]');
    await expect(
      page.locator('a[href="/agents"].nav-link--active'),
    ).toBeVisible();
    await expect(
      page.locator('a[href="/"].nav-link--active'),
    ).not.toBeVisible();
  });

  test("should show 404 page for invalid routes", async ({ page }) => {
    await page.goto("/invalid-route-that-does-not-exist");

    // Should show not found page
    await expect(page.locator(".page")).toBeVisible();
  });
});
}

test.describe("Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should display brand logo and title", async ({ page }) => {
    await expect(page.locator(".brand-title")).toHaveText("Flywheel");
    await expect(page.locator(".brand-subtitle")).toHaveText("Gateway");
  });

  test("should toggle sidebar collapse", async ({ page }) => {
    const sidebar = page.locator(".sidebar");
    const collapseBtn = page.locator(".sidebar__collapse-btn");

    // Initially expanded
    await expect(sidebar).not.toHaveClass(/sidebar--collapsed/);

    // Click collapse button
    await collapseBtn.click();
    await expect(sidebar).toHaveClass(/sidebar--collapsed/);

    // Click again to expand
    await collapseBtn.click();
    await expect(sidebar).not.toHaveClass(/sidebar--collapsed/);
  });

  test("should show badge counts on nav items", async ({ page }) => {
    // Agents and Beads should have badges
    const agentsLink = page.locator('a[href="/agents"]');
    const beadsLink = page.locator('a[href="/beads"]');

    await expect(agentsLink.locator(".nav-badge")).toBeVisible();
    await expect(beadsLink.locator(".nav-badge")).toBeVisible();
  });

  test("should show command palette hint", async ({ page }) => {
    await expect(page.locator(".sidebar__hint")).toContainText(
      "Command palette",
    );
    await expect(page.locator(".sidebar__hint kbd")).toHaveText("⌘K");
  });
});
}
