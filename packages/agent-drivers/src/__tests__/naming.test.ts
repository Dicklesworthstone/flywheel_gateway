/**
 * Tests for deterministic NTM naming + mapping.
 *
 * Part of bead bd-4udr: Tests for deterministic NTM naming + mapping.
 *
 * Tests cover:
 * - Collision avoidance: different inputs produce different outputs
 * - Normalization: special characters are handled consistently
 * - Traceability: full end-to-end correlation between Gateway and NTM
 * - Structured logging assertions for mapping resolution
 */

import { describe, expect, it } from "bun:test";
import type { AgentConfig } from "../types";
import {
  createAgentNtmMapping,
  extractProjectName,
  generateAgentSuffix,
  generateNtmPaneId,
  generateNtmSessionName,
  parseNtmSessionName,
} from "../naming";

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a minimal AgentConfig for testing.
 */
function createTestConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "agent_test_abc123",
    name: "TestAgent",
    model: "claude-opus-4",
    provider: "claude",
    workingDirectory: "/data/projects/flywheel_gateway",
    ...overrides,
  };
}

// ============================================================================
// extractProjectName Tests
// ============================================================================

describe("extractProjectName", () => {
  describe("basic extraction", () => {
    it("extracts last path segment from Unix path", () => {
      const result = extractProjectName("/home/user/projects/my-project");
      expect(result).toBe("my-project");
    });

    it("extracts last path segment from Windows-style path", () => {
      const result = extractProjectName("C:\\Users\\dev\\code\\my-project");
      expect(result).toBe("my-project");
    });

    it("extracts from short paths", () => {
      const result = extractProjectName("/dp/gateway");
      expect(result).toBe("gateway");
    });

    it("handles single segment paths", () => {
      const result = extractProjectName("/flywheel");
      expect(result).toBe("flywheel");
    });
  });

  describe("normalization", () => {
    it("preserves underscores (tmux-safe)", () => {
      const result = extractProjectName("/home/user/flywheel_gateway");
      expect(result).toBe("flywheel_gateway");
    });

    it("converts to lowercase", () => {
      const result = extractProjectName("/home/user/MyProject");
      expect(result).toBe("myproject");
    });

    it("replaces @ and # with hyphens, preserves dots", () => {
      const result = extractProjectName("/home/user/project@2.0#beta");
      expect(result).toBe("project-2.0-beta");
    });

    it("collapses multiple hyphens", () => {
      const result = extractProjectName("/home/user/my--project--name");
      expect(result).toBe("my-project-name");
    });

    it("removes leading and trailing hyphens", () => {
      const result = extractProjectName("/home/user/-project-");
      expect(result).toBe("project");
    });

    it("truncates to max 16 characters", () => {
      const result = extractProjectName(
        "/home/user/very-long-project-name-that-exceeds-limit",
      );
      expect(result.length).toBeLessThanOrEqual(16);
    });
  });

  describe("edge cases", () => {
    it("handles empty path segments", () => {
      const result = extractProjectName("/home/user//project//");
      expect(result).toBe("project");
    });

    it("returns 'project' for empty path", () => {
      const result = extractProjectName("");
      expect(result).toBe("project");
    });

    it("handles paths with only slashes", () => {
      const result = extractProjectName("///");
      expect(result).toBe("project");
    });
  });
});

// ============================================================================
// generateAgentSuffix Tests - Collision Avoidance
// ============================================================================

