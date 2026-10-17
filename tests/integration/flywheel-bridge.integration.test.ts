/**
 * End-to-End Cross-Service Integration Tests for Flywheel Gateway.
 *
 * Exercises the full multi-driver agent lifecycle, live driver checkpoint capture,
 * SQLite write-through persistence & lazy read-through rehydration across
 * reservations/pipelines/git/git-sync, live collaboration graph & conflict engine,
 * velocity analytics endpoints, context pack builder (with CM memory + history),
 * and BR/BV beads endpoints in-process against a real SQLite database.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDriverRegistry } from "@flywheel/agent-drivers";
import { registerDrivers } from "../../apps/gateway/src/config/drivers";
import app from "../../apps/gateway/src/index";
import {
  _clearAllGitData,
  _evictGitCacheForTesting,
  assignBranch,
  getAssignment,
  getBranchAssignments,
} from "../../apps/gateway/src/services/git.service";
import {
  _clearAllSyncData,
  _evictSyncCacheForTesting,
  getOperation,
  queueSyncOperation,
} from "../../apps/gateway/src/services/git-sync.service";
import {
  _evictPipelineCacheForTesting,
  clearAll as clearAllPipelines,
  createPipeline,
  getPipeline,
} from "../../apps/gateway/src/services/pipeline.service";
import {
  _clearAllReservations,
  _evictReservationCacheForTesting,
  checkReservation,
  createReservation,
  getReservation,
  listReservations,
} from "../../apps/gateway/src/services/reservation.service";

describe("Flywheel Gateway Cross-Service Integration Suite", () => {
  beforeEach(() => {
    _clearAllReservations();
    clearAllPipelines();
    _clearAllGitData();
    _clearAllSyncData();
  });

  afterEach(() => {
    _clearAllReservations();
    clearAllPipelines();
    _clearAllGitData();
    _clearAllSyncData();
  });

  describe("1. Multi-Driver Registry & Agent Lifecycle + Checkpoint Live State", () => {
    test("registers all 4 drivers (sdk, acp, tmux, ntm) and propagates driver/provider/model through spawn -> send -> checkpoint -> terminate", async () => {
      const registry = getDriverRegistry();
      const registeredTypes = registry.getRegisteredTypes();
      expect(registeredTypes).toContain("sdk");
      expect(registeredTypes).toContain("acp");
      expect(registeredTypes).toContain("tmux");
      expect(registeredTypes).toContain("ntm");

      // Spawn an agent via ACP driver with explicit provider and model
      const spawnRes = await app.request("/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workingDirectory: "/data/projects/flywheel_gateway",
          driver: "acp",
          provider: "codex",
          model: "gpt-4.1",
          systemPrompt: "Integration test agent",
        }),
      });
      expect([200, 201]).toContain(spawnRes.status);
      const spawnBody = await spawnRes.json();
      const spawned = spawnBody.data ?? spawnBody;
      expect(spawned.agentId).toBeDefined();
      expect(spawned.driver).toBe("acp");
      expect(spawned.provider).toBe("codex");
      expect(spawned.model).toBe("gpt-4.1");

      const agentId = spawned.agentId as string;

      // Send a message to the agent
      const sendRes = await app.request(`/agents/${agentId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "user",
          content: "Verify cross-service checkpoint state",
        }),
      });
      expect([200, 202]).toContain(sendRes.status);

      // Create a checkpoint and verify live driver state was captured
      const cpRes = await app.request(`/sessions/${agentId}/checkpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "Pre-refactor integration checkpoint",
          tags: ["integration", "bridge"],
        }),
      });
      expect([200, 201]).toContain(cpRes.status);
      const cpBody = await cpRes.json();
      const checkpoint = cpBody.data ?? cpBody;
      const checkpointId = checkpoint.id as string;
      expect(checkpointId).toBeDefined();

      // Retrieve checkpoint details and export to verify live driver state
      const cpGetRes = await app.request(
        `/sessions/${agentId}/checkpoints/${checkpointId}`,
      );
      expect(cpGetRes.status).toBe(200);
      const cpDetailBody = await cpGetRes.json();
      const cpDetail = cpDetailBody.data ?? cpDetailBody;
      expect(cpDetail.conversationHistoryCount).toBeGreaterThanOrEqual(1);
      expect(cpDetail.hasToolState).toBe(true);

      const cpExportRes = await app.request(
        `/sessions/${agentId}/checkpoints/${checkpointId}/export`,
      );
      expect(cpExportRes.status).toBe(200);
      const cpExportBody = await cpExportRes.json();
      const cpExport = cpExportBody.data ?? cpExportBody;
      expect(cpExport.checkpoint.toolState?.driverType).toBe("acp");
      expect(cpExport.checkpoint.toolState?.provider).toBe("codex");
      expect(cpExport.checkpoint.toolState?.model).toBe("gpt-4.1");

      // Terminate the agent cleanly
      const termRes = await app.request(`/agents/${agentId}`, {
        method: "DELETE",
      });
      expect([200, 202, 204]).toContain(termRes.status);
    });
  });

  describe("2. SQLite Write-Through & Lazy Read-Through Rehydration", () => {
    test("persists reservations, pipelines, git branch assignments, and git sync operations across in-memory cache eviction", async () => {
      // 1. File Reservations
      const resCreated = await createReservation({
        projectId: "/data/projects/flywheel_gateway",
        agentId: "agent-alpha",
        patterns: ["apps/gateway/src/services/**"],
        mode: "exclusive",
        ttl: 600,
        reason: "SQLite persistence verification",
      });
      expect(resCreated.granted).toBe(true);
      const reservationId = resCreated.reservation!.id;

      // 2. Pipelines
      const pipeline = await createPipeline({
        name: "Integration Verification Pipeline",
        description: "Persisted across cache eviction",
        trigger: {
          type: "manual",
          config: { type: "manual", config: {} },
        },
        steps: [
          {
            id: "step-1",
            name: "Run contract checks",
            type: "agent_task",
            config: {
              type: "agent_task",
              config: {
                prompt: "Verify API schemas",
              },
            },
          },
        ],
      });
      expect(pipeline.id).toBeDefined();

      // 3. Git Branch Assignment
      const branchAssign = await assignBranch({
        repositoryId: "repo-integration",
        agentId: "agent-alpha",
        branchName: "feat/sqlite-rehydration",
        baseBranch: "main",
        taskId: "bd-rza6z.7",
      });
      expect(branchAssign.granted).toBe(true);
      const assignmentId = branchAssign.assignment!.id;

      // 4. Git Sync Operation
      const syncOp = await queueSyncOperation({
        repositoryId: "repo-integration",
        agentId: "agent-alpha",
        operation: "push",
        branch: "feat/sqlite-rehydration",
        priority: 5,
      });
      expect(syncOp.id).toBeDefined();

      // Simulate Gateway process restart by evicting all in-memory Maps
      _evictReservationCacheForTesting();
      _evictPipelineCacheForTesting();
      _evictGitCacheForTesting();
      _evictSyncCacheForTesting();

      // Verify transparent read-through rehydration from SQLite
      const rehydratedRes = await getReservation(reservationId);
      expect(rehydratedRes).not.toBeNull();
      expect(rehydratedRes?.agentId).toBe("agent-alpha");
      expect(rehydratedRes?.patterns).toEqual(["apps/gateway/src/services/**"]);

      const conflictCheck = await checkReservation({
        projectId: "/data/projects/flywheel_gateway",
        agentId: "agent-beta",
        filePath: "apps/gateway/src/services/context.service.ts",
      });
      expect(conflictCheck.allowed).toBe(false);
      expect(conflictCheck.heldBy).toBe("agent-alpha");

      const rehydratedPipeline = getPipeline(pipeline.id);
      expect(rehydratedPipeline).toBeDefined();
      expect(rehydratedPipeline?.name).toBe(
        "Integration Verification Pipeline",
      );

      const rehydratedAssignment = await getAssignment(assignmentId);
      expect(rehydratedAssignment).not.toBeNull();
      expect(rehydratedAssignment?.branchName).toBe("feat/sqlite-rehydration");
      expect((await getBranchAssignments("repo-integration")).length).toBe(1);

      const rehydratedSyncOp = await getOperation(syncOp.id);
      expect(rehydratedSyncOp).not.toBeNull();
      expect(rehydratedSyncOp?.request.branch).toBe("feat/sqlite-rehydration");
    });
  });

  describe("3. Collaboration Graph, Conflict Engine & Velocity Analytics Endpoints", () => {
    test("exposes live reservations and conflicts through /collaboration/* and metrics through /velocity/*", async () => {
      // Create an active reservation and trigger a conflict
      await createReservation({
        projectId: "/data/projects/flywheel_gateway",
        agentId: "agent-holder",
        patterns: ["apps/web/src/pages/**"],
        mode: "exclusive",
        ttl: 600,
      });
      const conflicting = await createReservation({
        projectId: "/data/projects/flywheel_gateway",
        agentId: "agent-requester",
        patterns: ["apps/web/src/pages/Dashboard.tsx"],
        mode: "exclusive",
        ttl: 600,
      });
      expect(conflicting.granted).toBe(false);
      expect(conflicting.conflicts.length).toBeGreaterThan(0);

      // Query /collaboration/graph
      const graphRes = await app.request("/collaboration/graph");
      expect(graphRes.status).toBe(200);
      const graphBody = await graphRes.json();
      const graphData = graphBody.data ?? graphBody;
      expect(Array.isArray(graphData.agents)).toBe(true);
      expect(Array.isArray(graphData.reservations)).toBe(true);
      expect(Array.isArray(graphData.edges)).toBe(true);
      expect(graphData.stats.totalReservations).toBeGreaterThanOrEqual(1);

      // Query /collaboration/reservations
      const resList = await listReservations({
        projectId: "/data/projects/flywheel_gateway",
      });
      expect(resList.reservations.length).toBe(1);

      const collabRes = await app.request("/collaboration/reservations");
      expect(collabRes.status).toBe(200);
      const collabResBody = await collabRes.json();
      const collabReservations = collabResBody.data ?? collabResBody;
      expect(Array.isArray(collabReservations)).toBe(true);
      expect(collabReservations.length).toBeGreaterThanOrEqual(1);

      // Query /velocity/score, /velocity/stages, /velocity/learning
      const scoreRes = await app.request("/velocity/score");
      expect(scoreRes.status).toBe(200);
      const scoreBody = await scoreRes.json();
      const scoreData = scoreBody.data ?? scoreBody;
      expect(typeof scoreData.overall_score).toBe("number");
      expect(scoreData.components).toBeDefined();

      const stagesRes = await app.request("/velocity/stages");
      expect(stagesRes.status).toBe(200);
      const stagesBody = await stagesRes.json();
      const stagesData = stagesBody.data ?? stagesBody;
      expect(stagesData.plan).toBeDefined();
      expect(stagesData.coordinate).toBeDefined();
      expect(stagesData.execute).toBeDefined();
      expect(stagesData.scan).toBeDefined();
      expect(stagesData.remember).toBeDefined();
    });
  });

  describe("4. Context Pack Builder & Beads Live Integration", () => {
    test("builds structured context packs with memory and history sections and serves live BR/BV beads", async () => {
      // Build a context pack via POST /sessions/:sessionId/context/build
      const ctxRes = await app.request(
        "/sessions/sess-integration-1/context/build",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskContext: "Close vision-to-code bridge gaps in flywheel_gateway",
            maxTokens: 8000,
            searchQuery: "sqlite persistence and multi-driver registry",
          }),
        },
      );
      expect([200, 201]).toContain(ctxRes.status);
      const ctxBody = await ctxRes.json();
      const pack = ctxBody.data ?? ctxBody;
      expect(pack.id).toBeDefined();
      expect(pack.budget.total).toBe(8000);
      expect(pack.sections.memory).toBeDefined();
      expect(pack.sections.history).toBeDefined();

      // Query live /beads and /beads/:id
      const beadsRes = await app.request("/beads?status=closed&limit=3");
      expect(beadsRes.status).toBe(200);
      const beadsBody = await beadsRes.json();
      expect(beadsBody.data.beads.length).toBeGreaterThan(0);

      const missingBeadRes = await app.request(
        "/beads/bd-does-not-exist-99999",
      );
      expect(missingBeadRes.status).toBe(404);
    }, 15000);
  });
});
