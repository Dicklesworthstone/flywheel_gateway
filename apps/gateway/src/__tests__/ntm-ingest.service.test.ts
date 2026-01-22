/**
 * NTM Ingest Service Tests
 *
 * Tests for NTM state mapping and ingest service functionality.
 * Part of bead bd-1m7s: Tests for NTM driver + ingest service.
 */

import { describe, expect, test } from "bun:test";
import { LifecycleState } from "../models/agent-state";
import {
  mapNtmHealthToLifecycle,
  mapNtmStateToLifecycle,
  type NtmAgentState,
  type NtmHealthStatus,
  type NtmIngestConfig,
} from "../services/ntm-ingest.service";

// ============================================================================
// State Mapping Tests
// ============================================================================

describe("mapNtmStateToLifecycle", () => {
  describe("maps NTM states to lifecycle states", () => {
    test("idle maps to READY", () => {
      expect(mapNtmStateToLifecycle("idle")).toBe(LifecycleState.READY);
    });

    test("waiting maps to READY", () => {
      expect(mapNtmStateToLifecycle("waiting")).toBe(LifecycleState.READY);
    });

    test("working maps to EXECUTING", () => {
      expect(mapNtmStateToLifecycle("working")).toBe(LifecycleState.EXECUTING);
    });

    test("thinking maps to EXECUTING", () => {
      expect(mapNtmStateToLifecycle("thinking")).toBe(LifecycleState.EXECUTING);
    });

    test("tool_calling maps to EXECUTING", () => {
      expect(mapNtmStateToLifecycle("tool_calling")).toBe(
        LifecycleState.EXECUTING,
      );
    });

    test("error maps to FAILED", () => {
      expect(mapNtmStateToLifecycle("error")).toBe(LifecycleState.FAILED);
    });

    test("stalled maps to PAUSED", () => {
      expect(mapNtmStateToLifecycle("stalled")).toBe(LifecycleState.PAUSED);
    });
  });

  describe("warning states return null (no lifecycle change)", () => {
    test("rate_limited returns null", () => {
      expect(mapNtmStateToLifecycle("rate_limited")).toBeNull();
    });

    test("context_low returns null", () => {
      expect(mapNtmStateToLifecycle("context_low")).toBeNull();
    });
  });

  describe("handles unknown states", () => {
    test("unknown state returns null", () => {
      expect(mapNtmStateToLifecycle("unknown" as NtmAgentState)).toBeNull();
    });
  });

  describe("state mapping consistency", () => {
    test("all working-related states map to EXECUTING", () => {
      const workingStates: NtmAgentState[] = [
        "working",
        "thinking",
        "tool_calling",
      ];
      for (const state of workingStates) {
        expect(mapNtmStateToLifecycle(state)).toBe(LifecycleState.EXECUTING);
      }
    });

    test("all idle-related states map to READY", () => {
      const idleStates: NtmAgentState[] = ["idle", "waiting"];
      for (const state of idleStates) {
        expect(mapNtmStateToLifecycle(state)).toBe(LifecycleState.READY);
      }
    });

    test("warning states dont change lifecycle", () => {
      const warningStates: NtmAgentState[] = ["rate_limited", "context_low"];
      for (const state of warningStates) {
        expect(mapNtmStateToLifecycle(state)).toBeNull();
      }
    });
  });
});

// ============================================================================
// Health Mapping Tests
// ============================================================================

describe("mapNtmHealthToLifecycle", () => {
  describe("unhealthy triggers FAILED", () => {
    test("unhealthy with READY state triggers FAILED", () => {
      expect(mapNtmHealthToLifecycle("unhealthy", LifecycleState.READY)).toBe(
        LifecycleState.FAILED,
      );
    });

    test("unhealthy with EXECUTING state triggers FAILED", () => {
      expect(
        mapNtmHealthToLifecycle("unhealthy", LifecycleState.EXECUTING),
      ).toBe(LifecycleState.FAILED);
    });

    test("unhealthy with PAUSED state triggers FAILED", () => {
      expect(mapNtmHealthToLifecycle("unhealthy", LifecycleState.PAUSED)).toBe(
        LifecycleState.FAILED,
      );
    });

    test("unhealthy with no current state returns null (requires known state)", () => {
      // When currentState is undefined, we don't know if it's FAILED already
      // so the function conservatively returns null
      expect(mapNtmHealthToLifecycle("unhealthy", undefined)).toBeNull();
    });

    test("unhealthy with already FAILED state returns null (no change)", () => {
      expect(mapNtmHealthToLifecycle("unhealthy", LifecycleState.FAILED)).toBe(
        null,
      );
    });
  });

  describe("healthy and degraded dont trigger changes", () => {
    test("healthy returns null regardless of current state", () => {
      expect(
        mapNtmHealthToLifecycle("healthy", LifecycleState.READY),
      ).toBeNull();
      expect(
        mapNtmHealthToLifecycle("healthy", LifecycleState.EXECUTING),
      ).toBeNull();
      expect(
        mapNtmHealthToLifecycle("healthy", LifecycleState.FAILED),
      ).toBeNull();
      expect(mapNtmHealthToLifecycle("healthy", undefined)).toBeNull();
    });

    test("degraded returns null regardless of current state", () => {
      expect(
        mapNtmHealthToLifecycle("degraded", LifecycleState.READY),
      ).toBeNull();
      expect(
        mapNtmHealthToLifecycle("degraded", LifecycleState.EXECUTING),
      ).toBeNull();
      expect(
        mapNtmHealthToLifecycle("degraded", LifecycleState.FAILED),
      ).toBeNull();
      expect(mapNtmHealthToLifecycle("degraded", undefined)).toBeNull();
    });
  });

  describe("all health statuses", () => {
    const healthStatuses: NtmHealthStatus[] = [
      "healthy",
      "degraded",
      "unhealthy",
    ];

    test("all health statuses are handled", () => {
      for (const health of healthStatuses) {
        // Should not throw
        const result = mapNtmHealthToLifecycle(health);
        expect(result === null || typeof result === "string").toBe(true);
      }
    });
  });
});