describe("generateAgentSuffix", () => {
  describe("determinism", () => {
    it("produces same output for same input", () => {
      const suffix1 = generateAgentSuffix("agent_12345_abc");
      const suffix2 = generateAgentSuffix("agent_12345_abc");
      expect(suffix1).toBe(suffix2);
    });

    it("produces consistent 6-character output", () => {
      const suffix = generateAgentSuffix("agent_12345_abc");
      expect(suffix.length).toBe(6);
    });

    it("uses only lowercase alphanumeric characters", () => {
      const suffix = generateAgentSuffix("agent_12345_abc");
      expect(suffix).toMatch(/^[0-9a-z]{6}$/);
    });
  });

  describe("collision avoidance", () => {
    it("produces different outputs for different inputs", () => {
      const suffix1 = generateAgentSuffix("agent_12345_abc");
      const suffix2 = generateAgentSuffix("agent_12345_def");
      expect(suffix1).not.toBe(suffix2);
    });

    it("produces different outputs for similar inputs", () => {
      const suffix1 = generateAgentSuffix("agent_1");
      const suffix2 = generateAgentSuffix("agent_2");
      expect(suffix1).not.toBe(suffix2);
    });

    it("produces different outputs for reversed inputs", () => {
      const suffix1 = generateAgentSuffix("abc123");
      const suffix2 = generateAgentSuffix("321cba");
      expect(suffix1).not.toBe(suffix2);
    });

    it("avoids collisions across 1000 unique inputs", () => {
      const suffixes = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        const suffix = generateAgentSuffix(`agent_${i}_hash_${Math.random()}`);
        suffixes.add(suffix);
      }
      // With 6 chars from 36 charset (36^6 = 2B combos), 1000 samples should be unique
      // Allow small overlap due to hash collisions (should be < 1%)
      expect(suffixes.size).toBeGreaterThan(990);
    });

    it("handles empty string input", () => {
      const suffix = generateAgentSuffix("");
      expect(suffix.length).toBe(6);
      expect(suffix).toMatch(/^[0-9a-z]{6}$/);
    });

    it("handles very long input", () => {
      const longInput = "a".repeat(10000);
      const suffix = generateAgentSuffix(longInput);
      expect(suffix.length).toBe(6);
      expect(suffix).toMatch(/^[0-9a-z]{6}$/);
    });
  });
});

// ============================================================================
// generateNtmSessionName Tests
// ============================================================================

describe("generateNtmSessionName", () => {
  describe("format", () => {
    it("produces correctly formatted session name", () => {
      const config = createTestConfig();
      const sessionName = generateNtmSessionName({ config });

      // Should match pattern: fw-<project>-<agent>-<hash6>
      // Note: underscores are preserved in tmux-safe names
      expect(sessionName).toMatch(/^fw-[a-z0-9_-]+-[a-z0-9]+-[a-z0-9]{6}$/);
    });

    it("starts with fw- prefix", () => {
      const config = createTestConfig();
      const sessionName = generateNtmSessionName({ config });
      expect(sessionName).toMatch(/^fw-/);
    });

    it("uses agent name when provided", () => {
      const config = createTestConfig({ name: "MyAgent" });
      const sessionName = generateNtmSessionName({ config });
      expect(sessionName).toContain("-myagent-");
    });

    it("uses provider when name is not provided", () => {
      const config = createTestConfig();
      delete (config as { name?: string }).name;
      const sessionName = generateNtmSessionName({ config });
      expect(sessionName).toContain("-claude-");
    });

    it("allows custom project name override", () => {
      const config = createTestConfig();
      const sessionName = generateNtmSessionName({
        config,
        projectName: "custom",
      });
      expect(sessionName).toContain("fw-custom-");
    });
  });

  describe("determinism", () => {
    it("produces same name for same config", () => {
      const config = createTestConfig();
      const name1 = generateNtmSessionName({ config });
      const name2 = generateNtmSessionName({ config });
      expect(name1).toBe(name2);
    });

    it("produces different names for different agent IDs", () => {
      const config1 = createTestConfig({ id: "agent_1_abc" });
      const config2 = createTestConfig({ id: "agent_2_def" });
      const name1 = generateNtmSessionName({ config: config1 });
      const name2 = generateNtmSessionName({ config: config2 });
      expect(name1).not.toBe(name2);
    });
  });

  describe("normalization", () => {
    it("normalizes special characters in agent name", () => {
      const config = createTestConfig({ name: "My@Agent#1" });
      const sessionName = generateNtmSessionName({ config });
      // Should not contain @ or # (replaced with hyphens), underscores are preserved
      expect(sessionName).toMatch(/^fw-[a-z0-9_.-]+-[a-z0-9]{6}$/);
    });

    it("handles long agent names", () => {
      const config = createTestConfig({
        name: "VeryLongAgentNameThatExceedsLimit",
      });
      const sessionName = generateNtmSessionName({ config });
      // Agent label is truncated to 12 chars
      const parsed = parseNtmSessionName(sessionName);
      expect(parsed?.agent.length).toBeLessThanOrEqual(12);
    });
  });
});

