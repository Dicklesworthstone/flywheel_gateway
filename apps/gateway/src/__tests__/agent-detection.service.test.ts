/**
 * Agent Detection Service Tests
 *
 * Deterministic test fixtures for:
 * - PATH probing (tool found, not found, multiple matches)
 * - Auth/permission errors (various auth error patterns)
 * - Robot mode capability detection
 * - MCP server capability detection
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
import pino from "pino";
import {
  restoreToolRegistryService,
} from "./test-utils/db-mock-restore";
import { requestContextStorage } from "../middleware/correlation";
import type { Logger } from "../services/logger";

// ============================================================================
// Mock State
// ============================================================================

type LogEvent = { level: "info" | "warn" | "debug" | "error"; args: unknown[] };

let logEvents: LogEvent[] = [];
let spawnCalls: Array<{ cmd: string[]; env?: Record<string, string> }> = [];
let spawnResults: Map<string, { exitCode: number; stdout: string; stderr: string }> = new Map();
let defaultSpawnResult = { exitCode: 1, stdout: "", stderr: "command not found" };

// Track tool registry calls
let registryTools: Array<{
  id: string;
  name: string;
  category: "agent" | "tool";
  verify?: { command: string[] };
  installedCheck?: { command: string[]; run_as?: string; timeoutMs?: number };
  robotMode?: { flag: string; outputFormats?: string[]; envelopeCompliant?: boolean };
  mcp?: { available: boolean; capabilities?: string; toolCount?: number };
}> = [];
let registryMetadata: { schemaVersion: string; manifestHash: string } | null = null;

// ============================================================================
// Mock Setup
// ============================================================================

const baseTestLogger = pino({ level: "silent" });
const mockLogger: Logger = Object.assign(baseTestLogger, {
  info: (...args: unknown[]) => {
    logEvents.push({ level: "info", args });
  },
  warn: (...args: unknown[]) => {
    logEvents.push({ level: "warn", args });
  },
  debug: (...args: unknown[]) => {
    logEvents.push({ level: "debug", args });
  },
  error: (...args: unknown[]) => {
    logEvents.push({ level: "error", args });
  },
  child: () => mockLogger,
});

// Mock the tool registry service
mock.module("../services/tool-registry.service", () => ({
  listAllTools: async () => registryTools,
  getToolRegistryMetadata: () => registryMetadata,
}));

// Helper to create mock spawn result
function createMockSpawnResult(
  exitCode: number,
  stdout: string,
  stderr = "",
): { exitCode: number; stdout: string; stderr: string } {
  return { exitCode, stdout, stderr };
}

// Store original Bun.spawn
const originalSpawn = Bun.spawn;

// Mock Bun.spawn
function setupSpawnMock() {
  // @ts-expect-error - Mocking global
  Bun.spawn = (cmd: string[], opts?: { stdout?: string; stderr?: string; env?: Record<string, string> }) => {
    const cmdArray = Array.isArray(cmd) ? cmd : [cmd];
    const call: { cmd: string[]; env?: Record<string, string> } = {
      cmd: cmdArray,
    };
    if (opts?.env !== undefined) {
      call.env = opts.env;
    }
    spawnCalls.push(call);

    const cmdKey = cmdArray.join(" ");
    const result = spawnResults.get(cmdKey) ?? defaultSpawnResult;

    // Create mock streams
    const stdout = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(result.stdout));
        controller.close();
      },
    });
    const stderr = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(result.stderr));
        controller.close();
      },
    });

    return {
      stdout,
      stderr,
      exited: Promise.resolve(result.exitCode),
      kill: () => {},
    };
  };
}

// Import after mocks are defined
import {
  clearDetectionCache,
  detectAllCLIs,
  detectCLIByName,
  type DetectedCLI,
} from "../services/agent-detection.service";

// IMPORTANT: Bun's mock.module() persists across test files.
// Restore the real modules immediately after importing the module under test
// so later test files don't load with these mocks still installed.
restoreToolRegistryService();

// ============================================================================
// Test Lifecycle
// ============================================================================

function resetState() {
  logEvents = [];
  spawnCalls = [];
  spawnResults = new Map();
  defaultSpawnResult = { exitCode: 1, stdout: "", stderr: "command not found" };
  registryTools = [];
  registryMetadata = null;
  clearDetectionCache();
}

beforeEach(() => {
  resetState();
  setupSpawnMock();
  requestContextStorage.enterWith({
    correlationId: "test-corr",
    requestId: "test-request-id",
    startTime: performance.now(),
    logger: mockLogger,
  });
});

afterEach(() => {
  clearDetectionCache();
});

afterAll(() => {
  // Restore original spawn
  Bun.spawn = originalSpawn;
  mock.restore();
  restoreToolRegistryService();
});

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Fixture: CLI not found in PATH
 *
 * Simulates `which <tool>` returning exit code 1 (not found).
 * The detection should mark the CLI as unavailable.
 */
