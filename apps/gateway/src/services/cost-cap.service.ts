/**
 * Workspace Cost Caps and Auto-Throttle Service (bd-1weoa)
 *
 * Enforces soft and hard cost caps per workspace with automatic throttling
 * actions (notify, downgrade model, throttle rate, pause, queue), safety floor
 * for essential operations, temporary overrides, anomaly detection with
 * auto-suppression, and per-workspace audit/report export.
 */

import { ulid } from "ulid";
import { z } from "zod";
import { routeAlert } from "./alert-channel.service";
import {
  kvClearNamespace,
  kvDelete,
  kvGetAll,
  kvSet,
} from "./kv-persistence.service";
import { ModelProviderSchema } from "./model-router.service";

// ============================================================================
// Schemas & Types
// ============================================================================

export const CostCapPeriodSchema = z.enum(["daily", "weekly", "monthly"]);
export const SoftCapActionSchema = z.enum(["notify", "downgrade", "throttle"]);
export const HardCapActionSchema = z.enum(["pause", "queue", "downgrade"]);

export const CostCapPolicySchema = z
  .object({
    workspaceId: z.string().min(1),
    period: CostCapPeriodSchema.default("daily"),
    softCapUsd: z.number().positive(),
    hardCapUsd: z.number().positive(),
    safetyFloorEssentialAgents: z.number().int().min(0).max(20).default(1),
    anomalySpikeMultiplier: z.number().min(1.1).max(100).default(2.5),
    baselineHourlyUsd: z.number().min(0).default(5),
    suppressKnownEventTypes: z.array(z.string()).default([]),
    downgradeModel: z
      .object({
        provider: ModelProviderSchema,
        model: z.string().min(1),
      })
      .optional(),
    actions: z.object({
      onSoftCap: SoftCapActionSchema.default("downgrade"),
      onHardCap: HardCapActionSchema.default("pause"),
    }),
  })
  .refine((data) => data.hardCapUsd >= data.softCapUsd, {
    message: "hardCapUsd must be greater than or equal to softCapUsd",
    path: ["hardCapUsd"],
  });

export const CostCapOverrideInputSchema = z.object({
  workspaceId: z.string().min(1),
  additionalBudgetUsd: z.number().positive(),
  expiresInMinutes: z.number().positive().max(10_080).default(60),
  reason: z.string().min(1).max(500),
  actor: z.string().min(1).default("admin"),
});

export type CostCapPolicy = z.infer<typeof CostCapPolicySchema> & {
  updatedAt: string;
};

export interface CostCapOverride {
  id: string;
  workspaceId: string;
  additionalBudgetUsd: number;
  expiresAtMs: number;
  expiresAt: string;
  reason: string;
  actor: string;
  createdAt: string;
}

export interface CostEnforcementAuditEntry {
  id: string;
  workspaceId: string;
  status:
    | "within_budget"
    | "soft_cap_exceeded"
    | "hard_cap_exceeded"
    | "overridden"
    | "safety_floor_allowed"
    | "anomaly_detected";
  action:
    | "allow"
    | "notify"
    | "downgrade"
    | "throttle"
    | "pause"
    | "queue"
    | "suppress_anomaly";
  currentSpendUsd: number;
  effectiveHardCapUsd: number;
  softCapUsd: number;
  allowed: boolean;
  downgradedTo?: { provider: string; model: string };
  reason: string;
  timestamp: string;
}

export interface WorkspaceCostEvaluation {
  workspaceId: string;
  allowed: boolean;
  status: CostEnforcementAuditEntry["status"];
  action: CostEnforcementAuditEntry["action"];
  currentSpendUsd: number;
  softCapUsd: number;
  hardCapUsd: number;
  effectiveHardCapUsd: number;
  downgradedTo?: { provider: string; model: string };
  reason: string;
  activeOverride?: CostCapOverride;
}

// ============================================================================
// State Stores
// ============================================================================

const policiesByWorkspace = new Map<string, CostCapPolicy>();
const spendByWorkspace = new Map<string, number>();
const overridesByWorkspace = new Map<string, CostCapOverride>();
const auditLogByWorkspace = new Map<string, CostEnforcementAuditEntry[]>();
let costCapsHydrated = false;

