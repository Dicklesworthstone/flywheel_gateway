/**
 * Cost Attribution Custom Tags Service (bd-1hnyy)
 *
 * Manages custom cost attribution tag definitions, scoped tag assignments
 * (agent < session < task < manual inheritance), cost record tag resolution,
 * retroactive manual tagging, and cost aggregation by custom tag dimension.
 */

import { ulid } from "ulid";
import { z } from "zod";

// ============================================================================
// Schemas & Types
// ============================================================================

export const TagDefinitionSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_.-]+$/i, "Invalid tag key"),
  description: z.string().max(300).default(""),
  allowedValues: z.array(z.string().min(1)).optional(),
  required: z.boolean().default(false),
  defaultValue: z.string().optional(),
});

export const TagScopeAssignmentSchema = z.object({
  scope: z.enum(["agent", "session", "task"]),
  targetId: z.string().min(1),
  tags: z.record(z.string(), z.string()),
});

export const RecordTaggedCostSchema = z.object({
  id: z.string().optional(),
  amountUsd: z.number().min(0),
  agentId: z.string().optional(),
  sessionId: z.string().optional(),
  taskId: z.string().optional(),
  manualTags: z.record(z.string(), z.string()).optional(),
  timestamp: z.string().optional(),
});

export type TagDefinition = z.infer<typeof TagDefinitionSchema>;

export interface TaggedCostRecord {
  id: string;
  amountUsd: number;
  agentId?: string;
  sessionId?: string;
  taskId?: string;
  tags: Record<string, string>;
  timestamp: string;
}

// ============================================================================
// State Stores
// ============================================================================

const tagDefinitionsStore = new Map<string, TagDefinition>();
const agentTagsStore = new Map<string, Record<string, string>>();
const sessionTagsStore = new Map<string, Record<string, string>>();
const taskTagsStore = new Map<string, Record<string, string>>();
const costRecordsStore = new Map<string, TaggedCostRecord>();

// ============================================================================
// Tag Definitions & Validation
// ============================================================================

export function upsertTagDefinition(
  input: z.input<typeof TagDefinitionSchema>,
): TagDefinition {
  const parsed = TagDefinitionSchema.parse(input);
  tagDefinitionsStore.set(parsed.key, parsed);
  return parsed;
}

export function listTagDefinitions(): TagDefinition[] {
  return Array.from(tagDefinitionsStore.values());
}

function validateTagsAgainstDefinitions(
  tags: Record<string, string>,
  enforceRequired: boolean = false,
): void {
  for (const [k, v] of Object.entries(tags)) {
    const def = tagDefinitionsStore.get(k);
    if (def?.allowedValues?.length && !def.allowedValues.includes(v)) {
      throw new Error(
        `Tag '${k}' value '${v}' is not in allowedValues: [${def.allowedValues.join(", ")}]`,
      );
    }
  }

  if (enforceRequired) {
    for (const def of tagDefinitionsStore.values()) {
      if (def.required && tags[def.key] === undefined && !def.defaultValue) {
        throw new Error(`Required cost tag '${def.key}' is missing`);
      }
    }
  }
}

// ============================================================================
// Scoped Tag Assignments & Resolution (agent < session < task < manual)
// ============================================================================

export function assignScopedCostTags(
  input: z.input<typeof TagScopeAssignmentSchema>,
): Record<string, string> {
  const parsed = TagScopeAssignmentSchema.parse(input);
  validateTagsAgainstDefinitions(parsed.tags, false);

  const store =
    parsed.scope === "agent"
      ? agentTagsStore
      : parsed.scope === "session"
        ? sessionTagsStore
        : taskTagsStore;

  const merged = {
    ...(store.get(parsed.targetId) ?? {}),
    ...parsed.tags,
  };
  store.set(parsed.targetId, merged);
  return merged;
}

export function resolveCostTags(params: {
  agentId?: string;
  sessionId?: string;
  taskId?: string;
  manualTags?: Record<string, string>;
}): Record<string, string> {
  const defaults: Record<string, string> = {};
  for (const def of tagDefinitionsStore.values()) {
    if (def.defaultValue !== undefined) {
      defaults[def.key] = def.defaultValue;
    }
  }

  const agentTags = params.agentId
    ? (agentTagsStore.get(params.agentId) ?? {})
    : {};
  const sessionTags = params.sessionId
    ? (sessionTagsStore.get(params.sessionId) ?? {})
    : {};
  const taskTags = params.taskId
    ? (taskTagsStore.get(params.taskId) ?? {})
    : {};

  // Inheritance hierarchy: defaults < agent < session < task < manual
  const resolved = {
    ...defaults,
    ...agentTags,
    ...sessionTags,
    ...taskTags,
    ...(params.manualTags ?? {}),
  };

  validateTagsAgainstDefinitions(resolved, true);
  return resolved;
}

export function recordTaggedCost(
  input: z.input<typeof RecordTaggedCostSchema>,
): TaggedCostRecord {
  const parsed = RecordTaggedCostSchema.parse(input);
  const resolvedTags = resolveCostTags({
    ...(parsed.agentId !== undefined && { agentId: parsed.agentId }),
    ...(parsed.sessionId !== undefined && { sessionId: parsed.sessionId }),
    ...(parsed.taskId !== undefined && { taskId: parsed.taskId }),
    ...(parsed.manualTags !== undefined && { manualTags: parsed.manualTags }),
  });

  const record: TaggedCostRecord = {
    id: parsed.id ?? `tcr_${ulid()}`,
    amountUsd: parsed.amountUsd,
    ...(parsed.agentId !== undefined && { agentId: parsed.agentId }),
    ...(parsed.sessionId !== undefined && { sessionId: parsed.sessionId }),
    ...(parsed.taskId !== undefined && { taskId: parsed.taskId }),
    tags: resolvedTags,
    timestamp: parsed.timestamp ?? new Date().toISOString(),
  };

  costRecordsStore.set(record.id, record);
  return record;
}

export function applyRetroactiveCostTags(
  recordIds: string[],
  tags: Record<string, string>,
): number {
  validateTagsAgainstDefinitions(tags, false);
  let updated = 0;
  for (const id of recordIds) {
    const rec = costRecordsStore.get(id);
    if (rec) {
      rec.tags = { ...rec.tags, ...tags };
      updated++;
    }
  }
  return updated;
}

export function aggregateCostsByTagKey(tagKey: string): {
  tagKey: string;
  slices: Array<{ value: string; totalUsd: number; recordCount: number }>;
  untaggedUsd: number;
} {
  const buckets = new Map<string, { totalUsd: number; recordCount: number }>();
  let untaggedUsd = 0;

  for (const rec of costRecordsStore.values()) {
    const val = rec.tags[tagKey];
    if (val === undefined) {
      untaggedUsd = Number((untaggedUsd + rec.amountUsd).toFixed(4));
      continue;
    }
    const existing = buckets.get(val) ?? { totalUsd: 0, recordCount: 0 };
    existing.totalUsd = Number((existing.totalUsd + rec.amountUsd).toFixed(4));
    existing.recordCount++;
    buckets.set(val, existing);
  }

  const slices = Array.from(buckets.entries())
    .map(([value, stats]) => ({
      value,
      totalUsd: stats.totalUsd,
      recordCount: stats.recordCount,
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd);

  return {
    tagKey,
    slices,
    untaggedUsd,
  };
}

export function clearCostTagsForTesting(): void {
  tagDefinitionsStore.clear();
  agentTagsStore.clear();
  sessionTagsStore.clear();
  taskTagsStore.clear();
  costRecordsStore.clear();
}
