/**
 * Tests for Claude SDK Driver.
 */

import { describe, expect, it } from "bun:test";
import { createDriverOptions } from "../base-driver";
import { ClaudeSDKDriver } from "../sdk/claude-driver";
import type { AgentConfig } from "../types";

describe("ClaudeSDKDriver", () => {
  it("should accumulate token usage correctly", async () => {
    const config = createDriverOptions("sdk", { driverId: "test-claude" });
    const driver = new ClaudeSDKDriver(config, { apiKey: "test-key" });

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
});
