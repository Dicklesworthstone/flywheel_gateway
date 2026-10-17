/**
 * Agent Auto-Recovery and Runbooks Service (bd-hrs1t, bd-1f4kb, bd-3gbt7)
 *
 * Provides:
 * - Strict Runbook DSL with validation (conditions, actions, cooldowns, max actions per window)
 * - Safety rails: per-agent cooldowns, per-agent window caps, global window caps, and approval gates
 * - Rule evaluation with "explain" traces (why a runbook matched or was blocked)
 * - Policy testing sandbox on historical telemetry without side effects
 * - SQLite persistence (`agent_runbooks`, `agent_recovery_history`)
 */

import { ulid } from "ulid";
import { z } from "zod";
import { sqlite } from "../db";
import { routeAlert } from "./alert-channel.service";
import { logger } from "./logger";

// ============================================================================
// Runbook DSL Schema (bd-1f4kb)
// ============================================================================

export const RunbookConditionSchema = z
  .object({
    stuckDurationSeconds: z.number().int().min(10).max(86_400).optional(),
    maxHealthScore: z.number().min(0).max(100).optional(),
    minErrorRatePercent: z.number().min(0).max(100).optional(),
    minContextUsagePercent: z.number().min(0).max(100).optional(),
    reservationConflictCount: z.number().int().min(1).max(1000).optional(),
  })
  .refine(
    (c) =>
      c.stuckDurationSeconds !== undefined ||
      c.maxHealthScore !== undefined ||
      c.minErrorRatePercent !== undefined ||
      c.minContextUsagePercent !== undefined ||
      c.reservationConflictCount !== undefined,
    {
      message:
        "Runbook condition must specify at least one threshold predicate",
    },
  );

export const RunbookActionTypeSchema = z.enum([
  "interrupt",
  "restart",
  "pause",
  "downgrade_model",
  "notify",
]);

export const RunbookActionSchema = z
  .object({
    type: RunbookActionTypeSchema,
    targetModel: z.string().min(1).optional(),
    requireApproval: z.boolean().default(false),
    notifySeverity: z.enum(["info", "warning", "error", "critical"]).optional(),
  })
  .refine(
    (a) => a.type !== "downgrade_model" || Boolean(a.targetModel?.trim()),
    {
      message: "targetModel is required when action.type is 'downgrade_model'",
    },
  );

export const RunbookSafetyRailsSchema = z.object({
  cooldownSeconds: z.number().int().min(5).max(86_400).default(60),
  maxActionsPerWindow: z.number().int().min(1).max(20).default(3),
  windowSeconds: z.number().int().min(60).max(86_400).default(3600),
  globalMaxActionsPerWindow: z.number().int().min(1).max(200).default(20),
});

export const CreateRunbookSchema = z.object({
  name: z.string().min(1).max(120),
  workspaceId: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
  condition: RunbookConditionSchema,
  action: RunbookActionSchema,
  safetyRails: RunbookSafetyRailsSchema.optional().transform((v) =>
    RunbookSafetyRailsSchema.parse(v ?? {}),
  ),
});

export type RunbookCondition = z.infer<typeof RunbookConditionSchema>;
export type RunbookActionType = z.infer<typeof RunbookActionTypeSchema>;
export type RunbookAction = z.infer<typeof RunbookActionSchema>;
export type RunbookSafetyRails = z.infer<typeof RunbookSafetyRailsSchema>;
export type CreateRunbookInput = z.input<typeof CreateRunbookSchema>;

