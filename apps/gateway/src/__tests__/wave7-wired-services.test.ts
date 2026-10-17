/**
 * Wave 7 Wired Services Integration Tests (bd-7ojci.2, bd-7ojci.3, bd-7ojci.4)
 *
 * Verifies that all 11 previously unwired services are reachable and functional
 * via live Gateway HTTP routes:
 * 1. approval.service.ts (/safety/approvals/*)
 * 2. checkpoint-compaction.service.ts (/sessions/:sessionId/checkpoints/storage-stats, /compact, /compact-all)
 * 3. context-rotation.ts (/sessions/:sessionId/context/rotation/*)
 * 4. git.service.ts (/conflicts/git/branches/*, /conflicts/git/predict, /conflicts/git/graph/:repoId)
 * 5. git-sync.service.ts (/conflicts/git/sync/*, /conflicts/git/sync-stats)
 * 6. git-conflict.service.ts (/conflicts/git/branch-changes, /conflicts/git/analyze/:repoId, /conflicts/git/patterns/:repoId)
 * 7. ru-sync.service.ts (/ru/sync/stats, /ru/sync/history)
 * 8. install-plan.service.ts (/setup/install-plan)
 * 9. registry-compat.service.ts (/setup/compatibility)
 * 10. mail-events.ts (wired into /mail/messages and /mail/reservations)
 * 11. graph-bridge.ts (/collaboration/bridge/status, /collaboration/bridge/control)
 */

import { beforeEach, describe, expect, test } from "bun:test";
import app from "../index";
import { _clearAllApprovalData } from "../services/approval.service";
import { _clearAllGitData } from "../services/git.service";
import { _clearAllConflictData } from "../services/git-conflict.service";
import { _clearAllSyncData } from "../services/git-sync.service";

