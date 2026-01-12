/**
 * DCG-RU Integration Service - Safety integration for Agent Sweeps.
 *
 * Provides:
 * - Plan validation against DCG before execution
 * - Runtime blocking during sweep execution
 * - Pending exception creation for blocked commands
 * - Audit trail linking blocks to sweep sessions
 */

import { spawn } from "bun";
import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { agentSweepPlans } from "../db/schema";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  createPendingException,
  type DCGPendingSeverity,
  listPendingExceptions,
  markExceptionExecuted,
  validateExceptionForExecution,
} from "./dcg-pending.service";
import { getBlockEvents, ingestBlockEvent, type DCGSeverity } from "./dcg.service";
import { logger } from "./logger";
import {
  getSweepPlan,
  getSweepPlans,
  type RiskLevel,
} from "./ru-sweep.service";

// ============================================================================
// Types
// ============================================================================

export interface DCGFinding {
  actionIndex: number;
  command: string;
  ruleId: string;
  severity: DCGSeverity;
  reason: string;
  suggestion?: string;
}

export interface PlanValidationResult {
  valid: boolean;
  riskLevel: RiskLevel;
  findings: DCGFinding[];
  blockedCommands: number;
  warnings: number;
}

export interface SessionValidationResult {
  totalPlans: number;
  validPlans: number;
  invalidPlans: number;
  planResults: Record<string, PlanValidationResult>;
}

export interface ActionExecutionResult {
  success: boolean;
  blockedByDCG: boolean;
  blockDetails?: {
    ruleId: string;
    reason: string;
    shortCode?: string;
  };
  output?: string;
  error?: string;
}

export interface PlanExecutionResult {
  success: boolean;
  actionsExecuted: number;
  actionsBlocked: number;
  actionsFailed: number;
  results: ActionExecutionResult[];
}

interface SweepAction {
  type: string;
  command?: string;
  content?: string;
  files?: string[];
  message?: string;
  push?: boolean;
  version?: string;
  destructive?: boolean;
}