function hydrateCostCapsFromDb(): void {
  if (costCapsHydrated) return;
  costCapsHydrated = true;
  for (const row of kvGetAll<CostCapPolicy>("cost_cap_policies")) {
    if (!policiesByWorkspace.has(row.key)) {
      policiesByWorkspace.set(row.key, row.value);
    }
  }
  for (const row of kvGetAll<number>("cost_cap_spend")) {
    if (!spendByWorkspace.has(row.key)) {
      spendByWorkspace.set(row.key, row.value);
    }
  }
  for (const row of kvGetAll<CostCapOverride>("cost_cap_overrides")) {
    if (!overridesByWorkspace.has(row.key)) {
      overridesByWorkspace.set(row.key, row.value);
    }
  }
  for (const row of kvGetAll<CostEnforcementAuditEntry[]>("cost_cap_audit")) {
    if (!auditLogByWorkspace.has(row.key)) {
      auditLogByWorkspace.set(row.key, row.value);
    }
  }
}

function appendAudit(entry: CostEnforcementAuditEntry): void {
  hydrateCostCapsFromDb();
  const list = auditLogByWorkspace.get(entry.workspaceId) ?? [];
  list.push(entry);
  auditLogByWorkspace.set(entry.workspaceId, list);
  kvSet("cost_cap_audit", entry.workspaceId, list);
}

// ============================================================================
// Policy & Override Management
// ============================================================================

export function upsertCostCapPolicy(
  input: z.input<typeof CostCapPolicySchema>,
): CostCapPolicy {
  hydrateCostCapsFromDb();
  const parsed = CostCapPolicySchema.parse(input);
  const policy: CostCapPolicy = {
    ...parsed,
    updatedAt: new Date().toISOString(),
  };
  policiesByWorkspace.set(policy.workspaceId, policy);
  kvSet("cost_cap_policies", policy.workspaceId, policy);
  return policy;
}

export function listCostCapPolicies(): Array<
  CostCapPolicy & { currentSpendUsd: number }
> {
  hydrateCostCapsFromDb();
  return Array.from(policiesByWorkspace.values()).map((p) => ({
    ...p,
    currentSpendUsd: spendByWorkspace.get(p.workspaceId) ?? 0,
  }));
}

export function getCostCapPolicy(
  workspaceId: string,
): CostCapPolicy | undefined {
  hydrateCostCapsFromDb();
  return policiesByWorkspace.get(workspaceId);
}

export function createCostCapOverride(
  input: z.input<typeof CostCapOverrideInputSchema>,
  nowMs: number = Date.now(),
): CostCapOverride {
  hydrateCostCapsFromDb();
  const parsed = CostCapOverrideInputSchema.parse(input);
  const expiresAtMs = nowMs + parsed.expiresInMinutes * 60_000;
  const override: CostCapOverride = {
    id: `cco_${ulid()}`,
    workspaceId: parsed.workspaceId,
    additionalBudgetUsd: parsed.additionalBudgetUsd,
    expiresAtMs,
    expiresAt: new Date(expiresAtMs).toISOString(),
    reason: parsed.reason,
    actor: parsed.actor,
    createdAt: new Date(nowMs).toISOString(),
  };
  overridesByWorkspace.set(parsed.workspaceId, override);
  kvSet("cost_cap_overrides", parsed.workspaceId, override);

  const policy = policiesByWorkspace.get(parsed.workspaceId);
  const currentSpend = spendByWorkspace.get(parsed.workspaceId) ?? 0;
  appendAudit({
    id: `cea_${ulid()}`,
    workspaceId: parsed.workspaceId,
    status: "overridden",
    action: "allow",
    currentSpendUsd: currentSpend,
    softCapUsd: policy?.softCapUsd ?? 0,
    effectiveHardCapUsd:
      (policy?.hardCapUsd ?? 0) + override.additionalBudgetUsd,
    allowed: true,
    reason: `Override granted by ${override.actor}: +$${override.additionalBudgetUsd} (${override.reason})`,
    timestamp: override.createdAt,
  });

  return override;
}

function getActiveOverride(
  workspaceId: string,
  nowMs: number = Date.now(),
): CostCapOverride | undefined {
  hydrateCostCapsFromDb();
  const ov = overridesByWorkspace.get(workspaceId);
  if (!ov) return undefined;
  if (ov.expiresAtMs <= nowMs) {
    overridesByWorkspace.delete(workspaceId);
    kvDelete("cost_cap_overrides", workspaceId);
    return undefined;
  }
  return ov;
}

// ============================================================================
// Spend Recording, Anomaly Detection, and Enforcement Evaluation
// ============================================================================

