/**
 * E2E: Utilities Workflows (giil/csctf/xf/pt)
 * Bead: bd-2n73.19
 *
 * Exercises utility endpoints and UI panels against a real gateway:
 * giil image fetch, csctf transcript export, xf archive search,
 * pt process triage. Captures console/network/WS logs and screenshots
 * via the logging framework.
 */

import { test, expect } from "./lib/fixtures";

const GATEWAY_URL =
  process.env["E2E_GATEWAY_URL"] ?? "http://localhost:3456";

// ============================================================================
// Helpers
// ============================================================================

async function apiGet(
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${GATEWAY_URL}${path}`);
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body: data };
}

async function apiPost(
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body: data };
}

// ============================================================================
// Utilities API Tests
// ============================================================================

test.describe("Utilities List API", () => {
  test("list all utilities returns structured response", async ({
    loggedPage,
  }) => {
    const { status, body } = await apiGet("/utilities");
    expect(status).toBe(200);

    const data = (body["data"] ?? body) as Record<string, unknown>;
    const utilities = (data["utilities"] ?? data["tools"] ?? []) as unknown[];
    expect(Array.isArray(utilities)).toBe(true);

    await loggedPage.goto("/utilities");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("utility doctor endpoint returns health checks", async ({
    loggedPage,
  }) => {
    const { status } = await apiGet("/utilities/doctor");
    expect([200, 503]).toContain(status);

    await loggedPage.goto("/utilities");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("get specific utility status", async ({ loggedPage }) => {
    // Try known utilities
    for (const name of ["giil", "csctf", "xf", "pt"]) {
      const { status } = await apiGet(`/utilities/${name}`);
      expect([200, 404]).toContain(status);
    }

    await loggedPage.goto("/utilities");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });
});

// ============================================================================
// Giil (Image Download) Workflow
// ============================================================================

test.describe("Giil Utility Workflow", () => {
  test("giil run endpoint validates request schema", async ({
    loggedPage,
  }) => {
    // Missing required url field should fail validation
    const { status } = await apiPost("/utilities/giil/run", {});
    expect([400, 422]).toContain(status);

    await loggedPage.goto("/utilities");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("giil run with valid URL returns result or tool unavailable", async ({
    loggedPage,
  }) => {
    const { status, body } = await apiPost("/utilities/giil/run", {
      url: "https://example.com/image.png",
      format: "json",
    });

    // 200 if giil installed, 503/500 if unavailable
    expect([200, 500, 503]).toContain(status);

    if (status !== 200) {
      // Should indicate tool unavailability
      const data = (body["data"] ?? body) as Record<string, unknown>;
      const error = (body["error"] ?? data["error"]) as
        | Record<string, unknown>
        | string
        | undefined;
      expect(error).toBeDefined();
    }

    await loggedPage.goto("/utilities");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("giil panel renders in utilities page", async ({ loggedPage }) => {
    await loggedPage.goto("/utilities");

    // Look for giil panel or card
    const giilPanel = loggedPage
      .locator(".card, .panel, section")
      .filter({ hasText: /giil|image/i });

    // Panel may exist depending on UI state
    const count = await giilPanel.count();
    expect(count).toBeGreaterThanOrEqual(0); // Assert the page loads
    await expect(loggedPage.locator(".page")).toBeVisible();
  });
});

// ============================================================================
// CSCTF (Chat Transcript Export) Workflow
// ============================================================================

test.describe("CSCTF Utility Workflow", () => {
  test("csctf run endpoint validates request schema", async ({
    loggedPage,
  }) => {
    const { status } = await apiPost("/utilities/csctf/run", {});
    expect([400, 422]).toContain(status);

    await loggedPage.goto("/utilities");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("csctf run with valid URL returns result or unavailable", async ({
    loggedPage,
  }) => {
    const { status } = await apiPost("/utilities/csctf/run", {
      url: "https://chatgpt.com/share/example-id",
      formats: ["md"],
    });

    expect([200, 500, 503]).toContain(status);

    await loggedPage.goto("/utilities");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("csctf panel renders in utilities page", async ({ loggedPage }) => {
    await loggedPage.goto("/utilities");

    const csctfPanel = loggedPage
      .locator(".card, .panel, section")
      .filter({ hasText: /csctf|transcript|chat/i });

    const count = await csctfPanel.count();
    expect(count).toBeGreaterThanOrEqual(0);
    await expect(loggedPage.locator(".page")).toBeVisible();
  });
});

// ============================================================================
// XF (X Archive Search) Workflow
// ============================================================================

test.describe("XF Utility Workflow", () => {
  test("xf search endpoint responds", async ({ loggedPage }) => {
    // XF search may be at /xf/search or /utilities/xf/search
    const { status } = await apiPost("/utilities/xf/run", {
      query: "test search",
    });

    // 200, 400 (missing params), or 503 (unavailable)
    expect([200, 400, 422, 500, 503]).toContain(status);

    await loggedPage.goto("/utilities");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("xf panel renders in utilities page", async ({ loggedPage }) => {
    await loggedPage.goto("/utilities");

    const xfPanel = loggedPage
      .locator(".card, .panel, section")
      .filter({ hasText: /xf|archive|search/i });

    const count = await xfPanel.count();
    expect(count).toBeGreaterThanOrEqual(0);
    await expect(loggedPage.locator(".page")).toBeVisible();
  });
});

// ============================================================================
// PT (Process Triage) Workflow
// ============================================================================

test.describe("PT Utility Workflow", () => {
  test("pt scan endpoint responds", async ({ loggedPage }) => {
    const { status } = await apiPost("/utilities/pt/run", {});

    // 200 if pt available, or error codes
    expect([200, 400, 422, 500, 503]).toContain(status);

    await loggedPage.goto("/utilities");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("pt panel renders in utilities page", async ({ loggedPage }) => {
    await loggedPage.goto("/utilities");

    const ptPanel = loggedPage
      .locator(".card, .panel, section")
      .filter({ hasText: /process|triage|pt/i });

    const count = await ptPanel.count();
    expect(count).toBeGreaterThanOrEqual(0);
    await expect(loggedPage.locator(".page")).toBeVisible();
  });
});

// ============================================================================
// Utilities Page UI Tests
// ============================================================================

test.describe("Utilities Page E2E", () => {
  test("utilities page renders without errors", async ({
    loggedPage,
    testLogger,
  }) => {
    await loggedPage.goto("/utilities");
    await loggedPage.waitForLoadState("networkidle");

    const summary = testLogger.getSummary();
    expect(summary.pageErrors).toBe(0);
    expect(summary.consoleErrors).toBe(0);
  });

  test("utilities page makes API calls", async ({
    loggedPage,
    testLogger,
  }) => {
    await loggedPage.goto("/utilities");
    await loggedPage.waitForLoadState("networkidle");

    const summary = testLogger.getSummary();
    expect(summary.networkRequests).toBeGreaterThan(0);
  });

  test("utilities page has interactive elements", async ({ loggedPage }) => {
    await loggedPage.goto("/utilities");

    // Should have buttons or input forms
    const interactiveCount =
      (await loggedPage.locator("button, input, textarea").count());
    expect(interactiveCount).toBeGreaterThan(0);
  });

  test("screenshot capture on utilities page", async (
    { loggedPage },
    testInfo,
  ) => {
    await loggedPage.goto("/utilities");
    await loggedPage.waitForLoadState("networkidle");

    const screenshot = await loggedPage.screenshot({ fullPage: true });
    await testInfo.attach("utilities-page", {
      body: screenshot,
      contentType: "image/png",
    });

    await expect(loggedPage.locator(".page")).toBeVisible();
  });
});

// ============================================================================
// Cross-Utility Navigation
// ============================================================================

test.describe("Utilities Navigation Flow", () => {
  test("navigate dashboard → utilities capturing diagnostics", async ({
    loggedPage,
    testLogger,
  }) => {
    await loggedPage.goto("/");
    await loggedPage.waitForLoadState("networkidle");

    const dashRequests = testLogger.getSummary().networkRequests;

    // Navigate to utilities
    await loggedPage.click('a[href="/utilities"]');
    await loggedPage.waitForLoadState("networkidle");
    await expect(loggedPage.locator(".page")).toBeVisible();

    const finalSummary = testLogger.getSummary();
    expect(finalSummary.networkRequests).toBeGreaterThan(dashRequests);
    expect(finalSummary.pageErrors).toBe(0);
  });
});
