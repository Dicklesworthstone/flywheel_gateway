/**
 * Support Bundle and Diagnostics Export Service (bd-1efrp, bd-163rq, bd-pwca9)
 *
 * Gathers gateway build/runtime info, sanitized configuration, circuit breaker
 * state, WebSocket hub stats, recent events/logs/jobs, and a redaction report
 * into a portable, secret-scrubbed support bundle.
 *
 * Also provides:
 * - Manifest preview with per-source size estimates and data-minimization warnings
 * - Retention cleanup for expired bundles
 * - Fail-closed sanitized repro harness (`replaySupportBundle`) for local debugging
 */

import { ulid } from "ulid";
import { getCorrelationId, getTraceId } from "../middleware/correlation";
import { getHub } from "../ws/hub";
import {
  containsSensitiveData,
  type RedactionReport,
  redactSensitiveDataWithReport,
} from "./audit-redaction.service";
import {
  type BuildInfo,
  type Capabilities,
  getBuildInfo,
  getCapabilities,
  getRuntimeInfo,
  type RuntimeInfo,
} from "./build-info";
import { getAllBreakerStatuses } from "./circuit-breaker.service";
import { getConfig } from "./config.service";
import { logger } from "./logger";

export type SupportBundleSource =
  | "build"
  | "config"
  | "health"
  | "ws"
  | "logs"
  | "events"
  | "jobs";

export interface SupportBundleOptions {
  includeSources?: SupportBundleSource[] | undefined;
  logLimit?: number | undefined;
  eventLimit?: number | undefined;
  retentionMinutes?: number | undefined;
  createdBy?: string | undefined;
  /** Optional seeded entries (used by callers or test suites) */
  seedLogs?: Array<Record<string, unknown>> | undefined;
  seedEvents?: Array<Record<string, unknown>> | undefined;
  seedJobs?: Array<Record<string, unknown>> | undefined;
  seedConfigOverride?: Record<string, unknown> | undefined;
}

export interface SupportBundleSourceEstimate {
  source: SupportBundleSource;
  included: boolean;
  estimatedBytes: number;
}

export interface SupportBundlePreview {
  schemaVersion: "1.0.0";
  generatedAt: string;
  traceId?: string;
  sources: SupportBundleSourceEstimate[];
  totalEstimatedBytes: number;
  dataMinimizationWarnings: string[];
  requiredCoreFields: string[];
}

export interface SupportBundleManifest {
  id: string;
  schemaVersion: "1.0.0";
  createdAt: string;
  expiresAt: string;
  createdBy: string;
  correlationId: string;
  traceId?: string;
  includedSources: SupportBundleSource[];
  redactionReport: RedactionReport & { verifiedClean: boolean };
}

export interface SupportBundleArtifact {
  manifest: SupportBundleManifest;
  buildInfo: BuildInfo;
  runtimeInfo: RuntimeInfo;
  capabilities: Capabilities;
  config: Record<string, unknown>;
  health: {
    circuits: Record<string, unknown>;
  };
  ws: Record<string, unknown>;
  logs: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  jobs: Array<Record<string, unknown>>;
}

export interface SupportBundleStatus {
  id: string;
  status: "ready" | "expired";
  createdAt: string;
  expiresAt: string;
  retentionRemainingMs: number;
  sizeBytes: number;
  manifest: SupportBundleManifest;
}

export interface ReproHarnessResult {
  bundleId: string;
  verifiedSanitized: boolean;
  replayedEventsCount: number;
  replayedJobsCount: number;
  failedJobIds: string[];
  openCircuits: string[];
  errorLogsCount: number;
  actionableDiagnostics: string[];
}

const DEFAULT_SOURCES: SupportBundleSource[] = [
  "build",
  "config",
  "health",
  "ws",
  "logs",
  "events",
  "jobs",
];

const DEFAULT_RETENTION_MINUTES = 60;

const bundleStore = new Map<
  string,
  { artifact: SupportBundleArtifact; sizeBytes: number }
>();

function collectRawData(options?: SupportBundleOptions) {
  const included = new Set<SupportBundleSource>(
    options?.includeSources ?? DEFAULT_SOURCES,
  );
  // Core fields (build, config, logs) are always required by validation
  included.add("build");
  included.add("config");
  included.add("logs");

  const buildInfo = getBuildInfo();
  const runtimeInfo = getRuntimeInfo();
  const capabilities = getCapabilities();

  const rawConfig = {
    ...(getConfig() as unknown as Record<string, unknown>),
    ...(options?.seedConfigOverride ?? {}),
  };

  const circuits = included.has("health")
    ? Object.fromEntries(getAllBreakerStatuses().map((s) => [s.tool, s]))
    : {};
  const ws = included.has("ws")
    ? (getHub().getStats() as unknown as Record<string, unknown>)
    : {};

  const logLimit = options?.logLimit ?? 100;
  const eventLimit = options?.eventLimit ?? 100;

  const logs = (options?.seedLogs ?? []).slice(0, logLimit);
  const events = included.has("events")
    ? (options?.seedEvents ?? []).slice(0, eventLimit)
    : [];
  const jobs = included.has("jobs") ? (options?.seedJobs ?? []) : [];

  return {
    includedSources: Array.from(included),
    buildInfo,
    runtimeInfo,
    capabilities,
    config: rawConfig,
    health: { circuits },
    ws,
    logs,
    events,
    jobs,
  };
}

