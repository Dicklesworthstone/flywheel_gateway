import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  getPerformanceMonitor,
  mark,
  measure,
  PerformanceMonitor,
  timeExecution,
} from "../monitor";

// Mock PerformanceObserver for Node/Bun environment
const mockPerformanceObserver = {
  observe: mock(() => {}),
  disconnect: mock(() => {}),
};

globalThis.PerformanceObserver = class {
  constructor(callback: PerformanceObserverCallback) {
    // Store callback if needed
  }
  observe() {}
  disconnect() {}
} as unknown as typeof PerformanceObserver;

describe("PerformanceMonitor", () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor();
  });

  describe("getMetrics", () => {
    it("should return metrics object", () => {
      const metrics = monitor.getMetrics();

      expect(metrics).toBeDefined();
      expect(typeof metrics.longTasks).toBe("number");
      expect(metrics.fcp).toBeNull();
      expect(metrics.lcp).toBeNull();
    });
  });

  describe("subscribe", () => {
    it("should return unsubscribe function", () => {
      const callback = mock(() => {});
      const unsubscribe = monitor.subscribe(callback);

      // unsubscribe should be a function
      expect(typeof unsubscribe).toBe("function");
      unsubscribe();
    });
  });

  describe("updateRuntimeMetrics", () => {
    it("should handle non-browser environment gracefully", () => {
      // In test environment (no window/document), should not throw
      monitor.updateRuntimeMetrics();
      const metrics = monitor.getMetrics();

      // domNodes should remain null in non-browser environment
      expect(metrics.domNodes).toBeNull();
    });
  });

  describe("getReport", () => {
    it("should return performance report", () => {
      const report = monitor.getReport();

      expect(report.metrics).toBeDefined();
      expect(report.longTasks).toBeInstanceOf(Array);
      expect(typeof report.timestamp).toBe("number");
      // url is empty string in non-browser environment
      expect(typeof report.url).toBe("string");
      expect(report.url).toBe("");
    });
  });

  describe("checkThresholds", () => {
    it("should pass when metrics are below thresholds", () => {
      const result = monitor.checkThresholds({
        longTasks: 100,
      });

      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it("should fail when metrics exceed thresholds", () => {
      // Manually set a metric that will fail
      // Since longTasks starts at 0, it should pass
      const result = monitor.checkThresholds({
        longTasks: -1, // Any positive value will fail this
      });

      // longTasks is 0, which is > -1, so should fail
      expect(result.passed).toBe(false);
    });
  });

  describe("getWebVitalsRating", () => {
    it("should return ratings for all web vitals", () => {
      const ratings = monitor.getWebVitalsRating();

      expect(ratings).toHaveProperty("lcp");
      expect(ratings).toHaveProperty("fid");
      expect(ratings).toHaveProperty("cls");
      expect(ratings).toHaveProperty("inp");
      expect(ratings).toHaveProperty("ttfb");

      // All should be 'unknown' since no data collected
      Object.values(ratings).forEach((rating) => {
        expect(rating).toBe("unknown");
      });
    });
  });

  describe("disconnect", () => {
    it("should clean up observers", () => {
      monitor.disconnect();
      // Should not throw
      expect(true).toBe(true);
    });
  });
});

describe("getPerformanceMonitor", () => {
  it("should return singleton instance", () => {
    const monitor1 = getPerformanceMonitor();
    const monitor2 = getPerformanceMonitor();

    expect(monitor1).toBe(monitor2);
  });
});

describe("mark and measure", () => {
  it("should create performance marks", () => {
    mark("test-start");
    mark("test-end");

    // Should not throw
    expect(true).toBe(true);
  });

  it("should measure between marks", () => {
    mark("measure-start");
    mark("measure-end");

    const duration = measure("test-measure", "measure-start", "measure-end");

    expect(typeof duration).toBe("number");
    expect(duration).toBeGreaterThanOrEqual(0);
  });
});

describe("timeExecution", () => {
  it("should time synchronous function", async () => {
    const { result, duration } = await timeExecution("sync-test", () => {
      return 42;
    });

    expect(result).toBe(42);
    expect(typeof duration).toBe("number");
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it("should time async function", async () => {
    const { result, duration } = await timeExecution("async-test", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "done";
    });

    expect(result).toBe("done");
    expect(duration).toBeGreaterThanOrEqual(10);
  });
});
