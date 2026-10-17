/**
 * Unit tests for the Handoff Service.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  HandoffContext,
  HandoffReason,
  HandoffUrgency,
  ResourceManifest,
  TaskPhase,
} from "@flywheel/shared/types";
import {
  _clearAllHandoffs,
  acceptHandoff,
  cancelHandoff,
  completeHandoff,
  failHandoff,
  getHandoff,
  getHandoffStats,
  initiateHandoff,
  listBroadcastHandoffs,
  listHandoffsForSource,
  listHandoffsForTarget,
  rejectHandoff,
} from "../services/handoff.service";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockContext(
  overrides?: Partial<HandoffContext>,
): HandoffContext {
  return {
    taskDescription: "Test task description",
    currentPhase: "implementing" as TaskPhase,
    progressPercentage: 50,
    startedAt: new Date(),

    filesModified: [
      {
        path: "src/test.ts",
        originalHash: "abc123",
        currentHash: "def456",
        changeDescription: "Added test function",
      },
    ],
    filesCreated: ["src/new-file.ts"],
    filesDeleted: [],
    uncommittedChanges: [
      {
        path: "src/test.ts",
        diff: "+const test = () => {}",
        reason: "Adding test function",
      },
    ],

    decisionsMade: [
      {
        timestamp: new Date(),
        decision: "Use TypeScript",
        reasoning: "Type safety",
        alternatives: ["JavaScript"],
        outcome: "Better DX",
      },
    ],

    conversationSummary: "Working on implementing tests",
    keyPoints: ["Unit tests needed", "Integration tests important"],
    userRequirements: ["Full test coverage"],
    constraints: ["Must use bun:test"],

    workingMemory: { currentFile: "test.ts" },
    hypotheses: [
      {
        hypothesis: "Tests will pass",
        confidence: 0.8,
        evidence: ["All assertions correct"],
      },
    ],
    todoItems: [
      {
        task: "Write more tests",
        priority: 1,
        status: "pending",
      },
    ],

    environmentSnapshot: {
      workingDirectory: "/test",
      gitBranch: "main",
      gitCommit: "abc123",
      uncommittedFiles: ["src/test.ts"],
      envVars: { NODE_ENV: "test" },
    },
    ...overrides,
  };
}

function createMockResourceManifest(): ResourceManifest {
  return {
    fileReservations: [],
    checkpoints: [],
    pendingMessages: [],
    activeSubscriptions: [],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("Handoff Service", () => {
  beforeEach(() => {
    _clearAllHandoffs();
  });

  afterEach(() => {
    _clearAllHandoffs();
  });

  describe("initiateHandoff", () => {
    test("should create a handoff with valid parameters", async () => {
      const result = await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-2",
        projectId: "project-1",
        beadId: "bead-123",
        reason: "session_limit" as HandoffReason,
        urgency: "normal" as HandoffUrgency,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(result.success).toBe(true);
      expect(result.handoffId).toBeDefined();
      expect(result.phase).toBe("pending");
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    test("should create a broadcast handoff with null targetAgentId", async () => {
      const result = await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: null,
        projectId: "project-1",
        reason: "load_balancing" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(result.success).toBe(true);
      expect(result.handoffId).toBeDefined();

      const broadcasts = listBroadcastHandoffs("project-1");
      expect(broadcasts.length).toBe(1);
      expect(broadcasts[0]?.request.targetAgentId).toBeNull();
    });

    test("should fail when source agent has too many pending handoffs", async () => {
      // Create 5 handoffs (max allowed)
      for (let i = 0; i < 5; i++) {
        await initiateHandoff({
          sourceAgentId: "busy-agent",
          targetAgentId: `target-${i}`,
          projectId: "project-1",
          reason: "session_limit" as HandoffReason,
          context: createMockContext(),
          resourceManifest: createMockResourceManifest(),
        });
      }

      // 6th should fail
      const result = await initiateHandoff({
        sourceAgentId: "busy-agent",
        targetAgentId: "target-6",
        projectId: "project-1",
        reason: "session_limit" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Maximum pending handoffs");
    });

    test("should use default preferences when not provided", async () => {
      const result = await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-2",
        projectId: "project-1",
        reason: "session_limit" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(result.handoffId).toBeDefined();
      const handoff = getHandoff(result.handoffId as string);
      expect(handoff).not.toBeNull();
      expect(handoff?.request.preferences.requireAcknowledgment).toBe(true);
      expect(handoff?.request.preferences.fallbackBehavior).toBe("escalate");
    });

    test("should use provided urgency", async () => {
      const result = await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-2",
        projectId: "project-1",
        reason: "session_limit" as HandoffReason,
        urgency: "critical" as HandoffUrgency,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(result.handoffId).toBeDefined();
      const handoff = getHandoff(result.handoffId as string);
      expect(handoff?.request.urgency).toBe("critical");
    });
  });

  describe("acceptHandoff", () => {
    test("should accept a pending handoff", async () => {
      const initResult = await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-2",
        projectId: "project-1",
        reason: "session_limit" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(initResult.handoffId).toBeDefined();
      const handoffId = initResult.handoffId as string;

      const acceptResult = await acceptHandoff({
        handoffId,
        receivingAgentId: "agent-2",
        receiverNotes: "Ready to take over",
      });

      expect(acceptResult.success).toBe(true);
      expect(acceptResult.phase).toBe("transfer");

      const handoff = getHandoff(handoffId);
      expect(handoff?.acknowledgment).toBeDefined();
      expect(handoff?.acknowledgment?.status).toBe("accepted");
      expect(handoff?.acknowledgment?.receiverNotes).toBe("Ready to take over");
    });

    test("should fail when handoff is not in pending phase", async () => {
      const initResult = await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-2",
        projectId: "project-1",
        reason: "session_limit" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(initResult.handoffId).toBeDefined();
      const handoffId = initResult.handoffId as string;

      // Accept once
      await acceptHandoff({
        handoffId,
        receivingAgentId: "agent-2",
      });

      // Try to accept again
      const secondAccept = await acceptHandoff({
        handoffId,
        receivingAgentId: "agent-3",
      });

      expect(secondAccept.success).toBe(false);
      expect(secondAccept.error).toContain("Cannot accept handoff in");
    });

    test("should fail when wrong agent tries to accept targeted handoff", async () => {
      const initResult = await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-2", // Specific target
        projectId: "project-1",
        reason: "session_limit" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(initResult.handoffId).toBeDefined();
      const acceptResult = await acceptHandoff({
        handoffId: initResult.handoffId as string,
        receivingAgentId: "agent-3", // Wrong agent
      });

      expect(acceptResult.success).toBe(false);
      expect(acceptResult.error).toContain("not the intended target");
    });

    test("should allow any agent to accept broadcast handoff", async () => {
      const initResult = await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: null, // Broadcast
        projectId: "project-1",
        reason: "load_balancing" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(initResult.handoffId).toBeDefined();
      const acceptResult = await acceptHandoff({
        handoffId: initResult.handoffId as string,
        receivingAgentId: "any-agent",
      });

      expect(acceptResult.success).toBe(true);
    });

    test("should fail for non-existent handoff", async () => {
      const result = await acceptHandoff({
        handoffId: "non-existent",
        receivingAgentId: "agent-2",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("rejectHandoff", () => {
    test("should reject a pending handoff", async () => {
      const initResult = await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-2",
        projectId: "project-1",
        reason: "session_limit" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(initResult.handoffId).toBeDefined();
      const handoffId = initResult.handoffId as string;

      const rejectResult = await rejectHandoff({
        handoffId,
        receivingAgentId: "agent-2",
        reason: "Busy with other work",
        suggestedAlternative: "agent-3",
      });

      expect(rejectResult.success).toBe(true);
      expect(rejectResult.phase).toBe("rejected");

      const handoff = getHandoff(handoffId);
      expect(handoff?.acknowledgment?.status).toBe("rejected");
      expect(handoff?.acknowledgment?.rejectionReason).toBe(
        "Busy with other work",
      );
      expect(handoff?.acknowledgment?.suggestedAlternative).toBe("agent-3");
    });

    test("should fail when not in pending phase", async () => {
      const initResult = await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-2",
        projectId: "project-1",
        reason: "session_limit" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(initResult.handoffId).toBeDefined();
      const handoffId = initResult.handoffId as string;

      // Accept first
      await acceptHandoff({
        handoffId,
        receivingAgentId: "agent-2",
      });

      // Then try to reject
      const rejectResult = await rejectHandoff({
        handoffId,
        receivingAgentId: "agent-2",
        reason: "Changed my mind",
      });

      expect(rejectResult.success).toBe(false);
      expect(rejectResult.error).toContain("Cannot reject handoff in");
    });
  });

  describe("cancelHandoff", () => {
    test("should cancel a handoff by source agent", async () => {
      const initResult = await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-2",
        projectId: "project-1",
        reason: "session_limit" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(initResult.handoffId).toBeDefined();
      const handoffId = initResult.handoffId as string;

      const cancelResult = await cancelHandoff({
        handoffId,
        agentId: "agent-1",
        reason: "No longer needed",
      });

      expect(cancelResult.success).toBe(true);
      expect(cancelResult.phase).toBe("cancelled");

      const handoff = getHandoff(handoffId);
      expect(handoff?.completedAt).toBeDefined();
    });

    test("should fail when non-source agent tries to cancel", async () => {
      const initResult = await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-2",
        projectId: "project-1",
        reason: "session_limit" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(initResult.handoffId).toBeDefined();
      const cancelResult = await cancelHandoff({
        handoffId: initResult.handoffId as string,
        agentId: "agent-2", // Not the source
        reason: "Want to cancel",
      });

      expect(cancelResult.success).toBe(false);
      expect(cancelResult.error).toContain("Only source agent can cancel");
    });

    test("should fail when handoff is already completed", async () => {
      const initResult = await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-2",
        projectId: "project-1",
        reason: "session_limit" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(initResult.handoffId).toBeDefined();
      const handoffId = initResult.handoffId as string;

      // Accept and complete
      await acceptHandoff({
        handoffId,
        receivingAgentId: "agent-2",
      });
      await completeHandoff({
        handoffId,
        transferSummary: {
          filesModified: 1,
          reservationsTransferred: 0,
          checkpointsTransferred: 0,
          messagesForwarded: 0,
        },
      });

      // Try to cancel
      const cancelResult = await cancelHandoff({
        handoffId,
        agentId: "agent-1",
        reason: "Too late",
      });

      expect(cancelResult.success).toBe(false);
      expect(cancelResult.error).toContain("Cannot cancel handoff in");
    });
  });

  describe("completeHandoff", () => {
    test("should complete a handoff in transfer phase", async () => {
      const initResult = await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-2",
        projectId: "project-1",
        reason: "session_limit" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(initResult.handoffId).toBeDefined();
      const handoffId = initResult.handoffId as string;

      await acceptHandoff({
        handoffId,
        receivingAgentId: "agent-2",
      });

      const completeResult = await completeHandoff({
        handoffId,
        transferSummary: {
          filesModified: 5,
          reservationsTransferred: 2,
          checkpointsTransferred: 1,
          messagesForwarded: 3,
        },
      });

      expect(completeResult.success).toBe(true);
      expect(completeResult.newOwnerAgentId).toBe("agent-2");
      expect(completeResult.transferSummary.filesModified).toBe(5);

      const handoff = getHandoff(handoffId);
      expect(handoff?.phase).toBe("complete");
      expect(handoff?.completedAt).toBeDefined();
    });

    test("should fail when not in transfer phase", async () => {
      const initResult = await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-2",
        projectId: "project-1",
        reason: "session_limit" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(initResult.handoffId).toBeDefined();

      // Try to complete without accepting
      const completeResult = await completeHandoff({
        handoffId: initResult.handoffId as string,
        transferSummary: {
          filesModified: 0,
          reservationsTransferred: 0,
          checkpointsTransferred: 0,
          messagesForwarded: 0,
        },
      });

      expect(completeResult.success).toBe(false);
      expect(completeResult.error).toContain("Cannot complete handoff in");
    });
  });

  describe("failHandoff", () => {
    test("should mark handoff as failed", async () => {
      const initResult = await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-2",
        projectId: "project-1",
        reason: "session_limit" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(initResult.handoffId).toBeDefined();
      const handoffId = initResult.handoffId as string;

      await acceptHandoff({
        handoffId,
        receivingAgentId: "agent-2",
      });

      const failResult = await failHandoff({
        handoffId,
        errorCode: "TRANSFER_FAILED",
        errorMessage: "Network error during transfer",
        recoverable: true,
      });

      expect(failResult.success).toBe(true);
      expect(failResult.phase).toBe("failed");

      const handoff = getHandoff(handoffId);
      expect(handoff?.error).toBeDefined();
      expect(handoff?.error?.code).toBe("TRANSFER_FAILED");
      expect(handoff?.error?.recoverable).toBe(true);
    });
  });

  describe("listing handoffs", () => {
    test("should list handoffs for source agent", async () => {
      await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-2",
        projectId: "project-1",
        reason: "session_limit" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-3",
        projectId: "project-1",
        reason: "load_balancing" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      const handoffs = listHandoffsForSource("agent-1");
      expect(handoffs.length).toBe(2);
    });

    test("should list handoffs for target agent", async () => {
      await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-2",
        projectId: "project-1",
        reason: "session_limit" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      await initiateHandoff({
        sourceAgentId: "agent-3",
        targetAgentId: "agent-2",
        projectId: "project-1",
        reason: "load_balancing" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      const handoffs = listHandoffsForTarget("agent-2");
      expect(handoffs.length).toBe(2);
    });

    test("should filter handoffs by phase", async () => {
      const initResult = await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-2",
        projectId: "project-1",
        reason: "session_limit" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-3",
        projectId: "project-1",
        reason: "load_balancing" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(initResult.handoffId).toBeDefined();

      // Accept one to change its phase
      await acceptHandoff({
        handoffId: initResult.handoffId as string,
        receivingAgentId: "agent-2",
      });

      const pendingHandoffs = listHandoffsForSource("agent-1", {
        phase: "pending",
      });
      expect(pendingHandoffs.length).toBe(1);

      const transferHandoffs = listHandoffsForSource("agent-1", {
        phase: "transfer",
      });
      expect(transferHandoffs.length).toBe(1);
    });

    test("should respect limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await initiateHandoff({
          sourceAgentId: "agent-1",
          targetAgentId: `agent-${i + 2}`,
          projectId: "project-1",
          reason: "session_limit" as HandoffReason,
          context: createMockContext(),
          resourceManifest: createMockResourceManifest(),
        });
      }

      const handoffs = listHandoffsForSource("agent-1", { limit: 3 });
      expect(handoffs.length).toBe(3);
    });
  });

  describe("getHandoffStats", () => {
    test("should track statistics correctly", async () => {
      // Create and complete one handoff
      const initResult1 = await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-2",
        projectId: "project-1",
        reason: "session_limit" as HandoffReason,
        urgency: "high" as HandoffUrgency,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(initResult1.handoffId).toBeDefined();
      const handoffId1 = initResult1.handoffId as string;

      await acceptHandoff({
        handoffId: handoffId1,
        receivingAgentId: "agent-2",
      });

      await completeHandoff({
        handoffId: handoffId1,
        transferSummary: {
          filesModified: 1,
          reservationsTransferred: 0,
          checkpointsTransferred: 0,
          messagesForwarded: 0,
        },
      });

      // Create and fail one handoff
      const initResult2 = await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-3",
        projectId: "project-1",
        reason: "load_balancing" as HandoffReason,
        urgency: "normal" as HandoffUrgency,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(initResult2.handoffId).toBeDefined();
      const handoffId2 = initResult2.handoffId as string;

      await acceptHandoff({
        handoffId: handoffId2,
        receivingAgentId: "agent-3",
      });

      await failHandoff({
        handoffId: handoffId2,
        errorCode: "TEST_ERROR",
        errorMessage: "Test failure",
        recoverable: false,
      });

      const stats = getHandoffStats();
      expect(stats.totalHandoffs).toBe(2);
      expect(stats.completedHandoffs).toBe(1);
      expect(stats.failedHandoffs).toBe(1);
      expect(stats.byReason.session_limit).toBe(1);
      expect(stats.byReason.load_balancing).toBe(1);
      expect(stats.byUrgency.high).toBe(1);
      expect(stats.byUrgency.normal).toBe(1);
    });
  });

  describe("audit trail", () => {
    test("should record audit entries for all state changes", async () => {
      const initResult = await initiateHandoff({
        sourceAgentId: "agent-1",
        targetAgentId: "agent-2",
        projectId: "project-1",
        reason: "session_limit" as HandoffReason,
        context: createMockContext(),
        resourceManifest: createMockResourceManifest(),
      });

      expect(initResult.handoffId).toBeDefined();
      const handoffId = initResult.handoffId as string;

      await acceptHandoff({
        handoffId,
        receivingAgentId: "agent-2",
      });

      await completeHandoff({
        handoffId,
        transferSummary: {
          filesModified: 1,
          reservationsTransferred: 0,
          checkpointsTransferred: 0,
          messagesForwarded: 0,
        },
      });

      const handoff = getHandoff(handoffId);
      expect(handoff?.auditTrail.length).toBeGreaterThanOrEqual(4);

      const events = handoff?.auditTrail.map((e) => e.event);
      expect(events).toContain("handoff_initiated");
      expect(events).toContain("phase_transition");
      expect(events).toContain("handoff_accepted");
      expect(events).toContain("handoff_completed");
    });
  });
});