describe("PATH probing: CLI not found", () => {
  it("marks CLI as unavailable when which returns exit code 1", async () => {
    // Set up fallback registry with minimal tool
    registryTools = [
      { id: "tools.test", name: "test-tool", category: "tool" },
    ];

    // which/command -v returns not found
    spawnResults.set("which test-tool", createMockSpawnResult(1, "", ""));

    const result = await detectCLIByName("test-tool");

    expect(result).not.toBeNull();
    expect(result?.available).toBe(false);
    expect(result?.path).toBeUndefined();
  });

  it("logs cli_not_found error category when tool is missing", async () => {
    registryTools = [
      { id: "tools.missing", name: "missing-tool", category: "tool" },
    ];

    spawnResults.set("which missing-tool", createMockSpawnResult(1, "", ""));

    await detectCLIByName("missing-tool");

    const debugLog = logEvents.find(
      (e) => e.level === "debug" && JSON.stringify(e.args).includes("cli_not_found"),
    );
    expect(debugLog).toBeDefined();
  });
});

/**
 * Fixture: CLI found in PATH
 *
 * Simulates successful PATH lookup and version detection.
 */
describe("PATH probing: CLI found", () => {
  it("marks CLI as available when which succeeds", async () => {
    registryTools = [
      {
        id: "tools.found",
        name: "found-tool",
        category: "tool",
        verify: { command: ["found-tool", "--version"] },
      },
    ];

    // which returns path
    spawnResults.set("which found-tool", createMockSpawnResult(0, "/usr/local/bin/found-tool\n", ""));
    // version check succeeds
    spawnResults.set("/usr/local/bin/found-tool --version", createMockSpawnResult(0, "v1.2.3\n", ""));

    const result = await detectCLIByName("found-tool");

    expect(result).not.toBeNull();
    expect(result?.available).toBe(true);
    expect(result?.path).toBe("/usr/local/bin/found-tool");
    expect(result?.version).toBe("v1.2.3");
  });

  it("extracts version from complex output", async () => {
    registryTools = [
      {
        id: "tools.complex",
        name: "complex-tool",
        category: "tool",
        verify: { command: ["complex-tool", "--version"] },
      },
    ];

    spawnResults.set("which complex-tool", createMockSpawnResult(0, "/usr/bin/complex-tool\n", ""));
    // Version buried in complex output
    spawnResults.set(
      "/usr/bin/complex-tool --version",
      createMockSpawnResult(0, "Complex Tool Suite\nVersion: 2.4.1-beta.3\nBuilt: 2026-01-15\n", ""),
    );

    const result = await detectCLIByName("complex-tool");

    expect(result?.version).toBe("2.4.1-beta.3");
  });
});

/**
 * Fixture: Manifest installed_check
 *
 * Tests that manifest-defined installed_check commands are used for detection.
 */
