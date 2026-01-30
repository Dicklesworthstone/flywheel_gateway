/**
 * Tests for the NTM Driver.
 *
 * Focus areas:
 * - Zombie agent detection via poll error tracking
 * - Threshold-based failure transitions
 * - Poll interval cleanup on failure
 */

import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { NtmClient, NtmTailOutput } from "@flywheel/flywheel-clients";
import { NtmDriver, type NtmDriverOptions } from "../ntm/ntm-driver";
import { createDriverOptions } from "../base-driver";
import type { AgentConfig } from "../types";

// Mock NTM client factory
function createMockNtmClient(overrides: Partial<NtmClient> = {}): NtmClient {
  return {
    isAvailable: mock(() => Promise.resolve(true)),
    status: mock(() =>
      Promise.resolve({
        sessions: [],
        summary: { total_agents: 0, total_sessions: 0 },
      }),
    ),
    tail: mock(() =>
      Promise.resolve({
        success: true,
        timestamp: new Date().toISOString(),
        session: "test-session",
        captured_at: new Date().toISOString(),
        panes: {},
      } as NtmTailOutput),
    ),
    snapshot: mock(() =>
      Promise.resolve({
        ts: new Date().toISOString(),
        sessions: [],
      }),
    ),
    context: mock(() =>
      Promise.resolve({
        agents: [],
      }),
    ),
    health: mock(() =>
      Promise.resolve({
        agents: [],
      }),
    ),
    ...overrides,
  } as unknown as NtmClient;
}

// Create a testable NTM driver subclass that exposes internals
class TestableNtmDriver extends NtmDriver {
  private mockClient: NtmClient;

  constructor(
    mockClient: NtmClient,
    options: Partial<NtmDriverOptions> = {},
  ) {
    const config = createDriverOptions("ntm", options);
    super(config, {
      ...options,
      // Override the runner to prevent actual NTM commands
      runner: {
        run: mock(() => Promise.resolve({ stdout: "{}", stderr: "", exitCode: 0 })),
      },
    });
    this.mockClient = mockClient;
    // Replace the client with our mock
    // @ts-expect-error - accessing private field for testing
    this.client = mockClient;
  }

  // Expose sessions for testing
  getSessions() {
    // @ts-expect-error - accessing private field for testing
    return this.sessions;
  }

  // Expose pollOutput for testing
  async testPollOutput(agentId: string) {
    // @ts-expect-error - accessing private method for testing
    return this.pollOutput(agentId);
  }

  // Expose markAgentFailed for testing
  async testMarkAgentFailed(agentId: string, reason: string) {
    // @ts-expect-error - accessing private method for testing
    return this.markAgentFailed(agentId, reason);
  }

  // Get max consecutive poll errors setting
  getMaxConsecutivePollErrors() {
    // @ts-expect-error - accessing private field for testing
    return this.maxConsecutivePollErrors;
  }

  // Get max poll stale ms setting
  getMaxPollStaleMs() {
    // @ts-expect-error - accessing private field for testing
    return this.maxPollStaleMs;
  }

  // Set lastSuccessfulPoll for testing staleness detection
  setLastSuccessfulPoll(agentId: string, date: Date) {
    const session = this.getSessions().get(agentId);
    if (session) {
      session.lastSuccessfulPoll = date;
    }
  }
}

