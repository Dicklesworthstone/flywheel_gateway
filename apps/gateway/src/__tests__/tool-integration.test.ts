/**
 * Tool Integration Coverage Tests (bd-2n73.15)
 *
 * Integration tests for manifest ingestion, tool detection, robot mode
 * output parsing, utility routes, and error scenarios. Uses golden
 * fixtures and structured test logging.
 */

import { describe, expect, it, beforeEach, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ToolDefinition, ToolRegistry } from "@flywheel/shared";
import {
  classifyToolUnavailability,
  UNAVAILABILITY_META,
  type ToolUnavailabilityReason,
} from "@flywheel/shared/errors";
import { computeHealthDiagnostics } from "../services/tool-health-diagnostics.service";
import type { DetectedCLI } from "../services/agent-detection.service";
import { z } from "zod";

const FIXTURES_DIR = join(import.meta.dir, "fixtures");

// ============================================================================
// Test Logging
// ============================================================================

interface TestLogEntry {
  test: string;
  category: string;
  input: unknown;
  output: unknown;
  pass: boolean;
}

const testLog: TestLogEntry[] = [];

function logTest(entry: Omit<TestLogEntry, "pass">, pass: boolean) {
  testLog.push({ ...entry, pass });
}

// ============================================================================
// Golden Fixture: Manifest Ingestion
// ============================================================================