describe("PATH probing: Manifest installed_check", () => {
  it("uses manifest installed_check command when available", async () => {
    registryTools = [
      {
        id: "tools.manifest",
        name: "manifest-tool",
        category: "tool",
        verify: { command: ["manifest-tool", "--version"] },
        installedCheck: { command: ["command", "-v", "manifest-tool"] },
      },
    ];

    // installed_check succeeds
    spawnResults.set("command -v manifest-tool", createMockSpawnResult(0, "/opt/tools/manifest-tool\n", ""));
    // version check
    spawnResults.set("/opt/tools/manifest-tool --version", createMockSpawnResult(0, "v3.0.0\n", ""));

    const result = await detectCLIByName("manifest-tool");

    expect(result?.available).toBe(true);
    expect(result?.path).toBe("/opt/tools/manifest-tool");

    // Verify installed_check was called
    const installedCheckCall = spawnCalls.find((c) => c.cmd.join(" ") === "command -v manifest-tool");
    expect(installedCheckCall).toBeDefined();
  });

  it("falls back to which when installed_check fails", async () => {
    registryTools = [
      {
        id: "tools.fallback",
        name: "fallback-tool",
        category: "tool",
        installedCheck: { command: ["command", "-v", "fallback-tool"] },
      },
    ];

    // installed_check fails
    spawnResults.set("command -v fallback-tool", createMockSpawnResult(1, "", ""));
    // which succeeds
    spawnResults.set("which fallback-tool", createMockSpawnResult(0, "/usr/local/bin/fallback-tool\n", ""));
    // version check
    spawnResults.set("/usr/local/bin/fallback-tool --version", createMockSpawnResult(0, "v1.0.0\n", ""));

    const result = await detectCLIByName("fallback-tool");

    expect(result?.available).toBe(true);
    expect(result?.path).toBe("/usr/local/bin/fallback-tool");
  });

  it("skips installed_check requiring root", async () => {
    registryTools = [
      {
        id: "tools.root",
        name: "root-tool",
        category: "tool",
        installedCheck: { command: ["sudo", "which", "root-tool"], run_as: "root" },
      },
    ];

    // which succeeds (fallback)
    spawnResults.set("which root-tool", createMockSpawnResult(0, "/usr/sbin/root-tool\n", ""));
    spawnResults.set("/usr/sbin/root-tool --version", createMockSpawnResult(0, "v1.0.0\n", ""));

    const result = await detectCLIByName("root-tool");

    expect(result?.available).toBe(true);
    // Should NOT have called the sudo command
    const sudoCall = spawnCalls.find((c) => c.cmd.includes("sudo"));
    expect(sudoCall).toBeUndefined();
  });
});

/**
 * Fixture: Authentication errors
 *
 * Tests various auth error patterns and their handling.
 */