// ============================================================================
// NTM State Type Coverage
// ============================================================================

describe("NTM State types", () => {
  test("all NtmAgentState values are valid", () => {
    const allStates: NtmAgentState[] = [
      "idle",
      "working",
      "thinking",
      "tool_calling",
      "waiting",
      "error",
      "stalled",
      "rate_limited",
      "context_low",
    ];

    for (const state of allStates) {
      // Should not throw - all states should be handled
      const result = mapNtmStateToLifecycle(state);
      expect(result === null || typeof result === "string").toBe(true);
    }
  });

  test("all NtmHealthStatus values are valid", () => {
    const allStatuses: NtmHealthStatus[] = ["healthy", "degraded", "unhealthy"];

    for (const status of allStatuses) {
      // Should not throw
      const result = mapNtmHealthToLifecycle(status);
      expect(result === null || typeof result === "string").toBe(true);
    }
  });
});

// ============================================================================
// Config Defaults Tests
// ============================================================================

describe("NtmIngestConfig defaults", () => {
  test("default pollIntervalMs is documented as 5000", () => {
    // This tests the documented default - actual default is in the service
    const defaultConfig: NtmIngestConfig = {};
    expect(defaultConfig.pollIntervalMs).toBeUndefined();
    // When undefined, service uses 5000ms
  });

  test("default maxBackoffMultiplier is documented as 6", () => {
    const defaultConfig: NtmIngestConfig = {};
    expect(defaultConfig.maxBackoffMultiplier).toBeUndefined();
    // When undefined, service uses 6
  });

  test("default commandTimeoutMs is documented as 10000", () => {
    const defaultConfig: NtmIngestConfig = {};
    expect(defaultConfig.commandTimeoutMs).toBeUndefined();
    // When undefined, service uses 10000ms
  });

  test("config accepts all optional fields", () => {
    const fullConfig: NtmIngestConfig = {
      pollIntervalMs: 3000,
      maxBackoffMultiplier: 4,
      cwd: "/tmp",
      commandTimeoutMs: 5000,
    };

    expect(fullConfig.pollIntervalMs).toBe(3000);
    expect(fullConfig.maxBackoffMultiplier).toBe(4);
    expect(fullConfig.cwd).toBe("/tmp");
    expect(fullConfig.commandTimeoutMs).toBe(5000);
  });
});

// ============================================================================
// State Transition Scenarios
// ============================================================================

describe("State transition scenarios", () => {
  describe("agent startup sequence", () => {
    test("idle -> READY on startup", () => {
      expect(mapNtmStateToLifecycle("idle")).toBe(LifecycleState.READY);
    });

    test("working -> EXECUTING when task starts", () => {
      expect(mapNtmStateToLifecycle("working")).toBe(LifecycleState.EXECUTING);
    });

    test("idle -> READY when task completes", () => {
      expect(mapNtmStateToLifecycle("idle")).toBe(LifecycleState.READY);
    });
  });

  describe("error scenarios", () => {
    test("error -> FAILED on agent error", () => {
      expect(mapNtmStateToLifecycle("error")).toBe(LifecycleState.FAILED);
    });

    test("unhealthy health -> FAILED", () => {
      expect(
        mapNtmHealthToLifecycle("unhealthy", LifecycleState.EXECUTING),
      ).toBe(LifecycleState.FAILED);
    });

    test("stalled -> PAUSED to allow recovery", () => {
      expect(mapNtmStateToLifecycle("stalled")).toBe(LifecycleState.PAUSED);
    });
  });

  describe("warning scenarios (no state change)", () => {
    test("rate_limited does not change state", () => {
      const result = mapNtmStateToLifecycle(
        "rate_limited",
        LifecycleState.EXECUTING,
      );
      expect(result).toBeNull();
    });

    test("context_low does not change state", () => {
      const result = mapNtmStateToLifecycle(
        "context_low",
        LifecycleState.EXECUTING,
      );
      expect(result).toBeNull();
    });

    test("degraded health does not change state", () => {
      const result = mapNtmHealthToLifecycle(
        "degraded",
        LifecycleState.EXECUTING,
      );
      expect(result).toBeNull();
    });
  });
});