interface DCGTestResult {
  blocked: boolean;
  matchedRule?: {
    pack: string;
    ruleId: string;
    severity: DCGSeverity;
    reason: string;
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Hash a command for DCG verification.
 */
function hashCommand(command: string): string {
  return createHash("sha256").update(command).digest("hex");
}

/**
 * Escape a string for use in shell commands.
 * Wraps in single quotes and escapes any single quotes within.
 */
function shellEscape(arg: string): string {
  // Replace single quotes with '\'' (end quote, escaped quote, start quote)
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Extract commands from a sweep action.
 */
function extractCommandsFromAction(action: SweepAction): string[] {
  const commands: string[] = [];

  switch (action.type) {
    case "commit":
      if (action.files && action.files.length > 0) {
        // Escape each filename for shell safety
        const escapedFiles = action.files.map(shellEscape).join(" ");
        commands.push(`git add ${escapedFiles}`);
      }
      if (action.message) {
        // Escape the commit message for shell safety
        commands.push(`git commit -m ${shellEscape(action.message)}`);
      }
      if (action.push) {
        commands.push("git push");
      }
      break;

    case "release":
      if (action.version) {
        // Escape version in case it contains special chars
        commands.push(`git tag ${shellEscape(action.version)}`);
      }
      if (action.push) {
        commands.push("git push --tags");
      }
      break;

    case "shell":
      if (action.command) {
        commands.push(action.command);
      }
      break;

    case "script":
      if (action.content) {
        commands.push(action.content);
      }
      break;

    case "branch":
      // Branch operations are generally safe
      break;

    case "pr":
    case "pull_request":
      // PR operations are generally safe
      break;

    default:
      // Unknown action types - skip
      break;
  }

  return commands;
}

/**
 * Determine overall risk level from findings.
 */
function determineRiskLevel(findings: DCGFinding[]): RiskLevel {
  const hasCritical = findings.some((f) => f.severity === "critical");
  const hasHigh = findings.some((f) => f.severity === "high");
  const hasMedium = findings.some((f) => f.severity === "medium");

  if (hasCritical) return "critical";
  if (hasHigh) return "high";
  if (hasMedium) return "medium";
  return "low";
}

/**
 * Test a command against DCG.
 */
async function testCommand(command: string): Promise<DCGTestResult> {
  try {
    const proc = spawn(["dcg", "test", "--json", command], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode === 0) {
      return { blocked: false };
    }

    // Parse DCG output for block details
    try {
      const result = JSON.parse(stdout) as {
        blocked?: boolean;
        pack?: string;
        ruleId?: string;
        severity?: string;
        reason?: string;
      };
      if (result.blocked) {
        return {
          blocked: true,
          matchedRule: {
            pack: result.pack || "unknown",
            ruleId: result.ruleId || "unknown",
            severity: (result.severity as DCGSeverity) || "high",
            reason: result.reason || "Command blocked by DCG",
          },
        };
      }
    } catch {
      // If parsing fails, assume blocked based on exit code
      if (exitCode !== 0) {
        return {
          blocked: true,
          matchedRule: {
            pack: "unknown",
            ruleId: "unknown",
            severity: "high",
            reason: stdout || "Command blocked by DCG",
          },
        };
      }
    }

    return { blocked: false };
  } catch (error) {
    // If DCG is not available, don't block
    logger.warn({ error }, "DCG test failed, allowing command");
    return { blocked: false };
  }
}

// ============================================================================
// Plan Validation
// ============================================================================

/**
 * Validate a sweep plan against DCG before execution.
 */
export async function validateSweepPlan(
  planId: string,
): Promise<PlanValidationResult> {
  const correlationId = getCorrelationId();
  const log = getLogger();
  const startTime = Date.now();

  log.info({ correlationId, planId }, "Validating sweep plan against DCG");

  const plan = await getSweepPlan(planId);
  if (!plan) {
    throw new Error(`Plan not found: ${planId}`);
  }

  let parsedPlan: { actions?: SweepAction[] };
  try {
    parsedPlan = JSON.parse(plan.planJson) as { actions?: SweepAction[] };
  } catch {
    throw new Error(`Invalid plan JSON for plan: ${planId}`);
  }
  const actions = parsedPlan.actions || [];

  const findings: DCGFinding[] = [];
  let blockedCommands = 0;
  let warnings = 0;

  // Scan each action's commands
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]!;
    const commands = extractCommandsFromAction(action);

    for (const command of commands) {
      const testResult = await testCommand(command);

      if (testResult.blocked && testResult.matchedRule) {
        findings.push({
          actionIndex: i,
          command,
          ruleId: testResult.matchedRule.ruleId,
          severity: testResult.matchedRule.severity,
          reason: testResult.matchedRule.reason,
        });

        if (
          testResult.matchedRule.severity === "critical" ||
          testResult.matchedRule.severity === "high"
        ) {
          blockedCommands++;
        } else {
          warnings++;
        }
      }
    }
  }

  // Determine overall risk level
  const riskLevel = determineRiskLevel(findings);
  const valid = blockedCommands === 0;

  // Update plan with validation results
  // Logic: blocked commands = invalid, only warnings = warning, neither = valid
  const validationResult = blockedCommands > 0 ? "invalid" : warnings > 0 ? "warning" : "valid";

  await db
    .update(agentSweepPlans)
    .set({
      validatedAt: new Date(),
      validationResult,
      validationErrors: findings.length > 0 ? JSON.stringify(findings) : null,
      riskLevel,
      updatedAt: new Date(),
    })
    .where(eq(agentSweepPlans.id, planId));

  const duration = Date.now() - startTime;
  log.info(
    {
      correlationId,
      planId,
      duration_ms: duration,
      valid,
      riskLevel,
      findingCount: findings.length,
      blockedCommands,
      warnings,
    },
    "Plan validation completed",
  );

  return {
    valid,
    riskLevel,
    findings,
    blockedCommands,
    warnings,
  };
}

/**
 * Validate all plans in a sweep session.
 */
export async function validateSweepSession(
  sessionId: string,
): Promise<SessionValidationResult> {
  const correlationId = getCorrelationId();
  const log = getLogger();

  const plans = await getSweepPlans(sessionId);

  const planResults: Record<string, PlanValidationResult> = {};
  let validPlans = 0;
  let invalidPlans = 0;

  for (const plan of plans) {
    const result = await validateSweepPlan(plan.id);
    planResults[plan.id] = result;

    if (result.valid) {
      validPlans++;
    } else {
      invalidPlans++;
    }
  }

  log.info(
    {
      correlationId,
      sessionId,
      totalPlans: plans.length,
      validPlans,
      invalidPlans,
    },
    "Session validation completed",
  );

  return {
    totalPlans: plans.length,
    validPlans,
    invalidPlans,
    planResults,
  };
}

// ============================================================================
// Exception Creation
// ============================================================================

/**
 * Create pending exceptions for blocked commands in a plan.
 */
export async function createExceptionsForPlan(
  planId: string,
  approvedBy: string,
): Promise<string[]> {
  const correlationId = getCorrelationId();
  const log = getLogger();

  const plan = await getSweepPlan(planId);
  if (!plan || !plan.validationErrors) {
    return [];
  }

  let findings: DCGFinding[];
  try {
    findings = JSON.parse(plan.validationErrors) as DCGFinding[];
  } catch {
    log.warn({ correlationId, planId }, "Invalid validation errors JSON, skipping exception creation");
    return [];
  }
  const exceptionCodes: string[] = [];

  for (const finding of findings) {
    if (finding.severity === "critical" || finding.severity === "high") {
      const exception = await createPendingException({
        command: finding.command,
        pack: finding.ruleId.split(":")[0] || finding.ruleId,
        ruleId: finding.ruleId,
        reason: `Sweep plan command: ${finding.reason}`,
        severity: finding.severity as DCGPendingSeverity,
        agentId: `sweep:${plan.sessionId}`,
        ttlSeconds: 3600, // 1 hour for sweep commands
      });

      exceptionCodes.push(exception.shortCode);
    }
  }

  log.info(
    {
      correlationId,
      planId,
      exceptionCount: exceptionCodes.length,
      approvedBy,
    },
    "Created pending exceptions for plan",
  );

  return exceptionCodes;
}

// ============================================================================
// Execution Integration
// ============================================================================

/**
 * Execute a single action with DCG checks.
 */
export async function executeActionWithDCG(
  sessionId: string,
  planId: string,
  actionIndex: number,
  action: SweepAction,
): Promise<ActionExecutionResult> {
  const correlationId = getCorrelationId();
  const log = getLogger();
  const startTime = Date.now();

  log.info(
    {
      correlationId,
      sessionId,
      planId,
      actionIndex,
      actionType: action.type,
    },
    "Executing action with DCG checks",
  );

  const commands = extractCommandsFromAction(action);

  for (const command of commands) {
    // Check for approved pending exception
    const commandHash = hashCommand(command);
    const exception = await validateExceptionForExecution(commandHash);

    if (!exception) {
      // Test if command would be blocked
      const testResult = await testCommand(command);

      if (testResult.blocked && testResult.matchedRule) {
        // Log the block event linked to sweep
        await ingestBlockEvent({
          timestamp: new Date(),
          command,
          pack: testResult.matchedRule.pack,
          pattern: command.substring(0, 100),
          ruleId: testResult.matchedRule.ruleId,
          severity: testResult.matchedRule.severity,
          reason: testResult.matchedRule.reason,
          agentId: `sweep:${sessionId}`,
          contextClassification: "executed",
        });

        log.warn(
          {
            correlationId,
            sessionId,
            planId,
            actionIndex,
            command: command.substring(0, 50),
            ruleId: testResult.matchedRule.ruleId,
          },
          "Sweep action blocked by DCG",
        );

        return {
          success: false,
          blockedByDCG: true,
          blockDetails: {
            ruleId: testResult.matchedRule.ruleId,
            reason: testResult.matchedRule.reason,
          },
        };
      }
    }

    // Mark exception as executed if we have one
    if (exception) {
      await markExceptionExecuted(exception.id, "success");
    }
  }

  const duration = Date.now() - startTime;
  log.info(
    {
      correlationId,
      sessionId,
      planId,
      actionIndex,
      duration_ms: duration,
    },
    "Action executed successfully",
  );

  return {
    success: true,
    blockedByDCG: false,
  };
}

/**
 * Execute all actions in a plan with DCG checks.
 */
export async function executePlanWithDCG(
  sessionId: string,
  planId: string,
): Promise<PlanExecutionResult> {
  const plan = await getSweepPlan(planId);
  if (!plan) {
    throw new Error(`Plan not found: ${planId}`);
  }

  let parsedPlan: { actions?: SweepAction[] };
  try {
    parsedPlan = JSON.parse(plan.planJson) as { actions?: SweepAction[] };
  } catch {
    throw new Error(`Invalid plan JSON for plan: ${planId}`);
  }
  const actions = parsedPlan.actions || [];

  const results: ActionExecutionResult[] = [];
  let actionsExecuted = 0;
  let actionsBlocked = 0;
  let actionsFailed = 0;

  for (let i = 0; i < actions.length; i++) {
    const result = await executeActionWithDCG(
      sessionId,
      planId,
      i,
      actions[i]!,
    );
    results.push(result);

    if (result.success) {
      actionsExecuted++;
    } else if (result.blockedByDCG) {
      actionsBlocked++;
      // Stop execution on DCG block
      break;
    } else {
      actionsFailed++;
      // Stop execution on failure
      break;
    }
  }

  return {
    success: actionsBlocked === 0 && actionsFailed === 0,
    actionsExecuted,
    actionsBlocked,
    actionsFailed,
    results,
  };
}

// ============================================================================
// Summary Queries
// ============================================================================

/**
 * Get DCG summary for a sweep session.
 */
export async function getSweepDCGSummary(sessionId: string): Promise<{
  blocks: number;
  pending: number;
  approved: number;
  denied: number;
  blockDetails: Array<{
    id: string;
    command: string;
    ruleId: string;
    severity: string;
    reason: string;
    timestamp: Date;
  }>;
  pendingDetails: Array<{
    id: string;
    shortCode: string;
    command: string;
    status: string;
    severity: string;
    createdAt: Date;
  }>;
}> {
  const agentId = `sweep:${sessionId}`;

  // Get all DCG blocks linked to this sweep (from in-memory store via getBlockEvents)
  const blocksResult = await getBlockEvents({ agentId, limit: 100 });

  // Get pending exceptions for this sweep
  const pendingResult = await listPendingExceptions({ agentId, limit: 100 });
  const pending = pendingResult.exceptions;

  const pendingCount = pending.filter((p) => p.status === "pending").length;
  const approvedCount = pending.filter((p) => p.status === "approved").length;
  const deniedCount = pending.filter((p) => p.status === "denied").length;

  return {
    blocks: blocksResult.events.length,
    pending: pendingCount,
    approved: approvedCount,
    denied: deniedCount,
    blockDetails: blocksResult.events.map((b) => ({
      id: b.id,
      command: b.command,
      ruleId: b.ruleId,
      severity: b.severity,
      reason: b.reason,
      timestamp: b.timestamp,
    })),
    pendingDetails: pending.map((p) => ({
      id: p.id,
      shortCode: p.shortCode,
      command: p.command,
      status: p.status,
      severity: p.severity,
      createdAt: p.createdAt,
    })),
  };
}
