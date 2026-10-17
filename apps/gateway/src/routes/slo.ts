/**
 * Latency and SLO Dashboard Routes (bd-17yyv)
 *
 * Endpoints:
 * - GET /slo - List SLO definitions
 * - POST /slo - Create/upsert SLO definition
 * - GET /slo/status - Evaluate SLOs with p50/p95/p99, burnRate, and heatmap
 * - POST /slo/probes - Ingest synthetic probe latency sample
 * - POST /slo/annotations - Add deployment/incident annotation
 * - GET /slo/annotations - List SLO annotations
 * - GET /slo/export - Export SLO observability snapshot
 */

import { Hono } from "hono";
import { requireAdminMiddleware } from "../middleware/auth";
import {
  addSloAnnotation,
  CreateSloDefinitionSchema,
  createSloDefinition,
  evaluateSloStatuses,
  exportSloSnapshot,
  ingestSyntheticProbeResult,
  listSloAnnotations,
  listSloDefinitions,
  SloAnnotationInputSchema,
  SyntheticProbeResultSchema,
} from "../services/slo.service";
import {
  sendCreated,
  sendList,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const slo = new Hono();
slo.use("*", requireAdminMiddleware());

slo.get("/", (c) => {
  const items = listSloDefinitions();
  return sendList(c, items, { total: items.length });
});

slo.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CreateSloDefinitionSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const created = createSloDefinition(parsed.data);
  return sendCreated(c, "slo_definition", created, `/slo`);
});

slo.get("/status", async (c) => {
  const statuses = await evaluateSloStatuses();
  return sendList(c, statuses, { total: statuses.length });
});

slo.post("/probes", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = SyntheticProbeResultSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const probe = ingestSyntheticProbeResult(parsed.data);
  return sendCreated(c, "synthetic_probe_result", probe, `/slo/status`);
});

slo.post("/annotations", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = SloAnnotationInputSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const annotation = addSloAnnotation(parsed.data);
  return sendCreated(c, "slo_annotation", annotation, `/slo/annotations`);
});

slo.get("/annotations", (c) => {
  const sloId = c.req.query("sloId");
  const items = listSloAnnotations(sloId);
  return sendList(c, items, { total: items.length });
});

slo.get("/export", async (c) => {
  const snapshot = await exportSloSnapshot();
  return sendResource(c, "slo_snapshot", snapshot);
});

export { slo };