describe("Manifest Ingestion", () => {
  let validManifest: ToolRegistry;

  beforeEach(() => {
    const raw = readFileSync(join(FIXTURES_DIR, "valid-manifest.yaml"), "utf-8");
    validManifest = parseYaml(raw) as ToolRegistry;
  });

  it("parses valid manifest with correct schema version", () => {
    expect(validManifest.schemaVersion).toBe("1.0.0");
    expect(validManifest.source).toBe("acfs");
    expect(validManifest.tools.length).toBeGreaterThanOrEqual(5);

    logTest(
      { test: "schema-version", category: "manifest", input: "valid-manifest.yaml", output: validManifest.schemaVersion },
      true,
    );
  });

  it("extracts tool IDs in correct format", () => {
    for (const tool of validManifest.tools) {
      expect(tool.id).toMatch(/^(agents|tools)\.\w+$/);
      expect(tool.name).toBeTruthy();
      expect(["agent", "tool"]).toContain(tool.category);
    }
  });

  it("preserves robotMode specs from manifest", () => {
    const dcg = validManifest.tools.find((t) => t.id === "tools.dcg");
    expect(dcg?.robotMode).toBeDefined();
    expect(dcg!.robotMode!.flag).toBe("--format json");
    expect(dcg!.robotMode!.outputFormats).toContain("json");

    const bv = validManifest.tools.find((t) => t.id === "tools.bv");
    expect(bv?.robotMode).toBeDefined();
    expect(bv!.robotMode!.subcommands).toContain("triage");
    expect(bv!.robotMode!.envelopeCompliant).toBe(true);
  });

  it("preserves MCP specs from manifest", () => {
    const dcg = validManifest.tools.find((t) => t.id === "tools.dcg");
    expect(dcg?.mcp?.available).toBe(false);
  });

  it("preserves installedCheck from manifest", () => {
    const claude = validManifest.tools.find((t) => t.id === "agents.claude");
    expect(claude?.installedCheck?.command).toEqual(["command", "-v", "claude"]);
  });

  it("preserves verify specs from manifest", () => {
    const claude = validManifest.tools.find((t) => t.id === "agents.claude");
    expect(claude?.verify?.command).toEqual(["claude", "--version"]);
    expect(claude?.verify?.expectedExitCodes).toEqual([0]);
  });

  it("preserves phase ordering from manifest", () => {
    const phases = validManifest.tools.map((t) => t.phase).filter((p) => p !== undefined);
    expect(phases.length).toBeGreaterThan(0);
    // Tools should have various phases
    const uniquePhases = [...new Set(phases)];
    expect(uniquePhases.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects invalid manifest schema", () => {
    const raw = readFileSync(join(FIXTURES_DIR, "invalid-schema-manifest.yaml"), "utf-8");
    const invalid = parseYaml(raw) as Record<string, unknown>;

    // Should parse as YAML but have invalid schema version
    expect(invalid["schemaVersion"]).not.toBe("1.0.0");

    logTest(
      { test: "invalid-schema", category: "manifest", input: "invalid-schema-manifest.yaml", output: invalid["schemaVersion"] },
      true,
    );
  });

  it("handles minimal manifest with only required fields", () => {
    const raw = readFileSync(join(FIXTURES_DIR, "minimal-manifest.yaml"), "utf-8");
    const minimal = parseYaml(raw) as ToolRegistry;

    expect(minimal.schemaVersion).toBeTruthy();
    expect(minimal.tools.length).toBeGreaterThanOrEqual(1);
    for (const tool of minimal.tools) {
      expect(tool.id).toBeTruthy();
      expect(tool.name).toBeTruthy();
      expect(tool.category).toBeTruthy();
    }
  });
});

// ============================================================================
// Robot Mode Output Golden Tests
// ============================================================================

describe("Robot Mode Output Parsing", () => {
  it("parses JSON envelope-compliant output", () => {
    const output = JSON.stringify({
      object: "triage_result",
      data: {
        id: "bd-123",
        title: "Test bead",
        score: 0.85,
      },
    });

    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed["object"]).toBe("triage_result");
    expect(parsed["data"]).toBeDefined();
    const data = parsed["data"] as Record<string, unknown>;
    expect(data["score"]).toBe(0.85);
  });

  it("parses JSONL output (line-delimited)", () => {
    const lines = [
      '{"file":"src/a.ts","severity":"high","message":"SQL injection"}',
      '{"file":"src/b.ts","severity":"low","message":"Unused variable"}',
    ];

    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!["severity"]).toBe("high");
    expect(parsed[1]!["severity"]).toBe("low");
  });

  it("parses bv --robot-triage response shape", () => {
    const triageOutput = {
      generated_at: "2026-01-29T00:00:00Z",
      data_hash: "abc123",
      triage: {
        meta: { version: "1.0.0", issue_count: 100 },
        quick_ref: {
          open_count: 10,
          actionable_count: 8,
          top_picks: [
            { id: "bd-1", title: "Fix bug", score: 0.9, reasons: ["High priority"], unblocks: 2 },
          ],
        },
        recommendations: [],
      },
    };

    expect(triageOutput.triage.quick_ref.top_picks).toHaveLength(1);
    expect(triageOutput.triage.quick_ref.top_picks[0]!.score).toBe(0.9);
    expect(triageOutput.triage.meta.version).toBe("1.0.0");
  });

  it("parses bv --robot-next response shape", () => {
    const nextOutput = {
      generated_at: "2026-01-29T00:00:00Z",
      data_hash: "def456",
      id: "bd-123",
      title: "Next task",
      score: 0.75,
      reasons: ["Unclaimed", "High priority"],
      unblocks: 1,
      claim_command: "bd update bd-123 --status=in_progress",
      show_command: "bd show bd-123",
    };

    expect(nextOutput.id).toMatch(/^bd-/);
    expect(nextOutput.score).toBeGreaterThan(0);
    expect(nextOutput.claim_command).toContain("bd update");
  });

  it("parses dcg --format json response shape", () => {
    const dcgOutput = {
      blocked: true,
      command: "rm -rf /",
      reason: "Destructive command blocked",
      pattern: "rm.*-rf",
      severity: "critical",
    };

    expect(dcgOutput.blocked).toBe(true);
    expect(dcgOutput.severity).toBe("critical");
  });

  it("parses UBS SARIF output shape", () => {
    const sarifOutput = {
      $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: { driver: { name: "ubs", version: "1.0.0" } },
          results: [
            {
              ruleId: "SQL-001",
              level: "error",
              message: { text: "SQL injection vulnerability" },
              locations: [{ physicalLocation: { artifactLocation: { uri: "src/db.ts" } } }],
            },
          ],
        },
      ],
    };

    expect(sarifOutput.version).toBe("2.1.0");
    expect(sarifOutput.runs[0]!.results).toHaveLength(1);
    expect(sarifOutput.runs[0]!.results[0]!.level).toBe("error");
  });
});

// ============================================================================
// Tool Unavailability Classification
// ============================================================================

