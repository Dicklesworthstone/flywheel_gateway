/**
 * RU Routes - REST API endpoints for Repo Updater operations.
 *
 * Provides endpoints for:
 * - Fleet management (repos in the fleet)
 * - Agent sweep operations (three-phase maintenance)
 * - Plan management (approve/reject sweep plans)
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  type AddRepoParams,
  type FleetRepo,
  type ListReposOptions,
  type RepoStatus,
  type UpdateRepoParams,
  addRepoToFleet,
  getFleetGroups,
  getFleetRepo,
  getFleetRepoByFullName,
  getFleetRepos,
  getFleetStats,
  getReposByGroup,
  getReposNeedingSync,
  getReposWithUncommittedChanges,
  getReposWithUnpushedCommits,
  removeRepoFromFleet,
  updateFleetRepo,
} from "../services/ru-fleet.service";
import {
  createExceptionsForPlan,
  getSweepDCGSummary,
  validateSweepPlan,
  validateSweepSession,
} from "../services/dcg-ru-integration.service";
import {
  type PlanApprovalStatus,
  type PlanExecutionStatus,
  type SweepConfig,
  type SweepStatus,
  approveSweepPlan,
  approveSweepSession,
  cancelSweepSession,
  getSweepLogs,
  getSweepPlan,
  getSweepPlans,
  getSweepSession,
  listSweepSessions,
  rejectSweepPlan,
  startAgentSweep,
} from "../services/ru-sweep.service";
import {
  sendConflict,
  sendCreated,
  sendError,
  sendInternalError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const ru = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const RepoStatusSchema = z.enum([
  "healthy",
  "dirty",
  "behind",
  "ahead",
  "diverged",
  "unknown",
]);

const AddRepoSchema = z.object({
  owner: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  url: z.string().url(),
  sshUrl: z.string().optional(),
  group: z.string().max(50).optional(),
  description: z.string().max(500).optional(),
  language: z.string().max(50).optional(),
  isPrivate: z.boolean().optional(),
});

const UpdateRepoSchema = z.object({
  localPath: z.string().optional(),
  isCloned: z.boolean().optional(),
  currentBranch: z.string().optional(),
  defaultBranch: z.string().optional(),
  lastCommit: z.string().optional(),
  lastCommitDate: z.coerce.date().optional(),
  lastCommitAuthor: z.string().optional(),
  status: RepoStatusSchema.optional(),
  hasUncommittedChanges: z.boolean().optional(),
  hasUnpushedCommits: z.boolean().optional(),
  aheadBy: z.number().int().min(0).optional(),
  behindBy: z.number().int().min(0).optional(),
  description: z.string().max(500).optional(),
  language: z.string().max(50).optional(),
  stars: z.number().int().min(0).optional(),
  isPrivate: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  ruGroup: z.string().max(50).optional(),
  ruConfig: z.unknown().optional(),
  agentsmdPath: z.string().optional(),
  lastScanDate: z.coerce.date().optional(),
  lastSyncAt: z.coerce.date().optional(),
});

const ListReposQuerySchema = z.object({
  status: RepoStatusSchema.optional(),
  group: z.string().optional(),
  owner: z.string().optional(),
  isCloned: z
    .string()
    .transform((v) => v === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const StartSweepSchema = z.object({
  targetRepos: z.union([z.array(z.string().min(1)), z.literal("*")]),
  parallelism: z.number().int().min(1).max(10).optional(),
  dryRun: z.boolean().optional(),
  autoApprove: z.boolean().optional(),
  phase1Timeout: z.number().int().min(30).max(3600).optional(),
  phase2Timeout: z.number().int().min(30).max(3600).optional(),
  phase3Timeout: z.number().int().min(30).max(3600).optional(),
});

const ListSweepsQuerySchema = z.object({
  status: z
    .enum(["pending", "running", "paused", "completed", "failed", "cancelled"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const ListPlansQuerySchema = z.object({
  approvalStatus: z
    .enum(["pending", "approved", "rejected", "auto_approved"])
    .optional(),
  executionStatus: z
    .enum(["pending", "running", "completed", "failed", "skipped"])
    .optional(),
});

const ListLogsQuerySchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).optional(),
  phase: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const ApproveSessionSchema = z.object({
  approvedBy: z.string().min(1).max(100),
});

const ApprovePlanSchema = z.object({
  approvedBy: z.string().min(1).max(100),
});

const RejectPlanSchema = z.object({
  rejectedBy: z.string().min(1).max(100),
  reason: z.string().min(1).max(500),
});

// ============================================================================
// Error Handler
// ============================================================================

function handleError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof z.ZodError) {
    return sendValidationError(c, transformZodError(error));
  }

  if (error instanceof Error && error.message.includes("not found")) {
    return sendError(c, "NOT_FOUND", error.message, 404);
  }

  if (error instanceof Error && error.message.includes("not in pending")) {
    return sendConflict(c, "INVALID_STATE", error.message);
  }

  log.error({ error }, "Unexpected error in RU route");
  return sendInternalError(c);
}

// ============================================================================
// Fleet Repository Serialization
// ============================================================================

function serializeRepo(repo: FleetRepo) {
  return {
    id: repo.id,
    owner: repo.owner,
    name: repo.name,
    fullName: repo.fullName,
    url: repo.url,
    sshUrl: repo.sshUrl,
    localPath: repo.localPath,
    isCloned: repo.isCloned,
    currentBranch: repo.currentBranch,
    defaultBranch: repo.defaultBranch,
    lastCommit: repo.lastCommit,
    lastCommitDate: repo.lastCommitDate?.toISOString?.() ?? repo.lastCommitDate,
    lastCommitAuthor: repo.lastCommitAuthor,
    status: repo.status,
    hasUncommittedChanges: repo.hasUncommittedChanges,
    hasUnpushedCommits: repo.hasUnpushedCommits,
    aheadBy: repo.aheadBy,
    behindBy: repo.behindBy,
    description: repo.description,
    language: repo.language,
    stars: repo.stars,
    isPrivate: repo.isPrivate,
    isArchived: repo.isArchived,
    ruGroup: repo.ruGroup,
    ruConfig: repo.ruConfig,
    agentsmdPath: repo.agentsmdPath,
    lastScanDate: repo.lastScanDate?.toISOString?.() ?? repo.lastScanDate,
    addedAt: repo.addedAt?.toISOString?.() ?? repo.addedAt,
    updatedAt: repo.updatedAt?.toISOString?.() ?? repo.updatedAt,
    lastSyncAt: repo.lastSyncAt?.toISOString?.() ?? repo.lastSyncAt,
  };
}

// ============================================================================
// FLEET ROUTES
// ============================================================================

/**
 * GET /ru/fleet - List fleet repositories
 */
