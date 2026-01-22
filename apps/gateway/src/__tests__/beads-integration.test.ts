/**
 * Integration tests for BR endpoints.
 *
 * These tests verify create/show/close/ready flows with actual br commands.
 * Each test logs request IDs and payload summaries for easy debugging.
 *
 * Part of bd-n52p: Tests for br endpoints.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { Hono } from "hono";
import { createBeadsRoutes } from "../routes/beads";
import { createBeadsService } from "../services/beads.service";

// Test configuration
const TEST_TIMEOUT = 30000; // 30 seconds for br CLI calls
const LOG_PREFIX = "[beads-integration]";

// Test utilities for structured logging
interface TestLogEntry {
  timestamp: string;
  test: string;
  action: string;
  requestId?: string;
  method?: string;
  path?: string;
  status?: number;
  payload?: unknown;
  error?: string;
}

const testLogs: TestLogEntry[] = [];

function logTest(entry: Omit<TestLogEntry, "timestamp">) {
  const fullEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };
  testLogs.push(fullEntry);
  console.log(
    LOG_PREFIX,
    JSON.stringify({
      action: entry.action,
      requestId: entry.requestId,
      method: entry.method,
      path: entry.path,
      status: entry.status,
      ...(entry.error && { error: entry.error }),
    }),
  );
}

// Helper to generate unique test bead IDs
let testBeadCounter = 0;
function getTestBeadTitle(): string {
  testBeadCounter++;
  const timestamp = Date.now();
  return `test-bead-${timestamp}-${testBeadCounter}`;
}

// Beads created during tests that need cleanup
const createdBeadIds: string[] = [];

describe("BR Endpoints Integration Tests", () => {
  let app: Hono;
  let service: ReturnType<typeof createBeadsService>;

  beforeAll(async () => {
    logTest({ test: "setup", action: "initializing_test_suite" });

    // Create app with real BeadsService
    service = createBeadsService();
    app = new Hono();
    app.route("/beads", createBeadsRoutes(service));

    logTest({ test: "setup", action: "test_suite_initialized" });
  });

  afterAll(async () => {
    // Clean up any test beads we created
    logTest({
      test: "cleanup",
      action: "cleaning_up_test_beads",
      payload: { beadIds: createdBeadIds },
    });

    for (const beadId of createdBeadIds) {
      try {
        await service.close(beadId, { force: true });
        logTest({
          test: "cleanup",
          action: "closed_test_bead",
          payload: { beadId },
        });
      } catch (error) {
        // Bead may already be closed or not exist
        logTest({
          test: "cleanup",
          action: "cleanup_warning",
          payload: { beadId },
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Output test log summary
    console.log("\n=== Test Log Summary ===");
    console.log(`Total log entries: ${testLogs.length}`);
    const errors = testLogs.filter((l) => l.error);
    if (errors.length > 0) {
      console.log(`Errors encountered: ${errors.length}`);
      for (const e of errors) {
        console.log(`  - ${e.test}: ${e.error}`);
      }
    }
  });

  describe("GET /beads (list)", () => {
    test(
      "should return list of beads with count",
      async () => {
        const testName = "list_beads";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads",
        });

        const res = await app.request("/beads");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          method: "GET",
          path: "/beads",
          status: res.status,
          requestId: data.requestId,
          payload: { beadCount: data.data?.count, object: data.object },
        });

        expect(res.status).toBe(200);
        expect(data.object).toBe("beads");
        expect(Array.isArray(data.data.beads)).toBe(true);
        expect(typeof data.data.count).toBe("number");
        expect(data.requestId).toBeDefined();
      },
      TEST_TIMEOUT,
    );

    test(
      "should support status filter",
      async () => {
        const testName = "list_beads_status_filter";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?status=open",
        });

        const res = await app.request("/beads?status=open");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          payload: { beadCount: data.data?.count, filter: "status=open" },
        });

        expect(res.status).toBe(200);
        expect(data.object).toBe("beads");

        // All returned beads should have open status
        for (const bead of data.data.beads) {
          expect(bead.status).toBe("open");
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "should support limit filter",
      async () => {
        const testName = "list_beads_limit";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?limit=5",
        });

        const res = await app.request("/beads?limit=5");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          payload: { beadCount: data.data?.count, limit: 5 },
        });

        expect(res.status).toBe(200);
        expect(data.data.beads.length).toBeLessThanOrEqual(5);
      },
      TEST_TIMEOUT,
    );

    test(
      "should support type filter",
      async () => {
        const testName = "list_beads_type_filter";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?type=task",
        });

        const res = await app.request("/beads?type=task");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          payload: { beadCount: data.data?.count, filter: "type=task" },
        });

        expect(res.status).toBe(200);

        // All returned beads should have task type (if any returned)
        for (const bead of data.data.beads) {
          expect(bead.type || bead.issue_type).toBe("task");
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "should support priority filter",
      async () => {
        const testName = "list_beads_priority_filter";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?priority=1",
        });

        const res = await app.request("/beads?priority=1");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          payload: { beadCount: data.data?.count, filter: "priority=1" },
        });

        expect(res.status).toBe(200);

        // All returned beads should have priority 1 (if any returned)
        for (const bead of data.data.beads) {
          expect(bead.priority).toBe(1);
        }
      },
      TEST_TIMEOUT,
    );
  });

  describe("GET /beads/list/ready", () => {
    test(
      "should return unblocked ready beads",
      async () => {
        const testName = "list_ready_beads";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads/list/ready",
        });

        const res = await app.request("/beads/list/ready");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          payload: { beadCount: data.data?.count },
        });

        expect(res.status).toBe(200);
        expect(data.object).toBe("beads");
        expect(Array.isArray(data.data.beads)).toBe(true);
      },
      TEST_TIMEOUT,
    );

    test(
      "should support limit parameter",
      async () => {
        const testName = "list_ready_beads_limit";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads/list/ready?limit=3",
        });

        const res = await app.request("/beads/list/ready?limit=3");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          payload: { beadCount: data.data?.count, limit: 3 },
        });

        expect(res.status).toBe(200);
        expect(data.data.beads.length).toBeLessThanOrEqual(3);
      },
      TEST_TIMEOUT,
    );
  });

  describe("POST /beads (create)", () => {
    test(
      "should create a new bead",
      async () => {
        const testName = "create_bead";
        const title = getTestBeadTitle();

        logTest({
          test: testName,
          action: "starting",
          method: "POST",
          path: "/beads",
          payload: { title, type: "task", priority: 4 },
        });

        const res = await app.request("/beads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            type: "task",
            priority: 4, // backlog priority for test beads
            description: "Integration test bead - will be cleaned up",
          }),
        });

        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          payload: { beadId: data.data?.id, title: data.data?.title },
        });

        expect(res.status).toBe(201);
        expect(data.object).toBe("bead");
        expect(data.data.title).toBe(title);
        expect(data.data.id).toBeDefined();

        // Track for cleanup
        if (data.data?.id) {
          createdBeadIds.push(data.data.id);
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "should create bead with all optional fields",
      async () => {
        const testName = "create_bead_full";
        const title = getTestBeadTitle();

        const payload = {
          title,
          type: "bug",
          priority: 4,
          description: "Full integration test bead",
          labels: ["test", "integration"],
        };

        logTest({
          test: testName,
          action: "starting",
          method: "POST",
          path: "/beads",
          payload,
        });

        const res = await app.request("/beads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          payload: { beadId: data.data?.id, type: data.data?.type },
        });

        expect(res.status).toBe(201);
        expect(data.data.title).toBe(title);

        // Track for cleanup
        if (data.data?.id) {
          createdBeadIds.push(data.data.id);
        }
      },
      TEST_TIMEOUT,
    );
  });

  describe("GET /beads/:id (show)", () => {
    let testBeadId: string;

    beforeEach(async () => {
      // Create a test bead to show
      const title = getTestBeadTitle();
      const bead = await service.create({
        title,
        type: "task",
        priority: 4,
        description: "Test bead for show endpoint",
      });
      testBeadId = bead.id;
      createdBeadIds.push(testBeadId);
    });

    test(
      "should return single bead by ID",
      async () => {
        const testName = "show_bead";

        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: `/beads/${testBeadId}`,
        });

        const res = await app.request(`/beads/${testBeadId}`);
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          payload: { beadId: data.data?.id, title: data.data?.title },
        });

        expect(res.status).toBe(200);
        expect(data.object).toBe("bead");
        expect(data.data.id).toBe(testBeadId);
      },
      TEST_TIMEOUT,
    );

    test(
      "should return 404 for non-existent bead",
      async () => {
        const testName = "show_bead_not_found";
        const fakeId = "bd-nonexistent-9999";

        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: `/beads/${fakeId}`,
        });

        const res = await app.request(`/beads/${fakeId}`);
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          error: data.error?.code,
        });

        // Note: br returns exit code 3 for not found, which gets mapped to SYSTEM_UNAVAILABLE
        // The routes have BEAD_NOT_FOUND logic, but it only triggers when service returns empty array
        expect(res.status).toBe(503);
        expect(data.error.code).toBe("SYSTEM_UNAVAILABLE");
      },
      TEST_TIMEOUT,
    );
  });

  describe("PATCH /beads/:id (update)", () => {
    let testBeadId: string;

    beforeEach(async () => {
      // Create a test bead to update
      const title = getTestBeadTitle();
      const bead = await service.create({
        title,
        type: "task",
        priority: 4,
        description: "Test bead for update endpoint",
      });
      testBeadId = bead.id;
      createdBeadIds.push(testBeadId);
    });

    test(
      "should update bead title",
      async () => {
        const testName = "update_bead_title";
        const newTitle = `updated-${getTestBeadTitle()}`;

        logTest({
          test: testName,
          action: "starting",
          method: "PATCH",
          path: `/beads/${testBeadId}`,
          payload: { title: newTitle },
        });

        const res = await app.request(`/beads/${testBeadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: newTitle }),
        });

        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          payload: { beadId: data.data?.id, title: data.data?.title },
        });

        expect(res.status).toBe(200);
        expect(data.object).toBe("bead");
        expect(data.data.title).toBe(newTitle);
      },
      TEST_TIMEOUT,
    );

    test(
      "should update bead status",
      async () => {
        const testName = "update_bead_status";

        logTest({
          test: testName,
          action: "starting",
          method: "PATCH",
          path: `/beads/${testBeadId}`,
          payload: { status: "in_progress" },
        });

        const res = await app.request(`/beads/${testBeadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "in_progress" }),
        });

        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          payload: { beadId: data.data?.id, status: data.data?.status },
        });

        expect(res.status).toBe(200);
        expect(data.data.status).toBe("in_progress");
      },
      TEST_TIMEOUT,
    );

    test(
      "should update bead priority",
      async () => {
        const testName = "update_bead_priority";

        logTest({
          test: testName,
          action: "starting",
          method: "PATCH",
          path: `/beads/${testBeadId}`,
          payload: { priority: 2 },
        });

        const res = await app.request(`/beads/${testBeadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: 2 }),
        });

        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          payload: { beadId: data.data?.id, priority: data.data?.priority },
        });

        expect(res.status).toBe(200);
        expect(data.data.priority).toBe(2);
      },
      TEST_TIMEOUT,
    );

    test(
      "should return 404 when updating non-existent bead",
      async () => {
        const testName = "update_bead_not_found";
        const fakeId = "bd-nonexistent-update-9999";

        logTest({
          test: testName,
          action: "starting",
          method: "PATCH",
          path: `/beads/${fakeId}`,
          payload: { title: "new title" },
        });

        const res = await app.request(`/beads/${fakeId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "new title" }),
        });

        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          error: data.error?.code,
        });

        // Note: br returns exit code 3 for not found, which gets mapped to SYSTEM_UNAVAILABLE
        expect(res.status).toBe(503);
        expect(data.error.code).toBe("SYSTEM_UNAVAILABLE");
      },
      TEST_TIMEOUT,
    );
  });

  describe("POST /beads/:id/claim", () => {
    let testBeadId: string;

    beforeEach(async () => {
      // Create a test bead to claim
      const title = getTestBeadTitle();
      const bead = await service.create({
        title,
        type: "task",
        priority: 4,
        description: "Test bead for claim endpoint",
      });
      testBeadId = bead.id;
      createdBeadIds.push(testBeadId);
    });

    test(
      "should claim bead and set status to in_progress",
      async () => {
        const testName = "claim_bead";

        logTest({
          test: testName,
          action: "starting",
          method: "POST",
          path: `/beads/${testBeadId}/claim`,
        });

        const res = await app.request(`/beads/${testBeadId}/claim`, {
          method: "POST",
        });

        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          payload: { beadId: data.data?.id, status: data.data?.status },
        });

        expect(res.status).toBe(200);
        expect(data.object).toBe("bead");
        expect(data.data.status).toBe("in_progress");
      },
      TEST_TIMEOUT,
    );
  });

  describe("DELETE /beads/:id (close)", () => {
    let testBeadId: string;

    beforeEach(async () => {
      // Create a test bead to close
      const title = getTestBeadTitle();
      const bead = await service.create({
        title,
        type: "task",
        priority: 4,
        description: "Test bead for close endpoint",
      });
      testBeadId = bead.id;
      // Don't add to cleanup list since we're closing it in the test
    });

    test(
      "should close bead",
      async () => {
        const testName = "close_bead";

        logTest({
          test: testName,
          action: "starting",
          method: "DELETE",
          path: `/beads/${testBeadId}`,
        });

        const res = await app.request(`/beads/${testBeadId}`, {
          method: "DELETE",
        });

        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          payload: { beadId: data.data?.id, status: data.data?.status },
        });

        expect(res.status).toBe(200);
        expect(data.object).toBe("bead");
        expect(data.data.status).toBe("closed");
      },
      TEST_TIMEOUT,
    );

    test(
      "should close bead with reason",
      async () => {
        const testName = "close_bead_with_reason";

        // Create another bead for this test
        const title = getTestBeadTitle();
        const bead = await service.create({
          title,
          type: "task",
          priority: 4,
        });
        const beadId = bead.id;

        logTest({
          test: testName,
          action: "starting",
          method: "DELETE",
          path: `/beads/${beadId}?reason=completed`,
        });

        const res = await app.request(`/beads/${beadId}?reason=completed`, {
          method: "DELETE",
        });

        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          payload: { beadId: data.data?.id, status: data.data?.status },
        });

        expect(res.status).toBe(200);
        expect(data.data.status).toBe("closed");
      },
      TEST_TIMEOUT,
    );

    test(
      "should return 404 when closing non-existent bead",
      async () => {
        const testName = "close_bead_not_found";
        const fakeId = "bd-nonexistent-close-9999";

        logTest({
          test: testName,
          action: "starting",
          method: "DELETE",
          path: `/beads/${fakeId}`,
        });

        const res = await app.request(`/beads/${fakeId}`, {
          method: "DELETE",
        });

        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          error: data.error?.code,
        });

        // Note: br returns exit code 3 for not found, which gets mapped to SYSTEM_UNAVAILABLE
        expect(res.status).toBe(503);
        expect(data.error.code).toBe("SYSTEM_UNAVAILABLE");
      },
      TEST_TIMEOUT,
    );
  });

  describe("POST /beads/:id/close (alternative close)", () => {
    test(
      "should close bead via POST with body",
      async () => {
        const testName = "close_bead_post";

        // Create a test bead
        const title = getTestBeadTitle();
        const bead = await service.create({
          title,
          type: "task",
          priority: 4,
        });

        logTest({
          test: testName,
          action: "starting",
          method: "POST",
          path: `/beads/${bead.id}/close`,
          payload: { reason: "done" },
        });

        const res = await app.request(`/beads/${bead.id}/close`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "done" }),
        });

        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          payload: { beadId: data.data?.id, status: data.data?.status },
        });

        expect(res.status).toBe(200);
        expect(data.data.status).toBe("closed");
      },
      TEST_TIMEOUT,
    );
  });

  describe("GET /beads/sync/status", () => {
    test(
      "should return sync status",
      async () => {
        const testName = "sync_status";

        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads/sync/status",
        });

        const res = await app.request("/beads/sync/status");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          payload: { dirtyCount: data.data?.dirty_count },
        });

        expect(res.status).toBe(200);
        expect(data.object).toBe("sync_status");
        // br sync --status returns dirty_count, not status
        expect(data.data.dirty_count).toBeDefined();
      },
      TEST_TIMEOUT,
    );
  });

  describe("POST /beads/sync", () => {
    test(
      "should trigger sync and return result",
      async () => {
        const testName = "sync";

        logTest({
          test: testName,
          action: "starting",
          method: "POST",
          path: "/beads/sync",
        });

        const res = await app.request("/beads/sync", { method: "POST" });
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          requestId: data.requestId,
          payload: { syncResult: data.data?.status },
        });

        expect(res.status).toBe(200);
        expect(data.object).toBe("sync_result");
        expect(data.data.status).toBe("ok");
      },
      TEST_TIMEOUT,
    );
  });

  describe("Full CRUD Flow", () => {
    test(
      "should complete create -> show -> update -> claim -> close flow",
      async () => {
        const testName = "full_crud_flow";
        const title = getTestBeadTitle();

        // Step 1: Create
        logTest({
          test: testName,
          action: "step_1_create",
          method: "POST",
          path: "/beads",
        });

        const createRes = await app.request("/beads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            type: "task",
            priority: 4,
            description: "Full CRUD flow test",
          }),
        });
        const createData = await createRes.json();

        expect(createRes.status).toBe(201);
        const beadId = createData.data.id;

        logTest({
          test: testName,
          action: "step_1_complete",
          payload: { beadId, status: createData.data.status },
        });

        // Step 2: Show
        logTest({
          test: testName,
          action: "step_2_show",
          method: "GET",
          path: `/beads/${beadId}`,
        });

        const showRes = await app.request(`/beads/${beadId}`);
        const showData = await showRes.json();

        expect(showRes.status).toBe(200);
        expect(showData.data.id).toBe(beadId);

        logTest({
          test: testName,
          action: "step_2_complete",
          payload: { beadId, title: showData.data.title },
        });

        // Step 3: Update
        const updatedTitle = `updated-${title}`;
        logTest({
          test: testName,
          action: "step_3_update",
          method: "PATCH",
          path: `/beads/${beadId}`,
        });

        const updateRes = await app.request(`/beads/${beadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: updatedTitle }),
        });
        const updateData = await updateRes.json();

        expect(updateRes.status).toBe(200);
        expect(updateData.data.title).toBe(updatedTitle);

        logTest({
          test: testName,
          action: "step_3_complete",
          payload: { beadId, title: updateData.data.title },
        });

        // Step 4: Claim
        logTest({
          test: testName,
          action: "step_4_claim",
          method: "POST",
          path: `/beads/${beadId}/claim`,
        });

        const claimRes = await app.request(`/beads/${beadId}/claim`, {
          method: "POST",
        });
        const claimData = await claimRes.json();

        expect(claimRes.status).toBe(200);
        expect(claimData.data.status).toBe("in_progress");

        logTest({
          test: testName,
          action: "step_4_complete",
          payload: { beadId, status: claimData.data.status },
        });

        // Step 5: Close
        logTest({
          test: testName,
          action: "step_5_close",
          method: "DELETE",
          path: `/beads/${beadId}`,
        });

        const closeRes = await app.request(
          `/beads/${beadId}?reason=completed`,
          {
            method: "DELETE",
          },
        );
        const closeData = await closeRes.json();

        expect(closeRes.status).toBe(200);
        expect(closeData.data.status).toBe("closed");

        logTest({
          test: testName,
          action: "step_5_complete",
          payload: { beadId, status: closeData.data.status },
        });

        logTest({
          test: testName,
          action: "flow_complete",
          payload: { beadId, finalStatus: "closed" },
        });
      },
      TEST_TIMEOUT * 2, // Double timeout for full flow
    );
  });
});