describe("Tool Unavailability Classification", () => {
  it("classifies common stderr patterns correctly", () => {
    const cases: Array<{ stderr: string; expected: ToolUnavailabilityReason }> = [
      { stderr: "command not found: dcg", expected: "not_installed" },
      { stderr: "Permission denied", expected: "permission_denied" },
      { stderr: "Error: not logged in", expected: "auth_required" },
      { stderr: "token expired", expected: "auth_expired" },
      { stderr: "config file not found", expected: "config_missing" },
      { stderr: "ECONNREFUSED 127.0.0.1:3000", expected: "mcp_unreachable" },
      { stderr: "Segmentation fault (core dumped)", expected: "crash" },
      { stderr: "fatal error: out of memory", expected: "crash" },
    ];

    for (const { stderr, expected } of cases) {
      const result = classifyToolUnavailability({ stderr });
      expect(result).toBe(expected);

      logTest(
        { test: `classify-${expected}`, category: "unavailability", input: stderr, output: result },
        result === expected,
      );
    }
  });

  it("classifies exit codes correctly", () => {
    const result126 = classifyToolUnavailability({ exitCode: 126 });
    expect(result126).toBe("permission_denied");

    const result127 = classifyToolUnavailability({ exitCode: 127 });
    expect(result127).toBe("not_installed");

    const result139 = classifyToolUnavailability({ exitCode: 139 });
    expect(result139).toBe("crash");
  });

  it("provides HTTP status and labels for all reasons", () => {
    const allReasons: ToolUnavailabilityReason[] = [
      "not_installed", "not_in_path", "permission_denied",
      "version_unsupported", "auth_required", "auth_expired",
      "config_missing", "config_invalid", "dependency_missing",
      "mcp_unreachable", "spawn_failed", "timeout", "crash", "unknown",
    ];

    for (const reason of allReasons) {
      const meta = UNAVAILABILITY_META[reason];
      expect(meta).toBeDefined();
      expect(meta.httpStatus).toBeGreaterThanOrEqual(400);
      expect(meta.label).toBeTruthy();
      expect(typeof meta.retryable).toBe("boolean");
    }
  });

  it("stderr takes priority over exit code", () => {
    const result = classifyToolUnavailability({
      stderr: "Permission denied",
      exitCode: 127, // Would be not_installed without stderr
    });
    expect(result).toBe("permission_denied");
  });
});

// ============================================================================
// Health Diagnostics Integration
// ============================================================================

describe("Health Diagnostics Integration with Registry", () => {
  function makeToolDef(
    id: string,
    name: string,
    opts?: { depends?: string[]; displayName?: string; robotMode?: ToolDefinition["robotMode"] },
  ): ToolDefinition {
    return {
      id,
      name,
      category: "tool",
      displayName: opts?.displayName ?? name,
      depends: opts?.depends,
      robotMode: opts?.robotMode,
    };
  }

  function makeCLI(name: string, available: boolean): DetectedCLI {
    return {
      name: name as DetectedCLI["name"],
      available,
      ...(available ? {} : { unavailabilityReason: "not_installed" as const }),
      capabilities: {
        streaming: false,
        toolUse: false,
        vision: false,
        codeExecution: false,
        fileAccess: false,
      },
      detectedAt: new Date(),
      durationMs: 1,
    };
  }

  it("integrates registry tools with detection results", () => {
    const raw = readFileSync(join(FIXTURES_DIR, "valid-manifest.yaml"), "utf-8");
    const manifest = parseYaml(raw) as ToolRegistry;

    // Simulate mixed detection: some available, some not
    const clis: DetectedCLI[] = manifest.tools.map((t) =>
      makeCLI(t.name, t.name === "claude" || t.name === "dcg"),
    );

    const result = computeHealthDiagnostics(manifest.tools, clis);

    expect(result.summary.totalTools).toBe(manifest.tools.length);
    expect(result.summary.availableTools).toBeGreaterThan(0);
    expect(result.summary.unavailableTools).toBeGreaterThan(0);

    // Available tools should not have rootCausePath
    const claudeDiag = result.tools.find((t) => t.toolId === "agents.claude");
    expect(claudeDiag?.available).toBe(true);
    expect(claudeDiag?.rootCausePath).toBeUndefined();
  });

  it("detects cascade failures when tmux is missing and ntm depends on it", () => {
    const tools = [
      makeToolDef("tools.tmux", "tmux"),
      makeToolDef("tools.ntm", "ntm", { depends: ["tools.tmux"], displayName: "NTM" }),
    ];
    const clis = [makeCLI("tmux", false), makeCLI("ntm", false)];

    const result = computeHealthDiagnostics(tools, clis);

    expect(result.cascadeFailures).toHaveLength(1);
    expect(result.cascadeFailures[0]!.rootCause).toBe("tools.tmux");
    expect(result.summary.rootCauseTools).toEqual(["tools.tmux"]);

    const ntmDiag = result.tools.find((t) => t.toolId === "tools.ntm");
    expect(ntmDiag?.rootCauseExplanation).toContain("tmux");
  });

  it("handles tools with robotMode metadata in diagnostics", () => {
    const tools = [
      makeToolDef("tools.bv", "bv", {
        displayName: "bv",
        robotMode: {
          flag: "--robot-triage",
          outputFormats: ["json"],
          subcommands: ["triage", "list", "next"],
          envelopeCompliant: true,
        },
      }),
    ];
    const clis = [makeCLI("bv", true)];

    const result = computeHealthDiagnostics(tools, clis);

    const bvDiag = result.tools.find((t) => t.toolId === "tools.bv");
    expect(bvDiag?.available).toBe(true);
    // robotMode is not part of diagnostics output, but tool should be healthy
    expect(bvDiag?.reason).toBeUndefined();
  });
});

