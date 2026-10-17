/**
 * Workspace Cost Caps and Auto-Throttle Routes (bd-1weoa)
 *
 * Endpoints:
 * - GET /cost-caps - List workspace cost cap policies and current spend
 * - PUT /cost-caps - Upsert workspace cost cap policy
 * - POST /cost-caps/spend - Record workspace spend & check anomalies
 * - POST /cost-caps/evaluate - Evaluate cost cap enforcement for a workspace
 * - POST /cost-caps/override - Grant temporary budget override
 * - GET /cost-caps/:workspaceId/report - Export per-workspace report & audit trail
 */

import { Hono } from "hono";
import { z } from "zod";
import { requireAdminMiddleware } from "../middleware/auth";
import {
  CostCapOverrideInputSchema,
  CostCapPolicySchema,
  createCostCapOverride,
  evaluateWorkspaceCostCap,
  exportWorkspaceCostCapReport,
  listCostCapPolicies,
  recordWorkspaceSpend,
  upsertCostCapPolicy,
} from "../services/cost-cap.service";
import {
  sendCreated,
  sendList,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const costCaps = new Hono();
costCaps.use("*", requireAdminMiddleware());

const RecordSpendBodySchema = z.object({
  workspaceId: z.string().min(1),
  amountUsd: z.number().positive(),
  eventType: z.string().optional(),
});

const EvaluateCostCapBodySchema = z.object({
  workspaceId: z.string().min(1),
  isEssentialOperation: z.boolean().optional(),
  activeEssentialAgents: z.number().int().min(0).optional(),
});

costCaps.get("/", (c) => {
  const policies = listCostCapPolicies();
  return sendList(c, policies, { total: policies.length });
});

costCaps.put("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CostCapPolicySchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const policy = upsertCostCapPolicy(parsed.data);
  return sendResource(c, "cost_cap_policy", policy);
});

costCaps.post("/spend", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = RecordSpendBodySchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const result = await recordWorkspaceSpend(parsed.data);
  return sendResource(c, "workspace_spend", result);
});

costCaps.post("/evaluate", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = EvaluateCostCapBodySchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const evaluation = await evaluateWorkspaceCostCap(parsed.data);
  return sendResource(c, "cost_cap_evaluation", evaluation);
});

costCaps.post("/override", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CostCapOverrideInputSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const override = createCostCapOverride(parsed.data);
  return sendCreated(
    c,
    "cost_cap_override",
    override,
    `/cost-caps/${override.workspaceId}/report`,
  );
});

costCaps.get("/:workspaceId/report", (c) => {
  const workspaceId = c.req.param("workspaceId");
  const report = exportWorkspaceCostCapReport(workspaceId);
  return sendResource(c, "cost_cap_report", report);
});

export { costCaps };
