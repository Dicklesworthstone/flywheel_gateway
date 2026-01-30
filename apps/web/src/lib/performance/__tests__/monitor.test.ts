import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  getPerformanceMonitor,
  mark,
  measure,
  PerformanceMonitor,
  timeExecution,
} from "../monitor";

// Mock PerformanceObserver for Node/Bun environment
const _mockPerformanceObserver = {
  observe: mock(() => {}),
  disconnect: mock(() => {}),
};

globalThis.PerformanceObserver = class {
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
      // In test environment, should not throw
      monitor.updateRuntimeMetrics();
      const metrics = monitor.getMetrics();

      // In Bun test env (with happy-dom), document is defined so domNodes will be a number
      // In pure Node/non-browser env, domNodes would be null
      if (typeof document !== "undefined") {
        expect(typeof metrics.domNodes).toBe("number");
        expect(metrics.domNodes).toBeGreaterThanOrEqual(0);
      } else {
        expect(metrics.domNodes).toBeNull();
      }
    });
  });

  describe("getReport", () => {
    it("should return performance report", () => {
      const report = monitor.getReport();

      expect(report.metrics).toBeDefined();
      expect(report.longTasks).toBeInstanceOf(Array);
      expect(typeof report.timestamp).toBe("number");
      // In Bun test env (with happy-dom), window.location.href is 'about:blank'
      // In pure non-browser env, url would be empty string
      expect(typeof report.url).toBe("string");
      if (typeof window !== "undefined") {
        expect(report.url).toBe(window.location.href);
      } else {
        expect(report.url).toBe("");
      }
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

  describe("frame rate monitoring", () => {
    it("should clear interval even when id is 0", () => {
      const originalSetInterval = globalThis.setInterval;
      const originalClearInterval = globalThis.clearInterval;
      const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
      const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

      const setIntervalMock = mock(
        () => 0 as unknown as ReturnType<typeof setInterval>,
      );
      const clearIntervalMock = mock(() => {});
      const requestAnimationFrameMock = mock(() => 1);
      const cancelAnimationFrameMock = mock(() => {});

      globalThis.setInterval = setIntervalMock as typeof setInterval;
      globalThis.clearInterval = clearIntervalMock as typeof clearInterval;
      globalThis.requestAnimationFrame =
        requestAnimationFrameMock as typeof requestAnimationFrame;
      globalThis.cancelAnimationFrame =
        cancelAnimationFrameMock as typeof cancelAnimationFrame;

      try {
        monitor.startFrameRateMonitoring(1000);
        monitor.stopFrameRateMonitoring();

        expect(clearIntervalMock).toHaveBeenCalledTimes(1);
        expect(clearIntervalMock).toHaveBeenCalledWith(0);
        expect(cancelAnimationFrameMock).toHaveBeenCalledTimes(1);
        expect(cancelAnimationFrameMock).toHaveBeenCalledWith(1);
      } finally {
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
        globalThis.requestAnimationFrame = originalRequestAnimationFrame;
        globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
      }
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
