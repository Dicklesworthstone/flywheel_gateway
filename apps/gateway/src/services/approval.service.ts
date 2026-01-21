/**
 * Approval Service.
 *
 * Manages approval workflows for operations that require human oversight.
 * Handles approval requests, decisions, timeouts, and escalation.
 * Persists state to SQLite database.
 */

import { and, desc, eq, gt, gte, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { approvalRequests } from "../db/schema";
import { logger } from "./logger";
import type { SafetyCategory, SafetyRule } from "./safety-rules.engine";

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate a unique ID with a prefix.
 */
function generateId(prefix: string, length = 12): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const charLen = chars.length;
  const maxByte = 256 - (256 % charLen);
  let result = "";

  while (result.length < length) {
    const bufSize = Math.ceil((length - result.length) * 1.2);
    const randomBytes = new Uint8Array(bufSize);
    crypto.getRandomValues(randomBytes);

    for (let i = 0; i < bufSize && result.length < length; i++) {
      const byte = randomBytes[i]!;
      if (byte < maxByte) {
        result += chars[byte % charLen];
      }
    }
  }
  return `${prefix}_${result}`;
}

// ============================================================================
// Types
// ============================================================================

/**
 * Status of an approval request.
 */
export type ApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "cancelled";

/**
 * An approval request.
 */
export interface ApprovalRequest {
  id: string;
  agentId: string;
  sessionId: string;
  workspaceId: string;
  operation: {
    type: SafetyCategory;
    command?: string;
    path?: string;
    description: string;
    details: Record<string, unknown>;
  };
  rule: SafetyRule;
  context: {
    recentActions: string[];
    taskDescription?: string;
  };
  status: ApprovalStatus;
  requestedAt: Date;
  expiresAt: Date;
  decidedBy?: string;
  decidedAt?: Date;
  decisionReason?: string;
  correlationId?: string;
  priority: "low" | "normal" | "high" | "urgent";
}

/**
 * Request to create an approval.
 */
export interface CreateApprovalRequest {
  agentId: string;
  sessionId: string;
  workspaceId: string;
  operation: {
    type: SafetyCategory;
    command?: string;
    path?: string;
    description: string;
    details?: Record<string, unknown>;
  };
  rule: SafetyRule;
  context?: {
    recentActions?: string[];
    taskDescription?: string;
  };
  timeoutMinutes?: number;
  priority?: "low" | "normal" | "high" | "urgent";
  correlationId?: string;
}

/**
 * Decision on an approval request.
 */
export interface ApprovalDecision {
  requestId: string;
  decision: "approved" | "denied";
  decidedBy: string;
  reason?: string;
}

/**
 * Result of making a decision.
 */
export interface ApprovalDecisionResult {
  success: boolean;
  request?: ApprovalRequest;
  error?: string;
}

/**
 * Options for listing approvals.
 */
export interface ListApprovalsOptions {
  workspaceId?: string;
  agentId?: string;
  sessionId?: string;
  status?: ApprovalStatus;
  since?: Date;
  limit?: number;
  includeExpired?: boolean;
}

/**
 * Approval statistics.
 */
export interface ApprovalStats {
  pending: number;
  approved: number;
  denied: number;
  expired: number;
  cancelled: number;
  averageDecisionTimeMs: number;
  byPriority: Record<string, number>;
  byCategory: Record<SafetyCategory, number>;
}

/** Expiration check interval */
let expirationTimer: ReturnType<typeof setInterval> | null = null;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Map DB row to ApprovalRequest interface.
 * Reconstructs a partial SafetyRule since we only store minimal rule info.
 */