/**
 * Generate a manifest-only preview with per-source size estimates and
 * data-minimization warnings before creating the full archive.
 */
export function previewSupportBundle(
  options?: SupportBundleOptions,
): SupportBundlePreview {
  const raw = collectRawData(options);
  const includedSet = new Set(raw.includedSources);

  const sourcePayloads: Record<SupportBundleSource, unknown> = {
    build: {
      buildInfo: raw.buildInfo,
      runtimeInfo: raw.runtimeInfo,
      capabilities: raw.capabilities,
    },
    config: raw.config,
    health: raw.health,
    ws: raw.ws,
    logs: raw.logs,
    events: raw.events,
    jobs: raw.jobs,
  };

  const sources: SupportBundleSourceEstimate[] = DEFAULT_SOURCES.map(
    (source) => {
      const included = includedSet.has(source);
      const estimatedBytes = included
        ? Buffer.byteLength(JSON.stringify(sourcePayloads[source]), "utf8")
        : 0;
      return { source, included, estimatedBytes };
    },
  );

  const totalEstimatedBytes = sources.reduce(
    (sum, s) => sum + s.estimatedBytes,
    0,
  );

  const warnings: string[] = [];
  if ((options?.logLimit ?? 100) > 500) {
    warnings.push(
      "High logLimit (>500) increases bundle size; consider narrowing the time window.",
    );
  }
  if (includedSet.has("events") && (options?.eventLimit ?? 100) > 500) {
    warnings.push(
      "High eventLimit (>500) may include verbose WebSocket payloads.",
    );
  }
  if (containsSensitiveData(sourcePayloads)) {
    warnings.push(
      "Sensitive patterns detected in raw sources; automatic redaction will scrub them on export.",
    );
  }

  const traceId = getTraceId();
  return {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    ...(traceId !== undefined && { traceId }),
    sources,
    totalEstimatedBytes,
    dataMinimizationWarnings: warnings,
    requiredCoreFields: ["buildInfo", "config", "logs", "redactionReport"],
  };
}

/**
 * Create a sanitized support bundle, verify zero secret leakage, and store it
 * for status polling and download.
 */
export function createSupportBundle(
  options?: SupportBundleOptions,
): SupportBundleStatus {
  const raw = collectRawData(options);

  // Redact all mutable sections and collect redaction report
  const { data: sanitizedPayload, report } = redactSensitiveDataWithReport(
    {
      config: raw.config,
      health: raw.health,
      ws: raw.ws,
      logs: raw.logs,
      events: raw.events,
      jobs: raw.jobs,
    },
    { budgetMs: 250, shadowMode: false },
  );

  // Fail-closed verification: ensure no sensitive patterns remain after redaction
  const stillContainsSecrets = containsSensitiveData(sanitizedPayload);
  if (stillContainsSecrets) {
    throw new Error(
      "Support bundle redaction verification failed: sensitive data remained after scrubbing",
    );
  }

  const id = `sb_${ulid()}`;
  const now = new Date();
  const retentionMinutes =
    options?.retentionMinutes ?? DEFAULT_RETENTION_MINUTES;
  const expiresAt = new Date(now.getTime() + retentionMinutes * 60_000);
  const correlationId = getCorrelationId();
  const traceId = getTraceId();

  const manifest: SupportBundleManifest = {
    id,
    schemaVersion: "1.0.0",
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    createdBy: options?.createdBy ?? "system",
    correlationId,
    ...(traceId !== undefined && { traceId }),
    includedSources: raw.includedSources,
    redactionReport: {
      ...report,
      verifiedClean: true,
    },
  };

  const artifact: SupportBundleArtifact = {
    manifest,
    buildInfo: raw.buildInfo,
    runtimeInfo: raw.runtimeInfo,
    capabilities: raw.capabilities,
    config: sanitizedPayload.config,
    health: sanitizedPayload.health,
    ws: sanitizedPayload.ws,
    logs: sanitizedPayload.logs,
    events: sanitizedPayload.events,
    jobs: sanitizedPayload.jobs,
  };

  validateSupportBundleCoreFields(artifact);

  const serialized = JSON.stringify(artifact);
  const sizeBytes = Buffer.byteLength(serialized, "utf8");

  bundleStore.set(id, { artifact, sizeBytes });

  logger.info(
    {
      bundleId: id,
      createdBy: manifest.createdBy,
      sizeBytes,
      totalRedactions: report.totalRedactions,
      correlationId,
      traceId,
    },
    "Support bundle created",
  );

  return {
    id,
    status: "ready",
    createdAt: manifest.createdAt,
    expiresAt: manifest.expiresAt,
    retentionRemainingMs: Math.max(0, expiresAt.getTime() - Date.now()),
    sizeBytes,
    manifest,
  };
}

