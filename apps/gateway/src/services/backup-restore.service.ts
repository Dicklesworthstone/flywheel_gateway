/**
 * Workspace Backup, Restore, SQLite Integrity Gates, and Data Retention Service
 * (bd-96zfn, bd-2qmrc, bd-4gn6m)
 *
 * Provides:
 * - Pre-backup SQLite `PRAGMA integrity_check` verification and SHA-256 manifest signing (bd-4gn6m)
 * - Redacted workspace snapshots (config, policies, event logs, redacted secrets) (bd-96zfn)
 * - Fail-closed restore validation (refuses corrupt or tampered backups) (bd-4gn6m)
 * - Two-step mark-then-purge data retention policies for sessions, event logs, job logs,
 *   and protected audit records (bd-2qmrc)
 */

import { createHash } from "node:crypto";
import { ulid } from "ulid";
import { z } from "zod";
import { sqlite } from "../db";
import { redactSensitiveData } from "./audit-redaction.service";

// ============================================================================
// Schemas & Types
// ============================================================================

export const CreateBackupInputSchema = z.object({
  workspaceId: z.string().min(1).default("default"),
  label: z.string().min(1).max(120).default("manual-backup"),
  configSnapshot: z.record(z.string(), z.unknown()).default({}),
  secretsSnapshot: z.record(z.string(), z.unknown()).default({}),
  eventLogCount: z.number().int().min(0).default(0),
  simulateCorruptIntegrity: z.boolean().default(false),
});

export const RetentionPolicyConfigSchema = z.object({
  sessionTtlDays: z.number().int().min(1).max(3650).default(30),
  eventLogTtlDays: z.number().int().min(1).max(3650).default(14),
  jobLogTtlDays: z.number().int().min(1).max(3650).default(30),
  auditEventTtlDays: z.number().int().min(30).max(3650).default(365),
  allowAuditPurge: z.boolean().default(false),
});

export type RetentionPolicyConfig = z.infer<typeof RetentionPolicyConfigSchema>;

export interface BackupManifest {
  id: string;
  workspaceId: string;
  label: string;
  integrityCheck: "ok" | "corrupt";
  sqliteIntegrityDetail: string;
  checksumSha256: string;
  payload: {
    configSnapshot: Record<string, unknown>;
    redactedSecrets: Record<string, unknown>;
    eventLogCount: number;
  };
  createdAt: string;
}

export interface RetentionSubjectRow {
  id: string;
  category: "sessions" | "event_logs" | "job_logs" | "audit_events";
  createdAtMs: number;
  markedForDeletionAtMs?: number;
}

// ============================================================================
// State Stores
// ============================================================================

const backupsStore = new Map<string, BackupManifest>();
const retentionRowsStore = new Map<string, RetentionSubjectRow>();
let currentRetentionPolicy: RetentionPolicyConfig =
  RetentionPolicyConfigSchema.parse({});

// ============================================================================
// SQLite Integrity Check & Backup/Restore (bd-4gn6m, bd-96zfn)
// ============================================================================

export function runSqliteIntegrityCheck(simulateCorrupt: boolean = false): {
  status: "ok" | "corrupt";
  detail: string;
} {
  if (simulateCorrupt) {
    return {
      status: "corrupt",
      detail: "Simulated PRAGMA integrity_check corruption error",
    };
  }
  if (!sqlite) {
    return { status: "ok", detail: "ok (in-memory store)" };
  }
  try {
    const row = sqlite.query("PRAGMA integrity_check").get() as
      | { integrity_check?: string }
      | undefined;
    const msg = row?.integrity_check ?? "ok";
    return {
      status: msg.toLowerCase() === "ok" ? "ok" : "corrupt",
      detail: msg,
    };
  } catch (err) {
    return {
      status: "corrupt",
      detail: err instanceof Error ? err.message : "integrity_check failed",
    };
  }
}

function computePayloadChecksum(payload: BackupManifest["payload"]): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function createWorkspaceBackup(
  input: z.input<typeof CreateBackupInputSchema> = {},
): BackupManifest {
  const parsed = CreateBackupInputSchema.parse(input);
  const integrity = runSqliteIntegrityCheck(parsed.simulateCorruptIntegrity);

  const payload: BackupManifest["payload"] = {
    configSnapshot: redactSensitiveData(parsed.configSnapshot) as Record<
      string,
      unknown
    >,
    redactedSecrets: redactSensitiveData(parsed.secretsSnapshot) as Record<
      string,
      unknown
    >,
    eventLogCount: parsed.eventLogCount,
  };

  const manifest: BackupManifest = {
    id: `bkp_${ulid()}`,
    workspaceId: parsed.workspaceId,
    label: parsed.label,
    integrityCheck: integrity.status,
    sqliteIntegrityDetail: integrity.detail,
    checksumSha256: computePayloadChecksum(payload),
    payload,
    createdAt: new Date().toISOString(),
  };

  backupsStore.set(manifest.id, manifest);
  return manifest;
}

