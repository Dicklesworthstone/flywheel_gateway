import { type Context, Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import { audit } from "../services/audit";
import { getWsEventLogService } from "../services/ws-event-log.service";
import { createInternalAuthContext, canSubscribe } from "../ws/authorization";
import { parseChannel } from "../ws/channels";
import type { AuthContext } from "../ws/hub";
import { sendError, sendResource, sendValidationError } from "../utils/response";
import { transformZodError } from "../utils/validation";

const ws = new Hono();

const ReplayQuerySchema = z.object({
  channel: z.string().min(1),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

function getClientIp(c: Context): string | undefined {
  const forwarded = c.req.header("X-Forwarded-For");
  if (forwarded) {
    const clientIp = forwarded.split(",")[0]?.trim();
    if (clientIp) return clientIp;
  }

  const realIp = c.req.header("X-Real-IP");
  if (realIp) return realIp;

  return undefined;
}

ws.get("/replay", async (c) => {
  const log = getLogger();
  const parsed = ReplayQuerySchema.safeParse({
    channel: c.req.query("channel"),
    cursor: c.req.query("cursor"),
    limit: c.req.query("limit"),
  });

  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const channelStr = parsed.data.channel;
  const channel = parseChannel(channelStr);
  if (!channel) {
    return sendError(c, "INVALID_REQUEST", "Invalid channel format", 400);
  }

  const auth =
    (c.get("auth") as AuthContext | undefined) ?? createInternalAuthContext();
  const authResult = canSubscribe(auth, channel);
  if (!authResult.allowed) {
    return sendError(
      c,
      "AUTH_INSUFFICIENT_SCOPE",
      `Replay denied: ${authResult.reason ?? "Not authorized"}`,
      403,
    );
  }

  try {
    const result = await getWsEventLogService().replay({
      channel: channelStr,
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
    });

    audit({
      action: "ws.replay",
      resource: channelStr,
      resourceType: "ws_channel",
      outcome: "success",
      userId: auth.userId,
      apiKeyId: auth.apiKeyId,
      ipAddress: getClientIp(c),
      userAgent: c.req.header("User-Agent") ?? undefined,
      metadata: {
        cursor: parsed.data.cursor,
        limit: parsed.data.limit,
        cursorExpired: result.cursorExpired,
        messageCount: result.messages.length,
      },
    });

    return sendResource(c, "ws_replay", { channel: channelStr, ...result });
  } catch (error) {
    log.error({ error, channel: channelStr }, "WS replay failed");
    audit({
      action: "ws.replay",
      resource: channelStr,
      resourceType: "ws_channel",
      outcome: "failure",
      userId: auth.userId,
      apiKeyId: auth.apiKeyId,
      ipAddress: getClientIp(c),
      userAgent: c.req.header("User-Agent") ?? undefined,
      metadata: {
        cursor: parsed.data.cursor,
        limit: parsed.data.limit,
      },
    });
    return sendError(c, "INTERNAL_ERROR", "Replay failed", 500);
  }
});

export { ws };
