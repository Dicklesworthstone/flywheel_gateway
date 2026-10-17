/**
 * Install Plan Service Tests (bd-2gkx.8)
 *
 * Tests install plan computation, remediation guidance,
 * and install script generation.
 */

import { describe, expect, it } from "bun:test";
import type { ToolDefinition } from "@flywheel/shared/types/tool-registry.types";
import {
  computeInstallPlan,
  type DetectedToolState,
  formatInstallScript,
} from "../services/install-plan.service";

// ============================================================================
// Fixtures
// ============================================================================

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: "tools.test",
    name: "test",
    category: "tool",
    ...overrides,
  };
}

const TOOLS: ToolDefinition[] = [
  makeTool({
    id: "tools.dcg",
    name: "dcg",
    displayName: "DCG",
    category: "tool",
    tags: ["critical"],
    phase: 0,
    docsUrl: "https://dcg.example.com",
    verifiedInstaller: { runner: "cargo", args: ["install", "dcg"] },
    verify: { command: ["dcg", "--version"], expectedExitCodes: [0] },
  }),
  makeTool({
    id: "tools.slb",
    name: "slb",
    displayName: "SLB",
    category: "tool",
    tags: ["critical"],
    phase: 0,
    install: [{ command: "cargo install slb" }],
  }),
  makeTool({
    id: "tools.bv",
    name: "bv",
    displayName: "BV",
    category: "tool",
    tags: ["recommended"],
    optional: true,
    enabledByDefault: true,
    phase: 1,
    docsUrl: "https://bv.example.com",
  }),
  makeTool({
    id: "tools.cass",
    name: "cass",
    displayName: "CASS",
    category: "tool",
    optional: true,
    enabledByDefault: false,
    phase: 2,
  }),
];

// ============================================================================
// Plan Computation
// ============================================================================

describe("computeInstallPlan", () => {
  it("all installed → ready=true, no missing", () => {
    const detected: DetectedToolState[] = [
      { name: "dcg", available: true, version: "0.9.2" },
      { name: "slb", available: true, version: "1.2.0" },
      { name: "bv", available: true },
      { name: "cass", available: true },
    ];
    const plan = computeInstallPlan(TOOLS, detected);
    expect(plan.ready).toBe(true);
    expect(plan.installed).toBe(4);
    expect(plan.missingRequired).toBe(0);
    expect(plan.missingOptional).toBe(0);
  });

  it("required missing → ready=false", () => {
    const detected: DetectedToolState[] = [
      { name: "slb", available: true },
      { name: "bv", available: true },
    ];
    const plan = computeInstallPlan(TOOLS, detected);
    expect(plan.ready).toBe(false);
    expect(plan.missingRequired).toBe(1); // dcg
  });

  it("only optional missing → ready=true", () => {
    const detected: DetectedToolState[] = [
      { name: "dcg", available: true },
      { name: "slb", available: true },
      { name: "bv", available: true },
      // cass missing but optional
    ];
    const plan = computeInstallPlan(TOOLS, detected);
    expect(plan.ready).toBe(true);
    expect(plan.missingOptional).toBe(1);
  });

  it("entries are sorted by phase", () => {
    const detected: DetectedToolState[] = [];
    const plan = computeInstallPlan(TOOLS, detected);
    const phases = plan.entries.map((e) => e.phase);
    for (let i = 1; i < phases.length; i++) {
      expect(phases[i]!).toBeGreaterThanOrEqual(phases[i - 1]!);
    }
  });

  it("installed entry has version and no remediation", () => {
    const detected: DetectedToolState[] = [
      { name: "dcg", available: true, version: "0.9.2" },
      { name: "slb", available: true },
      { name: "bv", available: true },
      { name: "cass", available: true },
    ];
    const plan = computeInstallPlan(TOOLS, detected);
    const dcg = plan.entries.find((e) => e.name === "dcg")!;
    expect(dcg.status).toBe("installed");
    expect(dcg.version).toBe("0.9.2");
    expect(dcg.remediation).toHaveLength(0);
  });

  it("missing entry has remediation steps", () => {
    const plan = computeInstallPlan(TOOLS, []);
    const dcg = plan.entries.find((e) => e.name === "dcg")!;
    expect(dcg.status).toBe("missing");
    expect(dcg.remediation.length).toBeGreaterThan(0);
    expect(dcg.remediation[0]).toContain("cargo install dcg");
  });

  it("error state increments missingRequired for required tools", () => {
    const detected: DetectedToolState[] = [
      { name: "dcg", available: false, error: "permission denied" },
      { name: "slb", available: true },
      { name: "bv", available: true },
      { name: "cass", available: true },
    ];
    const plan = computeInstallPlan(TOOLS, detected);
    expect(plan.missingRequired).toBe(1);
    const dcg = plan.entries.find((e) => e.name === "dcg")!;
    expect(dcg.status).toBe("error");
  });

  it("install script only includes missing required tools", () => {
    const detected: DetectedToolState[] = [
      { name: "slb", available: true },
      { name: "bv", available: true },
    ];
    const plan = computeInstallPlan(TOOLS, detected);
    // dcg is missing required, cass is missing optional
    expect(plan.installScript.some((l) => l.includes("dcg"))).toBe(true);
    expect(plan.installScript.some((l) => l.includes("cass"))).toBe(false);
  });

  it("has valid timestamp", () => {
    const plan = computeInstallPlan([], []);
    expect(new Date(plan.computedAt).getTime()).not.toBeNaN();
  });

  it("handles empty inputs", () => {
    const plan = computeInstallPlan([], []);
    expect(plan.ready).toBe(true);
    expect(plan.entries).toHaveLength(0);
    expect(plan.installScript).toHaveLength(0);
  });
});