export async function recordWorkspaceSpend(params: {
  workspaceId: string;
  amountUsd: number;
  eventType?: string | undefined;
  nowMs?: number | undefined;
}): Promise<{
  totalSpendUsd: number;
  anomalyDetected: boolean;
  anomalySuppressed: boolean;
}> {
  hydrateCostCapsFromDb();
  const nowMs = params.nowMs ?? Date.now();
  const prev = spendByWorkspace.get(params.workspaceId) ?? 0;
  const next = Number((prev + params.amountUsd).toFixed(4));
  spendByWorkspace.set(params.workspaceId, next);
  kvSet("cost_cap_spend", params.workspaceId, next);

  const policy = policiesByWorkspace.get(params.workspaceId);
  let anomalyDetected = false;
  let anomalySuppressed = false;

  if (policy && policy.baselineHourlyUsd > 0) {
    const threshold = policy.baselineHourlyUsd * policy.anomalySpikeMultiplier;
    if (params.amountUsd >= threshold) {
      anomalyDetected = true;
      if (
        params.eventType &&
        policy.suppressKnownEventTypes.includes(params.eventType)
      ) {
        anomalySuppressed = true;
        appendAudit({
          id: `cea_${ulid()}`,
          workspaceId: params.workspaceId,
          status: "anomaly_detected",
          action: "suppress_anomaly",
          currentSpendUsd: next,
          softCapUsd: policy.softCapUsd,
          effectiveHardCapUsd: policy.hardCapUsd,
          allowed: true,
          reason: `Spend spike $${params.amountUsd} auto-suppressed for known event '${params.eventType}'`,
          timestamp: new Date(nowMs).toISOString(),
        });
      } else {
        appendAudit({
          id: `cea_${ulid()}`,
          workspaceId: params.workspaceId,
          status: "anomaly_detected",
          action: "notify",
          currentSpendUsd: next,
          softCapUsd: policy.softCapUsd,
          effectiveHardCapUsd: policy.hardCapUsd,
          allowed: true,
          reason: `Spend spike anomaly detected ($${params.amountUsd} >= threshold $${threshold})`,
          timestamp: new Date(nowMs).toISOString(),
        });
        await routeAlert({
          id: `anom_${ulid()}`,
          type: "budget_anomaly_spike",
          title: `Workspace Spend Anomaly (${params.workspaceId})`,
          body: `Single spend event of $${params.amountUsd} exceeded ${policy.anomalySpikeMultiplier}x baseline ($${threshold})`,
          severity: "warning",
          category: "cost",
          source: { type: "workspace", id: params.workspaceId },
          timestamp: new Date(nowMs).toISOString(),
        }).catch(() => {});
      }
    }
  }

  return {
    totalSpendUsd: next,
    anomalyDetected,
    anomalySuppressed,
  };
}

