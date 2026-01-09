/**
 * Tests for the Driver Registry.
 */

import { describe, expect, it, beforeEach } from "bun:test";
import { DriverRegistry, type DriverRequirements } from "../registry";
import type { AgentDriver, DriverOptions, DriverCapabilities, AgentDriverType } from "../interface";
import type { AgentConfig, AgentEvent, AgentState, OutputLine, SendResult, SpawnResult } from "../types";

/**
 * Create a mock driver for testing.
 */
function createMockDriver(type: AgentDriverType, healthy = true): AgentDriver {
  const capabilities: DriverCapabilities = {
    structuredEvents: type === "sdk" || type === "acp",
    toolCalls: type === "sdk" || type === "acp",
    fileOperations: type === "sdk" || type === "acp",
    terminalAttach: type === "tmux",
    diffRendering: type === "acp",
    checkpoint: type !== "tmux",
    interrupt: true,
    streaming: true,
  };

  return {
    driverId: `${type}-test`,
    driverType: type,
    getCapabilities: () => capabilities,
    isHealthy: async () => healthy,
    spawn: async (config: AgentConfig): Promise<SpawnResult> => {
      const now = new Date();
      return {
        agent: {
          id: config.id,
          config,
          driverId: `${type}-test`,
          driverType: type,
          activityState: "idle",
          tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          contextHealth: "healthy",
          startedAt: now,
          lastActivityAt: now,
        },
      };
    },
    getState: async (_agentId: string): Promise<AgentState> => {
      throw new Error("Not implemented in mock");
    },
    terminate: async (_agentId: string, _graceful?: boolean): Promise<void> => {},
    send: async (_agentId: string, _message: string): Promise<SendResult> => {
      return { messageId: "msg_123", queued: false };
    },
    interrupt: async (_agentId: string): Promise<void> => {},
    getOutput: async (_agentId: string, _since?: Date, _limit?: number): Promise<OutputLine[]> => {
      return [];
    },
    subscribe: async function* (_agentId: string): AsyncIterable<AgentEvent> {
      // Empty async generator
    },
  };
}

describe("DriverRegistry", () => {
  let registry: DriverRegistry;

  beforeEach(() => {
    registry = new DriverRegistry();
  });

  describe("register", () => {
    it("should register a driver", () => {
      registry.register({
        type: "sdk",
        factory: async () => createMockDriver("sdk"),
        description: "Mock SDK driver",
        defaultCapabilities: createMockDriver("sdk").getCapabilities(),
      });

      expect(registry.has("sdk")).toBe(true);
    });

    it("should unregister a driver", () => {
      registry.register({
        type: "sdk",
        factory: async () => createMockDriver("sdk"),
        description: "Mock SDK driver",
        defaultCapabilities: createMockDriver("sdk").getCapabilities(),
      });

      registry.unregister("sdk");
      expect(registry.has("sdk")).toBe(false);
    });
  });

  describe("getDriver", () => {
    it("should create and return a driver instance", async () => {
      registry.register({
        type: "sdk",
        factory: async () => createMockDriver("sdk"),
        description: "Mock SDK driver",
        defaultCapabilities: createMockDriver("sdk").getCapabilities(),
      });

      const driver = await registry.getDriver("sdk");
      expect(driver.driverType).toBe("sdk");
    });

    it("should cache driver instances", async () => {
      let factoryCallCount = 0;
      registry.register({
        type: "sdk",
        factory: async () => {
          factoryCallCount++;
          return createMockDriver("sdk");
        },
        description: "Mock SDK driver",
        defaultCapabilities: createMockDriver("sdk").getCapabilities(),
      });

      await registry.getDriver("sdk");
      await registry.getDriver("sdk");
      expect(factoryCallCount).toBe(1);
    });

    it("should throw for unregistered driver type", async () => {
      await expect(registry.getDriver("sdk")).rejects.toThrow("Driver type not registered");
    });
  });

  describe("selectDriver", () => {
    beforeEach(() => {
      registry.register({
        type: "sdk",
        factory: async () => createMockDriver("sdk"),
        description: "Mock SDK driver",
        defaultCapabilities: createMockDriver("sdk").getCapabilities(),
      });
      registry.register({
        type: "acp",
        factory: async () => createMockDriver("acp"),
        description: "Mock ACP driver",
        defaultCapabilities: createMockDriver("acp").getCapabilities(),
      });
      registry.register({
        type: "tmux",
        factory: async () => createMockDriver("tmux"),
        description: "Mock Tmux driver",
        defaultCapabilities: createMockDriver("tmux").getCapabilities(),
      });
    });

    it("should select preferred type when available and healthy", async () => {
      const result = await registry.selectDriver({ preferredType: "acp" });
      expect(result.type).toBe("acp");
    });

    it("should fall back to SDK when no preference given", async () => {
      const result = await registry.selectDriver();
      expect(result.type).toBe("sdk");
    });

    it("should skip drivers that don't meet capability requirements", async () => {
      const result = await registry.selectDriver({
        requiredCapabilities: ["terminalAttach"],
      });
      expect(result.type).toBe("tmux");
    });

    it("should throw when no driver meets requirements", async () => {
      await expect(
        registry.selectDriver({
          requiredCapabilities: ["structuredEvents", "terminalAttach"],
        })
      ).rejects.toThrow("No suitable driver found");
    });
  });

  describe("checkHealth", () => {
    it("should check health of all instances", async () => {
      registry.register({
        type: "sdk",
        factory: async () => createMockDriver("sdk", true),
        description: "Mock SDK driver",
        defaultCapabilities: createMockDriver("sdk").getCapabilities(),
      });

      await registry.getDriver("sdk");
      const health = await registry.checkHealth();

      expect(health.get("sdk-default")).toBe(true);
    });
  });
});
