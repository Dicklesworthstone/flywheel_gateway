/**
 * Registry Compatibility Layer Tests (bd-2n73.16)
 *
 * Tests deprecation tracking, field migration analysis,
 * installer source detection, and compatibility reporting.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import type { ToolDefinition } from "@flywheel/shared/types/tool-registry.types";
import {
  analyzeToolMigration,
  buildCompatibilityReport,
  checkInstallerDeprecation,
  clearDeprecations,
  getDeprecations,
  getInstallerSource,
  recordDeprecation,
} from "../services/registry-compat.service";

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

const HARDCODED_FALLBACK: Record<string, unknown> = {
  displayName: "Test Tool (Hardcoded)",
  description: "Hardcoded description",
  installCommand: "cargo install test",
  installUrl: "https://example.com/install",
  docsUrl: "https://example.com/docs",
};

// ============================================================================
// Deprecation Tracking
// ============================================================================

describe("Deprecation tracking", () => {
  beforeEach(() => clearDeprecations());

  it("records a deprecation warning", () => {
    recordDeprecation({
      tool: "dcg",
      field: "install",
      oldSource: "install_array",
      newSource: "verified_installer",
      message: "Migrate to verifiedInstaller",
    });
    expect(getDeprecations()).toHaveLength(1);
    expect(getDeprecations()[0]!.tool).toBe("dcg");
  });

  it("deduplicates by tool+field", () => {
    const warning = {
      tool: "dcg",
      field: "install",
      oldSource: "install_array" as const,
      newSource: "verified_installer" as const,
      message: "Migrate",
    };
    recordDeprecation(warning);
    recordDeprecation(warning);
    expect(getDeprecations()).toHaveLength(1);
  });

  it("tracks different tools separately", () => {
    recordDeprecation({
      tool: "dcg",
      field: "install",
      oldSource: "install_array",
      newSource: "verified_installer",
      message: "x",
    });
    recordDeprecation({
      tool: "slb",
      field: "install",
      oldSource: "install_array",
      newSource: "verified_installer",
      message: "y",
    });
    expect(getDeprecations()).toHaveLength(2);
  });

  it("clearDeprecations resets log", () => {
    recordDeprecation({
      tool: "dcg",
      field: "install",
      oldSource: "install_array",
      newSource: "verified_installer",
      message: "x",
    });
    clearDeprecations();
    expect(getDeprecations()).toHaveLength(0);
  });
});

// ============================================================================
// Field Migration Analysis
// ============================================================================

describe("analyzeToolMigration", () => {
  beforeEach(() => clearDeprecations());

  it("all fields from manifest → source=manifest", () => {
    const tool = makeTool({
      displayName: "Test",
      description: "From manifest",
      docsUrl: "https://docs.example.com",
      verifiedInstaller: {
        runner: "cargo",
        args: ["install", "test"],
        fallback_url: "https://fallback.example.com",
      },
    });
    const fields = analyzeToolMigration(tool, HARDCODED_FALLBACK);
    expect(fields.every((f) => f.source === "manifest")).toBe(true);
  });

  it("missing manifest fields fall back → source=fallback", () => {
    const tool = makeTool({}); // bare minimum, no displayName/description
    const fields = analyzeToolMigration(tool, HARDCODED_FALLBACK);
    const displayField = fields.find((f) => f.field === "displayName");
    expect(displayField?.source).toBe("fallback");
    expect(displayField?.fallbackValue).toBe("Test Tool (Hardcoded)");
  });

  it("no manifest or fallback → source=none", () => {
    const tool = makeTool({});
    const fields = analyzeToolMigration(tool, undefined);
    expect(fields.every((f) => f.source === "none")).toBe(true);
  });

  it("install array provides installCommand", () => {
    const tool = makeTool({
      install: [{ command: "cargo install test" }],
    });
    const fields = analyzeToolMigration(tool, undefined);
    const installField = fields.find((f) => f.field === "installCommand");
    expect(installField?.source).toBe("manifest");
    expect(installField?.manifestValue).toBe("cargo install test");
  });

  it("verifiedInstaller takes precedence for installCommand", () => {
    const tool = makeTool({
      install: [{ command: "old-command" }],
      verifiedInstaller: { runner: "cargo", args: ["install", "new"] },
    });
    const fields = analyzeToolMigration(tool, undefined);
    const installField = fields.find((f) => f.field === "installCommand");
    expect(installField?.manifestValue).toBe("cargo install new");
  });
});

// ============================================================================
// Installer Source
// ============================================================================

describe("getInstallerSource", () => {
  it("returns verified_installer when present", () => {
    expect(
      getInstallerSource(makeTool({ verifiedInstaller: { runner: "cargo" } })),
    ).toBe("verified_installer");
  });

  it("returns install_array when install[] present", () => {
    expect(
      getInstallerSource(
        makeTool({ install: [{ command: "cargo install x" }] }),
      ),
    ).toBe("install_array");
  });

  it("returns none when neither present", () => {
    expect(getInstallerSource(makeTool())).toBe("none");
  });

  it("prefers verified_installer over install_array", () => {
    expect(
      getInstallerSource(
        makeTool({
          verifiedInstaller: { runner: "cargo" },
          install: [{ command: "old" }],
        }),
      ),
    ).toBe("verified_installer");
  });
});

// ============================================================================
// Installer Deprecation Check
// ============================================================================

describe("checkInstallerDeprecation", () => {
  beforeEach(() => clearDeprecations());

  it("records deprecation for install_array usage", () => {
    checkInstallerDeprecation(
      makeTool({ install: [{ command: "cargo install x" }] }),
    );
    expect(getDeprecations()).toHaveLength(1);
    expect(getDeprecations()[0]!.oldSource).toBe("install_array");
  });

  it("no deprecation for verified_installer", () => {
    checkInstallerDeprecation(
      makeTool({ verifiedInstaller: { runner: "cargo" } }),
    );
    expect(getDeprecations()).toHaveLength(0);
  });

  it("no deprecation when no installer defined", () => {
    checkInstallerDeprecation(makeTool());
    expect(getDeprecations()).toHaveLength(0);
  });
});

// ============================================================================
// Compatibility Report
// ============================================================================

describe("buildCompatibilityReport", () => {
  beforeEach(() => clearDeprecations());

  it("reports fully migrated when all manifest-driven", () => {
    const tools = [
      makeTool({
        name: "dcg",
        displayName: "DCG",
        description: "Guard",
        docsUrl: "https://dcg.example.com",
        verifiedInstaller: {
          runner: "cargo",
          args: ["install", "dcg"],
          fallback_url: "https://dcg.example.com/install",
        },
      }),
    ];
    const report = buildCompatibilityReport(tools, "manifest", {});
    expect(report.fullyMigrated).toBe(true);
    expect(report.manifestDriven).toBe(1);
    expect(report.hardcodedFallback).toBe(0);
  });

  it("reports not migrated when fallback used", () => {
    const tools = [makeTool({ name: "dcg" })];
    const report = buildCompatibilityReport(tools, "manifest", {
      dcg: HARDCODED_FALLBACK,
    });
    expect(report.fullyMigrated).toBe(false);
    expect(report.hardcodedFallback).toBe(1);
  });

  it("reports not migrated when registry source is fallback", () => {
    const tools = [
      makeTool({
        name: "dcg",
        displayName: "DCG",
        description: "Guard",
        docsUrl: "https://dcg.example.com",
      }),
    ];
    const report = buildCompatibilityReport(tools, "fallback", {});
    expect(report.fullyMigrated).toBe(false);
  });

  it("includes deprecation warnings", () => {
    const tools = [
      makeTool({
        name: "dcg",
        displayName: "DCG",
        description: "Guard",
        docsUrl: "https://x.com",
        install: [{ command: "cargo install dcg" }],
      }),
    ];
    const report = buildCompatibilityReport(tools, "manifest", {});
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.warnings[0]!.tool).toBe("dcg");
  });

  it("has valid timestamp", () => {
    const report = buildCompatibilityReport([], "manifest", {});
    expect(new Date(report.checkedAt).getTime()).not.toBeNaN();
  });

  it("counts total correctly", () => {
    const tools = [
      makeTool({ name: "a", displayName: "A", description: "X", docsUrl: "x" }),
      makeTool({ name: "b" }),
    ];
    const report = buildCompatibilityReport(tools, "manifest", {
      b: HARDCODED_FALLBACK,
    });
    expect(report.total).toBe(2);
    expect(report.manifestDriven).toBe(1);
    expect(report.hardcodedFallback).toBe(1);
  });

  it("clears stale warnings between reports", () => {
    const toolWithLegacyInstall = makeTool({
      name: "legacy",
      install: [{ command: "cargo install legacy" }],
    });
    const toolWithVerifiedInstaller = makeTool({
      name: "modern",
      verifiedInstaller: { runner: "cargo", args: ["install", "modern"] },
    });

    const firstReport = buildCompatibilityReport(
      [toolWithLegacyInstall],
      "manifest",
      {},
    );
    expect(firstReport.warnings).toHaveLength(1);

    const secondReport = buildCompatibilityReport(
      [toolWithVerifiedInstaller],
      "manifest",
      {},
    );
    expect(secondReport.warnings).toHaveLength(0);
  });
});
