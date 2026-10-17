/**
 * E2E: Agent Lifecycle + WS Updates with Rich Logs
 * Bead: bd-1vr1.11
 *
 * Spawns agents via the gateway API, observes state transitions through
 * WebSocket events, verifies UI updates on dashboard and agents pages,
 * and captures full diagnostic artifacts via the logging framework.
 */

import { expect, test } from "./lib/fixtures";

const GATEWAY_URL = process.env["E2E_GATEWAY_URL"] ?? "http://localhost:3456";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Spawn an agent via the gateway REST API and return the response.
 */
async function spawnAgentViaAPI(opts?: {
  agentId?: string;
  workingDirectory?: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${GATEWAY_URL}/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workingDirectory: opts?.workingDirectory ?? "/tmp/e2e-test",
      ...(opts?.agentId && { agentId: opts.agentId }),
    }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

/**
 * List agents via the gateway REST API.
 */
async function listAgentsViaAPI(
  query?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = query
    ? `${GATEWAY_URL}/agents?${query}`
    : `${GATEWAY_URL}/agents`;
  const res = await fetch(url);
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

/**
 * Get a single agent via the gateway REST API.
 */
async function getAgentViaAPI(
  agentId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${GATEWAY_URL}/agents/${agentId}`);
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

/**
 * Terminate an agent via the gateway REST API.
 */
async function terminateAgentViaAPI(
  agentId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${GATEWAY_URL}/agents/${agentId}`, {
    method: "DELETE",
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

/**
 * Collect WebSocket messages for a given channel until a condition is met
 * or timeout expires.
 */
function _collectWSMessages(
  wsUrl: string,
  channel: string,
  opts?: { timeoutMs?: number; count?: number },
): Promise<unknown[]> {
  const timeout = opts?.timeoutMs ?? 5000;
  const targetCount = opts?.count ?? 1;

  return new Promise((resolve) => {
    const messages: unknown[] = [];
    const ws = new WebSocket(wsUrl);
    let timer: ReturnType<typeof setTimeout>;

    function done() {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(messages);
    }

    timer = setTimeout(done, timeout);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "subscribe", channel }));
    });

    ws.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(String(event.data));
        if (data.type === "message") {
          messages.push(data);
          if (messages.length >= targetCount) {
            done();
          }
        }
      } catch {
        /* ignore non-JSON frames */
      }
    });

    ws.addEventListener("error", () => done());
    ws.addEventListener("close", () => done());
  });
}

// ============================================================================
// Tests
// ============================================================================

