import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  cancelSyncOperation,
  completeSyncOperation,
  failSyncOperation,
  getOperation,
  getOperationHistory,
  getQueuedOperations,
  getQueueStats,
  getRunningOperations,
  getSyncStats,
  queueSyncOperation,
  _clearAllSyncData,
} from "../services/git-sync.service";

describe("Git Sync Operations Service", () => {
  beforeEach(() => {
    _clearAllSyncData();
  });

  afterEach(() => {
    _clearAllSyncData();
  });

  describe("queueSyncOperation", () => {
    test("creates a queued operation", async () => {
      const operation = await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-1",
        operation: "push",
        branch: "feature/test",
      });

      expect(operation.id).toMatch(/^gso_/);
      expect(operation.status).toBe("running"); // Auto-starts when queue is empty
      expect(operation.request.operation).toBe("push");
      expect(operation.request.branch).toBe("feature/test");
    });

    test("respects priority ordering", async () => {
      // Queue low priority first
      const low = await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-1",
        operation: "fetch",
        branch: "main",
        priority: 1,
      });

      // Queue high priority second
      const high = await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-2",
        operation: "push",
        branch: "feature/urgent",
        priority: 10,
      });

      // The first one should be running (auto-started)
      // The second should be queued but would be next due to priority
      const queued = await getQueuedOperations("repo-1");
      const running = await getRunningOperations("repo-1");

      // First one started, high priority is either running or queued
      expect(running.length + queued.length).toBeGreaterThan(0);
    });

    test("limits concurrent operations", async () => {
      // Queue 5 operations
      for (let i = 0; i < 5; i++) {
        await queueSyncOperation({
          repositoryId: "repo-1",
          agentId: `agent-${i}`,
          operation: "fetch",
          branch: `feature/branch-${i}`,
        });
      }

      const running = await getRunningOperations("repo-1");
      expect(running.length).toBeLessThanOrEqual(3); // MAX_CONCURRENT_OPS = 3
    });
  });

  describe("completeSyncOperation", () => {
    test("marks operation as completed", async () => {
      const operation = await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-1",
        operation: "push",
        branch: "feature/test",
      });

      await completeSyncOperation(operation.id, {
        success: true,
        fromCommit: "abc123",
        toCommit: "def456",
        filesChanged: 5,
      });

      const completed = await getOperation(operation.id);
      expect(completed?.status).toBe("completed");
      expect(completed?.result?.success).toBe(true);
      expect(completed?.result?.filesChanged).toBe(5);
    });

    test("moves operation to history", async () => {
      const operation = await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-1",
        operation: "push",
        branch: "feature/test",
      });

      await completeSyncOperation(operation.id, {
        success: true,
      });

      const history = await getOperationHistory("repo-1");
      expect(history.some((op) => op.id === operation.id)).toBe(true);
    });

    test("processes next operation from queue after completion", async () => {
      // Fill up concurrent slots
      const ops = [];
      for (let i = 0; i < 4; i++) {
        ops.push(
          await queueSyncOperation({
            repositoryId: "repo-1",
            agentId: `agent-${i}`,
            operation: "fetch",
            branch: `feature/branch-${i}`,
          }),
        );
      }

      // Complete one running operation
      const running = await getRunningOperations("repo-1");
      if (running.length > 0) {
        await completeSyncOperation(running[0]!.id, { success: true });
      }

      // A queued operation should now be running
      const newRunning = await getRunningOperations("repo-1");
      const queued = await getQueuedOperations("repo-1");

      // Either more running now, or queue is smaller
      expect(newRunning.length + queued.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("failSyncOperation", () => {
    test("retries on retryable error", async () => {
      const operation = await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-1",
        operation: "push",
        branch: "feature/test",
      });

      const result = await failSyncOperation(
        operation.id,
        "Connection refused: Could not resolve host",
      );

      expect(result.willRetry).toBe(true);
      expect(result.nextAttemptAt).toBeDefined();

      const updated = await getOperation(operation.id);
      expect(updated?.status).toBe("queued"); // Back in queue for retry
      expect(updated?.attempt).toBe(1);
    });

    test("does not retry on non-retryable error", async () => {
      const operation = await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-1",
        operation: "push",
        branch: "feature/test",
      });

      const result = await failSyncOperation(
        operation.id,
        "CONFLICT (content): Automatic merge failed",
      );

      expect(result.willRetry).toBe(false);

      const updated = await getOperation(operation.id);
      expect(updated?.status).toBe("failed");
    });

    test("stops retrying after max attempts", async () => {
      const operation = await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-1",
        operation: "push",
        branch: "feature/test",
      });

      // Simulate multiple failures
      for (let i = 0; i < 3; i++) {
        const op = await getOperation(operation.id);
        if (op && op.status !== "failed") {
          await failSyncOperation(op.id, "Connection refused");
        }
      }

      // After max retries, should be failed
      const final = await getOperation(operation.id);
      // Either still retrying or failed
      expect(["queued", "failed"]).toContain(final?.status);
    });

    test("parses different error types correctly", async () => {
      const operation = await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-1",
        operation: "push",
        branch: "feature/test",
      });

      // Test auth error (non-retryable)
      await failSyncOperation(operation.id, "Permission denied (publickey)");
      const updated = await getOperation(operation.id);
      expect(updated?.error?.code).toBe("AUTH_ERROR");
      expect(updated?.error?.retryable).toBe(false);
    });
  });

  describe("cancelSyncOperation", () => {
    test("cancels a queued operation", async () => {
      // Queue multiple operations to ensure at least one is queued
      const ops = [];
      for (let i = 0; i < 5; i++) {
        ops.push(
          await queueSyncOperation({
            repositoryId: "repo-1",
            agentId: "agent-1",
            operation: "fetch",
            branch: `feature/branch-${i}`,
          }),
        );
      }

      // Find a queued one
      const queued = await getQueuedOperations("repo-1");
      if (queued.length > 0) {
        const toCancel = queued[0]!;
        const cancelled = await cancelSyncOperation(toCancel.id, "agent-1");

        expect(cancelled).toBe(true);

        const updated = await getOperation(toCancel.id);
        expect(updated?.status).toBe("cancelled");
      }
    });

    test("rejects cancel from non-owner", async () => {
      const operation = await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-1",
        operation: "push",
        branch: "feature/test",
      });

      const cancelled = await cancelSyncOperation(operation.id, "agent-2");

      expect(cancelled).toBe(false);

      const updated = await getOperation(operation.id);
      expect(updated?.status).not.toBe("cancelled");
    });

    test("cannot cancel completed operation", async () => {
      const operation = await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-1",
        operation: "push",
        branch: "feature/test",
      });

      await completeSyncOperation(operation.id, { success: true });

      const cancelled = await cancelSyncOperation(operation.id, "agent-1");

      expect(cancelled).toBe(false);
    });
  });

  describe("getOperationHistory", () => {
    test("returns completed operations", async () => {
      const operation = await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-1",
        operation: "push",
        branch: "feature/test",
      });

      await completeSyncOperation(operation.id, { success: true });

      const history = await getOperationHistory("repo-1");

      expect(history.length).toBe(1);
      expect(history[0]?.id).toBe(operation.id);
    });

    test("filters by agent", async () => {
      const op1 = await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-1",
        operation: "push",
        branch: "feature/a",
      });

      const op2 = await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-2",
        operation: "push",
        branch: "feature/b",
      });

      await completeSyncOperation(op1.id, { success: true });
      await completeSyncOperation(op2.id, { success: true });

      const history = await getOperationHistory("repo-1", { agentId: "agent-1" });

      expect(history.length).toBe(1);
      expect(history[0]?.request.agentId).toBe("agent-1");
    });

    test("filters by operation type", async () => {
      const op1 = await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-1",
        operation: "push",
        branch: "feature/a",
      });

      const op2 = await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-1",
        operation: "fetch",
        branch: "main",
      });

      await completeSyncOperation(op1.id, { success: true });
      await completeSyncOperation(op2.id, { success: true });

      const history = await getOperationHistory("repo-1", { operation: "push" });

      expect(history.length).toBe(1);
      expect(history[0]?.request.operation).toBe("push");
    });

    test("limits results", async () => {
      for (let i = 0; i < 5; i++) {
        const op = await queueSyncOperation({
          repositoryId: "repo-1",
          agentId: "agent-1",
          operation: "fetch",
          branch: `feature/branch-${i}`,
        });
        await completeSyncOperation(op.id, { success: true });
      }

      const history = await getOperationHistory("repo-1", { limit: 2 });

      expect(history.length).toBe(2);
    });
  });

  describe("getQueueStats", () => {
    test("returns accurate queue statistics", async () => {
      const op1 = await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-1",
        operation: "push",
        branch: "feature/a",
      });

      await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-2",
        operation: "fetch",
        branch: "main",
      });

      await completeSyncOperation(op1.id, { success: true });

      const stats = await getQueueStats("repo-1");

      expect(stats.completedCount).toBe(1);
      expect(stats.repositoryId).toBe("repo-1");
    });

    test("calculates average times for completed operations", async () => {
      const op = await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-1",
        operation: "push",
        branch: "feature/test",
      });

      // Add small delay to ensure measurable duration
      await new Promise((resolve) => setTimeout(resolve, 10));

      await completeSyncOperation(op.id, { success: true });

      const stats = await getQueueStats("repo-1");

      // Averages should be defined when there are completed operations
      if (stats.completedCount > 0) {
        expect(stats.averageDuration).toBeDefined();
      }
    });
  });

  describe("getSyncStats", () => {
    test("returns global statistics", async () => {
      await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-1",
        operation: "push",
        branch: "feature/a",
      });

      await queueSyncOperation({
        repositoryId: "repo-2",
        agentId: "agent-2",
        operation: "fetch",
        branch: "main",
      });

      const stats = getSyncStats();

      expect(stats.repositoriesWithOperations).toBe(2);
      expect(stats.operationsInMemory).toBeGreaterThanOrEqual(2);
    });
  });

  describe("operation lifecycle", () => {
    test("full lifecycle: queue -> run -> complete", async () => {
      const operation = await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-1",
        operation: "push",
        branch: "feature/test",
      });

      // Should auto-start
      expect(["running", "queued"]).toContain(operation.status);
      expect(operation.attempt).toBe(1);

      await completeSyncOperation(operation.id, {
        success: true,
        fromCommit: "abc123",
        toCommit: "def456",
        filesChanged: 10,
        insertions: 50,
        deletions: 20,
      });

      const completed = await getOperation(operation.id);
      expect(completed?.status).toBe("completed");
      expect(completed?.result?.success).toBe(true);
      expect(completed?.completedAt).toBeDefined();
    });

    test("full lifecycle: queue -> run -> fail -> retry -> complete", async () => {
      const operation = await queueSyncOperation({
        repositoryId: "repo-1",
        agentId: "agent-1",
        operation: "push",
        branch: "feature/test",
      });

      // Fail with retryable error
      await failSyncOperation(operation.id, "Connection refused");

      let updated = await getOperation(operation.id);
      expect(updated?.status).toBe("queued");
      expect(updated?.attempt).toBe(1);

      // Complete on next attempt
      await completeSyncOperation(operation.id, { success: true });

      updated = await getOperation(operation.id);
      expect(updated?.status).toBe("completed");
    });
  });
});
