/**
 * Handoff Routes - REST API endpoints for session handoff protocol.
 */

import type {
  HandoffPreferences,
  HandoffReason,
  HandoffUrgency,
} from "@flywheel/shared/types";
import { Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import {
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
import {
  type BuildContextParams,
  buildContext,
  calculateContextSize,
} from "../services/handoff-context.service";
import {
  buildResourceManifest,
  transferResources,
} from "../services/handoff-transfer.service";
import {
  sendCreated,
  sendError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { stripUndefined, transformZodError } from "../utils/validation";

export const handoffs = new Hono();

// ============================================================================
// Static Routes (must be defined before parameterized routes)
// ============================================================================

/**
 * GET /handoffs/stats
 * Get handoff statistics.
 */
handoffs.get("/stats", async (c) => {
  const stats = getHandoffStats();

  return sendResource(c, "handoff_stats", {
    totalHandoffs: stats.totalHandoffs,
    completedHandoffs: stats.completedHandoffs,
    failedHandoffs: stats.failedHandoffs,
    cancelledHandoffs: stats.cancelledHandoffs,
    averageTransferTimeMs: Math.round(stats.averageTransferTimeMs),
    byReason: stats.byReason,
    byUrgency: stats.byUrgency,
  });
});

/**
 * POST /handoffs/validate-context
 * Validate a context object without initiating a handoff.
 */
handoffs.post("/validate-context", async (c) => {
  try {
    const body = await c.req.json();
    const contextData = HandoffContextSchema.parse(body);

    const { context: _context, validation } = buildContext({
      agentId: "validation-check",
      taskDescription: contextData.taskDescription,
      ...(contextData.currentPhase && {
        currentPhase: contextData.currentPhase,
      }),
      ...(contextData.progressPercentage !== undefined && {
        progressPercentage: contextData.progressPercentage,
      }),
      ...(contextData.filesModified && {
        filesModified: contextData.filesModified,
      }),
      ...(contextData.filesCreated && {
        filesCreated: contextData.filesCreated,
      }),
      ...(contextData.filesDeleted && {
        filesDeleted: contextData.filesDeleted,
      }),
      ...(contextData.uncommittedChanges && {
        uncommittedChanges: contextData.uncommittedChanges,
      }),
      ...(contextData.todoItems && { todoItems: contextData.todoItems }),
      ...(contextData.hypotheses && { hypotheses: contextData.hypotheses }),
      ...(contextData.keyPoints && { keyPoints: contextData.keyPoints }),
      ...(contextData.userRequirements && {
        userRequirements: contextData.userRequirements,
      }),
      ...(contextData.constraints && { constraints: contextData.constraints }),
    } as BuildContextParams);

    return sendResource(c, "context_validation", {
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      sizeBytes: validation.sizeBytes,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendValidationError(c, transformZodError(error));
    }
    return sendError(c, "INTERNAL_ERROR", "Failed to validate context", 500);
  }
});

// ============================================================================
// Validation Schemas
// ============================================================================

const HandoffReasonSchema = z.enum([
  "session_limit",
  "specialization_needed",
  "agent_unavailable",
  "load_balancing",
  "user_requested",
  "error_recovery",
]);

const HandoffUrgencySchema = z.enum(["low", "normal", "high", "critical"]);

const HandoffPhaseSchema = z.enum([
  "initiate",
  "pending",
  "transfer",
  "complete",
  "rejected",
  "failed",
  "cancelled",
]);

/**
 * Parse and validate phase query parameter.
 * Returns undefined if not provided or invalid.
 */
function parsePhaseParam(
  phase: string | undefined,
): z.infer<typeof HandoffPhaseSchema> | undefined {
  if (!phase) return undefined;
  const result = HandoffPhaseSchema.safeParse(phase);
  return result.success ? result.data : undefined;
}

const TaskPhaseSchema = z.enum([
  "not_started",
  "planning",
  "implementing",
  "testing",
  "reviewing",
  "completing",
]);

const FileModificationSchema = z.object({
  path: z.string().min(1),
  originalHash: z.string(),
  currentHash: z.string(),
  changeDescription: z.string(),
});

const UncommittedChangeSchema = z.object({
  path: z.string().min(1),
  diff: z.string(),
  reason: z.string(),
});

const DecisionSchema = z.object({
  timestamp: z.string().datetime().or(z.date()),
  decision: z.string().min(1),
  reasoning: z.string(),
  alternatives: z.array(z.string()),
  outcome: z.string().optional(),
});

const HypothesisSchema = z.object({
  hypothesis: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
});

const TodoItemSchema = z.object({
  task: z.string().min(1),
  priority: z.number().int().min(0).max(10),
  status: z.enum(["pending", "in_progress", "blocked"]),
  blockedBy: z.string().optional(),
});

const EnvironmentSnapshotSchema = z.object({
  workingDirectory: z.string(),
  gitBranch: z.string(),
  gitCommit: z.string(),
  uncommittedFiles: z.array(z.string()),
  envVars: z.record(z.string(), z.string()),
});

const HandoffContextSchema = z.object({
  beadId: z.string().optional(),
  taskDescription: z.string().min(1),
  currentPhase: TaskPhaseSchema.optional(),
  progressPercentage: z.number().min(0).max(100).optional(),
  startedAt: z.string().datetime().or(z.date()).optional(),
  filesModified: z.array(FileModificationSchema).optional(),
  filesCreated: z.array(z.string()).optional(),
  filesDeleted: z.array(z.string()).optional(),
  uncommittedChanges: z.array(UncommittedChangeSchema).optional(),
  decisionsMade: z.array(DecisionSchema).optional(),
  conversationSummary: z.string().optional(),
  keyPoints: z.array(z.string()).optional(),
  userRequirements: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
  workingMemory: z.record(z.string(), z.unknown()).optional(),
  hypotheses: z.array(HypothesisSchema).optional(),
  todoItems: z.array(TodoItemSchema).optional(),
  environmentSnapshot: EnvironmentSnapshotSchema.optional(),
});

const HandoffPreferencesSchema = z.object({
  requireAcknowledgment: z.boolean().optional(),
  allowPartialTransfer: z.boolean().optional(),
  timeoutMs: z.number().min(1000).max(1800000).optional(),
  fallbackBehavior: z
    .enum(["retry", "broadcast", "escalate", "abort"])
    .optional(),
  priorityAgents: z.array(z.string()).optional(),
});

const InitiateHandoffSchema = z.object({
  sourceAgentId: z.string().min(1),
  targetAgentId: z.string().min(1).nullable().optional(),
  projectId: z.string().min(1),
  beadId: z.string().optional(),
  reason: HandoffReasonSchema,
  urgency: HandoffUrgencySchema.optional(),
  context: HandoffContextSchema,
  preferences: HandoffPreferencesSchema.optional(),
});

const AcceptHandoffSchema = z.object({
  receivingAgentId: z.string().min(1),
  estimatedResumeTime: z.string().datetime().optional(),
  receiverNotes: z.string().optional(),
});

const RejectHandoffSchema = z.object({
  receivingAgentId: z.string().min(1),
  reason: z.string().min(1),
  suggestedAlternative: z.string().optional(),
});

const CancelHandoffSchema = z.object({
  agentId: z.string().min(1),
  reason: z.string().optional(),
});

const _FailHandoffSchema = z.object({
  errorCode: z.string().min(1),
  errorMessage: z.string().min(1),
  recoverable: z.boolean(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /handoffs
 * Initiate a new handoff.
 */
handoffs.post("/", async (c) => {
  const log = getLogger();

  try {
    const body = await c.req.json();
    const data = InitiateHandoffSchema.parse(body);

    // Build full context from provided data
    const { context: builtContext, validation } = buildContext({
      agentId: data.sourceAgentId,
      taskDescription: data.context.taskDescription,
      ...(data.beadId && { beadId: data.beadId }),
      ...(data.context.currentPhase && {
        currentPhase: data.context.currentPhase,
      }),
      ...(data.context.progressPercentage !== undefined && {
        progressPercentage: data.context.progressPercentage,
      }),
      ...(data.context.startedAt && {
        startedAt: new Date(data.context.startedAt as string),
      }),
      ...(data.context.filesModified && {
        filesModified: data.context.filesModified,
      }),
      ...(data.context.filesCreated && {
        filesCreated: data.context.filesCreated,
      }),
      ...(data.context.filesDeleted && {
        filesDeleted: data.context.filesDeleted,
      }),
      ...(data.context.uncommittedChanges && {
        uncommittedChanges: data.context.uncommittedChanges,
      }),
      ...(data.context.decisionsMade && {
        decisionsMade: data.context.decisionsMade.map((d) => ({
          ...d,
          timestamp: new Date(d.timestamp as string),
        })),
      }),
      ...(data.context.todoItems && { todoItems: data.context.todoItems }),
      ...(data.context.workingMemory && {
        workingMemory: data.context.workingMemory as Record<string, string>,
      }),
      ...(data.context.hypotheses && { hypotheses: data.context.hypotheses }),
      ...(data.context.keyPoints && { keyPoints: data.context.keyPoints }),
      ...(data.context.userRequirements && {
        userRequirements: data.context.userRequirements,
      }),
      ...(data.context.constraints && {
        constraints: data.context.constraints,
      }),
      ...(data.context.environmentSnapshot?.workingDirectory && {
        workingDirectory: data.context.environmentSnapshot.workingDirectory,
      }),
      ...(data.context.environmentSnapshot?.gitBranch && {
        gitBranch: data.context.environmentSnapshot.gitBranch,
      }),
      ...(data.context.environmentSnapshot?.gitCommit && {
        gitCommit: data.context.environmentSnapshot.gitCommit,
      }),
      ...(data.context.environmentSnapshot?.uncommittedFiles && {
        uncommittedFiles: data.context.environmentSnapshot.uncommittedFiles,
      }),
      ...(data.context.environmentSnapshot?.envVars && {
        envVars: data.context.environmentSnapshot.envVars,
      }),
    } as BuildContextParams);

    if (!validation.valid) {
      return sendError(
        c,
        "INVALID_CONTEXT",
        `Context validation failed: ${validation.errors.join(", ")}`,
        400,
      );
    }

    // Build resource manifest
    const resourceManifest = await buildResourceManifest(
      data.projectId,
      data.sourceAgentId,
    );

    // Initiate the handoff
    const result = await initiateHandoff({
      sourceAgentId: data.sourceAgentId,
      targetAgentId: data.targetAgentId ?? null,
      projectId: data.projectId,
      reason: data.reason as HandoffReason,
      context: builtContext,
      resourceManifest,
      ...(data.beadId && { beadId: data.beadId }),
      ...(data.urgency && { urgency: data.urgency as HandoffUrgency }),
      ...(data.preferences && {
        preferences: data.preferences as Partial<HandoffPreferences>,
      }),
    });

    if (!result.success) {
      return sendError(
        c,
        "HANDOFF_FAILED",
        result.error ?? "Unknown error",
        400,
      );
    }

    log.info({ handoffId: result.handoffId }, "Handoff initiated");

    return sendCreated(
      c,
      "handoff",
      {
        handoffId: result.handoffId,
        phase: result.phase,
        expiresAt: result.expiresAt?.toISOString(),
        contextValidation: {
          sizeBytes: validation.sizeBytes,
          warnings: validation.warnings,
        },
        resourceManifest: {
          reservations: resourceManifest.fileReservations.length,
          checkpoints: resourceManifest.checkpoints.length,
          messages: resourceManifest.pendingMessages.length,
          subscriptions: resourceManifest.activeSubscriptions.length,
        },
      },
      `/handoffs/${result.handoffId}`,
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendValidationError(c, transformZodError(error));
    }
    log.error({ error }, "Failed to initiate handoff");
    return sendError(c, "INTERNAL_ERROR", "Failed to initiate handoff", 500);
  }
});

/**
 * GET /handoffs/:handoffId
 * Get handoff details.
 */
handoffs.get("/:handoffId", async (c) => {
  const handoffId = c.req.param("handoffId");
  const handoff = getHandoff(handoffId);

  if (!handoff) {
    return sendNotFound(c, "handoff", handoffId);
  }

  return sendResource(c, "handoff", {
    id: handoff.id,
    phase: handoff.phase,
    sourceAgentId: handoff.request.sourceAgentId,
    targetAgentId: handoff.request.targetAgentId,
    projectId: handoff.request.projectId,
    beadId: handoff.request.beadId,
    reason: handoff.request.reason,
    urgency: handoff.request.urgency,
    expiresAt: handoff.request.expiresAt.toISOString(),
    createdAt: handoff.createdAt.toISOString(),
    updatedAt: handoff.updatedAt.toISOString(),
    completedAt: handoff.completedAt?.toISOString(),
    acknowledgment: handoff.acknowledgment,
    transferProgress: handoff.transferProgress,
    error: handoff.error,
    auditTrailCount: handoff.auditTrail.length,
  });
});

/**
 * GET /handoffs/:handoffId/context
 * Get handoff context.
 */
handoffs.get("/:handoffId/context", async (c) => {
  const handoffId = c.req.param("handoffId");
  const handoff = getHandoff(handoffId);

  if (!handoff) {
    return sendNotFound(c, "handoff", handoffId);
  }

  return sendResource(c, "handoff_context", {
    handoffId,
    context: handoff.request.context,
    sizeBytes: calculateContextSize(handoff.request.context),
  });
});

/**
 * GET /handoffs/:handoffId/audit
 * Get handoff audit trail.
 */
handoffs.get("/:handoffId/audit", async (c) => {
  const handoffId = c.req.param("handoffId");
  const handoff = getHandoff(handoffId);

  if (!handoff) {
    return sendNotFound(c, "handoff", handoffId);
  }

  return sendList(
    c,
    handoff.auditTrail.map((entry) => ({
      timestamp: entry.timestamp.toISOString(),
      event: entry.event,
      details: entry.details,
    })),
  );
});

/**
 * POST /handoffs/:handoffId/accept
 * Accept a handoff.
 */
handoffs.post("/:handoffId/accept", async (c) => {
  const log = getLogger();
  const handoffId = c.req.param("handoffId");

  try {
    const body = await c.req.json();
    const data = AcceptHandoffSchema.parse(body);

    const result = await acceptHandoff(
      stripUndefined({
        handoffId,
        receivingAgentId: data.receivingAgentId,
        ...(data.estimatedResumeTime && {
          estimatedResumeTime: new Date(data.estimatedResumeTime),
        }),
        ...(data.receiverNotes && { receiverNotes: data.receiverNotes }),
      }),
    );

    if (!result.success) {
      return sendError(
        c,
        "HANDOFF_ACCEPT_FAILED",
        result.error ?? "Unknown error",
        400,
      );
    }

    // Get the handoff to transfer resources
    const handoff = getHandoff(handoffId);
    if (handoff && handoff.phase === "transfer") {
      // Initiate resource transfer
      const transferResult = await transferResources(handoff);

      if (transferResult.success) {
        // Complete the handoff
        await completeHandoff({
          handoffId,
          transferSummary: {
            filesModified: handoff.request.context.filesModified.length,
            reservationsTransferred:
              handoff.request.resourceManifest.fileReservations.length,
            checkpointsTransferred:
              handoff.request.resourceManifest.checkpoints.length,
            messagesForwarded:
              handoff.request.resourceManifest.pendingMessages.length,
          },
        });
      } else {
        // Fail the handoff
        await failHandoff({
          handoffId,
          errorCode: "TRANSFER_FAILED",
          errorMessage: transferResult.error ?? "Resource transfer failed",
          recoverable: true,
        });
      }
    }

    log.info(
      { handoffId, receivingAgentId: data.receivingAgentId },
      "Handoff accepted",
    );

    return sendResource(c, "handoff_acceptance", {
      handoffId,
      phase: result.phase,
      accepted: true,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendValidationError(c, transformZodError(error));
    }
    log.error({ error, handoffId }, "Failed to accept handoff");
    return sendError(c, "INTERNAL_ERROR", "Failed to accept handoff", 500);
  }
});

/**
 * POST /handoffs/:handoffId/reject
 * Reject a handoff.
 */
handoffs.post("/:handoffId/reject", async (c) => {
  const log = getLogger();
  const handoffId = c.req.param("handoffId");

  try {
    const body = await c.req.json();
    const data = RejectHandoffSchema.parse(body);

    const result = await rejectHandoff(
      stripUndefined({
        handoffId,
        receivingAgentId: data.receivingAgentId,
        reason: data.reason,
        ...(data.suggestedAlternative && {
          suggestedAlternative: data.suggestedAlternative,
        }),
      }),
    );

    if (!result.success) {
      return sendError(
        c,
        "HANDOFF_REJECT_FAILED",
        result.error ?? "Unknown error",
        400,
      );
    }

    log.info({ handoffId, reason: data.reason }, "Handoff rejected");

    return sendResource(c, "handoff_rejection", {
      handoffId,
      phase: result.phase,
      rejected: true,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendValidationError(c, transformZodError(error));
    }
    log.error({ error, handoffId }, "Failed to reject handoff");
    return sendError(c, "INTERNAL_ERROR", "Failed to reject handoff", 500);
  }
});

/**
 * POST /handoffs/:handoffId/cancel
 * Cancel a handoff.
 */
handoffs.post("/:handoffId/cancel", async (c) => {
  const log = getLogger();
  const handoffId = c.req.param("handoffId");

  try {
    const body = await c.req.json();
    const data = CancelHandoffSchema.parse(body);

    const result = await cancelHandoff(
      stripUndefined({
        handoffId,
        agentId: data.agentId,
        ...(data.reason && { reason: data.reason }),
      }),
    );

    if (!result.success) {
      return sendError(
        c,
        "HANDOFF_CANCEL_FAILED",
        result.error ?? "Unknown error",
        400,
      );
    }

    log.info({ handoffId, agentId: data.agentId }, "Handoff cancelled");

    return sendResource(c, "handoff_cancellation", {
      handoffId,
      phase: result.phase,
      cancelled: true,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendValidationError(c, transformZodError(error));
    }
    log.error({ error, handoffId }, "Failed to cancel handoff");
    return sendError(c, "INTERNAL_ERROR", "Failed to cancel handoff", 500);
  }
});

/**
 * GET /handoffs/source/:agentId
 * List handoffs initiated by an agent.
 */
handoffs.get("/source/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const phaseParam = c.req.query("phase");
  const parsedLimit = parseInt(c.req.query("limit") ?? "50", 10);
  const limit = Number.isNaN(parsedLimit) ? 50 : parsedLimit;
  const phase = parsePhaseParam(phaseParam);

  const handoffsList = listHandoffsForSource(
    agentId,
    stripUndefined({
      ...(phase && { phase }),
      limit: Math.min(limit, 100),
    }),
  );

  return sendList(
    c,
    handoffsList.map((h) => ({
      id: h.id,
      phase: h.phase,
      targetAgentId: h.request.targetAgentId,
      projectId: h.request.projectId,
      reason: h.request.reason,
      urgency: h.request.urgency,
      expiresAt: h.request.expiresAt.toISOString(),
      createdAt: h.createdAt.toISOString(),
    })),
  );
});

/**
 * GET /handoffs/target/:agentId
 * List handoffs targeting an agent.
 */
handoffs.get("/target/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const phaseParam = c.req.query("phase");
  const parsedLimit = parseInt(c.req.query("limit") ?? "50", 10);
  const limit = Number.isNaN(parsedLimit) ? 50 : parsedLimit;
  const phase = parsePhaseParam(phaseParam);

  const handoffsList = listHandoffsForTarget(
    agentId,
    stripUndefined({
      ...(phase && { phase }),
      limit: Math.min(limit, 100),
    }),
  );

  return sendList(
    c,
    handoffsList.map((h) => ({
      id: h.id,
      phase: h.phase,
      sourceAgentId: h.request.sourceAgentId,
      projectId: h.request.projectId,
      reason: h.request.reason,
      urgency: h.request.urgency,
      expiresAt: h.request.expiresAt.toISOString(),
      createdAt: h.createdAt.toISOString(),
    })),
  );
});

/**
 * GET /handoffs/broadcast/:projectId
 * List broadcast handoffs available for any agent.
 */
handoffs.get("/broadcast/:projectId", async (c) => {
  const projectId = c.req.param("projectId");

  const handoffsList = listBroadcastHandoffs(projectId);

  return sendList(
    c,
    handoffsList.map((h) => ({
      id: h.id,
      phase: h.phase,
      sourceAgentId: h.request.sourceAgentId,
      beadId: h.request.beadId,
      reason: h.request.reason,
      urgency: h.request.urgency,
      taskDescription: h.request.context.taskDescription,
      expiresAt: h.request.expiresAt.toISOString(),
      createdAt: h.createdAt.toISOString(),
    })),
  );
});