export async function evaluateWorkspaceCostCap(params: {
  workspaceId: string;
  isEssentialOperation?: boolean | undefined;
  activeEssentialAgents?: number | undefined;
  nowMs?: number | undefined;
}): Promise<WorkspaceCostEvaluation> {
  hydrateCostCapsFromDb();
  const nowMs = params.nowMs ?? Date.now();
  const policy = policiesByWorkspace.get(params.workspaceId);
  const currentSpendUsd = spendByWorkspace.get(params.workspaceId) ?? 0;

  if (!policy) {
    return {
      workspaceId: params.workspaceId,
      allowed: true,
      status: "within_budget",
      action: "allow",
      currentSpendUsd,
      softCapUsd: 0,
      hardCapUsd: 0,
      effectiveHardCapUsd: 0,
      reason: "No cost cap policy configured for workspace",
    };
  }

  const activeOverride = getActiveOverride(params.workspaceId, nowMs);
  const effectiveHardCapUsd =
    policy.hardCapUsd + (activeOverride?.additionalBudgetUsd ?? 0);
  const defaultDowngrade = policy.downgradeModel ?? {
    provider: "openai",
    model: "gpt-4.1-mini",
  };

  // Hard cap check
  if (currentSpendUsd >= effectiveHardCapUsd) {
    // Check safety floor for essential operations
    if (
      params.isEssentialOperation &&
      (params.activeEssentialAgents ?? 0) < policy.safetyFloorEssentialAgents
    ) {
      const evalResult: WorkspaceCostEvaluation = {
        workspaceId: params.workspaceId,
        allowed: true,
        status: "safety_floor_allowed",
        action: "downgrade",
        currentSpendUsd,
        softCapUsd: policy.softCapUsd,
        hardCapUsd: policy.hardCapUsd,
        effectiveHardCapUsd,
        downgradedTo: defaultDowngrade,
        reason: `Hard cap ($${effectiveHardCapUsd}) reached, but allowed via safety floor (${params.activeEssentialAgents ?? 0}/${policy.safetyFloorEssentialAgents} essential agents)`,
        ...(activeOverride && { activeOverride }),
      };
      appendAudit({
        id: `cea_${ulid()}`,
        ...evalResult,
        timestamp: new Date(nowMs).toISOString(),
      });
      return evalResult;
    }

    const hardAction = policy.actions.onHardCap;
    const allowed = hardAction === "downgrade" || hardAction === "queue";
    const evalResult: WorkspaceCostEvaluation = {
      workspaceId: params.workspaceId,
      allowed,
      status: "hard_cap_exceeded",
      action: hardAction,
      currentSpendUsd,
      softCapUsd: policy.softCapUsd,
      hardCapUsd: policy.hardCapUsd,
      effectiveHardCapUsd,
      ...(hardAction === "downgrade" && { downgradedTo: defaultDowngrade }),
      reason: `Workspace spend ($${currentSpendUsd}) reached hard cap ($${effectiveHardCapUsd}); action=${hardAction}`,
      ...(activeOverride && { activeOverride }),
    };

    appendAudit({
      id: `cea_${ulid()}`,
      ...evalResult,
      timestamp: new Date(nowMs).toISOString(),
    });

    await routeAlert({
      id: `cap_hard_${ulid()}`,
      type: "workspace_hard_cap_exceeded",
      title: `Hard Cost Cap Exceeded (${params.workspaceId})`,
      body: evalResult.reason,
      severity: "critical",
      category: "cost",
      source: { type: "workspace", id: params.workspaceId },
      timestamp: new Date(nowMs).toISOString(),
    }).catch(() => {});

    return evalResult;
  }

  // Soft cap check
  if (currentSpendUsd >= policy.softCapUsd) {
    const softAction = policy.actions.onSoftCap;
    const status =
      activeOverride && currentSpendUsd >= policy.hardCapUsd
        ? "overridden"
        : "soft_cap_exceeded";

    const evalResult: WorkspaceCostEvaluation = {
      workspaceId: params.workspaceId,
      allowed: true,
      status,
      action: softAction,
      currentSpendUsd,
      softCapUsd: policy.softCapUsd,
      hardCapUsd: policy.hardCapUsd,
      effectiveHardCapUsd,
      ...(softAction === "downgrade" && { downgradedTo: defaultDowngrade }),
      reason: `Workspace spend ($${currentSpendUsd}) exceeded soft cap ($${policy.softCapUsd}); action=${softAction}`,
      ...(activeOverride && { activeOverride }),
    };

    appendAudit({
      id: `cea_${ulid()}`,
      ...evalResult,
      timestamp: new Date(nowMs).toISOString(),
    });

    return evalResult;
  }

  return {
    workspaceId: params.workspaceId,
    allowed: true,
    status: "within_budget",
    action: "allow",
    currentSpendUsd,
    softCapUsd: policy.softCapUsd,
    hardCapUsd: policy.hardCapUsd,
    effectiveHardCapUsd,
    reason: `Spend ($${currentSpendUsd}) is within soft cap ($${policy.softCapUsd})`,
    ...(activeOverride && { activeOverride }),
  };
}

export function exportWorkspaceCostCapReport(workspaceId: string): {
  workspaceId: string;
  generatedAt: string;
  policy: CostCapPolicy | null;
  currentSpendUsd: number;
  activeOverride: CostCapOverride | null;
  auditTrail: CostEnforcementAuditEntry[];
} {
  hydrateCostCapsFromDb();
  return {
    workspaceId,
    generatedAt: new Date().toISOString(),
    policy: policiesByWorkspace.get(workspaceId) ?? null,
    currentSpendUsd: spendByWorkspace.get(workspaceId) ?? 0,
    activeOverride: getActiveOverride(workspaceId) ?? null,
    auditTrail: auditLogByWorkspace.get(workspaceId) ?? [],
  };
}

export function clearCostCapsForTesting(): void {
  policiesByWorkspace.clear();
  spendByWorkspace.clear();
  overridesByWorkspace.clear();
  auditLogByWorkspace.clear();
  kvClearNamespace("cost_cap_policies");
  kvClearNamespace("cost_cap_spend");
  kvClearNamespace("cost_cap_overrides");
  kvClearNamespace("cost_cap_audit");
  costCapsHydrated = true;
}

export function _evictCostCapsCacheForTesting(): void {
  policiesByWorkspace.clear();
  spendByWorkspace.clear();
  overridesByWorkspace.clear();
  auditLogByWorkspace.clear();
  costCapsHydrated = false;
}
