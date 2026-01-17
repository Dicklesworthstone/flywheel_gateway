import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { sqlite } from "../db/connection";
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

// SQL to create the approval_requests table for tests
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  agent_id TEXT,
  session_id TEXT,
  rule_id TEXT,
  rule_name TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  operation_command TEXT,
  operation_path TEXT,
  operation_description TEXT NOT NULL,
  operation_details BLOB,
  task_description TEXT,
  recent_actions TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'normal',
  requested_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  decided_by TEXT,
  decided_at INTEGER,
  decision_reason TEXT,
  correlation_id TEXT
)`;

describe("Approval Service", () => {
  const mockRule: SafetyRule = {
    id: "rule-1",
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

  // Set up test database before all tests
  beforeAll(() => {
    sqlite.exec(CREATE_TABLE_SQL);
  });

  // Clean up after all tests
  afterAll(async () => {
    await _clearAllApprovalData();
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
        agentId: "agent-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
        operation: {
          type: "git",
          command: "git push --force origin main",
          description: "Force push to main branch",
        },
        rule: mockRule,
      });

      expect(approval.id).toMatch(/^appr_/);
      expect(approval.status).toBe("pending");
      expect(approval.agentId).toBe("agent-1");
      expect(approval.operation.type).toBe("git");
      expect(approval.priority).toBe("normal");
    });

    test("creates with custom timeout", async () => {
      const approval = await createApprovalRequest({
        agentId: "agent-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
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
        agentId: "agent-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
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
        agentId: "agent-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
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
        agentId: "agent-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
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
        agentId: "agent-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
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
        agentId: "agent-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
        operation: { type: "git", description: "Test" },
        rule: mockRule,
      });

      const result = await cancelApproval(
        approval.id,
        "agent-1",
        "No longer needed",
      );

      expect(result.success).toBe(true);
      expect(result.request?.status).toBe("cancelled");
    });

    test("cannot cancel non-pending approval", async () => {
      const approval = await createApprovalRequest({
        agentId: "agent-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
        operation: { type: "git", description: "Test" },
        rule: mockRule,
      });

      await decideApproval({
        requestId: approval.id,
        decision: "approved",
        decidedBy: "admin@example.com",
      });

      const result = await cancelApproval(approval.id, "agent-1");

      expect(result.success).toBe(false);
    });
  });

  describe("Querying Approvals", () => {
    test("gets approval by ID", async () => {
      const created = await createApprovalRequest({
        agentId: "agent-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
        operation: { type: "git", description: "Test" },
        rule: mockRule,
      });

      const approval = await getApproval(created.id);

      expect(approval).toBeDefined();
      expect(approval?.id).toBe(created.id);
    });

    test("lists approvals by workspace", async () => {
      await createApprovalRequest({
        agentId: "agent-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
        operation: { type: "git", description: "Test 1" },
        rule: mockRule,
      });

      await createApprovalRequest({
        agentId: "agent-2",
        sessionId: "session-2",
        workspaceId: "workspace-2",
        operation: { type: "git", description: "Test 2" },
        rule: mockRule,
      });

      const approvals = await listApprovals({ workspaceId: "workspace-1" });

      expect(approvals.length).toBe(1);
      expect(approvals[0]?.workspaceId).toBe("workspace-1");
    });

    test("lists approvals by status", async () => {
      const approval1 = await createApprovalRequest({
        agentId: "agent-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
        operation: { type: "git", description: "Test 1" },
        rule: mockRule,
      });

      await createApprovalRequest({
        agentId: "agent-2",
        sessionId: "session-2",
        workspaceId: "workspace-1",
        operation: { type: "git", description: "Test 2" },
        rule: mockRule,
      });

      await decideApproval({
        requestId: approval1.id,
        decision: "approved",
        decidedBy: "admin",
      });

      const pending = await listApprovals({
        workspaceId: "workspace-1",
        status: "pending",
      });

      expect(pending.length).toBe(1);
    });

    test("sorts by priority", async () => {
      await createApprovalRequest({
        agentId: "agent-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
        operation: { type: "git", description: "Low priority" },
        rule: mockRule,
        priority: "low",
      });

      await createApprovalRequest({
        agentId: "agent-2",
        sessionId: "session-2",
        workspaceId: "workspace-1",
        operation: { type: "git", description: "Urgent" },
        rule: mockRule,
        priority: "urgent",
      });

      await createApprovalRequest({
        agentId: "agent-3",
        sessionId: "session-3",
        workspaceId: "workspace-1",
        operation: { type: "git", description: "Normal" },
        rule: mockRule,
        priority: "normal",
      });

      const approvals = await listApprovals({ workspaceId: "workspace-1" });

      expect(approvals[0]?.priority).toBe("urgent");
      expect(approvals[1]?.priority).toBe("normal");
      expect(approvals[2]?.priority).toBe("low");
    });
  });

  describe("Pending Approvals Queue", () => {
    test("gets pending approvals", async () => {
      await createApprovalRequest({
        agentId: "agent-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
        operation: { type: "git", description: "Test" },
        rule: mockRule,
      });

      const pending = await getPendingApprovals("workspace-1");

      expect(pending.length).toBe(1);
      expect(pending[0]?.status).toBe("pending");
    });

    test("gets queue depth", async () => {
      await createApprovalRequest({
        agentId: "agent-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
        operation: { type: "git", description: "Test 1" },
        rule: mockRule,
      });

      await createApprovalRequest({
        agentId: "agent-2",
        sessionId: "session-2",
        workspaceId: "workspace-1",
        operation: { type: "git", description: "Test 2" },
        rule: mockRule,
      });

      const depth = await getQueueDepth("workspace-1");

      expect(depth).toBe(2);
    });
  });

  describe("Expiration", () => {
    test("marks expired approvals", async () => {
      const approval = await createApprovalRequest({
        agentId: "agent-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
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
        agentId: "agent-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
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
        agentId: "agent-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
        operation: { type: "git", description: "Test 1" },
        rule: mockRule,
        priority: "high",
      });

      await createApprovalRequest({
        agentId: "agent-2",
        sessionId: "session-2",
        workspaceId: "workspace-1",
        operation: { type: "filesystem", description: "Test 2" },
        rule: { ...mockRule, category: "filesystem" },
        priority: "low",
      });

      await decideApproval({
        requestId: approval1.id,
        decision: "approved",
        decidedBy: "admin",
      });

      const stats = await getApprovalStats("workspace-1");

      expect(stats.pending).toBe(1);
      expect(stats.approved).toBe(1);
      expect(stats.byPriority["high"]).toBe(1);
      expect(stats.byPriority["low"]).toBe(1);
      expect(stats.byCategory["git"]).toBe(1);
      expect(stats.byCategory["filesystem"]).toBe(1);
    });

    test("calculates average decision time", async () => {
      const approval = await createApprovalRequest({
        agentId: "agent-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
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

      const stats = await getApprovalStats("workspace-1");

      expect(stats.averageDecisionTimeMs).toBeGreaterThan(0);
    });
  });

  describe("Escalation", () => {
    test("detects escalation needed by count", async () => {
      // Create multiple pending approvals
      for (let i = 0; i < 5; i++) {
        await createApprovalRequest({
          agentId: `agent-${i}`,
          sessionId: `session-${i}`,
          workspaceId: "workspace-1",
          operation: { type: "git", description: `Test ${i}` },
          rule: mockRule,
        });
      }

      const result = await checkEscalation("workspace-1", {
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
          agentId: `agent-${i}`,
          sessionId: `session-${i}`,
          workspaceId: "workspace-1",
          operation: { type: "git", description: `Test ${i}` },
          rule: mockRule,
        });
      }

      const result = await checkEscalation("workspace-1", {
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
        agentId: "agent-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
        operation: { type: "git", description: "Test" },
        rule: mockRule,
      });

      const result = await checkEscalation("workspace-1", {
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