ru.get("/fleet", async (c) => {
  try {
    const query = ListReposQuerySchema.parse({
      status: c.req.query("status"),
      group: c.req.query("group"),
      owner: c.req.query("owner"),
      isCloned: c.req.query("isCloned"),
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    });

    const params: ListReposOptions = {};
    if (query.status !== undefined) params.status = query.status as RepoStatus;
    if (query.group !== undefined) params.group = query.group;
    if (query.owner !== undefined) params.owner = query.owner;
    if (query.isCloned !== undefined) params.isCloned = query.isCloned;
    if (query.limit !== undefined) params.limit = query.limit;
    if (query.offset !== undefined) params.offset = query.offset;

    const { repos, total } = await getFleetRepos(params);

    return sendList(c, repos.map(serializeRepo), { total });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /ru/fleet/stats - Get fleet statistics
 */
ru.get("/fleet/stats", async (c) => {
  try {
    const stats = await getFleetStats();
    return sendResource(c, "fleet_stats", stats);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /ru/fleet/groups - List all unique groups
 */
ru.get("/fleet/groups", async (c) => {
  try {
    const groups = await getFleetGroups();
    return sendList(c, groups);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /ru/fleet/needs-sync - Get repos that need syncing
 */
ru.get("/fleet/needs-sync", async (c) => {
  try {
    const repos = await getReposNeedingSync();
    return sendList(c, repos.map(serializeRepo));
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /ru/fleet/uncommitted - Get repos with uncommitted changes
 */
ru.get("/fleet/uncommitted", async (c) => {
  try {
    const repos = await getReposWithUncommittedChanges();
    return sendList(c, repos.map(serializeRepo));
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /ru/fleet/unpushed - Get repos with unpushed commits
 */
ru.get("/fleet/unpushed", async (c) => {
  try {
    const repos = await getReposWithUnpushedCommits();
    return sendList(c, repos.map(serializeRepo));
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /ru/fleet/by-group/:group - Get repos by group
 */
ru.get("/fleet/by-group/:group", async (c) => {
  try {
    const group = c.req.param("group");
    const repos = await getReposByGroup(group);
    return sendList(c, repos.map(serializeRepo));
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /ru/fleet/by-name/:fullName - Get repo by full name (owner/name)
 */
ru.get("/fleet/by-name/:owner/:name", async (c) => {
  try {
    const owner = c.req.param("owner");
    const name = c.req.param("name");
    const fullName = `${owner}/${name}`;

    const repo = await getFleetRepoByFullName(fullName);

    if (!repo) {
      return sendNotFound(c, "repo", fullName);
    }

    return sendResource(c, "repo", serializeRepo(repo));
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /ru/fleet - Add a repository to the fleet
 */
ru.post("/fleet", async (c) => {
  try {
    const body = await c.req.json();
    const validated = AddRepoSchema.parse(body);

    const params: AddRepoParams = {
      owner: validated.owner,
      name: validated.name,
      url: validated.url,
    };
    if (validated.sshUrl !== undefined) params.sshUrl = validated.sshUrl;
    if (validated.group !== undefined) params.group = validated.group;
    if (validated.description !== undefined)
      params.description = validated.description;
    if (validated.language !== undefined) params.language = validated.language;
    if (validated.isPrivate !== undefined)
      params.isPrivate = validated.isPrivate;

    const repo = await addRepoToFleet(params);

    return sendCreated(c, "repo", serializeRepo(repo), `/ru/fleet/${repo.id}`);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /ru/fleet/:id - Get a specific repository
 */
ru.get("/fleet/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const repo = await getFleetRepo(id);

    if (!repo) {
      return sendNotFound(c, "repo", id);
    }

    return sendResource(c, "repo", serializeRepo(repo));
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * PATCH /ru/fleet/:id - Update a repository
 */
ru.patch("/fleet/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const validated = UpdateRepoSchema.parse(body);

    const params: UpdateRepoParams = {};
    if (validated.localPath !== undefined) params.localPath = validated.localPath;
    if (validated.isCloned !== undefined) params.isCloned = validated.isCloned;
    if (validated.currentBranch !== undefined)
      params.currentBranch = validated.currentBranch;
    if (validated.defaultBranch !== undefined)
      params.defaultBranch = validated.defaultBranch;
    if (validated.lastCommit !== undefined)
      params.lastCommit = validated.lastCommit;
    if (validated.lastCommitDate !== undefined)
      params.lastCommitDate = validated.lastCommitDate;
    if (validated.lastCommitAuthor !== undefined)
      params.lastCommitAuthor = validated.lastCommitAuthor;
    if (validated.status !== undefined)
      params.status = validated.status as RepoStatus;
    if (validated.hasUncommittedChanges !== undefined)
      params.hasUncommittedChanges = validated.hasUncommittedChanges;
    if (validated.hasUnpushedCommits !== undefined)
      params.hasUnpushedCommits = validated.hasUnpushedCommits;
    if (validated.aheadBy !== undefined) params.aheadBy = validated.aheadBy;
    if (validated.behindBy !== undefined) params.behindBy = validated.behindBy;
    if (validated.description !== undefined)
      params.description = validated.description;
    if (validated.language !== undefined) params.language = validated.language;
    if (validated.stars !== undefined) params.stars = validated.stars;
    if (validated.isPrivate !== undefined)
      params.isPrivate = validated.isPrivate;
    if (validated.isArchived !== undefined)
      params.isArchived = validated.isArchived;
    if (validated.ruGroup !== undefined) params.ruGroup = validated.ruGroup;
    if (validated.ruConfig !== undefined) params.ruConfig = validated.ruConfig;
    if (validated.agentsmdPath !== undefined)
      params.agentsmdPath = validated.agentsmdPath;
    if (validated.lastScanDate !== undefined)
      params.lastScanDate = validated.lastScanDate;
    if (validated.lastSyncAt !== undefined)
      params.lastSyncAt = validated.lastSyncAt;

    const repo = await updateFleetRepo(id, params);

    return sendResource(c, "repo", serializeRepo(repo));
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * DELETE /ru/fleet/:id - Remove a repository from the fleet
 */
ru.delete("/fleet/:id", async (c) => {
  try {
    const id = c.req.param("id");
    await removeRepoFromFleet(id);

    return sendResource(c, "deletion_result", { removed: true, repoId: id });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// SWEEP ROUTES
// ============================================================================

/**
 * GET /ru/sweeps - List sweep sessions
 */
ru.get("/sweeps", async (c) => {
  try {
    const query = ListSweepsQuerySchema.parse({
      status: c.req.query("status"),
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    });

    const params: {
      status?: SweepStatus;
      limit?: number;
      offset?: number;
    } = {};
    if (query.status !== undefined) params.status = query.status as SweepStatus;
    if (query.limit !== undefined) params.limit = query.limit;
    if (query.offset !== undefined) params.offset = query.offset;

    const { sessions, total } = await listSweepSessions(params);

    return sendList(c, sessions.map((s) => ({
      id: s.id,
      repoCount: s.repoCount,
      parallelism: s.parallelism,
      currentPhase: s.currentPhase,
      status: s.status,
      reposAnalyzed: s.reposAnalyzed,
      reposPlanned: s.reposPlanned,
      reposExecuted: s.reposExecuted,
      reposFailed: s.reposFailed,
      reposSkipped: s.reposSkipped,
      startedAt: s.startedAt?.toISOString?.() ?? s.startedAt,
      completedAt: s.completedAt?.toISOString?.() ?? s.completedAt,
      totalDurationMs: s.totalDurationMs,
      slbApprovalRequired: s.slbApprovalRequired,
      slbApprovedBy: s.slbApprovedBy,
      slbApprovedAt: s.slbApprovedAt?.toISOString?.() ?? s.slbApprovedAt,
      triggeredBy: s.triggeredBy,
      createdAt: s.createdAt?.toISOString?.() ?? s.createdAt,
      updatedAt: s.updatedAt?.toISOString?.() ?? s.updatedAt,
    })), { total });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /ru/sweeps - Start a new agent sweep
 */
ru.post("/sweeps", async (c) => {
  try {
    const body = await c.req.json();
    const validated = StartSweepSchema.parse(body);

    // Get triggeredBy from header or body
    const triggeredBy =
      c.req.header("X-Triggered-By") ?? body.triggeredBy ?? "api";

    const config: SweepConfig = {
      targetRepos: validated.targetRepos,
    };
    if (validated.parallelism !== undefined)
      config.parallelism = validated.parallelism;
    if (validated.dryRun !== undefined) config.dryRun = validated.dryRun;
    if (validated.autoApprove !== undefined)
      config.autoApprove = validated.autoApprove;
    if (validated.phase1Timeout !== undefined)
      config.phase1Timeout = validated.phase1Timeout;
    if (validated.phase2Timeout !== undefined)
      config.phase2Timeout = validated.phase2Timeout;
    if (validated.phase3Timeout !== undefined)
      config.phase3Timeout = validated.phase3Timeout;

    const session = await startAgentSweep(triggeredBy, config);

    return sendCreated(c, "sweep_session", {
      id: session.id,
      repoCount: session.repoCount,
      status: session.status,
      slbApprovalRequired: session.slbApprovalRequired,
      triggeredBy: session.triggeredBy,
      createdAt: session.createdAt?.toISOString?.() ?? session.createdAt,
    }, `/ru/sweeps/${session.id}`);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /ru/sweeps/:id - Get a specific sweep session with details
 */
ru.get("/sweeps/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const session = await getSweepSession(id);

    if (!session) {
      return sendNotFound(c, "sweep_session", id);
    }

    return sendResource(c, "sweep_session", {
      id: session.id,
      repoCount: session.repoCount,
      parallelism: session.parallelism,
      currentPhase: session.currentPhase,
      phase1CompletedAt:
        session.phase1CompletedAt?.toISOString?.() ?? session.phase1CompletedAt,
      phase2CompletedAt:
        session.phase2CompletedAt?.toISOString?.() ?? session.phase2CompletedAt,
      phase3CompletedAt:
        session.phase3CompletedAt?.toISOString?.() ?? session.phase3CompletedAt,
      status: session.status,
      reposAnalyzed: session.reposAnalyzed,
      reposPlanned: session.reposPlanned,
      reposExecuted: session.reposExecuted,
      reposFailed: session.reposFailed,
      reposSkipped: session.reposSkipped,
      startedAt: session.startedAt?.toISOString?.() ?? session.startedAt,
      completedAt: session.completedAt?.toISOString?.() ?? session.completedAt,
      totalDurationMs: session.totalDurationMs,
      slbApprovalRequired: session.slbApprovalRequired,
      slbApprovedBy: session.slbApprovedBy,
      slbApprovedAt:
        session.slbApprovedAt?.toISOString?.() ?? session.slbApprovedAt,
      triggeredBy: session.triggeredBy,
      notes: session.notes,
      createdAt: session.createdAt?.toISOString?.() ?? session.createdAt,
      updatedAt: session.updatedAt?.toISOString?.() ?? session.updatedAt,
      planCount: session.plans.length,
      logCount: session.logs.length,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /ru/sweeps/:id/approve - Approve a sweep session
 */
ru.post("/sweeps/:id/approve", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const validated = ApproveSessionSchema.parse(body);

    await approveSweepSession(id, validated.approvedBy);

    return sendResource(c, "approval_result", {
      approved: true,
      sessionId: id,
      approvedBy: validated.approvedBy,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /ru/sweeps/:id/cancel - Cancel a sweep session
 */
ru.post("/sweeps/:id/cancel", async (c) => {
  try {
    const id = c.req.param("id");
    await cancelSweepSession(id);

    return sendResource(c, "cancellation_result", {
      cancelled: true,
      sessionId: id,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /ru/sweeps/:id/plans - Get plans for a sweep session
 */
ru.get("/sweeps/:id/plans", async (c) => {
  try {
    const id = c.req.param("id");
    const query = ListPlansQuerySchema.parse({
      approvalStatus: c.req.query("approvalStatus"),
      executionStatus: c.req.query("executionStatus"),
    });

    const params: {
      approvalStatus?: PlanApprovalStatus;
      executionStatus?: PlanExecutionStatus;
    } = {};
    if (query.approvalStatus !== undefined)
      params.approvalStatus = query.approvalStatus as PlanApprovalStatus;
    if (query.executionStatus !== undefined)
      params.executionStatus = query.executionStatus as PlanExecutionStatus;

    const plans = await getSweepPlans(id, params);

    return sendList(c, plans.map((p) => ({
      id: p.id,
      sessionId: p.sessionId,
      repoId: p.repoId,
      repoFullName: p.repoFullName,
      planVersion: p.planVersion,
      actionCount: p.actionCount,
      estimatedDurationMs: p.estimatedDurationMs,
      riskLevel: p.riskLevel,
      commitActions: p.commitActions,
      releaseActions: p.releaseActions,
      branchActions: p.branchActions,
      prActions: p.prActions,
      otherActions: p.otherActions,
      approvalStatus: p.approvalStatus,
      approvedBy: p.approvedBy,
      approvedAt: p.approvedAt?.toISOString?.() ?? p.approvedAt,
      rejectedReason: p.rejectedReason,
      executionStatus: p.executionStatus,
      executedAt: p.executedAt?.toISOString?.() ?? p.executedAt,
      createdAt: p.createdAt?.toISOString?.() ?? p.createdAt,
      updatedAt: p.updatedAt?.toISOString?.() ?? p.updatedAt,
    })));
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /ru/sweeps/:id/logs - Get logs for a sweep session
 */
ru.get("/sweeps/:id/logs", async (c) => {
  try {
    const id = c.req.param("id");
    const query = ListLogsQuerySchema.parse({
      level: c.req.query("level"),
      phase: c.req.query("phase"),
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    });

    const params: {
      level?: "debug" | "info" | "warn" | "error";
      phase?: string;
      limit?: number;
      offset?: number;
    } = {};
    if (query.level !== undefined) params.level = query.level;
    if (query.phase !== undefined) params.phase = query.phase;
    if (query.limit !== undefined) params.limit = query.limit;
    if (query.offset !== undefined) params.offset = query.offset;

    const { logs, total } = await getSweepLogs(id, params);

    return sendList(c, logs.map((l) => ({
      id: l.id,
      sessionId: l.sessionId,
      planId: l.planId,
      repoId: l.repoId,
      phase: l.phase,
      level: l.level,
      message: l.message,
      data: l.data,
      timestamp: l.timestamp?.toISOString?.() ?? l.timestamp,
      durationMs: l.durationMs,
      actionType: l.actionType,
      actionIndex: l.actionIndex,
    })), { total });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// PLAN ROUTES
// ============================================================================

/**
 * GET /ru/plans/:id - Get a specific plan
 */
ru.get("/plans/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const plan = await getSweepPlan(id);

    if (!plan) {
      return sendNotFound(c, "plan", id);
    }

    // Parse the plan JSON for display
    let planData: unknown = null;
    try {
      planData = JSON.parse(plan.planJson);
    } catch {
      // Leave as null if parsing fails
    }

    return sendResource(c, "plan", {
      id: plan.id,
      sessionId: plan.sessionId,
      repoId: plan.repoId,
      repoFullName: plan.repoFullName,
      planData,
      planVersion: plan.planVersion,
      actionCount: plan.actionCount,
      estimatedDurationMs: plan.estimatedDurationMs,
      riskLevel: plan.riskLevel,
      commitActions: plan.commitActions,
      releaseActions: plan.releaseActions,
      branchActions: plan.branchActions,
      prActions: plan.prActions,
      otherActions: plan.otherActions,
      validatedAt: plan.validatedAt?.toISOString?.() ?? plan.validatedAt,
      validationResult: plan.validationResult,
      validationErrors: plan.validationErrors,
      approvalStatus: plan.approvalStatus,
      approvedBy: plan.approvedBy,
      approvedAt: plan.approvedAt?.toISOString?.() ?? plan.approvedAt,
      rejectedReason: plan.rejectedReason,
      executionStatus: plan.executionStatus,
      executedAt: plan.executedAt?.toISOString?.() ?? plan.executedAt,
      executionResult: plan.executionResult,
      createdAt: plan.createdAt?.toISOString?.() ?? plan.createdAt,
      updatedAt: plan.updatedAt?.toISOString?.() ?? plan.updatedAt,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /ru/plans/:id/approve - Approve a plan
 */
ru.post("/plans/:id/approve", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const validated = ApprovePlanSchema.parse(body);

    await approveSweepPlan(id, validated.approvedBy);

    return sendResource(c, "approval_result", {
      approved: true,
      planId: id,
      approvedBy: validated.approvedBy,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /ru/plans/:id/reject - Reject a plan
 */
ru.post("/plans/:id/reject", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const validated = RejectPlanSchema.parse(body);

    await rejectSweepPlan(id, validated.rejectedBy, validated.reason);

    return sendResource(c, "rejection_result", {
      rejected: true,
      planId: id,
      rejectedBy: validated.rejectedBy,
      reason: validated.reason,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// DCG INTEGRATION ROUTES
// ============================================================================

/**
 * POST /ru/plans/:id/validate - Validate a plan against DCG
 */
ru.post("/plans/:id/validate", async (c) => {
  try {
    const id = c.req.param("id");
    const result = await validateSweepPlan(id);

    return sendResource(c, "validation_result", {
      planId: id,
      valid: result.valid,
      riskLevel: result.riskLevel,
      blockedCommands: result.blockedCommands,
      warnings: result.warnings,
      findingCount: result.findings.length,
      findings: result.findings,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /ru/sweeps/:id/validate - Validate all plans in a session against DCG
 */
ru.post("/sweeps/:id/validate", async (c) => {
  try {
    const id = c.req.param("id");
    const result = await validateSweepSession(id);

    return sendResource(c, "session_validation_result", {
      sessionId: id,
      totalPlans: result.totalPlans,
      validPlans: result.validPlans,
      invalidPlans: result.invalidPlans,
      planResults: result.planResults,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /ru/plans/:id/create-exceptions - Create pending exceptions for blocked commands
 */
ru.post("/plans/:id/create-exceptions", async (c) => {
  try {
    const id = c.req.param("id");
    const user = c.req.header("X-User") ?? "api-user";

    const exceptionCodes = await createExceptionsForPlan(id, user);

    return sendResource(c, "exceptions_result", {
      planId: id,
      exceptionCount: exceptionCodes.length,
      exceptionCodes,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /ru/sweeps/:id/dcg-summary - Get DCG safety summary for a sweep
 */
ru.get("/sweeps/:id/dcg-summary", async (c) => {
  try {
    const id = c.req.param("id");
    const summary = await getSweepDCGSummary(id);

    return sendResource(c, "dcg_summary", {
      sessionId: id,
      blocks: summary.blocks,
      pending: summary.pending,
      approved: summary.approved,
      denied: summary.denied,
      blockDetails: summary.blockDetails.map((b) => ({
        ...b,
        timestamp: b.timestamp.toISOString(),
      })),
      pendingDetails: summary.pendingDetails.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

export { ru };