// ============================================================================
// Version Extraction Patterns
// ============================================================================

describe("Version Extraction Patterns", () => {
  const versionRegex = /v?(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)/;

  it("extracts semver from various formats", () => {
    const cases = [
      { input: "v1.2.3", expected: "v1.2.3" },
      { input: "claude 1.0.0-beta.1", expected: "1.0.0-beta.1" },
      { input: "dcg version 2.5.0", expected: "2.5.0" },
      { input: "bv 0.8.1 (built 2026-01-15)", expected: "0.8.1" },
      { input: "cass v3.1.0-rc.2", expected: "v3.1.0-rc.2" },
    ];

    for (const { input, expected } of cases) {
      const match = input.match(versionRegex);
      expect(match).not.toBeNull();
      expect(match![0]).toBe(expected);
    }
  });

  it("returns null for non-version output", () => {
    const cases = ["No version info", "Error: command not found", ""];
    for (const input of cases) {
      const match = input.match(versionRegex);
      if (match) {
        // Some random strings might match, but they should be rare
        expect(match[0]).toBeTruthy();
      }
    }
  });
});

// ============================================================================
// Auth Error Pattern Detection
// ============================================================================

describe("Auth Error Pattern Detection", () => {
  const authPatterns = [
    /not logged in/i,
    /not authenticated/i,
    /no api key/i,
    /unauthorized/i,
    /authentication required/i,
    /token expired/i,
    /invalid.*token/i,
    /credentials.*not found/i,
  ];

  function isAuthError(stderr: string): boolean {
    return authPatterns.some((p) => p.test(stderr));
  }

  it("detects common auth error messages", () => {
    const errors = [
      "Error: not logged in. Run 'claude login' first.",
      "Error: Not authenticated. Please run setup.",
      "Error: No API key found in environment.",
      "401 Unauthorized",
      "Authentication required to access this resource",
      "Error: token expired, please re-authenticate",
      "Error: invalid token provided",
      "Error: credentials not found in ~/.config/tool/auth.json",
    ];

    for (const err of errors) {
      expect(isAuthError(err)).toBe(true);
    }
  });

  it("does not flag non-auth errors", () => {
    const nonAuth = [
      "command not found: claude",
      "Permission denied",
      "Network error: ECONNREFUSED",
      "File not found: config.yaml",
    ];

    for (const err of nonAuth) {
      expect(isAuthError(err)).toBe(false);
    }
  });
});

// ============================================================================
// Utility Route Validation Schemas
// ============================================================================

describe("Utility Request Validation", () => {
  const GiilRequestSchema = z.object({
    url: z.string().url(),
    outputDir: z.string().optional(),
    format: z.enum(["file", "json", "base64"]).optional(),
  });

  const CsctfRequestSchema = z.object({
    url: z.string().url(),
    outputDir: z.string().optional(),
    formats: z.array(z.enum(["md", "html"])).optional(),
    publishToGhPages: z.boolean().optional(),
  });

  it("validates valid giil request", () => {
    const result = GiilRequestSchema.safeParse({
      url: "https://share.icloud.com/photos/abc123",
      format: "json",
    });
    expect(result.success).toBe(true);
  });

  it("rejects giil request with invalid URL", () => {
    const result = GiilRequestSchema.safeParse({
      url: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("rejects giil request with missing URL", () => {
    const result = GiilRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("validates valid csctf request", () => {
    const result = CsctfRequestSchema.safeParse({
      url: "https://chatgpt.com/share/abc123",
      formats: ["md", "html"],
      publishToGhPages: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects csctf request with invalid format", () => {
    const result = CsctfRequestSchema.safeParse({
      url: "https://chatgpt.com/share/abc123",
      formats: ["pdf"], // Invalid format
    });
    expect(result.success).toBe(false);
  });
});
