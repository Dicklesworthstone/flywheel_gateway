/**
 * Playwright E2E test configuration for Flywheel Web UI.
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Use a suffix that Bun test won't pick up when running `bun test apps/...`.
  // Playwright still discovers these via this explicit testMatch.
  testMatch: "**/*.e2e.ts",
  outputDir: "./e2e-results",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  ...(process.env["CI"] ? { workers: 1 } : {}),
  reporter: [["list"], ["html", { outputFolder: "e2e-report" }]],

  use: {
    baseURL: process.env["E2E_BASE_URL"] || "http://localhost:5173",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  ...(process.env["E2E_NO_SERVER"]
    ? {}
    : {
        webServer: {
          command: "bun run dev",
          url: "http://localhost:5173",
          reuseExistingServer: !process.env["CI"],
          timeout: 30000,
        },
      }),
});
