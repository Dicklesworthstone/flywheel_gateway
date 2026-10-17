/**
 * Agent Auto-Recovery & Runbooks Routes (bd-hrs1t, bd-1f4kb, bd-3gbt7)
 *
 * Endpoints:
 * - GET /runbooks - List runbooks (optional ?workspaceId=...)
 * - POST /runbooks - Create a validated runbook
 * - PUT /runbooks/:id - Update a runbook
 * - POST /runbooks/:id/simulate - Simulate runbook on historical telemetry traces (no side effects)
 * - POST /runbooks/agents/:agentId/recover - Trigger recovery evaluation for an agent
 * - GET /runbooks/agents/:agentId/history - Get recovery history for an agent
 */

import { Hono } from "hono";
import { z } from "zod";
import { requireAdminMiddleware } from "../middleware/auth";
import {
  CreateRunbookSchema,
  createRunbook,
  getAgentRecoveryHistory,
  getRunbook,
  listRunbooks,
  simulateRunbookSandbox,
  triggerAgentRecovery,
  updateRunbook,
} from "../services/runbook.service";
import {
  sendCreated,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const TelemetrySampleSchema = z.object({
  agentId: z.string().min(1),
  workspaceId: z.string().optional(),
  stuckDurationSeconds: z.number().optional(),
  healthScore: z.number().optional(),
  errorRatePercent: z.number().optional(),
  contextUsagePercent: z.number().optional(),
  reservationConflictCount: z.number().optional(),
  timestamp: z.string().optional(),
});

const SimulateBodySchema = z.object({
  samples: z.array(TelemetrySampleSchema).min(1),
});

const TriggerRecoveryBodySchema = z.object({
  runbookId: z.string().optional(),
  approved: z.boolean().optional(),
  reason: z.string().optional(),
  telemetry: TelemetrySampleSchema.omit({ agentId: true }).optional(),
});

const runbooks = new Hono();
runbooks.use("*", requireAdminMiddleware());

runbooks.get("/", (c) => {
  const workspaceId = c.req.query("workspaceId")?.trim();
  const items = listRunbooks(workspaceId);
  return sendList(c, items, { total: items.length });
});

runbooks.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = CreateRunbookSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const created = createRunbook(parsed.data);
  return sendCreated(c, "runbook", created, `/runbooks/${created.id}`);
});

runbooks.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = CreateRunbookSchema.partial().safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const updated = updateRunbook(id, parsed.data);
  if (!updated) {
    return sendNotFound(c, "runbook", id);
  }
  return sendResource(c, "runbook", updated);
});

runbooks.post("/:id/simulate", async (c) => {
  const id = c.req.param("id");
  const runbook = getRunbook(id);
  if (!runbook) {
    return sendNotFound(c, "runbook", id);
  }

  const body = await c.req.json();
  const parsed = SimulateBodySchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const simulation = simulateRunbookSandbox(runbook, parsed.data.samples);
  return sendResource(c, "runbook_simulation", simulation);
});

runbooks.post("/agents/:agentId/recover", async (c) => {
  const agentId = c.req.param("agentId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = TriggerRecoveryBodySchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const result = await triggerAgentRecovery(
    {
      agentId,
      ...(parsed.data.telemetry ?? {}),
    },
    {
      ...(parsed.data.runbookId !== undefined && {
        runbookId: parsed.data.runbookId,
      }),
      ...(parsed.data.approved !== undefined && {
        approved: parsed.data.approved,
      }),
      ...(parsed.data.reason !== undefined && { reason: parsed.data.reason }),
    },
  );

  return sendResource(c, "agent_recovery", result);
});

runbooks.get("/agents/:agentId/history", (c) => {
  const agentId = c.req.param("agentId");
  const history = getAgentRecoveryHistory(agentId);
  return sendList(c, history, { total: history.length });
});

export { runbooks };