function mapToApprovalRequest(
  row: typeof approvalRequests.$inferSelect,
): ApprovalRequest {
  // Parse JSON fields
  // Handle case where json mode text might be returned as string if not properly typed by drizzle-orm/sqlite-core depending on version
  const operationDetails =
    typeof row.operationDetails === "string"
      ? JSON.parse(row.operationDetails)
      : (row.operationDetails as Record<string, unknown>);

  const recentActions =
    typeof row.recentActions === "string"
      ? JSON.parse(row.recentActions)
      : ((row.recentActions as unknown as string[]) ?? []);

  // Reconstruct a minimal rule object
  const rule: SafetyRule = {
    id: row.ruleId ?? "unknown",
    name: row.ruleName,
    category: row.operationType as SafetyCategory,
    severity: "high", // Default, as we don't store severity
    action: "approve",
    message: "Requires approval",
    conditions: [],
    conditionLogic: "and",
    enabled: true,
    description: "Reconstructed from approval request",
  };

  return {
    id: row.id,
    agentId: row.agentId ?? "unknown",
    sessionId: row.sessionId ?? "unknown",
    workspaceId: row.workspaceId,
    operation: {
      type: row.operationType as SafetyCategory,
      ...(row.operationCommand != null
        ? { command: row.operationCommand }
        : {}),
      ...(row.operationPath != null ? { path: row.operationPath } : {}),
      description: row.operationDescription,
      details: operationDetails,
    },
    rule,
    context: {
      recentActions,
      ...(row.taskDescription != null
        ? { taskDescription: row.taskDescription }
        : {}),
    },
    status: row.status as ApprovalStatus,
    requestedAt: row.requestedAt,
    expiresAt: row.expiresAt,
    ...(row.decidedBy != null ? { decidedBy: row.decidedBy } : {}),
    ...(row.decidedAt != null ? { decidedAt: row.decidedAt } : {}),
    ...(row.decisionReason != null
      ? { decisionReason: row.decisionReason }
      : {}),
    ...(row.correlationId != null ? { correlationId: row.correlationId } : {}),
    priority: (row.priority as ApprovalRequest["priority"]) ?? "normal",
  };
}

// ============================================================================
// Approval Creation
// ============================================================================

/**
 * Create a new approval request.
 */
export async function createApprovalRequest(
  request: CreateApprovalRequest,
): Promise<ApprovalRequest> {
  const now = new Date();
  const timeoutMinutes = request.timeoutMinutes ?? 30;
  const id = generateId("appr");
  const expiresAt = new Date(now.getTime() + timeoutMinutes * 60 * 1000);

  const newRequest = {
    id,
    workspaceId: request.workspaceId,
    agentId: request.agentId,
    sessionId: request.sessionId,
    ruleId: request.rule.id,
    ruleName: request.rule.name,
    operationType: request.operation.type,
    operationCommand: request.operation.command,
    operationPath: request.operation.path,
    operationDescription: request.operation.description,
    operationDetails: request.operation.details ?? {},
    taskDescription: request.context?.taskDescription,
    recentActions: JSON.stringify(request.context?.recentActions ?? []),
    status: "pending",
    priority: request.priority ?? "normal",
    requestedAt: now,
    expiresAt,
    correlationId: request.correlationId,
  };

  await db.insert(approvalRequests).values(newRequest);

  logger.info(
    {
      correlationId: request.correlationId,
      approvalId: id,
      agentId: request.agentId,
      operation: request.operation.type,
      priority: request.priority,
      expiresAt,
    },
    "Approval request created",
  );

  // Return the full object
  return {
    id,
    agentId: request.agentId,
    sessionId: request.sessionId,
    workspaceId: request.workspaceId,
    operation: {
      type: request.operation.type,
      description: request.operation.description,
      details: request.operation.details ?? {},
      ...(request.operation.command != null
        ? { command: request.operation.command }
        : {}),
      ...(request.operation.path != null
        ? { path: request.operation.path }
        : {}),
    },
    rule: request.rule,
    context: {
      recentActions: request.context?.recentActions ?? [],
      ...(request.context?.taskDescription != null
        ? { taskDescription: request.context.taskDescription }
        : {}),
    },
    status: "pending",
    requestedAt: now,
    expiresAt,
    priority: request.priority ?? "normal",
    ...(request.correlationId != null
      ? { correlationId: request.correlationId }
      : {}),
  };
}

