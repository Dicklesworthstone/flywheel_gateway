/**
 * Agent Replay/Debug Mode & Context Window Heat Map Routes (bd-1zgxu, bd-u2cl8)
 *
 * Endpoints:
 * - POST /replays/frames - Record a replay frame for an agent session
 * - GET /replays/frames/:agentId/:sessionId - Get recorded replay frames
 * - POST /replays/sessions - Start an interactive replay debug session
 * - POST /replays/sessions/:id/step - Step replay session (next/prev/jump/continue_to_breakpoint)
 * - POST /replays/sessions/:id/share - Share replay session for collaborative debugging
 * - POST /replays/context-heatmap/turns - Record per-turn token attribution
 * - GET /replays/context-heatmap/:agentId/:sessionId - Get Context Window Heat Map & suggestions
 */

import { Hono } from "hono";
import { z } from "zod";
import { requireAdminMiddleware } from "../middleware/auth";
import {
  getContextHeatMap,
  getRecordedReplayFrames,
  RecordContextTurnSchema,
  RecordReplayFrameSchema,
  ReplayBreakpointSchema,
  recordContextTurn,
  recordReplayFrame,
  shareReplayDebugSession,
  startReplayDebugSession,
  stepReplayDebugSession,
} from "../services/agent-replay.service";
import {
  sendCreated,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const replays = new Hono();
replays.use("*", requireAdminMiddleware());

const StartDebugSessionSchema = z.object({
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
  breakpoints: z.array(ReplayBreakpointSchema).optional(),
});

const StepDebugSessionSchema = z.object({
  action: z.enum(["next", "prev", "jump", "continue_to_breakpoint"]),
  targetFrameIndex: z.number().int().min(0).optional(),
});

replays.post("/frames", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = RecordReplayFrameSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const frame = recordReplayFrame(parsed.data);
  return sendCreated(
    c,
    "replay_frame",
    frame,
    `/replays/frames/${frame.agentId}/${frame.sessionId}`,
  );
});

replays.get("/frames/:agentId/:sessionId", (c) => {
  const agentId = c.req.param("agentId");
  const sessionId = c.req.param("sessionId");
  const frames = getRecordedReplayFrames(agentId, sessionId);
  return sendList(c, frames, { total: frames.length });
});

replays.post("/sessions", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = StartDebugSessionSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const session = startReplayDebugSession({
    agentId: parsed.data.agentId,
    sessionId: parsed.data.sessionId,
    ...(parsed.data.breakpoints !== undefined && {
      breakpoints: parsed.data.breakpoints,
    }),
  });
  return sendCreated(
    c,
    "replay_debug_session",
    session,
    `/replays/sessions/${session.id}`,
  );
});

replays.post("/sessions/:id/step", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = StepDebugSessionSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const updated = stepReplayDebugSession(
    id,
    parsed.data.action,
    parsed.data.targetFrameIndex,
  );
  if (!updated) return sendNotFound(c, "replay_debug_session", id);
  return sendResource(c, "replay_debug_session", updated);
});

replays.post("/sessions/:id/share", (c) => {
  const id = c.req.param("id");
  const shared = shareReplayDebugSession(id);
  if (!shared) return sendNotFound(c, "replay_debug_session", id);
  return sendResource(c, "replay_share_bundle", shared);
});

replays.post("/context-heatmap/turns", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = RecordContextTurnSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const snapshot = recordContextTurn(parsed.data);
  return sendCreated(
    c,
    "context_turn_snapshot",
    snapshot,
    `/replays/context-heatmap/${parsed.data.agentId}/${parsed.data.sessionId}`,
  );
});

replays.get("/context-heatmap/:agentId/:sessionId", (c) => {
  const agentId = c.req.param("agentId");
  const sessionId = c.req.param("sessionId");
  const heatMap = getContextHeatMap(agentId, sessionId);
  return sendResource(c, "context_heatmap", heatMap);
});

export { replays };