// ============================================================================
// Remediation
// ============================================================================

describe("Remediation guidance", () => {
  it("includes install command from verifiedInstaller", () => {
    const plan = computeInstallPlan(
      [
        makeTool({
          name: "dcg",
          tags: ["critical"],
          verifiedInstaller: { runner: "cargo", args: ["install", "dcg"] },
        }),
      ],
      [],
    );
    const entry = plan.entries[0]!;
    expect(entry.remediation.some((r) => r.includes("cargo install dcg"))).toBe(
      true,
    );
  });

  it("includes docsUrl in remediation", () => {
    const plan = computeInstallPlan(
      [
        makeTool({
          name: "dcg",
          tags: ["critical"],
          docsUrl: "https://dcg.dev",
        }),
      ],
      [],
    );
    const entry = plan.entries[0]!;
    expect(entry.remediation.some((r) => r.includes("https://dcg.dev"))).toBe(
      true,
    );
  });

  it("includes verify command", () => {
    const plan = computeInstallPlan(
      [
        makeTool({
          name: "dcg",
          tags: ["critical"],
          verify: { command: ["dcg", "--version"] },
        }),
      ],
      [],
    );
    const entry = plan.entries[0]!;
    expect(entry.remediation.some((r) => r.includes("dcg --version"))).toBe(
      true,
    );
  });

  it("notes sudo requirement", () => {
    const plan = computeInstallPlan(
      [
        makeTool({
          name: "x",
          tags: ["critical"],
          install: [{ command: "apt install x", requiresSudo: true }],
        }),
      ],
      [],
    );
    const entry = plan.entries[0]!;
    expect(entry.remediation.some((r) => r.includes("sudo"))).toBe(true);
  });

  it("notes interactive install mode", () => {
    const plan = computeInstallPlan(
      [
        makeTool({
          name: "x",
          tags: ["critical"],
          install: [{ command: "install-x", mode: "interactive" }],
        }),
      ],
      [],
    );
    const entry = plan.entries[0]!;
    expect(entry.remediation.some((r) => r.includes("interactive"))).toBe(true);
  });

  it("provides fallback remediation when nothing available", () => {
    const plan = computeInstallPlan(
      [makeTool({ name: "x", tags: ["critical"] })],
      [],
    );
    const entry = plan.entries[0]!;
    expect(entry.remediation.length).toBeGreaterThan(0);
    expect(entry.remediation[0]).toContain("documentation");
  });
});

// ============================================================================
// Install Script Formatting
// ============================================================================

describe("formatInstallScript", () => {
  it("generates bash script for missing tools", () => {
    const plan = computeInstallPlan(TOOLS, [
      { name: "slb", available: true },
      { name: "bv", available: true },
    ]);
    const script = formatInstallScript(plan);
    expect(script).toContain("#!/usr/bin/env bash");
    expect(script).toContain("set -euo pipefail");
    expect(script).toContain("cargo install dcg");
  });

  it("returns success message when all installed", () => {
    const plan = computeInstallPlan(TOOLS, [
      { name: "dcg", available: true },
      { name: "slb", available: true },
      { name: "bv", available: true },
      { name: "cass", available: true },
    ]);
    const script = formatInstallScript(plan);
    expect(script).toContain("All required tools are installed");
  });

  it("includes phase comments", () => {
    const plan = computeInstallPlan(
      [
        makeTool({
          name: "dcg",
          displayName: "DCG",
          tags: ["critical"],
          phase: 0,
          verifiedInstaller: { runner: "cargo", args: ["install", "dcg"] },
        }),
      ],
      [],
    );
    const script = formatInstallScript(plan);
    expect(script).toContain("# DCG (phase 0)");
  });
});