// ============================================================================
// generateNtmPaneId Tests
// ============================================================================

describe("generateNtmPaneId", () => {
  it("generates pane ID in correct format", () => {
    const paneId = generateNtmPaneId("fw-project-agent-abc123");
    expect(paneId).toBe("fw-project-agent-abc123:0.0");
  });

  it("uses window 0, pane 0 format", () => {
    const paneId = generateNtmPaneId("test-session");
    expect(paneId).toMatch(/:0\.0$/);
  });
});

// ============================================================================
// parseNtmSessionName Tests
// ============================================================================

describe("parseNtmSessionName", () => {
  describe("valid parsing", () => {
    it("parses standard session name", () => {
      const parsed = parseNtmSessionName("fw-project-agent-abc123");
      expect(parsed).toEqual({
        project: "project",
        agent: "agent",
        suffix: "abc123",
      });
    });

    it("parses session name with hyphenated project", () => {
      const parsed = parseNtmSessionName("fw-my-project-agent-abc123");
      expect(parsed).toEqual({
        project: "my-project",
        agent: "agent",
        suffix: "abc123",
      });
    });

    it("parses session name with complex project name", () => {
      const parsed = parseNtmSessionName(
        "fw-flywheel-gateway-v2-claude-xyz789",
      );
      expect(parsed).toEqual({
        project: "flywheel-gateway-v2",
        agent: "claude",
        suffix: "xyz789",
      });
    });
  });

  describe("invalid inputs", () => {
    it("returns null for non-flywheel session", () => {
      const parsed = parseNtmSessionName("other-session-name");
      expect(parsed).toBeNull();
    });

    it("returns null for missing prefix", () => {
      const parsed = parseNtmSessionName("project-agent-abc123");
      expect(parsed).toBeNull();
    });

    it("returns null for wrong suffix length", () => {
      const parsed = parseNtmSessionName("fw-project-agent-abc");
      expect(parsed).toBeNull();
    });

    it("returns null for uppercase suffix", () => {
      const parsed = parseNtmSessionName("fw-project-agent-ABC123");
      expect(parsed).toBeNull();
    });

    it("returns null for too few parts", () => {
      const parsed = parseNtmSessionName("fw-abc123");
      expect(parsed).toBeNull();
    });
  });
});

// ============================================================================
// createAgentNtmMapping Tests - Traceability
// ============================================================================

