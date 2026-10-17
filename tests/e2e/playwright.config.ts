import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

process.env["PLAYWRIGHT_TEST"] = "1";

async function pickAvailablePort(preferredPort: number): Promise<number> {
  const tryListen = (port: number) =>
    new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.unref();
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        const resolvedPort =
          typeof address === "object" && address ? address.port : port;
        server.close(() => resolve(resolvedPort));
      });
    });

  try {
    return await tryListen(preferredPort);
  } catch {
    // Fall back to an ephemeral port (0) if the preferred port is taken.
    return await tryListen(0);
  }
}

const gatewayAdminKey = process.env["E2E_GATEWAY_ADMIN_KEY"] ?? "e2e-admin-key";
const gatewayPort = await pickAvailablePort(
  Number(process.env["E2E_GATEWAY_PORT"] ?? 3456),
);
const gatewayTarget = `http://127.0.0.1:${gatewayPort}`;
const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/**
 * Playwright configuration with enhanced logging and diagnostics.
 * Part of bd-1vr1.5: Playwright logging + diagnostics framework
 *
 * Features:
 * - Structured JSON logs per test (in tests/e2e/logs/)
 * - Browser console, network, WebSocket capture
 * - Trace/video/screenshot artifacts on failure
 * - Run summaries with pass/fail statistics
 *
 * Environment variables:
 * - E2E_BASE_URL: Override base URL (default: http://localhost:5173)
 * - E2E_VERBOSE: Set to "1" for verbose logging output
 * - CI: Set by CI systems, enables retries
 */
export default defineConfig({
  testDir: "./",
  timeout: 30_000,
  retries: process.env["CI"] ? 2 : 0,

  // Enhanced reporting with structured JSON logs
  reporter: [
    ["list", { printSteps: true }],
    ["html", { open: "never", outputFolder: "report" }],
    [
      "./lib/reporter.ts",
      {
        outputDir: "logs",
        includeConsole: true,
        includeNetwork: true,
        includeWebSocket: true,
        verbose: process.env["E2E_VERBOSE"] === "1",
      },
    ],
  ],

  // Global settings
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "http://localhost:5173",

    // Artifact collection for debugging
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",

    // Additional capture options
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  // Output directories
  outputDir: "results",

  // Parallel execution
  fullyParallel: true,
  workers: process.env["CI"] ? 2 : undefined,

  // Browser projects
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Chromium gets full CDP-based logging
        launchOptions: {
          args: ["--enable-logging"],
        },
      },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],

  // Web server configuration — boots E2E gateway with seeded temp DB
  webServer: [
    {
      command: "bun scripts/e2e-server.ts",
      url: `http://localhost:${gatewayPort}/health`,
      cwd: repoRoot,
      reuseExistingServer: !process.env["CI"],
      timeout: 30_000,
      env: {
        E2E_GATEWAY_PORT: String(gatewayPort),
        E2E_GATEWAY_ADMIN_KEY: gatewayAdminKey,
      },
    },
    {
      command: "bun run dev:web",
      url: "http://localhost:5173",
      cwd: repoRoot,
      reuseExistingServer: !process.env["CI"],
      timeout: 30_000,
      env: {
        VITE_GATEWAY_TARGET: gatewayTarget,
        VITE_GATEWAY_TOKEN: gatewayAdminKey,
      },
    },
  ],
});