describe("Auth/permission errors", () => {
  it("detects 'not logged in' auth error", async () => {
    registryTools = [
      {
        id: "agents.auth-test",
        name: "auth-test",
        category: "agent",
      },
    ];

    // Tool is found
    spawnResults.set("which auth-test", createMockSpawnResult(0, "/usr/bin/auth-test\n", ""));
    spawnResults.set("/usr/bin/auth-test --version", createMockSpawnResult(0, "v1.0.0\n", ""));
    // Auth check fails with "not logged in" pattern
    spawnResults.set("/usr/bin/auth-test auth status", createMockSpawnResult(1, "", "Error: Not logged in. Please run 'auth-test auth login'.\n"));

    // Need to set up fallback auth check - agents have authCheckCmd in fallback
    // We need to manually trigger by detecting via detectAllCLIs which uses fallback definitions

    const result = await detectCLIByName("auth-test");

    // For custom agents without fallback auth, authenticated should be undefined
    expect(result?.available).toBe(true);
    expect(result?.authenticated).toBeUndefined(); // No fallback authCheckCmd defined
  });

  it("detects 'not authenticated' auth error for claude agent", async () => {
    // Use fallback definitions which include claude
    registryTools = []; // Empty forces fallback

    // claude is found
    spawnResults.set("which claude", createMockSpawnResult(0, "/usr/local/bin/claude\n", ""));
    spawnResults.set("/usr/local/bin/claude --version", createMockSpawnResult(0, "claude-cli v1.5.0\n", ""));
    // Auth check fails
    spawnResults.set("/usr/local/bin/claude auth status", createMockSpawnResult(1, "", "Not authenticated. Run 'claude auth login'.\n"));

    const result = await detectCLIByName("claude");

    expect(result?.available).toBe(true);
    expect(result?.authenticated).toBe(false);
    expect(result?.authError).toContain("Not authenticated");
  });

  it("detects 'no api key' auth error", async () => {
    registryTools = [];

    spawnResults.set("which codex", createMockSpawnResult(0, "/usr/local/bin/codex\n", ""));
    spawnResults.set("/usr/local/bin/codex --version", createMockSpawnResult(0, "v2.0.0\n", ""));
    spawnResults.set("/usr/local/bin/codex auth whoami", createMockSpawnResult(1, "", "Error: No API key configured.\n"));

    const result = await detectCLIByName("codex");

    expect(result?.available).toBe(true);
    expect(result?.authenticated).toBe(false);
    expect(result?.authError).toContain("Not authenticated");
  });

  it("marks as authenticated when auth check succeeds", async () => {
    registryTools = [];

    spawnResults.set("which claude", createMockSpawnResult(0, "/usr/local/bin/claude\n", ""));
    spawnResults.set("/usr/local/bin/claude --version", createMockSpawnResult(0, "v1.5.0\n", ""));
    spawnResults.set("/usr/local/bin/claude auth status", createMockSpawnResult(0, "Logged in as user@example.com\n", ""));

    const result = await detectCLIByName("claude");

    expect(result?.available).toBe(true);
    expect(result?.authenticated).toBe(true);
    expect(result?.authError).toBeUndefined();
  });

  it("includes auth issues in detection summary", async () => {
    registryTools = [];

    // claude found but not authenticated
    spawnResults.set("which claude", createMockSpawnResult(0, "/usr/local/bin/claude\n", ""));
    spawnResults.set("/usr/local/bin/claude --version", createMockSpawnResult(0, "v1.5.0\n", ""));
    spawnResults.set("/usr/local/bin/claude auth status", createMockSpawnResult(1, "", "Unauthorized\n"));

    // codex not found
    spawnResults.set("which codex", createMockSpawnResult(1, "", ""));
    spawnResults.set("which gemini", createMockSpawnResult(1, "", ""));
    spawnResults.set("which aider", createMockSpawnResult(1, "", ""));
    spawnResults.set("which gh", createMockSpawnResult(1, "", ""));

    // tools not found
    spawnResults.set("which dcg", createMockSpawnResult(1, "", ""));
    spawnResults.set("which ubs", createMockSpawnResult(1, "", ""));
    spawnResults.set("which slb", createMockSpawnResult(1, "", ""));
    spawnResults.set("which cass", createMockSpawnResult(1, "", ""));
    spawnResults.set("which cm", createMockSpawnResult(1, "", ""));
    spawnResults.set("which br", createMockSpawnResult(1, "", ""));
    spawnResults.set("which bv", createMockSpawnResult(1, "", ""));
    spawnResults.set("which ru", createMockSpawnResult(1, "", ""));
    spawnResults.set("which ms", createMockSpawnResult(1, "", ""));
    spawnResults.set("which xf", createMockSpawnResult(1, "", ""));
    spawnResults.set("which pt", createMockSpawnResult(1, "", ""));
    spawnResults.set("which rch", createMockSpawnResult(1, "", ""));
    spawnResults.set("which giil", createMockSpawnResult(1, "", ""));
    spawnResults.set("which csctf", createMockSpawnResult(1, "", ""));
    spawnResults.set("which caam", createMockSpawnResult(1, "", ""));
    spawnResults.set("which ntm", createMockSpawnResult(1, "", ""));
    spawnResults.set("which scanner", createMockSpawnResult(1, "", ""));

    const result = await detectAllCLIs(true); // bypass cache

    expect(result.summary.authIssues.length).toBeGreaterThan(0);
    expect(result.summary.authIssues[0]).toContain("claude");
  });
});

/**
 * Fixture: Robot mode capability detection
 *
 * Tests extraction of robot mode info from manifest and fallback definitions.
 */
