/**
 * Pipeline Templates, Agent Preset Templates, Cost Tags, and Reservation
 * Negotiation Routes (bd-2hv7t, bd-fpdig, bd-1hnyy, bd-2befy)
 */

import { Hono } from "hono";
import { z } from "zod";
import { requireAdminMiddleware } from "../middleware/auth";
import {
  aggregateCostsByTagKey,
  applyRetroactiveCostTags,
  assignScopedCostTags,
  listTagDefinitions,
  RecordTaggedCostSchema,
  recordTaggedCost,
  TagDefinitionSchema,
  TagScopeAssignmentSchema,
  upsertTagDefinition,
} from "../services/cost-tags.service";
import {
  CreateNegotiationPolicySchema,
  createNegotiationPolicy,
  InitiateNegotiationSchema,
  initiateReservationNegotiation,
  listNegotiationPolicies,
  listReservationNegotiations,
  RespondNegotiationSchema,
  respondToReservationNegotiation,
} from "../services/reservation-negotiation.service";
import {
  CreateAgentTemplateSchema,
  CreatePipelineTemplateSchema,
  createAgentTemplate,
  createPipelineTemplate,
  exportPipelineTemplate,
  importPipelineTemplate,
  instantiateAgentFromTemplate,
  instantiatePipelineTemplate,
  listAgentTemplates,
  listPipelineTemplates,
} from "../services/templates-library.service";
import {
  sendCreated,
  sendError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const templates = new Hono();
templates.use("*", requireAdminMiddleware());

// ============================================================================
// Pipeline Templates Library (bd-2hv7t)
// ============================================================================

templates.get("/pipelines", (c) => {
  const category = c.req.query("category");
  const items = listPipelineTemplates(category);
  return sendList(c, items, { total: items.length });
});

templates.post("/pipelines", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CreatePipelineTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }
  const created = createPipelineTemplate(parsed.data);
  return sendCreated(
    c,
    "pipeline_template",
    created,
    `/templates/pipelines/${created.id}`,
  );
});

templates.post("/pipelines/:id/instantiate", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as {
    variables?: Record<string, string>;
  };
  try {
    const instantiated = instantiatePipelineTemplate(id, body.variables ?? {});
    return sendResource(c, "pipeline_instance", instantiated);
  } catch (err) {
    return sendError(
      c,
      "INVALID_REQUEST",
      err instanceof Error ? err.message : "Failed to instantiate template",
      400,
    );
  }
});

templates.get("/pipelines/:id/export", (c) => {
  const id = c.req.param("id");
  const exported = exportPipelineTemplate(id);
  if (!exported) return sendNotFound(c, "pipeline_template", id);
  return sendResource(c, "pipeline_template_export", exported);
});

templates.post("/pipelines/import", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CreatePipelineTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }
  const imported = importPipelineTemplate(parsed.data);
  return sendCreated(
    c,
    "pipeline_template",
    imported,
    `/templates/pipelines/${imported.id}`,
  );
});

// ============================================================================
// Agent Preset Templates (bd-fpdig)
// ============================================================================

templates.get("/agents", (c) => {
  const category = c.req.query("category");
  const items = listAgentTemplates(category);
  return sendList(c, items, { total: items.length });
});

templates.post("/agents", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CreateAgentTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }
  const created = createAgentTemplate(parsed.data);
  return sendCreated(
    c,
    "agent_template",
    created,
    `/templates/agents/${created.id}`,
  );
});

templates.post("/agents/:id/instantiate", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as {
    agentName?: string;
    workspaceId?: string;
    maxCostPerSession?: number;
  };
  try {
    const instance = instantiateAgentFromTemplate(id, body);
    return sendCreated(
      c,
      "agent_template_instance",
      instance,
      `/agents/${instance.instanceId}`,
    );
  } catch (err) {
    return sendError(
      c,
      "INVALID_REQUEST",
      err instanceof Error ? err.message : "Failed to instantiate agent preset",
      400,
    );
  }
});

// ============================================================================
// Cost Attribution Custom Tags (bd-1hnyy)
// ============================================================================

templates.get("/cost-tags/definitions", (c) => {
  const defs = listTagDefinitions();
  return sendList(c, defs, { total: defs.length });
});

templates.post("/cost-tags/definitions", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = TagDefinitionSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }
  const def = upsertTagDefinition(parsed.data);
  return sendCreated(
    c,
    "cost_tag_definition",
    def,
    `/templates/cost-tags/definitions`,
  );
});

templates.post("/cost-tags/assign", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = TagScopeAssignmentSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }
  try {
    const tags = assignScopedCostTags(parsed.data);
    return sendResource(c, "scoped_cost_tags", {
      scope: parsed.data.scope,
      targetId: parsed.data.targetId,
      tags,
    });
  } catch (err) {
    return sendError(
      c,
      "INVALID_REQUEST",
      err instanceof Error ? err.message : "Invalid tags",
      400,
    );
  }
});

templates.post("/cost-tags/records", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = RecordTaggedCostSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }
  try {
    const record = recordTaggedCost(parsed.data);
    return sendCreated(
      c,
      "tagged_cost_record",
      record,
      `/templates/cost-tags/records`,
    );
  } catch (err) {
    return sendError(
      c,
      "INVALID_REQUEST",
      err instanceof Error ? err.message : "Invalid cost record tags",
      400,
    );
  }
});

templates.post("/cost-tags/retroactive", async (c) => {
  const body = await c.req.json().catch(() => null);
  const schema = z.object({
    recordIds: z.array(z.string().min(1)).min(1),
    tags: z.record(z.string(), z.string()),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }
  try {
    const updatedCount = applyRetroactiveCostTags(
      parsed.data.recordIds,
      parsed.data.tags,
    );
    return sendResource(c, "retroactive_cost_tags", { updatedCount });
  } catch (err) {
    return sendError(
      c,
      "INVALID_REQUEST",
      err instanceof Error ? err.message : "Invalid retroactive tags",
      400,
    );
  }
});

templates.get("/cost-tags/slice/:tagKey", (c) => {
  const tagKey = c.req.param("tagKey");
  const agg = aggregateCostsByTagKey(tagKey);
  return sendResource(c, "cost_tag_slice", agg);
});

// ============================================================================
// Reservation Negotiation Protocol (bd-2befy)
// ============================================================================

templates.get("/negotiations/policies", (c) => {
  const items = listNegotiationPolicies();
  return sendList(c, items, { total: items.length });
});

templates.post("/negotiations/policies", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CreateNegotiationPolicySchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }
  const policy = createNegotiationPolicy(parsed.data);
  return sendCreated(
    c,
    "negotiation_policy",
    policy,
    `/templates/negotiations/policies`,
  );
});

templates.get("/negotiations", (c) => {
  const items = listReservationNegotiations();
  return sendList(c, items, { total: items.length });
});

templates.post("/negotiations", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = InitiateNegotiationSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }
  const record = initiateReservationNegotiation(parsed.data);
  return sendCreated(
    c,
    "reservation_negotiation",
    record,
    `/templates/negotiations/${record.id}`,
  );
});

templates.post("/negotiations/:id/respond", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = RespondNegotiationSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }
  const updated = respondToReservationNegotiation(id, parsed.data);
  if (!updated) return sendNotFound(c, "reservation_negotiation", id);
  return sendResource(c, "reservation_negotiation", updated);
});

export { templates };
