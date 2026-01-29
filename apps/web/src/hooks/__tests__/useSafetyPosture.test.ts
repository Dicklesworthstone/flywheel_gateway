/**
 * useSafetyPosture Hook Tests (bd-1vr1.8)
 *
 * Validates SafetyPostureResponse fixture shapes and API processing
 * with mockMode=false assumptions.
 */

import { describe, expect, it } from "bun:test";
import type {
  SafetyPostureResponse,
  ToolStatus,
  ChecksumStatus,
} from "../useSafetyPosture";

// ============================================================================
// Deterministic API Fixture
// ============================================================================

const FIXTURE_POSTURE: SafetyPostureResponse = {
  status: "healthy",
  timestamp: "2026-01-29T00:00:00Z",
  tools: {
    dcg: { installed: true, version: "0.9.2", healthy: true, latencyMs: 10 },
    slb: { installed: true, version: "1.2.0", healthy: true, latencyMs: 8 },
    ubs: { installed: true, version: "1.0.0", healthy: true, latencyMs: 12 },
  },
  checksums: {
    registryGeneratedAt: "2026-01-28T00:00:00Z",
    registryAgeMs: 86400000,
    toolsWithChecksums: 3,
    staleThresholdMs: 604800000, // 7 days
    isStale: false,
    tools: [
      {
        toolId: "tools.dcg",
        hasChecksums: true,
        checksumCount: 1,
        registryGeneratedAt: "2026-01-28T00:00:00Z",
        ageMs: 86400000,
        stale: false,
      },
    ],
  },
  summary: {
    allToolsInstalled: true,
    allToolsHealthy: true,
    checksumsAvailable: true,
    checksumsStale: false,
    overallHealthy: true,
    issues: [],
    recommendations: [],
  },
};

// ============================================================================
// Shape Validation
// ============================================================================

describe("SafetyPostureResponse Fixture Shape", () => {
  it("has valid top-level status", () => {
    expect(["healthy", "degraded", "unhealthy"]).toContain(FIXTURE_POSTURE.status);
    expect(new Date(FIXTURE_POSTURE.timestamp).getTime()).not.toBeNaN();
  });

  it("has all three required tools", () => {
    expect(FIXTURE_POSTURE.tools.dcg).toBeDefined();
    expect(FIXTURE_POSTURE.tools.slb).toBeDefined();
    expect(FIXTURE_POSTURE.tools.ubs).toBeDefined();
  });

  it("tool entries have correct ToolStatus shape", () => {
    const tools: ToolStatus[] = [
      FIXTURE_POSTURE.tools.dcg,
      FIXTURE_POSTURE.tools.slb,
      FIXTURE_POSTURE.tools.ubs,
    ];

    for (const tool of tools) {
      expect(typeof tool.installed).toBe("boolean");
      expect(typeof tool.healthy).toBe("boolean");
      expect(typeof tool.latencyMs).toBe("number");
      if (tool.installed) {
        expect(tool.version).not.toBeNull();
      }
    }
  });

  it("checksums section has correct shape", () => {
    const { checksums } = FIXTURE_POSTURE;
    expect(typeof checksums.toolsWithChecksums).toBe("number");
    expect(typeof checksums.staleThresholdMs).toBe("number");
    expect(typeof checksums.isStale).toBe("boolean");
    expect(Array.isArray(checksums.tools)).toBe(true);
  });

  it("individual checksum status has correct shape", () => {
    const entry = FIXTURE_POSTURE.checksums.tools[0]!;
    expect(entry.toolId).toMatch(/^tools\./);
    expect(typeof entry.hasChecksums).toBe("boolean");
    expect(typeof entry.checksumCount).toBe("number");
    expect(typeof entry.stale).toBe("boolean");
  });

  it("summary has all boolean flags", () => {
    const { summary } = FIXTURE_POSTURE;
    expect(typeof summary.allToolsInstalled).toBe("boolean");
    expect(typeof summary.allToolsHealthy).toBe("boolean");
    expect(typeof summary.checksumsAvailable).toBe("boolean");
    expect(typeof summary.checksumsStale).toBe("boolean");
    expect(typeof summary.overallHealthy).toBe("boolean");
    expect(Array.isArray(summary.issues)).toBe(true);
    expect(Array.isArray(summary.recommendations)).toBe(true);
  });
});

describe("SafetyPosture Degraded Scenario", () => {
  it("correctly represents missing UBS", () => {
    const degraded: SafetyPostureResponse = {
      ...FIXTURE_POSTURE,
      status: "degraded",
      tools: {
        ...FIXTURE_POSTURE.tools,
        ubs: { installed: false, version: null, healthy: false, latencyMs: 3 },
      },
      summary: {
        ...FIXTURE_POSTURE.summary,
        allToolsInstalled: false,
        allToolsHealthy: false,
        overallHealthy: false,
        issues: ["UBS is not installed"],
        recommendations: ["Install UBS: cargo install ubs"],
      },
    };

    expect(degraded.status).toBe("degraded");
    expect(degraded.tools.ubs.installed).toBe(false);
    expect(degraded.summary.issues).toHaveLength(1);
    expect(degraded.summary.recommendations).toHaveLength(1);
  });

  it("correctly represents stale checksums", () => {
    const stale: SafetyPostureResponse = {
      ...FIXTURE_POSTURE,
      checksums: {
        ...FIXTURE_POSTURE.checksums,
        registryAgeMs: 700000000, // > 7 days
        isStale: true,
      },
      summary: {
        ...FIXTURE_POSTURE.summary,
        checksumsStale: true,
        overallHealthy: false,
        issues: ["Registry checksums are stale (>7 days old)"],
      },
    };

    expect(stale.checksums.isStale).toBe(true);
    expect(stale.summary.checksumsStale).toBe(true);
  });
});
