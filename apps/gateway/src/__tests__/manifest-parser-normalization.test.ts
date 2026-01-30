/**
 * Manifest Parser + Registry Normalization Tests (bd-2n73.17)
 *
 * Validates Zod schema edge cases, tool categorization logic
 * (required/recommended/optional), phase grouping, category filtering,
 * dependency expansion, and golden fixture normalization. Complements
 * tool-registry.service.test.ts which covers loading/caching/provenance.
 */

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { requestContextStorage } from "../middleware/correlation";

const realFs = require("node:fs");
const realFsPromises = require("node:fs/promises");
const realYaml = require("yaml");

let manifestContents = new Map<string, string>();
let existsOverrides = new Map<string, boolean>();

const mockLogger = {
  info: () => {},
  warn: () => {},
  debug: () => {},
  error: () => {},
  child: () => mockLogger,
};

mock.module("node:fs", () => ({
  ...realFs,
  existsSync: (path: string) => existsOverrides.get(path) ?? false,
}));

mock.module("node:fs/promises", () => ({
  ...realFsPromises,
  readFile: async (path: string) => {
    if (manifestContents.has(path)) return manifestContents.get(path) as string;
    throw new Error(`ENOENT: ${path}`);
  },
}));

mock.module("yaml", () => ({
  parse: (content: string) => realYaml.parse(content),
}));

// Use a cache-busting specifier so this test file always loads a fresh copy
// of the registry module after mocks are installed. Keep the specifier
// non-literal so TypeScript doesn't try to resolve the query string.
const TOOL_REGISTRY_MODULE_SPECIFIER =
  "../services/tool-registry.service?manifest-parser-normalization-test";

const {
  categorizeTools,
  clearToolRegistryCache,
  getFallbackRegistry,
  getOptionalTools,
  getRecommendedTools,
  getRequiredTools,
  getToolsByPhase,
  listAgentTools,
  listAllTools,
  listSetupTools,
  loadToolRegistry,
} = (await import(
  TOOL_REGISTRY_MODULE_SPECIFIER,
)) as typeof import("../services/tool-registry.service");
import type { ToolDefinition } from "@flywheel/shared/types/tool-registry.types";

const MANIFEST_PATH = "/tmp/norm-test.yaml";
const originalEnv = { ...process.env };

function setManifest(yaml: string) {
  process.env["ACFS_MANIFEST_PATH"] = MANIFEST_PATH;
  process.env["ACFS_MANIFEST_TTL_MS"] = "0"; // no caching
  existsOverrides.set(MANIFEST_PATH, true);
  manifestContents.set(MANIFEST_PATH, yaml);
}

function buildManifest(tools: string): string {
  return `schemaVersion: "1.0.0"\nsource: "test"\ntools:\n${tools}`;
}

beforeEach(() => {
  manifestContents = new Map();
  existsOverrides = new Map();
  clearToolRegistryCache();
  requestContextStorage.enterWith({
    correlationId: "test-corr",
    requestId: "test-request-id",
    startTime: performance.now(),
    logger: mockLogger,
  });
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  clearToolRegistryCache();
});

afterAll(() => {
  mock.restore();
  mock.module("node:fs", () => realFs);
  mock.module("node:fs/promises", () => realFsPromises);
  mock.module("yaml", () => realYaml);
});

// ============================================================================
// Zod Schema Edge Cases
// ============================================================================

