/**
 * Tests for the Base Driver class.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
  BaseDriver,
  type BaseDriverConfig,
  createDriverOptions,
} from "../base-driver";
import type {
  Agent,
  AgentConfig,
  AgentEvent,
  OutputLine,
  SendResult,
} from "../types";

/**
 * Concrete implementation of BaseDriver for testing.
 */
class TestDriver extends BaseDriver {
  public spawned = false;
  public sent = false;
  public terminated = false;
  public interrupted = false;
  public healthyState = true;

  protected async doHealthCheck(): Promise<boolean> {
    return this.healthyState;
  }

  protected async doSpawn(config: AgentConfig): Promise<Agent> {
    this.spawned = true;
    const now = new Date();
    return {
      id: config.id,
      config,
      driverId: this.driverId,
      driverType: this.driverType,
      activityState: "idle",
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      contextHealth: "healthy",
      startedAt: now,
      lastActivityAt: now,
    };
  }

  protected async doSend(
    _agentId: string,
    _message: string,
  ): Promise<SendResult> {
    this.sent = true;
    return { messageId: `msg_${Date.now()}`, queued: false };
  }

  protected async doTerminate(
    _agentId: string,
    _graceful: boolean,
  ): Promise<void> {
    this.terminated = true;
  }

  protected async doInterrupt(_agentId: string): Promise<void> {
    this.interrupted = true;
  }

  // Expose protected methods for testing
  public testUpdateState(
    agentId: string,
    updates: { activityState?: string },
  ): void {
    this.updateState(agentId, updates as any);
  }

  public testAddOutput(agentId: string, output: OutputLine): void {
    this.addOutput(agentId, output);
  }

  public testUpdateTokenUsage(
    agentId: string,
    usage: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    },
  ): void {
    this.updateTokenUsage(agentId, usage);
  }

  public testEmitEvent(agentId: string, event: AgentEvent): void {
    this.emitEvent(agentId, event);
  }

  public testDeleteAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  public testGetInternalState(agentId: string):
    | {
        eventSubscribers: Set<(event: AgentEvent) => void>;
      }
    | undefined {
    return this.agents.get(agentId) as
      | {
          eventSubscribers: Set<(event: AgentEvent) => void>;
        }
      | undefined;
  }
}