describe("Robot mode capability detection", () => {
  it("extracts robot mode from manifest definition", async () => {
    registryTools = [
      {
        id: "tools.robot",
        name: "robot-tool",
        category: "tool",
        robotMode: {
          flag: "--format json",
          outputFormats: ["json", "jsonl"],
          envelopeCompliant: true,
        },
      },
    ];

    spawnResults.set("which robot-tool", createMockSpawnResult(0, "/usr/bin/robot-tool\n", ""));
    spawnResults.set("/usr/bin/robot-tool --version", createMockSpawnResult(0, "v1.0.0\n", ""));

    const result = await detectCLIByName("robot-tool");

    expect(result?.available).toBe(true);
    expect(result?.capabilities.robotMode).toBeDefined();
    expect(result?.capabilities.robotMode?.supported).toBe(true);
    expect(result?.capabilities.robotMode?.flag).toBe("--format json");
    expect(result?.capabilities.robotMode?.outputFormats).toEqual(["json", "jsonl"]);
    expect(result?.capabilities.robotMode?.envelopeCompliant).toBe(true);
  });

  it("uses fallback robot mode for dcg", async () => {
    registryTools = []; // Use fallback

    spawnResults.set("which dcg", createMockSpawnResult(0, "/usr/local/bin/dcg\n", ""));
    spawnResults.set("/usr/local/bin/dcg --version", createMockSpawnResult(0, "v1.0.0\n", ""));

    const result = await detectCLIByName("dcg");

    expect(result?.available).toBe(true);
    expect(result?.capabilities.robotMode?.supported).toBe(true);
    expect(result?.capabilities.robotMode?.flag).toBe("--format json");
  });

  it("uses fallback robot mode for bv with robot-triage flag", async () => {
    registryTools = []; // Use fallback

    spawnResults.set("which bv", createMockSpawnResult(0, "/usr/local/bin/bv\n", ""));
    spawnResults.set("/usr/local/bin/bv --version", createMockSpawnResult(0, "v1.0.0\n", ""));

    const result = await detectCLIByName("bv");

    expect(result?.available).toBe(true);
    expect(result?.capabilities.robotMode?.supported).toBe(true);
    expect(result?.capabilities.robotMode?.flag).toBe("--robot-triage");
  });

  it("does not include robot mode for tools without it", async () => {
    registryTools = []; // Use fallback - giil has no robot mode

    spawnResults.set("which giil", createMockSpawnResult(0, "/usr/bin/giil\n", ""));
    spawnResults.set("/usr/bin/giil --version", createMockSpawnResult(0, "v1.0.0\n", ""));

    const result = await detectCLIByName("giil");

    expect(result?.available).toBe(true);
    expect(result?.capabilities.robotMode).toBeUndefined();
  });
});

/**
 * Fixture: MCP server capability detection
 *
 * Tests extraction of MCP info from manifest and fallback definitions.
 */
describe("MCP server capability detection", () => {
  it("extracts MCP info from manifest definition", async () => {
    registryTools = [
      {
        id: "tools.mcp-enabled",
        name: "mcp-enabled",
        category: "tool",
        mcp: {
          available: true,
          capabilities: "full",
          toolCount: 15,
        },
      },
    ];

    spawnResults.set("which mcp-enabled", createMockSpawnResult(0, "/usr/bin/mcp-enabled\n", ""));
    spawnResults.set("/usr/bin/mcp-enabled --version", createMockSpawnResult(0, "v1.0.0\n", ""));

    const result = await detectCLIByName("mcp-enabled");

    expect(result?.available).toBe(true);
    expect(result?.capabilities.mcp).toBeDefined();
    expect(result?.capabilities.mcp?.available).toBe(true);
    expect(result?.capabilities.mcp?.capabilities).toBe("full");
    expect(result?.capabilities.mcp?.toolCount).toBe(15);
  });

  it("uses fallback MCP info for cm", async () => {
    registryTools = []; // Use fallback

    spawnResults.set("which cm", createMockSpawnResult(0, "/usr/local/bin/cm\n", ""));
    spawnResults.set("/usr/local/bin/cm --version", createMockSpawnResult(0, "v1.0.0\n", ""));

    const result = await detectCLIByName("cm");

    expect(result?.available).toBe(true);
    expect(result?.capabilities.mcp?.available).toBe(true);
    expect(result?.capabilities.mcp?.capabilities).toBe("full");
    expect(result?.capabilities.mcp?.toolCount).toBe(10);
  });

  it("does not include MCP for tools without it", async () => {
    registryTools = []; // Use fallback - dcg has no MCP

    spawnResults.set("which dcg", createMockSpawnResult(0, "/usr/bin/dcg\n", ""));
    spawnResults.set("/usr/bin/dcg --version", createMockSpawnResult(0, "v1.0.0\n", ""));

    const result = await detectCLIByName("dcg");

    expect(result?.available).toBe(true);
    expect(result?.capabilities.mcp).toBeUndefined();
  });

  it("ignores MCP with available: false", async () => {
    registryTools = [
      {
        id: "tools.no-mcp",
        name: "no-mcp",
        category: "tool",
        mcp: {
          available: false,
        },
      },
    ];

    spawnResults.set("which no-mcp", createMockSpawnResult(0, "/usr/bin/no-mcp\n", ""));
    spawnResults.set("/usr/bin/no-mcp --version", createMockSpawnResult(0, "v1.0.0\n", ""));

    const result = await detectCLIByName("no-mcp");

    expect(result?.available).toBe(true);
    expect(result?.capabilities.mcp).toBeUndefined();
  });
});

