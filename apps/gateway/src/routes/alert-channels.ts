/**
 * Alert Channels Routes
 *
 * REST API for managing external alert channels (webhook, Slack, Discord)
 * and routing rules.
 *
 * @see bd-3c0o3 Real-time Alert Channels bead
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import {
  type AlertPayload,
  type CreateChannelRequest,
  type CreateRuleRequest,
  createChannel,
  createRule,
  deleteChannel,
  deleteRule,
  getAllChannelHealth,
  getChannel,
  getChannelHealth,
  getDeliveries,
  getRule,
  listChannels,
  listRules,
  routeAlert,
  testChannel,
  type UpdateChannelRequest,
  updateChannel,
  updateRule,
} from "../services/alert-channel.service";
import {
  sendCreated,
  sendInternalError,
  sendList,
  sendNoContent,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { stripUndefined, transformZodError } from "../utils/validation";

const alertChannels = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const CreateChannelSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  type: z.enum(["webhook", "slack", "discord"]),
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean().optional(),
  rateLimitPerMinute: z.number().min(1).max(1000).optional(),
});

const UpdateChannelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
  rateLimitPerMinute: z.number().min(1).max(1000).optional(),
});

const RoutingConditionSchema = z.object({
  alertTypes: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  severities: z
    .array(z.enum(["critical", "error", "warning", "info", "low"]))
    .optional(),
  minSeverity: z
    .enum(["critical", "error", "warning", "info", "low"])
    .optional(),
  metadataMatch: z
    .array(
      z.object({
        field: z.string(),
        operator: z.enum(["eq", "neq", "contains", "startsWith", "matches"]),
        value: z.string(),
      }),
    )
    .optional(),
});

const CreateRuleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  priority: z.number().min(0).max(1000).optional(),
  condition: RoutingConditionSchema,
  channelIds: z.array(z.string()).min(1),
  throttleWindowSeconds: z.number().min(10).max(3600).optional(),
  throttleMaxAlerts: z.number().min(1).max(1000).optional(),
  aggregateEnabled: z.boolean().optional(),
  aggregateWindowSeconds: z.number().min(10).max(3600).optional(),
  aggregateMaxAlerts: z.number().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});

const UpdateRuleSchema = CreateRuleSchema.partial();

const TestAlertSchema = z.object({
  type: z.string().default("test"),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  severity: z
    .enum(["critical", "error", "warning", "info", "low"])
    .default("info"),
  category: z.string().optional(),
  link: z.string().url().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ============================================================================
// Helpers
// ============================================================================

function handleError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof z.ZodError) {
    return sendValidationError(c, transformZodError(error));
  }

  if (error instanceof Error) {
    // Handle business logic errors
    if (
      error.message.includes("already exists") ||
      error.message.includes("not found") ||
      error.message.includes("Invalid")
    ) {
      return sendValidationError(c, [{ path: "body", message: error.message }]);
    }
  }

  log.error({ error }, "Unexpected error in alert-channels route");
  return sendInternalError(c);
}

function serializeChannel(channel: ReturnType<typeof getChannel>) {
  if (!channel) return null;
  return {
    ...channel,
    // Mask sensitive config fields
    config: maskSensitiveConfig(channel.config),
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString(),
    lastSuccessAt: channel.lastSuccessAt?.toISOString(),
    lastErrorAt: channel.lastErrorAt?.toISOString(),
    lastRateLimitResetAt: channel.lastRateLimitResetAt?.toISOString(),
  };
}

function maskSensitiveConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const masked = { ...config };

  // Mask webhook URLs and secrets
  if (typeof masked["webhookUrl"] === "string") {
    try {
      const url = new URL(masked["webhookUrl"]);
      masked["webhookUrl"] = `${url.protocol}//${url.host}/***`;
    } catch {
      masked["webhookUrl"] = "***";
    }
  }
  if (typeof masked["url"] === "string") {
    try {
      const url = new URL(masked["url"]);
      masked["url"] = `${url.protocol}//${url.host}/***`;
    } catch {
      masked["url"] = "***";
    }
  }
  if (masked["secret"]) {
    masked["secret"] = "***";
  }
  if (masked["headers"] && typeof masked["headers"] === "object") {
    const maskedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      masked["headers"] as Record<string, string>,
    )) {
      if (
        key.toLowerCase().includes("auth") ||
        key.toLowerCase().includes("token")
      ) {
        maskedHeaders[key] = "***";
      } else {
        maskedHeaders[key] = value;
      }
    }
    masked["headers"] = maskedHeaders;
  }

  return masked;
}

function serializeRule(rule: ReturnType<typeof getRule>) {
  if (!rule) return null;
  return {
    ...rule,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
    lastMatchAt: rule.lastMatchAt?.toISOString(),
    throttleWindowStart: rule.throttleWindowStart?.toISOString(),
  };
}

function serializeDelivery(delivery: ReturnType<typeof getDeliveries>[number]) {
  return {
    ...delivery,
    createdAt: delivery.createdAt.toISOString(),
    sentAt: delivery.sentAt?.toISOString(),
    nextRetryAt: delivery.nextRetryAt?.toISOString(),
  };
}

function serializeHealth(health: ReturnType<typeof getChannelHealth>) {
  if (!health) return null;
  return {
    ...health,
    lastSuccessAt: health.lastSuccessAt?.toISOString(),
    lastErrorAt: health.lastErrorAt?.toISOString(),
  };
}

// ============================================================================
// Channel Routes
// ============================================================================

/**
 * GET /alert-channels - List all channels
 */
