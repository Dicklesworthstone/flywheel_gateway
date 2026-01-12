/**
 * Tests for Agent Analytics Service
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { db } from "../db";
import { agents as agentsTable, history as historyTable } from "../db/schema";
import {
  getAgentPerformanceSummary,
  getFleetAnalytics,
  getModelComparisonReport,
  getProductivityMetrics,
  getQualityMetrics,
  getSuccessRateMetrics,
  getTaskDurationMetrics,
  getTokenEfficiencyMetrics,
} from "../services/agent-analytics.service";

// ============================================================================
// Test Helpers
// ============================================================================

async function createTestAgent(id: string, model = "claude-3-sonnet") {
  await db.insert(agentsTable).values({
    id,
    repoUrl: `/test/repo/${id}`,
    task: `Test task for ${id}`,
    status: "ready",
    model,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function createTestHistoryEntry(
  agentId: string,
  outcome: "success" | "failure" | "timeout" | "pending",
  durationMs: number,
  promptTokens = 100,
  responseTokens = 200,
  error?: string,
) {
  const id = `hist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date();

  const inputData: Record<string, unknown> = {
    prompt: "Test prompt",
    promptTokens,
  };

  const outputData: Record<string, unknown> = {
    responseSummary: "Test response",
    responseTokens,
    outcome,
  };
  if (error) outputData["error"] = error;

  await db.insert(historyTable).values({
    id,
    agentId,
    command: "send",
    input: inputData,
    output: outputData,
    durationMs,
    createdAt: now,
  });

  return id;
}

async function cleanup() {
  await db.delete(historyTable);
  await db.delete(agentsTable);
}

// ============================================================================
// Tests
// ============================================================================

describe("Agent Analytics Service", () => {
  beforeEach(async () => {
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("getProductivityMetrics", () => {
    it("should return zero metrics for agent with no history", async () => {
      await createTestAgent("agent-1");

      const metrics = await getProductivityMetrics("agent-1", "24h");

      expect(metrics.agentId).toBe("agent-1");
      expect(metrics.period).toBe("24h");
      expect(metrics.tasksCompleted).toBe(0);
      expect(metrics.successfulTasks).toBe(0);
      expect(metrics.failedTasks).toBe(0);
      expect(metrics.avgDurationMs).toBe(0);
      expect(metrics.totalTokens).toBe(0);
    });

    it("should calculate productivity metrics correctly", async () => {
      await createTestAgent("agent-1");
      await createTestHistoryEntry("agent-1", "success", 1000, 100, 200);
      await createTestHistoryEntry("agent-1", "success", 2000, 150, 250);
      await createTestHistoryEntry("agent-1", "failure", 500, 50, 100);

      const metrics = await getProductivityMetrics("agent-1", "24h");

      expect(metrics.tasksCompleted).toBe(3);
      expect(metrics.successfulTasks).toBe(2);
      expect(metrics.failedTasks).toBe(1);
      expect(metrics.avgDurationMs).toBeCloseTo(1166.67, 0);
      expect(metrics.totalTokens).toBe(850); // (100+200) + (150+250) + (50+100)
    });

    it("should aggregate by model correctly", async () => {
      await createTestAgent("agent-1", "claude-3-sonnet");
      await createTestAgent("agent-2", "claude-3-opus");
      await createTestHistoryEntry("agent-1", "success", 1000, 100, 200);
      await createTestHistoryEntry("agent-2", "success", 2000, 200, 400);

      const metrics1 = await getProductivityMetrics("agent-1", "24h");
      const metrics2 = await getProductivityMetrics("agent-2", "24h");

      expect(metrics1.totalTokens).toBe(300);
      expect(metrics2.totalTokens).toBe(600);
    });
  });

  describe("getSuccessRateMetrics", () => {
    it("should calculate success rate correctly", async () => {
      await createTestAgent("agent-1");
      await createTestHistoryEntry("agent-1", "success", 1000);
      await createTestHistoryEntry("agent-1", "success", 1000);
      await createTestHistoryEntry("agent-1", "success", 1000);
      await createTestHistoryEntry("agent-1", "failure", 1000);

      const metrics = await getSuccessRateMetrics("agent-1", "24h");

      expect(metrics.agentId).toBe("agent-1");
      expect(metrics.totalTasks).toBe(4);
      expect(metrics.successfulTasks).toBe(3);
      expect(metrics.successRate).toBe(75);
    });

    it("should return stable trend for first-time agent", async () => {
      await createTestAgent("agent-1");
      await createTestHistoryEntry("agent-1", "success", 1000);

      const metrics = await getSuccessRateMetrics("agent-1", "24h");

      // With only current period data, trend depends on previous being 0
      expect(["stable", "improving"]).toContain(metrics.trend);
    });
  });

  describe("getTaskDurationMetrics", () => {
    it("should calculate duration percentiles correctly", async () => {
      await createTestAgent("agent-1");
      // Create 10 entries with varying durations
      for (let i = 1; i <= 10; i++) {
        await createTestHistoryEntry("agent-1", "success", i * 1000);
      }

      const metrics = await getTaskDurationMetrics("agent-1", "24h");

      expect(metrics.agentId).toBe("agent-1");
      expect(metrics.median).toBeGreaterThan(0);
      expect(metrics.p95).toBeGreaterThanOrEqual(metrics.median);
      expect(metrics.p99).toBeGreaterThanOrEqual(metrics.p95);
    });

    it("should categorize by complexity (duration)", async () => {
      await createTestAgent("agent-1");
      // Simple task (<5s)
      await createTestHistoryEntry("agent-1", "success", 2000);
      // Medium task (5-30s)
      await createTestHistoryEntry("agent-1", "success", 15000);
      // Complex task (>30s)
      await createTestHistoryEntry("agent-1", "success", 60000);

      const metrics = await getTaskDurationMetrics("agent-1", "24h");

      expect(metrics.byComplexity["simple"]).toBe(2000);
      expect(metrics.byComplexity["medium"]).toBe(15000);
      expect(metrics.byComplexity["complex"]).toBe(60000);
    });
  });

  describe("getQualityMetrics", () => {
    it("should calculate error rate correctly", async () => {
      await createTestAgent("agent-1");
      await createTestHistoryEntry("agent-1", "success", 1000);
      await createTestHistoryEntry("agent-1", "success", 1000);
      await createTestHistoryEntry("agent-1", "failure", 1000, 100, 200, "Test error");
      await createTestHistoryEntry("agent-1", "timeout", 1000, 100, 200, "timeout occurred");

      const metrics = await getQualityMetrics("agent-1", "24h");

      expect(metrics.agentId).toBe("agent-1");
      expect(metrics.errorRate).toBe(50); // 2 failures out of 4 tasks
    });

    it("should categorize errors by type", async () => {
      await createTestAgent("agent-1");
      await createTestHistoryEntry("agent-1", "failure", 1000, 100, 200, "timeout error");
      await createTestHistoryEntry("agent-1", "failure", 1000, 100, 200, "tool execution failed");
      await createTestHistoryEntry("agent-1", "failure", 1000, 100, 200, "API model error");

      const metrics = await getQualityMetrics("agent-1", "24h");

      expect(metrics.errorsByCategory["timeout"]).toBe(1);
      expect(metrics.errorsByCategory["tool_failure"]).toBe(1);
      expect(metrics.errorsByCategory["model_error"]).toBe(1);
    });
  });

  describe("getTokenEfficiencyMetrics", () => {
    it("should calculate token efficiency correctly", async () => {
      await createTestAgent("agent-1", "claude-3-sonnet");
      await createTestHistoryEntry("agent-1", "success", 1000, 100, 200);
      await createTestHistoryEntry("agent-1", "success", 1000, 200, 300);

      const metrics = await getTokenEfficiencyMetrics("agent-1");

      expect(metrics.agentId).toBe("agent-1");
      expect(metrics.model).toBe("claude-3-sonnet");
      expect(metrics.avgPromptTokens).toBe(150); // (100+200)/2
      expect(metrics.avgCompletionTokens).toBe(250); // (200+300)/2
      expect(metrics.avgTokensPerTask).toBe(400); // 150+250
    });

    it("should return zero for agent with no completed tasks", async () => {
      await createTestAgent("agent-1");

      const metrics = await getTokenEfficiencyMetrics("agent-1");

      expect(metrics.avgTokensPerTask).toBe(0);
      expect(metrics.avgPromptTokens).toBe(0);
      expect(metrics.avgCompletionTokens).toBe(0);
    });
  });

  describe("getAgentPerformanceSummary", () => {
    it("should return complete performance summary", async () => {
      await createTestAgent("agent-1", "claude-3-sonnet");
      await createTestHistoryEntry("agent-1", "success", 1000, 100, 200);
      await createTestHistoryEntry("agent-1", "success", 2000, 150, 250);
      await createTestHistoryEntry("agent-1", "failure", 500, 50, 100);

      const summary = await getAgentPerformanceSummary("agent-1", "24h");

      expect(summary.agentId).toBe("agent-1");
      expect(summary.model).toBe("claude-3-sonnet");
      expect(summary.period).toBe("24h");
      expect(summary.productivity).toBeDefined();
      expect(summary.quality).toBeDefined();
      expect(summary.efficiency).toBeDefined();
      expect(summary.successRate).toBeDefined();
      expect(summary.duration).toBeDefined();
      expect(Array.isArray(summary.recommendations)).toBe(true);
    });

    it("should generate recommendations for low success rate", async () => {
      await createTestAgent("agent-1");
      // Create tasks with low success rate
      for (let i = 0; i < 3; i++) {
        await createTestHistoryEntry("agent-1", "success", 1000);
      }
      for (let i = 0; i < 7; i++) {
        await createTestHistoryEntry("agent-1", "failure", 1000, 100, 200, "error");
      }

      const summary = await getAgentPerformanceSummary("agent-1", "24h");

      // Should have recommendation for low success rate
      const hasLowSuccessRec = summary.recommendations.some(
        (r) => r.title.toLowerCase().includes("success rate"),
      );
      expect(hasLowSuccessRec).toBe(true);
    });
  });

  describe("getModelComparisonReport", () => {
    it("should compare models correctly", async () => {
      await createTestAgent("agent-1", "claude-3-sonnet");
      await createTestAgent("agent-2", "claude-3-opus");
      await createTestHistoryEntry("agent-1", "success", 1000, 100, 200);
      await createTestHistoryEntry("agent-1", "success", 1000, 100, 200);
      await createTestHistoryEntry("agent-2", "success", 2000, 200, 400);
      await createTestHistoryEntry("agent-2", "failure", 2000, 200, 400);

      const report = await getModelComparisonReport("24h");

      expect(report.models.length).toBe(2);

      const sonnet = report.models.find((m) => m.model === "claude-3-sonnet");
      const opus = report.models.find((m) => m.model === "claude-3-opus");

      expect(sonnet?.tasksCompleted).toBe(2);
      expect(sonnet?.successRate).toBe(100);
      expect(opus?.tasksCompleted).toBe(2);
      expect(opus?.successRate).toBe(50);
    });

    it("should sort by quality score", async () => {
      await createTestAgent("agent-1", "model-a");
      await createTestAgent("agent-2", "model-b");
      // model-a: 100% success
      await createTestHistoryEntry("agent-1", "success", 1000);
      // model-b: 50% success
      await createTestHistoryEntry("agent-2", "success", 1000);
      await createTestHistoryEntry("agent-2", "failure", 1000);

      const report = await getModelComparisonReport("24h");

      expect(report.models[0]?.model).toBe("model-a");
      expect(report.models[1]?.model).toBe("model-b");
    });
  });

  describe("getFleetAnalytics", () => {
    it("should calculate fleet-wide analytics", async () => {
      await createTestAgent("agent-1");
      await createTestAgent("agent-2");
      await createTestAgent("agent-3"); // inactive

      await createTestHistoryEntry("agent-1", "success", 1000);
      await createTestHistoryEntry("agent-1", "success", 1000);
      await createTestHistoryEntry("agent-2", "success", 1000);
      await createTestHistoryEntry("agent-2", "failure", 1000);

      const analytics = await getFleetAnalytics("24h");

      expect(analytics.totalAgents).toBe(3);
      expect(analytics.activeAgents).toBe(2);
      expect(analytics.totalTasksCompleted).toBe(4);
      // Average success rate: agent-1: 100%, agent-2: 50%, avg = 75%
      expect(analytics.avgSuccessRate).toBeCloseTo(75, 0);
    });

    it("should identify top performers", async () => {
      await createTestAgent("agent-top");
      await createTestAgent("agent-low");

      // agent-top: 100% success
      await createTestHistoryEntry("agent-top", "success", 1000);
      await createTestHistoryEntry("agent-top", "success", 1000);

      // agent-low: 50% success
      await createTestHistoryEntry("agent-low", "success", 1000);
      await createTestHistoryEntry("agent-low", "failure", 1000);

      const analytics = await getFleetAnalytics("24h");

      expect(analytics.topPerformers[0]?.agentId).toBe("agent-top");
      expect(analytics.topPerformers[0]?.successRate).toBe(100);
    });

    it("should identify agents needing attention", async () => {
      await createTestAgent("agent-bad");

      // Very low success rate
      await createTestHistoryEntry("agent-bad", "success", 1000);
      await createTestHistoryEntry("agent-bad", "failure", 1000);
      await createTestHistoryEntry("agent-bad", "failure", 1000);
      await createTestHistoryEntry("agent-bad", "failure", 1000);

      const analytics = await getFleetAnalytics("24h");

      expect(analytics.needsAttention.length).toBeGreaterThan(0);
      expect(analytics.needsAttention[0]?.agentId).toBe("agent-bad");
    });
  });
});