// ============================================================================
// Decision Making
// ============================================================================

/**
 * Make a decision on an approval request.
 */
export async function decideApproval(
  decision: ApprovalDecision,
): Promise<ApprovalDecisionResult> {
  const request = await getApproval(decision.requestId);

  if (!request) {
    return {
      success: false,
      error: "Approval request not found",
    };
  }

  if (request.status !== "pending") {
    return {
      success: false,
      error: `Cannot decide on request with status: ${request.status}`,
    };
  }

  // Check if expired
  if (request.expiresAt < new Date()) {
    await db
      .update(approvalRequests)
      .set({ status: "expired" })
      .where(eq(approvalRequests.id, decision.requestId));

    return {
      success: false,
      error: "Approval request has expired",
    };
  }

  // Apply decision
  const status = decision.decision === "approved" ? "approved" : "denied";
  const decidedAt = new Date();

  await db
    .update(approvalRequests)
    .set({
      status,
      decidedBy: decision.decidedBy,
      decidedAt,
      decisionReason: decision.reason,
    })
    .where(eq(approvalRequests.id, decision.requestId));

  logger.info(
    {
      correlationId: request.correlationId,
      approvalId: request.id,
      decision: decision.decision,
      decidedBy: decision.decidedBy,
      reason: decision.reason,
    },
    "Approval decision made",
  );

  // Return updated request
  return {
    success: true,
    request: {
      ...request,
      status,
      decidedBy: decision.decidedBy,
      decidedAt,
      ...(decision.reason != null ? { decisionReason: decision.reason } : {}),
    },
  };
}

/**
 * Cancel an approval request.
 */
export async function cancelApproval(
  requestId: string,
  cancelledBy: string,
  reason?: string,
): Promise<ApprovalDecisionResult> {
  const request = await getApproval(requestId);

  if (!request) {
    return {
      success: false,
      error: "Approval request not found",
    };
  }

  if (request.status !== "pending") {
    return {
      success: false,
      error: `Cannot cancel request with status: ${request.status}`,
    };
  }

  const decidedAt = new Date();
  const decisionReason = reason ?? "Cancelled by requestor";

  await db
    .update(approvalRequests)
    .set({
      status: "cancelled",
      decidedBy: cancelledBy,
      decidedAt,
      decisionReason,
    })
    .where(eq(approvalRequests.id, requestId));

  logger.info(
    {
      correlationId: request.correlationId,
      approvalId: request.id,
      cancelledBy,
      reason,
    },
    "Approval request cancelled",
  );

  return {
    success: true,
    request: {
      ...request,
      status: "cancelled",
      decidedBy: cancelledBy,
      decidedAt,
      decisionReason,
    },
  };
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Get an approval request by ID.
 */
export async function getApproval(
  requestId: string,
): Promise<ApprovalRequest | undefined> {
  const result = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, requestId))
    .limit(1);

  const row = result[0];
  if (!row) return undefined;

  return mapToApprovalRequest(row);
}

/**
 * Get approval requests matching criteria.
 */