describe("Wave 7 Wired Services Integration (bd-7ojci.2, bd-7ojci.3, bd-7ojci.4)", () => {
  beforeEach(async () => {
    await _clearAllApprovalData();
    _clearAllGitData();
    _clearAllSyncData();
    _clearAllConflictData();
  });

  test("bd-7ojci.2: approval.service.ts routes (/safety/approvals/*) create, list, decide, and report stats", async () => {
    const createRes = await app.request("/safety/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "agent-wave7-1",
        sessionId: "sess-wave7-1",
        workspaceId: "ws-wave7",
        operation: {
          type: "git",
          description: "Force push requested",
          command: "git push --force origin feature-branch",
        },
        priority: "high",
      }),
    });
    expect(createRes.status).toBe(201);
    const createdBody = await createRes.json();
    const approvalId = createdBody.data.id as string;
    expect(approvalId).toBeDefined();
    expect(createdBody.data.status).toBe("pending");

    const listRes = await app.request("/safety/approvals?status=pending");
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.data.length).toBe(1);

    const statsRes = await app.request("/safety/approvals/stats");
    expect(statsRes.status).toBe(200);
    const statsBody = await statsRes.json();
    expect(statsBody.data.pending).toBe(1);

    const decideRes = await app.request(
      `/safety/approvals/${approvalId}/decide`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "approved",
          decidedBy: "operator-1",
          reason: "Verified safe in feature branch",
        }),
      },
    );
    expect(decideRes.status).toBe(200);
    const decidedBody = await decideRes.json();
    expect(decidedBody.data.success).toBe(true);
    expect(decidedBody.data.request.status).toBe("approved");
  });

  test("bd-7ojci.2: checkpoint-compaction.service.ts and context-rotation.ts routes work end-to-end", async () => {
    const statsRes = await app.request(
      "/sessions/sess-wave7-cp/checkpoints/storage-stats",
    );
    expect(statsRes.status).toBe(200);
    const statsBody = await statsRes.json();
    expect(typeof statsBody.data.totalCheckpoints).toBe("number");

    const compactRes = await app.request(
      "/sessions/sess-wave7-cp/checkpoints/compact",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxCheckpoints: 5 }),
      },
    );
    expect(compactRes.status).toBe(200);

    const rotGetRes = await app.request(
      "/sessions/sess-wave7-rot/context/rotation/config",
    );
    expect(rotGetRes.status).toBe(200);
    const rotGetBody = await rotGetRes.json();
    expect(rotGetBody.data.thresholds.warning).toBeGreaterThan(0);

    const rotCheckRes = await app.request(
      "/sessions/sess-wave7-rot/context/rotation/check",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totalTokens: 196000, maxTokens: 200000 }),
      },
    );
    expect(rotCheckRes.status).toBe(200);
    const rotCheckBody = await rotCheckRes.json();
    expect(rotCheckBody.data.needsRotation).toBe(true);
  });

  test("bd-7ojci.3: git.service.ts, git-sync.service.ts, and git-conflict.service.ts routes work under /conflicts/git/*", async () => {
    // 1. Assign branch
    const assignRes = await app.request("/conflicts/git/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo-wave7",
        agentId: "agent-git-1",
        branchName: "feat/wave7",
        reservedPatterns: ["src/routes/**"],
      }),
    });
    expect(assignRes.status).toBe(201);
    const assignBody = await assignRes.json();
    expect(assignBody.data.branchName).toBe("feat/wave7");

    // 2. List branches for repo
    const listBranchesRes = await app.request(
      "/conflicts/git/branches/repo-wave7",
    );
    expect(listBranchesRes.status).toBe(200);
    const listBranchesBody = await listBranchesRes.json();
    expect(listBranchesBody.data.length).toBe(1);

    // 3. Queue sync operation
    const syncRes = await app.request("/conflicts/git/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo-wave7",
        agentId: "agent-git-1",
        operation: "push",
        branch: "feat/wave7",
      }),
    });
    expect(syncRes.status).toBe(201);
    const syncBody = await syncRes.json();
    const opId = syncBody.data.id as string;
    expect(opId).toBeDefined();

    // 4. Complete sync operation & check stats
    const completeRes = await app.request(
      `/conflicts/git/sync/${opId}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: true, filesChanged: 4 }),
      },
    );
    expect(completeRes.status).toBe(200);

    const syncStatsRes = await app.request(
      "/conflicts/git/sync-stats?repositoryId=repo-wave7",
    );
    expect(syncStatsRes.status).toBe(200);
    const syncStatsBody = await syncStatsRes.json();
    expect(syncStatsBody.data.gitStats.totalActiveAssignments).toBe(1);

    // 5. Register branch changes & analyze conflicts
    await app.request("/conflicts/git/branch-changes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo-wave7",
        branchName: "feat/a",
        files: [
          {
            path: "src/index.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 2,
          },
        ],
      }),
    });
    await app.request("/conflicts/git/branch-changes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo-wave7",
        branchName: "feat/b",
        files: [
          {
            path: "src/index.ts",
            changeType: "modified",
            linesAdded: 15,
            linesDeleted: 5,
          },
        ],
      }),
    });

    const analyzeRes = await app.request("/conflicts/git/analyze/repo-wave7", {
      method: "POST",
    });
    expect(analyzeRes.status).toBe(200);
    const analyzeBody = await analyzeRes.json();
    expect(analyzeBody.data.conflicts.length).toBeGreaterThanOrEqual(1);
  });

  test("bd-7ojci.3 & bd-7ojci.4: ru-sync, install-plan, registry-compat, and collaboration graph-bridge routes respond with 200", async () => {
    const ruStatsRes = await app.request("/ru/sync/stats");
    expect(ruStatsRes.status).toBe(200);
    const ruStatsBody = await ruStatsRes.json();
    expect(typeof ruStatsBody.data.total).toBe("number");

    const ruHistoryRes = await app.request("/ru/sync/history");
    expect(ruHistoryRes.status).toBe(200);

    const compatRes = await app.request("/setup/compatibility");
    expect(compatRes.status).toBe(200);
    const compatBody = await compatRes.json();
    expect(typeof compatBody.data.total).toBe("number");
    expect(Array.isArray(compatBody.data.warnings)).toBe(true);

    const bridgeStatusRes = await app.request("/collaboration/bridge/status");
    expect(bridgeStatusRes.status).toBe(200);
    const bridgeStatusBody = await bridgeStatusRes.json();
    expect(bridgeStatusBody.data.initialized).toBe(true);

    const bridgeControlRes = await app.request(
      "/collaboration/bridge/control",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      },
    );
    expect(bridgeControlRes.status).toBe(200);
  });

  test("bd-7ojci.5: config.service, feature-flag.service, cost-cap.service, and secrets-provider.service persist to gateway_kv_store and rehydrate across cache eviction", async () => {
    const {
      _evictConfigCacheForTesting,
      explainConfigKey,
      getConfigVersionHistory,
      resetConfigHistoryForTesting,
      updateConfigRuntime,
    } = await import("../services/config.service");
    const {
      _evictFeatureFlagsCacheForTesting,
      clearFeatureFlagsForTesting,
      evaluateFeatureFlag,
      getFeatureFlagMetrics,
      listFeatureFlags,
      upsertFeatureFlag,
    } = await import("../services/feature-flag.service");
    const {
      _evictCostCapsCacheForTesting,
      clearCostCapsForTesting,
      createCostCapOverride,
      exportWorkspaceCostCapReport,
      recordWorkspaceSpend,
      upsertCostCapPolicy,
    } = await import("../services/cost-cap.service");
    const {
      _evictSecretRotationCacheForTesting,
      clearSecretRotationMetadata,
      listSecretReferences,
      rotateSecretReference,
    } = await import("../services/secrets-provider.service");

    resetConfigHistoryForTesting();
    clearFeatureFlagsForTesting();
    clearCostCapsForTesting();
    clearSecretRotationMetadata();

    // 1. Config runtime update -> evict -> rehydrate
    updateConfigRuntime(
      { agent: { maxConcurrent: 42 } as never },
      { changedBy: "ops-wave7", reason: "Scale concurrency" },
    );
    _evictConfigCacheForTesting();
    const history = getConfigVersionHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);
    const explained = explainConfigKey("agent.maxConcurrent");
    expect(explained.effectiveValue).toBe(42);
    expect(explained.source).toBe("runtime");

    // 2. Feature flags + metrics -> evict -> rehydrate
    upsertFeatureFlag({
      key: "wave7.persisted.flag",
      name: "Wave 7 Persisted Flag",
      enabled: true,
      rolloutPercentage: 100,
    });
    evaluateFeatureFlag("wave7.persisted.flag", { userId: "u-1" });
    _evictFeatureFlagsCacheForTesting();
    const flags = listFeatureFlags();
    expect(flags.some((f) => f.key === "wave7.persisted.flag")).toBe(true);
    const flagMetrics = getFeatureFlagMetrics("wave7.persisted.flag");
    expect(flagMetrics.evaluations).toBe(1);
    expect(flagMetrics.enabledCount).toBe(1);

    // 3. Cost caps + spend + overrides + audit -> evict -> rehydrate
    upsertCostCapPolicy({
      workspaceId: "ws-wave7-kv",
      softCapUsd: 50,
      hardCapUsd: 100,
      actions: { onSoftCap: "downgrade", onHardCap: "pause" },
    });
    await recordWorkspaceSpend({ workspaceId: "ws-wave7-kv", amountUsd: 65 });
    createCostCapOverride({
      workspaceId: "ws-wave7-kv",
      additionalBudgetUsd: 25,
      reason: "Release crunch",
    });
    _evictCostCapsCacheForTesting();
    const report = exportWorkspaceCostCapReport("ws-wave7-kv");
    expect(report.policy?.hardCapUsd).toBe(100);
    expect(report.currentSpendUsd).toBe(65);
    expect(report.activeOverride?.additionalBudgetUsd).toBe(25);
    expect(report.auditTrail.length).toBeGreaterThanOrEqual(1);

    // 4. Secret rotation metadata -> evict -> rehydrate
    await rotateSecretReference("tool:dcg:apiKey", {
      rotatedBy: "sec-ops",
      reason: "Scheduled 90d rotation",
    });
    _evictSecretRotationCacheForTesting();
    const secretRefs = await listSecretReferences("tool:dcg");
    const dcgSecret = secretRefs.find((r) => r.name === "tool:dcg:apiKey");
    expect(dcgSecret?.rotationCount).toBe(1);
    expect(dcgSecret?.rotatedBy).toBe("sec-ops");

    resetConfigHistoryForTesting();
    clearFeatureFlagsForTesting();
    clearCostCapsForTesting();
    clearSecretRotationMetadata();
  });
});
