/**
 * Tests for Claude SDK Driver.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createDriverOptions } from "../base-driver";
import { ClaudeSDKDriver } from "../sdk/claude-driver";
import type { AgentConfig } from "../types";

describe("ClaudeSDKDriver", () => {
  describe("health check", () => {
    const originalFetch = globalThis.fetch;
    const testApiKey = "unit" + "-" + "test" + "-" + "value";

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("should return false when apiKey is missing", async () => {
      let called = false;
      globalThis.fetch = (async () => {
        called = true;
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch;

      const config = createDriverOptions("sdk", {
        driverId: "test-claude-health-missing",
      });
      const driver = new ClaudeSDKDriver(config, { apiKey: "" });

      const healthy = await driver.isHealthy();
      expect(healthy).toBe(false);
      expect(called).toBe(false);
    });

    it("should return true when /v1/models returns OK", async () => {
      let call:
        | {
            input: Parameters<typeof fetch>[0];
            init: Parameters<typeof fetch>[1];
          }
        | undefined;

      globalThis.fetch = (async (
        input: Parameters<typeof fetch>[0],
        init: Parameters<typeof fetch>[1],
      ) => {
        call = { input, init };
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const config = createDriverOptions("sdk", {
        driverId: "test-claude-health-ok",
      });
      const driver = new ClaudeSDKDriver(config, {
        apiKey: testApiKey,
        baseUrl: "https://example.anthropic",
      });

      const healthy = await driver.isHealthy();
      expect(healthy).toBe(true);
      expect(call).toBeDefined();
      if (!call) {
        throw new Error("Expected driver to call fetch()");
      }

      expect(call.input).toBe("https://example.anthropic/v1/models");
      expect(call.init?.method).toBe("GET");
      expect(call.init?.signal).toBeDefined();

      const headers = call.init?.headers as Record<string, string> | undefined;
      expect(headers?.["x-api-key"]).toBe(testApiKey);
      expect(headers?.["anthropic-version"]).toBe("2023-06-01");
    });

    it("should return false when /v1/models returns non-OK", async () => {
      globalThis.fetch = (async () => {
        return new Response("unauthorized", { status: 401 });
      }) as unknown as typeof fetch;

      const config = createDriverOptions("sdk", {
        driverId: "test-claude-health-non-ok",
      });
      const driver = new ClaudeSDKDriver(config, {
        apiKey: testApiKey,
        baseUrl: "https://example.anthropic",
      });

      const healthy = await driver.isHealthy();
      expect(healthy).toBe(false);
    });

    it("should return false when fetch throws", async () => {
      globalThis.fetch = (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch;

      const config = createDriverOptions("sdk", {
        driverId: "test-claude-health-throw",
      });
      const driver = new ClaudeSDKDriver(config, { apiKey: testApiKey });

      const healthy = await driver.isHealthy();
      expect(healthy).toBe(false);
    });
  });

  it("should accumulate token usage correctly", async () => {
    const config = createDriverOptions("sdk", { driverId: "test-claude" });
    const driver = new ClaudeSDKDriver(config, { apiKey: "" });

    // Spawn agent
    const agentConfig: AgentConfig = {
      id: "agent-1",
      provider: "claude",
      model: "claude-3-sonnet",
      workingDirectory: "/tmp",
    };
    await driver.spawn(agentConfig);

    // Initial state
    let state = await driver.getState("agent-1");
    expect(state.tokenUsage.totalTokens).toBe(0);

    // Send message 1
    await driver.send("agent-1", "Hello");

    // Wait for processing to complete (state back to idle)
    // processRequest has a 100ms delay
    await new Promise((resolve) => setTimeout(resolve, 200));

    state = await driver.getState("agent-1");
    // ClaudeSDKDriver simulates usage: 100 prompt, 50 completion, 150 total
    expect(state.tokenUsage.promptTokens).toBe(100);
    expect(state.tokenUsage.completionTokens).toBe(50);
    expect(state.tokenUsage.totalTokens).toBe(150);

    // Send message 2
    await driver.send("agent-1", "Another message");

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 200));

    state = await driver.getState("agent-1");
    // Should be accumulated: 100+100=200 prompt, 50+50=100 completion, 150+150=300 total
    expect(state.tokenUsage.promptTokens).toBe(200);
    expect(state.tokenUsage.completionTokens).toBe(100);
    expect(state.tokenUsage.totalTokens).toBe(300);
  });

  it("should prune conversation history when it exceeds maxHistoryMessages", async () => {
    // Create driver with small history limit for testing
    const config = createDriverOptions("sdk", {
      driverId: "test-claude-prune",
    });
    const driver = new ClaudeSDKDriver(config, {
      apiKey: "",
      maxHistoryMessages: 5,
    });

    const agentConfig: AgentConfig = {
      id: "agent-prune",
      provider: "claude",
      model: "claude-3-sonnet",
      workingDirectory: "/tmp",
    };
    await driver.spawn(agentConfig);

    // Send multiple messages to exceed the limit
    // Each send adds 1 user message + 1 assistant response = 2 messages
    // With maxHistoryMessages=5, we expect pruning after 3 sends (6 messages)
    for (let i = 0; i < 4; i++) {
      await driver.send("agent-prune", `Message ${i}`);
      // Wait for processing (simulation mode has 100ms delay)
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // After 4 sends: 8 messages total, but should be pruned to 5
    // We can verify by checking that checkpointing captures the right length
    const checkpoint = await driver.createCheckpoint("agent-prune", "test");
    expect(checkpoint).toBeDefined();

    // Verify the checkpoint was created (indicates history is working)
    const checkpoints = await driver.listCheckpoints("agent-prune");
    expect(checkpoints.length).toBe(1);

    // Get the full checkpoint to verify history length
    const fullCheckpoint = await driver.getCheckpoint(
      "agent-prune",
      checkpoint.id,
    );
    // Should be exactly maxHistoryMessages (5) due to pruning
    expect(fullCheckpoint.conversationHistory).toBeDefined();
    expect((fullCheckpoint.conversationHistory as unknown[]).length).toBe(5);
  });

  it("should preserve the first message when pruning", async () => {
    const config = createDriverOptions("sdk", {
      driverId: "test-claude-first-msg",
    });
    const driver = new ClaudeSDKDriver(config, {
      apiKey: "",
      maxHistoryMessages: 3,
    });

    const agentConfig: AgentConfig = {
      id: "agent-first-msg",
      provider: "claude",
      model: "claude-3-sonnet",
      workingDirectory: "/tmp",
    };
    await driver.spawn(agentConfig);

    // Send enough messages to trigger pruning multiple times
    for (let i = 0; i < 5; i++) {
      await driver.send("agent-first-msg", `Message ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Create checkpoint to inspect history
    const checkpoint = await driver.createCheckpoint("agent-first-msg", "test");
    const fullCheckpoint = await driver.getCheckpoint(
      "agent-first-msg",
      checkpoint.id,
    );

    const history = fullCheckpoint.conversationHistory as Array<{
      content: string;
      role: string;
    }>;
    expect(history.length).toBe(3);

    // First message should be the original "Message 0" (user message preserved)
    const firstMsg = history[0];
    expect(firstMsg).toBeDefined();
    if (!firstMsg) {
      throw new Error("Expected first history message to be present");
    }
    expect(firstMsg.content).toBe("Message 0");
    expect(firstMsg.role).toBe("user");
  });

  it("should not prune when history is under the limit", async () => {
    const config = createDriverOptions("sdk", {
      driverId: "test-claude-no-prune",
    });
    const driver = new ClaudeSDKDriver(config, {
      apiKey: "",
      maxHistoryMessages: 100, // Default, high limit
    });

    const agentConfig: AgentConfig = {
      id: "agent-no-prune",
      provider: "claude",
      model: "claude-3-sonnet",
      workingDirectory: "/tmp",
    };
    await driver.spawn(agentConfig);

    // Send just a few messages
    for (let i = 0; i < 3; i++) {
      await driver.send("agent-no-prune", `Message ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Create checkpoint to inspect history
    const checkpoint = await driver.createCheckpoint("agent-no-prune", "test");
    const fullCheckpoint = await driver.getCheckpoint(
      "agent-no-prune",
      checkpoint.id,
    );

    const history = fullCheckpoint.conversationHistory as unknown[];
    // 3 sends = 6 messages (3 user + 3 assistant), no pruning
    expect(history.length).toBe(6);
  });

  it("should not prune when history is exactly at the limit", async () => {
    const config = createDriverOptions("sdk", {
      driverId: "test-claude-at-limit",
    });
    const driver = new ClaudeSDKDriver(config, {
      apiKey: "",
      maxHistoryMessages: 6, // Exactly 3 sends = 6 messages
    });

    const agentConfig: AgentConfig = {
      id: "agent-at-limit",
      provider: "claude",
      model: "claude-3-sonnet",
      workingDirectory: "/tmp",
    };
    await driver.spawn(agentConfig);

    // Send exactly enough messages to reach the limit (3 sends = 6 messages)
    for (let i = 0; i < 3; i++) {
      await driver.send("agent-at-limit", `Message ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const checkpoint = await driver.createCheckpoint("agent-at-limit", "test");
    const fullCheckpoint = await driver.getCheckpoint(
      "agent-at-limit",
      checkpoint.id,
    );

    const history = fullCheckpoint.conversationHistory as unknown[];
    // Exactly at limit - no pruning should occur
    expect(history.length).toBe(6);
  });

  it("should isolate pruning between multiple sessions", async () => {
    const config = createDriverOptions("sdk", {
      driverId: "test-claude-multi-session",
    });
    const driver = new ClaudeSDKDriver(config, {
      apiKey: "",
      maxHistoryMessages: 4,
    });

    // Spawn two agents (separate sessions)
    const agentConfig1: AgentConfig = {
      id: "agent-session-1",
      provider: "claude",
      model: "claude-3-sonnet",
      workingDirectory: "/tmp",
    };
    const agentConfig2: AgentConfig = {
      id: "agent-session-2",
      provider: "claude",
      model: "claude-3-sonnet",
      workingDirectory: "/tmp",
    };
    await driver.spawn(agentConfig1);
    await driver.spawn(agentConfig2);

    // Send messages to session 1 to trigger pruning (3 sends = 6 messages > 4 limit)
    for (let i = 0; i < 3; i++) {
      await driver.send("agent-session-1", `Session1 Message ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Send only 1 message to session 2 (2 messages < 4 limit, no pruning)
    await driver.send("agent-session-2", "Session2 Message 0");
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Check session 1 - should be pruned to 4 messages
    const checkpoint1 = await driver.createCheckpoint(
      "agent-session-1",
      "test",
    );
    const fullCheckpoint1 = await driver.getCheckpoint(
      "agent-session-1",
      checkpoint1.id,
    );
    const history1 = fullCheckpoint1.conversationHistory as unknown[];
    expect(history1.length).toBe(4);

    // Check session 2 - should still have 2 messages (no pruning)
    const checkpoint2 = await driver.createCheckpoint(
      "agent-session-2",
      "test",
    );
    const fullCheckpoint2 = await driver.getCheckpoint(
      "agent-session-2",
      checkpoint2.id,
    );
    const history2 = fullCheckpoint2.conversationHistory as unknown[];
    expect(history2.length).toBe(2);
  });

  it("should handle agent with initial conversation history from providerOptions", async () => {
    const config = createDriverOptions("sdk", {
      driverId: "test-claude-initial-history",
    });
    const driver = new ClaudeSDKDriver(config, {
      apiKey: "",
      maxHistoryMessages: 5,
    });

    // Spawn with pre-existing conversation history
    const agentConfig: AgentConfig = {
      id: "agent-initial-history",
      provider: "claude",
      model: "claude-3-sonnet",
      workingDirectory: "/tmp",
      providerOptions: {
        conversationHistory: [
          { role: "user", content: "Initial message", timestamp: new Date() },
          {
            role: "assistant",
            content: "Initial response",
            timestamp: new Date(),
          },
        ],
      },
    };
    await driver.spawn(agentConfig);

    // Send more messages to trigger pruning (2 initial + 4 new = 6 > 5)
    for (let i = 0; i < 2; i++) {
      await driver.send("agent-initial-history", `New message ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const checkpoint = await driver.createCheckpoint(
      "agent-initial-history",
      "test",
    );
    const fullCheckpoint = await driver.getCheckpoint(
      "agent-initial-history",
      checkpoint.id,
    );
    const history = fullCheckpoint.conversationHistory as Array<{
      content: string;
    }>;

    // Should be pruned to 5 messages
    expect(history.length).toBe(5);
    // First message should be the initial "Initial message"
    const firstMsg = history[0];
    expect(firstMsg).toBeDefined();
    if (!firstMsg) {
      throw new Error("Expected first history message to be present");
    }
    expect(firstMsg.content).toBe("Initial message");
  });
});