export interface Runbook {
  id: string;
  name: string;
  workspaceId?: string;
  enabled: boolean;
  condition: RunbookCondition;
  action: RunbookAction;
  safetyRails: RunbookSafetyRails;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRecoveryTelemetry {
  agentId: string;
  workspaceId?: string | undefined;
  stuckDurationSeconds?: number | undefined;
  healthScore?: number | undefined;
  errorRatePercent?: number | undefined;
  contextUsagePercent?: number | undefined;
  reservationConflictCount?: number | undefined;
  timestamp?: string | undefined;
}

export interface CriterionEvaluation {
  criterion: string;
  passed: boolean;
  actual: number;
  threshold: number;
}

export type SafetyRailBlockReason =
  | "cooldown"
  | "agent_window_cap"
  | "global_window_cap"
  | "approval_required";

export interface RunbookEvaluationExplain {
  runbookId: string;
  runbookName: string;
  agentId: string;
  matched: boolean;
  criteria: CriterionEvaluation[];
  blockedBySafetyRail?: SafetyRailBlockReason;
  action: RunbookAction;
}

export interface RecoveryHistoryEntry {
  id: string;
  agentId: string;
  runbookId: string;
  runbookName: string;
  action: RunbookActionType;
  status: "executed" | "blocked_safety_rail" | "pending_approval";
  blockReason?: SafetyRailBlockReason;
  reason: string;
  explain: RunbookEvaluationExplain;
  executedAt: string;
  executedAtMs: number;
}

export interface SandboxSimulationResult {
  runbookId: string;
  totalSamples: number;
  matchedCount: number;
  wouldExecuteCount: number;
  blockedByCooldownCount: number;
  blockedByWindowCapCount: number;
  pendingApprovalCount: number;
  traces: RunbookEvaluationExplain[];
}

// ============================================================================
// Storage Setup
// ============================================================================

let tablesInitialized = false;
const runbooksStore = new Map<string, Runbook>();
const recoveryHistoryStore: RecoveryHistoryEntry[] = [];

function ensureRunbookTables(): void {
  if (tablesInitialized) return;
  tablesInitialized = true;
  if (!sqlite) return;
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS agent_runbooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        workspace_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        condition_json TEXT NOT NULL,
        action_json TEXT NOT NULL,
        safety_rails_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_recovery_history (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        runbook_id TEXT NOT NULL,
        runbook_name TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        block_reason TEXT,
        reason TEXT NOT NULL,
        explain_json TEXT NOT NULL,
        executed_at TEXT NOT NULL,
        executed_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_recovery_history_agent_time
        ON agent_recovery_history(agent_id, executed_at_ms DESC);
    `);
  } catch (err) {
    logger.warn({ err }, "Failed to initialize runbook SQLite tables");
  }
}

// ============================================================================
// CRUD Operations
// ============================================================================

export function createRunbook(input: CreateRunbookInput): Runbook {
  ensureRunbookTables();
  const parsed = CreateRunbookSchema.parse(input);
  const nowIso = new Date().toISOString();
  const runbook: Runbook = {
    id: `rb_${ulid()}`,
    name: parsed.name,
    ...(parsed.workspaceId !== undefined && {
      workspaceId: parsed.workspaceId,
    }),
    enabled: parsed.enabled,
    condition: parsed.condition,
    action: parsed.action,
    safetyRails: parsed.safetyRails,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  runbooksStore.set(runbook.id, runbook);

  if (sqlite) {
    try {
      sqlite
        .query(
          `INSERT OR REPLACE INTO agent_runbooks
           (id, name, workspace_id, enabled, condition_json, action_json, safety_rails_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runbook.id,
          runbook.name,
          runbook.workspaceId ?? null,
          runbook.enabled ? 1 : 0,
          JSON.stringify(runbook.condition),
          JSON.stringify(runbook.action),
          JSON.stringify(runbook.safetyRails),
          runbook.createdAt,
          runbook.updatedAt,
        );
    } catch (err) {
      logger.warn({ err, runbookId: runbook.id }, "Failed to persist runbook");
    }
  }

  return runbook;
}

export function updateRunbook(
  id: string,
  input: {
    name?: string | undefined;
    workspaceId?: string | undefined;
    enabled?: boolean | undefined;
    condition?: CreateRunbookInput["condition"] | undefined;
    action?: CreateRunbookInput["action"] | undefined;
    safetyRails?: CreateRunbookInput["safetyRails"] | undefined;
  },
): Runbook | undefined {
  ensureRunbookTables();
  const existing = runbooksStore.get(id);
  if (!existing) return undefined;

  const mergedInput: CreateRunbookInput = {
    name: input.name ?? existing.name,
    workspaceId:
      input.workspaceId !== undefined
        ? input.workspaceId
        : existing.workspaceId,
    enabled: input.enabled ?? existing.enabled,
    condition: input.condition ?? existing.condition,
    action: input.action ?? existing.action,
    safetyRails: input.safetyRails ?? existing.safetyRails,
  };

  const parsed = CreateRunbookSchema.parse(mergedInput);
  const updated: Runbook = {
    ...existing,
    name: parsed.name,
    ...(parsed.workspaceId !== undefined && {
      workspaceId: parsed.workspaceId,
    }),
    enabled: parsed.enabled,
    condition: parsed.condition,
    action: parsed.action,
    safetyRails: parsed.safetyRails,
    updatedAt: new Date().toISOString(),
  };

  runbooksStore.set(id, updated);
  return updated;
}

export function listRunbooks(workspaceId?: string): Runbook[] {
  ensureRunbookTables();
  const all = Array.from(runbooksStore.values());
  if (!workspaceId) return all;
  // Multi-tenant inheritance: include global runbooks (no workspaceId) + workspace-specific runbooks
  return all.filter(
    (rb) => rb.workspaceId === undefined || rb.workspaceId === workspaceId,
  );
}

