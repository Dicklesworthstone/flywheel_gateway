/**
 * Backups, Restore & Retention (bd-96zfn, bd-2qmrc, bd-4gn6m),
 * Incremental Checkpoints & Diffs (bd-1qxhc, bd-qby4w),
 * Safety Policy Simulator (bd-1b6lz), Bead Dependency Graph (bd-1ouud),
 * and Audit Log Query Builder (bd-1jv2y) Tests
 */

import { beforeEach, describe, expect, test } from "bun:test";
import app from "../index";
import {
  clearBackupRestoreForTesting,
  configureRetentionPolicy,
  createWorkspaceBackup,
  restoreWorkspaceBackup,
  runRetentionPurgeJob,
  seedRetentionRowForTesting,
} from "../services/backup-restore.service";
import {
  clearCheckpointDeltasForTesting,
  computeCheckpointDiff,
  createIncrementalCheckpoint,
  reconstructCheckpointState,
} from "../services/checkpoint-delta.service";
import {
  buildBeadDependencyGraph,
  clearOpsAnalyticsForTesting,
  executeAuditQuery,
  seedAuditEntry,
  simulateSafetyPolicy,
} from "../services/ops-analytics.service";

describe("P3 Operational Resilience & Developer Experience Suite", () => {
  beforeEach(() => {
    delete process.env["GATEWAY_ADMIN_KEY"];
    clearBackupRestoreForTesting();
    clearCheckpointDeltasForTesting();
    clearOpsAnalyticsForTesting();
  });

  test("Workspace Backups & Restore: runs SQLite integrity_check, redacts secrets, and fails closed on corrupt or tampered backups (bd-96zfn, bd-4gn6m)", () => {
    const validBackup = createWorkspaceBackup({
      workspaceId: "ws-prod",
      label: "pre-migration",
      configSnapshot: { maxAgents: 25 },
      secretsSnapshot: { password: "my-secret-password" },
      eventLogCount: 150,
    });
    expect(validBackup.integrityCheck).toBe("ok");
    expect(validBackup.payload.redactedSecrets["password"]).toBe("[REMOVED]");

    const okRestore = restoreWorkspaceBackup(validBackup.id);
    expect(okRestore.restored).toBe(true);
    expect(okRestore.integrityVerified).toBe(true);

    // Tampered payload fails closed
    const tamperedRestore = restoreWorkspaceBackup(validBackup.id, {
      tamperPayloadForTest: true,
    });
    expect(tamperedRestore.restored).toBe(false);
    expect(tamperedRestore.reason).toContain("checksum mismatch");

    // Corrupt backup fails closed
    const corruptBackup = createWorkspaceBackup({
      workspaceId: "ws-prod",
      simulateCorruptIntegrity: true,
    });
    expect(corruptBackup.integrityCheck).toBe("corrupt");
    const corruptRestore = restoreWorkspaceBackup(corruptBackup.id);
    expect(corruptRestore.restored).toBe(false);
    expect(corruptRestore.reason).toContain("failed SQLite integrity check");
  });

  test("Data Retention Purge Job: purges expired sessions/logs in two steps while protecting critical audit records (bd-2qmrc)", () => {
    const now = Date.now();
    const fortyDaysAgo = now - 40 * 24 * 60 * 60 * 1000;

    configureRetentionPolicy({
      sessionTtlDays: 30,
      eventLogTtlDays: 14,
      jobLogTtlDays: 30,
      auditEventTtlDays: 30,
      allowAuditPurge: false,
    });

    seedRetentionRowForTesting({
      id: "sess-old",
      category: "sessions",
      createdAtMs: fortyDaysAgo,
    });
    seedRetentionRowForTesting({
      id: "evt-recent",
      category: "event_logs",
      createdAtMs: now - 1000,
    });
    seedRetentionRowForTesting({
      id: "aud-old",
      category: "audit_events",
      createdAtMs: fortyDaysAgo,
    });

    // Step 1: mark only
    const step1 = runRetentionPurgeJob({ nowMs: now, twoStepFinalize: false });
    expect(step1.markedCount).toBe(1);
    expect(step1.purgedCount).toBe(0);
    expect(step1.protectedAuditCount).toBe(1);

    // Step 2: finalize purge
    const step2 = runRetentionPurgeJob({ nowMs: now, twoStepFinalize: true });
    expect(step2.purgedCount).toBe(1);
    expect(step2.remainingCount).toBe(2); // recent event + protected audit
  });

  test("Incremental Checkpoint Streaming & Checkpoint Diff Viewer: computes deltas, reconstructs chains, and diffs checkpoints (bd-1qxhc, bd-qby4w)", () => {
    const c1 = createIncrementalCheckpoint({
      sessionId: "sess-chk",
      files: {
        "src/index.ts": "console.log('v1');",
        "src/old.ts": "export const old = 1;",
      },
      contextTokens: 5000,
      toolCalls: ["view_file"],
      decisions: ["Initial architecture"],
    });
    expect(c1.isFullSnapshot).toBe(true);

    const c2 = createIncrementalCheckpoint({
      sessionId: "sess-chk",
      files: {
        "src/index.ts": "console.log('v2');",
        "src/new.ts": "export const fresh = 2;",
      },
      contextTokens: 8200,
      toolCalls: ["view_file", "replace_file_content"],
      decisions: ["Initial architecture", "Added new.ts and removed old.ts"],
    });
    expect(c2.isFullSnapshot).toBe(false);
    expect(c2.delta?.additions.map((a) => a.key)).toEqual(["src/new.ts"]);
    expect(c2.delta?.modifications.map((m) => m.key)).toEqual(["src/index.ts"]);
    expect(c2.delta?.deletions).toEqual(["src/old.ts"]);

    const reconstructed = reconstructCheckpointState(c2.id);
    expect(reconstructed?.files["src/new.ts"]).toBe("export const fresh = 2;");
    expect(reconstructed?.files["src/old.ts"]).toBeUndefined();
    expect(reconstructed?.contextTokens).toBe(8200);

    const diff = computeCheckpointDiff(c1.id, c2.id);
    expect(diff?.fileChanges.added).toEqual(["src/new.ts"]);
    expect(diff?.fileChanges.modified).toEqual(["src/index.ts"]);
    expect(diff?.fileChanges.deleted).toEqual(["src/old.ts"]);
    expect(diff?.contextDelta.deltaTokens).toBe(3200);
    expect(diff?.toolCallDelta.added).toEqual(["replace_file_content"]);
  });

  test("Safety Policy Simulator, Bead Dependency Graph, and Audit Log Query Builder work end-to-end (bd-1b6lz, bd-1ouud, bd-1jv2y)", async () => {
    // 1. Safety Policy Simulator (bd-1b6lz)
    const simBlock = simulateSafetyPolicy({
      command: "git reset --hard HEAD~1",
    });
    expect(simBlock.allowed).toBe(false);
    expect(simBlock.outcome).toBe("blocked");

    const simSlb = simulateSafetyPolicy({ command: "deploy --env production" });
    expect(simSlb.allowed).toBe(false);
    expect(simSlb.outcome).toBe("require_approval");

    // 2. Bead Dependency Graph Visualization (bd-1ouud)
    const graph = buildBeadDependencyGraph([
      { id: "bd-1", title: "Foundation", status: "open", blockedBy: [] },
      {
        id: "bd-2",
        title: "Service Layer",
        status: "open",
        blockedBy: ["bd-1"],
      },
      { id: "bd-3", title: "API Routes", status: "open", blockedBy: ["bd-2"] },
      { id: "bd-4", title: "Docs", status: "open", blockedBy: ["bd-1"] },
    ]);
    expect(graph.metrics.cycleDetected).toBe(false);
    expect(graph.metrics.criticalPath).toEqual(["bd-1", "bd-2", "bd-3"]);
    expect(graph.metrics.topBottlenecks[0]?.id).toBe("bd-1");
    expect(graph.metrics.topBottlenecks[0]?.unblocksCount).toBe(2);

    // 3. Audit Log Query Builder (bd-1jv2y)
    seedAuditEntry({
      actor: "admin-1",
      action: "agent.terminate",
      resource: "agent:a1",
      outcome: "success",
      workspaceId: "ws-1",
    });
    seedAuditEntry({
      actor: "viewer-1",
      action: "agent.terminate",
      resource: "agent:a2",
      outcome: "denied",
      workspaceId: "ws-1",
    });

    const queryResult = executeAuditQuery(
      {
        name: "Denied Actions",
        filters: [{ field: "outcome", operator: "eq", value: "denied" }],
        groupBy: "actor",
      },
      "csv",
    );
    expect(queryResult.totalMatched).toBe(1);
    expect(queryResult.groups?.["viewer-1"]).toBe(1);
    expect(queryResult.csv).toContain("viewer-1,agent.terminate");

    // Verify HTTP route
    const httpRes = await app.request("/backups/safety-simulator/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "rm -rf /tmp/foo" }),
    });
    expect(httpRes.status).toBe(200);
    const httpBody = (await httpRes.json()) as {
      data: { outcome: string };
    };
    expect(httpBody.data.outcome).toBe("blocked");
  });
});
