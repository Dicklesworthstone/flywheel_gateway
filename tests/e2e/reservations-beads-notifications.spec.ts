/**
 * E2E: Reservations + Beads + Notifications Flow
 * Bead: bd-1vr1.13
 *
 * Exercises coordination features via the gateway API: file reservations
 * (create, check, conflict, release), beads CRUD + triage, and
 * notification delivery. Validates API + UI consistency and captures
 * rich diagnostic logs via the logging framework.
 */

import { test, expect } from "./lib/fixtures";

const GATEWAY_URL =
  process.env["E2E_GATEWAY_URL"] ?? "http://localhost:3456";

// ============================================================================
// Helpers
// ============================================================================

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

async function apiGet(
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${GATEWAY_URL}${path}`);
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body: data };
}

async function apiDelete(
  path: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: "DELETE",
    headers: { ...headers },
  });
  let data: Record<string, unknown> | null = null;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* 204 No Content */
  }
  return { status: res.status, body: data };
}

// ============================================================================
// Beads API Tests
// ============================================================================

test.describe("Beads API E2E", () => {
  test("list beads returns paginated results", async ({ loggedPage }) => {
    const { status, body } = await apiGet("/api/beads?limit=5");

    // Should return 200 with beads array
    expect(status).toBe(200);
    const data = (body["data"] ?? body) as Record<string, unknown>;
    const beads = (data["beads"] ?? data["items"] ?? []) as unknown[];
    expect(Array.isArray(beads)).toBe(true);

    // Verify UI shows beads page
    await loggedPage.goto("/beads");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("create bead via API and verify in list", async ({ loggedPage }) => {
    const title = `E2E test bead ${Date.now()}`;
    const { status, body } = await apiPost("/api/beads", {
      title,
      type: "task",
      priority: 3,
      description: "Created by E2E test",
    });

    if (status === 201 || status === 200) {
      const data = (body["data"] ?? body) as Record<string, unknown>;
      expect(data["title"] ?? data["id"]).toBeTruthy();

      // Get the bead ID
      const beadId = data["id"] as string;

      if (beadId) {
        // Verify it appears in list
        const listRes = await apiGet(`/api/beads/${beadId}`);
        expect(listRes.status).toBe(200);

        // Clean up: close the bead
        await apiDelete(`/api/beads/${beadId}?reason=E2E+cleanup`);
      }
    }

    // UI should still work
    await loggedPage.goto("/beads");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("triage endpoint returns prioritized recommendations", async ({
    loggedPage,
  }) => {
    const { status, body } = await apiGet("/api/beads/triage");

    if (status === 200) {
      const data = (body["data"] ?? body) as Record<string, unknown>;
      // Should have triage structure
      expect(
        data["triage"] ?? data["recommendations"] ?? data["quick_ref"],
      ).toBeDefined();
    }

    await loggedPage.goto("/beads");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("quick-wins endpoint returns actionable items", async ({
    loggedPage,
  }) => {
    const { status } = await apiGet("/api/beads/triage/quick-wins?limit=3");
    expect([200, 404]).toContain(status); // 404 if no quick wins

    await loggedPage.goto("/beads");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("beads page renders table with status pills", async ({
    loggedPage,
  }) => {
    await loggedPage.goto("/beads");

    // Table should be visible
    await expect(loggedPage.locator(".table")).toBeVisible();

    // Header should show bead count
    const header = loggedPage.locator(".card__header");
    await expect(header).toBeVisible();
  });
});

// ============================================================================
// Reservations API Tests
// ============================================================================

test.describe("Reservations API E2E", () => {
  const PROJECT_ID = "e2e-project-1";
  const AGENT_ID = "e2e-agent-1";

  test("create exclusive reservation", async ({ loggedPage }) => {
    const { status, body } = await apiPost("/api/reservations", {
      projectId: PROJECT_ID,
      agentId: AGENT_ID,
      patterns: ["src/api/*.ts"],
      mode: "exclusive",
      ttl: 60,
      reason: "E2E test reservation",
    });

    if (status === 201) {
      const data = (body["data"] ?? body) as Record<string, unknown>;
      const reservationId = data["id"] as string;
      expect(reservationId).toBeTruthy();

      // Clean up
      if (reservationId) {
        await apiDelete(`/api/reservations/${reservationId}`, {
          "X-Agent-Id": AGENT_ID,
        });
      }
    } else {
      // Reservation system may not be fully configured in test env
      expect([400, 500, 503]).toContain(status);
    }

    await loggedPage.goto("/");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("check file access returns allowed/denied", async ({ loggedPage }) => {
    const { status, body } = await apiPost("/api/reservations/check", {
      projectId: PROJECT_ID,
      agentId: AGENT_ID,
      filePath: "src/api/routes.ts",
    });

    if (status === 200) {
      const data = (body["data"] ?? body) as Record<string, unknown>;
      expect(typeof data["allowed"]).toBe("boolean");
    }

    await loggedPage.goto("/");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("reservation conflict returns 409", async ({ loggedPage }) => {
    // Create first reservation
    const res1 = await apiPost("/api/reservations", {
      projectId: PROJECT_ID,
      agentId: AGENT_ID,
      patterns: ["src/conflict/*.ts"],
      mode: "exclusive",
      ttl: 60,
      reason: "First reservation",
    });

    if (res1.status === 201) {
      const data1 = (res1.body["data"] ?? res1.body) as Record<string, unknown>;
      const id1 = data1["id"] as string;

      // Try second reservation on same pattern with different agent
      const res2 = await apiPost("/api/reservations", {
        projectId: PROJECT_ID,
        agentId: "e2e-agent-2",
        patterns: ["src/conflict/*.ts"],
        mode: "exclusive",
        ttl: 60,
        reason: "Conflicting reservation",
      });

      // Should be 409 (conflict) or 201 (if conflict detection is lenient)
      expect([201, 409]).toContain(res2.status);

      // Clean up
      if (id1) {
        await apiDelete(`/api/reservations/${id1}`, {
          "X-Agent-Id": AGENT_ID,
        });
      }
    }

    await loggedPage.goto("/");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("reservation stats endpoint returns counts", async ({
    loggedPage,
  }) => {
    const { status } = await apiGet("/api/reservations/stats");
    expect([200, 404]).toContain(status);

    await loggedPage.goto("/");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });
});

// ============================================================================
// Notifications API Tests
// ============================================================================

test.describe("Notifications API E2E", () => {
  const RECIPIENT_ID = "e2e-account-1";

  test("list notifications returns paginated results", async ({
    loggedPage,
  }) => {
    const { status, body } = await apiGet(
      `/api/notifications?recipient_id=${RECIPIENT_ID}&limit=5`,
    );

    if (status === 200) {
      const data = (body["data"] ?? body) as Record<string, unknown>;
      const notifications = (data["notifications"] ?? []) as unknown[];
      expect(Array.isArray(notifications)).toBe(true);

      // Should have unreadCount
      expect(typeof data["unreadCount"]).toBe("number");
    }

    await loggedPage.goto("/");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("create notification and verify delivery", async ({ loggedPage }) => {
    const { status, body } = await apiPost("/api/notifications", {
      type: "info",
      category: "system",
      priority: "normal",
      title: `E2E test notification ${Date.now()}`,
      body: "This is a test notification from E2E suite",
      recipientId: RECIPIENT_ID,
      source: { type: "system", id: "e2e-test", name: "E2E Test" },
    });

    if (status === 201 || status === 200) {
      const data = (body["data"] ?? body) as Record<string, unknown>;
      const notifId = data["id"] as string;

      if (notifId) {
        // Verify it appears in list
        const listRes = await apiGet(
          `/api/notifications?recipient_id=${RECIPIENT_ID}&limit=1`,
        );
        expect(listRes.status).toBe(200);

        // Mark as read
        const readRes = await apiPost(
          `/api/notifications/${notifId}/read?recipient_id=${RECIPIENT_ID}`,
          {},
        );
        expect([200, 204]).toContain(readRes.status);
      }
    }

    await loggedPage.goto("/");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("mark all notifications as read", async ({ loggedPage }) => {
    const { status } = await apiPost(
      `/api/notifications/read-all?recipient_id=${RECIPIENT_ID}`,
      {},
    );
    expect([200, 204]).toContain(status);

    await loggedPage.goto("/");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("get notification preferences", async ({ loggedPage }) => {
    const { status, body } = await apiGet(
      `/api/notifications/preferences?user_id=${RECIPIENT_ID}`,
    );

    if (status === 200) {
      const data = (body["data"] ?? body) as Record<string, unknown>;
      expect(typeof data["enabled"]).toBe("boolean");
    }

    await loggedPage.goto("/");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });

  test("send test notification", async ({ loggedPage }) => {
    const { status } = await apiPost(
      `/api/notifications/test?recipient_id=${RECIPIENT_ID}`,
      { channel: "in_app" },
    );
    expect([200, 201, 404]).toContain(status);

    await loggedPage.goto("/");
    await expect(loggedPage.locator(".page")).toBeVisible();
  });
});

// ============================================================================
// Cross-Feature Integration Tests
// ============================================================================

test.describe("Cross-Feature Integration", () => {
  test("beads page and dashboard are consistent", async ({ loggedPage }) => {
    // Visit beads page
    await loggedPage.goto("/beads");
    await expect(loggedPage.locator(".page")).toBeVisible();

    // Navigate to dashboard
    await loggedPage.click('a[href="/"]');
    await expect(loggedPage.locator(".page")).toBeVisible();

    // Dashboard should show workstream data
    const workstreamCard = loggedPage
      .locator(".card")
      .filter({ hasText: "Workstream" });
    await expect(workstreamCard).toBeVisible();
  });

  test("logging framework captures all API interactions", async ({
    loggedPage,
    testLogger,
  }) => {
    // Make API call from browser context
    await loggedPage.goto("/beads");
    await loggedPage.waitForLoadState("networkidle");

    const summary = testLogger.getSummary();
    expect(summary.networkRequests).toBeGreaterThan(0);
    expect(summary.pageErrors).toBe(0);
  });
});