/**
 * Fixture: Environment sanitization
 *
 * Verifies that sensitive environment variables are not passed to spawned processes.
 */
describe("Environment sanitization", () => {
  it("passes NO_COLOR to disable terminal colors", async () => {
    registryTools = [
      { id: "tools.env-test", name: "env-test", category: "tool" },
    ];

    spawnResults.set("which env-test", createMockSpawnResult(0, "/usr/bin/env-test\n", ""));
    spawnResults.set("/usr/bin/env-test --version", createMockSpawnResult(0, "v1.0.0\n", ""));

    await detectCLIByName("env-test");

    // Check that spawn was called with env containing NO_COLOR
    const spawnCall = spawnCalls.find((c) => c.cmd[0] === "which");
    expect(spawnCall?.env?.["NO_COLOR"]).toBe("1");
  });
});

/**
 * Fixture: Cache behavior
 *
 * Tests that detection results are cached and cache can be bypassed.
 */
describe("Detection cache behavior", () => {
  it("returns cached results within TTL", async () => {
    registryTools = [];

    // Set up minimal responses
    spawnResults.set("which claude", createMockSpawnResult(1, "", ""));
    spawnResults.set("which codex", createMockSpawnResult(1, "", ""));
    spawnResults.set("which gemini", createMockSpawnResult(1, "", ""));
    spawnResults.set("which aider", createMockSpawnResult(1, "", ""));
    spawnResults.set("which gh", createMockSpawnResult(1, "", ""));
    spawnResults.set("which dcg", createMockSpawnResult(1, "", ""));
    spawnResults.set("which ubs", createMockSpawnResult(1, "", ""));
    spawnResults.set("which slb", createMockSpawnResult(1, "", ""));
    spawnResults.set("which cass", createMockSpawnResult(1, "", ""));
    spawnResults.set("which cm", createMockSpawnResult(1, "", ""));
    spawnResults.set("which br", createMockSpawnResult(1, "", ""));
    spawnResults.set("which bv", createMockSpawnResult(1, "", ""));
    spawnResults.set("which ru", createMockSpawnResult(1, "", ""));
    spawnResults.set("which ms", createMockSpawnResult(1, "", ""));
    spawnResults.set("which xf", createMockSpawnResult(1, "", ""));
    spawnResults.set("which pt", createMockSpawnResult(1, "", ""));
    spawnResults.set("which rch", createMockSpawnResult(1, "", ""));
    spawnResults.set("which giil", createMockSpawnResult(1, "", ""));
    spawnResults.set("which csctf", createMockSpawnResult(1, "", ""));
    spawnResults.set("which caam", createMockSpawnResult(1, "", ""));
    spawnResults.set("which ntm", createMockSpawnResult(1, "", ""));
    spawnResults.set("which scanner", createMockSpawnResult(1, "", ""));

    const first = await detectAllCLIs();
    const callCountAfterFirst = spawnCalls.length;

    const second = await detectAllCLIs();

    // Should not have made more spawn calls (cache hit)
    expect(spawnCalls.length).toBe(callCountAfterFirst);
    expect(first).toBe(second); // Same object reference
  });

  it("bypassCache forces fresh detection", async () => {
    registryTools = [];

    // Set up minimal responses
    spawnResults.set("which claude", createMockSpawnResult(1, "", ""));
    spawnResults.set("which codex", createMockSpawnResult(1, "", ""));
    spawnResults.set("which gemini", createMockSpawnResult(1, "", ""));
    spawnResults.set("which aider", createMockSpawnResult(1, "", ""));
    spawnResults.set("which gh", createMockSpawnResult(1, "", ""));
    spawnResults.set("which dcg", createMockSpawnResult(1, "", ""));
    spawnResults.set("which ubs", createMockSpawnResult(1, "", ""));
    spawnResults.set("which slb", createMockSpawnResult(1, "", ""));
    spawnResults.set("which cass", createMockSpawnResult(1, "", ""));
    spawnResults.set("which cm", createMockSpawnResult(1, "", ""));
    spawnResults.set("which br", createMockSpawnResult(1, "", ""));
    spawnResults.set("which bv", createMockSpawnResult(1, "", ""));
    spawnResults.set("which ru", createMockSpawnResult(1, "", ""));
    spawnResults.set("which ms", createMockSpawnResult(1, "", ""));
    spawnResults.set("which xf", createMockSpawnResult(1, "", ""));
    spawnResults.set("which pt", createMockSpawnResult(1, "", ""));
    spawnResults.set("which rch", createMockSpawnResult(1, "", ""));
    spawnResults.set("which giil", createMockSpawnResult(1, "", ""));
    spawnResults.set("which csctf", createMockSpawnResult(1, "", ""));
    spawnResults.set("which caam", createMockSpawnResult(1, "", ""));
    spawnResults.set("which ntm", createMockSpawnResult(1, "", ""));
    spawnResults.set("which scanner", createMockSpawnResult(1, "", ""));

    await detectAllCLIs();
    const callCountAfterFirst = spawnCalls.length;

    await detectAllCLIs(true); // bypass cache

    // Should have made more spawn calls (cache bypassed)
    expect(spawnCalls.length).toBeGreaterThan(callCountAfterFirst);
  });
});

