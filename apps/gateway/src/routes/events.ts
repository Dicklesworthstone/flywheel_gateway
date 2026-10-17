/**
 * Event Streaming API Routes — Webhooks & SSE (bd-2d0a3)
 *
 * Endpoints:
 * - GET /events/subscriptions - List webhook subscriptions
 * - POST /events/subscriptions - Create webhook subscription
 * - POST /events/subscriptions/:id/verify - Verify subscription challenge token
 * - POST /events/subscriptions/:id/toggle - Enable/disable subscription
 * - POST /events/subscriptions/:id/maintenance - Set maintenance window suppression
 * - DELETE /events/subscriptions/:id - Delete subscription
 * - POST /events/publish - Publish event & trigger webhook delivery
 * - GET /events/dlq - List dead-letter queue entries
 * - GET /events/stream - Server-Sent Events (SSE) stream with backfill
 */

import { Hono } from "hono";
import { z } from "zod";
import { requireAdminMiddleware } from "../middleware/auth";
import {
  CreateWebhookSubscriptionSchema,
  createWebhookSubscription,
  deleteWebhookSubscription,
  getSseStreamBackfill,
  listDeadLetterQueue,
  listWebhookSubscriptions,
  publishStreamEvent,
  setWebhookMaintenanceWindow,
  setWebhookSubscriptionEnabled,
  verifyWebhookSubscription,
} from "../services/event-stream.service";
import {
  sendCreated,
  sendError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const events = new Hono();
events.use("*", requireAdminMiddleware());

const VerifySubscriptionSchema = z.object({
  challengeToken: z.string().min(1),
});

const ToggleSubscriptionSchema = z.object({
  enabled: z.boolean(),
});

const MaintenanceWindowSchema = z.object({
  durationMinutes: z.number().positive().max(10_080),
});

const PublishEventSchema = z.object({
  type: z.string().min(1),
  source: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

events.get("/subscriptions", (c) => {
  const subs = listWebhookSubscriptions();
  return sendList(c, subs, { total: subs.length });
});

events.post("/subscriptions", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CreateWebhookSubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const sub = createWebhookSubscription(parsed.data);
  return sendCreated(
    c,
    "webhook_subscription",
    sub,
    `/events/subscriptions/${sub.id}`,
  );
});

events.post("/subscriptions/:id/verify", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = VerifySubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  try {
    const sub = verifyWebhookSubscription(id, parsed.data.challengeToken);
    if (!sub) return sendNotFound(c, "webhook_subscription", id);
    return sendResource(c, "webhook_subscription", sub);
  } catch (err) {
    return sendError(
      c,
      "INVALID_REQUEST",
      err instanceof Error ? err.message : "Verification failed",
      400,
    );
  }
});

events.post("/subscriptions/:id/toggle", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = ToggleSubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const sub = setWebhookSubscriptionEnabled(id, parsed.data.enabled);
  if (!sub) return sendNotFound(c, "webhook_subscription", id);
  return sendResource(c, "webhook_subscription", sub);
});

events.post("/subscriptions/:id/maintenance", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = MaintenanceWindowSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const sub = setWebhookMaintenanceWindow(id, parsed.data.durationMinutes);
  if (!sub) return sendNotFound(c, "webhook_subscription", id);
  return sendResource(c, "webhook_subscription", sub);
});

events.delete("/subscriptions/:id", (c) => {
  const id = c.req.param("id");
  const deleted = deleteWebhookSubscription(id);
  if (!deleted) return sendNotFound(c, "webhook_subscription", id);
  return sendResource(c, "webhook_subscription_deleted", { id, deleted: true });
});

events.post("/publish", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = PublishEventSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const result = await publishStreamEvent(parsed.data);
  return sendCreated(
    c,
    "stream_event_dispatch",
    result,
    `/events/stream?sinceSeq=${result.event.seq - 1}`,
  );
});

events.get("/dlq", (c) => {
  const items = listDeadLetterQueue();
  return sendList(c, items, { total: items.length });
});

events.get("/stream", (c) => {
  const lastEventIdHeader = c.req.header("Last-Event-ID");
  const sinceSeqParam = c.req.query("sinceSeq") ?? lastEventIdHeader;
  const sinceSeq = sinceSeqParam ? Number.parseInt(sinceSeqParam, 10) : 0;
  const typesParam = c.req.query("types");
  const eventTypes = typesParam
    ? typesParam.split(",").map((t) => t.trim())
    : undefined;

  const { sseBody } = getSseStreamBackfill({
    ...(Number.isFinite(sinceSeq) && { sinceSeq }),
    ...(eventTypes && { eventTypes }),
  });

  c.header("Content-Type", "text/event-stream; charset=utf-8");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");
  return c.body(sseBody, 200);
});

export { events };
