/**
 * RU Sweep Service - Agent Sweep Orchestration.
 *
 * Manages three-phase automated maintenance workflows:
 * - Phase 1: Analysis - Scan repos for issues and opportunities
 * - Phase 2: Planning - Generate action plans for each repo
 * - Phase 3: Execution - Execute approved plans
 *
 * Integrates with SLB for approval workflows.
 */

import { spawn } from "bun";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  agentSweepLogs,
  agentSweepPlans,
  agentSweepSessions,
  fleetRepos,
} from "../db/schema";
import { getCorrelationId } from "../middleware/correlation";
import { getHub } from "../ws/hub";
import { logger } from "./logger";
import type { FleetRepo } from "./ru-fleet.service";

// ============================================================================
// Types
// ============================================================================

export type SweepPhase =
  | "phase1_analysis"
  | "phase2_planning"
  | "phase3_execution";

export type SweepStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type PlanApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "auto_approved";

export type PlanExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface SweepConfig {
  /** Target repos: array of repo IDs or "*" for all */
  targetRepos: string[] | "*";
  /** Parallelism for operations (default: 1) */
  parallelism?: number;
  /** Don't execute, just analyze and plan */
  dryRun?: boolean;
  /** Skip SLB approval for execution */
  autoApprove?: boolean;
  /** Phase 1 timeout in seconds (default: 300) */
  phase1Timeout?: number;
  /** Phase 2 timeout in seconds (default: 600) */
  phase2Timeout?: number;
  /** Phase 3 timeout in seconds (default: 300) */
  phase3Timeout?: number;
}