describe("BaseDriver", () => {
  let driver: TestDriver;
  let config: BaseDriverConfig;

  const createTestConfig = (id = "test-agent"): AgentConfig => ({
    id,
    provider: "claude",
    model: "claude-opus-4",
    workingDirectory: "/tmp/test",
  });

  beforeEach(() => {
    config = createDriverOptions("mock");
    driver = new TestDriver(config);
  });

  describe("createDriverOptions", () => {
    it("should create default options for SDK driver", () => {
      const opts = createDriverOptions("sdk");

      expect(opts.driverType).toBe("sdk");
      expect(opts.capabilities.structuredEvents).toBe(true);
      expect(opts.capabilities.terminalAttach).toBe(false);
    });

    it("should create default options for ACP driver", () => {
      const opts = createDriverOptions("acp");

      expect(opts.driverType).toBe("acp");
      expect(opts.capabilities.diffRendering).toBe(true);
    });

    it("should create default options for Claude Code WS driver", () => {
      const opts = createDriverOptions("claude_code_ws");

      expect(opts.driverType).toBe("claude_code_ws");
      expect(opts.capabilities.streaming).toBe(true);
      expect(opts.capabilities.toolCalls).toBe(true);
      expect(opts.capabilities.checkpoint).toBe(false);
    });

    it("should create default options for Tmux driver", () => {
      const opts = createDriverOptions("tmux");

      expect(opts.driverType).toBe("tmux");
      expect(opts.capabilities.terminalAttach).toBe(true);
      expect(opts.capabilities.structuredEvents).toBe(false);
    });
  });

  describe("getCapabilities", () => {
    it("should return a copy of capabilities", () => {
      const caps1 = driver.getCapabilities();
      const caps2 = driver.getCapabilities();

      expect(caps1).toEqual(caps2);
      expect(caps1).not.toBe(caps2); // Different objects
    });
  });

  describe("isHealthy", () => {
    it("should return true when healthy", async () => {
      driver.healthyState = true;
      expect(await driver.isHealthy()).toBe(true);
    });

    it("should return false when unhealthy", async () => {
      driver.healthyState = false;
      expect(await driver.isHealthy()).toBe(false);
    });
  });

  describe("spawn", () => {
    it("should spawn an agent", async () => {
      const agentConfig = createTestConfig();
      const { agent } = await driver.spawn(agentConfig);

      expect(agent.id).toBe(agentConfig.id);
      expect(agent.config).toEqual(agentConfig);
      expect(driver.spawned).toBe(true);
    });

    it("should reject duplicate agent IDs", async () => {
      const agentConfig = createTestConfig();
      await driver.spawn(agentConfig);

      await expect(driver.spawn(agentConfig)).rejects.toThrow("already exists");
    });

    it("should enforce capacity limits", async () => {
      // Create driver with capacity of 1
      const limitedConfig = { ...config, maxConcurrentAgents: 1 };
      const limitedDriver = new TestDriver(limitedConfig);

      await limitedDriver.spawn(createTestConfig("agent-1"));
      await expect(
        limitedDriver.spawn(createTestConfig("agent-2")),
      ).rejects.toThrow("at capacity");
    });
  });

  describe("getState", () => {
    it("should return agent state", async () => {
      const agentConfig = createTestConfig();
      await driver.spawn(agentConfig);

      const state = await driver.getState(agentConfig.id);
      expect(state.id).toBe(agentConfig.id);
      expect(state.activityState).toBe("idle");
    });

    it("should throw for non-existent agent", async () => {
      await expect(driver.getState("non-existent")).rejects.toThrow(
        "Agent not found",
      );
    });
  });

  describe("send", () => {
    it("should send a message", async () => {
      const agentConfig = createTestConfig();
      await driver.spawn(agentConfig);

      const result = await driver.send(agentConfig.id, "Hello");
      expect(result.messageId).toBeDefined();
      expect(driver.sent).toBe(true);
    });

    it("should throw when agent is working", async () => {
      const agentConfig = createTestConfig();
      await driver.spawn(agentConfig);

      // Set state to working
      driver.testUpdateState(agentConfig.id, { activityState: "working" });

      await expect(driver.send(agentConfig.id, "Hello")).rejects.toThrow(
        "busy",
      );
    });

    it("should throw when agent is thinking", async () => {
      const agentConfig = createTestConfig();
      await driver.spawn(agentConfig);

      // Set state to thinking (processing a previous message)
      driver.testUpdateState(agentConfig.id, { activityState: "thinking" });

      await expect(driver.send(agentConfig.id, "Hello")).rejects.toThrow(
        "busy",
      );
    });

    it("should throw when agent is calling tools", async () => {
      const agentConfig = createTestConfig();
      await driver.spawn(agentConfig);

      // Set state to tool_calling
      driver.testUpdateState(agentConfig.id, { activityState: "tool_calling" });

      await expect(driver.send(agentConfig.id, "Hello")).rejects.toThrow(
        "busy",
      );
    });
  });

  describe("interrupt", () => {
    it("should interrupt an agent", async () => {
      const agentConfig = createTestConfig();
      await driver.spawn(agentConfig);

      await driver.interrupt(agentConfig.id);
      expect(driver.interrupted).toBe(true);
    });
  });

  describe("terminate", () => {
    it("should terminate an agent", async () => {
      const agentConfig = createTestConfig();
      await driver.spawn(agentConfig);

      await driver.terminate(agentConfig.id);
      expect(driver.terminated).toBe(true);

      // Agent should no longer exist
      await expect(driver.getState(agentConfig.id)).rejects.toThrow(
        "Agent not found",
      );
    });
  });

  describe("getOutput", () => {
    it("should return output lines", async () => {
      const agentConfig = createTestConfig();
      await driver.spawn(agentConfig);

      // Add some output
      driver.testAddOutput(agentConfig.id, {
        timestamp: new Date(),
        type: "text",
        content: "Hello",
      });

      const output = await driver.getOutput(agentConfig.id);
      expect(output.length).toBe(1);
      expect(output[0]?.content).toBe("Hello");
    });

    it("should filter by timestamp", async () => {
      const agentConfig = createTestConfig();
      await driver.spawn(agentConfig);

      const oldTime = new Date(Date.now() - 10000);
      const newTime = new Date();

      driver.testAddOutput(agentConfig.id, {
        timestamp: oldTime,
        type: "text",
        content: "Old",
      });
      driver.testAddOutput(agentConfig.id, {
        timestamp: newTime,
        type: "text",
        content: "New",
      });

      const filtered = await driver.getOutput(
        agentConfig.id,
        new Date(Date.now() - 5000),
      );
      expect(filtered.length).toBe(1);
      expect(filtered[0]?.content).toBe("New");
    });
  });

  describe("subscribe", () => {
    it("should yield events", async () => {
      const agentConfig = createTestConfig();
      await driver.spawn(agentConfig);

      const events: AgentEvent[] = [];
      let _collectorDone = false;

      // Start collecting events in background
      const collector = (async () => {
        try {
          for await (const event of driver.subscribe(agentConfig.id)) {
            events.push(event);
            if (event.type === "terminated") break;
          }
        } finally {
          _collectorDone = true;
        }
      })();

      // Wait a tick for subscription to start
      await Bun.sleep(10);

      // Emit a state change event
      driver.testEmitEvent(agentConfig.id, {
        type: "state_change",
        agentId: agentConfig.id,
        timestamp: new Date(),
        previousState: "idle",
        newState: "thinking",
      });

      // Wait a bit for event to propagate
      await Bun.sleep(10);

      // Terminate to end subscription (this emits terminated event)
      await driver.terminate(agentConfig.id);

      // Wait for collector to finish
      await collector;

      // Should have at least the state_change and terminated events
      expect(events.length).toBeGreaterThanOrEqual(1);
    });

    it("should terminate subscription if agent disappears during setup", async () => {
      const agentConfig = createTestConfig();
      await driver.spawn(agentConfig);

      const state = driver.testGetInternalState(agentConfig.id);
      expect(state).toBeDefined();
      if (!state) return;

      const originalAdd = state.eventSubscribers.add.bind(
        state.eventSubscribers,
      );
      state.eventSubscribers.add = (subscriber) => {
        driver.testDeleteAgent(agentConfig.id);
        return originalAdd(subscriber);
      };

      const events: AgentEvent[] = [];
      const subscription = driver.subscribe(agentConfig.id);
      const collector = (async () => {
        for await (const event of subscription) {
          events.push(event);
          if (event.type === "terminated") break;
        }
      })();

      await Promise.race([
        collector,
        Bun.sleep(200).then(() => {
          throw new Error("Subscription did not terminate");
        }),
      ]);

      expect(events.some((event) => event.type === "terminated")).toBe(true);
    });

    it("should abort subscription and remove subscriber without termination", async () => {
      const agentConfig = createTestConfig();
      await driver.spawn(agentConfig);

      const state = driver.testGetInternalState(agentConfig.id);
      expect(state).toBeDefined();
      if (!state) return;
      expect(state.eventSubscribers.size).toBe(0);

      const abortController = new AbortController();

      const subscription = driver.subscribe(
        agentConfig.id,
        abortController.signal,
      );
      const collector = (async () => {
        for await (const _event of subscription) {
          // Should not yield any events in this test
        }
      })();

      // Wait a tick for subscription to start and register
      await Bun.sleep(10);
      expect(state.eventSubscribers.size).toBe(1);

      abortController.abort();

      await Promise.race([
        collector,
        Bun.sleep(200).then(() => {
          throw new Error("Subscription did not terminate after abort()");
        }),
      ]);

      expect(state.eventSubscribers.size).toBe(0);
    });
  });

  describe("token usage and context health", () => {
    it("should update token usage", async () => {
      const agentConfig = createTestConfig();
      await driver.spawn(agentConfig);

      driver.testUpdateTokenUsage(agentConfig.id, {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      });

      const state = await driver.getState(agentConfig.id);
      expect(state.tokenUsage.totalTokens).toBe(150);
    });

    it("should emit context warning when usage is high", async () => {
      const agentConfig = { ...createTestConfig(), maxTokens: 1000 };
      await driver.spawn(agentConfig);

      const events: AgentEvent[] = [];
      const subscription = driver.subscribe(agentConfig.id);

      const collector = (async () => {
        for await (const event of subscription) {
          events.push(event);
          if (event.type === "context_warning" || event.type === "terminated")
            break;
        }
      })();

      // Update to high usage (>75%)
      driver.testUpdateTokenUsage(agentConfig.id, {
        promptTokens: 800,
        completionTokens: 0,
        totalTokens: 800,
      });

      // Wait a bit then terminate
      await Bun.sleep(100);
      await driver.terminate(agentConfig.id);
      await collector;

      expect(events.some((e) => e.type === "context_warning")).toBe(true);
    });
  });
});