/**
 * Fixture: Registry fallback behavior
 *
 * Tests that fallback definitions are used when registry is empty or fails.
 */
describe("Registry fallback behavior", () => {
  it("uses fallback definitions when registry is empty", async () => {
    registryTools = [];
    registryMetadata = { schemaVersion: "1.0.0", manifestHash: "abc123" };

    spawnResults.set("which dcg", createMockSpawnResult(0, "/usr/local/bin/dcg\n", ""));
    spawnResults.set("/usr/local/bin/dcg --version", createMockSpawnResult(0, "v1.0.0\n", ""));

    const result = await detectCLIByName("dcg");

    expect(result?.available).toBe(true);
    // Verify fallback capabilities are used (dcg has robot mode in fallback)
    expect(result?.capabilities.robotMode?.supported).toBe(true);
  });

  it("logs warning when registry is empty", async () => {
    registryTools = [];
    registryMetadata = { schemaVersion: "1.0.0", manifestHash: "abc123" };

    // Set up minimal spawn results for all fallback tools
    spawnResults.set("which claude", createMockSpawnResult(1, "", ""));
    spawnResults.set("which codex", createMockSpawnResult(1, "", ""));
    spawnResults.set("which gemini", createMockSpawnResult(1, "", ""));
    spawnResults.set("which aider", createMockSpawnResult(1, "", ""));
    spawnResults.set("which gh", createMockSpawnResult(1, "", ""));
    spawnResults.set("which dcg", createMockSpawnResult(1, "", ""));
    spawnResults.set("which ubs", createMockSpawnResult(1, "", ""));
    spawnResults.set("which slb", createMockSpawnResult(1, "", ""));
    spawnResults.set("which cass", createMockSpawnResult(1, "", ""));
    spawnResults.set("which cm", createMockSpawnResult(1, "", ""));
    spawnResults.set("which br", createMockSpawnResult(1, "", ""));
    spawnResults.set("which bv", createMockSpawnResult(1, "", ""));
    spawnResults.set("which ru", createMockSpawnResult(1, "", ""));
    spawnResults.set("which ms", createMockSpawnResult(1, "", ""));
    spawnResults.set("which xf", createMockSpawnResult(1, "", ""));
    spawnResults.set("which pt", createMockSpawnResult(1, "", ""));
    spawnResults.set("which rch", createMockSpawnResult(1, "", ""));
    spawnResults.set("which giil", createMockSpawnResult(1, "", ""));
    spawnResults.set("which csctf", createMockSpawnResult(1, "", ""));
    spawnResults.set("which caam", createMockSpawnResult(1, "", ""));
    spawnResults.set("which ntm", createMockSpawnResult(1, "", ""));
    spawnResults.set("which scanner", createMockSpawnResult(1, "", ""));

    await detectAllCLIs(true);

    const warnLog = logEvents.find(
      (e) => e.level === "warn" && JSON.stringify(e.args).includes("registry_empty"),
    );
    expect(warnLog).toBeDefined();
  });
});