export interface SweepSession {
  id: string;
  targetRepos: string;
  repoCount: number;
  config: SweepConfig | null;
  parallelism: number;
  currentPhase: SweepPhase | null;
  phase1CompletedAt: Date | null;
  phase2CompletedAt: Date | null;
  phase3CompletedAt: Date | null;
  status: SweepStatus;
  reposAnalyzed: number;
  reposPlanned: number;
  reposExecuted: number;
  reposFailed: number;
  reposSkipped: number;
  startedAt: Date | null;
  completedAt: Date | null;
  totalDurationMs: number | null;
  slbApprovalRequired: boolean;
  slbApprovalId: string | null;
  slbApprovedBy: string | null;
  slbApprovedAt: Date | null;
  triggeredBy: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface SweepPlan {
  id: string;
  sessionId: string | null;
  repoId: string | null;
  repoFullName: string;
  planJson: string;
  planVersion: number;
  actionCount: number | null;
  estimatedDurationMs: number | null;
  riskLevel: RiskLevel | null;
  commitActions: number;
  releaseActions: number;
  branchActions: number;
  prActions: number;
  otherActions: number;
  validatedAt: Date | null;
  validationResult: string | null;
  validationErrors: string | null;
  approvalStatus: PlanApprovalStatus;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectedReason: string | null;
  executionStatus: PlanExecutionStatus | null;
  executedAt: Date | null;
  executionResult: string | null;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface SweepLog {
  id: string;
  sessionId: string | null;
  planId: string | null;
  repoId: string | null;
  phase: string;
  level: LogLevel;
  message: string;
  data: unknown;
  timestamp: Date;
  durationMs: number | null;
  actionType: string | null;
  actionIndex: number | null;
}

export interface SweepSessionWithDetails extends SweepSession {
  plans: SweepPlan[];
  logs: SweepLog[];
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a cryptographically secure random ID.
 */
function generateId(prefix: string, length = 12): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(randomBytes[i]! % chars.length);
  }
  return `${prefix}${result}`;
}

const fleetChannel = { type: "system:fleet" as const };

/**
 * Log a sweep event to the database.
 */
async function logSweepEvent(
  sessionId: string,
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
  options?: {
    planId?: string;
    repoId?: string;
    phase?: string;
    actionType?: string;
    actionIndex?: number;
    durationMs?: number;
  },
): Promise<void> {
  const now = new Date();

  await db.insert(agentSweepLogs).values({
    id: generateId("log_"),
    sessionId,
    planId: options?.planId,
    repoId: options?.repoId,
    phase: options?.phase || "sweep",
    level,
    message,
    data: data ? JSON.stringify(data) : null,
    timestamp: now,
    durationMs: options?.durationMs,
    actionType: options?.actionType,
    actionIndex: options?.actionIndex,
  });

  logger.info({ sessionId, level, message, data }, "Sweep event");
}

/**
 * Assess the risk level of a plan.
 */
function assessRiskLevel(plan: unknown): RiskLevel {
  const actions =
    (plan as { actions?: Array<{ type: string; destructive?: boolean }> })
      ?.actions || [];
  const hasRelease = actions.some((a) => a.type === "release");
  const hasDestructive = actions.some((a) => a.destructive);
  const actionCount = actions.length;

  if (hasDestructive) return "critical";
  if (hasRelease && actionCount > 5) return "high";
  if (hasRelease || actionCount > 10) return "medium";
  return "low";
}

/**
 * Count actions by type in a plan.
 */
function countActionsByType(plan: unknown): {
  commit: number;
  release: number;
  branch: number;
  pr: number;
  other: number;
} {
  const actions =
    (plan as { actions?: Array<{ type: string }> })?.actions || [];
  const counts = { commit: 0, release: 0, branch: 0, pr: 0, other: 0 };

  for (const action of actions) {
    switch (action.type) {
      case "commit":
        counts.commit++;
        break;
      case "release":
        counts.release++;
        break;
      case "branch":
        counts.branch++;
        break;
      case "pr":
      case "pull_request":
        counts.pr++;
        break;
      default:
        counts.other++;
    }
  }

  return counts;
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Start a new agent sweep session.
 */
export async function startAgentSweep(
  triggeredBy: string,
  config: SweepConfig,
): Promise<SweepSession> {
  const correlationId = getCorrelationId();
  const sessionId = generateId("sweep_");

  logger.info(
    { correlationId, sessionId, triggeredBy, config },
    "Starting agent sweep",
  );

  // Determine target repos
  let repos: FleetRepo[];
  if (config.targetRepos === "*") {
    const result = await db
      .select()
      .from(fleetRepos)
      .where(eq(fleetRepos.isCloned, true));
    repos = result as FleetRepo[];
  } else {
    const result = await db
      .select()
      .from(fleetRepos)
      .where(inArray(fleetRepos.id, config.targetRepos));
    repos = result as FleetRepo[];
  }

  // Create session
  const now = new Date();
  const session = {
    id: sessionId,
    targetRepos: JSON.stringify(repos.map((r) => r.id)),
    repoCount: repos.length,
    config: JSON.stringify(config),
    parallelism: config.parallelism || 1,
    status: "pending" as SweepStatus,
    reposAnalyzed: 0,
    reposPlanned: 0,
    reposExecuted: 0,
    reposFailed: 0,
    reposSkipped: 0,
    slbApprovalRequired: !config.autoApprove,
    triggeredBy,
    createdAt: now,
  };

  await db.insert(agentSweepSessions).values(session);

  // Log session start
  await logSweepEvent(sessionId, "info", "Agent sweep session created", {
    repoCount: repos.length,
    config,
  });

  // Publish event
  getHub().publish(
    fleetChannel,
    "fleet.sweep_created",
    { sessionId, repoCount: repos.length, triggeredBy },
    { correlationId },
  );

  // If auto-approve, start immediately
  if (config.autoApprove) {
    // Start phases asynchronously
    runSweepPhases(sessionId, repos, config).catch((error) => {
      logger.error({ correlationId, sessionId, error }, "Sweep phases failed");
    });
  } else {
    // Wait for SLB approval - in production, this would integrate with SLB service
    logger.info({ correlationId, sessionId }, "Sweep awaiting SLB approval");
  }

  const result = await db
    .select()
    .from(agentSweepSessions)
    .where(eq(agentSweepSessions.id, sessionId))
    .get();

  return result as SweepSession;
}

/**
 * Approve a sweep session to start execution.
 */
export async function approveSweepSession(
  sessionId: string,
  approvedBy: string,
): Promise<void> {
  const correlationId = getCorrelationId();

  const session = await db
    .select()
    .from(agentSweepSessions)
    .where(eq(agentSweepSessions.id, sessionId))
    .get();

  if (!session) {
    throw new Error(`Sweep session not found: ${sessionId}`);
  }

  if (session.status !== "pending") {
    throw new Error(`Session not in pending state: ${session.status}`);
  }

  // Update session with approval
  await db
    .update(agentSweepSessions)
    .set({
      slbApprovedBy: approvedBy,
      slbApprovedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentSweepSessions.id, sessionId));

  await logSweepEvent(sessionId, "info", "Session approved", { approvedBy });

  // Get repos and config
  const repoIds = JSON.parse(session.targetRepos) as string[];
  const config = session.config
    ? (JSON.parse(session.config as string) as SweepConfig)
    : { targetRepos: repoIds };

  const reposResult = await db
    .select()
    .from(fleetRepos)
    .where(inArray(fleetRepos.id, repoIds));
  const repos = reposResult as FleetRepo[];

  // Start phases
  runSweepPhases(sessionId, repos, config).catch((error) => {
    logger.error(
      { correlationId, sessionId, error },
      "Sweep phases failed after approval",
    );
  });

  logger.info(
    { correlationId, sessionId, approvedBy },
    "Sweep session approved",
  );
}

/**
 * Cancel a sweep session.
 */
export async function cancelSweepSession(sessionId: string): Promise<void> {
  const correlationId = getCorrelationId();

  await db
    .update(agentSweepSessions)
    .set({
      status: "cancelled",
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentSweepSessions.id, sessionId));

  await logSweepEvent(sessionId, "info", "Session cancelled");

  getHub().publish(
    fleetChannel,
    "fleet.sweep_cancelled",
    { sessionId },
    { correlationId },
  );

  logger.info({ correlationId, sessionId }, "Sweep session cancelled");
}

// ============================================================================
// Phase Execution
// ============================================================================

/**
 * Run all three phases of the sweep.
 */
async function runSweepPhases(
  sessionId: string,
  repos: FleetRepo[],
  config: SweepConfig,
): Promise<void> {
  const correlationId = getCorrelationId();

  try {
    // Update to running
    await db
      .update(agentSweepSessions)
      .set({
        status: "running",
        startedAt: new Date(),
        currentPhase: "phase1_analysis",
        updatedAt: new Date(),
      })
      .where(eq(agentSweepSessions.id, sessionId));

    getHub().publish(
      fleetChannel,
      "fleet.sweep_started",
      { sessionId },
      { correlationId },
    );

    // Phase 1: Analysis
    await runPhase1Analysis(sessionId, repos, config);

    // Phase 2: Planning
    await runPhase2Planning(sessionId, repos, config);

    // Phase 3: Execution (if not dry run)
    if (!config.dryRun) {
      await runPhase3Execution(sessionId, config);
    }

    // Complete
    const session = await db
      .select()
      .from(agentSweepSessions)
      .where(eq(agentSweepSessions.id, sessionId))
      .get();

    const startedAt = session?.startedAt;
    const totalDurationMs = startedAt
      ? Date.now() - new Date(startedAt).getTime()
      : 0;

    await db
      .update(agentSweepSessions)
      .set({
        status: "completed",
        completedAt: new Date(),
        totalDurationMs,
        updatedAt: new Date(),
      })
      .where(eq(agentSweepSessions.id, sessionId));

    getHub().publish(
      fleetChannel,
      "fleet.sweep_completed",
      { sessionId, totalDurationMs },
      { correlationId },
    );

    logger.info(
      { correlationId, sessionId, totalDurationMs },
      "Agent sweep completed",
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await db
      .update(agentSweepSessions)
      .set({
        status: "failed",
        updatedAt: new Date(),
      })
      .where(eq(agentSweepSessions.id, sessionId));

    await logSweepEvent(sessionId, "error", "Sweep failed", {
      error: errorMessage,
    });

    getHub().publish(
      fleetChannel,
      "fleet.sweep_failed",
      { sessionId, error: errorMessage },
      { correlationId },
    );

    logger.error({ correlationId, sessionId, error }, "Agent sweep failed");
    throw error;
  }
}

/**
 * Phase 1: Analysis - Scan repos for issues.
 */
async function runPhase1Analysis(
  sessionId: string,
  repos: FleetRepo[],
  config: SweepConfig,
): Promise<void> {
  const correlationId = getCorrelationId();
  await logSweepEvent(
    sessionId,
    "info",
    "Starting Phase 1: Analysis",
    undefined,
    {
      phase: "phase1",
    },
  );

  let analyzed = 0;
  const timeout = config.phase1Timeout || 300;

  for (const repo of repos) {
    const startTime = Date.now();

    try {
      // Run ru agent-sweep --phase1
      const proc = spawn(
        [
          "ru",
          "agent-sweep",
          "--phase",
          "1",
          "--json",
          "--timeout",
          String(timeout),
          repo.fullName,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );

      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      const duration = Date.now() - startTime;

      if (exitCode === 0) {
        let result: { findings?: unknown[] } = {};
        try {
          result = JSON.parse(stdout);
        } catch {
          // Ignore parse errors
        }

        await logSweepEvent(
          sessionId,
          "info",
          `Analyzed ${repo.fullName}`,
          {
            duration_ms: duration,
            findings: result.findings,
          },
          { phase: "phase1", repoId: repo.id, durationMs: duration },
        );
        analyzed++;
      } else {
        await logSweepEvent(
          sessionId,
          "warn",
          `Analysis failed for ${repo.fullName}`,
          { exitCode },
          { phase: "phase1", repoId: repo.id },
        );
      }
    } catch (error) {
      await logSweepEvent(
        sessionId,
        "error",
        `Analysis error for ${repo.fullName}`,
        { error: error instanceof Error ? error.message : String(error) },
        { phase: "phase1", repoId: repo.id },
      );
    }

    // Update progress
    await db
      .update(agentSweepSessions)
      .set({ reposAnalyzed: analyzed, updatedAt: new Date() })
      .where(eq(agentSweepSessions.id, sessionId));

    getHub().publish(
      fleetChannel,
      "fleet.sweep_progress",
      { sessionId, phase: "phase1", analyzed, total: repos.length },
      { correlationId },
    );
  }

  await db
    .update(agentSweepSessions)
    .set({
      currentPhase: "phase2_planning",
      phase1CompletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentSweepSessions.id, sessionId));

  await logSweepEvent(
    sessionId,
    "info",
    "Phase 1 completed",
    { analyzed },
    {
      phase: "phase1",
    },
  );
}

/**
 * Phase 2: Planning - Generate action plans.
 */
async function runPhase2Planning(
  sessionId: string,
  repos: FleetRepo[],
  config: SweepConfig,
): Promise<void> {
  const correlationId = getCorrelationId();
  await logSweepEvent(
    sessionId,
    "info",
    "Starting Phase 2: Planning",
    undefined,
    {
      phase: "phase2",
    },
  );

  let planned = 0;
  const timeout = config.phase2Timeout || 600;

  for (const repo of repos) {
    const startTime = Date.now();

    try {
      // Run ru agent-sweep --phase2
      const proc = spawn(
        [
          "ru",
          "agent-sweep",
          "--phase",
          "2",
          "--json",
          "--timeout",
          String(timeout),
          repo.fullName,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );

      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      const duration = Date.now() - startTime;

      if (exitCode === 0) {
        let plan: { actions?: Array<{ type: string; destructive?: boolean }> } =
          {};
        try {
          plan = JSON.parse(stdout);
        } catch {
          // Ignore parse errors
        }

        const actionCounts = countActionsByType(plan);
        const riskLevel = assessRiskLevel(plan);

        // Store plan
        const now = new Date();
        const planRecord = {
          id: generateId("plan_"),
          sessionId,
          repoId: repo.id,
          repoFullName: repo.fullName,
          planJson: JSON.stringify(plan),
          planVersion: 1,
          actionCount: plan.actions?.length || 0,
          riskLevel,
          commitActions: actionCounts.commit,
          releaseActions: actionCounts.release,
          branchActions: actionCounts.branch,
          prActions: actionCounts.pr,
          otherActions: actionCounts.other,
          approvalStatus: config.autoApprove
            ? ("auto_approved" as PlanApprovalStatus)
            : ("pending" as PlanApprovalStatus),
          createdAt: now,
        };

        await db.insert(agentSweepPlans).values(planRecord);
        planned++;

        // Publish plan created event
        getHub().publish(
          fleetChannel,
          "fleet.plan_created",
          {
            sessionId,
            planId: planRecord.id,
            repoFullName: repo.fullName,
            actionCount: planRecord.actionCount,
            riskLevel,
          },
          { correlationId },
        );

        await logSweepEvent(
          sessionId,
          "info",
          `Created plan for ${repo.fullName}`,
          {
            planId: planRecord.id,
            actionCount: planRecord.actionCount,
            riskLevel: planRecord.riskLevel,
          },
          {
            phase: "phase2",
            repoId: repo.id,
            planId: planRecord.id,
            durationMs: duration,
          },
        );
      } else {
        await logSweepEvent(
          sessionId,
          "warn",
          `Planning failed for ${repo.fullName}`,
          { exitCode },
          { phase: "phase2", repoId: repo.id },
        );
      }
    } catch (error) {
      await logSweepEvent(
        sessionId,
        "error",
        `Planning error for ${repo.fullName}`,
        { error: error instanceof Error ? error.message : String(error) },
        { phase: "phase2", repoId: repo.id },
      );
    }

    // Update progress
    await db
      .update(agentSweepSessions)
      .set({ reposPlanned: planned, updatedAt: new Date() })
      .where(eq(agentSweepSessions.id, sessionId));

    getHub().publish(
      fleetChannel,
      "fleet.sweep_progress",
      { sessionId, phase: "phase2", planned, total: repos.length },
      { correlationId },
    );
  }

  await db
    .update(agentSweepSessions)
    .set({
      currentPhase: "phase3_execution",
      phase2CompletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentSweepSessions.id, sessionId));

  await logSweepEvent(
    sessionId,
    "info",
    "Phase 2 completed",
    { planned },
    {
      phase: "phase2",
    },
  );
}

/**
 * Phase 3: Execution - Execute approved plans.
 */
async function runPhase3Execution(
  sessionId: string,
  config: SweepConfig,
): Promise<void> {
  const correlationId = getCorrelationId();
  await logSweepEvent(
    sessionId,
    "info",
    "Starting Phase 3: Execution",
    undefined,
    {
      phase: "phase3",
    },
  );

  // Get approved plans
  const plans = await db
    .select()
    .from(agentSweepPlans)
    .where(
      and(
        eq(agentSweepPlans.sessionId, sessionId),
        inArray(agentSweepPlans.approvalStatus, ["approved", "auto_approved"]),
      ),
    );

  let executed = 0;
  let failed = 0;
  const timeout = config.phase3Timeout || 300;

  for (const plan of plans) {
    const startTime = Date.now();

    try {
      // Update plan status
      await db
        .update(agentSweepPlans)
        .set({ executionStatus: "running", updatedAt: new Date() })
        .where(eq(agentSweepPlans.id, plan.id));

      // Run ru agent-sweep --phase3
      const proc = spawn(
        [
          "ru",
          "agent-sweep",
          "--phase",
          "3",
          "--json",
          "--timeout",
          String(timeout),
          "--plan-file",
          "-", // Read from stdin
        ],
        { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
      );

      // Write plan to stdin using Bun's API
      proc.stdin.write(plan.planJson);
      proc.stdin.end();

      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      const duration = Date.now() - startTime;

      let result: unknown = {};
      try {
        result = JSON.parse(stdout);
      } catch {
        result = { error: stdout };
      }

      await db
        .update(agentSweepPlans)
        .set({
          executionStatus: exitCode === 0 ? "completed" : "failed",
          executedAt: new Date(),
          executionResult: JSON.stringify(result),
          updatedAt: new Date(),
        })
        .where(eq(agentSweepPlans.id, plan.id));

      if (exitCode === 0) {
        executed++;
      } else {
        failed++;
      }

      // Build log options conditionally for exactOptionalPropertyTypes
      const logOptions: {
        phase: string;
        planId: string;
        durationMs: number;
        repoId?: string;
      } = {
        phase: "phase3",
        planId: plan.id,
        durationMs: duration,
      };
      if (plan.repoId) logOptions.repoId = plan.repoId;

      await logSweepEvent(
        sessionId,
        exitCode === 0 ? "info" : "error",
        `Executed plan for ${plan.repoFullName}`,
        {
          planId: plan.id,
          success: exitCode === 0,
          duration_ms: duration,
        },
        logOptions,
      );
    } catch (error) {
      failed++;
      await db
        .update(agentSweepPlans)
        .set({
          executionStatus: "failed",
          executionResult: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
          updatedAt: new Date(),
        })
        .where(eq(agentSweepPlans.id, plan.id));

      // Build error log options conditionally for exactOptionalPropertyTypes
      const errorLogOptions: {
        phase: string;
        planId: string;
        repoId?: string;
      } = {
        phase: "phase3",
        planId: plan.id,
      };
      if (plan.repoId) errorLogOptions.repoId = plan.repoId;

      await logSweepEvent(
        sessionId,
        "error",
        `Execution error for ${plan.repoFullName}`,
        { error: error instanceof Error ? error.message : String(error) },
        errorLogOptions,
      );
    }

    // Update session progress
    await db
      .update(agentSweepSessions)
      .set({
        reposExecuted: executed,
        reposFailed: failed,
        updatedAt: new Date(),
      })
      .where(eq(agentSweepSessions.id, sessionId));

    getHub().publish(
      fleetChannel,
      "fleet.sweep_progress",
      { sessionId, phase: "phase3", executed, failed, total: plans.length },
      { correlationId },
    );
  }

  await db
    .update(agentSweepSessions)
    .set({ phase3CompletedAt: new Date(), updatedAt: new Date() })
    .where(eq(agentSweepSessions.id, sessionId));

  await logSweepEvent(
    sessionId,
    "info",
    "Phase 3 completed",
    { executed, failed },
    {
      phase: "phase3",
    },
  );
}

// ============================================================================
// Plan Management
// ============================================================================

/**
 * Approve a sweep plan.
 */
export async function approveSweepPlan(
  planId: string,
  approvedBy: string,
): Promise<void> {
  const correlationId = getCorrelationId();

  await db
    .update(agentSweepPlans)
    .set({
      approvalStatus: "approved",
      approvedBy,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentSweepPlans.id, planId));

  const plan = await db
    .select()
    .from(agentSweepPlans)
    .where(eq(agentSweepPlans.id, planId))
    .get();

  getHub().publish(
    fleetChannel,
    "fleet.plan_approved",
    { planId, approvedBy, repoFullName: plan?.repoFullName },
    { correlationId },
  );

  logger.info({ correlationId, planId, approvedBy }, "Sweep plan approved");
}

/**
 * Reject a sweep plan.
 */
export async function rejectSweepPlan(
  planId: string,
  rejectedBy: string,
  reason: string,
): Promise<void> {
  const correlationId = getCorrelationId();

  await db
    .update(agentSweepPlans)
    .set({
      approvalStatus: "rejected",
      rejectedReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(agentSweepPlans.id, planId));

  const plan = await db
    .select()
    .from(agentSweepPlans)
    .where(eq(agentSweepPlans.id, planId))
    .get();

  getHub().publish(
    fleetChannel,
    "fleet.plan_rejected",
    { planId, rejectedBy, reason, repoFullName: plan?.repoFullName },
    { correlationId },
  );

  logger.info(
    { correlationId, planId, rejectedBy, reason },
    "Sweep plan rejected",
  );
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get a sweep session with its plans and logs.
 */
export async function getSweepSession(
  sessionId: string,
): Promise<SweepSessionWithDetails | null> {
  const session = await db
    .select()
    .from(agentSweepSessions)
    .where(eq(agentSweepSessions.id, sessionId))
    .get();

  if (!session) {
    return null;
  }

  const plans = await db
    .select()
    .from(agentSweepPlans)
    .where(eq(agentSweepPlans.sessionId, sessionId));

  const logs = await db
    .select()
    .from(agentSweepLogs)
    .where(eq(agentSweepLogs.sessionId, sessionId))
    .orderBy(desc(agentSweepLogs.timestamp))
    .limit(100);

  return {
    ...(session as SweepSession),
    plans: plans as SweepPlan[],
    logs: logs as SweepLog[],
  };
}

/**
 * List sweep sessions.
 */
export async function listSweepSessions(options?: {
  status?: SweepStatus;
  limit?: number;
  offset?: number;
}): Promise<{ sessions: SweepSession[]; total: number }> {
  const conditions = [];
  if (options?.status) {
    conditions.push(eq(agentSweepSessions.status, options.status));
  }

  const [totalResult] = await db
    .select({ count: count() })
    .from(agentSweepSessions)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const sessions = await db
    .select()
    .from(agentSweepSessions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(agentSweepSessions.createdAt))
    .limit(options?.limit || 20)
    .offset(options?.offset || 0);

  return {
    sessions: sessions as SweepSession[],
    total: totalResult?.count || 0,
  };
}

/**
 * Get plans for a session.
 */
export async function getSweepPlans(
  sessionId: string,
  options?: {
    approvalStatus?: PlanApprovalStatus;
    executionStatus?: PlanExecutionStatus;
  },
): Promise<SweepPlan[]> {
  const conditions = [eq(agentSweepPlans.sessionId, sessionId)];

  if (options?.approvalStatus) {
    conditions.push(eq(agentSweepPlans.approvalStatus, options.approvalStatus));
  }
  if (options?.executionStatus) {
    conditions.push(
      eq(agentSweepPlans.executionStatus, options.executionStatus),
    );
  }

  const plans = await db
    .select()
    .from(agentSweepPlans)
    .where(and(...conditions))
    .orderBy(agentSweepPlans.repoFullName);

  return plans as SweepPlan[];
}

/**
 * Get a specific plan.
 */
export async function getSweepPlan(planId: string): Promise<SweepPlan | null> {
  const plan = await db
    .select()
    .from(agentSweepPlans)
    .where(eq(agentSweepPlans.id, planId))
    .get();

  return plan ? (plan as SweepPlan) : null;
}

/**
 * Get logs for a session.
 */
export async function getSweepLogs(
  sessionId: string,
  options?: {
    level?: LogLevel;
    phase?: string;
    limit?: number;
    offset?: number;
  },
): Promise<{ logs: SweepLog[]; total: number }> {
  const conditions = [eq(agentSweepLogs.sessionId, sessionId)];

  if (options?.level) {
    conditions.push(eq(agentSweepLogs.level, options.level));
  }
  if (options?.phase) {
    conditions.push(eq(agentSweepLogs.phase, options.phase));
  }

  const [totalResult] = await db
    .select({ count: count() })
    .from(agentSweepLogs)
    .where(and(...conditions));

  const logs = await db
    .select()
    .from(agentSweepLogs)
    .where(and(...conditions))
    .orderBy(desc(agentSweepLogs.timestamp))
    .limit(options?.limit || 100)
    .offset(options?.offset || 0);

  return {
    logs: logs as SweepLog[],
    total: totalResult?.count || 0,
  };
}