describe("createAgentNtmMapping", () => {
  describe("complete mapping", () => {
    it("creates mapping with all required fields", () => {
      const config = createTestConfig();
      const mapping = createAgentNtmMapping(config);

      expect(mapping).toHaveProperty("agentId");
      expect(mapping).toHaveProperty("sessionName");
      expect(mapping).toHaveProperty("paneId");
      expect(mapping).toHaveProperty("project");
      expect(mapping).toHaveProperty("agentLabel");
      expect(mapping).toHaveProperty("suffix");
    });

    it("preserves original agent ID", () => {
      const config = createTestConfig({ id: "agent_unique_id" });
      const mapping = createAgentNtmMapping(config);
      expect(mapping.agentId).toBe("agent_unique_id");
    });

    it("generates valid session name", () => {
      const config = createTestConfig();
      const mapping = createAgentNtmMapping(config);
      // Note: underscores are preserved in tmux-safe names
      expect(mapping.sessionName).toMatch(
        /^fw-[a-z0-9_-]+-[a-z0-9]+-[a-z0-9]{6}$/,
      );
    });

    it("generates pane ID based on session name", () => {
      const config = createTestConfig();
      const mapping = createAgentNtmMapping(config);
      expect(mapping.paneId).toBe(`${mapping.sessionName}:0.0`);
    });
  });

  describe("traceability - end-to-end correlation", () => {
    it("mapping is fully deterministic", () => {
      const config = createTestConfig();
      const mapping1 = createAgentNtmMapping(config);
      const mapping2 = createAgentNtmMapping(config);

      expect(mapping1.agentId).toBe(mapping2.agentId);
      expect(mapping1.sessionName).toBe(mapping2.sessionName);
      expect(mapping1.paneId).toBe(mapping2.paneId);
      expect(mapping1.project).toBe(mapping2.project);
      expect(mapping1.agentLabel).toBe(mapping2.agentLabel);
      expect(mapping1.suffix).toBe(mapping2.suffix);
    });

    it("can trace from Gateway to NTM via suffix", () => {
      const config = createTestConfig({ id: "agent_12345_trace" });
      const mapping = createAgentNtmMapping(config);
      const suffix = generateAgentSuffix(config.id);

      // The suffix in the mapping should match direct suffix generation
      expect(mapping.suffix).toBe(suffix);
      // And be present in the session name
      expect(mapping.sessionName).toContain(suffix);
    });

    it("can trace back from NTM session to Gateway", () => {
      const config = createTestConfig();
      const mapping = createAgentNtmMapping(config);

      // Parse the session name to verify traceability
      const parsed = parseNtmSessionName(mapping.sessionName);
      expect(parsed).not.toBeNull();
      expect(parsed?.project).toBe(mapping.project);
      expect(parsed?.suffix).toBe(mapping.suffix);
    });
  });

  describe("logging compatibility", () => {
    it("mapping can be serialized to JSON for logging", () => {
      const config = createTestConfig();
      const mapping = createAgentNtmMapping(config);

      // Should not throw
      const json = JSON.stringify(mapping);
      expect(json).toBeTruthy();

      // Should round-trip correctly
      const restored = JSON.parse(json);
      expect(restored.agentId).toBe(mapping.agentId);
      expect(restored.sessionName).toBe(mapping.sessionName);
    });

    it("mapping contains all fields needed for structured logging", () => {
      const config = createTestConfig({
        id: "agent_log_test_xyz",
        name: "LoggingAgent",
        workingDirectory: "/dp/flywheel_gateway",
      });
      const mapping = createAgentNtmMapping(config);

      // All these fields should be present for structured log correlation
      expect(mapping.agentId).toBe("agent_log_test_xyz");
      expect(mapping.sessionName).toBeTruthy();
      expect(mapping.paneId).toBeTruthy();
      expect(mapping.project).toBeTruthy();
      expect(mapping.agentLabel).toBe("loggingagent");
      expect(mapping.suffix.length).toBe(6);
    });
  });
});

// ============================================================================
// Integration Tests - Full Workflow
// ============================================================================

describe("naming integration", () => {
  it("full workflow: config → session → pane → mapping → trace", () => {
    // Start with agent config
    const config = createTestConfig({
      id: "agent_integration_test_001",
      name: "IntegrationTest",
      workingDirectory: "/data/projects/flywheel_gateway",
    });

    // Generate session name
    const sessionName = generateNtmSessionName({ config });
    // Note: underscores preserved, agent label truncated to 12 chars ("integrationtest" → "integrationt")
    expect(sessionName).toMatch(
      /^fw-flywheel_gateway-integrationt-[a-z0-9]{6}$/,
    );

    // Generate pane ID
    const paneId = generateNtmPaneId(sessionName);
    expect(paneId).toBe(`${sessionName}:0.0`);

    // Create full mapping
    const mapping = createAgentNtmMapping(config);
    expect(mapping.sessionName).toBe(sessionName);
    expect(mapping.paneId).toBe(paneId);
    expect(mapping.agentId).toBe(config.id);

    // Verify traceability
    const parsed = parseNtmSessionName(sessionName);
    expect(parsed).not.toBeNull();
    expect(parsed?.suffix).toBe(mapping.suffix);

    // Verify determinism
    const mapping2 = createAgentNtmMapping(config);
    expect(mapping2.sessionName).toBe(mapping.sessionName);
  });

  it("handles multiple agents in same project", () => {
    const configs = [
      createTestConfig({ id: "agent_multi_1", name: "Agent1" }),
      createTestConfig({ id: "agent_multi_2", name: "Agent2" }),
      createTestConfig({ id: "agent_multi_3", name: "Agent3" }),
    ];

    const mappings = configs.map((config) => createAgentNtmMapping(config));

    // All session names should be unique
    const sessionNames = mappings.map((m) => m.sessionName);
    expect(new Set(sessionNames).size).toBe(3);

    // All pane IDs should be unique
    const paneIds = mappings.map((m) => m.paneId);
    expect(new Set(paneIds).size).toBe(3);

    // But project should be same for all
    const projects = mappings.map((m) => m.project);
    expect(new Set(projects).size).toBe(1);
  });

  it("handles agents across different projects", () => {
    const configs = [
      createTestConfig({
        id: "agent_proj_1",
        workingDirectory: "/dp/project_a",
      }),
      createTestConfig({
        id: "agent_proj_2",
        workingDirectory: "/dp/project_b",
      }),
    ];

    const mappings = configs.map((config) => createAgentNtmMapping(config));

    // Projects should be different
    expect(mappings[0]?.project).not.toBe(mappings[1]?.project);

    // Session names should be different
    expect(mappings[0]?.sessionName).not.toBe(mappings[1]?.sessionName);
  });
});