export async function listApprovals(
  options?: ListApprovalsOptions,
): Promise<ApprovalRequest[]> {
  const conditions = [];

  if (options?.workspaceId) {
    conditions.push(eq(approvalRequests.workspaceId, options.workspaceId));
  }
  if (options?.agentId) {
    conditions.push(eq(approvalRequests.agentId, options.agentId));
  }
  if (options?.sessionId) {
    conditions.push(eq(approvalRequests.sessionId, options.sessionId));
  }
  if (options?.status) {
    conditions.push(eq(approvalRequests.status, options.status));
  }
  if (options?.since) {
    conditions.push(gte(approvalRequests.requestedAt, options.since));
  }
  if (!options?.includeExpired) {
    // Use proper Drizzle comparisons - note: SQLite stores timestamps as integers
    const now = new Date();
    conditions.push(
      and(
        sql`${approvalRequests.status} != 'expired'`,
        gt(approvalRequests.expiresAt, now),
      ),
    );
  }

  let query = db
    .select()
    .from(approvalRequests)
    .where(and(...conditions))
    .orderBy(
      // Priority order: urgent > high > normal > low
      sql`CASE ${approvalRequests.priority}
        WHEN 'urgent' THEN 0
        WHEN 'high' THEN 1
        WHEN 'normal' THEN 2
        WHEN 'low' THEN 3
        ELSE 4 END`,
      desc(approvalRequests.requestedAt),
    );

  if (options?.limit) {
    query = query.limit(options.limit) as typeof query;
  }

  const rows = await query;
  return rows.map(mapToApprovalRequest);
}

/**
 * Get pending approvals for a workspace (the approval queue).
 */
export async function getPendingApprovals(
  workspaceId: string,
): Promise<ApprovalRequest[]> {
  return listApprovals({
    workspaceId,
    status: "pending",
    includeExpired: false,
  });
}

/**
 * Get approval queue depth.
 */
export async function getQueueDepth(workspaceId?: string): Promise<number> {
  const pending = await listApprovals({
    ...(workspaceId && { workspaceId }),
    status: "pending",
    includeExpired: false,
  });
  return pending.length;
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get approval statistics.
 */
export async function getApprovalStats(
  workspaceId?: string,
): Promise<ApprovalStats> {
  const conditions = [];
  if (workspaceId) {
    conditions.push(eq(approvalRequests.workspaceId, workspaceId));
  }

  const rows = await db
    .select()
    .from(approvalRequests)
    .where(and(...conditions));

  const stats: ApprovalStats = {
    pending: 0,
    approved: 0,
    denied: 0,
    expired: 0,
    cancelled: 0,
    averageDecisionTimeMs: 0,
    byPriority: { low: 0, normal: 0, high: 0, urgent: 0 },
    byCategory: {
      filesystem: 0,
      git: 0,
      network: 0,
      execution: 0,
      resources: 0,
      content: 0,
    },
  };

  let totalDecisionTimeMs = 0;
  let decidedCount = 0;

  for (const row of rows) {
    const status = row.status as keyof Pick<
      ApprovalStats,
      "pending" | "approved" | "denied" | "expired" | "cancelled"
    >;
    if (stats[status] !== undefined) stats[status]++;

    const priority = row.priority as keyof ApprovalStats["byPriority"];
    if (stats.byPriority[priority] !== undefined) stats.byPriority[priority]++;

    const category = row.operationType as keyof ApprovalStats["byCategory"];
    if (stats.byCategory[category] !== undefined) stats.byCategory[category]++;

    if (row.decidedAt && row.requestedAt) {
      totalDecisionTimeMs +=
        row.decidedAt.getTime() - row.requestedAt.getTime();
      decidedCount++;
    }
  }

  if (decidedCount > 0) {
    stats.averageDecisionTimeMs = totalDecisionTimeMs / decidedCount;
  }

  return stats;
}

// ============================================================================
// Expiration Management
// ============================================================================

/**
 * Process expired approvals.
 */
export async function processExpiredApprovals(): Promise<number> {
  const now = new Date();

  // Find pending requests that have expired
  const expired = await db
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.status, "pending"),
        lt(approvalRequests.expiresAt, now),
      ),
    );

  if (expired.length === 0) return 0;

  const _result = await db
    .update(approvalRequests)
    .set({ status: "expired" })
    .where(
      and(
        eq(approvalRequests.status, "pending"),
        lt(approvalRequests.expiresAt, now),
      ),
    );

  if (expired.length > 0) {
    logger.warn({ count: expired.length }, "Expired pending approval requests");
  }

  return expired.length;
}

