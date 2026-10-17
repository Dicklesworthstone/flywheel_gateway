/**
 * Backups, Incremental Checkpoints, Checkpoint Diffs, Safety Simulator,
 * Bead Dependency Graph, and Audit Query Builder Routes
 * (bd-96zfn, bd-2qmrc, bd-4gn6m, bd-1qxhc, bd-qby4w, bd-1b6lz, bd-1ouud, bd-1jv2y)
 */

import { Hono } from "hono";
import { z } from "zod";
import { requireAdminMiddleware } from "../middleware/auth";
import {
  CreateBackupInputSchema,
  configureRetentionPolicy,
  createWorkspaceBackup,
  listWorkspaceBackups,
  RetentionPolicyConfigSchema,
  restoreWorkspaceBackup,
  runRetentionPurgeJob,
} from "../services/backup-restore.service";
import {
  CheckpointStateInputSchema,
  computeCheckpointDiff,
  createIncrementalCheckpoint,
  reconstructCheckpointState,
} from "../services/checkpoint-delta.service";
import {
  AuditQuerySpecSchema,
  BeadGraphInputNodeSchema,
  buildBeadDependencyGraph,
  executeAuditQuery,
  getSafetySimulationMetrics,
  listSafetyPolicyRules,
  saveAuditQuery,
  simulateSafetyPolicy,
} from "../services/ops-analytics.service";
import {
  sendCreated,
  sendError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const backups = new Hono();
backups.use("*", requireAdminMiddleware());

// ============================================================================
// Backups, Restore & Retention (bd-96zfn, bd-2qmrc, bd-4gn6m)
// ============================================================================

backups.get("/", (c) => {
  const workspaceId = c.req.query("workspaceId");
  const items = listWorkspaceBackups(workspaceId);
  return sendList(c, items, { total: items.length });
});

backups.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateBackupInputSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }
  const manifest = createWorkspaceBackup(parsed.data);
  return sendCreated(
    c,
    "workspace_backup",
    manifest,
    `/backups/${manifest.id}`,
  );
});

backups.post("/:id/restore", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as {
    tamperPayloadForTest?: boolean;
  };
  const res = restoreWorkspaceBackup(id, body);
  if (!res.restored) {
    return sendError(c, "INVALID_REQUEST", res.reason, 400);
  }
  return sendResource(c, "workspace_restore", res);
});

backups.put("/retention/policy", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = RetentionPolicyConfigSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }
  const policy = configureRetentionPolicy(parsed.data);
  return sendResource(c, "retention_policy", policy);
});

backups.post("/retention/purge", (c) => {
  const result = runRetentionPurgeJob();
  return sendResource(c, "retention_purge_result", result);
});

// ============================================================================
// Incremental Checkpoint Streaming & Checkpoint Diff Viewer (bd-1qxhc, bd-qby4w)
// ============================================================================

backups.post("/checkpoints", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CheckpointStateInputSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }
  const chk = createIncrementalCheckpoint(parsed.data);
  return sendCreated(
    c,
    "incremental_checkpoint",
    chk,
    `/backups/checkpoints/${chk.id}`,
  );
});

backups.get("/checkpoints/:id", (c) => {
  const id = c.req.param("id");
  const state = reconstructCheckpointState(id);
  if (!state) return sendNotFound(c, "checkpoint", id);
  return sendResource(c, "checkpoint_state", state);
});

backups.get("/checkpoints/:id/diff/:otherId", (c) => {
  const id = c.req.param("id");
  const otherId = c.req.param("otherId");
  const diff = computeCheckpointDiff(id, otherId);
  if (!diff) return sendNotFound(c, "checkpoint_diff", `${id}..${otherId}`);
  return sendResource(c, "checkpoint_diff", diff);
});

// ============================================================================
// Safety Policy Simulator (bd-1b6lz)
// ============================================================================

backups.get("/safety-simulator/rules", (c) => {
  return sendResource(c, "safety_policy_rules", listSafetyPolicyRules());
});

backups.post("/safety-simulator/simulate", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    command?: string;
    codeSnippet?: string;
  };
  const result = simulateSafetyPolicy(body);
  return sendResource(c, "safety_simulation", result);
});

backups.get("/safety-simulator/metrics", (c) => {
  return sendResource(
    c,
    "safety_simulation_metrics",
    getSafetySimulationMetrics(),
  );
});

// ============================================================================
// Bead Dependency Graph Visualization (bd-1ouud)
// ============================================================================

backups.post("/bead-graph", async (c) => {
  const body = await c.req.json().catch(() => null);
  const schema = z.object({
    nodes: z.array(BeadGraphInputNodeSchema).min(1),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }
  const graph = buildBeadDependencyGraph(parsed.data.nodes);
  return sendResource(c, "bead_dependency_graph", graph);
});

// ============================================================================
// Audit Log Query Builder (bd-1jv2y)
// ============================================================================

backups.post("/audit-queries/save", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = AuditQuerySpecSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }
  const saved = saveAuditQuery(parsed.data);
  return sendCreated(c, "saved_audit_query", saved, `/backups/audit-queries`);
});

backups.post("/audit-queries/execute", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = AuditQuerySpecSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }
  const format = c.req.query("format") === "csv" ? "csv" : "json";
  const result = executeAuditQuery(parsed.data, format);
  return sendResource(c, "audit_query_result", result);
});

export { backups };
