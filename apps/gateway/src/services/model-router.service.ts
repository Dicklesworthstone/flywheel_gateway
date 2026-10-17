/**
 * Model Routing and Failover Policies Service (bd-3gwij)
 *
 * Policy-driven model router that selects the optimal provider/model per request
 * based on workspace, tags, task type, cost/latency constraints, and model health,
 * with automatic failover, cooldown circuit breakers, version history + rollback,
 * policy linting, and what-if traffic simulation.
 */

import { ulid } from "ulid";
import { z } from "zod";
import { sqlite } from "../db";
import { routeAlert } from "./alert-channel.service";
import { logger } from "./logger";

// ============================================================================
// Schemas & Types
// ============================================================================

export const ModelProviderSchema = z.enum(["openai", "anthropic", "google"]);
export const FailoverErrorTypeSchema = z.enum([
  "rate_limit",
  "timeout",
  "5xx",
  "tool_error",
]);

export const PreferredModelSchema = z.object({
  provider: ModelProviderSchema,
  model: z.string().min(1),
  weight: z.number().min(0).max(100).default(1),
  estimatedCostPer1kTokens: z.number().min(0).optional(),
  estimatedP95LatencyMs: z.number().min(0).optional(),
});

export const RoutingPolicyMatchSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  agentTags: z.record(z.string(), z.string()).optional(),
  taskType: z.string().min(1).optional(),
  minContextHeadroom: z.number().min(0).max(100).optional(),
  bypassAgentIds: z.array(z.string()).optional(),
});

export const RoutingPolicyRouteSchema = z.object({
  preferred: z.array(PreferredModelSchema).min(1),
  maxCostPer1kTokens: z.number().min(0).optional(),
  maxP95LatencyMs: z.number().min(0).optional(),
});

export const RoutingPolicyFailoverSchema = z.object({
  maxAttempts: z.number().int().min(1).max(10).default(2),
  onErrors: z
    .array(FailoverErrorTypeSchema)
    .min(1)
    .default(["rate_limit", "timeout", "5xx"]),
  cooldownMinutes: z.number().min(0.1).max(1440).default(5),
});

export const CreateRoutingPolicySchema = z.object({
  name: z.string().min(1).max(120),
  priority: z.number().int().min(0).max(10_000).default(100),
  enabled: z.boolean().default(true),
  match: RoutingPolicyMatchSchema.optional().transform((v) => v ?? {}),
  route: RoutingPolicyRouteSchema,
  failover: RoutingPolicyFailoverSchema.optional().transform((v) =>
    RoutingPolicyFailoverSchema.parse(v ?? {}),
  ),
});

export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export type FailoverErrorType = z.infer<typeof FailoverErrorTypeSchema>;
export type PreferredModel = z.infer<typeof PreferredModelSchema>;
export type CreateRoutingPolicyInput = z.input<
  typeof CreateRoutingPolicySchema
>;

