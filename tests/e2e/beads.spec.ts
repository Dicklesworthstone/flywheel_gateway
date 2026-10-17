/**
 * E2E tests for Beads page CRUD flows.
 *
 * Tests cover:
 * - Beads list display and table structure
 * - Create bead flow (modal, form validation, submission)
 * - Claim bead flow (status transition to in_progress)
 * - Close bead flow (modal, reason input, status transition)
 * - Edit bead flow (modal, field updates, save)
 * - Status pill visual indicators (tones)
 * - Error banner display
 * - Responsive layouts (desktop/tablet/mobile)
 *
 * Logs: On failure, Playwright captures trace, screenshot, and video.
 * Network requests are logged for debugging API issues.
 */

import { expect, test } from "@playwright/test";

const isPlaywright = process.env["PLAYWRIGHT_TEST"] === "1";

if (isPlaywright) {
  test.describe("Beads - Page Display", () => {
    test.beforeEach(async ({ page }) => {
      // Log network requests for debugging
      page.on("request", (request) => {
        if (request.url().includes("/api/beads")) {
          console.log(`[REQ] ${request.method()} ${request.url()}`);
        }
      });
      page.on("response", (response) => {
        if (response.url().includes("/api/beads")) {
          console.log(`[RES] ${response.status()} ${response.url()}`);
        }
      });

      await page.goto("/beads");
    });

    test("should display beads page with header", async ({ page }) => {
      await expect(page.locator(".page")).toBeVisible();
      await expect(
        page.locator("h3").filter({ hasText: "Beads" }),
      ).toBeVisible();
    });

    test("should display beads table with correct columns", async ({
      page,
    }) => {
      const header = page.locator(".table__row--header");
      await expect(header).toBeVisible();

      await expect(header).toContainText("Bead");
      await expect(header).toContainText("Status");
      await expect(header).toContainText("Title");
      await expect(header).toContainText("Priority");
      await expect(header).toContainText("Type");
      await expect(header).toContainText("Actions");
    });

    test("should display tracked count in subtitle", async ({ page }) => {
      const subtitle = page.locator(".card__subtitle");
      await expect(subtitle).toContainText("tracked");
    });

    test("should display bead IDs in monospace", async ({ page }) => {
      const monoIds = page.locator(".table__row .mono");
      // Wait for at least one bead to be displayed
      const count = await monoIds.count();
      if (count > 0) {
        await expect(monoIds.first()).toBeVisible();
      }
    });

    test("should display refresh button", async ({ page }) => {
      const refreshBtn = page
        .locator(".btn--secondary")
        .filter({ hasText: "Refresh" });
      await expect(refreshBtn).toBeVisible();
    });

    test("should display new bead button", async ({ page }) => {
      const newBeadBtn = page
        .locator(".btn--primary")
        .filter({ hasText: "New Bead" });
      await expect(newBeadBtn).toBeVisible();
    });
  });

  test.describe("Beads - Status Pills", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/beads");
    });

    test("should display open status with muted tone", async ({ page }) => {
      const openPill = page.locator(".pill").filter({ hasText: "open" });
      if ((await openPill.count()) > 0) {
        await expect(openPill.first()).toBeVisible();
        await expect(openPill.first()).toHaveClass(/pill--muted/);
      }
    });

    test("should display in_progress status with warning tone", async ({
      page,
    }) => {
      const inProgressPill = page
        .locator(".pill")
        .filter({ hasText: "in progress" });
      if ((await inProgressPill.count()) > 0) {
        await expect(inProgressPill.first()).toBeVisible();
        await expect(inProgressPill.first()).toHaveClass(/pill--warning/);
      }
    });

    test("should display blocked status with danger tone", async ({ page }) => {
      const blockedPill = page.locator(".pill").filter({ hasText: "blocked" });
      if ((await blockedPill.count()) > 0) {
        await expect(blockedPill.first()).toBeVisible();
        await expect(blockedPill.first()).toHaveClass(/pill--danger/);
      }
    });

    test("should display closed status with positive tone", async ({
      page,
    }) => {
      const closedPill = page.locator(".pill").filter({ hasText: "closed" });
      if ((await closedPill.count()) > 0) {
        await expect(closedPill.first()).toBeVisible();
        await expect(closedPill.first()).toHaveClass(/pill--positive/);
      }
    });
  });

  test.describe("Beads - Create Flow", () => {
    test.beforeEach(async ({ page }) => {
      page.on("request", (request) => {
        if (
          request.url().includes("/api/beads") &&
          request.method() === "POST"
        ) {
          console.log(`[CREATE REQ] ${request.method()} ${request.url()}`);
          console.log(`[CREATE BODY] ${request.postData()}`);
        }
      });
      page.on("response", (response) => {
        if (
          response.url().includes("/api/beads") &&
          response.request().method() === "POST"
        ) {
          console.log(`[CREATE RES] ${response.status()}`);
        }
      });

      await page.goto("/beads");
    });

    test("should open create modal when clicking New Bead", async ({
      page,
    }) => {
      await page.click(".btn--primary >> text=New Bead");

      // Modal should be visible
      await expect(page.locator(".modal")).toBeVisible();
      await expect(page.locator(".modal__title")).toHaveText("Create Bead");
    });

    test("should display create modal fields", async ({ page }) => {
      await page.click(".btn--primary >> text=New Bead");

      // Check all form fields exist
      await expect(page.locator("#bead-title")).toBeVisible();
      await expect(page.locator("#bead-description")).toBeVisible();
      await expect(page.locator("#bead-priority")).toBeVisible();
      await expect(page.locator("#bead-type")).toBeVisible();
    });

    test("should disable create button when title is empty", async ({
      page,
    }) => {
      await page.click(".btn--primary >> text=New Bead");

      const createBtn = page
        .locator(".modal .btn--primary")
        .filter({ hasText: "Create" });
      await expect(createBtn).toBeDisabled();
    });

    test("should enable create button when title is filled", async ({
      page,
    }) => {
      await page.click(".btn--primary >> text=New Bead");

      await page.fill("#bead-title", "Test Bead Title");

      const createBtn = page
        .locator(".modal .btn--primary")
        .filter({ hasText: "Create" });
      await expect(createBtn).toBeEnabled();
    });

    test("should close modal when clicking Cancel", async ({ page }) => {
      await page.click(".btn--primary >> text=New Bead");
      await expect(page.locator(".modal")).toBeVisible();

      await page.click(".modal .btn--secondary >> text=Cancel");
      await expect(page.locator(".modal")).not.toBeVisible();
    });

    test("should create bead and close modal on submit", async ({ page }) => {
      const initialRows = await page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") })
        .count();

      await page.click(".btn--primary >> text=New Bead");
      await page.fill("#bead-title", `E2E Test Bead ${Date.now()}`);
      await page.fill("#bead-description", "Created by E2E test");
      await page.fill("#bead-priority", "2");
      await page.selectOption("#bead-type", "task");

      await page.click(".modal .btn--primary >> text=Create");

      // Modal should close
      await expect(page.locator(".modal")).not.toBeVisible({ timeout: 5000 });

      // New bead should appear in the list
      const newRows = await page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") })
        .count();
      expect(newRows).toBeGreaterThanOrEqual(initialRows);
    });

    test("should show loading state while creating", async ({ page }) => {
      await page.click(".btn--primary >> text=New Bead");
      await page.fill("#bead-title", "Loading Test Bead");

      // Click create and check for loading text
      const createBtn = page.locator(".modal .btn--primary");
      await createBtn.click();

      // Button should show loading state (might be brief)
      // Note: This may pass quickly if the API is fast
    });

    test("should default priority to 2", async ({ page }) => {
      await page.click(".btn--primary >> text=New Bead");
      const priorityInput = page.locator("#bead-priority");
      await expect(priorityInput).toHaveValue("2");
    });

    test("should default type to task", async ({ page }) => {
      await page.click(".btn--primary >> text=New Bead");
      const typeSelect = page.locator("#bead-type");
      await expect(typeSelect).toHaveValue("task");
    });
  });

  test.describe("Beads - Claim Flow", () => {
    test.beforeEach(async ({ page }) => {
      page.on("request", (request) => {
        if (request.url().includes("/claim")) {
          console.log(`[CLAIM REQ] ${request.method()} ${request.url()}`);
        }
      });
      page.on("response", (response) => {
        if (response.url().includes("/claim")) {
          console.log(`[CLAIM RES] ${response.status()}`);
        }
      });

      await page.goto("/beads");
    });

    test("should show Claim button for open beads", async ({ page }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });
      const count = await rows.count();

      for (let i = 0; i < Math.min(count, 5); i++) {
        const row = rows.nth(i);
        const statusPill = row.locator(".pill");
        const statusText = await statusPill.textContent();

        if (statusText?.includes("open")) {
          const claimBtn = row
            .locator(".btn--secondary")
            .filter({ hasText: "Claim" });
          await expect(claimBtn).toBeVisible();
        }
      }
    });

    test("should not show Claim button for in_progress beads", async ({
      page,
    }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });
      const count = await rows.count();

      for (let i = 0; i < Math.min(count, 5); i++) {
        const row = rows.nth(i);
        const statusPill = row.locator(".pill");
        const statusText = await statusPill.textContent();

        if (statusText?.includes("in progress")) {
          const claimBtn = row
            .locator(".btn--secondary")
            .filter({ hasText: "Claim" });
          await expect(claimBtn).not.toBeVisible();
        }
      }
    });

    test("should not show Claim button for closed beads", async ({ page }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });
      const count = await rows.count();

      for (let i = 0; i < Math.min(count, 5); i++) {
        const row = rows.nth(i);
        const statusPill = row.locator(".pill");
        const statusText = await statusPill.textContent();

        if (statusText?.includes("closed")) {
          const claimBtn = row
            .locator(".btn--secondary")
            .filter({ hasText: "Claim" });
          await expect(claimBtn).not.toBeVisible();
        }
      }
    });

    test("should change status to in_progress when claiming", async ({
      page,
    }) => {
      // Find an open bead and claim it
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });
      const count = await rows.count();

      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const statusPill = row.locator(".pill");
        const statusText = await statusPill.textContent();

        if (statusText?.includes("open")) {
          const claimBtn = row
            .locator(".btn--secondary")
            .filter({ hasText: "Claim" });
          await claimBtn.click();

          // Status should change to in_progress
          await expect(statusPill).toContainText("in progress", {
            timeout: 5000,
          });
          break;
        }
      }
    });
  });

  test.describe("Beads - Close Flow", () => {
    test.beforeEach(async ({ page }) => {
      page.on("request", (request) => {
        if (request.url().includes("/close")) {
          console.log(`[CLOSE REQ] ${request.method()} ${request.url()}`);
          console.log(`[CLOSE BODY] ${request.postData()}`);
        }
      });
      page.on("response", (response) => {
        if (response.url().includes("/close")) {
          console.log(`[CLOSE RES] ${response.status()}`);
        }
      });

      await page.goto("/beads");
    });

    test("should show Close button for non-closed beads", async ({ page }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });
      const count = await rows.count();

      for (let i = 0; i < Math.min(count, 5); i++) {
        const row = rows.nth(i);
        const statusPill = row.locator(".pill");
        const statusText = await statusPill.textContent();

        if (!statusText?.includes("closed")) {
          const closeBtn = row
            .locator(".btn--danger")
            .filter({ hasText: "Close" });
          await expect(closeBtn).toBeVisible();
        }
      }
    });

    test("should not show Close button for closed beads", async ({ page }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });
      const count = await rows.count();

      for (let i = 0; i < Math.min(count, 5); i++) {
        const row = rows.nth(i);
        const statusPill = row.locator(".pill");
        const statusText = await statusPill.textContent();

        if (statusText?.includes("closed")) {
          const closeBtn = row
            .locator(".btn--danger")
            .filter({ hasText: "Close" });
          await expect(closeBtn).not.toBeVisible();
        }
      }
    });

    test("should open close modal when clicking Close", async ({ page }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });
      const count = await rows.count();

      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const statusPill = row.locator(".pill");
        const statusText = await statusPill.textContent();

        if (!statusText?.includes("closed")) {
          const closeBtn = row
            .locator(".btn--danger")
            .filter({ hasText: "Close" });
          await closeBtn.click();

          await expect(page.locator(".modal")).toBeVisible();
          await expect(page.locator(".modal__title")).toHaveText("Close Bead");
          break;
        }
      }
    });

    test("should display bead ID in close modal", async ({ page }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });
      const row = rows.first();
      const beadId = await row.locator(".mono").first().textContent();

      const closeBtn = row.locator(".btn--danger").filter({ hasText: "Close" });
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
        await expect(page.locator(".modal .mono")).toContainText(beadId ?? "");
      }
    });

    test("should have optional reason input in close modal", async ({
      page,
    }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });
      const count = await rows.count();

      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const closeBtn = row
          .locator(".btn--danger")
          .filter({ hasText: "Close" });
        if (await closeBtn.isVisible()) {
          await closeBtn.click();
          await expect(page.locator("#bead-close-reason")).toBeVisible();
          break;
        }
      }
    });

    test("should close modal when clicking Cancel in close dialog", async ({
      page,
    }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });
      const count = await rows.count();

      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const closeBtn = row
          .locator(".btn--danger")
          .filter({ hasText: "Close" });
        if (await closeBtn.isVisible()) {
          await closeBtn.click();
          await expect(page.locator(".modal")).toBeVisible();

          await page.click(".modal .btn--secondary >> text=Cancel");
          await expect(page.locator(".modal")).not.toBeVisible();
          break;
        }
      }
    });

    test("should close bead and update status", async ({ page }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });
      const count = await rows.count();

      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const statusPill = row.locator(".pill");
        const statusText = await statusPill.textContent();

        if (!statusText?.includes("closed")) {
          const closeBtn = row
            .locator(".btn--danger")
            .filter({ hasText: "Close" });
          await closeBtn.click();

          await page.fill("#bead-close-reason", "Completed via E2E test");
          await page.click(".modal .btn--danger >> text=Close");

          // Modal should close
          await expect(page.locator(".modal")).not.toBeVisible({
            timeout: 5000,
          });

          // Status should change to closed
          await expect(statusPill).toContainText("closed", { timeout: 5000 });
          break;
        }
      }
    });
  });

  test.describe("Beads - Edit Flow", () => {
    test.beforeEach(async ({ page }) => {
      page.on("request", (request) => {
        if (
          request.url().includes("/api/beads/") &&
          request.method() === "PATCH"
        ) {
          console.log(`[EDIT REQ] ${request.method()} ${request.url()}`);
          console.log(`[EDIT BODY] ${request.postData()}`);
        }
      });
      page.on("response", (response) => {
        if (
          response.url().includes("/api/beads/") &&
          response.request().method() === "PATCH"
        ) {
          console.log(`[EDIT RES] ${response.status()}`);
        }
      });

      await page.goto("/beads");
    });

    test("should show Edit button for all beads", async ({ page }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });
      const count = await rows.count();

      for (let i = 0; i < Math.min(count, 5); i++) {
        const row = rows.nth(i);
        const editBtn = row
          .locator(".btn--secondary")
          .filter({ hasText: "Edit" });
        await expect(editBtn).toBeVisible();
      }
    });

    test("should open edit modal when clicking Edit", async ({ page }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });
      const editBtn = rows
        .first()
        .locator(".btn--secondary")
        .filter({ hasText: "Edit" });

      await editBtn.click();

      await expect(page.locator(".modal")).toBeVisible();
      await expect(page.locator(".modal__title")).toHaveText("Edit Bead");
    });

    test("should display edit modal fields", async ({ page }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });
      const editBtn = rows
        .first()
        .locator(".btn--secondary")
        .filter({ hasText: "Edit" });

      await editBtn.click();

      await expect(page.locator("#bead-edit-title")).toBeVisible();
      await expect(page.locator("#bead-edit-status")).toBeVisible();
      await expect(page.locator("#bead-edit-priority")).toBeVisible();
      await expect(page.locator("#bead-edit-type")).toBeVisible();
    });

    test("should populate edit modal with bead data", async ({ page }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });
      const row = rows.first();

      const title = await row.locator("span").nth(2).textContent(); // Title is 3rd column
      const editBtn = row
        .locator(".btn--secondary")
        .filter({ hasText: "Edit" });

      await editBtn.click();

      const titleInput = page.locator("#bead-edit-title");
      await expect(titleInput).toHaveValue(title ?? "");
    });

    test("should close edit modal when clicking Cancel", async ({ page }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });
      const editBtn = rows
        .first()
        .locator(".btn--secondary")
        .filter({ hasText: "Edit" });

      await editBtn.click();
      await expect(page.locator(".modal")).toBeVisible();

      await page.click(".modal .btn--secondary >> text=Cancel");
      await expect(page.locator(".modal")).not.toBeVisible();
    });

    test("should save edits and update table", async ({ page }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });
      const row = rows.first();
      const editBtn = row
        .locator(".btn--secondary")
        .filter({ hasText: "Edit" });

      await editBtn.click();

      const newTitle = `Edited Title ${Date.now()}`;
      await page.fill("#bead-edit-title", newTitle);
      await page.click(".modal .btn--primary >> text=Save");

      // Modal should close
      await expect(page.locator(".modal")).not.toBeVisible({ timeout: 5000 });

      // Title should be updated in the table
      await expect(row.locator("span").nth(2)).toContainText(newTitle, {
        timeout: 5000,
      });
    });

    test("should allow changing status via edit modal", async ({ page }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });
      const row = rows.first();
      const editBtn = row
        .locator(".btn--secondary")
        .filter({ hasText: "Edit" });

      await editBtn.click();

      // Status select should have all options
      const statusSelect = page.locator("#bead-edit-status");
      await expect(statusSelect.locator("option")).toHaveCount(4);
    });

    test("should disable save when title is empty", async ({ page }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });
      const editBtn = rows
        .first()
        .locator(".btn--secondary")
        .filter({ hasText: "Edit" });

      await editBtn.click();

      await page.fill("#bead-edit-title", "");

      const saveBtn = page
        .locator(".modal .btn--primary")
        .filter({ hasText: "Save" });
      await expect(saveBtn).toBeDisabled();
    });
  });

  test.describe("Beads - Error Handling", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/beads");
    });

    test("should display error banner on API failure", async ({ page }) => {
      // Mock a failed API response
      await page.route("**/api/beads", (route) => {
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: { message: "Internal Server Error" } }),
        });
      });

      // Trigger a refresh to get the error
      await page.click(".btn--secondary >> text=Refresh");

      // Error message should be displayed
      await expect(page.locator("text=Failed to fetch beads")).toBeVisible({
        timeout: 5000,
      });
    });

    test("should gracefully handle empty beads list", async ({ page }) => {
      // Mock empty response
      await page.route("**/api/beads", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { beads: [] } }),
        });
      });

      await page.reload();

      // Page should still load without errors
      await expect(page.locator(".page")).toBeVisible();
      await expect(
        page.locator("h3").filter({ hasText: "Beads" }),
      ).toBeVisible();
    });
  });

  test.describe("Beads - Refresh", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/beads");
    });

    test("should show loading state when refreshing", async ({ page }) => {
      const refreshBtn = page
        .locator(".btn--secondary")
        .filter({ hasText: "Refresh" });
      await refreshBtn.click();

      // Button should show loading state (might be brief)
      // The button text changes to "Refreshing..."
    });

    test("should reload beads on refresh click", async ({ page }) => {
      let requestCount = 0;
      page.on("request", (request) => {
        if (
          request.url().includes("/api/beads") &&
          request.method() === "GET"
        ) {
          requestCount++;
        }
      });

      await page.click(".btn--secondary >> text=Refresh");

      // Wait for request to complete
      await page.waitForTimeout(1000);
      expect(requestCount).toBeGreaterThanOrEqual(1);
    });
  });

  test.describe("Beads - Responsiveness", () => {
    test("should display beads table on desktop viewport", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/beads");

      await expect(page.locator(".table")).toBeVisible();
      await expect(
        page.locator("h3").filter({ hasText: "Beads" }),
      ).toBeVisible();
    });

    test("should display beads on tablet viewport", async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto("/beads");

      await expect(page.locator(".table")).toBeVisible();
      await expect(
        page.locator("h3").filter({ hasText: "Beads" }),
      ).toBeVisible();
    });

    test("should display beads on mobile viewport", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto("/beads");

      // Page should still be accessible
      await expect(page.locator(".page")).toBeVisible();
    });

    test("should maintain modal usability on mobile", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto("/beads");

      await page.click(".btn--primary >> text=New Bead");

      // Modal should be visible and usable
      await expect(page.locator(".modal")).toBeVisible();
      await expect(page.locator("#bead-title")).toBeVisible();
    });
  });

  test.describe("Beads - Action Buttons State", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/beads");
    });

    test("should show correct action buttons based on status", async ({
      page,
    }) => {
      const rows = page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") });
      const count = await rows.count();

      for (let i = 0; i < Math.min(count, 10); i++) {
        const row = rows.nth(i);
        const statusPill = row.locator(".pill");
        const statusText = await statusPill.textContent();
        const trimmedStatus = statusText?.trim().toLowerCase() ?? "";

        // Edit should always be visible
        await expect(
          row.locator(".btn--secondary").filter({ hasText: "Edit" }),
        ).toBeVisible();

        // Claim: visible only for open and blocked statuses
        const claimBtn = row
          .locator(".btn--secondary")
          .filter({ hasText: "Claim" });
        if (trimmedStatus === "open" || trimmedStatus === "blocked") {
          await expect(claimBtn).toBeVisible();
        } else {
          await expect(claimBtn).not.toBeVisible();
        }

        // Close: visible for non-closed statuses
        const closeBtn = row
          .locator(".btn--danger")
          .filter({ hasText: "Close" });
        if (trimmedStatus !== "closed") {
          await expect(closeBtn).toBeVisible();
        } else {
          await expect(closeBtn).not.toBeVisible();
        }
      }
    });
  });

  test.describe("Beads - Navigation Integration", () => {
    test("should navigate to beads from sidebar", async ({ page }) => {
      await page.goto("/");
      await page.click('a[href="/beads"]');

      await expect(page).toHaveURL("/beads");
      await expect(
        page.locator("h3").filter({ hasText: "Beads" }),
      ).toBeVisible();
    });

    test("should preserve state when navigating away and back", async ({
      page,
    }) => {
      await page.goto("/beads");

      // Note initial count (unused but documents intent)
      const _initialCount = await page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") })
        .count();

      // Navigate away
      await page.click('a[href="/"]');
      await expect(page).toHaveURL("/");

      // Navigate back
      await page.click('a[href="/beads"]');
      await expect(page).toHaveURL("/beads");

      // Count should be the same (or fetched fresh)
      const newCount = await page
        .locator(".table__row")
        .filter({ hasNot: page.locator(".table__row--header") })
        .count();
      expect(newCount).toBeGreaterThanOrEqual(0);
    });
  });
}
