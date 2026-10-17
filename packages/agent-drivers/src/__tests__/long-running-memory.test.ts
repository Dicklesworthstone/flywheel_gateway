/**
 * Integration tests for long-running agent memory management.
 *
 * Validates that conversation history pruning prevents memory growth
 * in extended agent sessions. Tests for bd-116r.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createDriverOptions } from "../base-driver";
import { ClaudeSDKDriver } from "../sdk/claude-driver";
import type { AgentConfig } from "../types";

/**
 * Get current heap memory usage in bytes.
 */
function getHeapUsed(): number {
  if (typeof process !== "undefined" && process.memoryUsage) {
    return process.memoryUsage().heapUsed;
  }
  return 0;
}

/**
 * Force garbage collection if available (requires --expose-gc flag).
 */
function tryGC(): void {
  if (typeof global !== "undefined" && typeof global.gc === "function") {
    global.gc();
  }
}

describe("Long-running agent memory", () => {
  let driver: ClaudeSDKDriver;
  const HISTORY_LIMIT = 50;
  const MESSAGE_COUNT = 200;
  const AGENT_ID = "long-running-agent";

  beforeEach(async () => {
    const config = createDriverOptions("sdk", {
      driverId: "test-long-running",
    });
    driver = new ClaudeSDKDriver(config, {
      apiKey: "",
      maxHistoryMessages: HISTORY_LIMIT,
    });

    const agentConfig: AgentConfig = {
      id: AGENT_ID,
      provider: "claude",
      model: "claude-3-sonnet",
      workingDirectory: "/tmp",
    };
    await driver.spawn(agentConfig);
  });

  afterEach(async () => {
    try {
      await driver.terminate(AGENT_ID);
    } catch {
      // Ignore cleanup errors
    }
  });

  it(`should maintain history at or below ${HISTORY_LIMIT} messages after ${MESSAGE_COUNT} sends`, async () => {
    // Send 200 messages
    for (let i = 0; i < MESSAGE_COUNT; i++) {
      await driver.send(AGENT_ID, `Test message ${i}`);
      // Wait for processing (simulation has 100ms delay)
      await new Promise((resolve) => setTimeout(resolve, 110));
    }

    // Create checkpoint to inspect final history
    const checkpoint = await driver.createCheckpoint(AGENT_ID, "final");
    const fullCheckpoint = await driver.getCheckpoint(AGENT_ID, checkpoint.id);
    const history = fullCheckpoint.conversationHistory as unknown[];

    // History should be at or below the limit
    expect(history.length).toBeLessThanOrEqual(HISTORY_LIMIT);

    // Should be exactly at the limit (after pruning from 400 messages to 50)
    expect(history.length).toBe(HISTORY_LIMIT);
  }, 60000); // 60 second timeout for long test

  it("should preserve the first message throughout all pruning cycles", async () => {
    // Send 200 messages
    for (let i = 0; i < MESSAGE_COUNT; i++) {
      await driver.send(AGENT_ID, `Message ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 110));
    }

    // Check history
    const checkpoint = await driver.createCheckpoint(AGENT_ID, "preserve-test");
    const fullCheckpoint = await driver.getCheckpoint(AGENT_ID, checkpoint.id);
    const history = fullCheckpoint.conversationHistory as Array<{
      content: string;
      role: string;
    }>;

    // First message should still be "Message 0"
    const firstMsg = history[0];
    expect(firstMsg).toBeDefined();
    expect(firstMsg!.content).toBe("Message 0");
    expect(firstMsg!.role).toBe("user");
  }, 60000);

  it("should have bounded memory growth after warmup period", async () => {
    tryGC();
    const initialMemory = getHeapUsed();

    // Warmup: send messages until history is at limit
    const warmupMessages = Math.ceil(HISTORY_LIMIT / 2) + 5; // Ensure we hit the limit
    for (let i = 0; i < warmupMessages; i++) {
      await driver.send(AGENT_ID, `Warmup message ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 110));
    }

    tryGC();
    const memoryAfterWarmup = getHeapUsed();

    // Send 100 more messages (beyond the limit, will trigger pruning)
    for (let i = 0; i < 100; i++) {
      await driver.send(AGENT_ID, `Post-warmup message ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 110));
    }

    tryGC();
    const memoryAfterExtended = getHeapUsed();

    // Memory growth from warmup to extended should be minimal (< 10MB)
    // This accounts for the fact that we're not actually storing more messages
    const memoryGrowth = memoryAfterExtended - memoryAfterWarmup;
    const MAX_GROWTH_BYTES = 10 * 1024 * 1024; // 10MB

    // Log for debugging
    console.log({
      initialMemory: `${(initialMemory / 1024 / 1024).toFixed(2)}MB`,
      memoryAfterWarmup: `${(memoryAfterWarmup / 1024 / 1024).toFixed(2)}MB`,
      memoryAfterExtended: `${(memoryAfterExtended / 1024 / 1024).toFixed(2)}MB`,
      memoryGrowth: `${(memoryGrowth / 1024 / 1024).toFixed(2)}MB`,
      maxAllowedGrowth: `${(MAX_GROWTH_BYTES / 1024 / 1024).toFixed(2)}MB`,
    });

    // Verify memory is bounded
    expect(memoryGrowth).toBeLessThan(MAX_GROWTH_BYTES);

    // Also verify history is still bounded
    const checkpoint = await driver.createCheckpoint(AGENT_ID, "memory-test");
    const fullCheckpoint = await driver.getCheckpoint(AGENT_ID, checkpoint.id);
    const history = fullCheckpoint.conversationHistory as unknown[];
    expect(history.length).toBeLessThanOrEqual(HISTORY_LIMIT);
  }, 90000); // 90 second timeout

  it("should handle attempted rapid message sending without memory leak", async () => {
    // Try to send messages rapidly - driver will reject concurrent sends
    // This tests that failed sends don't cause memory issues
    const rapidCount = 50;
    let successCount = 0;
    let busyCount = 0;

    for (let i = 0; i < rapidCount; i++) {
      try {
        await driver.send(AGENT_ID, `Rapid message ${i}`);
        successCount++;
        // Small delay to allow processing to begin
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (err) {
        // Expected: agent is busy
        if (err instanceof Error && err.message.includes("busy")) {
          busyCount++;
        } else {
          throw err;
        }
      }
    }

    // Wait for any pending processing
    await new Promise((resolve) => setTimeout(resolve, 3000));

    console.log({
      rapidCount,
      successCount,
      busyCount,
      message: "Driver correctly rejects concurrent sends",
    });

    // Some messages should have succeeded
    expect(successCount).toBeGreaterThan(0);

    // History should still be bounded
    const checkpoint = await driver.createCheckpoint(AGENT_ID, "rapid-test");
    const fullCheckpoint = await driver.getCheckpoint(AGENT_ID, checkpoint.id);
    const history = fullCheckpoint.conversationHistory as unknown[];

    // Should be at or below limit
    expect(history.length).toBeLessThanOrEqual(HISTORY_LIMIT);
  }, 30000);

  it("should correctly count messages during pruning", async () => {
    const checkpoints: { messageIndex: number; historyLength: number }[] = [];

    // Send messages and record history length at intervals
    for (let i = 0; i < 100; i++) {
      await driver.send(AGENT_ID, `Counting message ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 110));

      // Check every 10 messages
      if ((i + 1) % 10 === 0) {
        const cp = await driver.createCheckpoint(
          AGENT_ID,
          `count-check-${i + 1}`,
        );
        const fullCp = await driver.getCheckpoint(AGENT_ID, cp.id);
        const historyLen = (fullCp.conversationHistory as unknown[]).length;
        checkpoints.push({ messageIndex: i + 1, historyLength: historyLen });
      }
    }

    // Log checkpoints for debugging
    console.log("History length checkpoints:", checkpoints);

    // All checkpoint history lengths should be at or below limit
    for (const cp of checkpoints) {
      expect(cp.historyLength).toBeLessThanOrEqual(HISTORY_LIMIT);
    }

    // After warmup (enough messages to fill history), length should stabilize
    const postWarmupCheckpoints = checkpoints.filter(
      (cp) => cp.messageIndex > HISTORY_LIMIT,
    );
    for (const cp of postWarmupCheckpoints) {
      // After warmup, each send adds 2 messages (user + assistant)
      // Then prunes back to limit, so it should be at the limit
      expect(cp.historyLength).toBe(HISTORY_LIMIT);
    }
  }, 60000);
});
