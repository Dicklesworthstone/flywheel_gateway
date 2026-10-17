/**
 * Latency and SLO Monitoring Service (bd-17yyv)
 *
 * Tracks rolling latency percentiles (p50/p95/p99) and latency heatmap buckets
 * per endpoint/operation, evaluates Service Level Objectives (SLOs) and error
 * budget burn rate, emits real-time breach alerts, records deployment/incident
 * annotations, ingests synthetic probe results, and exports observability snapshots.
 */

import { ulid } from "ulid";
import { z } from "zod";
import { routeAlert } from "./alert-channel.service";

// ============================================================================
// Schemas & Types
// ============================================================================

export const SloWindowSchema = z.enum(["1h", "6h", "24h"]);

export const CreateSloDefinitionSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(120),
  target: z.string().min(1),
  objectiveMs: z.number().positive(),
  errorBudgetPercent: z.number().min(0.01).max(50).default(1),
  window: SloWindowSchema.default("1h"),
});

export const SloAnnotationInputSchema = z.object({
  sloId: z.string().optional(),
  type: z.enum(["deployment", "incident", "config_change", "note"]),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  actor: z.string().default("operator"),
  timestamp: z.string().optional(),
});

export const SyntheticProbeResultSchema = z.object({
  probeName: z.string().min(1),
  target: z.string().min(1),
  latencyMs: z.number().min(0),
  success: z.boolean(),
  timestamp: z.string().optional(),
});

export type SloWindow = z.infer<typeof SloWindowSchema>;
export type CreateSloDefinitionInput = z.input<
  typeof CreateSloDefinitionSchema
>;

export interface SloDefinition {
  id: string;
  name: string;
  target: string;
  objectiveMs: number;
  errorBudgetPercent: number;
  window: SloWindow;
  createdAt: string;
  updatedAt: string;
}

export interface LatencySample {
  target: string;
  latencyMs: number;
  isError: boolean;
  timestampMs: number;
  isSynthetic?: boolean;
}

export interface SloEvaluationStatus {
  slo: SloDefinition;
  sampleCount: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  violationCount: number;
  violationRatePercent: number;
  burnRate: number;
  breached: boolean;
  heatmapBuckets: Record<string, number>;
  evaluatedAt: string;
}

export interface SloAnnotation {
  id: string;
  sloId?: string;
  type: "deployment" | "incident" | "config_change" | "note";
  title: string;
  description?: string;
  actor: string;
  timestamp: string;
}

// ============================================================================
// State Stores
// ============================================================================

const sloStore = new Map<string, SloDefinition>();
const samplesByTarget = new Map<string, LatencySample[]>();
const annotationsStore: SloAnnotation[] = [];
const probeResultsStore: Array<
  z.infer<typeof SyntheticProbeResultSchema> & { id: string }
> = [];

const WINDOW_DURATION_MS: Record<SloWindow, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx] ?? 0;
}

function computeHeatmap(latencies: number[]): Record<string, number> {
  const buckets: Record<string, number> = {
    "0-50ms": 0,
    "50-200ms": 0,
    "200-500ms": 0,
    "500-1000ms": 0,
    "1000ms+": 0,
  };
  for (const ms of latencies) {
    if (ms < 50) buckets["0-50ms"]!++;
    else if (ms < 200) buckets["50-200ms"]!++;
    else if (ms < 500) buckets["200-500ms"]!++;
    else if (ms < 1000) buckets["500-1000ms"]!++;
    else buckets["1000ms+"]!++;
  }
  return buckets;
}

// ============================================================================
// Core Operations
// ============================================================================

export function createSloDefinition(
  input: CreateSloDefinitionInput,
): SloDefinition {
  const parsed = CreateSloDefinitionSchema.parse(input);
  const nowIso = new Date().toISOString();
  const id = parsed.id ?? `slo_${ulid()}`;
  const existing = sloStore.get(id);

  const slo: SloDefinition = {
    id,
    name: parsed.name,
    target: parsed.target,
    objectiveMs: parsed.objectiveMs,
    errorBudgetPercent: parsed.errorBudgetPercent,
    window: parsed.window,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };

  sloStore.set(id, slo);
  return slo;
}

export function listSloDefinitions(): SloDefinition[] {
  return Array.from(sloStore.values());
}

export function recordLatencySample(params: {
  target: string;
  latencyMs: number;
  isError?: boolean;
  timestampMs?: number;
  isSynthetic?: boolean;
}): void {
  const sample: LatencySample = {
    target: params.target,
    latencyMs: params.latencyMs,
    isError: params.isError ?? false,
    timestampMs: params.timestampMs ?? Date.now(),
    ...(params.isSynthetic !== undefined && {
      isSynthetic: params.isSynthetic,
    }),
  };
  const list = samplesByTarget.get(params.target) ?? [];
  list.push(sample);
  samplesByTarget.set(params.target, list);
}