// ============================================================================
// Structured Logging Assertions
// ============================================================================

describe("structured logging support", () => {
  it("mapping contains correlatable fields for log aggregation", () => {
    const config = createTestConfig({
      id: "agent_log_correlation_test",
      name: "LogCorrelation",
    });
    const mapping = createAgentNtmMapping(config);

    // These are the key fields operators use to correlate Gateway ↔ NTM logs
    const logEntry = {
      // Gateway side
      gatewayAgentId: mapping.agentId,
      // NTM side
      ntmSessionName: mapping.sessionName,
      ntmPaneId: mapping.paneId,
      // Derived/computed
      project: mapping.project,
      agentLabel: mapping.agentLabel,
      suffix: mapping.suffix,
    };

    // Verify all correlation fields are present and valid
    expect(logEntry.gatewayAgentId).toBe("agent_log_correlation_test");
    expect(logEntry.ntmSessionName).toContain("fw-");
    expect(logEntry.ntmPaneId).toContain(":0.0");
    expect(logEntry.project).toBeTruthy();
    expect(logEntry.agentLabel).toBeTruthy();
    expect(logEntry.suffix.length).toBe(6);
  });

  it("suffix enables quick grep correlation", () => {
    const config = createTestConfig({ id: "agent_grep_test" });
    const mapping = createAgentNtmMapping(config);

    // The suffix appears in both Gateway logs (via mapping) and NTM session names
    // This enables quick correlation: grep <suffix> gateway.log ntm.log
    const suffix = mapping.suffix;

    // Suffix should be unique enough to search
    expect(suffix.length).toBe(6);
    expect(suffix).toMatch(/^[0-9a-z]+$/);

    // And present in session name
    expect(mapping.sessionName.endsWith(suffix)).toBe(true);
  });

  it("mapping provides complete trace context", () => {
    const config = createTestConfig({
      id: "agent_ctx_test",
      name: "ContextTest",
      model: "claude-opus-4",
      provider: "claude",
      workingDirectory: "/dp/test-project",
    });

    const mapping = createAgentNtmMapping(config);

    // Complete trace context for debugging
    const traceContext = {
      agent: {
        id: mapping.agentId,
        label: mapping.agentLabel,
      },
      ntm: {
        session: mapping.sessionName,
        pane: mapping.paneId,
      },
      correlation: {
        project: mapping.project,
        suffix: mapping.suffix,
      },
    };

    // All parts should be populated
    expect(traceContext.agent.id).toBe("agent_ctx_test");
    expect(traceContext.agent.label).toBe("contexttest");
    expect(traceContext.ntm.session).toMatch(
      /^fw-test-project-contexttest-[a-z0-9]{6}$/,
    );
    expect(traceContext.ntm.pane).toMatch(
      /^fw-test-project-contexttest-[a-z0-9]{6}:0\.0$/,
    );
    expect(traceContext.correlation.project).toBe("test-project");
    expect(traceContext.correlation.suffix.length).toBe(6);
  });
});