/**
 * Start the expiration timer.
 */
export function startExpirationTimer(intervalMs = 60000): void {
  if (expirationTimer) return;

  expirationTimer = setInterval(() => {
    processExpiredApprovals().catch((err) => {
      logger.error({ err }, "Error processing expired approvals");
    });
  }, intervalMs);
}

/**
 * Stop the expiration timer.
 */
export function stopExpirationTimer(): void {
  if (expirationTimer) {
    clearInterval(expirationTimer);
    expirationTimer = null;
  }
}

// ============================================================================
// Waiting for Approval
// ============================================================================

/**
 * Wait for an approval decision.
 * Returns when the approval is decided or times out.
 */
export async function waitForApproval(
  requestId: string,
  options?: {
    pollIntervalMs?: number;
    timeoutMs?: number;
  },
): Promise<ApprovalRequest | undefined> {
  const pollInterval = options?.pollIntervalMs ?? 1000;
  const timeout = options?.timeoutMs ?? 30 * 60 * 1000; // 30 minutes
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const approval = await getApproval(requestId);

    if (!approval) {
      return undefined;
    }

    if (approval.status !== "pending") {
      return approval;
    }

    // Check if expired
    if (approval.expiresAt <= new Date()) {
      // It might not be updated in DB yet if cron hasn't run
      return approval;
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // Timeout - return current state (likely pending)
  return await getApproval(requestId);
}

// ============================================================================
// Escalation
// ============================================================================

/**
 * Escalation configuration.
 */
export interface EscalationConfig {
  enabled: boolean;
  thresholds: {
    pendingCount: number;
    waitTimeMinutes: number;
  };
  notifyEmails: string[];
  webhookUrl?: string;
}

/**
 * Check if escalation is needed.
 */
export async function checkEscalation(
  workspaceId: string,
  config: EscalationConfig,
): Promise<{
  shouldEscalate: boolean;
  reason?: string;
  pendingApprovals: ApprovalRequest[];
}> {
  if (!config.enabled) {
    return { shouldEscalate: false, pendingApprovals: [] };
  }

  const pending = await getPendingApprovals(workspaceId);
  const now = new Date();

  // Check for too many pending
  if (pending.length >= config.thresholds.pendingCount) {
    return {
      shouldEscalate: true,
      reason: `${pending.length} pending approvals (threshold: ${config.thresholds.pendingCount})`,
      pendingApprovals: pending,
    };
  }

  // Check for long-waiting approvals
  const longWaiting = pending.filter((a) => {
    const waitTimeMs = now.getTime() - a.requestedAt.getTime();
    return waitTimeMs >= config.thresholds.waitTimeMinutes * 60 * 1000;
  });

  if (longWaiting.length > 0) {
    return {
      shouldEscalate: true,
      reason: `${longWaiting.length} approval(s) waiting longer than ${config.thresholds.waitTimeMinutes} minutes`,
      pendingApprovals: longWaiting,
    };
  }

  return { shouldEscalate: false, pendingApprovals: [] };
}

// ============================================================================
// Testing Helpers
// ============================================================================

/**
 * Clear all approval data (for testing).
 */
export async function _clearAllApprovalData(): Promise<void> {
  await db.delete(approvalRequests);
  stopExpirationTimer();
}

/**
 * Get raw approvals array (for testing).
 */
export async function _getApprovals(): Promise<ApprovalRequest[]> {
  return listApprovals();
}

/**
 * Set approval expiration directly (for testing).
 */
export async function _setApprovalExpiration(
  requestId: string,
  expiresAt: Date,
): Promise<boolean> {
  const result = await db
    .update(approvalRequests)
    .set({ expiresAt })
    .where(eq(approvalRequests.id, requestId))
    .returning({ id: approvalRequests.id });
  return result.length > 0;
}
