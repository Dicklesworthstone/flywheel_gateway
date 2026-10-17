/**
 * Model Routing and Failover Policy Routes (bd-3gwij)
 *
 * Endpoints:
 * - GET /routing/policies - List routing policies ordered by priority
 * - POST /routing/policies - Create a routing policy
 * - PUT /routing/policies/:id - Update a routing policy (creates new version)
 * - POST /routing/policies/:id/disable - Disable a routing policy
 * - POST /routing/policies/:id/revert - Revert a routing policy to a previous version
 * - POST /routing/policies/lint - Lint a candidate routing policy
 * - POST /routing/simulate - What-if traffic simulation for a candidate policy
 * - POST /routing/evaluate - Evaluate routing decision for a request
 * - GET /routing/decisions - List recent routing decisions with explainable traces
 */

import { Hono } from "hono";
import { z } from "zod";
import { requireAdminMiddleware } from "../middleware/auth";
import {
  CreateRoutingPolicySchema,
  createRoutingPolicy,
  disableRoutingPolicy,
  evaluateModelRouting,
  FailoverErrorTypeSchema,
  lintRoutingPolicy,
  listRoutingDecisions,
  listRoutingPolicies,
  ModelProviderSchema,
  revertRoutingPolicy,
  simulateRoutingPolicyWhatIf,
  updateRoutingPolicy,
} from "../services/model-router.service";
import {
  sendCreated,
  sendError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const routing = new Hono();
routing.use("*", requireAdminMiddleware());

const RoutingRequestInputSchema = z.object({
  agentId: z.string().optional(),
  workspaceId: z.string().optional(),
  agentTags: z.record(z.string(), z.string()).optional(),
  taskType: z.string().optional(),
  contextHeadroomPercent: z.number().min(0).max(100).optional(),
  defaultProvider: ModelProviderSchema.optional(),
  defaultModel: z.string().optional(),
  simulatedErrors: z
    .array(
      z.object({
        provider: ModelProviderSchema,
        model: z.string(),
        errorType: FailoverErrorTypeSchema,
      }),
    )
    .optional(),
});

const SimulateRequestSchema = z.object({
  policy: CreateRoutingPolicySchema,
  samples: z.array(RoutingRequestInputSchema).min(1),
});

const RevertPolicySchema = z.object({
  targetVersion: z.number().int().min(1),
});

routing.get("/policies", (c) => {
  const policies = listRoutingPolicies();
  return sendList(c, policies, { total: policies.length });
});

routing.post("/policies/lint", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return sendError(c, "INVALID_REQUEST", "Request body is required", 400);
  }

  const result = lintRoutingPolicy(body);
  return sendResource(c, "routing_policy_lint", result);
});

routing.post("/policies", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CreateRoutingPolicySchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const lint = lintRoutingPolicy(parsed.data);
  if (!lint.valid) {
    return sendError(
      c,
      "INVALID_REQUEST",
      lint.warnings.map((w) => w.message).join("; "),
      400,
    );
  }

  const policy = createRoutingPolicy(parsed.data);
  return sendCreated(
    c,
    "routing_policy",
    policy,
    `/routing/policies/${policy.id}`,
  );
});

routing.put("/policies/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return sendError(c, "INVALID_REQUEST", "Request body is required", 400);
  }

  const updated = updateRoutingPolicy(id, body);
  if (!updated) {
    return sendNotFound(c, "routing_policy", id);
  }
  return sendResource(c, "routing_policy", updated);
});

routing.post("/policies/:id/disable", (c) => {
  const id = c.req.param("id");
  const updated = disableRoutingPolicy(id);
  if (!updated) {
    return sendNotFound(c, "routing_policy", id);
  }
  return sendResource(c, "routing_policy", updated);
});

routing.post("/policies/:id/revert", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = RevertPolicySchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const reverted = revertRoutingPolicy(id, parsed.data.targetVersion);
  if (!reverted) {
    return sendNotFound(
      c,
      "routing_policy_version",
      `${id}@v${parsed.data.targetVersion}`,
    );
  }
  return sendResource(c, "routing_policy", reverted);
});

routing.post("/simulate", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = SimulateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const simulation = simulateRoutingPolicyWhatIf(
    parsed.data.policy,
    parsed.data.samples,
  );
  return sendResource(c, "routing_simulation", simulation);
});

routing.post("/evaluate", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = RoutingRequestInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const decision = await evaluateModelRouting(parsed.data);
  return sendResource(c, "routing_decision", decision);
});

routing.get("/decisions", (c) => {
  const agentId = c.req.query("agentId");
  const policyId = c.req.query("policyId");
  const limitParam = c.req.query("limit");
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 50;

  const decisions = listRoutingDecisions({
    ...(agentId !== undefined && { agentId }),
    ...(policyId !== undefined && { policyId }),
    ...(Number.isFinite(limit) && limit > 0 && { limit }),
  });
  return sendList(c, decisions, { total: decisions.length });
});

export { routing };