describe("NtmDriver", () => {
  const createTestConfig = (
    overrides: Partial<AgentConfig> = {},
  ): AgentConfig => ({
    id: `test-agent-${Date.now()}`,
    provider: "claude",
    model: "claude-opus-4",
    workingDirectory: "/tmp/test-workspace",
    ...overrides,
  });

  describe("configuration", () => {
    it("should use default poll error thresholds", () => {
      const mockClient = createMockNtmClient();
      const driver = new TestableNtmDriver(mockClient);

      expect(driver.getMaxConsecutivePollErrors()).toBe(5);
      expect(driver.getMaxPollStaleMs()).toBe(60000);
    });

    it("should accept custom poll error thresholds", () => {
      const mockClient = createMockNtmClient();
      const driver = new TestableNtmDriver(mockClient, {
        maxConsecutivePollErrors: 10,
        maxPollStaleMs: 120000,
      });

      expect(driver.getMaxConsecutivePollErrors()).toBe(10);
      expect(driver.getMaxPollStaleMs()).toBe(120000);
    });
  });

  describe("zombie detection - error counting", () => {
    it("should track consecutive poll errors", async () => {
      const mockClient = createMockNtmClient({
        tail: mock(() => Promise.reject(new Error("NTM unavailable"))),
      });
      const driver = new TestableNtmDriver(mockClient, {
        maxConsecutivePollErrors: 5,
      });

      // Spawn an agent
      const config = createTestConfig();
      await driver.spawn(config);

      // Clear the auto-started poll interval to control timing
      const sessions = driver.getSessions();
      const session = sessions.get(config.id);
      if (session?.pollInterval) {
        clearInterval(session.pollInterval);
        delete session.pollInterval;
      }

      // Simulate poll errors
      await driver.testPollOutput(config.id);
      expect(sessions.get(config.id)?.consecutiveErrors).toBe(1);

      await driver.testPollOutput(config.id);
      expect(sessions.get(config.id)?.consecutiveErrors).toBe(2);

      await driver.testPollOutput(config.id);
      expect(sessions.get(config.id)?.consecutiveErrors).toBe(3);
    });

    it("should reset error count on successful poll", async () => {
      let shouldFail = true;
      const mockClient = createMockNtmClient({
        tail: mock(() => {
          if (shouldFail) {
            return Promise.reject(new Error("NTM unavailable"));
          }
          return Promise.resolve({
            success: true,
            timestamp: new Date().toISOString(),
            session: "test-session",
            captured_at: new Date().toISOString(),
            panes: {},
          } as NtmTailOutput);
        }),
      });
      const driver = new TestableNtmDriver(mockClient, {
        maxConsecutivePollErrors: 5,
      });

      const config = createTestConfig();
      await driver.spawn(config);

      // Clear auto-started poll interval
      const sessions = driver.getSessions();
      const session = sessions.get(config.id);
      if (session?.pollInterval) {
        clearInterval(session.pollInterval);
        delete session.pollInterval;
      }

      // Accumulate some errors
      await driver.testPollOutput(config.id);
      await driver.testPollOutput(config.id);
      expect(sessions.get(config.id)?.consecutiveErrors).toBe(2);

      // Now succeed
      shouldFail = false;
      await driver.testPollOutput(config.id);
      expect(sessions.get(config.id)?.consecutiveErrors).toBe(0);
    });

    it("should mark agent as failed when error threshold exceeded", async () => {
      const mockClient = createMockNtmClient({
        tail: mock(() => Promise.reject(new Error("NTM unavailable"))),
      });
      const driver = new TestableNtmDriver(mockClient, {
        maxConsecutivePollErrors: 3, // Low threshold for testing
      });

      const config = createTestConfig();
      await driver.spawn(config);

      // Clear auto-started poll interval
      const sessions = driver.getSessions();
      const session = sessions.get(config.id);
      if (session?.pollInterval) {
        clearInterval(session.pollInterval);
        delete session.pollInterval;
      }

      // Verify agent exists
      expect(sessions.has(config.id)).toBe(true);

      // Trigger enough errors to exceed threshold
      await driver.testPollOutput(config.id); // error 1
      expect(sessions.has(config.id)).toBe(true);

      await driver.testPollOutput(config.id); // error 2
      expect(sessions.has(config.id)).toBe(true);

      await driver.testPollOutput(config.id); // error 3 - threshold exceeded
      // Session should be cleaned up after failure
      expect(sessions.has(config.id)).toBe(false);
    });
  });

  describe("zombie detection - event emission", () => {
    it("should emit error and terminated events when marking agent failed", async () => {
      const mockClient = createMockNtmClient();
      const driver = new TestableNtmDriver(mockClient);

      const config = createTestConfig();
      await driver.spawn(config);

      // Clear auto-started poll interval
      const sessions = driver.getSessions();
      const session = sessions.get(config.id);
      if (session?.pollInterval) {
        clearInterval(session.pollInterval);
        delete session.pollInterval;
      }

      // Collect events
      const events: Array<{ type: string }> = [];
      const subscription = driver.subscribe(config.id);

      // Start collecting in background
      const collector = (async () => {
        for await (const event of subscription) {
          events.push({ type: event.type });
          if (event.type === "terminated") break;
        }
      })();

      // Wait a tick for subscription to start
      await Bun.sleep(10);

      // Mark agent as failed
      await driver.testMarkAgentFailed(config.id, "Test failure reason");

      // Wait for events to be processed
      await collector;

      // Should have emitted error then terminated
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain("error");
      expect(eventTypes).toContain("terminated");
    });
  });

  describe("zombie detection - staleness detection", () => {
    it("should mark agent as failed when lastSuccessfulPoll exceeds maxPollStaleMs", async () => {
      const mockClient = createMockNtmClient({
        tail: mock(() => Promise.reject(new Error("NTM unavailable"))),
      });
      const driver = new TestableNtmDriver(mockClient, {
        maxConsecutivePollErrors: 10, // High threshold so we don't hit error count limit
        maxPollStaleMs: 5000, // 5 seconds for testing
      });

      const config = createTestConfig();
      await driver.spawn(config);

      // Clear auto-started poll interval
      const sessions = driver.getSessions();
      const session = sessions.get(config.id);
      if (session?.pollInterval) {
        clearInterval(session.pollInterval);
        delete session.pollInterval;
      }

      // Verify agent exists
      expect(sessions.has(config.id)).toBe(true);

      // Set lastSuccessfulPoll to 10 seconds ago (exceeds maxPollStaleMs of 5s)
      const tenSecondsAgo = new Date(Date.now() - 10000);
      driver.setLastSuccessfulPoll(config.id, tenSecondsAgo);

      // Trigger a poll error (won't hit consecutive error threshold but will check staleness)
      await driver.testPollOutput(config.id);

      // Session should be removed due to staleness
      expect(sessions.has(config.id)).toBe(false);
    });

    it("should not mark agent as stale when poll succeeds within threshold", async () => {
      let shouldFail = true;
      const mockClient = createMockNtmClient({
        tail: mock(() => {
          if (shouldFail) {
            return Promise.reject(new Error("NTM unavailable"));
          }
          return Promise.resolve({
            success: true,
            timestamp: new Date().toISOString(),
            session: "test-session",
            captured_at: new Date().toISOString(),
            panes: {},
          } as NtmTailOutput);
        }),
      });
      const driver = new TestableNtmDriver(mockClient, {
        maxConsecutivePollErrors: 10,
        maxPollStaleMs: 60000, // 60 seconds
      });

      const config = createTestConfig();
      await driver.spawn(config);

      // Clear auto-started poll interval
      const sessions = driver.getSessions();
      const session = sessions.get(config.id);
      if (session?.pollInterval) {
        clearInterval(session.pollInterval);
        delete session.pollInterval;
      }

      // Set lastSuccessfulPoll to 30 seconds ago (within 60s threshold)
      const thirtySecondsAgo = new Date(Date.now() - 30000);
      driver.setLastSuccessfulPoll(config.id, thirtySecondsAgo);

      // Trigger a poll error - should NOT mark as stale yet
      await driver.testPollOutput(config.id);
      expect(sessions.has(config.id)).toBe(true);
      expect(sessions.get(config.id)?.consecutiveErrors).toBe(1);

      // Now succeed - this should reset lastSuccessfulPoll
      shouldFail = false;
      await driver.testPollOutput(config.id);
      expect(sessions.has(config.id)).toBe(true);
      expect(sessions.get(config.id)?.consecutiveErrors).toBe(0);

      // lastSuccessfulPoll should be recent (within last second)
      const timeSinceSuccess =
        Date.now() - (sessions.get(config.id)?.lastSuccessfulPoll.getTime() ?? 0);
      expect(timeSinceSuccess).toBeLessThan(1000);
    });
  });

  describe("zombie detection - poll interval cleanup", () => {
    it("should clear poll interval when agent is marked as failed", async () => {
      const mockClient = createMockNtmClient({
        tail: mock(() => Promise.reject(new Error("NTM unavailable"))),
      });
      const driver = new TestableNtmDriver(mockClient, {
        maxConsecutivePollErrors: 2,
      });

      const config = createTestConfig();
      await driver.spawn(config);

      const sessions = driver.getSessions();
      const session = sessions.get(config.id);

      // Verify poll interval exists
      expect(session?.pollInterval).toBeDefined();

      // Trigger failure
      await driver.testPollOutput(config.id); // error 1
      await driver.testPollOutput(config.id); // error 2 - threshold exceeded

      // Session should be removed (poll interval cleared before deletion)
      expect(sessions.has(config.id)).toBe(false);
    });
  });
});