export function getRunbook(id: string): Runbook | undefined {
  ensureRunbookTables();
  return runbooksStore.get(id);
}

// ============================================================================
// Condition Evaluation & Explain View
// ============================================================================

export function evaluateRunbookCondition(
  runbook: Runbook,
  telemetry: AgentRecoveryTelemetry,
): RunbookEvaluationExplain {
  const criteria: CriterionEvaluation[] = [];
  const cond = runbook.condition;

  if (cond.stuckDurationSeconds !== undefined) {
    const actual = telemetry.stuckDurationSeconds ?? 0;
    criteria.push({
      criterion: "stuckDurationSeconds >=",
      passed: actual >= cond.stuckDurationSeconds,
      actual,
      threshold: cond.stuckDurationSeconds,
    });
  }

  if (cond.maxHealthScore !== undefined) {
    const actual = telemetry.healthScore ?? 100;
    criteria.push({
      criterion: "healthScore <=",
      passed: actual <= cond.maxHealthScore,
      actual,
      threshold: cond.maxHealthScore,
    });
  }

  if (cond.minErrorRatePercent !== undefined) {
    const actual = telemetry.errorRatePercent ?? 0;
    criteria.push({
      criterion: "errorRatePercent >=",
      passed: actual >= cond.minErrorRatePercent,
      actual,
      threshold: cond.minErrorRatePercent,
    });
  }

  if (cond.minContextUsagePercent !== undefined) {
    const actual = telemetry.contextUsagePercent ?? 0;
    criteria.push({
      criterion: "contextUsagePercent >=",
      passed: actual >= cond.minContextUsagePercent,
      actual,
      threshold: cond.minContextUsagePercent,
    });
  }

  if (cond.reservationConflictCount !== undefined) {
    const actual = telemetry.reservationConflictCount ?? 0;
    criteria.push({
      criterion: "reservationConflictCount >=",
      passed: actual >= cond.reservationConflictCount,
      actual,
      threshold: cond.reservationConflictCount,
    });
  }

  const matched =
    criteria.length > 0 && criteria.every((c) => c.passed === true);

  return {
    runbookId: runbook.id,
    runbookName: runbook.name,
    agentId: telemetry.agentId,
    matched,
    criteria,
    action: runbook.action,
  };
}

function checkSafetyRails(
  runbook: Runbook,
  agentId: string,
  history: RecoveryHistoryEntry[],
  nowMs: number,
  approved: boolean,
): SafetyRailBlockReason | undefined {
  const rails = runbook.safetyRails;
  const cooldownCutoff = nowMs - rails.cooldownSeconds * 1000;
  const windowCutoff = nowMs - rails.windowSeconds * 1000;

  const executedHistory = history.filter((h) => h.status === "executed");

  // 1. Per-agent cooldown check for this runbook
  const recentForAgentAndRunbook = executedHistory.find(
    (h) =>
      h.agentId === agentId &&
      h.runbookId === runbook.id &&
      h.executedAtMs > cooldownCutoff,
  );
  if (recentForAgentAndRunbook) {
    return "cooldown";
  }

  // 2. Per-agent maxActionsPerWindow check (prevents restart thrash loops)
  const agentWindowActions = executedHistory.filter(
    (h) => h.agentId === agentId && h.executedAtMs > windowCutoff,
  );
  if (agentWindowActions.length >= rails.maxActionsPerWindow) {
    return "agent_window_cap";
  }

  // 3. Global maxActionsPerWindow cap across all agents
  const globalWindowActions = executedHistory.filter(
    (h) => h.executedAtMs > windowCutoff,
  );
  if (globalWindowActions.length >= rails.globalMaxActionsPerWindow) {
    return "global_window_cap";
  }

  // 4. High-risk action approval gate
  if (runbook.action.requireApproval && !approved) {
    return "approval_required";
  }

  return undefined;
}

// ============================================================================
// Recovery Execution & History
// ============================================================================