describe("Zod schema edge cases", () => {
  it("accepts tool with only required fields (id, name, category)", async () => {
    setManifest(
      buildManifest(`  - id: "tools.bare"\n    name: "bare"\n    category: "tool"`),
    );
    const reg = await loadToolRegistry();
    expect(reg.tools).toHaveLength(1);
    expect(reg.tools[0]!.id).toBe("tools.bare");
    expect(reg.tools[0]!.tags).toBeUndefined();
    expect(reg.tools[0]!.phase).toBeUndefined();
  });

  it("accepts tool with all optional spec sections", async () => {
    setManifest(`schemaVersion: "1.0.0"
tools:
  - id: "tools.full"
    name: "full"
    category: "tool"
    displayName: "Full Tool"
    description: "Has everything"
    tags: ["recommended"]
    optional: true
    enabledByDefault: true
    phase: 1
    docsUrl: "https://example.com"
    install:
      - command: "cargo install full"
        mode: "easy"
        requiresSudo: false
    verifiedInstaller:
      runner: "cargo"
      args: ["install", "full"]
      run_in_tmux: false
    verify:
      command: ["full", "--version"]
      expectedExitCodes: [0]
      minVersion: "1.0.0"
      versionRegex: "v(\\\\d+\\\\.\\\\d+\\\\.\\\\d+)"
      timeoutMs: 5000
    installedCheck:
      command: ["command", "-v", "full"]
      run_as: "user"
      timeoutMs: 3000
      outputCapBytes: 1024
    checksums:
      "sha256": "abc123"
    robotMode:
      flag: "--json"
      altFlags: ["--format json"]
      outputFormats: ["json", "jsonl"]
      subcommands: ["list", "show"]
      envelopeCompliant: true
      notes: "Test"
    mcp:
      available: true
      capabilities: "full"
      serverUri: "http://localhost:9999"
      toolCount: 5
      sampleTools: ["tool1"]
      sampleResources: ["res1"]
      notes: "MCP notes"
`);
    const reg = await loadToolRegistry();
    expect(reg.tools).toHaveLength(1);
    const tool = reg.tools[0]!;
    // Note: robotMode and mcp are parsed by Zod but not copied to output
    // by parseManifest normalization (only core fields are preserved)
    expect(tool.robotMode).toBeUndefined();
    expect(tool.mcp).toBeUndefined();
    expect(tool.verify?.timeoutMs).toBe(5000);
    expect(tool.installedCheck?.run_as).toBe("user");
  });

  it("rejects invalid category value", async () => {
    setManifest(
      buildManifest(`  - id: "x"\n    name: "x"\n    category: "invalid"`),
    );
    // Should fall back
    const reg = await loadToolRegistry();
    expect(reg.schemaVersion).toBe("1.0.0-fallback");
  });

  it("rejects negative timeoutMs in verify spec", async () => {
    setManifest(`schemaVersion: "1.0.0"
tools:
  - id: "tools.neg"
    name: "neg"
    category: "tool"
    verify:
      command: ["neg", "--version"]
      timeoutMs: -1
`);
    const reg = await loadToolRegistry();
    expect(reg.schemaVersion).toBe("1.0.0-fallback");
  });

  it("rejects non-integer phase", async () => {
    setManifest(
      buildManifest(`  - id: "x"\n    name: "x"\n    category: "tool"\n    phase: 1.5`),
    );
    const reg = await loadToolRegistry();
    expect(reg.schemaVersion).toBe("1.0.0-fallback");
  });

  it("rejects invalid install mode enum", async () => {
    setManifest(`schemaVersion: "1.0.0"
tools:
  - id: "tools.bad"
    name: "bad"
    category: "tool"
    install:
      - command: "cargo install bad"
        mode: "automatic"
`);
    const reg = await loadToolRegistry();
    expect(reg.schemaVersion).toBe("1.0.0-fallback");
  });

  it("rejects invalid MCP capability level", async () => {
    setManifest(`schemaVersion: "1.0.0"
tools:
  - id: "tools.bad"
    name: "bad"
    category: "tool"
    mcp:
      available: true
      capabilities: "mega"
`);
    const reg = await loadToolRegistry();
    expect(reg.schemaVersion).toBe("1.0.0-fallback");
  });

  it("rejects invalid output format in robotMode", async () => {
    setManifest(`schemaVersion: "1.0.0"
tools:
  - id: "tools.bad"
    name: "bad"
    category: "tool"
    robotMode:
      flag: "--json"
      outputFormats: ["xml"]
`);
    const reg = await loadToolRegistry();
    expect(reg.schemaVersion).toBe("1.0.0-fallback");
  });

  it("defaults schemaVersion when omitted", async () => {
    setManifest(`tools:\n  - id: "tools.x"\n    name: "x"\n    category: "tool"`);
    const reg = await loadToolRegistry();
    expect(reg.schemaVersion).toBe("1.0.0");
  });

  it("defaults tools to empty array when omitted", async () => {
    setManifest(`schemaVersion: "1.0.0"`);
    const reg = await loadToolRegistry();
    expect(reg.tools).toEqual([]);
  });
});

// ============================================================================
// Tool Categorization Logic
// ============================================================================