export function ingestSyntheticProbeResult(
  input: z.input<typeof SyntheticProbeResultSchema>,
  nowMs: number = Date.now(),
): z.infer<typeof SyntheticProbeResultSchema> & { id: string } {
  const parsed = SyntheticProbeResultSchema.parse(input);
  const timestampMs = parsed.timestamp ? Date.parse(parsed.timestamp) : nowMs;
  recordLatencySample({
    target: parsed.target,
    latencyMs: parsed.latencyMs,
    isError: !parsed.success,
    timestampMs,
    isSynthetic: true,
  });

  const record = {
    ...parsed,
    id: `prb_${ulid()}`,
    timestamp: parsed.timestamp ?? new Date(nowMs).toISOString(),
  };
  probeResultsStore.push(record);
  return record;
}

export async function evaluateSloStatuses(
  nowMs: number = Date.now(),
): Promise<SloEvaluationStatus[]> {
  const results: SloEvaluationStatus[] = [];

  for (const slo of sloStore.values()) {
    const windowMs = WINDOW_DURATION_MS[slo.window];
    const cutoffMs = nowMs - windowMs;
    const rawSamples = (samplesByTarget.get(slo.target) ?? []).filter(
      (s) => s.timestampMs >= cutoffMs,
    );

    const latencies = rawSamples.map((s) => s.latencyMs).sort((a, b) => a - b);
    const sampleCount = rawSamples.length;
    const p50Ms = computePercentile(latencies, 50);
    const p95Ms = computePercentile(latencies, 95);
    const p99Ms = computePercentile(latencies, 99);

    const violationCount = rawSamples.filter(
      (s) => s.isError || s.latencyMs > slo.objectiveMs,
    ).length;
    const violationRatePercent =
      sampleCount > 0
        ? Number(((violationCount / sampleCount) * 100).toFixed(2))
        : 0;
    const burnRate =
      slo.errorBudgetPercent > 0
        ? Number((violationRatePercent / slo.errorBudgetPercent).toFixed(2))
        : 0;
    const breached = p95Ms > slo.objectiveMs || burnRate > 1;

    const status: SloEvaluationStatus = {
      slo,
      sampleCount,
      p50Ms,
      p95Ms,
      p99Ms,
      violationCount,
      violationRatePercent,
      burnRate,
      breached,
      heatmapBuckets: computeHeatmap(latencies),
      evaluatedAt: new Date(nowMs).toISOString(),
    };

    if (breached && sampleCount > 0) {
      await routeAlert({
        id: `slo_breach_${ulid()}`,
        type: "slo_breach",
        title: `SLO Breached: ${slo.name} (${slo.target})`,
        body: `p95=${p95Ms}ms (objective=${slo.objectiveMs}ms), burnRate=${burnRate}x`,
        severity: burnRate >= 2 ? "critical" : "warning",
        category: "performance",
        source: { type: "slo", id: slo.id, name: slo.target },
        timestamp: status.evaluatedAt,
      }).catch(() => {});
    }

    results.push(status);
  }

  return results;
}

export function addSloAnnotation(
  input: z.input<typeof SloAnnotationInputSchema>,
): SloAnnotation {
  const parsed = SloAnnotationInputSchema.parse(input);
  const annotation: SloAnnotation = {
    id: `sloa_${ulid()}`,
    ...(parsed.sloId !== undefined && { sloId: parsed.sloId }),
    type: parsed.type,
    title: parsed.title,
    ...(parsed.description !== undefined && {
      description: parsed.description,
    }),
    actor: parsed.actor,
    timestamp: parsed.timestamp ?? new Date().toISOString(),
  };
  annotationsStore.push(annotation);
  return annotation;
}

export function listSloAnnotations(sloId?: string): SloAnnotation[] {
  if (!sloId) return [...annotationsStore];
  return annotationsStore.filter((a) => a.sloId === sloId);
}

export async function exportSloSnapshot(nowMs: number = Date.now()) {
  const statuses = await evaluateSloStatuses(nowMs);
  return {
    exportedAt: new Date(nowMs).toISOString(),
    slos: statuses,
    annotations: [...annotationsStore],
    syntheticProbes: [...probeResultsStore],
  };
}

export function clearSloForTesting(): void {
  sloStore.clear();
  samplesByTarget.clear();
  annotationsStore.length = 0;
  probeResultsStore.length = 0;
}