export interface RoutingPolicy {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  version: number;
  match: z.infer<typeof RoutingPolicyMatchSchema>;
  route: z.infer<typeof RoutingPolicyRouteSchema>;
  failover: z.infer<typeof RoutingPolicyFailoverSchema>;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyLintWarning {
  code: string;
  severity: "warning" | "error";
  message: string;
}

export interface RoutingRequestInput {
  agentId?: string | undefined;
  workspaceId?: string | undefined;
  agentTags?: Record<string, string> | undefined;
  taskType?: string | undefined;
  contextHeadroomPercent?: number | undefined;
  defaultProvider?: ModelProvider | undefined;
  defaultModel?: string | undefined;
  simulatedErrors?:
    | Array<{
        provider: ModelProvider;
        model: string;
        errorType: FailoverErrorType;
      }>
    | undefined;
}

export interface RoutingDecisionStep {
  candidate: string;
  outcome:
    | "selected"
    | "skipped_cooldown"
    | "skipped_constraint"
    | "failed_over";
  reason: string;
}

export interface RoutingDecision {
  id: string;
  agentId?: string;
  workspaceId?: string;
  policyId: string | null;
  policyName: string | null;
  provider: ModelProvider;
  model: string;
  failoverCount: number;
  steps: RoutingDecisionStep[];
  createdAt: string;
}

export interface WhatIfSimulationResult {
  totalRequests: number;
  matchedRequests: number;
  estimatedAvgCostPer1kTokens: number;
  estimatedAvgLatencyMs: number;
  modelDistribution: Record<string, number>;
}

// ============================================================================
// Storage & State
// ============================================================================

let tablesInitialized = false;
const policiesStore = new Map<string, RoutingPolicy>();
const policyHistoryStore = new Map<string, RoutingPolicy[]>();
const decisionsStore: RoutingDecision[] = [];
const modelCooldownUntilMs = new Map<string, number>();

function ensureRoutingTables(): void {
  if (tablesInitialized) return;
  tablesInitialized = true;
  if (!sqlite) return;
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS model_routing_policies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        priority INTEGER NOT NULL,
        enabled INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        policy_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS model_routing_decisions (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        policy_id TEXT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        decision_trace TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  } catch (err) {
    logger.warn({ err }, "Failed to initialize model routing SQLite tables");
  }
}

function modelKey(provider: ModelProvider, model: string): string {
  return `${provider}:${model}`;
}

// ============================================================================
// Policy Linting (bd-3gwij)
// ============================================================================

export function lintRoutingPolicy(input: CreateRoutingPolicyInput): {
  valid: boolean;
  warnings: PolicyLintWarning[];
} {
  const parsed = CreateRoutingPolicySchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      warnings: parsed.error.issues.map((i) => ({
        code: "SCHEMA_INVALID",
        severity: "error",
        message: `${i.path.join(".")}: ${i.message}`,
      })),
    };
  }

  const policy = parsed.data;
  const warnings: PolicyLintWarning[] = [];

  // Check duplicate models
  const seen = new Set<string>();
  for (const pref of policy.route.preferred) {
    const k = modelKey(pref.provider, pref.model);
    if (seen.has(k)) {
      warnings.push({
        code: "DUPLICATE_MODEL",
        severity: "warning",
        message: `Duplicate preferred model entry: ${k}`,
      });
    }
    seen.add(k);
  }

  // Check if all preferred models violate maxCostPer1kTokens or maxP95LatencyMs
  const eligibleModels = policy.route.preferred.filter((pref) => {
    if (
      policy.route.maxCostPer1kTokens !== undefined &&
      pref.estimatedCostPer1kTokens !== undefined &&
      pref.estimatedCostPer1kTokens > policy.route.maxCostPer1kTokens
    ) {
      return false;
    }
    if (
      policy.route.maxP95LatencyMs !== undefined &&
      pref.estimatedP95LatencyMs !== undefined &&
      pref.estimatedP95LatencyMs > policy.route.maxP95LatencyMs
    ) {
      return false;
    }
    return true;
  });

  if (eligibleModels.length === 0) {
    warnings.push({
      code: "IMPOSSIBLE_CONSTRAINTS",
      severity: "error",
      message:
        "All preferred models exceed maxCostPer1kTokens or maxP95LatencyMs constraints",
    });
  }

  if (policy.route.preferred.length === 1 && policy.failover.maxAttempts > 1) {
    warnings.push({
      code: "SINGLE_MODEL_FAILOVER",
      severity: "warning",
      message:
        "Failover maxAttempts > 1 configured with only 1 preferred model",
    });
  }

  return {
    valid: !warnings.some((w) => w.severity === "error"),
    warnings,
  };
}

// ============================================================================
// Policy CRUD & Rollback
// ============================================================================