describe("Tool categorization", () => {
  const categorizeManifest = `schemaVersion: "1.0.0"
tools:
  - id: "t.critical"
    name: "critical"
    category: "tool"
    tags: ["critical"]
    optional: true
  - id: "t.required_tag"
    name: "required_tag"
    category: "tool"
    tags: ["required"]
  - id: "t.recommended_tag"
    name: "recommended_tag"
    category: "tool"
    tags: ["recommended"]
    optional: true
  - id: "t.optional_enabled"
    name: "optional_enabled"
    category: "tool"
    optional: true
    enabledByDefault: true
  - id: "t.optional_disabled"
    name: "optional_disabled"
    category: "tool"
    optional: true
    enabledByDefault: false
  - id: "t.no_flags"
    name: "no_flags"
    category: "tool"
  - id: "t.enabled_not_optional"
    name: "enabled_not_optional"
    category: "tool"
    enabledByDefault: true
`;

  it("critical tag overrides optional=true → required", async () => {
    setManifest(categorizeManifest);
    const cats = await categorizeTools();
    const ids = cats.required.map((t) => t.id);
    expect(ids).toContain("t.critical");
  });

  it("required tag → required", async () => {
    setManifest(categorizeManifest);
    const cats = await categorizeTools();
    expect(cats.required.map((t) => t.id)).toContain("t.required_tag");
  });

  it("recommended tag on optional tool → recommended", async () => {
    setManifest(categorizeManifest);
    const cats = await categorizeTools();
    expect(cats.recommended.map((t) => t.id)).toContain("t.recommended_tag");
  });

  it("optional + enabledByDefault (no tags) → recommended", async () => {
    setManifest(categorizeManifest);
    const cats = await categorizeTools();
    expect(cats.recommended.map((t) => t.id)).toContain("t.optional_enabled");
  });

  it("optional + enabledByDefault=false → optional", async () => {
    setManifest(categorizeManifest);
    const cats = await categorizeTools();
    expect(cats.optional.map((t) => t.id)).toContain("t.optional_disabled");
  });

  it("no flags set → required (default)", async () => {
    setManifest(categorizeManifest);
    const cats = await categorizeTools();
    expect(cats.required.map((t) => t.id)).toContain("t.no_flags");
  });

  it("enabledByDefault without optional → required", async () => {
    setManifest(categorizeManifest);
    const cats = await categorizeTools();
    expect(cats.required.map((t) => t.id)).toContain("t.enabled_not_optional");
  });

  it("every tool lands in exactly one bucket", async () => {
    setManifest(categorizeManifest);
    const cats = await categorizeTools();
    const total =
      cats.required.length + cats.recommended.length + cats.optional.length;
    const all = await listAllTools();
    expect(total).toBe(all.length);
  });
});

// ============================================================================
// Phase Grouping
// ============================================================================

describe("Phase grouping", () => {
  const phaseManifest = `schemaVersion: "1.0.0"
tools:
  - id: "p2a"
    name: "p2a"
    category: "tool"
    phase: 2
  - id: "p0a"
    name: "p0a"
    category: "tool"
    phase: 0
  - id: "p0b"
    name: "p0b"
    category: "tool"
    phase: 0
  - id: "p1a"
    name: "p1a"
    category: "tool"
    phase: 1
  - id: "nophase"
    name: "nophase"
    category: "tool"
`;

  it("groups tools by phase number", async () => {
    setManifest(phaseManifest);
    const phases = await getToolsByPhase();
    expect(phases.length).toBe(4); // 0, 1, 2, 999
  });

  it("sorts phases in ascending order", async () => {
    setManifest(phaseManifest);
    const phases = await getToolsByPhase();
    const phaseNums = phases.map((p) => p.phase);
    expect(phaseNums).toEqual([0, 1, 2, 999]);
  });

  it("phase 0 has two tools", async () => {
    setManifest(phaseManifest);
    const phases = await getToolsByPhase();
    const p0 = phases.find((p) => p.phase === 0);
    expect(p0?.tools).toHaveLength(2);
  });

  it("tools without phase go to phase 999", async () => {
    setManifest(phaseManifest);
    const phases = await getToolsByPhase();
    const p999 = phases.find((p) => p.phase === 999);
    expect(p999?.tools).toHaveLength(1);
    expect(p999?.tools[0]!.id).toBe("nophase");
  });

  it("empty tools list produces no phase groups", async () => {
    setManifest(`schemaVersion: "1.0.0"\ntools: []`);
    const phases = await getToolsByPhase();
    expect(phases).toEqual([]);
  });
});

// ============================================================================
// Category Filtering (agent vs tool)
// ============================================================================

describe("Category filtering", () => {
  const mixedManifest = `schemaVersion: "1.0.0"
tools:
  - id: "agents.claude"
    name: "claude"
    category: "agent"
  - id: "agents.codex"
    name: "codex"
    category: "agent"
  - id: "tools.dcg"
    name: "dcg"
    category: "tool"
`;

  it("listAgentTools returns only agents", async () => {
    setManifest(mixedManifest);
    const agents = await listAgentTools();
    expect(agents).toHaveLength(2);
    expect(agents.every((t) => t.category === "agent")).toBe(true);
  });

  it("listSetupTools returns only tools", async () => {
    setManifest(mixedManifest);
    const tools = await listSetupTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.category).toBe("tool");
  });

  it("listAllTools returns both categories", async () => {
    setManifest(mixedManifest);
    const all = await listAllTools();
    expect(all).toHaveLength(3);
  });
});

// ============================================================================
// Required/Recommended/Optional Filter Functions
// ============================================================================