alertChannels.get("/", (c) => {
  try {
    const type = c.req.query("type") as
      | "webhook"
      | "slack"
      | "discord"
      | undefined;
    const enabledParam = c.req.query("enabled");
    const enabled =
      enabledParam === "true"
        ? true
        : enabledParam === "false"
          ? false
          : undefined;

    const filter: { type?: string; enabled?: boolean } = {};
    if (type !== undefined) filter.type = type;
    if (enabled !== undefined) filter.enabled = enabled;
    const channels = listChannels(filter);
    const serialized = channels.map(serializeChannel).filter(Boolean);

    return sendList(c, serialized);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /alert-channels - Create a channel
 */
alertChannels.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const validated = CreateChannelSchema.parse(body);

    const channel = createChannel(validated as CreateChannelRequest);

    return sendCreated(
      c,
      "alert_channel",
      serializeChannel(channel),
      `/alert-channels/${channel.id}`,
    );
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /alert-channels/health - Get health for all channels
 */
alertChannels.get("/health", (c) => {
  try {
    const health = getAllChannelHealth();
    const serialized = health.map(serializeHealth).filter(Boolean);

    return sendList(c, serialized);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /alert-channels/:id - Get a channel
 */
alertChannels.get("/:id", (c) => {
  try {
    const id = c.req.param("id");
    const channel = getChannel(id);

    if (!channel) {
      return sendNotFound(c, "alert_channel", id);
    }

    return sendResource(c, "alert_channel", serializeChannel(channel));
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * PUT /alert-channels/:id - Update a channel
 */
alertChannels.put("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const validated = UpdateChannelSchema.parse(body);

    const channel = updateChannel(id, validated as UpdateChannelRequest);

    if (!channel) {
      return sendNotFound(c, "alert_channel", id);
    }

    return sendResource(c, "alert_channel", serializeChannel(channel));
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * DELETE /alert-channels/:id - Delete a channel
 */
alertChannels.delete("/:id", (c) => {
  try {
    const id = c.req.param("id");
    const deleted = deleteChannel(id);

    if (!deleted) {
      return sendNotFound(c, "alert_channel", id);
    }

    return sendNoContent(c);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /alert-channels/:id/test - Test a channel
 */
alertChannels.post("/:id/test", async (c) => {
  try {
    const id = c.req.param("id");
    const result = await testChannel(id);

    return sendResource(c, "test_result", {
      channelId: id,
      success: result.success,
      error: result.error,
      errorCode: result.errorCode,
      responseStatus: result.responseStatus,
      durationMs: result.durationMs,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /alert-channels/:id/health - Get health for a channel
 */
alertChannels.get("/:id/health", (c) => {
  try {
    const id = c.req.param("id");
    const health = getChannelHealth(id);

    if (!health) {
      return sendNotFound(c, "alert_channel", id);
    }

    return sendResource(c, "channel_health", serializeHealth(health));
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Routing Rules Routes
// ============================================================================

/**
 * GET /alert-channels/rules - List all routing rules
 */
alertChannels.get("/rules", (c) => {
  try {
    const enabledParam = c.req.query("enabled");
    const enabled =
      enabledParam === "true"
        ? true
        : enabledParam === "false"
          ? false
          : undefined;

    const filter: { enabled?: boolean } = {};
    if (enabled !== undefined) filter.enabled = enabled;
    const rules = listRules(filter);
    const serialized = rules.map(serializeRule).filter(Boolean);

    return sendList(c, serialized);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /alert-channels/rules - Create a routing rule
 */
alertChannels.post("/rules", async (c) => {
  try {
    const body = await c.req.json();
    const validated = CreateRuleSchema.parse(body);

    const rule = createRule(validated as CreateRuleRequest);

    return sendCreated(
      c,
      "routing_rule",
      serializeRule(rule),
      `/alert-channels/rules/${rule.id}`,
    );
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /alert-channels/rules/:id - Get a routing rule
 */
alertChannels.get("/rules/:id", (c) => {
  try {
    const id = c.req.param("id");
    const rule = getRule(id);

    if (!rule) {
      return sendNotFound(c, "routing_rule", id);
    }

    return sendResource(c, "routing_rule", serializeRule(rule));
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * PUT /alert-channels/rules/:id - Update a routing rule
 */
alertChannels.put("/rules/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const validated = UpdateRuleSchema.parse(body);

    // Cast needed due to exactOptionalPropertyTypes - Zod parse returns T | undefined for optional fields
    const rule = updateRule(
      id,
      stripUndefined(validated) as Partial<
        Omit<CreateRuleRequest, "channelIds">
      > & { channelIds?: string[] },
    );

    if (!rule) {
      return sendNotFound(c, "routing_rule", id);
    }

    return sendResource(c, "routing_rule", serializeRule(rule));
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * DELETE /alert-channels/rules/:id - Delete a routing rule
 */
alertChannels.delete("/rules/:id", (c) => {
  try {
    const id = c.req.param("id");
    const deleted = deleteRule(id);

    if (!deleted) {
      return sendNotFound(c, "routing_rule", id);
    }

    return sendNoContent(c);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Delivery Routes
// ============================================================================

/**
 * GET /alert-channels/deliveries - List delivery records
 */
alertChannels.get("/deliveries", (c) => {
  try {
    const alertIdParam = c.req.query("alertId");
    const channelIdParam = c.req.query("channelId");
    const statusParam = c.req.query("status") as
      | "pending"
      | "sent"
      | "failed"
      | "throttled"
      | undefined;
    const limitParam = parseInt(c.req.query("limit") ?? "100", 10);

    const filter: {
      alertId?: string;
      channelId?: string;
      status?: "pending" | "sent" | "failed" | "throttled";
      limit?: number;
    } = {
      limit: Math.min(Math.max(1, limitParam), 500),
    };
    if (alertIdParam !== undefined) filter.alertId = alertIdParam;
    if (channelIdParam !== undefined) filter.channelId = channelIdParam;
    if (statusParam !== undefined) filter.status = statusParam;

    const deliveries = getDeliveries(filter);
    const serialized = deliveries.map(serializeDelivery);

    return sendList(c, serialized);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Test Alert Route
// ============================================================================

/**
 * POST /alert-channels/test-alert - Send a test alert through the routing engine
 */
alertChannels.post("/test-alert", async (c) => {
  try {
    const body = await c.req.json();
    const validated = TestAlertSchema.parse(body);

    const alert = stripUndefined({
      id: `test_${Date.now()}`,
      type: validated.type,
      title: validated.title,
      body: validated.body,
      severity: validated.severity,
      category: validated.category,
      link: validated.link,
      metadata: validated.metadata as Record<string, unknown> | undefined,
      timestamp: new Date().toISOString(),
    }) as AlertPayload;

    const deliveries = await routeAlert(alert);

    return sendResource(c, "test_alert_result", {
      alertId: alert.id,
      matchedChannels: deliveries.length,
      deliveries: deliveries.map(serializeDelivery),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

export { alertChannels };
