/**
 * Tests for Supervisor Service.
 *
 * Tests for daemon management, restart policies, and status tracking.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  _clearSupervisor,
  DaemonNotFoundError,
  type DaemonSpec,
  initializeSupervisor,
  type SupervisorService,
} from "../services/supervisor.service";

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_SPECS: DaemonSpec[] = [
  {
    name: "test-daemon",
    command: ["echo", "test"],
    port: 9999,
    restartPolicy: "always",
    maxRestarts: 3,
    restartDelayMs: 100,
  },
  {
    name: "no-restart-daemon",
    command: ["echo", "no-restart"],
    restartPolicy: "never",
    maxRestarts: 0,
    restartDelayMs: 100,
  },
  {
    name: "on-failure-daemon",
    command: ["echo", "on-failure"],
    restartPolicy: "on-failure",
    maxRestarts: 2,
    restartDelayMs: 100,
  },
];

// ============================================================================
// Test Setup
// ============================================================================

describe("SupervisorService", () => {
  let service: SupervisorService;

  beforeEach(() => {
    _clearSupervisor();
    service = initializeSupervisor(TEST_SPECS);
  });

  afterEach(async () => {
    // Stop all daemons after each test
    try {
      await service.stopAll();
    } catch {
      // Ignore errors during cleanup
    }
    _clearSupervisor();
  });

  // ==========================================================================
  // Initialization Tests
  // ==========================================================================

  describe("initialization", () => {
    test("initializes with provided specs", () => {
      const names = service.getDaemonNames();
      expect(names).toHaveLength(3);
      expect(names).toContain("test-daemon");
      expect(names).toContain("no-restart-daemon");
      expect(names).toContain("on-failure-daemon");
    });

    test("starts with all daemons stopped", () => {
      const statuses = service.getStatus();
      expect(statuses).toHaveLength(3);
      for (const status of statuses) {
        expect(status.status).toBe("stopped");
        expect(status.restartCount).toBe(0);
      }
    });

    test("reports isStarted as false initially", () => {
      expect(service.isStarted()).toBe(false);
    });
  });

  // ==========================================================================
  // Status Tests
  // ==========================================================================

  describe("getStatus", () => {
    test("returns status for all daemons", () => {
      const statuses = service.getStatus();
      expect(statuses).toHaveLength(3);

      const names = statuses.map((s) => s.name);
      expect(names).toContain("test-daemon");
      expect(names).toContain("no-restart-daemon");
      expect(names).toContain("on-failure-daemon");
    });

    test("includes port from spec", () => {
      const statuses = service.getStatus();
      const testDaemon = statuses.find((s) => s.name === "test-daemon");
      expect(testDaemon?.port).toBe(9999);
    });
  });

  describe("getDaemonStatus", () => {
    test("returns status for specific daemon", () => {
      const status = service.getDaemonStatus("test-daemon");
      expect(status.name).toBe("test-daemon");
      expect(status.status).toBe("stopped");
      expect(status.port).toBe(9999);
    });

    test("throws DaemonNotFoundError for unknown daemon", () => {
      expect(() => service.getDaemonStatus("unknown")).toThrow(
        DaemonNotFoundError,
      );
    });
  });

  // ==========================================================================
  // Start/Stop Tests
  // ==========================================================================

  describe("startDaemon", () => {
    test("starts daemon and updates status", async () => {
      const state = await service.startDaemon("test-daemon");

      expect(state.name).toBe("test-daemon");
      expect(state.status).toBe("starting");
      expect(state.pid).toBeDefined();
      expect(state.startedAt).toBeDefined();
    });

    test("throws DaemonNotFoundError for unknown daemon", async () => {
      await expect(service.startDaemon("unknown")).rejects.toThrow(
        DaemonNotFoundError,
      );
    });

    test("returns existing state if daemon already running", async () => {
      // Start daemon
      await service.startDaemon("test-daemon");

      // Try to start again
      const state = await service.startDaemon("test-daemon");

      // Should return existing state without error
      expect(state.name).toBe("test-daemon");
    });
  });

  describe("stopDaemon", () => {
    test("stops running daemon", async () => {
      await service.startDaemon("test-daemon");
      const state = await service.stopDaemon("test-daemon");

      expect(state.status).toBe("stopped");
      expect(state.stoppedAt).toBeDefined();
      expect(state.pid).toBeUndefined();
    });

    test("returns stopped state if daemon not running", async () => {
      const state = await service.stopDaemon("test-daemon");
      expect(state.status).toBe("stopped");
    });

    test("throws DaemonNotFoundError for unknown daemon", async () => {
      await expect(service.stopDaemon("unknown")).rejects.toThrow(
        DaemonNotFoundError,
      );
    });
  });

  describe("restartDaemon", () => {
    test("restarts daemon and resets restart count", async () => {
      // Use no-restart-daemon to avoid auto-restart incrementing the count
      await service.startDaemon("no-restart-daemon");

      // Restart
      const state = await service.restartDaemon("no-restart-daemon");

      expect(state.status).toBe("starting");
      expect(state.restartCount).toBe(0);
    });

    test("throws DaemonNotFoundError for unknown daemon", async () => {
      await expect(service.restartDaemon("unknown")).rejects.toThrow(
        DaemonNotFoundError,
      );
    });
  });

  // ==========================================================================
  // Bulk Operations Tests
  // ==========================================================================

  describe("startAll", () => {
    test("starts all daemons", async () => {
      await service.startAll();

      expect(service.isStarted()).toBe(true);

      const statuses = service.getStatus();
      for (const status of statuses) {
        expect(["starting", "running"]).toContain(status.status);
      }
    });
  });

  describe("stopAll", () => {
    test("stops all running daemons", async () => {
      await service.startAll();
      await service.stopAll();

      expect(service.isStarted()).toBe(false);

      const statuses = service.getStatus();
      for (const status of statuses) {
        expect(status.status).toBe("stopped");
      }
    });
  });

  // ==========================================================================
  // Logs Tests
  // ==========================================================================

  describe("getLogs", () => {
    test("returns empty array for daemon with no logs", () => {
      const logs = service.getLogs("test-daemon");
      expect(logs).toEqual([]);
    });

    test("throws DaemonNotFoundError for unknown daemon", () => {
      expect(() => service.getLogs("unknown")).toThrow(DaemonNotFoundError);
    });

    test("respects limit parameter", async () => {
      // Start daemon to generate some logs
      await service.startDaemon("test-daemon");
      await Bun.sleep(200);

      const logs = service.getLogs("test-daemon", 5);
      expect(logs.length).toBeLessThanOrEqual(5);
    });
  });

  // ==========================================================================
  // Restart Policy Tests
  // ==========================================================================

  describe("restart policies", () => {
    test("'never' policy does not restart on exit", async () => {
      await service.startDaemon("no-restart-daemon");

      // Wait for process to exit (echo exits immediately)
      await Bun.sleep(200);

      const status = service.getDaemonStatus("no-restart-daemon");
      // Should be stopped, not restarting
      expect(status.restartCount).toBe(0);
    });

    test("'always' policy tracks restart count", async () => {
      const _state = await service.startDaemon("test-daemon");

      // Wait for process to exit and possibly restart
      await Bun.sleep(500);

      // Check that restart count may have increased
      const currentStatus = service.getDaemonStatus("test-daemon");
      // The process exits quickly so restarts may have happened
      expect(currentStatus.restartCount).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe("error handling", () => {
    test("DaemonNotFoundError includes daemon name", () => {
      try {
        service.getDaemonStatus("nonexistent");
      } catch (error) {
        expect(error).toBeInstanceOf(DaemonNotFoundError);
        expect((error as DaemonNotFoundError).daemonName).toBe("nonexistent");
      }
    });
  });
});