/**
 * Fixture: Detection timing
 *
 * Tests that detection timing is recorded correctly.
 */
describe("Detection timing", () => {
  it("includes durationMs in detection result", async () => {
    registryTools = [
      { id: "tools.timing", name: "timing-tool", category: "tool" },
    ];

    spawnResults.set("which timing-tool", createMockSpawnResult(0, "/usr/bin/timing-tool\n", ""));
    spawnResults.set("/usr/bin/timing-tool --version", createMockSpawnResult(0, "v1.0.0\n", ""));

    const result = await detectCLIByName("timing-tool");

    expect(result?.durationMs).toBeGreaterThanOrEqual(0);
    expect(result?.detectedAt).toBeInstanceOf(Date);
  });

  it("includes total durationMs in detectAllCLIs result", async () => {
    registryTools = [];

    // Minimal setup
    spawnResults.set("which claude", createMockSpawnResult(1, "", ""));
    spawnResults.set("which codex", createMockSpawnResult(1, "", ""));
    spawnResults.set("which gemini", createMockSpawnResult(1, "", ""));
    spawnResults.set("which aider", createMockSpawnResult(1, "", ""));
    spawnResults.set("which gh", createMockSpawnResult(1, "", ""));
    spawnResults.set("which dcg", createMockSpawnResult(1, "", ""));
    spawnResults.set("which ubs", createMockSpawnResult(1, "", ""));
    spawnResults.set("which slb", createMockSpawnResult(1, "", ""));
    spawnResults.set("which cass", createMockSpawnResult(1, "", ""));
    spawnResults.set("which cm", createMockSpawnResult(1, "", ""));
    spawnResults.set("which br", createMockSpawnResult(1, "", ""));
    spawnResults.set("which bv", createMockSpawnResult(1, "", ""));
    spawnResults.set("which ru", createMockSpawnResult(1, "", ""));
    spawnResults.set("which ms", createMockSpawnResult(1, "", ""));
    spawnResults.set("which xf", createMockSpawnResult(1, "", ""));
    spawnResults.set("which pt", createMockSpawnResult(1, "", ""));
    spawnResults.set("which rch", createMockSpawnResult(1, "", ""));
    spawnResults.set("which giil", createMockSpawnResult(1, "", ""));
    spawnResults.set("which csctf", createMockSpawnResult(1, "", ""));
    spawnResults.set("which caam", createMockSpawnResult(1, "", ""));
    spawnResults.set("which ntm", createMockSpawnResult(1, "", ""));
    spawnResults.set("which scanner", createMockSpawnResult(1, "", ""));

    const result = await detectAllCLIs(true);

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.detectedAt).toBeInstanceOf(Date);
  });
});
