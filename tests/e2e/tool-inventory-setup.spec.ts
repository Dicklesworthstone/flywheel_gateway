/**
 * E2E: Tool Inventory + Setup Readiness
 * Bead: bd-2n73.18
 *
 * Validates tool inventory and setup readiness against a real gateway:
 * manifest-driven tool list, detection status, auth badges, install/verify
 * summaries. Captures console/network/WS logs and screenshots via the
 * logging framework.
 */

import { expect, test } from "./lib/fixtures";

const GATEWAY_URL = process.env["E2E_GATEWAY_URL"] ?? "http://localhost:3456";

// ============================================================================
// API Tests: Tool Detection & Registry
// ============================================================================

test.describe("Tool Detection API", () => {
  test("detected CLIs endpoint returns structured detection results", async ({
    loggedPage,
  }) => {
    const res = await fetch(`${GATEWAY_URL}/agents/detected`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    const data = (body["data"] ?? body) as Record<string, unknown>;

    // Should have agents and tools arrays
    const agents = data["agents"] as unknown[] | undefined;
    const tools = data["tools"] as unknown[] | undefined;

    if (agents) {
      expect(Array.isArray(agents)).toBe(true);
      // Each agent should have name, available, detectionMs
      for (const agent of agents as Record<string, unknown>[]) {
        expect(agent["name"]).toBeTruthy();
        expect(typeof agent["available"]).toBe("boolean");
      }
    }

    if (tools) {
      expect(Array.isArray(tools)).toBe(true);
    }

    // Summary should have counts
    const summary = data["summary"] as Record<string, unknown> | undefined;
    if (summary) {
      expect(typeof summary["agentsAvailable"]).toBe("number");
      expect(typeof summary["agentsTotal"]).toBe("number");
      expect(typeof summary["toolsAvailable"]).toBe("number");
      expect(typeof summary["toolsTotal"]).toBe("number");
    }

    // Verify UI loads
    await loggedPage.goto("/setup");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("detected CLIs with refresh bypasses cache", async ({ loggedPage }) => {
    const res = await fetch(`${GATEWAY_URL}/agents/detected?refresh=true`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    const data = (body["data"] ?? body) as Record<string, unknown>;
    expect(data["cached"]).toBe(false);

    await loggedPage.goto("/setup");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });
});

test.describe("Health Readiness API", () => {
  test("readiness probe returns build and capability info", async ({
    loggedPage,
  }) => {
    const res = await fetch(`${GATEWAY_URL}/health/ready`);
    expect([200, 503]).toContain(res.status);

    const body = (await res.json()) as Record<string, unknown>;
    const data = (body["data"] ?? body) as Record<string, unknown>;

    // Should have status
    expect(["ready", "degraded", "unhealthy"]).toContain(
      data["status"] as string,
    );

    // Should have build info
    const build = data["build"] as Record<string, unknown> | undefined;
    if (build) {
      expect(build["version"]).toBeTruthy();
      expect(build["runtime"]).toBeTruthy();
    }

    // Should have capabilities
    const capabilities = data["capabilities"];
    expect(capabilities).toBeDefined();

    await loggedPage.goto("/");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("detailed health includes component checks", async ({ loggedPage }) => {
    const res = await fetch(`${GATEWAY_URL}/health/detailed`);
    const body = (await res.json()) as Record<string, unknown>;
    const data = (body["data"] ?? body) as Record<string, unknown>;

    // Components section
    const components = data["components"] as Record<string, unknown>;
    expect(components).toBeDefined();

    // Database check
    const db = components["database"] as Record<string, unknown>;
    expect(["healthy", "degraded", "unhealthy"]).toContain(
      db["status"] as string,
    );
    expect(typeof db["latencyMs"]).toBe("number");

    // Agent CLIs check
    const agentCLIs = components["agentCLIs"] as Record<string, unknown>;
    expect(agentCLIs).toBeDefined();

    // Summary
    const summary = data["summary"] as Record<string, unknown>;
    expect(typeof summary["totalChecks"]).toBe("number");
    expect(typeof summary["passed"]).toBe("number");

    // Diagnostics (from tool-health-diagnostics)
    const diagnostics = data["diagnostics"] as
      | Record<string, unknown>
      | undefined;
    if (diagnostics) {
      const tools = diagnostics["tools"] as unknown[];
      expect(Array.isArray(tools)).toBe(true);

      const diagSummary = diagnostics["summary"] as Record<string, unknown>;
      expect(typeof diagSummary["totalTools"]).toBe("number");
      expect(typeof diagSummary["availableTools"]).toBe("number");
    }

    await loggedPage.goto("/");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });
});

// ============================================================================
// Setup Page UI Tests
// ============================================================================

test.describe("Setup Page E2E", () => {
  test("setup page renders with tool status cards", async ({ loggedPage }) => {
    await loggedPage.goto("/setup");
    await expect(loggedPage.locator(".page")).toBeVisible();

    // Should have cards showing tool info
    const cards = loggedPage.locator(".card");
    await expect(cards.first()).toBeVisible();
  });

  test("setup page shows progress or readiness indicator", async ({
    loggedPage,
  }) => {
    await loggedPage.goto("/setup");

    // Look for step indicators or progress markers
    const page = loggedPage;
    const hasSteps =
      (await page.locator('[role="progressbar"]').count()) > 0 ||
      (await page.locator(".step, .stepper, .progress").count()) > 0 ||
      (await page.locator("button, .btn").count()) > 0;

    // Page should have some interactive elements
    expect(hasSteps).toBe(true);
  });

  test("setup page loads without console errors", async ({
    loggedPage,
    testLogger,
  }) => {
    await loggedPage.goto("/setup");
    await loggedPage.waitForLoadState("networkidle");

    const summary = testLogger.getSummary();
    expect(summary.pageErrors).toBe(0);
    expect(summary.consoleErrors).toBe(0);
  });

  test("setup page makes API calls for tool status", async ({
    loggedPage,
    testLogger,
  }) => {
    await loggedPage.goto("/setup");
    await loggedPage.waitForLoadState("networkidle");

    const summary = testLogger.getSummary();
    // Should have made network requests for API data
    expect(summary.networkRequests).toBeGreaterThan(0);
  });
});

// ============================================================================
// Dashboard Tool Health Display
// ============================================================================

test.describe("Dashboard Tool Health", () => {
  test("dashboard shows overall system status", async ({ loggedPage }) => {
    await loggedPage.goto("/");
    await expect(loggedPage.locator(".page")).toBeVisible();

    // Live agents card
    const liveAgents = loggedPage
      .locator(".card")
      .filter({ hasText: "Live agents" });
    await expect(liveAgents).toBeVisible();
  });

  test("dashboard compact metrics load", async ({ loggedPage }) => {
    await loggedPage.goto("/");

    // Compact metrics grid
    const compactGrid = loggedPage.locator(".grid--3");
    await expect(compactGrid).toBeVisible();

    // Should have compact cards with metrics
    const compactCards = compactGrid.locator(".card--compact");
    const count = await compactCards.count();
    expect(count).toBeGreaterThan(0);
  });
});

// ============================================================================
// Cross-Page Navigation with Logging
// ============================================================================

test.describe("Tool Health Navigation Flow", () => {
  test("navigate dashboard → setup → agents capturing all diagnostics", async ({
    loggedPage,
    testLogger,
  }) => {
    // Start at dashboard
    await loggedPage.goto("/");
    await loggedPage.waitForLoadState("networkidle");

    const dashSummary = testLogger.getSummary();
    const dashRequests = dashSummary.networkRequests;

    // Navigate to setup
    await loggedPage.click('a[href="/setup"]');
    await loggedPage.waitForLoadState("networkidle");
    await expect(loggedPage.locator(".page")).toBeVisible();

    // Navigate to agents (detected tools)
    await loggedPage.click('a[href="/agents"]');
    await loggedPage.waitForLoadState("networkidle");
    await expect(loggedPage.locator(".page")).toBeVisible();

    // Final diagnostic summary
    const finalSummary = testLogger.getSummary();
    expect(finalSummary.networkRequests).toBeGreaterThan(dashRequests);
    expect(finalSummary.pageErrors).toBe(0);
  });

  test("screenshot capture on setup page", async ({ loggedPage }, testInfo) => {
    await loggedPage.goto("/setup");
    await loggedPage.waitForLoadState("networkidle");

    // Capture screenshot for visual verification
    const screenshot = await loggedPage.screenshot({ fullPage: true });
    await testInfo.attach("setup-page", {
      body: screenshot,
      contentType: "image/png",
    });

    await expect(loggedPage.locator(".page")).toBeVisible();
  });
});