export function createRoutingPolicy(
  input: CreateRoutingPolicyInput,
): RoutingPolicy {
  ensureRoutingTables();
  const parsed = CreateRoutingPolicySchema.parse(input);
  const nowIso = new Date().toISOString();

  const policy: RoutingPolicy = {
    id: ` mrp_${ulid()}`.trim(),
    name: parsed.name,
    priority: parsed.priority,
    enabled: parsed.enabled,
    version: 1,
    match: parsed.match,
    route: parsed.route,
    failover: parsed.failover,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  policiesStore.set(policy.id, policy);
  policyHistoryStore.set(policy.id, [structuredClone(policy)]);
  persistPolicy(policy);
  return policy;
}

export function updateRoutingPolicy(
  id: string,
  input: Partial<CreateRoutingPolicyInput>,
): RoutingPolicy | undefined {
  ensureRoutingTables();
  const existing = policiesStore.get(id);
  if (!existing) return undefined;

  const mergedInput: CreateRoutingPolicyInput = {
    name: input.name ?? existing.name,
    priority: input.priority ?? existing.priority,
    enabled: input.enabled ?? existing.enabled,
    match: input.match ?? existing.match,
    route: input.route ?? existing.route,
    failover: input.failover ?? existing.failover,
  };

  const parsed = CreateRoutingPolicySchema.parse(mergedInput);
  const updated: RoutingPolicy = {
    ...existing,
    name: parsed.name,
    priority: parsed.priority,
    enabled: parsed.enabled,
    version: existing.version + 1,
    match: parsed.match,
    route: parsed.route,
    failover: parsed.failover,
    updatedAt: new Date().toISOString(),
  };

  policiesStore.set(id, updated);
  const history = policyHistoryStore.get(id) ?? [];
  history.push(structuredClone(updated));
  policyHistoryStore.set(id, history);
  persistPolicy(updated);
  return updated;
}

export function disableRoutingPolicy(id: string): RoutingPolicy | undefined {
  return updateRoutingPolicy(id, { enabled: false });
}

export function revertRoutingPolicy(
  id: string,
  targetVersion: number,
): RoutingPolicy | undefined {
  const history = policyHistoryStore.get(id);
  if (!history) return undefined;
  const target = history.find((v) => v.version === targetVersion);
  if (!target) return undefined;

  return updateRoutingPolicy(id, {
    name: target.name,
    priority: target.priority,
    enabled: target.enabled,
    match: target.match,
    route: target.route,
    failover: target.failover,
  });
}

export function listRoutingPolicies(): RoutingPolicy[] {
  ensureRoutingTables();
  return Array.from(policiesStore.values()).sort(
    (a, b) => a.priority - b.priority,
  );
}

function persistPolicy(policy: RoutingPolicy): void {
  if (!sqlite) return;
  try {
    sqlite
      .query(
        `INSERT OR REPLACE INTO model_routing_policies
         (id, name, priority, enabled, version, policy_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        policy.id,
        policy.name,
        policy.priority,
        policy.enabled ? 1 : 0,
        policy.version,
        JSON.stringify(policy),
        policy.createdAt,
        policy.updatedAt,
      );
  } catch (err) {
    logger.warn(
      { err, policyId: policy.id },
      "Failed to persist routing policy",
    );
  }
}

// ============================================================================
// Cooldown & Policy Evaluation
// ============================================================================

export function recordModelCooldown(
  provider: ModelProvider,
  model: string,
  cooldownMinutes: number,
  nowMs: number = Date.now(),
): void {
  const key = modelKey(provider, model);
  modelCooldownUntilMs.set(key, nowMs + cooldownMinutes * 60_000);
}

export function isModelInCooldown(
  provider: ModelProvider,
  model: string,
  nowMs: number = Date.now(),
): boolean {
  const until = modelCooldownUntilMs.get(modelKey(provider, model));
  if (until === undefined) return false;
  if (until <= nowMs) {
    modelCooldownUntilMs.delete(modelKey(provider, model));
    return false;
  }
  return true;
}

function doesPolicyMatch(
  policy: RoutingPolicy,
  req: RoutingRequestInput,
): boolean {
  if (!policy.enabled) return false;

  // Explicit agent bypass list
  if (req.agentId && policy.match.bypassAgentIds?.includes(req.agentId)) {
    return false;
  }

  if (
    policy.match.workspaceId &&
    policy.match.workspaceId !== req.workspaceId
  ) {
    return false;
  }

  if (policy.match.taskType && policy.match.taskType !== req.taskType) {
    return false;
  }

  if (
    policy.match.minContextHeadroom !== undefined &&
    (req.contextHeadroomPercent ?? 100) < policy.match.minContextHeadroom
  ) {
    return false;
  }

  if (policy.match.agentTags) {
    for (const [tagKey, tagVal] of Object.entries(policy.match.agentTags)) {
      if (req.agentTags?.[tagKey] !== tagVal) {
        return false;
      }
    }
  }

  return true;
}

export async function evaluateModelRouting(
  req: RoutingRequestInput,
  nowMs: number = Date.now(),
): Promise<RoutingDecision> {
  ensureRoutingTables();
  const steps: RoutingDecisionStep[] = [];
  const sortedPolicies = listRoutingPolicies();
  const matchedPolicy = sortedPolicies.find((p) => doesPolicyMatch(p, req));

  let selectedProvider: ModelProvider = req.defaultProvider ?? "anthropic";
  let selectedModel = req.defaultModel ?? "claude-sonnet-4-20250514";
  let failoverCount = 0;

  if (matchedPolicy) {
    let attempts = 0;
    for (const pref of matchedPolicy.route.preferred) {
      const candidateId = modelKey(pref.provider, pref.model);

      // Check cooldown
      if (isModelInCooldown(pref.provider, pref.model, nowMs)) {
        steps.push({
          candidate: candidateId,
          outcome: "skipped_cooldown",
          reason: `Model ${candidateId} is in cooldown`,
        });
        continue;
      }

      // Check cost constraint
      if (
        matchedPolicy.route.maxCostPer1kTokens !== undefined &&
        pref.estimatedCostPer1kTokens !== undefined &&
        pref.estimatedCostPer1kTokens > matchedPolicy.route.maxCostPer1kTokens
      ) {
        steps.push({
          candidate: candidateId,
          outcome: "skipped_constraint",
          reason: `Cost ${pref.estimatedCostPer1kTokens} > maxCostPer1kTokens ${matchedPolicy.route.maxCostPer1kTokens}`,
        });
        continue;
      }

      // Check latency constraint
      if (
        matchedPolicy.route.maxP95LatencyMs !== undefined &&
        pref.estimatedP95LatencyMs !== undefined &&
        pref.estimatedP95LatencyMs > matchedPolicy.route.maxP95LatencyMs
      ) {
        steps.push({
          candidate: candidateId,
          outcome: "skipped_constraint",
          reason: `Latency ${pref.estimatedP95LatencyMs}ms > maxP95LatencyMs ${matchedPolicy.route.maxP95LatencyMs}ms`,
        });
        continue;
      }

      attempts++;
      const simError = req.simulatedErrors?.find(
        (e) => e.provider === pref.provider && e.model === pref.model,
      );
      if (
        simError &&
        matchedPolicy.failover.onErrors.includes(simError.errorType) &&
        attempts <= matchedPolicy.failover.maxAttempts
      ) {
        failoverCount++;
        recordModelCooldown(
          pref.provider,
          pref.model,
          matchedPolicy.failover.cooldownMinutes,
          nowMs,
        );
        steps.push({
          candidate: candidateId,
          outcome: "failed_over",
          reason: `Failover triggered on ${simError.errorType}; placed in cooldown for ${matchedPolicy.failover.cooldownMinutes}m`,
        });
        continue;
      }

      selectedProvider = pref.provider;
      selectedModel = pref.model;
      steps.push({
        candidate: candidateId,
        outcome: "selected",
        reason: `Selected via policy '${matchedPolicy.name}' (priority ${matchedPolicy.priority})`,
      });
      break;
    }
  } else {
    steps.push({
      candidate: modelKey(selectedProvider, selectedModel),
      outcome: "selected",
      reason: "No matching routing policy; using default model",
    });
  }

  const decision: RoutingDecision = {
    id: `mrd_${ulid()}`,
    ...(req.agentId !== undefined && { agentId: req.agentId }),
    ...(req.workspaceId !== undefined && { workspaceId: req.workspaceId }),
    policyId: matchedPolicy?.id ?? null,
    policyName: matchedPolicy?.name ?? null,
    provider: selectedProvider,
    model: selectedModel,
    failoverCount,
    steps,
    createdAt: new Date(nowMs).toISOString(),
  };

  decisionsStore.push(decision);

  if (failoverCount > 0) {
    await routeAlert({
      id: decision.id,
      type: "model_routing_failover",
      title: `Model Failover Triggered (${selectedProvider}:${selectedModel})`,
      body: `Policy '${matchedPolicy?.name}' failed over ${failoverCount} time(s) to ${selectedProvider}:${selectedModel}`,
      severity: "warning",
      category: "routing",
      source: req.agentId
        ? { type: "agent", id: req.agentId }
        : { type: "service", name: "model-router" },
      timestamp: decision.createdAt,
    }).catch(() => {});
  }

  return decision;
}

export function listRoutingDecisions(filter?: {
  agentId?: string;
  policyId?: string;
  limit?: number;
}): RoutingDecision[] {
  const limit = filter?.limit ?? 50;
  return decisionsStore
    .filter((d) => {
      if (filter?.agentId && d.agentId !== filter.agentId) return false;
      if (filter?.policyId && d.policyId !== filter.policyId) return false;
      return true;
    })
    .slice(-limit)
    .reverse();
}

/**
 * What-if traffic simulation for a candidate routing policy.
 */
export function simulateRoutingPolicyWhatIf(
  policyInput: CreateRoutingPolicyInput,
  samples: RoutingRequestInput[],
): WhatIfSimulationResult {
  const parsed = CreateRoutingPolicySchema.parse(policyInput);
  const tempPolicy: RoutingPolicy = {
    id: "sim_policy",
    name: parsed.name,
    priority: parsed.priority,
    enabled: true,
    version: 1,
    match: parsed.match,
    route: parsed.route,
    failover: parsed.failover,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  let matchedRequests = 0;
  let totalCost = 0;
  let totalLatency = 0;
  const modelDistribution: Record<string, number> = {};

  for (const sample of samples) {
    if (!doesPolicyMatch(tempPolicy, sample)) {
      continue;
    }
    matchedRequests++;
    const primary = tempPolicy.route.preferred[0]!;
    const key = modelKey(primary.provider, primary.model);
    modelDistribution[key] = (modelDistribution[key] ?? 0) + 1;
    totalCost += primary.estimatedCostPer1kTokens ?? 0.003;
    totalLatency += primary.estimatedP95LatencyMs ?? 500;
  }

  return {
    totalRequests: samples.length,
    matchedRequests,
    estimatedAvgCostPer1kTokens:
      matchedRequests > 0
        ? Number((totalCost / matchedRequests).toFixed(5))
        : 0,
    estimatedAvgLatencyMs:
      matchedRequests > 0 ? Math.round(totalLatency / matchedRequests) : 0,
    modelDistribution,
  };
}

export function clearModelRouterForTesting(): void {
  policiesStore.clear();
  policyHistoryStore.clear();
  decisionsStore.length = 0;
  modelCooldownUntilMs.clear();
}
