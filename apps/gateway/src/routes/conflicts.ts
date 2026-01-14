/**
 * Conflict Routes - REST API endpoints for conflict detection and management.
 *
 * Provides endpoints for:
 * - Listing active conflicts and history
 * - Getting conflict details
 * - Resolving conflicts
 * - Triggering conflict detection scans
 * - Configuration management
 */

import type { ResourceIdentifier } from "@flywheel/shared/types";
import { Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import {
  type ConflictSeverity,
  type ConflictType,
  checkReservationConflicts,
  detectGitConflicts,
  detectPotentialGitConflicts,
  detectResourceContention,
  getActiveConflicts,
  getAlertConfig,
  getConflict,
  getConflictHistory,
  getConflictStats,
  getRecommendedActions,
  type ListActiveConflictsParams,
  type ListConflictHistoryParams,
  resolveConflict,
  updateAlertConfig,
} from "../services/conflict.service";
import {
  getAuditRecords,
  getAutoResolutionCriteria,
  invalidateSuggestion,
  requestResolution,
  updateAutoResolutionCriteria,
} from "../services/conflict-resolution.service";
import {
  sendError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const conflicts = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const _ConflictFilterSchema = z.object({
  type: z
    .array(
      z.enum([
        "reservation_overlap",
        "git_merge_conflict",
        "git_potential_conflict",
        "resource_contention",
        "deadlock_detected",
      ]),
    )
    .optional(),
  severity: z
    .array(z.enum(["info", "warning", "error", "critical"]))
    .optional(),
  projectId: z.string().optional(),
  agentId: z.string().optional(),
});

const ResolveConflictSchema = z.object({
  type: z.enum(["wait", "manual", "auto", "override", "abort"]),
  description: z.string().max(500),
  resolvedBy: z.string().optional(),
});

const CheckReservationSchema = z.object({
  projectId: z.string().min(1),
  requesterId: z.string().min(1),
  patterns: z.array(z.string()).min(1),
  exclusive: z.boolean().default(true),
});

const GitConflictScanSchema = z.object({
  projectId: z.string().min(1),
  workingDirectory: z.string().min(1),
  baseBranch: z.string().optional(),
  compareBranch: z.string().optional(),
});

const AlertConfigSchema = z.object({
  minSeverity: z.enum(["info", "warning", "error", "critical"]).optional(),
  cooldownMs: z.number().min(0).max(3600000).optional(),
  escalationTimeoutMs: z.number().min(0).max(86400000).optional(),
});

const ResolutionRequestSchema = z.object({
  requestingAgentId: z.string().min(1),
  requestingBvId: z.string().optional(),
  contestedResources: z
    .array(
      z.object({
        type: z.enum(["file", "directory", "pattern", "service", "lock"]),
        path: z.string(),
        critical: z.boolean().optional(),
        protected: z.boolean().optional(),
      }),
    )
    .min(1),
  urgencyOverride: z.enum(["normal", "high", "critical"]).optional(),
  preferredStrategies: z
    .array(z.enum(["wait", "split", "transfer", "coordinate", "escalate"]))
    .optional(),
  context: z.string().max(2000).optional(),
  projectId: z.string().min(1),
  holdingAgentId: z.string().optional(),
  holdingBvId: z.string().optional(),
});

const AutoResolutionCriteriaSchema = z.object({
  minConfidence: z.number().min(0).max(100).optional(),
  maxWaitTimeMs: z.number().min(0).max(86400000).optional(),
  disabledForCritical: z.boolean().optional(),
  requireBothAgentsEnabled: z.boolean().optional(),
  maxPriorFailedAttempts: z.number().min(0).max(10).optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /conflicts - List active conflicts
 */
conflicts.get("/", async (c) => {
  const query = c.req.query();

  // Build params conditionally (for exactOptionalPropertyTypes)
  const params: ListActiveConflictsParams = {};

  if (query["type"]) {
    params.type = query["type"].split(",") as ConflictType[];
  }
  if (query["severity"]) {
    params.severity = query["severity"].split(",") as ConflictSeverity[];
  }
  if (query["projectId"]) {
    params.projectId = query["projectId"];
  }
  if (query["agentId"]) {
    params.agentId = query["agentId"];
  }
  if (query["limit"]) {
    const limit = parseInt(query["limit"], 10);
    if (!Number.isNaN(limit)) params.limit = Math.min(limit, 100);
  }
  if (query["starting_after"]) {
    params.startingAfter = query["starting_after"];
  }
  if (query["ending_before"]) {
    params.endingBefore = query["ending_before"];
  }

  const result = getActiveConflicts(params);

  const transformedConflicts = result.conflicts.map((conflict) => ({
    id: conflict.id,
    type: conflict.type,
    severity: conflict.severity,
    projectId: conflict.projectId,
    involvedAgents: conflict.involvedAgents,
    affectedResources: conflict.affectedResources,
    detectedAt: conflict.detectedAt.toISOString(),
    recommendedActions: getRecommendedActions(conflict),
  }));

  // Build pagination meta conditionally (for exactOptionalPropertyTypes)
  const meta: { hasMore: boolean; nextCursor?: string; prevCursor?: string } = {
    hasMore: result.hasMore,
  };
  if (result.nextCursor) meta.nextCursor = result.nextCursor;
  if (result.prevCursor) meta.prevCursor = result.prevCursor;

  return sendList(c, transformedConflicts, meta);
});

/**
 * GET /conflicts/history - Get conflict history
 */
conflicts.get("/history", async (c) => {
  // Build params conditionally (for exactOptionalPropertyTypes)
  const params: ListConflictHistoryParams = {};

  const limitParam = c.req.query("limit");
  if (limitParam) {
    const limit = parseInt(limitParam, 10);
    if (!Number.isNaN(limit)) params.limit = Math.min(limit, 100);
  }

  const startingAfter = c.req.query("starting_after");
  if (startingAfter) params.startingAfter = startingAfter;

  const endingBefore = c.req.query("ending_before");
  if (endingBefore) params.endingBefore = endingBefore;

  const result = getConflictHistory(params);

  const transformedConflicts = result.conflicts.map((conflict) => ({
    id: conflict.id,
    type: conflict.type,
    severity: conflict.severity,
    projectId: conflict.projectId,
    involvedAgents: conflict.involvedAgents,
    affectedResources: conflict.affectedResources,
    detectedAt: conflict.detectedAt.toISOString(),
    resolvedAt: conflict.resolvedAt?.toISOString(),
    resolution: conflict.resolution
      ? {
          type: conflict.resolution.type,
          description: conflict.resolution.description,
          resolvedBy: conflict.resolution.resolvedBy,
          resolvedAt: conflict.resolution.resolvedAt.toISOString(),
        }
      : undefined,
  }));

  // Build pagination meta conditionally (for exactOptionalPropertyTypes)
  const meta: {
    total: number;
    hasMore: boolean;
    nextCursor?: string;
    prevCursor?: string;
  } = {
    total: result.total,
    hasMore: result.hasMore,
  };
  if (result.nextCursor) meta.nextCursor = result.nextCursor;
  if (result.prevCursor) meta.prevCursor = result.prevCursor;

  return sendList(c, transformedConflicts, meta);
});

/**
 * GET /conflicts/stats - Get conflict statistics
 */
conflicts.get("/stats", async (c) => {
  const stats = getConflictStats();

  return sendResource(c, "conflict_stats", stats);
});

/**
 * GET /conflicts/config - Get alert configuration
 * NOTE: Must be defined before /:conflictId to avoid route conflict
 */
conflicts.get("/config", async (c) => {
  const config = getAlertConfig();

  return sendResource(c, "alert_config", config);
});

/**
 * PATCH /conflicts/config - Update alert configuration
 * NOTE: Must be defined before /:conflictId to avoid route conflict
 */
conflicts.patch("/config", async (c) => {
  const log = getLogger();

  try {
    const body = await c.req.json();
    const validated = AlertConfigSchema.parse(body);

    // Build config update object, only including defined properties
    const configUpdate: Partial<{
      minSeverity: ConflictSeverity;
      cooldownMs: number;
      escalationTimeoutMs: number;
    }> = {};
    if (validated.minSeverity !== undefined) {
      configUpdate.minSeverity = validated.minSeverity;
    }
    if (validated.cooldownMs !== undefined) {
      configUpdate.cooldownMs = validated.cooldownMs;
    }
    if (validated.escalationTimeoutMs !== undefined) {
      configUpdate.escalationTimeoutMs = validated.escalationTimeoutMs;
    }

    const updated = updateAlertConfig(configUpdate);

    return sendResource(c, "alert_config", updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendValidationError(c, transformZodError(error));
    }
    log.error({ error }, "Error updating alert configuration");
    throw error;
  }
});

// ============================================================================
// Resolution Routes (must be before /:conflictId to avoid route conflicts)
// ============================================================================

/**
 * GET /conflicts/resolution/audit - Get resolution audit records
 * NOTE: Must be defined before /:conflictId to avoid route conflict
 */
conflicts.get("/resolution/audit", async (c) => {
  const limitParam = c.req.query("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 50;

  const records = getAuditRecords(Math.min(limit, 100));

  const transformedRecords = records.map((r) => ({
    id: r.id,
    correlationId: r.correlationId,
    conflictId: r.conflictId,
    suggestionId: r.suggestionId,
    recommendedStrategy: r.recommendedStrategy,
    appliedStrategy: r.appliedStrategy,
    confidence: r.confidence,
    autoResolved: r.autoResolved,
    inputSources: r.inputSources,
    processingTimeMs: r.processingTimeMs,
    timestamp: r.timestamp.toISOString(),
  }));

  return sendList(c, transformedRecords, { hasMore: records.length >= limit });
});

/**
 * GET /conflicts/resolution/config - Get auto-resolution criteria
 * NOTE: Must be defined before /:conflictId to avoid route conflict
 */
conflicts.get("/resolution/config", async (c) => {
  const criteria = getAutoResolutionCriteria();
  return sendResource(c, "auto_resolution_criteria", criteria);
});

/**
 * PATCH /conflicts/resolution/config - Update auto-resolution criteria
 * NOTE: Must be defined before /:conflictId to avoid route conflict
 */
conflicts.patch("/resolution/config", async (c) => {
  const log = getLogger();

  try {
    const body = await c.req.json();
    const validated = AutoResolutionCriteriaSchema.parse(body);

    // Build update object with only defined properties
    const update: Partial<{
      minConfidence: number;
      maxWaitTimeMs: number;
      disabledForCritical: boolean;
      requireBothAgentsEnabled: boolean;
      maxPriorFailedAttempts: number;
    }> = {};

    if (validated.minConfidence !== undefined) {
      update.minConfidence = validated.minConfidence;
    }
    if (validated.maxWaitTimeMs !== undefined) {
      update.maxWaitTimeMs = validated.maxWaitTimeMs;
    }
    if (validated.disabledForCritical !== undefined) {
      update.disabledForCritical = validated.disabledForCritical;
    }
    if (validated.requireBothAgentsEnabled !== undefined) {
      update.requireBothAgentsEnabled = validated.requireBothAgentsEnabled;
    }
    if (validated.maxPriorFailedAttempts !== undefined) {
      update.maxPriorFailedAttempts = validated.maxPriorFailedAttempts;
    }

    const updated = updateAutoResolutionCriteria(update);
    return sendResource(c, "auto_resolution_criteria", updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendValidationError(c, transformZodError(error));
    }
    log.error({ error }, "Error updating auto-resolution criteria");
    throw error;
  }
});

/**
 * GET /conflicts/:conflictId - Get conflict details
 */
conflicts.get("/:conflictId", async (c) => {
  const conflictId = c.req.param("conflictId");
  const conflict = getConflict(conflictId);

  if (!conflict) {
    return sendNotFound(c, "conflict", conflictId);
  }

  const transformedConflict = {
    id: conflict.id,
    type: conflict.type,
    severity: conflict.severity,
    projectId: conflict.projectId,
    involvedAgents: conflict.involvedAgents,
    affectedResources: conflict.affectedResources,
    detectedAt: conflict.detectedAt.toISOString(),
    resolvedAt: conflict.resolvedAt?.toISOString(),
    resolution: conflict.resolution
      ? {
          type: conflict.resolution.type,
          description: conflict.resolution.description,
          resolvedBy: conflict.resolution.resolvedBy,
          resolvedAt: conflict.resolution.resolvedAt.toISOString(),
        }
      : undefined,
    metadata: conflict.metadata,
    recommendedActions: getRecommendedActions(conflict),
  };

  return sendResource(c, "conflict", transformedConflict);
});

/**
 * POST /conflicts/:conflictId/resolve - Resolve a conflict
 */
conflicts.post("/:conflictId/resolve", async (c) => {
  const log = getLogger();
  const conflictId = c.req.param("conflictId");

  try {
    // First check if the conflict exists and its current state
    const existingConflict = getConflict(conflictId);
    if (!existingConflict) {
      return sendNotFound(c, "conflict", conflictId);
    }

    // Check if already resolved
    if (existingConflict.resolvedAt) {
      return sendError(
        c,
        "CONFLICT_ALREADY_RESOLVED",
        `Conflict ${conflictId} has already been resolved`,
        400,
        {
          hint: "This conflict was already resolved. Check the conflict history for details.",
          details: {
            resolvedAt: existingConflict.resolvedAt.toISOString(),
            resolution: existingConflict.resolution,
          },
        },
      );
    }

    const body = await c.req.json();
    const validated = ResolveConflictSchema.parse(body);

    // Build resolution object, only including resolvedBy if present
    const resolution: {
      type: typeof validated.type;
      description: string;
      resolvedBy?: string;
    } = {
      type: validated.type,
      description: validated.description,
    };
    if (validated.resolvedBy) {
      resolution.resolvedBy = validated.resolvedBy;
    }

    const resolved = resolveConflict(conflictId, resolution);

    if (!resolved) {
      // This shouldn't happen since we checked existence above,
      // but handle it just in case
      return sendNotFound(c, "conflict", conflictId);
    }

    const transformedResolution = {
      id: resolved.id,
      type: resolved.type,
      resolvedAt: resolved.resolvedAt?.toISOString(),
      resolution: {
        type: resolved.resolution?.type,
        description: resolved.resolution?.description,
        resolvedBy: resolved.resolution?.resolvedBy,
        resolvedAt: resolved.resolution?.resolvedAt.toISOString(),
      },
    };

    return sendResource(c, "conflict", transformedResolution, 200);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendValidationError(c, transformZodError(error));
    }
    log.error({ error, conflictId }, "Error resolving conflict");
    throw error;
  }
});

/**
 * POST /conflicts/check/reservation - Check for reservation conflicts
 */
conflicts.post("/check/reservation", async (c) => {
  const log = getLogger();

  try {
    const body = await c.req.json();
    const validated = CheckReservationSchema.parse(body);

    const result = checkReservationConflicts(
      validated.projectId,
      validated.requesterId,
      validated.patterns,
      validated.exclusive,
    );

    const checkResult = {
      hasConflicts: result.hasConflicts,
      canProceed: result.canProceed,
      conflicts: result.conflicts.map((conflict) => ({
        id: conflict.id,
        type: conflict.type,
        severity: conflict.severity,
        affectedResources: conflict.affectedResources,
        recommendedActions: getRecommendedActions(conflict),
      })),
    };

    return sendResource(c, "reservation_check", checkResult);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendValidationError(c, transformZodError(error));
    }
    log.error({ error }, "Error checking reservation conflicts");
    throw error;
  }
});

/**
 * POST /conflicts/scan/git - Scan for git conflicts
 */
conflicts.post("/scan/git", async (c) => {
  const log = getLogger();

  try {
    const body = await c.req.json();
    const validated = GitConflictScanSchema.parse(body);

    const conflicts: Array<{
      id: string;
      type: string;
      severity: string;
      affectedResources: string[];
    }> = [];

    // Check for actual merge conflicts
    const mergeConflicts = await detectGitConflicts(
      validated.projectId,
      validated.workingDirectory,
    );
    for (const conflict of mergeConflicts) {
      conflicts.push({
        id: conflict.id,
        type: conflict.type,
        severity: conflict.severity,
        affectedResources: conflict.affectedResources,
      });
    }

    // Check for potential conflicts if branches specified
    if (validated.baseBranch && validated.compareBranch) {
      const potentialConflicts = await detectPotentialGitConflicts(
        validated.projectId,
        validated.workingDirectory,
        validated.baseBranch,
        validated.compareBranch,
      );
      for (const conflict of potentialConflicts) {
        conflicts.push({
          id: conflict.id,
          type: conflict.type,
          severity: conflict.severity,
          affectedResources: conflict.affectedResources,
        });
      }
    }

    const scanResult = {
      scanned: true,
      projectId: validated.projectId,
      conflictsFound: conflicts.length,
      conflicts,
    };

    return sendResource(c, "git_scan_result", scanResult);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendValidationError(c, transformZodError(error));
    }
    log.error({ error }, "Error scanning for git conflicts");
    throw error;
  }
});

/**
 * POST /conflicts/scan/contention - Check for resource contention
 */
conflicts.post("/scan/contention", async (c) => {
  const log = getLogger();

  try {
    const body = await c.req.json().catch(() => ({}));
    const projectId = body.projectId;
    const windowMs = body.windowMs ?? 5000;

    if (!projectId || typeof projectId !== "string") {
      return sendError(c, "INVALID_REQUEST", "projectId is required", 400);
    }

    const contentionConflicts = detectResourceContention(projectId, windowMs);

    const scanResult = {
      scanned: true,
      projectId,
      windowMs,
      conflictsFound: contentionConflicts.length,
      conflicts: contentionConflicts.map((conflict) => ({
        id: conflict.id,
        type: conflict.type,
        severity: conflict.severity,
        involvedAgents: conflict.involvedAgents,
        affectedResources: conflict.affectedResources,
      })),
    };

    return sendResource(c, "contention_scan_result", scanResult);
  } catch (error) {
    log.error({ error }, "Error scanning for resource contention");
    throw error;
  }
});

// ============================================================================
// Resolution Routes
// ============================================================================

/**
 * POST /conflicts/:conflictId/suggest - Request resolution suggestion
 */
conflicts.post("/:conflictId/suggest", async (c) => {
  const log = getLogger();
  const conflictId = c.req.param("conflictId");

  try {
    // Check if conflict exists
    const existingConflict = getConflict(conflictId);
    if (!existingConflict) {
      return sendNotFound(c, "conflict", conflictId);
    }

    // Check if already resolved
    if (existingConflict.resolvedAt) {
      return sendError(
        c,
        "CONFLICT_ALREADY_RESOLVED",
        `Conflict ${conflictId} has already been resolved`,
        400,
        {
          hint: "Cannot suggest resolution for an already resolved conflict.",
        },
      );
    }

    const body = await c.req.json();
    const validated = ResolutionRequestSchema.parse(body);

    const result = await requestResolution({
      conflictId,
      requestingAgentId: validated.requestingAgentId,
      projectId: validated.projectId,
      contestedResources: validated.contestedResources as ResourceIdentifier[],
      ...(validated.requestingBvId && {
        requestingBvId: validated.requestingBvId,
      }),
      ...(validated.urgencyOverride && {
        urgencyOverride: validated.urgencyOverride,
      }),
      ...(validated.preferredStrategies && {
        preferredStrategies: validated.preferredStrategies,
      }),
      ...(validated.context && { context: validated.context }),
      ...(validated.holdingAgentId && {
        holdingAgentId: validated.holdingAgentId,
      }),
      ...(validated.holdingBvId && { holdingBvId: validated.holdingBvId }),
    });

    if (!result.success) {
      return sendError(
        c,
        "RESOLUTION_FAILED",
        result.error ?? "Failed to generate resolution suggestion",
        500,
      );
    }

    const suggestion = result.suggestion!;

    // Transform dates to ISO strings
    const transformedSuggestion = {
      suggestionId: suggestion.suggestionId,
      conflictId: suggestion.conflictId,
      recommendedStrategy: {
        type: suggestion.recommendedStrategy.type,
        score: suggestion.recommendedStrategy.score,
        params: suggestion.recommendedStrategy.params,
        expectedOutcome: suggestion.recommendedStrategy.expectedOutcome,
      },
      alternativeStrategies: suggestion.alternativeStrategies.map((s) => ({
        type: s.type,
        score: s.score,
      })),
      confidence: suggestion.confidence,
      confidenceBreakdown: suggestion.confidenceBreakdown,
      rationale: suggestion.rationale,
      autoResolutionEligible: suggestion.autoResolutionEligible,
      estimatedResolutionTime: suggestion.estimatedResolutionTime,
      risks: suggestion.risks,
      createdAt: suggestion.createdAt.toISOString(),
      expiresAt: suggestion.expiresAt.toISOString(),
    };

    return sendResource(c, "resolution_suggestion", transformedSuggestion, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendValidationError(c, transformZodError(error));
    }
    log.error({ error, conflictId }, "Error requesting resolution suggestion");
    throw error;
  }
});

/**
 * DELETE /conflicts/:conflictId/suggestion - Invalidate cached suggestion
 */
conflicts.delete("/:conflictId/suggestion", async (c) => {
  const conflictId = c.req.param("conflictId");

  // Check if conflict exists
  const existingConflict = getConflict(conflictId);
  if (!existingConflict) {
    return sendNotFound(c, "conflict", conflictId);
  }

  invalidateSuggestion(conflictId);

  return c.json({ success: true, message: "Suggestion cache invalidated" });
});

export { conflicts };