/**
 * Validate that a support bundle includes required core fields.
 */
export function validateSupportBundleCoreFields(
  artifact: SupportBundleArtifact,
): void {
  if (!artifact.buildInfo?.version) {
    throw new Error(
      "Support bundle missing required core field: buildInfo.version",
    );
  }
  if (!artifact.config || typeof artifact.config !== "object") {
    throw new Error("Support bundle missing required core field: config");
  }
  if (!Array.isArray(artifact.logs)) {
    throw new Error("Support bundle missing required core field: logs");
  }
  if (!artifact.manifest?.redactionReport?.verifiedClean) {
    throw new Error(
      "Support bundle missing required core field: verified redactionReport",
    );
  }
}

/**
 * Get status and remaining retention time for a support bundle.
 */
export function getSupportBundleStatus(
  id: string,
): SupportBundleStatus | undefined {
  const entry = bundleStore.get(id);
  if (!entry) return undefined;

  const expiresAtMs = new Date(entry.artifact.manifest.expiresAt).getTime();
  const remainingMs = Math.max(0, expiresAtMs - Date.now());
  const status = remainingMs > 0 ? "ready" : "expired";

  return {
    id,
    status,
    createdAt: entry.artifact.manifest.createdAt,
    expiresAt: entry.artifact.manifest.expiresAt,
    retentionRemainingMs: remainingMs,
    sizeBytes: entry.sizeBytes,
    manifest: entry.artifact.manifest,
  };
}

/**
 * Download a generated support bundle artifact if it exists and has not expired.
 */
export function downloadSupportBundle(
  id: string,
): SupportBundleArtifact | undefined {
  const entry = bundleStore.get(id);
  if (!entry) return undefined;

  const expiresAtMs = new Date(entry.artifact.manifest.expiresAt).getTime();
  if (expiresAtMs <= Date.now()) {
    bundleStore.delete(id);
    return undefined;
  }

  validateSupportBundleCoreFields(entry.artifact);
  return entry.artifact;
}

/**
 * Prune expired support bundles from storage.
 */
export function pruneExpiredSupportBundles(nowMs: number = Date.now()): number {
  let pruned = 0;
  for (const [id, entry] of bundleStore.entries()) {
    const expiresAtMs = new Date(entry.artifact.manifest.expiresAt).getTime();
    if (expiresAtMs <= nowMs) {
      bundleStore.delete(id);
      pruned++;
    }
  }
  return pruned;
}

/**
 * Sanitized Repro Harness (bd-pwca9):
 * Loads a support bundle artifact, fails closed if any unsanitized secrets are
 * present, replays WS events / job logs / circuit states, and produces
 * actionable local diagnostics.
 */
export function replaySupportBundle(
  artifact: SupportBundleArtifact,
): ReproHarnessResult {
  validateSupportBundleCoreFields(artifact);

  if (containsSensitiveData(artifact)) {
    throw new Error(
      "Refusing to replay support bundle: unsanitized sensitive data detected (fail-closed)",
    );
  }

  const failedJobIds: string[] = [];
  for (const job of artifact.jobs) {
    if (job["status"] === "failed" || job["status"] === "timeout") {
      failedJobIds.push(String(job["id"] ?? "unknown"));
    }
  }

  const openCircuits: string[] = [];
  const circuits = artifact.health?.circuits ?? {};
  for (const [name, stateObj] of Object.entries(circuits)) {
    const state = (stateObj as { state?: string } | undefined)?.state;
    if (state === "OPEN" || state === "HALF_OPEN") {
      openCircuits.push(name);
    }
  }

  let errorLogsCount = 0;
  for (const log of artifact.logs) {
    if (
      log["level"] === "error" ||
      log["level"] === 50 ||
      log["severity"] === "error"
    ) {
      errorLogsCount++;
    }
  }

  const actionableDiagnostics: string[] = [];
  if (openCircuits.length > 0) {
    actionableDiagnostics.push(
      `Degraded dependencies detected: circuits [${openCircuits.join(", ")}] are not CLOSED.`,
    );
  }
  if (failedJobIds.length > 0) {
    actionableDiagnostics.push(
      `Failed background jobs detected (${failedJobIds.length}): [${failedJobIds.join(", ")}].`,
    );
  }
  if (errorLogsCount > 0) {
    actionableDiagnostics.push(
      `Found ${errorLogsCount} error log entries in bundle window.`,
    );
  }
  if (actionableDiagnostics.length === 0) {
    actionableDiagnostics.push(
      "No failed jobs, open circuits, or error logs detected in bundle snapshot.",
    );
  }

  return {
    bundleId: artifact.manifest.id,
    verifiedSanitized: true,
    replayedEventsCount: artifact.events.length,
    replayedJobsCount: artifact.jobs.length,
    failedJobIds,
    openCircuits,
    errorLogsCount,
    actionableDiagnostics,
  };
}

export function clearSupportBundlesForTesting(): void {
  bundleStore.clear();
}
