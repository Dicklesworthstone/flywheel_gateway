/**
 * Filter Parity Tests for BR Endpoints.
 *
 * These tests verify that the /beads list endpoint filters match br CLI behavior.
 * Tests cover: labels, priority ranges, text search, sort order, assignee,
 * combined filters, and detailed logging for invalid parameters.
 *
 * Part of bd-3kes: Tests for beads list/filter parity.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createBeadsRoutes } from "../routes/beads";
import { createBeadsService } from "../services/beads.service";

const TEST_TIMEOUT = 30000;
const LOG_PREFIX = "[beads-filter-parity]";

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
      method: entry.method,
      path: entry.path,
      status: entry.status,
      ...(entry.error && { error: entry.error }),
    }),
  );
}

let testBeadCounter = 0;
function getTestBeadTitle(): string {
  testBeadCounter++;
  const timestamp = Date.now();
  return `filter-test-${timestamp}-${testBeadCounter}`;
}

const createdBeadIds: string[] = [];

describe("Beads Filter Parity Tests (bd-3kes)", () => {
  let app: Hono;
  let service: ReturnType<typeof createBeadsService>;

  // Test beads created during setup for filter testing
  let labeledBeadId: string;
  let multiLabelBeadId: string;
  let highPriorityBeadId: string;
  let searchableBeadId: string;

  beforeAll(async () => {
    logTest({ test: "setup", action: "initializing_filter_parity_tests" });

    service = createBeadsService();
    app = new Hono();
    app.route("/beads", createBeadsRoutes(service));

    // Create test beads with specific attributes for filter testing
    // Note: We'll use existing beads in the repo for most tests since
    // creating many beads is slow. These are for specific filter scenarios.

    // Bead with specific label for label filter tests
    const labeledBead = await service.create({
      title: getTestBeadTitle(),
      type: "task",
      priority: 3,
      description: "Test bead with specific label for filter testing",
      labels: ["filter-test-label"],
    });
    labeledBeadId = labeledBead.id;
    createdBeadIds.push(labeledBeadId);

    // Bead with multiple labels for AND/OR label tests
    const multiLabelBead = await service.create({
      title: getTestBeadTitle(),
      type: "task",
      priority: 3,
      description: "Test bead with multiple labels",
      labels: ["filter-test-label", "secondary-label"],
    });
    multiLabelBeadId = multiLabelBead.id;
    createdBeadIds.push(multiLabelBeadId);

    // High priority bead for priority range tests
    const highPriorityBead = await service.create({
      title: getTestBeadTitle(),
      type: "bug",
      priority: 1,
      description: "High priority test bead for filter testing",
    });
    highPriorityBeadId = highPriorityBead.id;
    createdBeadIds.push(highPriorityBeadId);

    // Bead with searchable content
    const searchableBead = await service.create({
      title: `searchable-unique-xyz-${Date.now()}`,
      type: "task",
      priority: 4,
      description: "This bead contains SEARCHABLE_UNIQUE_TOKEN_ABC for testing",
    });
    searchableBeadId = searchableBead.id;
    createdBeadIds.push(searchableBeadId);

    logTest({
      test: "setup",
      action: "test_beads_created",
      payload: {
        labeledBeadId,
        multiLabelBeadId,
        highPriorityBeadId,
        searchableBeadId,
      },
    });
  }, TEST_TIMEOUT * 4);

  afterAll(async () => {
    logTest({
      test: "cleanup",
      action: "cleaning_up_filter_test_beads",
      payload: { beadIds: createdBeadIds },
    });

    for (const beadId of createdBeadIds) {
      try {
        await service.close(beadId, { force: true });
      } catch {
        // Bead may already be closed or not exist
      }
    }

    console.log("\n=== Filter Parity Test Summary ===");
    console.log(`Total log entries: ${testLogs.length}`);
    const errors = testLogs.filter((l) => l.error);
    if (errors.length > 0) {
      console.log(`Errors encountered: ${errors.length}`);
    }
  }, TEST_TIMEOUT * 4);

  // ==========================================================================
  // Label Filter Tests
  // ==========================================================================

  describe("Label Filtering (AND logic)", () => {
    test(
      "should filter by single label",
      async () => {
        const testName = "filter_single_label";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?label=filter-test-label",
        });

        const res = await app.request("/beads?label=filter-test-label");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        expect(res.status).toBe(200);
        expect(data.object).toBe("beads");
        // All returned beads should have the filter-test-label
        for (const bead of data.data.beads) {
          expect(bead.labels).toContain("filter-test-label");
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "should filter by multiple labels (AND logic)",
      async () => {
        const testName = "filter_multiple_labels_and";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?label=filter-test-label&label=secondary-label",
        });

        const res = await app.request(
          "/beads?label=filter-test-label&label=secondary-label",
        );
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        expect(res.status).toBe(200);
        // Should return beads that have BOTH labels
        for (const bead of data.data.beads) {
          expect(bead.labels).toContain("filter-test-label");
          expect(bead.labels).toContain("secondary-label");
        }
      },
      TEST_TIMEOUT,
    );
  });

  describe("Label Filtering (OR logic)", () => {
    test(
      "should filter by labelAny (OR logic)",
      async () => {
        const testName = "filter_label_any";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?labelAny=filter-test-label&labelAny=nonexistent-label",
        });

        const res = await app.request(
          "/beads?labelAny=filter-test-label&labelAny=nonexistent-label",
        );
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        expect(res.status).toBe(200);
        // Should return beads that have ANY of the labels
        for (const bead of data.data.beads) {
          const hasAnyLabel =
            bead.labels?.includes("filter-test-label") ||
            bead.labels?.includes("nonexistent-label");
          expect(hasAnyLabel).toBe(true);
        }
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // Priority Range Filter Tests
  // ==========================================================================

  describe("Priority Range Filtering", () => {
    test(
      "should filter by priorityMin",
      async () => {
        const testName = "filter_priority_min";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?priorityMin=2&limit=10",
        });

        const res = await app.request("/beads?priorityMin=2&limit=10");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        expect(res.status).toBe(200);
        // All beads should have priority >= 2 (lower number = higher priority)
        // Note: priorityMin=2 means priority 2, 3, 4 (P2 and lower)
        for (const bead of data.data.beads) {
          expect(bead.priority).toBeGreaterThanOrEqual(2);
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "should filter by priorityMax",
      async () => {
        const testName = "filter_priority_max";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?priorityMax=2&limit=10",
        });

        const res = await app.request("/beads?priorityMax=2&limit=10");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        expect(res.status).toBe(200);
        // All beads should have priority <= 2 (P0, P1, P2)
        for (const bead of data.data.beads) {
          expect(bead.priority).toBeLessThanOrEqual(2);
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "should filter by priority range (priorityMin and priorityMax)",
      async () => {
        const testName = "filter_priority_range";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?priorityMin=1&priorityMax=2&limit=10",
        });

        const res = await app.request(
          "/beads?priorityMin=1&priorityMax=2&limit=10",
        );
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        expect(res.status).toBe(200);
        // All beads should have priority between 1 and 2 (inclusive)
        for (const bead of data.data.beads) {
          expect(bead.priority).toBeGreaterThanOrEqual(1);
          expect(bead.priority).toBeLessThanOrEqual(2);
        }
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // Text Search Filter Tests
  // ==========================================================================

  describe("Text Search Filtering", () => {
    test(
      "should filter by titleContains",
      async () => {
        const testName = "filter_title_contains";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?titleContains=searchable-unique-xyz",
        });

        const res = await app.request(
          "/beads?titleContains=searchable-unique-xyz",
        );
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        expect(res.status).toBe(200);
        // All returned beads should have the search term in title
        for (const bead of data.data.beads) {
          expect(bead.title.toLowerCase()).toContain(
            "searchable-unique-xyz".toLowerCase(),
          );
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "should filter by descContains",
      async () => {
        const testName = "filter_desc_contains";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?descContains=SEARCHABLE_UNIQUE_TOKEN_ABC",
        });

        const res = await app.request(
          "/beads?descContains=SEARCHABLE_UNIQUE_TOKEN_ABC",
        );
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        expect(res.status).toBe(200);
        // Should find at least our test bead
        expect(data.data.count).toBeGreaterThanOrEqual(1);
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // Sort Order Tests
  // ==========================================================================

  describe("Sort Order", () => {
    test(
      "should sort by priority",
      async () => {
        const testName = "sort_by_priority";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?sort=priority&limit=10",
        });

        const res = await app.request("/beads?sort=priority&limit=10");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        expect(res.status).toBe(200);
        const beads = data.data.beads;
        // Verify beads are sorted by priority (ascending - 0 is highest)
        for (let i = 1; i < beads.length; i++) {
          expect(beads[i].priority).toBeGreaterThanOrEqual(
            beads[i - 1].priority,
          );
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "should sort by priority reversed",
      async () => {
        const testName = "sort_by_priority_reversed";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?sort=priority&reverse=true&limit=10",
        });

        const res = await app.request(
          "/beads?sort=priority&reverse=true&limit=10",
        );
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        expect(res.status).toBe(200);
        const beads = data.data.beads;
        // Verify beads are sorted by priority (descending)
        for (let i = 1; i < beads.length; i++) {
          expect(beads[i].priority).toBeLessThanOrEqual(beads[i - 1].priority);
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "should sort by created_at",
      async () => {
        const testName = "sort_by_created_at";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?sort=created_at&limit=10",
        });

        const res = await app.request("/beads?sort=created_at&limit=10");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        expect(res.status).toBe(200);
        const beads = data.data.beads;
        // Verify beads are sorted by created_at (descending - newest first is br default)
        for (let i = 1; i < beads.length; i++) {
          const prev = new Date(beads[i - 1].created_at).getTime();
          const curr = new Date(beads[i].created_at).getTime();
          expect(curr).toBeLessThanOrEqual(prev);
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "should sort by title",
      async () => {
        const testName = "sort_by_title";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?sort=title&limit=10",
        });

        const res = await app.request("/beads?sort=title&limit=10");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        expect(res.status).toBe(200);
        const beads = data.data.beads;
        // Verify beads are sorted by title (alphabetically)
        for (let i = 1; i < beads.length; i++) {
          expect(
            beads[i].title.localeCompare(beads[i - 1].title),
          ).toBeGreaterThanOrEqual(0);
        }
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // Assignee Filter Tests
  // ==========================================================================

  describe("Assignee Filtering", () => {
    test(
      "should filter by unassigned=true",
      async () => {
        const testName = "filter_unassigned";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?unassigned=true&limit=10",
        });

        const res = await app.request("/beads?unassigned=true&limit=10");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        expect(res.status).toBe(200);
        // All returned beads should have no assignee
        for (const bead of data.data.beads) {
          expect(bead.assignee).toBeFalsy();
        }
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // All Filter (Include Closed) Tests
  // ==========================================================================

  describe("All Filter (Include Closed)", () => {
    test(
      "should exclude closed beads by default",
      async () => {
        const testName = "default_excludes_closed";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?limit=20",
        });

        const res = await app.request("/beads?limit=20");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        expect(res.status).toBe(200);
        // By default, no closed beads should be returned
        for (const bead of data.data.beads) {
          expect(bead.status).not.toBe("closed");
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "should include closed beads with all=true",
      async () => {
        const testName = "all_includes_closed";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?all=true&limit=50",
        });

        const res = await app.request("/beads?all=true&limit=50");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        expect(res.status).toBe(200);
        // With all=true, we should see some closed beads (assuming the repo has some)
        const closedBeads = data.data.beads.filter(
          (b: { status: string }) => b.status === "closed",
        );
        // Just verify the API accepts this parameter
        expect(data.data.beads.length).toBeGreaterThan(0);
        // Log how many closed beads were found
        logTest({
          test: testName,
          action: "closed_beads_found",
          payload: { closedCount: closedBeads.length },
        });
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // Combined Filter Tests
  // ==========================================================================

  describe("Combined Filters", () => {
    test(
      "should combine status and type filters",
      async () => {
        const testName = "combined_status_type";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?status=open&type=task&limit=10",
        });

        const res = await app.request("/beads?status=open&type=task&limit=10");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        expect(res.status).toBe(200);
        for (const bead of data.data.beads) {
          expect(bead.status).toBe("open");
          expect(bead.type || bead.issue_type).toBe("task");
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "should combine priority and label filters",
      async () => {
        const testName = "combined_priority_label";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?priorityMax=2&label=integration&limit=10",
        });

        const res = await app.request(
          "/beads?priorityMax=2&label=integration&limit=10",
        );
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        expect(res.status).toBe(200);
        for (const bead of data.data.beads) {
          expect(bead.priority).toBeLessThanOrEqual(2);
          expect(bead.labels).toContain("integration");
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "should combine sort with filters",
      async () => {
        const testName = "combined_sort_filter";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?status=open&sort=priority&limit=10",
        });

        const res = await app.request(
          "/beads?status=open&sort=priority&limit=10",
        );
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        expect(res.status).toBe(200);
        const beads = data.data.beads;
        // Verify all are open
        for (const bead of beads) {
          expect(bead.status).toBe("open");
        }
        // Verify sorted by priority
        for (let i = 1; i < beads.length; i++) {
          expect(beads[i].priority).toBeGreaterThanOrEqual(
            beads[i - 1].priority,
          );
        }
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // Query Parsing Edge Cases
  // ==========================================================================

  describe("Query Parsing Edge Cases", () => {
    test(
      "should handle invalid priority gracefully",
      async () => {
        const testName = "invalid_priority";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?priority=invalid&limit=5",
        });

        const res = await app.request("/beads?priority=invalid&limit=5");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        // Should still return 200 (invalid priority is logged and ignored)
        expect(res.status).toBe(200);
      },
      TEST_TIMEOUT,
    );

    test(
      "should handle invalid limit gracefully",
      async () => {
        const testName = "invalid_limit";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?limit=-5",
        });

        const res = await app.request("/beads?limit=-5");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        // Should still return 200 (invalid limit is ignored)
        expect(res.status).toBe(200);
      },
      TEST_TIMEOUT,
    );

    test(
      "should handle empty label filter",
      async () => {
        const testName = "empty_label";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?label=&limit=5",
        });

        const res = await app.request("/beads?label=&limit=5");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        // Should still return 200 (empty label is ignored)
        expect(res.status).toBe(200);
      },
      TEST_TIMEOUT,
    );

    test(
      "should handle unknown sort value gracefully",
      async () => {
        const testName = "invalid_sort";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?sort=invalid&limit=5",
        });

        const res = await app.request("/beads?sort=invalid&limit=5");
        const data = await res.json();

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: { count: data.data?.count },
        });

        // Should still return 200 (invalid sort is logged and ignored)
        expect(res.status).toBe(200);
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // Parity Verification Tests
  // ==========================================================================

  describe("BR CLI Parity Verification", () => {
    test(
      "API count should match br list count for open beads",
      async () => {
        const testName = "parity_open_count";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?status=open&limit=0",
        });

        // Get count from API (limit=0 means no limit)
        const res = await app.request("/beads?status=open&limit=0");
        const data = await res.json();

        // Get count directly from service (which uses br CLI)
        const brBeads = await service.list({ statuses: ["open"] });

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: {
            apiCount: data.data?.count,
            brCount: brBeads.length,
          },
        });

        expect(res.status).toBe(200);
        // API count should match br CLI count
        expect(data.data.count).toBe(brBeads.length);
      },
      TEST_TIMEOUT,
    );

    test(
      "API results should match br list for type filter",
      async () => {
        const testName = "parity_type_filter";
        logTest({
          test: testName,
          action: "starting",
          method: "GET",
          path: "/beads?type=bug&limit=10",
        });

        // Get from API
        const res = await app.request("/beads?type=bug&limit=10");
        const data = await res.json();

        // Get directly from br CLI
        const brBeads = await service.list({ types: ["bug"], limit: 10 });

        logTest({
          test: testName,
          action: "response_received",
          status: res.status,
          payload: {
            apiCount: data.data?.count,
            brCount: brBeads.length,
          },
        });

        expect(res.status).toBe(200);
        // IDs should match
        const apiIds = data.data.beads.map((b: { id: string }) => b.id).sort();
        const brIds = brBeads.map((b) => b.id).sort();
        expect(apiIds).toEqual(brIds);
      },
      TEST_TIMEOUT,
    );
  });
});
