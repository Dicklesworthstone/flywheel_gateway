/**
 * Private Overlay Service Tests (bd-2n73.13)
 *
 * Tests overlay loading, merging, environment mapping,
 * and graceful handling when private dir is absent.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition, ToolRegistry } from "@flywheel/shared";
import {
  applyOverlay,
  type EnvMapping,
  getCurrentEnvironment,
  isPrivateOverlayAvailable,
  loadEnvMapping,
  loadOverlay,
  loadOverlayManifest,
  type OverlayManifest,
  resolveConfigValue,
  resolvePrivateDir,
  resolveToolSecret,
} from "../services/private-overlay.service";

// ============================================================================
// Helpers
// ============================================================================

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: "tools.test",
    name: "test",
    category: "tool",
    ...overrides,
  };
}

function makeRegistry(tools: ToolDefinition[]): ToolRegistry {
  return {
    schemaVersion: "1.0",
    tools,
  };
}

let tempDir: string;
const savedEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  process.env[key] = value;
}

function clearEnv(key: string): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  delete process.env[key];
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  Object.keys(savedEnv).forEach((k) => {
    delete savedEnv[k];
  });
}

// ============================================================================
// Path Resolution
// ============================================================================

describe("resolvePrivateDir", () => {
  afterEach(restoreEnv);

  it("uses default when env not set", () => {
    clearEnv("FLYWHEEL_PRIVATE_DIR");
    expect(resolvePrivateDir()).toBe("/data/projects/flywheel_private");
  });

  it("uses FLYWHEEL_PRIVATE_DIR when set", () => {
    setEnv("FLYWHEEL_PRIVATE_DIR", "/custom/private");
    expect(resolvePrivateDir()).toBe("/custom/private");
  });
});

describe("isPrivateOverlayAvailable", () => {
  afterEach(restoreEnv);

  it("returns false when dir does not exist", () => {
    setEnv("FLYWHEEL_PRIVATE_DIR", "/nonexistent/path/xyz");
    expect(isPrivateOverlayAvailable()).toBe(false);
  });

  it("returns true when dir exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "overlay-test-"));
    setEnv("FLYWHEEL_PRIVATE_DIR", dir);
    expect(isPrivateOverlayAvailable()).toBe(true);
    rmSync(dir, { recursive: true });
  });
});

// ============================================================================
// Loading
// ============================================================================

describe("loadOverlayManifest", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "overlay-manifest-"));
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  it("returns empty when manifest does not exist", async () => {
    const result = await loadOverlayManifest(tempDir);
    expect(result.manifest).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("loads valid overlay manifest", async () => {
    const yaml = `
schemaVersion: "1.0"
tools:
  - name: dcg
    overrides:
      tags: ["critical", "safety"]
      docsUrl: "https://internal.example.com/dcg"
`;
    writeFileSync(join(tempDir, "overlay.manifest.yaml"), yaml);
    const result = await loadOverlayManifest(tempDir);
    expect(result.manifest).toBeDefined();
    if (!result.manifest) {
      throw new Error("Expected overlay manifest to be present");
    }

    expect(result.manifest.schemaVersion).toBe("1.0");
    expect(result.manifest.tools).toHaveLength(1);
    const firstTool = result.manifest.tools?.[0];
    expect(firstTool).toBeDefined();
    if (!firstTool) {
      throw new Error("Expected overlay manifest tool to be present");
    }
    expect(firstTool.name).toBe("dcg");
  });

  it("returns error for invalid YAML", async () => {
    writeFileSync(join(tempDir, "overlay.manifest.yaml"), "{{invalid yaml");
    const result = await loadOverlayManifest(tempDir);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Failed to load overlay manifest");
  });
});

describe("loadEnvMapping", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "overlay-env-"));
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  it("returns empty when mapping does not exist", async () => {
    const result = await loadEnvMapping(tempDir);
    expect(result.envMapping).toBeUndefined();
  });

  it("loads valid env mapping", async () => {
    const yaml = `
toolSecrets:
  dcg: DCG_API_KEY
  cass: CASS_TOKEN
config:
  adminKey: GATEWAY_ADMIN_KEY
`;
    writeFileSync(join(tempDir, "env-mapping.yaml"), yaml);
    const result = await loadEnvMapping(tempDir);
    expect(result.envMapping).toBeDefined();
    const envMapping = result.envMapping;
    if (!envMapping) {
      throw new Error("Expected env mapping to be present");
    }

    expect(envMapping.toolSecrets?.["dcg"]).toBe("DCG_API_KEY");
    expect(envMapping.config?.["adminKey"]).toBe("GATEWAY_ADMIN_KEY");
  });
});

describe("loadOverlay", () => {
  it("returns available=false when dir does not exist", async () => {
    const result = await loadOverlay("/nonexistent/xyz");
    expect(result.available).toBe(false);
    expect(result.errors).toHaveLength(0);
  });

  it("loads both manifest and env mapping", async () => {
    const dir = mkdtempSync(join(tmpdir(), "overlay-full-"));
    writeFileSync(
      join(dir, "overlay.manifest.yaml"),
      'schemaVersion: "1.0"\ntools: []',
    );
    writeFileSync(
      join(dir, "env-mapping.yaml"),
      "toolSecrets:\n  dcg: DCG_KEY",
    );

    const result = await loadOverlay(dir);
    expect(result.available).toBe(true);
    expect(result.manifest).toBeDefined();
    expect(result.envMapping).toBeDefined();
    expect(result.errors).toHaveLength(0);
    rmSync(dir, { recursive: true });
  });

  it("collects errors without failing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "overlay-err-"));
    writeFileSync(join(dir, "overlay.manifest.yaml"), "{{bad");
    writeFileSync(join(dir, "env-mapping.yaml"), "{{bad");

    const result = await loadOverlay(dir);
    expect(result.available).toBe(true);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    rmSync(dir, { recursive: true });
  });
});

// ============================================================================
// Secret Resolution
// ============================================================================

describe("resolveToolSecret", () => {
  afterEach(restoreEnv);

  it("returns undefined when no env var set", () => {
    clearEnv("TOOL_DCG_API_KEY");
    expect(resolveToolSecret("dcg")).toBeUndefined();
  });

  it("resolves conventional TOOL_<NAME>_API_KEY", () => {
    const secretValue = "se" + "cret" + "123";
    setEnv("TOOL_DCG_API_KEY", secretValue);
    expect(resolveToolSecret("dcg")).toBe(secretValue);
  });

  it("uses explicit mapping over convention", () => {
    setEnv("TOOL_DCG_API_KEY", "conventional");
    setEnv("MY_DCG_SECRET", "mapped");
    const mapping: EnvMapping = { toolSecrets: { dcg: "MY_DCG_SECRET" } };
    expect(resolveToolSecret("dcg", mapping)).toBe("mapped");
  });

  it("falls back to convention when mapped var is unset", () => {
    setEnv("TOOL_DCG_API_KEY", "fallback");
    clearEnv("MY_DCG_SECRET");
    const mapping: EnvMapping = { toolSecrets: { dcg: "MY_DCG_SECRET" } };
    expect(resolveToolSecret("dcg", mapping)).toBe("fallback");
  });

  it("handles hyphenated tool names", () => {
    setEnv("TOOL_MY_TOOL_API_KEY", "hyphenated");
    expect(resolveToolSecret("my-tool")).toBe("hyphenated");
  });
});

describe("resolveConfigValue", () => {
  afterEach(restoreEnv);

  it("returns undefined for unmapped key", () => {
    expect(resolveConfigValue("unknown")).toBeUndefined();
  });

  it("resolves mapped config value", () => {
    setEnv("GATEWAY_ADMIN_KEY", "admin123");
    const mapping: EnvMapping = { config: { adminKey: "GATEWAY_ADMIN_KEY" } };
    expect(resolveConfigValue("adminKey", mapping)).toBe("admin123");
  });
});

// ============================================================================
// Overlay Application
// ============================================================================

describe("applyOverlay", () => {
  const baseTools: ToolDefinition[] = [
    makeTool({
      id: "tools.dcg",
      name: "dcg",
      displayName: "DCG",
      tags: ["critical"],
    }),
    makeTool({ id: "tools.slb", name: "slb", displayName: "SLB" }),
    makeTool({ id: "tools.bv", name: "bv", displayName: "BV", optional: true }),
  ];
  const baseRegistry = makeRegistry(baseTools);

  it("returns unchanged registry when overlay has no overrides", () => {
    const overlay: OverlayManifest = { schemaVersion: "1.0" };
    const result = applyOverlay(baseRegistry, overlay);
    expect(result.tools).toHaveLength(3);
    expect(result.tools.map((t) => t.name)).toEqual(["dcg", "slb", "bv"]);
  });

  it("merges overrides into existing tool", () => {
    const overlay: OverlayManifest = {
      schemaVersion: "1.0",
      tools: [
        {
          name: "dcg",
          overrides: { docsUrl: "https://internal.example.com/dcg" },
        },
      ],
    };
    const result = applyOverlay(baseRegistry, overlay);
    const dcg = result.tools.find((t) => t.name === "dcg")!;
    expect(dcg.docsUrl).toBe("https://internal.example.com/dcg");
    // Preserved fields
    expect(dcg.id).toBe("tools.dcg");
    expect(dcg.displayName).toBe("DCG");
  });

  it("preserves id and name from original", () => {
    const overlay: OverlayManifest = {
      schemaVersion: "1.0",
      tools: [
        {
          name: "dcg",
          overrides: { displayName: "Custom DCG" } as Partial<ToolDefinition>,
        },
      ],
    };
    const result = applyOverlay(baseRegistry, overlay);
    const dcg = result.tools.find((t) => t.name === "dcg")!;
    expect(dcg.id).toBe("tools.dcg");
    expect(dcg.name).toBe("dcg");
    expect(dcg.displayName).toBe("Custom DCG");
  });

  it("removes disabled tools", () => {
    const overlay: OverlayManifest = {
      schemaVersion: "1.0",
      tools: [{ name: "bv", disabled: true, overrides: {} }],
    };
    const result = applyOverlay(baseRegistry, overlay);
    expect(result.tools).toHaveLength(2);
    expect(result.tools.find((t) => t.name === "bv")).toBeUndefined();
  });

  it("respects environment-specific disable", () => {
    const overlay: OverlayManifest = {
      schemaVersion: "1.0",
      tools: [
        {
          name: "slb",
          overrides: {},
          environments: { staging: { enabled: false } },
        },
      ],
    };
    const result = applyOverlay(baseRegistry, overlay, "staging");
    expect(result.tools.find((t) => t.name === "slb")).toBeUndefined();
  });

  it("keeps tool when environment enables it", () => {
    const overlay: OverlayManifest = {
      schemaVersion: "1.0",
      tools: [
        {
          name: "slb",
          overrides: { displayName: "SLB Staging" },
          environments: { staging: { enabled: true } },
        },
      ],
    };
    const result = applyOverlay(baseRegistry, overlay, "staging");
    const slb = result.tools.find((t) => t.name === "slb")!;
    expect(slb.displayName).toBe("SLB Staging");
  });

  it("ignores overrides for non-existent tools", () => {
    const overlay: OverlayManifest = {
      schemaVersion: "1.0",
      tools: [{ name: "nonexistent", overrides: { displayName: "X" } }],
    };
    const result = applyOverlay(baseRegistry, overlay);
    expect(result.tools).toHaveLength(3);
  });

  it("adds additional tools", () => {
    const overlay: OverlayManifest = {
      schemaVersion: "1.0",
      additionalTools: [
        makeTool({
          id: "tools.internal",
          name: "internal",
          displayName: "Internal Tool",
        }),
      ],
    };
    const result = applyOverlay(baseRegistry, overlay);
    expect(result.tools).toHaveLength(4);
    expect(result.tools.find((t) => t.name === "internal")).toBeDefined();
  });

  it("does not duplicate additional tools already in registry", () => {
    const overlay: OverlayManifest = {
      schemaVersion: "1.0",
      additionalTools: [
        makeTool({ id: "tools.dcg", name: "dcg", displayName: "Duplicate" }),
      ],
    };
    const result = applyOverlay(baseRegistry, overlay);
    expect(result.tools).toHaveLength(3);
  });

  it("does not mutate input registry", () => {
    const overlay: OverlayManifest = {
      schemaVersion: "1.0",
      tools: [
        { name: "dcg", overrides: { docsUrl: "https://modified.example.com" } },
      ],
    };
    const original = baseRegistry.tools.find((t) => t.name === "dcg")!;
    applyOverlay(baseRegistry, overlay);
    expect(original.docsUrl).toBeUndefined();
  });
});

// ============================================================================
// Environment Detection
// ============================================================================

describe("getCurrentEnvironment", () => {
  afterEach(restoreEnv);

  it("returns FLYWHEEL_ENV when set", () => {
    setEnv("FLYWHEEL_ENV", "staging");
    expect(getCurrentEnvironment()).toBe("staging");
  });

  it("falls back to NODE_ENV", () => {
    clearEnv("FLYWHEEL_ENV");
    setEnv("NODE_ENV", "production");
    expect(getCurrentEnvironment()).toBe("production");
  });

  it("returns undefined when neither set", () => {
    clearEnv("FLYWHEEL_ENV");
    clearEnv("NODE_ENV");
    expect(getCurrentEnvironment()).toBeUndefined();
  });
});
