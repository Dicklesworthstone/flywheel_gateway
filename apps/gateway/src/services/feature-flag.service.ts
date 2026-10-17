/**
 * Feature Flag System Service (bd-1kij1)
 *
 * Provides gradual feature rollout with deterministic percentage-based
 * targeting, user/workspace/cohort targeting, A/B variants, emergency kill
 * switches, and per-flag evaluation metrics.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { kvClearNamespace, kvGetAll, kvSet } from "./kv-persistence.service";

// ============================================================================
// Schemas & Types
// ============================================================================

export const FlagVariantSchema = z.object({
  name: z.string().min(1),
  weight: z.number().min(1).max(100),
});

export const UpsertFeatureFlagSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_.-]+$/i, "Invalid flag key"),
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(""),
  enabled: z.boolean().default(true),
  killSwitch: z.boolean().default(false),
  rolloutPercentage: z.number().min(0).max(100).default(100),
  targetUsers: z.array(z.string()).default([]),
  targetWorkspaces: z.array(z.string()).default([]),
  targetCohorts: z.array(z.string()).default([]),
  variants: z.array(FlagVariantSchema).optional(),
});

export type FeatureFlag = z.infer<typeof UpsertFeatureFlagSchema> & {
  updatedAt: string;
};

export interface FlagEvaluationContext {
  userId?: string | undefined;
  workspaceId?: string | undefined;
  cohorts?: string[] | undefined;
}

export interface FlagEvaluationResult {
  key: string;
  enabled: boolean;
  variant?: string;
  reason:
    | "not_found"
    | "kill_switch"
    | "flag_disabled"
    | "target_user"
    | "target_workspace"
    | "target_cohort"
    | "rollout_included"
    | "rollout_excluded";
  bucket: number;
}

export interface FlagMetrics {
  key: string;
  evaluations: number;
  enabledCount: number;
  disabledCount: number;
  variantCounts: Record<string, number>;
}

// ============================================================================
// State Stores
// ============================================================================

const flagsStore = new Map<string, FeatureFlag>();
const metricsByFlag = new Map<string, FlagMetrics>();
let flagsHydrated = false;

function hydrateFeatureFlagsFromDb(): void {
  if (flagsHydrated) return;
  flagsHydrated = true;
  for (const row of kvGetAll<FeatureFlag>("feature_flags")) {
    if (!flagsStore.has(row.key)) {
      flagsStore.set(row.key, row.value);
    }
  }
  for (const row of kvGetAll<FlagMetrics>("feature_flag_metrics")) {
    if (!metricsByFlag.has(row.key)) {
      metricsByFlag.set(row.key, row.value);
    }
  }
}

function deterministicBucket(seed: string): number {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 8);
  const num = Number.parseInt(hex, 16);
  return num % 100;
}

function selectVariant(
  variants: Array<{ name: string; weight: number }> | undefined,
  seed: string,
): string | undefined {
  if (!variants || variants.length === 0) return undefined;
  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
  if (totalWeight <= 0) return variants[0]?.name;

  const hex = createHash("sha256")
    .update(`variant:${seed}`)
    .digest("hex")
    .slice(0, 8);
  const roll = Number.parseInt(hex, 16) % totalWeight;
  let cumulative = 0;
  for (const v of variants) {
    cumulative += v.weight;
    if (roll < cumulative) return v.name;
  }
  return variants[variants.length - 1]?.name;
}

function recordMetric(res: FlagEvaluationResult): void {
  hydrateFeatureFlagsFromDb();
  const m = metricsByFlag.get(res.key) ?? {
    key: res.key,
    evaluations: 0,
    enabledCount: 0,
    disabledCount: 0,
    variantCounts: {},
  };
  m.evaluations++;
  if (res.enabled) {
    m.enabledCount++;
    if (res.variant) {
      m.variantCounts[res.variant] = (m.variantCounts[res.variant] ?? 0) + 1;
    }
  } else {
    m.disabledCount++;
  }
  metricsByFlag.set(res.key, m);
  kvSet("feature_flag_metrics", res.key, m);
}

// ============================================================================
// CRUD & Evaluation
// ============================================================================

export function upsertFeatureFlag(
  input: z.input<typeof UpsertFeatureFlagSchema>,
): FeatureFlag {
  hydrateFeatureFlagsFromDb();
  const parsed = UpsertFeatureFlagSchema.parse(input);
  const flag: FeatureFlag = {
    ...parsed,
    updatedAt: new Date().toISOString(),
  };
  flagsStore.set(flag.key, flag);
  kvSet("feature_flags", flag.key, flag);
  return flag;
}

export function listFeatureFlags(): FeatureFlag[] {
  hydrateFeatureFlagsFromDb();
  return Array.from(flagsStore.values());
}

export function setFeatureFlagKillSwitch(
  key: string,
  killSwitch: boolean,
): FeatureFlag | undefined {
  hydrateFeatureFlagsFromDb();
  const existing = flagsStore.get(key);
  if (!existing) return undefined;
  existing.killSwitch = killSwitch;
  existing.updatedAt = new Date().toISOString();
  kvSet("feature_flags", key, existing);
  return existing;
}

export function evaluateFeatureFlag(
  key: string,
  context: FlagEvaluationContext = {},
): FlagEvaluationResult {
  hydrateFeatureFlagsFromDb();
  const flag = flagsStore.get(key);
  const identity = context.userId ?? context.workspaceId ?? "anonymous";
  const bucket = deterministicBucket(`${key}:${identity}`);

  if (!flag) {
    const res: FlagEvaluationResult = {
      key,
      enabled: false,
      reason: "not_found",
      bucket,
    };
    recordMetric(res);
    return res;
  }

  if (flag.killSwitch) {
    const res: FlagEvaluationResult = {
      key,
      enabled: false,
      reason: "kill_switch",
      bucket,
    };
    recordMetric(res);
    return res;
  }

  if (!flag.enabled) {
    const res: FlagEvaluationResult = {
      key,
      enabled: false,
      reason: "flag_disabled",
      bucket,
    };
    recordMetric(res);
    return res;
  }

  const variant = selectVariant(flag.variants, `${key}:${identity}`);

  if (context.userId && flag.targetUsers.includes(context.userId)) {
    const res: FlagEvaluationResult = {
      key,
      enabled: true,
      ...(variant !== undefined && { variant }),
      reason: "target_user",
      bucket,
    };
    recordMetric(res);
    return res;
  }

  if (
    context.workspaceId &&
    flag.targetWorkspaces.includes(context.workspaceId)
  ) {
    const res: FlagEvaluationResult = {
      key,
      enabled: true,
      ...(variant !== undefined && { variant }),
      reason: "target_workspace",
      bucket,
    };
    recordMetric(res);
    return res;
  }

  if (context.cohorts?.some((c) => flag.targetCohorts.includes(c))) {
    const res: FlagEvaluationResult = {
      key,
      enabled: true,
      ...(variant !== undefined && { variant }),
      reason: "target_cohort",
      bucket,
    };
    recordMetric(res);
    return res;
  }

  const included = bucket < flag.rolloutPercentage;
  const res: FlagEvaluationResult = {
    key,
    enabled: included,
    ...(included && variant !== undefined && { variant }),
    reason: included ? "rollout_included" : "rollout_excluded",
    bucket,
  };
  recordMetric(res);
  return res;
}

export function getFeatureFlagMetrics(key: string): FlagMetrics {
  hydrateFeatureFlagsFromDb();
  return (
    metricsByFlag.get(key) ?? {
      key,
      evaluations: 0,
      enabledCount: 0,
      disabledCount: 0,
      variantCounts: {},
    }
  );
}

export function clearFeatureFlagsForTesting(): void {
  flagsStore.clear();
  metricsByFlag.clear();
  kvClearNamespace("feature_flags");
  kvClearNamespace("feature_flag_metrics");
  flagsHydrated = true;
}

export function _evictFeatureFlagsCacheForTesting(): void {
  flagsStore.clear();
  metricsByFlag.clear();
  flagsHydrated = false;
}