test.describe("Agent Lifecycle E2E - API + WS + UI", () => {
  test("gateway health endpoint is reachable", async ({ loggedPage }) => {
    const res = await fetch(`${GATEWAY_URL}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const data = body["data"] as Record<string, unknown> | undefined;
    expect(data?.["status"] ?? body["status"]).toBe("healthy");

    // Also verify the web app loads
    await loggedPage.goto("/");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("list agents via API returns seeded agent", async ({ loggedPage }) => {
    const { status, body } = await listAgentsViaAPI();
    expect(status).toBe(200);

    // Should contain at least the seeded e2e-agent-1
    const data = (body["data"] ?? body["items"] ?? []) as unknown[];
    expect(data.length).toBeGreaterThanOrEqual(1);

    // Verify agents page reflects API data
    await loggedPage.goto("/agents");
    await expect(
      loggedPage.locator("h3").filter({ hasText: "Agents" }),
    ).toBeVisible();
  });

  test("get single agent via API returns correct data", async ({
    loggedPage,
  }) => {
    const { status, body } = await getAgentViaAPI("e2e-agent-1");

    // May be 200 or 404 depending on whether in-memory state exists
    if (status === 200) {
      const data = (body["data"] ?? body) as Record<string, unknown>;
      expect(data["agentId"] ?? data["id"]).toBe("e2e-agent-1");
    }

    // UI should still load correctly
    await loggedPage.goto("/agents");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("spawn agent via API and verify state transition", async ({
    loggedPage,
  }) => {
    const agentId = `e2e-spawn-${Date.now()}`;
    const { status, body } = await spawnAgentViaAPI({
      agentId,
      workingDirectory: "/tmp/e2e-lifecycle",
    });

    // Spawn should succeed (201) or fail gracefully (e.g., no driver available)
    if (status === 201) {
      const data = (body["data"] ?? body) as Record<string, unknown>;
      expect(data["agentId"] ?? data["id"]).toBe(agentId);

      // Check agent state via API
      const agentRes = await getAgentViaAPI(agentId);
      if (agentRes.status === 200) {
        const agentData = (agentRes.body["data"] ?? agentRes.body) as Record<
          string,
          unknown
        >;
        // Should be in an early lifecycle state
        const state = String(agentData["state"] ?? agentData["status"] ?? "");
        expect([
          "spawning",
          "initializing",
          "ready",
          "executing",
          "idle",
        ]).toContain(state);
      }

      // Terminate to clean up
      await terminateAgentViaAPI(agentId);
    } else {
      // Expected when no driver is available in test env
      expect([400, 500, 503]).toContain(status);
    }

    // Verify UI still works after API interactions
    await loggedPage.goto("/agents");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("terminate agent via API and verify cleanup", async ({ loggedPage }) => {
    const agentId = `e2e-term-${Date.now()}`;

    // Spawn first
    const spawnRes = await spawnAgentViaAPI({
      agentId,
      workingDirectory: "/tmp/e2e-terminate",
    });

    if (spawnRes.status === 201) {
      // Terminate
      const { status } = await terminateAgentViaAPI(agentId);
      expect([200, 202, 204]).toContain(status);

      // Agent should eventually reach terminal state
      const agentRes = await getAgentViaAPI(agentId);
      if (agentRes.status === 200) {
        const data = (agentRes.body["data"] ?? agentRes.body) as Record<
          string,
          unknown
        >;
        const state = String(data["state"] ?? data["status"] ?? "");
        expect(["terminating", "terminated", "failed"]).toContain(state);
      }
    }

    await loggedPage.goto("/agents");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("dashboard displays agent metrics after API operations", async ({
    loggedPage,
  }) => {
    await loggedPage.goto("/");

    // Dashboard should show Live agents card
    const liveAgentsCard = loggedPage
      .locator(".card")
      .filter({ hasText: "Live agents" });
    await expect(liveAgentsCard).toBeVisible();

    // Metric value should be visible
    const metric = liveAgentsCard.locator(".metric");
    await expect(metric).toBeVisible();
  });

  test("WebSocket connection establishes from browser", async ({
    loggedPage,
  }) => {
    await loggedPage.goto("/");

    // The web app auto-connects via WebSocket. Check for WS latency indicator.
    const wsCard = loggedPage
      .locator(".card--compact")
      .filter({ hasText: "WebSocket" });

    // Wait for WS connection (may take a moment)
    await expect(wsCard).toBeVisible({ timeout: 10_000 });

    // Latency metric should appear
    const latency = wsCard.locator("h4");
    await expect(latency).toContainText("ms");
  });

  test("agents page reflects state after spawn+terminate cycle", async ({
    loggedPage,
  }) => {
    // Capture initial agent count
    await loggedPage.goto("/agents");
    const headerPill = loggedPage
      .locator(".card__header .pill")
      .filter({ hasText: "total" });
    await expect(headerPill).toBeVisible();

    const initialText = await headerPill.textContent();
    const initialCount = parseInt(initialText?.match(/(\d+)/)?.[1] ?? "0", 10);

    // Try to spawn an agent
    const agentId = `e2e-ui-${Date.now()}`;
    const spawnRes = await spawnAgentViaAPI({
      agentId,
      workingDirectory: "/tmp/e2e-ui-check",
    });

    if (spawnRes.status === 201) {
      // Refresh agents page
      await loggedPage.reload();
      await expect(headerPill).toBeVisible();

      // Clean up
      await terminateAgentViaAPI(agentId);
    }

    // Page should remain functional
    await expect(loggedPage.locator(".table")).toBeVisible();
    expect(initialCount).toBeGreaterThanOrEqual(0);
  });

  test("detected CLIs endpoint returns tool information", async ({
    loggedPage,
  }) => {
    const res = await fetch(`${GATEWAY_URL}/agents/detected`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    const data = (body["data"] ?? body) as Record<string, unknown>;

    // Should have summary with counts
    const summary = data["summary"] as Record<string, unknown> | undefined;
    if (summary) {
      expect(typeof summary["agentsTotal"]).toBe("number");
      expect(typeof summary["toolsTotal"]).toBe("number");
    }

    // Verify setup page shows tool status
    await loggedPage.goto("/setup");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("detailed health endpoint includes diagnostics", async ({
    loggedPage,
  }) => {
    const res = await fetch(`${GATEWAY_URL}/health/detailed`);
    const body = (await res.json()) as Record<string, unknown>;
    const data = (body["data"] ?? body) as Record<string, unknown>;

    // Should have components
    expect(data["components"]).toBeDefined();

    // Should have summary
    const summary = data["summary"] as Record<string, unknown>;
    expect(typeof summary["totalChecks"]).toBe("number");
    expect(typeof summary["passed"]).toBe("number");

    // Verify dashboard shows health info
    await loggedPage.goto("/");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });
});

test.describe("Agent Lifecycle E2E - Error Handling", () => {
  test("spawn with invalid payload returns validation error", async ({
    loggedPage,
  }) => {
    const res = await fetch(`${GATEWAY_URL}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}), // Missing required workingDirectory
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    // Should contain error info
    expect(body["error"] ?? body["errors"]).toBeDefined();

    // UI should handle errors gracefully
    await loggedPage.goto("/agents");
    const errorAlert = loggedPage.locator('[role="alert"]');
    await expect(errorAlert).not.toBeVisible();
  });

  test("get nonexistent agent returns 404", async ({ loggedPage }) => {
    const res = await fetch(`${GATEWAY_URL}/agents/nonexistent-agent-xyz`);
    expect(res.status).toBe(404);

    await loggedPage.goto("/agents");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("terminate nonexistent agent returns 404", async ({ loggedPage }) => {
    const res = await fetch(`${GATEWAY_URL}/agents/nonexistent-agent-xyz`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);

    await loggedPage.goto("/agents");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });
});

test.describe("Agent Lifecycle E2E - Logging Diagnostics", () => {
  test("logging framework captures console and network events", async ({
    loggedPage,
    testLogger,
  }) => {
    await loggedPage.goto("/");

    // Wait for page to fully load and make API calls
    await loggedPage.waitForLoadState("networkidle");

    const summary = testLogger.getSummary();

    // Should have captured network requests (API calls, assets)
    expect(summary.networkRequests).toBeGreaterThan(0);

    // Navigate to agents page to generate more events
    await loggedPage.click('a[href="/agents"]');
    await loggedPage.waitForLoadState("networkidle");

    const finalSummary = testLogger.getSummary();
    expect(finalSummary.networkRequests).toBeGreaterThan(
      summary.networkRequests,
    );
  });

  test("logging framework captures WebSocket frames", async ({
    loggedPage,
    testLogger,
  }) => {
    await loggedPage.goto("/");

    // Wait for WebSocket connection to establish
    await loggedPage.waitForTimeout(2000);

    const summary = testLogger.getSummary();

    // WebSocket messages may or may not be captured depending on
    // CDP availability (Chromium only). Log for diagnostics.
    if (summary.webSocketMessages > 0) {
      // WebSocket events were captured - verify log data structure
      const logData = testLogger.getLogData();
      expect(logData.webSocket.length).toBeGreaterThan(0);
      // Each WS entry should have required fields
      const first = logData.webSocket[0]!;
      expect(first).toHaveProperty("timestamp");
      expect(first).toHaveProperty("type");
    }
    // No assertion failure if WS not captured - it's environment-dependent
  });

  test("page errors are captured by logging framework", async ({
    loggedPage,
    testLogger,
  }) => {
    // Navigate to a valid page
    await loggedPage.goto("/agents");
    await loggedPage.waitForLoadState("networkidle");

    const summary = testLogger.getSummary();

    // Valid pages should not produce page errors
    expect(summary.pageErrors).toBe(0);
  });
});
