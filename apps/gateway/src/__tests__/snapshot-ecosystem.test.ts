import { describe, it, expect } from "bun:test";
import type {
  DetectedToolSummary,
  ToolEcosystemSummary,
  ToolHealthSnapshot,
} from "@flywheel/shared";

describe("ToolHealthSnapshot ecosystem types", () => {
  it("ToolEcosystemSummary has correct shape", () => {
    const summary: ToolEcosystemSummary = {
      agentsAvailable: 2,
      agentsTotal: 5,
      toolsAvailable: 10,
      toolsTotal: 17,
      authIssues: ["claude: not authenticated"],
      agents: [
        {
          name: "claude",
          available: true,
          version: "1.0.0",
          path: "/usr/bin/claude",
          authenticated: true,
          detectionMs: 50,
        },
        {
          name: "codex",
          available: false,
          unavailabilityReason: "not_installed",
          detectionMs: 10,
        },
      ],
      tools: [
        {
          name: "dcg",
          available: true,
          version: "0.5.0",
          path: "/usr/bin/dcg",
          detectionMs: 25,
        },
      ],
    };

    expect(summary.agentsAvailable).toBe(2);
    expect(summary.agentsTotal).toBe(5);
    expect(summary.toolsAvailable).toBe(10);
    expect(summary.toolsTotal).toBe(17);
    expect(summary.agents).toHaveLength(2);
    expect(summary.tools).toHaveLength(1);
    expect(summary.agents[0]!.authenticated).toBe(true);
    expect(summary.agents[1]!.unavailabilityReason).toBe("not_installed");
  });

  it("DetectedToolSummary supports all optional fields", () => {
    const full: DetectedToolSummary = {
      name: "cass",
      available: true,
      version: "2.1.0",
      path: "/usr/local/bin/cass",
      authenticated: true,
      detectionMs: 30,
    };

    const minimal: DetectedToolSummary = {
      name: "br",
      available: false,
      unavailabilityReason: "permission_denied",
      detectionMs: 5,
    };

    expect(full.version).toBe("2.1.0");
    expect(full.authenticated).toBe(true);
    expect(minimal.unavailabilityReason).toBe("permission_denied");
    expect(minimal.version).toBeUndefined();
  });

  it("ToolHealthSnapshot includes optional ecosystem field", () => {
    const snapshot: ToolHealthSnapshot = {
      capturedAt: new Date().toISOString(),
      dcg: { installed: true, version: "0.5.0", healthy: true, latencyMs: 10 },
      slb: { installed: true, version: "1.0.0", healthy: true, latencyMs: 15 },
      ubs: { installed: false, version: null, healthy: false, latencyMs: 5 },
      status: "degraded",
      registryGeneratedAt: null,
      registryAgeMs: null,
      toolsWithChecksums: 0,
      checksumsStale: false,
      checksumStatuses: [],
      issues: ["UBS not installed"],
      recommendations: ["Install UBS"],
    };

    // ecosystem is optional
    expect(snapshot.ecosystem).toBeUndefined();

    // With ecosystem
    const withEcosystem: ToolHealthSnapshot = {
      ...snapshot,
      ecosystem: {
        agentsAvailable: 1,
        agentsTotal: 3,
        toolsAvailable: 5,
        toolsTotal: 17,
        authIssues: [],
        agents: [{ name: "claude", available: true, detectionMs: 20 }],
        tools: [{ name: "dcg", available: true, detectionMs: 10 }],
      },
    };

    expect(withEcosystem.ecosystem).toBeDefined();
    expect(withEcosystem.ecosystem!.agentsAvailable).toBe(1);
  });
});