describe("Filter helper functions", () => {
  const filterManifest = `schemaVersion: "1.0.0"
tools:
  - id: "t.req"
    name: "req"
    category: "tool"
    tags: ["critical"]
  - id: "t.rec"
    name: "rec"
    category: "tool"
    tags: ["recommended"]
    optional: true
  - id: "t.opt"
    name: "opt"
    category: "tool"
    optional: true
    enabledByDefault: false
`;

  it("getRequiredTools returns only required", async () => {
    setManifest(filterManifest);
    const tools = await getRequiredTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.id).toBe("t.req");
  });

  it("getRecommendedTools returns only recommended", async () => {
    setManifest(filterManifest);
    const tools = await getRecommendedTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.id).toBe("t.rec");
  });

  it("getOptionalTools returns only optional", async () => {
    setManifest(filterManifest);
    const tools = await getOptionalTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.id).toBe("t.opt");
  });
});

// ============================================================================
// Fallback Registry Shape
// ============================================================================

describe("Fallback registry", () => {
  it("has valid schemaVersion", () => {
    const fallback = getFallbackRegistry();
    expect(fallback.schemaVersion).toBe("1.0.0-fallback");
  });

  it("has built-in source", () => {
    const fallback = getFallbackRegistry();
    expect(fallback.source).toBe("built-in");
  });

  it("contains core tools", () => {
    const fallback = getFallbackRegistry();
    const names = fallback.tools.map((t) => t.name);
    expect(names).toContain("claude");
  });

  it("all tools have required fields", () => {
    const fallback = getFallbackRegistry();
    for (const tool of fallback.tools) {
      expect(tool.id).toBeTruthy();
      expect(tool.name).toBeTruthy();
      expect(["agent", "tool"]).toContain(tool.category);
    }
  });
});

// ============================================================================
// Golden Fixture Normalization
// ============================================================================

import nodePath from "node:path";
import { readFileSync } from "node:fs";

const fixturesDir = nodePath.join(__dirname, "fixtures");
const loadFixture = (name: string): string => {
  try {
    return readFileSync(nodePath.join(fixturesDir, name), "utf-8");
  } catch {
    return "";
  }
};

describe("Golden fixture normalization", () => {
  const validFixture = loadFixture("valid-manifest.yaml");

  it("golden fixture categorizes correctly: 5 required, 3 recommended, 0 optional", async () => {
    if (!validFixture) return;
    setManifest(validFixture);
    const cats = await categorizeTools();
    // Phase 0 critical tools (claude, dcg, slb, ubs) + Phase 1 critical (br) = 5 required
    expect(cats.required.map((t) => t.id)).toContain("agents.claude");
    expect(cats.required.map((t) => t.id)).toContain("tools.dcg");
    expect(cats.required.map((t) => t.id)).toContain("tools.br");
    expect(cats.required).toHaveLength(5);
    // bv, cass, ntm are optional+enabledByDefault → recommended
    expect(cats.recommended.map((t) => t.id)).toContain("tools.bv");
    expect(cats.recommended).toHaveLength(3);
    expect(cats.optional).toHaveLength(0);
  });

  it("golden fixture has 3 phases (0, 1, 2)", async () => {
    if (!validFixture) return;
    setManifest(validFixture);
    const phases = await getToolsByPhase();
    expect(phases.map((p) => p.phase)).toEqual([0, 1, 2]);
  });

  it("golden fixture phase 0 has 4 tools", async () => {
    if (!validFixture) return;
    setManifest(validFixture);
    const phases = await getToolsByPhase();
    expect(phases[0]!.tools).toHaveLength(4);
  });

  it("golden fixture has 1 agent and 7 tools", async () => {
    if (!validFixture) return;
    setManifest(validFixture);
    const agents = await listAgentTools();
    const tools = await listSetupTools();
    expect(agents).toHaveLength(1);
    expect(tools).toHaveLength(7);
  });

  it("golden fixture strips robotMode/mcp during normalization", async () => {
    if (!validFixture) return;
    setManifest(validFixture);
    const all = await listAllTools();
    // parseManifest normalization does not copy robotMode or mcp
    for (const tool of all) {
      expect(tool.robotMode).toBeUndefined();
      expect(tool.mcp).toBeUndefined();
    }
  });

  it("golden fixture verify specs have valid exit codes", async () => {
    if (!validFixture) return;
    setManifest(validFixture);
    const all = await listAllTools();
    const verifiable = all.filter((t) => t.verify);
    expect(verifiable.length).toBeGreaterThan(0);
    for (const tool of verifiable) {
      if (tool.verify!.expectedExitCodes) {
        for (const code of tool.verify!.expectedExitCodes) {
          expect(typeof code).toBe("number");
          expect(code).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
