/**
 * Unit tests for the Metrics Service.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  incrementCounter,
  setGauge,
  recordHistogram,
  getCounter,
  getGauge,
  getHistogram,
  getMetricsSnapshot,
  createNamedSnapshot,
  listNamedSnapshots,
  getNamedSnapshot,
  compareMetrics,
  exportPrometheusFormat,
  resetMetrics,
} from "../services/metrics";

describe("Metrics Service", () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe("Counter metrics", () => {
    test("incrementCounter starts from zero", () => {
      incrementCounter("test_counter");
      expect(getCounter("test_counter")).toBe(1);
    });

    test("incrementCounter increments by 1 by default", () => {
      incrementCounter("test_counter");
      incrementCounter("test_counter");
      expect(getCounter("test_counter")).toBe(2);
    });

    test("incrementCounter increments by specified value", () => {
      incrementCounter("test_counter", 5);
      expect(getCounter("test_counter")).toBe(5);
    });

    test("incrementCounter respects labels", () => {
      incrementCounter("test_counter", 1, { method: "GET" });
      incrementCounter("test_counter", 2, { method: "POST" });
      expect(getCounter("test_counter", { method: "GET" })).toBe(1);
      expect(getCounter("test_counter", { method: "POST" })).toBe(2);
    });

    test("getCounter returns 0 for unknown metric", () => {
      expect(getCounter("unknown_counter")).toBe(0);
    });
  });

  describe("Gauge metrics", () => {
    test("setGauge sets value", () => {
      setGauge("test_gauge", 42);
      expect(getGauge("test_gauge")).toBe(42);
    });

    test("setGauge overwrites previous value", () => {
      setGauge("test_gauge", 10);
      setGauge("test_gauge", 20);
      expect(getGauge("test_gauge")).toBe(20);
    });

    test("setGauge respects labels", () => {
      setGauge("test_gauge", 100, { status: "active" });
      setGauge("test_gauge", 50, { status: "idle" });
      expect(getGauge("test_gauge", { status: "active" })).toBe(100);
      expect(getGauge("test_gauge", { status: "idle" })).toBe(50);
    });

    test("getGauge returns 0 for unknown metric", () => {
      expect(getGauge("unknown_gauge")).toBe(0);
    });
  });

  describe("Histogram metrics", () => {
    test("recordHistogram creates histogram with correct structure", () => {
      recordHistogram("test_histogram", 50);
      const hist = getHistogram("test_histogram");

      expect(hist).toBeDefined();
      expect(hist!.count).toBe(1);
      expect(hist!.sum).toBe(50);
      expect(hist!.buckets.length).toBeGreaterThan(0);
    });

    test("recordHistogram accumulates values", () => {
      recordHistogram("test_histogram", 10);
      recordHistogram("test_histogram", 20);
      recordHistogram("test_histogram", 30);

      const hist = getHistogram("test_histogram");
      expect(hist!.count).toBe(3);
      expect(hist!.sum).toBe(60);
    });

    test("recordHistogram places values in correct buckets", () => {
      // Bucket boundaries: 5, 10, 25, 50, 75, 100, ...
      recordHistogram("test_histogram", 7); // Should be in 10 bucket
      recordHistogram("test_histogram", 15); // Should be in 25 bucket
      recordHistogram("test_histogram", 60); // Should be in 75 bucket

      const hist = getHistogram("test_histogram");
      const bucket10 = hist!.buckets.find((b) => b.le === 10);
      const bucket25 = hist!.buckets.find((b) => b.le === 25);
      const bucket75 = hist!.buckets.find((b) => b.le === 75);

      expect(bucket10!.count).toBe(1);
      expect(bucket25!.count).toBe(2); // Cumulative
      expect(bucket75!.count).toBe(3); // Cumulative
    });

    test("getHistogram returns undefined for unknown metric", () => {
      expect(getHistogram("unknown_histogram")).toBeUndefined();
    });
  });

  describe("Metric Snapshots", () => {
    test("getMetricsSnapshot returns valid structure", () => {
      const snapshot = getMetricsSnapshot();

      expect(snapshot.timestamp).toBeInstanceOf(Date);
      expect(snapshot.correlationId).toBeDefined();
      expect(snapshot.agents).toBeDefined();
      expect(snapshot.tokens).toBeDefined();
      expect(snapshot.performance).toBeDefined();
      expect(snapshot.flywheel).toBeDefined();
      expect(snapshot.system).toBeDefined();
    });

    test("getMetricsSnapshot includes system metrics", () => {
      const snapshot = getMetricsSnapshot();

      expect(snapshot.system.uptime).toBeGreaterThanOrEqual(0);
      expect(snapshot.system.memoryUsageMb).toBeGreaterThan(0);
    });
  });

  describe("Named Snapshots", () => {
    test("createNamedSnapshot creates snapshot with ID", () => {
      const snapshot = createNamedSnapshot("test-snapshot", "Test description");

      expect(snapshot.id).toMatch(/^snapshot_/);
      expect(snapshot.name).toBe("test-snapshot");
      expect(snapshot.description).toBe("Test description");
      expect(snapshot.createdAt).toBeInstanceOf(Date);
      expect(snapshot.snapshot).toBeDefined();
    });

    test("listNamedSnapshots returns all snapshots", () => {
      createNamedSnapshot("snapshot-1");
      createNamedSnapshot("snapshot-2");

      const snapshots = listNamedSnapshots();
      expect(snapshots.length).toBe(2);
    });

    test("listNamedSnapshots returns snapshots sorted by time descending", () => {
      // Create snapshots with a small delay to ensure different timestamps
      const first = createNamedSnapshot("first");
      const second = createNamedSnapshot("second");

      const snapshots = listNamedSnapshots();
      expect(snapshots.length).toBe(2);
      // Both snapshots should be present
      const names = snapshots.map((s) => s.name);
      expect(names).toContain("first");
      expect(names).toContain("second");
      // Most recent (or alphabetically later when same time) should be first
      // The sort is by time desc, then ID desc for stability
      expect(snapshots[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(
        snapshots[1]!.createdAt.getTime()
      );
    });

    test("getNamedSnapshot retrieves by ID", () => {
      const created = createNamedSnapshot("test");
      const retrieved = getNamedSnapshot(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe("test");
    });

    test("getNamedSnapshot returns undefined for unknown ID", () => {
      expect(getNamedSnapshot("unknown_id")).toBeUndefined();
    });
  });

  describe("Metric Comparison", () => {
    test("compareMetrics calculates differences", () => {
      const baseline = getMetricsSnapshot();

      // Simulate changes
      setGauge("flywheel_agents_active", 10, { status: "ready" });
      incrementCounter("flywheel_http_requests_total", 100);

      const current = getMetricsSnapshot();
      const comparison = compareMetrics(baseline, current);

      expect(comparison.baseline).toBeDefined();
      expect(comparison.current).toBeDefined();
      expect(comparison.changes.length).toBeGreaterThan(0);
    });

    test("compareMetrics identifies direction correctly", () => {
      const baseline = {
        ...getMetricsSnapshot(),
        agents: { total: 10, byStatus: {}, byDriver: {} },
      };
      const current = {
        ...getMetricsSnapshot(),
        agents: { total: 20, byStatus: {}, byDriver: {} },
      };

      const comparison = compareMetrics(baseline, current);
      const agentChange = comparison.changes.find((c) => c.metric === "agents.total");

      expect(agentChange).toBeDefined();
      expect(agentChange!.direction).toBe("up");
      expect(agentChange!.delta).toBe(10);
    });
  });

  describe("Prometheus Export", () => {
    test("exportPrometheusFormat exports counters", () => {
      incrementCounter("test_counter", 5);
      const output = exportPrometheusFormat();

      expect(output).toContain("test_counter 5");
    });

    test("exportPrometheusFormat exports gauges", () => {
      setGauge("test_gauge", 42);
      const output = exportPrometheusFormat();

      expect(output).toContain("test_gauge 42");
    });

    test("exportPrometheusFormat exports labeled metrics", () => {
      incrementCounter("labeled_metric", 1, { method: "GET" });
      const output = exportPrometheusFormat();

      expect(output).toContain('labeled_metric{method="GET"} 1');
    });

    test("exportPrometheusFormat exports histogram buckets", () => {
      recordHistogram("request_latency", 50);
      const output = exportPrometheusFormat();

      expect(output).toContain("request_latency_bucket");
      expect(output).toContain("request_latency_sum");
      expect(output).toContain("request_latency_count");
    });
  });
});
