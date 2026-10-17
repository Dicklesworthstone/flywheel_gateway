import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { eq } from "drizzle-orm";
import { agents, db, safetyConfigs, safetyRules } from "../db";
import {
  _clearAllApprovalData,
  _setApprovalExpiration,
  cancelApproval,
  checkEscalation,
  createApprovalRequest,
  decideApproval,
  getApproval,
  getApprovalStats,
  getPendingApprovals,
  getQueueDepth,
  listApprovals,
  processExpiredApprovals,
} from "../services/approval.service";
import type { SafetyRule } from "../services/safety-rules.engine";

const TEST_WORKSPACE_ID = "approval-test-workspace-1";
const TEST_WORKSPACE_ID_2 = "approval-test-workspace-2";
const TEST_AGENT_ID = "approval-test-agent-1";
const TEST_SESSION_ID = "approval-test-session-1";
const TEST_SAFETY_CONFIG_ID = "approval-test-safety-config-1";
const TEST_RULE_ID = "approval-test-rule-1";

describe("Approval Service", () => {
  const mockRule: SafetyRule = {
    id: TEST_RULE_ID,
    name: "Force Push Approval",
    description: "Force push requires approval",
    category: "git",
    conditions: [
      { field: "command", patternType: "regex", pattern: "push.*--force" },
    ],
    conditionLogic: "and",
    action: "approve",
    severity: "high",
    message: "Force push requires approval",
    enabled: true,
  };

  // Set up prerequisite rows for FK constraints (agents.id, safety_rules.id)
  beforeAll(async () => {
    const now = new Date();

    await db.insert(agents).values({
      id: TEST_AGENT_ID,
      repoUrl: "https://example.com/repo.git",
      task: "Approval service test agent",
      status: "idle",
      model: "sonnet-4",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(safetyConfigs).values({
      id: TEST_SAFETY_CONFIG_ID,
      workspaceId: TEST_WORKSPACE_ID,
      name: "Approval service test safety config",
      description: "Test config for approval service",
      enabled: true,
      categoryEnables: JSON.stringify({ git: true }),
      rateLimits: JSON.stringify({}),
      budget: JSON.stringify({}),
      approvalWorkflow: JSON.stringify({}),
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(safetyRules).values({
      id: TEST_RULE_ID,
      configId: TEST_SAFETY_CONFIG_ID,
      workspaceId: TEST_WORKSPACE_ID,
      name: mockRule.name,
      description: mockRule.description,
      category: mockRule.category,
      conditions: JSON.stringify(mockRule.conditions),
      conditionLogic: mockRule.conditionLogic,
      action: mockRule.action,
      severity: mockRule.severity,
      message: mockRule.message,
      enabled: true,
      alternatives: null,
      priority: 100,
      metadata: null,
      createdAt: now,
      updatedAt: now,
    });
  });

  // Clean up after all tests
  afterAll(async () => {
    await _clearAllApprovalData();
    await db
      .delete(safetyConfigs)
      .where(eq(safetyConfigs.id, TEST_SAFETY_CONFIG_ID));
    await db.delete(agents).where(eq(agents.id, TEST_AGENT_ID));
  });

  beforeEach(async () => {
    await _clearAllApprovalData();
  });

  afterEach(async () => {
    await _clearAllApprovalData();
  });

  describe("Creating Approvals", () => {
    test("creates approval request", async () => {
      const approval = await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: {
          type: "git",
          command: "git push --force origin main",
          description: "Force push to main branch",
        },
        rule: mockRule,
      });

      expect(approval.id).toMatch(/^appr_/);
      expect(approval.status).toBe("pending");
      expect(approval.agentId).toBe(TEST_AGENT_ID);
      expect(approval.operation.type).toBe("git");
      expect(approval.priority).toBe("normal");
    });

    test("creates with custom timeout", async () => {
      const approval = await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: {
          type: "git",
          description: "Test operation",
        },
        rule: mockRule,
        timeoutMinutes: 5,
      });

      const expiresIn =
        approval.expiresAt.getTime() - approval.requestedAt.getTime();
      expect(expiresIn).toBe(5 * 60 * 1000);
    });

    test("creates with priority", async () => {
      const approval = await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: {
          type: "git",
          description: "Urgent operation",
        },
        rule: mockRule,
        priority: "urgent",
      });

      expect(approval.priority).toBe("urgent");
    });
  });

  describe("Making Decisions", () => {
    test("approves request", async () => {
      const approval = await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "git", description: "Test" },
        rule: mockRule,
      });

      const result = await decideApproval({
        requestId: approval.id,
        decision: "approved",
        decidedBy: "admin@example.com",
        reason: "Looks safe",
      });

      expect(result.success).toBe(true);
      expect(result.request?.status).toBe("approved");
      expect(result.request?.decidedBy).toBe("admin@example.com");
      expect(result.request?.decisionReason).toBe("Looks safe");
    });

    test("denies request", async () => {
      const approval = await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "git", description: "Test" },
        rule: mockRule,
      });

      const result = await decideApproval({
        requestId: approval.id,
        decision: "denied",
        decidedBy: "admin@example.com",
        reason: "Too risky",
      });

      expect(result.success).toBe(true);
      expect(result.request?.status).toBe("denied");
    });

    test("fails for non-existent request", async () => {
      const result = await decideApproval({
        requestId: "non-existent",
        decision: "approved",
        decidedBy: "admin@example.com",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    test("fails for already decided request", async () => {
      const approval = await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "git", description: "Test" },
        rule: mockRule,
      });

      await decideApproval({
        requestId: approval.id,
        decision: "approved",
        decidedBy: "admin@example.com",
      });

      const result = await decideApproval({
        requestId: approval.id,
        decision: "denied",
        decidedBy: "another@example.com",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("status");
    });
  });

  describe("Cancelling Approvals", () => {
    test("cancels pending approval", async () => {
      const approval = await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "git", description: "Test" },
        rule: mockRule,
      });

      const result = await cancelApproval(
        approval.id,
        TEST_AGENT_ID,
        "No longer needed",
      );

      expect(result.success).toBe(true);
      expect(result.request?.status).toBe("cancelled");
    });

    test("cannot cancel non-pending approval", async () => {
      const approval = await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "git", description: "Test" },
        rule: mockRule,
      });

      await decideApproval({
        requestId: approval.id,
        decision: "approved",
        decidedBy: "admin@example.com",
      });

      const result = await cancelApproval(approval.id, TEST_AGENT_ID);

      expect(result.success).toBe(false);
    });
  });

  describe("Querying Approvals", () => {
    test("gets approval by ID", async () => {
      const created = await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "git", description: "Test" },
        rule: mockRule,
      });

      const approval = await getApproval(created.id);

      expect(approval).toBeDefined();
      expect(approval?.id).toBe(created.id);
    });

    test("lists approvals by workspace", async () => {
      await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "git", description: "Test 1" },
        rule: mockRule,
      });

      await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID_2,
        operation: { type: "git", description: "Test 2" },
        rule: mockRule,
      });

      const approvals = await listApprovals({ workspaceId: TEST_WORKSPACE_ID });

      expect(approvals.length).toBe(1);
      expect(approvals[0]?.workspaceId).toBe(TEST_WORKSPACE_ID);
    });

    test("lists approvals by status", async () => {
      const approval1 = await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "git", description: "Test 1" },
        rule: mockRule,
      });

      await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "git", description: "Test 2" },
        rule: mockRule,
      });

      await decideApproval({
        requestId: approval1.id,
        decision: "approved",
        decidedBy: "admin",
      });

      const pending = await listApprovals({
        workspaceId: TEST_WORKSPACE_ID,
        status: "pending",
      });

      expect(pending.length).toBe(1);
    });

    test("sorts by priority", async () => {
      await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "git", description: "Low priority" },
        rule: mockRule,
        priority: "low",
      });

      await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "git", description: "Urgent" },
        rule: mockRule,
        priority: "urgent",
      });

      await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "git", description: "Normal" },
        rule: mockRule,
        priority: "normal",
      });

      const approvals = await listApprovals({ workspaceId: TEST_WORKSPACE_ID });

      expect(approvals[0]?.priority).toBe("urgent");
      expect(approvals[1]?.priority).toBe("normal");
      expect(approvals[2]?.priority).toBe("low");
    });
  });

  describe("Pending Approvals Queue", () => {
    test("gets pending approvals", async () => {
      await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "git", description: "Test" },
        rule: mockRule,
      });

      const pending = await getPendingApprovals(TEST_WORKSPACE_ID);

      expect(pending.length).toBe(1);
      expect(pending[0]?.status).toBe("pending");
    });

    test("gets queue depth", async () => {
      await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "git", description: "Test 1" },
        rule: mockRule,
      });

      await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "git", description: "Test 2" },
        rule: mockRule,
      });

      const depth = await getQueueDepth(TEST_WORKSPACE_ID);

      expect(depth).toBe(2);
    });
  });

  describe("Expiration", () => {
    test("marks expired approvals", async () => {
      const approval = await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "git", description: "Test" },
        rule: mockRule,
        timeoutMinutes: 1,
      });

      // Manually set to expired
      await _setApprovalExpiration(approval.id, new Date(Date.now() - 1000));

      const expiredCount = await processExpiredApprovals();

      expect(expiredCount).toBe(1);

      const updated = await getApproval(approval.id);
      expect(updated?.status).toBe("expired");
    });

    test("cannot decide on expired approval", async () => {
      const approval = await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "git", description: "Test" },
        rule: mockRule,
      });

      // Manually set to expired
      await _setApprovalExpiration(approval.id, new Date(Date.now() - 1000));

      const result = await decideApproval({
        requestId: approval.id,
        decision: "approved",
        decidedBy: "admin",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("expired");
    });
  });

  describe("Statistics", () => {
    test("calculates statistics", async () => {
      const approval1 = await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "git", description: "Test 1" },
        rule: mockRule,
        priority: "high",
      });

      await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "filesystem", description: "Test 2" },
        rule: { ...mockRule, category: "filesystem" },
        priority: "low",
      });

      await decideApproval({
        requestId: approval1.id,
        decision: "approved",
        decidedBy: "admin",
      });

      const stats = await getApprovalStats(TEST_WORKSPACE_ID);

      expect(stats.pending).toBe(1);
      expect(stats.approved).toBe(1);
      expect(stats.byPriority["high"]).toBe(1);
      expect(stats.byPriority["low"]).toBe(1);
      expect(stats.byCategory["git"]).toBe(1);
      expect(stats.byCategory["filesystem"]).toBe(1);
    });

    test("calculates average decision time", async () => {
      const approval = await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "git", description: "Test" },
        rule: mockRule,
      });

      // Wait at least 1 second since SQLite stores timestamps in seconds
      await new Promise((resolve) => setTimeout(resolve, 1100));

      await decideApproval({
        requestId: approval.id,
        decision: "approved",
        decidedBy: "admin",
      });

      const stats = await getApprovalStats(TEST_WORKSPACE_ID);

      expect(stats.averageDecisionTimeMs).toBeGreaterThan(0);
    });
  });

  describe("Escalation", () => {
    test("detects escalation needed by count", async () => {
      // Create multiple pending approvals
      for (let i = 0; i < 5; i++) {
        await createApprovalRequest({
          agentId: TEST_AGENT_ID,
          sessionId: `${TEST_SESSION_ID}-${i}`,
          workspaceId: TEST_WORKSPACE_ID,
          operation: { type: "git", description: `Test ${i}` },
          rule: mockRule,
        });
      }

      const result = await checkEscalation(TEST_WORKSPACE_ID, {
        enabled: true,
        thresholds: {
          pendingCount: 3,
          waitTimeMinutes: 60,
        },
        notifyEmails: ["admin@example.com"],
      });

      expect(result.shouldEscalate).toBe(true);
      expect(result.reason).toContain("5 pending");
    });

    test("does not escalate when disabled", async () => {
      for (let i = 0; i < 5; i++) {
        await createApprovalRequest({
          agentId: TEST_AGENT_ID,
          sessionId: `${TEST_SESSION_ID}-${i}`,
          workspaceId: TEST_WORKSPACE_ID,
          operation: { type: "git", description: `Test ${i}` },
          rule: mockRule,
        });
      }

      const result = await checkEscalation(TEST_WORKSPACE_ID, {
        enabled: false,
        thresholds: {
          pendingCount: 3,
          waitTimeMinutes: 60,
        },
        notifyEmails: [],
      });

      expect(result.shouldEscalate).toBe(false);
    });

    test("does not escalate when below thresholds", async () => {
      await createApprovalRequest({
        agentId: TEST_AGENT_ID,
        sessionId: TEST_SESSION_ID,
        workspaceId: TEST_WORKSPACE_ID,
        operation: { type: "git", description: "Test" },
        rule: mockRule,
      });

      const result = await checkEscalation(TEST_WORKSPACE_ID, {
        enabled: true,
        thresholds: {
          pendingCount: 10,
          waitTimeMinutes: 60,
        },
        notifyEmails: ["admin@example.com"],
      });

      expect(result.shouldEscalate).toBe(false);
    });
  });
});