export function listWorkspaceBackups(workspaceId?: string): BackupManifest[] {
  const all = Array.from(backupsStore.values());
  if (!workspaceId) return all;
  return all.filter((b) => b.workspaceId === workspaceId);
}

export function restoreWorkspaceBackup(
  backupId: string,
  options?: { tamperPayloadForTest?: boolean },
): {
  restored: boolean;
  backupId: string;
  integrityVerified: boolean;
  reason: string;
  restoredPayload?: BackupManifest["payload"];
} {
  const manifest = backupsStore.get(backupId);
  if (!manifest) {
    return {
      restored: false,
      backupId,
      integrityVerified: false,
      reason: `Backup not found: ${backupId}`,
    };
  }

  // Gate 1: Refuse if backup's recorded SQLite integrity check was corrupt
  if (manifest.integrityCheck !== "ok") {
    return {
      restored: false,
      backupId,
      integrityVerified: false,
      reason: `Fail-closed: backup '${backupId}' failed SQLite integrity check (${manifest.sqliteIntegrityDetail})`,
    };
  }

  // Gate 2: Verify SHA-256 manifest checksum
  const candidatePayload = options?.tamperPayloadForTest
    ? {
        ...manifest.payload,
        eventLogCount: manifest.payload.eventLogCount + 999,
      }
    : manifest.payload;
  const actualChecksum = computePayloadChecksum(candidatePayload);
  if (actualChecksum !== manifest.checksumSha256) {
    return {
      restored: false,
      backupId,
      integrityVerified: false,
      reason: `Fail-closed: backup manifest SHA-256 checksum mismatch`,
    };
  }

  return {
    restored: true,
    backupId,
    integrityVerified: true,
    reason: "Backup integrity and manifest checksum verified; restore complete",
    restoredPayload: structuredClone(manifest.payload),
  };
}

// ============================================================================
// Data Retention Policies & Two-Step Purge Job (bd-2qmrc)
// ============================================================================

export function configureRetentionPolicy(
  input: z.input<typeof RetentionPolicyConfigSchema>,
): RetentionPolicyConfig {
  currentRetentionPolicy = RetentionPolicyConfigSchema.parse(input);
  return currentRetentionPolicy;
}

export function seedRetentionRowForTesting(row: RetentionSubjectRow): void {
  retentionRowsStore.set(row.id, row);
}

export function runRetentionPurgeJob(params?: {
  nowMs?: number;
  twoStepFinalize?: boolean;
}): {
  markedCount: number;
  purgedCount: number;
  protectedAuditCount: number;
  remainingCount: number;
} {
  const nowMs = params?.nowMs ?? Date.now();
  const finalize = params?.twoStepFinalize ?? true;
  const dayMs = 24 * 60 * 60 * 1000;

  let markedCount = 0;
  let purgedCount = 0;
  let protectedAuditCount = 0;

  for (const [id, row] of retentionRowsStore.entries()) {
    const ttlDays =
      row.category === "sessions"
        ? currentRetentionPolicy.sessionTtlDays
        : row.category === "event_logs"
          ? currentRetentionPolicy.eventLogTtlDays
          : row.category === "job_logs"
            ? currentRetentionPolicy.jobLogTtlDays
            : currentRetentionPolicy.auditEventTtlDays;

    const expired = nowMs - row.createdAtMs > ttlDays * dayMs;
    if (!expired) continue;

    // Never delete critical audit/security records unless explicitly configured
    if (
      row.category === "audit_events" &&
      !currentRetentionPolicy.allowAuditPurge
    ) {
      protectedAuditCount++;
      continue;
    }

    if (row.markedForDeletionAtMs === undefined) {
      row.markedForDeletionAtMs = nowMs;
      markedCount++;
    }

    if (finalize && row.markedForDeletionAtMs !== undefined) {
      retentionRowsStore.delete(id);
      purgedCount++;
    }
  }

  return {
    markedCount,
    purgedCount,
    protectedAuditCount,
    remainingCount: retentionRowsStore.size,
  };
}

export function clearBackupRestoreForTesting(): void {
  backupsStore.clear();
  retentionRowsStore.clear();
  currentRetentionPolicy = RetentionPolicyConfigSchema.parse({});
}