export async function triggerAgentRecovery(
  telemetry: AgentRecoveryTelemetry,
  options?: {
    runbookId?: string;
    approved?: boolean;
    nowMs?: number;
    reason?: string;
  },
): Promise<{
  triggered: boolean;
  entries: RecoveryHistoryEntry[];
}> {
  ensureRunbookTables();
  const nowMs = options?.nowMs ?? Date.now();
  const approved = options?.approved ?? false;

  const candidates = options?.runbookId
    ? [runbooksStore.get(options.runbookId)].filter(
        (r): r is Runbook => r !== undefined,
      )
    : listRunbooks(telemetry.workspaceId).filter((r) => r.enabled);

  const entries: RecoveryHistoryEntry[] = [];

  for (const runbook of candidates) {
    const explain = evaluateRunbookCondition(runbook, telemetry);
    if (!explain.matched) {
      continue;
    }

    const blockReason = checkSafetyRails(
      runbook,
      telemetry.agentId,
      recoveryHistoryStore,
      nowMs,
      approved,
    );

    if (blockReason) {
      explain.blockedBySafetyRail = blockReason;
    }

    const status: RecoveryHistoryEntry["status"] =
      blockReason === "approval_required"
        ? "pending_approval"
        : blockReason
          ? "blocked_safety_rail"
          : "executed";

    const entry: RecoveryHistoryEntry = {
      id: `rec_${ulid()}`,
      agentId: telemetry.agentId,
      runbookId: runbook.id,
      runbookName: runbook.name,
      action: runbook.action.type,
      status,
      ...(blockReason !== undefined && { blockReason }),
      reason:
        options?.reason ??
        `Runbook '${runbook.name}' matched (${explain.criteria.map((c) => `${c.criterion} ${c.threshold}`).join(", ")})`,
      explain,
      executedAt: new Date(nowMs).toISOString(),
      executedAtMs: nowMs,
    };

    recoveryHistoryStore.push(entry);
    entries.push(entry);

    if (status === "executed") {
      await routeAlert({
        id: entry.id,
        type: "agent_auto_recovery",
        title: `Runbook Executed: ${runbook.name}`,
        body: `Executed action '${runbook.action.type}' on agent ${telemetry.agentId}`,
        severity: runbook.action.notifySeverity ?? "warning",
        category: "agent",
        source: { type: "agent", id: telemetry.agentId },
        metadata: {
          agentId: telemetry.agentId,
          runbookId: runbook.id,
          action: runbook.action.type,
        },
        timestamp: entry.executedAt,
      }).catch(() => {});
    }
  }

  return {
    triggered: entries.some((e) => e.status === "executed"),
    entries,
  };
}

export function getAgentRecoveryHistory(
  agentId: string,
  limit: number = 50,
): RecoveryHistoryEntry[] {
  return recoveryHistoryStore
    .filter((h) => h.agentId === agentId)
    .slice(-limit)
    .reverse();
}

/**
 * Policy Testing Sandbox (bd-hrs1t):
 * Simulates a runbook on historical telemetry traces without side effects or
 * mutating recoveryHistoryStore.
 */
export function simulateRunbookSandbox(
  runbook: Runbook,
  historicalSamples: AgentRecoveryTelemetry[],
): SandboxSimulationResult {
  const simulatedHistory: RecoveryHistoryEntry[] = [];
  const traces: RunbookEvaluationExplain[] = [];

  let matchedCount = 0;
  let wouldExecuteCount = 0;
  let blockedByCooldownCount = 0;
  let blockedByWindowCapCount = 0;
  let pendingApprovalCount = 0;

  let currentSimMs = Date.now();

  for (const sample of historicalSamples) {
    const sampleMs = sample.timestamp
      ? new Date(sample.timestamp).getTime()
      : currentSimMs;
    currentSimMs = sampleMs + 1000;

    const explain = evaluateRunbookCondition(runbook, sample);
    if (!explain.matched) {
      traces.push(explain);
      continue;
    }

    matchedCount++;
    const blockReason = checkSafetyRails(
      runbook,
      sample.agentId,
      simulatedHistory,
      sampleMs,
      false,
    );

    if (blockReason) {
      explain.blockedBySafetyRail = blockReason;
      if (blockReason === "cooldown") blockedByCooldownCount++;
      else if (
        blockReason === "agent_window_cap" ||
        blockReason === "global_window_cap"
      ) {
        blockedByWindowCapCount++;
      } else if (blockReason === "approval_required") {
        pendingApprovalCount++;
      }
    } else {
      wouldExecuteCount++;
      simulatedHistory.push({
        id: `sim_${simulatedHistory.length}`,
        agentId: sample.agentId,
        runbookId: runbook.id,
        runbookName: runbook.name,
        action: runbook.action.type,
        status: "executed",
        reason: "sandbox",
        explain,
        executedAt: new Date(sampleMs).toISOString(),
        executedAtMs: sampleMs,
      });
    }

    traces.push(explain);
  }

  return {
    runbookId: runbook.id,
    totalSamples: historicalSamples.length,
    matchedCount,
    wouldExecuteCount,
    blockedByCooldownCount,
    blockedByWindowCapCount,
    pendingApprovalCount,
    traces,
  };
}

export function clearRunbooksForTesting(): void {
  runbooksStore.clear();
  recoveryHistoryStore.length = 0;
}
