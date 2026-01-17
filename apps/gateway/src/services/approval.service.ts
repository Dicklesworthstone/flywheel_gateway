/**
 * Approval Service.
 *
 * Manages approval workflows for operations that require human oversight.
 * Handles approval requests, decisions, timeouts, and escalation.
 */

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
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i]! % chars.length];
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

// ============================================================================
// In-Memory State
// ============================================================================

/** All approval requests */
const approvals: ApprovalRequest[] = [];
const MAX_APPROVALS = 10000;

/** Expiration check interval */
let expirationTimer: ReturnType<typeof setInterval> | null = null;

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

  const approval: ApprovalRequest = {
    id: generateId("appr"),
    agentId: request.agentId,
    sessionId: request.sessionId,
    workspaceId: request.workspaceId,
    operation: {
      type: request.operation.type,
      ...(request.operation.command && { command: request.operation.command }),
      ...(request.operation.path && { path: request.operation.path }),
      description: request.operation.description,
      details: request.operation.details ?? {},
    },
    rule: request.rule,
    context: {
      recentActions: request.context?.recentActions ?? [],
      ...(request.context?.taskDescription && {
        taskDescription: request.context.taskDescription,
      }),
    },
    status: "pending",
    requestedAt: now,
    expiresAt: new Date(now.getTime() + timeoutMinutes * 60 * 1000),
    priority: request.priority ?? "normal",
    ...(request.correlationId && { correlationId: request.correlationId }),
  };

  approvals.push(approval);

  // Trim old approvals if needed
  while (approvals.length > MAX_APPROVALS) {
    approvals.shift();
  }

  logger.info(
    {
      correlationId: approval.correlationId,
      approvalId: approval.id,
      agentId: approval.agentId,
      operation: approval.operation.type,
      priority: approval.priority,
      expiresAt: approval.expiresAt,
    },
    "Approval request created",
  );

  return approval;
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
  const approval = approvals.find((a) => a.id === decision.requestId);

  if (!approval) {
    return {
      success: false,
      error: "Approval request not found",
    };
  }

  if (approval.status !== "pending") {
    return {
      success: false,
      error: `Cannot decide on request with status: ${approval.status}`,
    };
  }

  // Check if expired
  if (approval.expiresAt < new Date()) {
    approval.status = "expired";
    return {
      success: false,
      error: "Approval request has expired",
    };
  }

  // Apply decision
  approval.status = decision.decision === "approved" ? "approved" : "denied";
  approval.decidedBy = decision.decidedBy;
  approval.decidedAt = new Date();
  if (decision.reason) {
    approval.decisionReason = decision.reason;
  }

  logger.info(
    {
      correlationId: approval.correlationId,
      approvalId: approval.id,
      decision: decision.decision,
      decidedBy: decision.decidedBy,
      reason: decision.reason,
    },
    "Approval decision made",
  );

  return {
    success: true,
    request: approval,
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
  const approval = approvals.find((a) => a.id === requestId);

  if (!approval) {
    return {
      success: false,
      error: "Approval request not found",
    };
  }

  if (approval.status !== "pending") {
    return {
      success: false,
      error: `Cannot cancel request with status: ${approval.status}`,
    };
  }

  approval.status = "cancelled";
  approval.decidedBy = cancelledBy;
  approval.decidedAt = new Date();
  approval.decisionReason = reason ?? "Cancelled by requestor";

  logger.info(
    {
      correlationId: approval.correlationId,
      approvalId: approval.id,
      cancelledBy,
      reason,
    },
    "Approval request cancelled",
  );

  return {
    success: true,
    request: approval,
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
  return approvals.find((a) => a.id === requestId);
}

/**
 * Get approval requests matching criteria.
 */
export async function listApprovals(
  options?: ListApprovalsOptions,
): Promise<ApprovalRequest[]> {
  let filtered = [...approvals];

  if (options?.workspaceId) {
    filtered = filtered.filter((a) => a.workspaceId === options.workspaceId);
  }
  if (options?.agentId) {
    filtered = filtered.filter((a) => a.agentId === options.agentId);
  }
  if (options?.sessionId) {
    filtered = filtered.filter((a) => a.sessionId === options.sessionId);
  }
  if (options?.status) {
    filtered = filtered.filter((a) => a.status === options.status);
  }
  if (options?.since) {
    const since = options.since;
    filtered = filtered.filter((a) => a.requestedAt >= since);
  }
  if (!options?.includeExpired) {
    filtered = filtered.filter(
      (a) => a.status !== "expired" || a.expiresAt > new Date(),
    );
  }

  // Sort by priority then by request time
  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
  filtered.sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return b.requestedAt.getTime() - a.requestedAt.getTime();
  });

  if (options?.limit) {
    filtered = filtered.slice(0, options.limit);
  }

  return filtered;
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
  const filtered = workspaceId
    ? approvals.filter((a) => a.workspaceId === workspaceId)
    : approvals;

  const stats: ApprovalStats = {
    pending: 0,
    approved: 0,
    denied: 0,
    expired: 0,
    cancelled: 0,
    averageDecisionTimeMs: 0,
    byPriority: {
      low: 0,
      normal: 0,
      high: 0,
      urgent: 0,
    },
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

  for (const approval of filtered) {
    stats[approval.status]++;
    const priorityCount = stats.byPriority[approval.priority];
    if (priorityCount !== undefined) {
      stats.byPriority[approval.priority] = priorityCount + 1;
    }
    stats.byCategory[approval.operation.type]++;

    if (approval.decidedAt) {
      totalDecisionTimeMs +=
        approval.decidedAt.getTime() - approval.requestedAt.getTime();
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
  let expiredCount = 0;

  for (const approval of approvals) {
    if (approval.status === "pending" && approval.expiresAt <= now) {
      approval.status = "expired";
      expiredCount++;

      logger.warn(
        {
          correlationId: approval.correlationId,
          approvalId: approval.id,
          agentId: approval.agentId,
          operation: approval.operation.type,
        },
        "Approval request expired",
      );
    }
  }

  return expiredCount;
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
      approval.status = "expired";
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
export function _clearAllApprovalData(): void {
  approvals.length = 0;
  stopExpirationTimer();
}

/**
 * Get raw approvals array (for testing).
 */
export function _getApprovals(): ApprovalRequest[] {
  return approvals;
}

/**
 * Set approval expiration directly (for testing).
 */
export function _setApprovalExpiration(
  requestId: string,
  expiresAt: Date,
): boolean {
  const approval = approvals.find((a) => a.id === requestId);
  if (approval) {
    approval.expiresAt = expiresAt;
    return true;
  }
  return false;
}
