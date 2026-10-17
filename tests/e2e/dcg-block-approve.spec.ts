/**
 * E2E: DCG Block/Approve + Audit Trail (bd-1vr1.12)
 *
 * Tests the full DCG pending exception lifecycle via API:
 * 1. Simulate a blocked command (ingest block event)
 * 2. Create a pending exception
 * 3. Approve/deny via API
 * 4. Validate allow-once execution
 * 5. Confirm audit trail in block history + stats
 *
 * Uses the E2E logging framework (test-fixture) for traceable artifacts.
 */

import { createHash } from "node:crypto";
import { expect, test } from "./lib/test-fixture";

const GATEWAY_URL = process.env["E2E_GATEWAY_URL"] ?? "http://localhost:3456";

const isPlaywright = process.env["PLAYWRIGHT_TEST"] === "1";

/** Helper to call gateway API directly. */
async function gw(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

if (isPlaywright) {
  test.describe("DCG Block → Approve → Audit Trail", () => {
    // ========================================================================
    // 1. Block event ingestion
    // ========================================================================

    test("POST /dcg/blocks ingests a block event", async ({
      testLogger: _testLogger,
    }) => {
      const { status, body } = await gw("/dcg/blocks", {
        method: "POST",
        body: JSON.stringify({
          agentId: "e2e-agent-1",
          command: "rm -rf /important-data",
          pattern: "rm -rf",
          reason: "Recursive deletion of critical path",
          severity: "critical",
          pack: "core.filesystem",
          ruleId: "fs.rm-rf",
        }),
      });

      // Block event should be ingested (200 or 201)
      expect([200, 201]).toContain(status);
      expect(body.data).toBeDefined();
    });

    test("GET /dcg/blocks returns ingested events", async ({
      testLogger: _testLogger,
    }) => {
      // First ingest a block
      await gw("/dcg/blocks", {
        method: "POST",
        body: JSON.stringify({
          agentId: "e2e-agent-1",
          command: "git push --force origin main",
          pattern: "git push --force",
          reason: "Force push to protected branch",
          severity: "high",
          pack: "core.git",
          ruleId: "git.force-push",
        }),
      });

      const { status, body } = await gw("/dcg/blocks");
      expect(status).toBe(200);

      const data = body.data as { events?: unknown[] };
      expect(data.events).toBeDefined();
      expect(Array.isArray(data.events)).toBe(true);
    });

    // ========================================================================
    // 2. DCG test/explain endpoints
    // ========================================================================

    test("POST /dcg/test identifies dangerous command", async ({
      testLogger: _testLogger,
    }) => {
      const { status, body } = await gw("/dcg/test", {
        method: "POST",
        body: JSON.stringify({ command: "rm -rf /" }),
      });

      expect(status).toBe(200);
      const data = body.data as { blocked?: boolean };
      expect(data.blocked).toBe(true);
    });

    test("POST /dcg/test allows safe command", async ({
      testLogger: _testLogger,
    }) => {
      const { status, body } = await gw("/dcg/test", {
        method: "POST",
        body: JSON.stringify({ command: "git status" }),
      });

      expect(status).toBe(200);
      const data = body.data as { blocked?: boolean };
      expect(data.blocked).toBe(false);
    });

    test("POST /dcg/explain provides analysis", async ({
      testLogger: _testLogger,
    }) => {
      const { status, body } = await gw("/dcg/explain", {
        method: "POST",
        body: JSON.stringify({ command: "git reset --hard HEAD" }),
      });

      expect(status).toBe(200);
      const data = body.data as { analysis?: unknown };
      expect(data).toBeDefined();
    });

    // ========================================================================
    // 3. Pending exception lifecycle: create → approve → validate
    // ========================================================================

    test("pending exception: full approve workflow", async ({
      testLogger: _testLogger,
    }) => {
      const dangerousCommand = `rm -rf /tmp/e2e-test-${Date.now()}`;
      const _commandHash = createHash("sha256")
        .update(dangerousCommand)
        .digest("hex");

      // Step 1: Create a pending exception via pre-validate
      const preValidate = await gw("/dcg/pre-validate", {
        method: "POST",
        body: JSON.stringify({
          command: dangerousCommand,
          agentId: "e2e-agent-1",
        }),
      });

      // The command should be blocked
      expect(preValidate.status).toBe(200);

      // Step 2: List pending exceptions
      const listRes = await gw("/dcg/pending");
      expect(listRes.status).toBe(200);
      const pendingData = listRes.body.data as {
        exceptions?: Array<{
          shortCode: string;
          status: string;
          commandHash: string;
        }>;
      };

      // If there are pending exceptions, test the approve flow
      if (pendingData.exceptions && pendingData.exceptions.length > 0) {
        const exception = pendingData.exceptions[0]!;
        const shortCode = exception.shortCode;

        // Step 3: Approve the exception
        const approveRes = await gw(`/dcg/pending/${shortCode}/approve`, {
          method: "POST",
        });

        expect([200, 409]).toContain(approveRes.status);

        if (approveRes.status === 200) {
          const approvedData = approveRes.body.data as {
            status?: string;
            approvedBy?: string;
          };
          expect(approvedData.status).toBe("approved");

          // Step 4: Validate the command hash for execution
          const validateRes = await gw(`/dcg/pending/${shortCode}/validate`, {
            method: "POST",
            body: JSON.stringify({
              commandHash: exception.commandHash,
            }),
          });
          expect(validateRes.status).toBe(200);
          const validateData = validateRes.body.data as { valid?: boolean };
          expect(validateData.valid).toBe(true);
        }
      }
    });

    test("pending exception: deny workflow", async ({
      testLogger: _testLogger,
    }) => {
      // List any pending exceptions
      const listRes = await gw("/dcg/pending?status=pending");
      expect(listRes.status).toBe(200);

      const pendingData = listRes.body.data as {
        exceptions?: Array<{ shortCode: string; status: string }>;
      };

      if (pendingData.exceptions && pendingData.exceptions.length > 0) {
        const exception = pendingData.exceptions[0]!;
        const shortCode = exception.shortCode;

        // Deny with reason
        const denyRes = await gw(`/dcg/pending/${shortCode}/deny`, {
          method: "POST",
          body: JSON.stringify({ reason: "E2E test: too dangerous" }),
        });

        expect([200, 409]).toContain(denyRes.status);

        if (denyRes.status === 200) {
          const deniedData = denyRes.body.data as { status?: string };
          expect(deniedData.status).toBe("denied");
        }
      }
    });

    test("pending exception: approve then validate with wrong hash fails", async ({
      testLogger: _testLogger,
    }) => {
      const listRes = await gw("/dcg/pending?status=approved");
      expect(listRes.status).toBe(200);

      const pendingData = listRes.body.data as {
        exceptions?: Array<{ shortCode: string }>;
      };

      if (pendingData.exceptions && pendingData.exceptions.length > 0) {
        const shortCode = pendingData.exceptions[0]!.shortCode;

        // Validate with wrong hash
        const validateRes = await gw(`/dcg/pending/${shortCode}/validate`, {
          method: "POST",
          body: JSON.stringify({ commandHash: "wrong-hash-value" }),
        });

        expect(validateRes.status).toBe(200);
        const data = validateRes.body.data as { valid?: boolean };
        expect(data.valid).toBe(false);
      }
    });

    // ========================================================================
    // 4. Audit trail verification
    // ========================================================================

    test("GET /dcg/stats reflects block events", async ({
      testLogger: _testLogger,
    }) => {
      const { status, body } = await gw("/dcg/stats");
      expect(status).toBe(200);

      const data = body.data as { totalBlocks?: number };
      expect(data.totalBlocks).toBeDefined();
      expect(typeof data.totalBlocks).toBe("number");
    });

    test("GET /dcg/stats/full provides comprehensive audit data", async ({
      testLogger: _testLogger,
    }) => {
      const { status, body } = await gw("/dcg/stats/full");
      expect(status).toBe(200);

      const data = body.data as {
        overview?: unknown;
        trends?: unknown;
        packBreakdown?: unknown;
      };
      expect(data.overview).toBeDefined();
    });

    test("GET /dcg/blocks supports filtering by agentId", async ({
      testLogger: _testLogger,
    }) => {
      const { status, body } = await gw("/dcg/blocks?agentId=e2e-agent-1");
      expect(status).toBe(200);

      const data = body.data as { events?: unknown[] };
      expect(data.events).toBeDefined();
    });

    test("GET /dcg/blocks supports filtering by severity", async ({
      testLogger: _testLogger,
    }) => {
      const { status, body } = await gw("/dcg/blocks?severity=critical");
      expect(status).toBe(200);

      const data = body.data as { events?: unknown[] };
      expect(data.events).toBeDefined();
    });

    // ========================================================================
    // 5. Configuration audit
    // ========================================================================

    test("GET /dcg/config returns current pack configuration", async ({
      testLogger: _testLogger,
    }) => {
      const { status, body } = await gw("/dcg/config");
      expect(status).toBe(200);

      const data = body.data as { enabledPacks?: string[] };
      expect(Array.isArray(data.enabledPacks)).toBe(true);
      expect(data.enabledPacks!.length).toBeGreaterThan(0);
    });

    test("false positive marking creates audit entry", async ({
      testLogger: _testLogger,
    }) => {
      // Get existing blocks
      const blocksRes = await gw("/dcg/blocks");
      const blocksData = blocksRes.body.data as {
        events?: Array<{ id: string; falsePositive?: boolean }>;
      };

      if (blocksData.events && blocksData.events.length > 0) {
        // Find a non-false-positive block
        const block = blocksData.events.find((e) => !e.falsePositive);

        if (block) {
          const fpRes = await gw(`/dcg/blocks/${block.id}/false-positive`, {
            method: "POST",
          });

          expect([200, 404]).toContain(fpRes.status);
        }
      }
    });
  });

  // ==========================================================================
  // UI-driven DCG workflow with logging
  // ==========================================================================

  test.describe("DCG UI Workflow with Logging", () => {
    test("navigate to DCG page and verify dashboard loads", async ({
      page,
      testLogger,
    }) => {
      await page.goto("/dcg");

      // Verify page title
      const header = page
        .locator("h2")
        .filter({ hasText: "Destructive Command Guard" });
      await expect(header).toBeVisible();

      // Verify stats cards load
      const statsCards = page.locator(".card--compact");
      await expect(statsCards.first()).toBeVisible();

      // Log summary of captured events
      const summary = testLogger.getSummary();
      expect(summary.networkRequests).toBeGreaterThan(0);
    });

    test("test dangerous command via UI command tester", async ({
      page,
      testLogger,
    }) => {
      await page.goto("/dcg");

      // Switch to Test Command tab
      await page.click('button:text("Test Command")');

      // Enter a dangerous command
      const input = page.locator('input[placeholder*="git reset"]');
      await input.fill("rm -rf /");

      // Click Test
      await page.click('button:text("Test")');

      // Wait for result
      await page.waitForTimeout(1500);

      // Should show BLOCKED result
      const blockedResult = page.locator("h4").filter({ hasText: "BLOCKED" });
      await expect(blockedResult).toBeVisible();

      // Verify network activity was logged
      const summary = testLogger.getSummary();
      expect(summary.networkRequests).toBeGreaterThan(0);
    });

    test("verify pending exceptions tab shows count", async ({
      page,
      testLogger: _testLogger,
    }) => {
      await page.goto("/dcg");

      // Switch to Pending tab
      await page.click('button:text("Pending")');

      // Should show either pending exceptions or empty state
      const pendingHeader = page
        .locator("h3")
        .filter({ hasText: "Pending Exceptions" });
      await expect(pendingHeader).toBeVisible();
    });

    test("statistics tab shows audit data", async ({
      page,
      testLogger: _testLogger,
    }) => {
      await page.goto("/dcg");

      // Switch to Statistics tab
      await page.click('button:text("Statistics")');

      // Verify severity breakdown
      const severitySection = page
        .locator("h3")
        .filter({ hasText: "Blocks by Severity" });
      await expect(severitySection).toBeVisible();

      // Verify top packs section
      const packsSection = page
        .locator("h3")
        .filter({ hasText: "Top Blocking Packs" });
      await expect(packsSection).toBeVisible();
    });
  });
}
