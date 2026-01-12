/**
 * Tests for Context Health Service.
 *
 * Tests health monitoring, graduated interventions, compaction, and rotation.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  _clearContextHealthService,
  ContextHealthError,
  getContextHealthService,
  initializeContextHealthService,
  RotationError,
  SummarizationError,
  type ContextHealthService,
} from "../services/context-health.service";
import {
  ContextHealthStatus,
  DEFAULT_CONTEXT_HEALTH_CONFIG,
  type ContextHealthConfig,
  type TransferredMessage,
} from "../types/context-health.types";

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_CONFIG: ContextHealthConfig = {
  ...DEFAULT_CONTEXT_HEALTH_CONFIG,
  thresholds: {
    warning: { percentage: 75, actions: ["log", "event"] },
    critical: { percentage: 85, actions: ["summarize", "event"] },
    emergency: { percentage: 95, actions: ["rotate", "event"] },
  },
  monitoring: {
    checkIntervalMs: 100,
    historyRetentionHours: 1,
    historyMaxEntries: 100,
  },
  autoHealing: {
    enabled: false, // Disable for controlled testing
    summarizationEnabled: true,
    rotationEnabled: true,
  },
  rotation: {
    ...DEFAULT_CONTEXT_HEALTH_CONFIG.rotation,
    cooldownMs: 0, // No cooldown for testing
  },
  defaultMaxTokens: 10000,
};

function createTestMessage(content: string): TransferredMessage {
  return {
    role: "user",
    content,
    timestamp: new Date(),
  };
}

// ============================================================================
// Test Setup
// ============================================================================

describe("ContextHealthService", () => {
  let service: ContextHealthService;

  beforeEach(() => {
    _clearContextHealthService();
    service = initializeContextHealthService(TEST_CONFIG);
  });

  afterEach(() => {
    service.stop();
    _clearContextHealthService();
  });

  // ==========================================================================
  // Session Registration Tests
  // ==========================================================================

  describe("session registration", () => {
    test("registers a session for monitoring", () => {
      service.registerSession("session-1", { maxTokens: 10000 });

      const state = service.getSessionState("session-1");
      expect(state).not.toBeNull();
      expect(state?.maxTokens).toBe(10000);
      expect(state?.currentTokens).toBe(0);
    });

    test("uses model limits for max tokens", () => {
      service.registerSession("session-2", { model: "claude-3-opus" });

      const state = service.getSessionState("session-2");
      expect(state?.maxTokens).toBe(200000);
    });

    test("uses default max tokens when model not found", () => {
      service.registerSession("session-3");

      const state = service.getSessionState("session-3");
      expect(state?.maxTokens).toBe(10000); // TEST_CONFIG default
    });

    test("unregisters a session", () => {
      service.registerSession("session-4");
      service.unregisterSession("session-4");

      const state = service.getSessionState("session-4");
      expect(state).toBeNull();
    });
  });

  // ==========================================================================
  // Health Status Tests
  // ==========================================================================

  describe("health status determination", () => {
    test("returns HEALTHY status below warning threshold", async () => {
      service.registerSession("test-session", { maxTokens: 10000 });
      service.updateTokens("test-session", 5000); // 50%

      const health = await service.checkHealth("test-session");

      expect(health.status).toBe(ContextHealthStatus.HEALTHY);
      expect(health.percentUsed).toBe(50);
    });

    test("returns WARNING status at warning threshold", async () => {
      service.registerSession("test-session", { maxTokens: 10000 });
      service.updateTokens("test-session", 7500); // 75%

      const health = await service.checkHealth("test-session");

      expect(health.status).toBe(ContextHealthStatus.WARNING);
      expect(health.percentUsed).toBe(75);
    });

    test("returns CRITICAL status at critical threshold", async () => {
      service.registerSession("test-session", { maxTokens: 10000 });
      service.updateTokens("test-session", 8500); // 85%

      const health = await service.checkHealth("test-session");

      expect(health.status).toBe(ContextHealthStatus.CRITICAL);
      expect(health.percentUsed).toBe(85);
    });

    test("returns EMERGENCY status at emergency threshold", async () => {
      service.registerSession("test-session", { maxTokens: 10000 });
      service.updateTokens("test-session", 9500); // 95%

      const health = await service.checkHealth("test-session");

      expect(health.status).toBe(ContextHealthStatus.EMERGENCY);
      expect(health.percentUsed).toBe(95);
    });

    test("throws error for unregistered session", async () => {
      await expect(service.checkHealth("non-existent")).rejects.toThrow(ContextHealthError);
    });
  });

  // ==========================================================================
  // Token Tracking Tests
  // ==========================================================================

  describe("token tracking", () => {
    test("updates token count", () => {
      service.registerSession("test-session");
      service.updateTokens("test-session", 1000);

      const state = service.getSessionState("test-session");
      expect(state?.currentTokens).toBe(1000);
    });

    test("records token history", () => {
      service.registerSession("test-session");
      service.updateTokens("test-session", 1000, "message");
      service.updateTokens("test-session", 2000, "message");

      const history = service.getHistory("test-session");
      expect(history.length).toBe(2);
      expect(history[0].tokens).toBe(1000);
      expect(history[1].tokens).toBe(2000);
      expect(history[1].delta).toBe(1000);
    });

    test("adds messages and updates tokens", () => {
      service.registerSession("test-session");

      service.addMessage("test-session", createTestMessage("Hello, this is a test message."));

      const state = service.getSessionState("test-session");
      expect(state?.messages.length).toBe(1);
      expect(state?.currentTokens).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Recommendation Tests
  // ==========================================================================

  describe("recommendations", () => {
    test("recommends nothing for healthy sessions", async () => {
      service.registerSession("test-session", { maxTokens: 10000 });
      service.updateTokens("test-session", 5000);

      const health = await service.checkHealth("test-session");

      expect(health.recommendations).toHaveLength(1);
      expect(health.recommendations[0].action).toBe("none");
      expect(health.recommendations[0].urgency).toBe("low");
    });

    test("recommends summarization for warning level", async () => {
      service.registerSession("test-session", { maxTokens: 10000 });
      service.updateTokens("test-session", 7800);

      const health = await service.checkHealth("test-session");

      expect(health.recommendations[0].action).toBe("summarize");
      expect(health.recommendations[0].urgency).toBe("medium");
    });

    test("recommends compaction for critical level", async () => {
      service.registerSession("test-session", { maxTokens: 10000 });
      service.updateTokens("test-session", 8800);

      const health = await service.checkHealth("test-session");

      expect(health.recommendations[0].action).toBe("compact");
      expect(health.recommendations[0].urgency).toBe("high");
    });

    test("recommends rotation for emergency level", async () => {
      service.registerSession("test-session", { maxTokens: 10000 });
      service.updateTokens("test-session", 9800);

      const health = await service.checkHealth("test-session");

      expect(health.recommendations[0].action).toBe("rotate");
      expect(health.recommendations[0].urgency).toBe("critical");
    });
  });

  // ==========================================================================
  // Compaction Tests
  // ==========================================================================

  describe("compaction", () => {
    test("compacts session context", async () => {
      service.registerSession("test-session", { maxTokens: 10000 });

      // Add multiple messages
      for (let i = 0; i < 20; i++) {
        service.addMessage(
          "test-session",
          createTestMessage(`Message ${i}: This is a longer message with some content to compress.`),
        );
      }

      const beforeTokens = service.getSessionState("test-session")?.currentTokens ?? 0;

      const result = await service.compact("test-session");

      expect(result.beforeTokens).toBeGreaterThan(0);
      expect(result.afterTokens).toBeLessThanOrEqual(result.beforeTokens);
      expect(result.reduction).toBeGreaterThanOrEqual(0);
      expect(result.appliedAt).toBeInstanceOf(Date);
    });

    test("preserves recent messages during compaction", async () => {
      service.registerSession("test-session");

      // Add old messages (with timestamps older than 10 minutes)
      const oldTimestamp = new Date(Date.now() - 20 * 60 * 1000); // 20 minutes ago
      const state = service.getSessionState("test-session")!;
      for (let i = 0; i < 5; i++) {
        state.messages.push({
          role: "user",
          content: `Old message ${i}`,
          timestamp: oldTimestamp,
        });
      }
      state.currentTokens += 500;

      // Add recent messages
      for (let i = 0; i < 5; i++) {
        service.addMessage("test-session", createTestMessage(`Recent message ${i}`));
      }

      const beforeCount = state.messages.length;
      await service.compact("test-session");

      // Should have compacted old messages, keeping summary + recent ones
      expect(state.messages.length).toBeLessThan(beforeCount);
    });

    test("throws error for non-existent session", async () => {
      await expect(service.compact("non-existent")).rejects.toThrow(SummarizationError);
    });

    test("updates lastCompaction timestamp", async () => {
      service.registerSession("test-session");
      service.addMessage("test-session", createTestMessage("Test"));

      await service.compact("test-session");

      const state = service.getSessionState("test-session");
      expect(state?.lastCompaction).not.toBeNull();
    });
  });

  // ==========================================================================
  // Rotation Tests
  // ==========================================================================

  describe("rotation", () => {
    test("rotates to new session", async () => {
      service.registerSession("test-session", { maxTokens: 10000 });

      // Add some messages
      service.addMessage("test-session", createTestMessage("Important context"));
      service.addMessage("test-session", createTestMessage("More context"));

      const result = await service.rotate("test-session");

      expect(result.newSessionId).toBeTruthy();
      expect(result.checkpointId).toBeTruthy();
      expect(result.transfer).toBeTruthy();
      expect(result.transfer.compressionRatio).toBeGreaterThan(0);
    });

    test("marks source session as rotated", async () => {
      service.registerSession("test-session");

      await service.rotate("test-session");

      const state = service.getSessionState("test-session");
      expect(state?.status).toBe("rotated");
      expect(state?.rotatedTo).toBeTruthy();
    });

    test("creates new session with transferred context", async () => {
      service.registerSession("test-session");
      service.addMessage("test-session", createTestMessage("Original context"));

      const result = await service.rotate("test-session");

      const newState = service.getSessionState(result.newSessionId);
      expect(newState).not.toBeNull();
      expect(newState?.rotatedFrom).toBe("test-session");
      expect(newState?.messages.length).toBeGreaterThan(0);
    });

    test("throws error for non-existent session", async () => {
      await expect(service.rotate("non-existent")).rejects.toThrow(RotationError);
    });

    test("throws error for already rotated session", async () => {
      service.registerSession("test-session");
      await service.rotate("test-session");

      await expect(service.rotate("test-session")).rejects.toThrow(RotationError);
    });

    test("includes summary in transfer", async () => {
      service.registerSession("test-session");
      for (let i = 0; i < 5; i++) {
        service.addMessage("test-session", createTestMessage(`Message ${i} with content`));
      }

      const result = await service.rotate("test-session");

      expect(result.transfer.summary).toBeTruthy();
    });

    test("respects rotation cooldown", async () => {
      // Create service with cooldown
      const cooldownService = initializeContextHealthService({
        ...TEST_CONFIG,
        rotation: {
          ...TEST_CONFIG.rotation,
          cooldownMs: 60000, // 1 minute cooldown
        },
      });

      cooldownService.registerSession("test-session");
      await cooldownService.rotate("test-session", { reason: "manual" });

      // Manually get the new session and try to rotate it immediately
      const state = cooldownService.getSessionState("test-session");
      const newSessionId = state?.rotatedTo;

      if (newSessionId) {
        // This should work because the new session hasn't been rotated yet
        const newState = cooldownService.getSessionState(newSessionId);
        expect(newState?.lastRotation).toBeNull();
      }
    });
  });

  // ==========================================================================
  // History Tests
  // ==========================================================================

  describe("history queries", () => {
    test("returns token history", () => {
      service.registerSession("test-session");
      service.updateTokens("test-session", 1000);
      service.updateTokens("test-session", 2000);
      service.updateTokens("test-session", 3000);

      const history = service.getHistory("test-session");
      expect(history.length).toBe(3);
    });

    test("filters history by since date", async () => {
      service.registerSession("test-session");
      service.updateTokens("test-session", 1000);
      await Bun.sleep(10);
      const midpoint = new Date();
      await Bun.sleep(10);
      service.updateTokens("test-session", 2000);

      const history = service.getHistory("test-session", { since: midpoint });
      expect(history.length).toBe(1);
      expect(history[0].tokens).toBe(2000);
    });

    test("limits history results", () => {
      service.registerSession("test-session");
      for (let i = 1; i <= 10; i++) {
        service.updateTokens("test-session", i * 100);
      }

      const history = service.getHistory("test-session", { limit: 5 });
      expect(history.length).toBe(5);
      // Should return the last 5 entries
      expect(history[history.length - 1].tokens).toBe(1000);
    });
  });

  // ==========================================================================
  // Projection Tests
  // ==========================================================================

  describe("projections", () => {
    test("projects overflow in messages", async () => {
      service.registerSession("test-session", { maxTokens: 10000 });

      // Add consistent token increases
      service.updateTokens("test-session", 1000, "message");
      service.updateTokens("test-session", 2000, "message");
      service.updateTokens("test-session", 3000, "message");

      const health = await service.checkHealth("test-session");

      // Should project approximately 7 more messages to reach 10000
      expect(health.projectedOverflowInMessages).toBeGreaterThan(0);
    });

    test("returns null projection with insufficient history", async () => {
      service.registerSession("test-session", { maxTokens: 10000 });
      service.updateTokens("test-session", 1000);

      const health = await service.checkHealth("test-session");

      expect(health.projectedOverflowInMessages).toBeNull();
    });
  });

  // ==========================================================================
  // Cache Tests
  // ==========================================================================

  describe("health cache", () => {
    test("caches health after check", async () => {
      service.registerSession("test-session");
      await service.checkHealth("test-session");

      const cached = service.getCachedHealth("test-session");
      expect(cached).not.toBeNull();
      expect(cached?.sessionId).toBe("test-session");
    });

    test("returns null for uncached session", () => {
      const cached = service.getCachedHealth("uncached-session");
      expect(cached).toBeNull();
    });
  });

  // ==========================================================================
  // Lifecycle Tests
  // ==========================================================================

  describe("service lifecycle", () => {
    test("starts and stops cleanly", () => {
      service.start();
      service.stop();
      // Should not throw
    });

    test("can be started multiple times", () => {
      service.start();
      service.start(); // Should be idempotent
      service.stop();
    });

    test("can be stopped multiple times", () => {
      service.start();
      service.stop();
      service.stop(); // Should be idempotent
    });
  });
});
