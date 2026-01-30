/**
 * Readiness/Install Test Harness (bd-a1jg)
 *
 * Integration tests that simulate missing tools and validate:
 * - /setup/readiness reports required/recommended correctly
 * - /setup/install returns deterministic errors for unavailable tools
 * - Logging includes detection inputs, registry versions, and error mappings
 *
 * This test harness creates controlled environments by mocking the tool registry
 * and detection layer, allowing tests to run without requiring actual CLIs.
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
import { Hono } from "hono";
import { requestContextStorage } from "../middleware/correlation";
import {
  restoreAgentDetectionService,
  restoreToolRegistryService,
} from "./test-utils/db-mock-restore";

// ============================================================================
// Mock Infrastructure
// ============================================================================

type LogLevel = "info" | "warn" | "debug" | "error";
type LogEvent = { level: LogLevel; args: unknown[] };

let logEvents: LogEvent[] = [];

const mockLogger = {
  info: (...args: unknown[]) => logEvents.push({ level: "info", args }),
  warn: (...args: unknown[]) => logEvents.push({ level: "warn", args }),
  debug: (...args: unknown[]) => logEvents.push({ level: "debug", args }),
  error: (...args: unknown[]) => logEvents.push({ level: "error", args }),
  child: () => mockLogger,
};

// Track mock state
let mockToolAvailability: Map<string, boolean> = new Map();
let mockToolVersions: Map<string, string> = new Map();
let mockToolAuthenticated: Map<string, boolean> = new Map();
let mockRegistryTools: Array<{
  id: string;
  name: string;
  category: "agent" | "tool";
  tags?: string[];
  optional?: boolean;
  enabledByDefault?: boolean;
  phase?: number;
}> = [];
let mockRegistryError: Error | null = null;
let mockRegistrySchemaVersion = "1.0.0";

// Default test tools for registry
const DEFAULT_TEST_TOOLS = [
  {
    id: "tools.dcg",
    name: "dcg",
    category: "tool" as const,
    tags: ["critical", "required"],
    optional: false,
    enabledByDefault: true,
    phase: 0,
  },
  {
    id: "tools.br",
    name: "br",
    category: "tool" as const,
    tags: ["critical", "required"],
    optional: false,
    enabledByDefault: true,
    phase: 1,
  },
  {
    id: "tools.bv",
    name: "bv",
    category: "tool" as const,
    tags: ["recommended"],
    optional: true,
    enabledByDefault: true,
    phase: 2,
  },
  {
    id: "tools.cass",
    name: "cass",
    category: "tool" as const,
    tags: [],
    optional: true,
    enabledByDefault: false,
    phase: 3,
  },
  {
    id: "agents.claude",
    name: "claude",
    category: "agent" as const,
    tags: ["recommended"],
    optional: false,
    enabledByDefault: true,
    phase: 1,
  },
  {
    id: "agents.codex",
    name: "codex",
    category: "agent" as const,
    tags: [],
    optional: true,
    enabledByDefault: false,
    phase: 2,
  },
];

// Mock tool registry service
mock.module("../services/tool-registry.service", () => ({
  loadToolRegistry: async () => {
    if (mockRegistryError) {
      throw mockRegistryError;
    }
    return {
      schemaVersion: mockRegistrySchemaVersion,
      source: "test-harness",
      generatedAt: new Date().toISOString(),
      tools: mockRegistryTools,
    };
  },
  loadToolRegistryWithMetadata: async () => {
    if (mockRegistryError) {
      throw mockRegistryError;
    }
    return {
      registry: {
        schemaVersion: mockRegistrySchemaVersion,
        source: "test-harness",
        generatedAt: new Date().toISOString(),
        tools: mockRegistryTools,
      },
      source: "manifest" as const,
    };
  },
  getToolRegistryMetadata: () => ({
    manifestPath: "/test/manifest.yaml",
    schemaVersion: mockRegistrySchemaVersion,
    manifestHash: "test-hash-123",
    loadedAt: Date.now(),
    registrySource: "manifest" as const,
  }),
  clearToolRegistryCache: () => {},
  getRequiredTools: async () =>
    mockRegistryTools.filter(
      (t) =>
        t.tags?.includes("critical") ||
        t.tags?.includes("required") ||
        (t.optional !== true && t.enabledByDefault === true),
    ),
  getRecommendedTools: async () =>
    mockRegistryTools.filter(
      (t) =>
        t.tags?.includes("recommended") ||
        (t.optional === true && t.enabledByDefault === true),
    ),
  getOptionalTools: async () =>
    mockRegistryTools.filter(
      (t) => t.optional === true && !t.tags?.includes("recommended"),
    ),
  categorizeTools: async () => {
    const required = mockRegistryTools.filter(
      (t) =>
        t.tags?.includes("critical") ||
        t.tags?.includes("required") ||
        (t.optional !== true && t.enabledByDefault === true),
    );
    const recommended = mockRegistryTools.filter(
      (t) =>
        !required.includes(t) &&
        (t.tags?.includes("recommended") ||
          (t.optional === true && t.enabledByDefault === true)),
    );
    const optional = mockRegistryTools.filter(
      (t) => !required.includes(t) && !recommended.includes(t),
    );
    return { required, recommended, optional };
  },
  getToolsByPhase: async () => {
    const phaseMap = new Map<number, typeof mockRegistryTools>();
    for (const tool of mockRegistryTools) {
      const phase = tool.phase ?? 999;
      const existing = phaseMap.get(phase) ?? [];
      existing.push(tool);
      phaseMap.set(phase, existing);
    }
    return Array.from(phaseMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([phase, tools]) => ({ phase, tools }));
  },
  listAllTools: async () => mockRegistryTools,
}));

// Mock agent detection service
mock.module("../services/agent-detection.service", () => ({
  getAgentDetectionService: () => ({
    detectAll: async () => {
      const agents = mockRegistryTools
        .filter((t) => t.category === "agent")
        .map((t) => ({
          name: t.name,
          available: mockToolAvailability.get(t.name) ?? false,
          version: mockToolVersions.get(t.name),
          authenticated: mockToolAuthenticated.get(t.name),
          capabilities: {
            streaming: false,
            toolUse: false,
            vision: false,
            codeExecution: false,
            fileAccess: false,
          },
          detectedAt: new Date(),
          durationMs: 10,
        }));

      const tools = mockRegistryTools
        .filter((t) => t.category === "tool")
        .map((t) => ({
          name: t.name,
          available: mockToolAvailability.get(t.name) ?? false,
          version: mockToolVersions.get(t.name),
          capabilities: {
            streaming: false,
            toolUse: false,
            vision: false,
            codeExecution: false,
            fileAccess: false,
          },
          detectedAt: new Date(),
          durationMs: 5,
        }));

      return {
        agents,
        tools,
        summary: {
          agentsAvailable: agents.filter((a) => a.available).length,
          agentsTotal: agents.length,
          toolsAvailable: tools.filter((t) => t.available).length,
          toolsTotal: tools.length,
          authIssues: agents
            .filter((a) => a.available && a.authenticated === false)
            .map((a) => `${a.name}: Not authenticated`),
        },
        detectedAt: new Date(),
        durationMs: 50,
      };
    },
    detect: async (name: string) => {
      const tool = mockRegistryTools.find((t) => t.name === name);
      if (!tool) return null;
      return {
        name: tool.name,
        available: mockToolAvailability.get(tool.name) ?? false,
        version: mockToolVersions.get(tool.name),
        authenticated: mockToolAuthenticated.get(tool.name),
        capabilities: {
          streaming: false,
          toolUse: false,
          vision: false,
          codeExecution: false,
          fileAccess: false,
        },
        detectedAt: new Date(),
        durationMs: 10,
      };
    },
    clearCache: () => {},
  }),
  clearDetectionCache: () => {},
}));

// Import routes after mocks are set up
import { setup } from "../routes/setup";

// ============================================================================
// Test Utilities
// ============================================================================

function resetMockState() {
  logEvents = [];
  mockToolAvailability = new Map();
  mockToolVersions = new Map();
  mockToolAuthenticated = new Map();
  mockRegistryTools = [...DEFAULT_TEST_TOOLS];
  mockRegistryError = null;
  mockRegistrySchemaVersion = "1.0.0";
}

function setToolAvailable(name: string, available: boolean, version?: string) {
  mockToolAvailability.set(name, available);
  if (version) {
    mockToolVersions.set(name, version);
  }
}

function setToolAuthenticated(name: string, authenticated: boolean) {
  mockToolAuthenticated.set(name, authenticated);
}

function setAllToolsAvailable() {
  for (const tool of mockRegistryTools) {
    mockToolAvailability.set(tool.name, true);
    mockToolVersions.set(tool.name, "1.0.0");
  }
}

function setAllToolsUnavailable() {
  for (const tool of mockRegistryTools) {
    mockToolAvailability.set(tool.name, false);
  }
}

function getLogEventsByLevel(level: LogLevel): LogEvent[] {
  return logEvents.filter((e) => e.level === level);
}

function findLogWithMessage(
  level: LogLevel,
  messageSubstring: string,
): LogEvent | undefined {
  return logEvents.find(
    (e) =>
      e.level === level &&
      e.args.some(
        (arg) =>
          (typeof arg === "string" && arg.includes(messageSubstring)) ||
          (typeof arg === "object" &&
            JSON.stringify(arg).includes(messageSubstring)),
      ),
  );
}

// ============================================================================
// Response Types
// ============================================================================

type Envelope<T> = {
  object: string;
  data: T;
  error?: {
    code?: string;
    message?: string;
  };
};

type ReadinessData = {
  ready: boolean;
  agents: Array<{ name: string; available: boolean }>;
  tools: Array<{ name: string; available: boolean }>;
  manifest?: {
    schemaVersion: string;
    source?: string;
    manifestPath?: string;
    manifestHash?: string;
  };
  summary: {
    agentsAvailable: number;
    agentsTotal: number;
    toolsAvailable: number;
    toolsTotal: number;
    authIssues: string[];
    missingRequired: string[];
  };
  toolCategories?: {
    required: string[];
    recommended: string[];
    optional: string[];
  };
  installOrder?: Array<{ phase: number; tools: string[] }>;
  recommendations: string[];
  detectedAt: string;
  durationMs: number;
};

// ============================================================================
// Tests
// ============================================================================

describe("Setup Readiness Test Harness (bd-a1jg)", () => {
  const app = new Hono().route("/setup", setup);

  beforeEach(() => {
    resetMockState();
    requestContextStorage.enterWith({
      correlationId: "test-harness-corr",
      requestId: "test-request-id",
      startTime: performance.now(),
      logger: mockLogger,
    });
  });

  afterEach(() => {
    resetMockState();
  });

  afterAll(() => {
    mock.restore();
    restoreAgentDetectionService();
    restoreToolRegistryService();
  });

  // ==========================================================================
  // Required/Recommended Categorization Tests
  // ==========================================================================

  describe("Tool categorization in readiness response", () => {
    it("correctly identifies required tools", async () => {
      setAllToolsAvailable();

      const res = await app.request("/setup/readiness");
      const body = (await res.json()) as Envelope<ReadinessData>;

      expect(res.status).toBe(200);
      expect(body.data.toolCategories).toBeDefined();

      const { required, recommended, optional } = body.data.toolCategories!;

      // dcg and br have critical/required tags
      expect(required).toContain("dcg");
      expect(required).toContain("br");
      // claude is non-optional with enabledByDefault
      expect(required).toContain("claude");

      // bv has recommended tag
      expect(recommended).toContain("bv");

      // cass and codex are optional
      expect(optional).toContain("cass");
      expect(optional).toContain("codex");
    });

    it("reports missing required tools correctly", async () => {
      // Set only optional tools as available
      setToolAvailable("cass", true, "1.0.0");
      setToolAvailable("bv", true, "1.0.0");
      // Required tools are unavailable

      const res = await app.request("/setup/readiness");
      const body = (await res.json()) as Envelope<ReadinessData>;

      expect(res.status).toBe(200);
      expect(body.data.ready).toBe(false);
      expect(body.data.summary.missingRequired.length).toBeGreaterThan(0);
      expect(body.data.summary.missingRequired).toContain("dcg");
      expect(body.data.summary.missingRequired).toContain("br");
    });

    it("reports ready=true when all required tools are available", async () => {
      // Set required tools available
      setToolAvailable("dcg", true, "1.0.0");
      setToolAvailable("br", true, "1.0.0");
      setToolAvailable("claude", true, "1.0.0");
      setToolAuthenticated("claude", true);

      const res = await app.request("/setup/readiness");
      const body = (await res.json()) as Envelope<ReadinessData>;

      expect(res.status).toBe(200);
      expect(body.data.ready).toBe(true);
      expect(body.data.summary.missingRequired).toEqual([]);
    });
  });

  // ==========================================================================
  // Install Order Tests
  // ==========================================================================

  describe("Install order by phase", () => {
    it("returns tools grouped by installation phase", async () => {
      setAllToolsAvailable();

      const res = await app.request("/setup/readiness");
      const body = (await res.json()) as Envelope<ReadinessData>;

      expect(res.status).toBe(200);
      expect(body.data.installOrder).toBeDefined();
      expect(Array.isArray(body.data.installOrder)).toBe(true);

      const phases = body.data.installOrder!;
      // Should be sorted by phase number
      for (let i = 1; i < phases.length; i++) {
        expect(phases[i]!.phase).toBeGreaterThanOrEqual(phases[i - 1]!.phase);
      }

      // dcg is phase 0, should be first
      const phase0 = phases.find((p) => p.phase === 0);
      expect(phase0?.tools).toContain("dcg");
    });
  });

  // ==========================================================================
  // Missing Tool Simulation Tests
  // ==========================================================================

  describe("Missing tool simulation", () => {
    it("handles all tools missing gracefully", async () => {
      setAllToolsUnavailable();

      const res = await app.request("/setup/readiness");
      const body = (await res.json()) as Envelope<ReadinessData>;

      expect(res.status).toBe(200);
      expect(body.data.ready).toBe(false);
      expect(body.data.summary.agentsAvailable).toBe(0);
      expect(body.data.summary.toolsAvailable).toBe(0);
      expect(body.data.recommendations.length).toBeGreaterThan(0);
    });

    it("handles partial tool availability", async () => {
      // Only dcg available
      setToolAvailable("dcg", true, "1.2.3");

      const res = await app.request("/setup/readiness");
      const body = (await res.json()) as Envelope<ReadinessData>;

      expect(res.status).toBe(200);
      expect(body.data.summary.toolsAvailable).toBe(1);
      expect(body.data.tools.find((t) => t.name === "dcg")?.available).toBe(
        true,
      );
      expect(body.data.tools.find((t) => t.name === "br")?.available).toBe(
        false,
      );
    });

    it("generates recommendations for missing tools", async () => {
      setAllToolsUnavailable();

      const res = await app.request("/setup/readiness");
      const body = (await res.json()) as Envelope<ReadinessData>;

      expect(res.status).toBe(200);
      expect(
        body.data.recommendations.some((r) =>
          r.includes("Install required tools"),
        ),
      ).toBe(true);
      expect(
        body.data.recommendations.some((r) => r.includes("agent CLI")),
      ).toBe(true);
    });
  });

  // ==========================================================================
  // Authentication Issue Tests
  // ==========================================================================

  describe("Authentication issues handling", () => {
    it("reports auth issues for available but unauthenticated agents", async () => {
      setToolAvailable("claude", true, "1.0.0");
      setToolAuthenticated("claude", false);
      setToolAvailable("dcg", true, "1.0.0");
      setToolAvailable("br", true, "1.0.0");

      const res = await app.request("/setup/readiness");
      const body = (await res.json()) as Envelope<ReadinessData>;

      expect(res.status).toBe(200);
      expect(body.data.ready).toBe(false); // Auth issues prevent ready state
      expect(body.data.summary.authIssues.length).toBeGreaterThan(0);
      expect(
        body.data.recommendations.some((r) => r.includes("authentication")),
      ).toBe(true);
    });

    it("reports ready=true when auth issues are resolved", async () => {
      setToolAvailable("claude", true, "1.0.0");
      setToolAuthenticated("claude", true);
      setToolAvailable("dcg", true, "1.0.0");
      setToolAvailable("br", true, "1.0.0");

      const res = await app.request("/setup/readiness");
      const body = (await res.json()) as Envelope<ReadinessData>;

      expect(res.status).toBe(200);
      expect(body.data.ready).toBe(true);
      expect(body.data.summary.authIssues).toEqual([]);
    });
  });

  // ==========================================================================
  // Manifest Metadata Tests
  // ==========================================================================

  describe("Manifest metadata in response", () => {
    it("includes manifest provenance information", async () => {
      setAllToolsAvailable();

      const res = await app.request("/setup/readiness");
      const body = (await res.json()) as Envelope<ReadinessData>;

      expect(res.status).toBe(200);
      expect(body.data.manifest).toBeDefined();
      expect(body.data.manifest?.schemaVersion).toBe("1.0.0");
    });

    it("handles different schema versions", async () => {
      mockRegistrySchemaVersion = "2.0.0-beta";
      setAllToolsAvailable();

      const res = await app.request("/setup/readiness");
      const body = (await res.json()) as Envelope<ReadinessData>;

      expect(res.status).toBe(200);
      expect(body.data.manifest?.schemaVersion).toBe("2.0.0-beta");
    });
  });

  // ==========================================================================
  // Install Endpoint Tests
  // ==========================================================================

  describe("Install endpoint deterministic errors", () => {
    // Enable unauthenticated installs for these tests (auth middleware not mounted)
    const originalEnv = process.env["ENABLE_SETUP_INSTALL_UNAUTH"];
    beforeEach(() => {
      process.env["ENABLE_SETUP_INSTALL_UNAUTH"] = "true";
    });
    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env["ENABLE_SETUP_INSTALL_UNAUTH"] = originalEnv;
      } else {
        delete process.env["ENABLE_SETUP_INSTALL_UNAUTH"];
      }
    });

    it("returns deterministic error for unknown tool", async () => {
      const res = await app.request("/setup/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "nonexistent-tool" }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as Envelope<unknown>;
      expect(body.error).toBeDefined();
    });

    it("returns deterministic error for tool without install command", async () => {
      // claude has no installCommand in the registry
      const res = await app.request("/setup/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "claude" }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as Envelope<unknown>;
      expect(body.error?.code).toBe("NO_INSTALL_AVAILABLE");
    });

    it("validates request body schema", async () => {
      const res = await app.request("/setup/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invalid: "payload" }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: unknown };
      expect(body.error).toBeDefined();
    });
  });

  // ==========================================================================
  // Logging Verification Tests
  // ==========================================================================

  describe("Logging includes required context", () => {
    it("logs readiness check with bypass_cache parameter", async () => {
      setAllToolsAvailable();

      await app.request("/setup/readiness?bypass_cache=true");

      const infoLogs = getLogEventsByLevel("info");
      expect(infoLogs.length).toBeGreaterThan(0);

      // Should log the bypassCache parameter
      const checkLog = findLogWithMessage("info", "bypassCache");
      expect(checkLog).toBeDefined();
    });

    it("logs readiness completion with summary", async () => {
      setAllToolsAvailable();

      await app.request("/setup/readiness");

      // Should log completion with counts
      const completionLog = findLogWithMessage("info", "complete");
      expect(completionLog).toBeDefined();
    });
  });

  // ==========================================================================
  // Verify Endpoint Tests
  // ==========================================================================

  describe("Verify endpoint for individual tools", () => {
    it("returns verification result for available tool", async () => {
      setToolAvailable("dcg", true, "2.1.0");

      const res = await app.request("/setup/verify/dcg", {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Envelope<{
        tool: string;
        available: boolean;
        detectedAt: string;
        durationMs: number;
      }>;

      expect(body.object).toBe("verification_result");
      expect(body.data.tool).toBe("dcg");
      expect(body.data.available).toBe(true);
    });

    it("returns verification result for unavailable tool", async () => {
      setToolAvailable("dcg", false);

      const res = await app.request("/setup/verify/dcg", {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Envelope<{
        tool: string;
        available: boolean;
      }>;

      expect(body.data.tool).toBe("dcg");
      expect(body.data.available).toBe(false);
    });

    it("returns 404 for unknown tool verification", async () => {
      const res = await app.request("/setup/verify/nonexistent", {
        method: "POST",
      });

      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // Cache Behavior Tests
  // ==========================================================================

  describe("Cache behavior", () => {
    it("respects bypass_cache parameter", async () => {
      setToolAvailable("dcg", true, "1.0.0");

      // First request
      const res1 = await app.request("/setup/readiness");
      const body1 = (await res1.json()) as Envelope<ReadinessData>;

      // Modify availability
      setToolAvailable("dcg", false);

      // Second request without bypass - might be cached
      const res2 = await app.request("/setup/readiness");
      const _body2 = (await res2.json()) as Envelope<ReadinessData>;

      // Third request with bypass - should get fresh data
      const res3 = await app.request("/setup/readiness?bypass_cache=true");
      const body3 = (await res3.json()) as Envelope<ReadinessData>;

      expect(body1.data.tools.find((t) => t.name === "dcg")?.available).toBe(
        true,
      );
      expect(body3.data.tools.find((t) => t.name === "dcg")?.available).toBe(
        false,
      );
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe("Edge cases", () => {
    it("handles empty tool registry gracefully", async () => {
      mockRegistryTools = [];

      const res = await app.request("/setup/readiness");
      const body = (await res.json()) as Envelope<ReadinessData>;

      expect(res.status).toBe(200);
      expect(body.data.agents).toEqual([]);
      expect(body.data.tools).toEqual([]);
    });

    it("handles registry with only agents", async () => {
      mockRegistryTools = [
        {
          id: "agents.claude",
          name: "claude",
          category: "agent" as const,
          tags: ["recommended"],
          optional: false,
          enabledByDefault: true,
          phase: 1,
        },
      ];
      setToolAvailable("claude", true, "1.0.0");
      setToolAuthenticated("claude", true);

      const res = await app.request("/setup/readiness");
      const body = (await res.json()) as Envelope<ReadinessData>;

      expect(res.status).toBe(200);
      expect(body.data.agents.length).toBe(1);
      expect(body.data.tools.length).toBe(0);
    });

    it("handles registry with only tools", async () => {
      mockRegistryTools = [
        {
          id: "tools.dcg",
          name: "dcg",
          category: "tool" as const,
          tags: ["critical"],
          optional: false,
          enabledByDefault: true,
          phase: 0,
        },
      ];
      setToolAvailable("dcg", true, "1.0.0");

      const res = await app.request("/setup/readiness");
      const body = (await res.json()) as Envelope<ReadinessData>;

      expect(res.status).toBe(200);
      expect(body.data.agents.length).toBe(0);
      expect(body.data.tools.length).toBe(1);
      // Ready should be false because no agent is available
      expect(body.data.ready).toBe(false);
    });
  });
});
