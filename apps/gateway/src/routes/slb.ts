/**
 * SLB Routes - REST API endpoints for Simultaneous Launch Button integration.
 *
 * Provides endpoints for two-person authorization of dangerous commands.
 * Commands are classified by risk tier and require approval from reviewers.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { requireAdminMiddleware } from "../middleware/auth";
import { getLogger } from "../middleware/correlation";
import {
  getSlbService,
  type SlbRequestStatus,
  type SlbTier,
} from "../services/slb.service";
import {
  sendError,
  sendInternalError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const slb = new Hono();
slb.use("*", requireAdminMiddleware());

// ============================================================================
// Validation Schemas
// ============================================================================

const TierSchema = z.enum(["safe", "caution", "dangerous", "critical"]);

const StatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "timeout",
  "executed",
  "failed",
]);

const ProjectQuerySchema = z.object({
  project: z.string().optional(),
});

const SessionStartSchema = z.object({
  agent: z.string().min(1).max(100),
  program: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  project: z.string().optional(),
});

const CheckCommandSchema = z.object({
  command: z.string().min(1).max(10000),
  project: z.string().optional(),
});

const CreateRequestSchema = z.object({
  command: z.string().min(1).max(10000),
  sessionId: z.string().min(1),
  reason: z.string().max(5000).optional(),
  safety: z.string().max(5000).optional(),
  goal: z.string().max(5000).optional(),
  expectedEffect: z.string().max(5000).optional(),
  project: z.string().optional(),
});

const PendingQuerySchema = z.object({
  project: z.string().optional(),
  reviewPool: z.coerce.boolean().optional(),
  allProjects: z.coerce.boolean().optional(),
});

const HistoryQuerySchema = z.object({
  project: z.string().optional(),
  query: z.string().optional(),
  status: StatusSchema.optional(),
  tier: TierSchema.optional(),
  agent: z.string().optional(),
  since: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const ApproveRequestSchema = z.object({
  sessionId: z.string().min(1),
  sessionKey: z.string().min(1),
  comments: z.string().max(5000).optional(),
  reasonResponse: z.string().max(5000).optional(),
  safetyResponse: z.string().max(5000).optional(),
  goalResponse: z.string().max(5000).optional(),
  effectResponse: z.string().max(5000).optional(),
  project: z.string().optional(),
  targetProject: z.string().optional(),
});

const RejectRequestSchema = z.object({
  sessionId: z.string().min(1),
  sessionKey: z.string().min(1),
  reason: z.string().max(5000).optional(),
  project: z.string().optional(),
});

const CancelRequestSchema = z.object({
  sessionId: z.string().min(1),
  project: z.string().optional(),
});

const ExecuteRequestSchema = z.object({
  sessionId: z.string().min(1),
  project: z.string().optional(),
  timeout: z.coerce.number().int().min(1000).max(600000).optional(),
});

const AddPatternSchema = z.object({
  pattern: z.string().min(1).max(1000),
  tier: TierSchema,
  reason: z.string().max(1000).optional(),
  project: z.string().optional(),
});

// ============================================================================
// Error Handler
// ============================================================================

function handleError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof z.ZodError) {
    return sendValidationError(c, transformZodError(error));
  }

  if (error instanceof Error) {
    // Check for slb not installed error
    if (
      error.message.includes("not installed") ||
      error.message.includes("ENOENT")
    ) {
      return sendError(
        c,
        "SLB_NOT_INSTALLED",
        "slb CLI is not installed. See: https://github.com/Dicklesworthstone/slb",
        503,
        {
          hint: "Install slb CLI to use the approval API",
          severity: "recoverable",
        },
      );
    }

    log.error({ error: error.message }, "Error in slb route");
    return sendError(c, "SLB_ERROR", "SLB command execution failed", 500);
  }

  log.error({ error }, "Unexpected error in slb route");
  return sendInternalError(c);
}

// ============================================================================
// Status Route
// ============================================================================

/**
 * GET /slb/status - Check slb availability and version
 */
slb.get("/status", async (c) => {
  try {
    const service = getSlbService();
    const [available, version] = await Promise.all([
      service.isAvailable(),
      service.getVersion(),
    ]);

    return sendResource(c, "slb_status", {
      available,
      version: version?.version ?? null,
      details: version ?? null,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Session Routes
// ============================================================================

/**
 * POST /slb/sessions - Start a new session
 */
slb.post("/sessions", async (c) => {
  try {
    const body = await c.req.json();
    const validated = SessionStartSchema.parse(body);
    const service = getSlbService();

    const options: {
      agent: string;
      program: string;
      model: string;
      project?: string;
    } = {
      agent: validated.agent,
      program: validated.program,
      model: validated.model,
    };
    if (validated.project !== undefined) options.project = validated.project;

    const result = await service.startSession(options);

    return sendResource(c, "slb_session", result, 201);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /slb/sessions/resume - Resume or start a session
 */
slb.post("/sessions/resume", async (c) => {
  try {
    const body = await c.req.json();
    const validated = SessionStartSchema.parse(body);
    const service = getSlbService();

    const options: {
      agent: string;
      program: string;
      model: string;
      project?: string;
    } = {
      agent: validated.agent,
      program: validated.program,
      model: validated.model,
    };
    if (validated.project !== undefined) options.project = validated.project;

    const result = await service.resumeSession(options);

    return sendResource(c, "slb_session", result);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /slb/sessions - List active sessions
 */
slb.get("/sessions", async (c) => {
  try {
    const query = c.req.query();
    const validated = ProjectQuerySchema.parse(query);
    const service = getSlbService();

    const options: { project?: string } = {};
    if (validated.project !== undefined) options.project = validated.project;

    const sessions = await service.listSessions(options);

    return sendList(c, sessions, {
      total: sessions.length,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /slb/sessions/:id/end - End a session
 */
slb.post("/sessions/:id/end", async (c) => {
  try {
    const sessionId = c.req.param("id");
    const query = c.req.query();
    const validated = ProjectQuerySchema.parse(query);
    const service = getSlbService();

    const options: { project?: string } = {};
    if (validated.project !== undefined) options.project = validated.project;

    await service.endSession(sessionId, options);

    return sendResource(c, "slb_session_ended", {
      sessionId,
      endedAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /slb/sessions/:id/heartbeat - Update session heartbeat
 */
slb.post("/sessions/:id/heartbeat", async (c) => {
  try {
    const sessionId = c.req.param("id");
    const query = c.req.query();
    const validated = ProjectQuerySchema.parse(query);
    const service = getSlbService();

    const options: { project?: string } = {};
    if (validated.project !== undefined) options.project = validated.project;

    await service.heartbeatSession(sessionId, options);

    return sendResource(c, "slb_heartbeat", {
      sessionId,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Check Route
// ============================================================================

/**
 * POST /slb/check - Check which tier a command matches
 */
slb.post("/check", async (c) => {
  try {
    const body = await c.req.json();
    const validated = CheckCommandSchema.parse(body);
    const service = getSlbService();

    const options: { project?: string } = {};
    if (validated.project !== undefined) options.project = validated.project;

    const result = await service.checkCommand(validated.command, options);

    return sendResource(c, "slb_tier_check", result);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Request Routes
// ============================================================================

/**
 * POST /slb/requests - Create a new approval request
 */
slb.post("/requests", async (c) => {
  try {
    const body = await c.req.json();
    const validated = CreateRequestSchema.parse(body);
    const service = getSlbService();

    const options: {
      sessionId: string;
      reason?: string;
      safety?: string;
      goal?: string;
      expectedEffect?: string;
      project?: string;
    } = { sessionId: validated.sessionId };

    if (validated.reason !== undefined) options.reason = validated.reason;
    if (validated.safety !== undefined) options.safety = validated.safety;
    if (validated.goal !== undefined) options.goal = validated.goal;
    if (validated.expectedEffect !== undefined)
      options.expectedEffect = validated.expectedEffect;
    if (validated.project !== undefined) options.project = validated.project;

    const request = await service.createRequest(validated.command, options);

    return sendResource(c, "slb_request", request, 201);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /slb/requests/pending - List pending requests
 */
slb.get("/requests/pending", async (c) => {
  try {
    const query = c.req.query();
    const validated = PendingQuerySchema.parse(query);
    const service = getSlbService();

    const options: {
      project?: string;
      reviewPool?: boolean;
      allProjects?: boolean;
    } = {};
    if (validated.project !== undefined) options.project = validated.project;
    if (validated.reviewPool !== undefined)
      options.reviewPool = validated.reviewPool;
    if (validated.allProjects !== undefined)
      options.allProjects = validated.allProjects;

    const requests = await service.listPendingRequests(options);

    return sendList(c, requests, {
      total: requests.length,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /slb/requests/history - Get request history
 */
slb.get("/requests/history", async (c) => {
  try {
    const query = c.req.query();
    const validated = HistoryQuerySchema.parse(query);
    const service = getSlbService();

    const options: {
      project?: string;
      query?: string;
      status?: SlbRequestStatus;
      tier?: SlbTier;
      agent?: string;
      since?: string;
      limit?: number;
    } = {};

    if (validated.project !== undefined) options.project = validated.project;
    if (validated.query !== undefined) options.query = validated.query;
    if (validated.status !== undefined) options.status = validated.status;
    if (validated.tier !== undefined) options.tier = validated.tier;
    if (validated.agent !== undefined) options.agent = validated.agent;
    if (validated.since !== undefined) options.since = validated.since;
    if (validated.limit !== undefined) options.limit = validated.limit;

    const requests = await service.getHistory(options);

    return sendList(c, requests, {
      total: requests.length,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /slb/requests/:id - Get request details
 */
slb.get("/requests/:id", async (c) => {
  try {
    const requestId = c.req.param("id");
    const query = c.req.query();
    const validated = ProjectQuerySchema.parse(query);
    const service = getSlbService();

    const options: { project?: string } = {};
    if (validated.project !== undefined) options.project = validated.project;

    const request = await service.getRequest(requestId, options);

    if (!request) {
      return sendNotFound(c, "request", requestId);
    }

    return sendResource(c, "slb_request", request);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /slb/requests/:id/approve - Approve a request
 */
slb.post("/requests/:id/approve", async (c) => {
  try {
    const requestId = c.req.param("id");
    const body = await c.req.json();
    const validated = ApproveRequestSchema.parse(body);
    const service = getSlbService();

    const options: {
      sessionId: string;
      sessionKey: string;
      comments?: string;
      reasonResponse?: string;
      safetyResponse?: string;
      goalResponse?: string;
      effectResponse?: string;
      project?: string;
      targetProject?: string;
    } = {
      sessionId: validated.sessionId,
      sessionKey: validated.sessionKey,
    };

    if (validated.comments !== undefined) options.comments = validated.comments;
    if (validated.reasonResponse !== undefined)
      options.reasonResponse = validated.reasonResponse;
    if (validated.safetyResponse !== undefined)
      options.safetyResponse = validated.safetyResponse;
    if (validated.goalResponse !== undefined)
      options.goalResponse = validated.goalResponse;
    if (validated.effectResponse !== undefined)
      options.effectResponse = validated.effectResponse;
    if (validated.project !== undefined) options.project = validated.project;
    if (validated.targetProject !== undefined)
      options.targetProject = validated.targetProject;

    const request = await service.approveRequest(requestId, options);

    return sendResource(c, "slb_request", request);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /slb/requests/:id/reject - Reject a request
 */
slb.post("/requests/:id/reject", async (c) => {
  try {
    const requestId = c.req.param("id");
    const body = await c.req.json();
    const validated = RejectRequestSchema.parse(body);
    const service = getSlbService();

    const options: {
      sessionId: string;
      sessionKey: string;
      reason?: string;
      project?: string;
    } = {
      sessionId: validated.sessionId,
      sessionKey: validated.sessionKey,
    };

    if (validated.reason !== undefined) options.reason = validated.reason;
    if (validated.project !== undefined) options.project = validated.project;

    const request = await service.rejectRequest(requestId, options);

    return sendResource(c, "slb_request", request);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /slb/requests/:id/cancel - Cancel a request
 */
slb.post("/requests/:id/cancel", async (c) => {
  try {
    const requestId = c.req.param("id");
    const body = await c.req.json();
    const validated = CancelRequestSchema.parse(body);
    const service = getSlbService();

    const options: {
      sessionId: string;
      project?: string;
    } = { sessionId: validated.sessionId };

    if (validated.project !== undefined) options.project = validated.project;

    await service.cancelRequest(requestId, options);

    return sendResource(c, "slb_request_cancelled", {
      requestId,
      cancelledAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /slb/requests/:id/execute - Execute an approved request
 */
slb.post("/requests/:id/execute", async (c) => {
  try {
    const requestId = c.req.param("id");
    const body = await c.req.json();
    const validated = ExecuteRequestSchema.parse(body);
    const service = getSlbService();

    const options: {
      sessionId: string;
      project?: string;
      timeout?: number;
    } = { sessionId: validated.sessionId };

    if (validated.project !== undefined) options.project = validated.project;
    if (validated.timeout !== undefined) options.timeout = validated.timeout;

    const outcome = await service.executeRequest(requestId, options);

    return sendResource(c, "slb_outcome", outcome);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Pattern Routes
// ============================================================================

/**
 * GET /slb/patterns - List all patterns
 */
slb.get("/patterns", async (c) => {
  try {
    const query = c.req.query();
    const validated = ProjectQuerySchema.parse(query);
    const service = getSlbService();

    const options: { project?: string } = {};
    if (validated.project !== undefined) options.project = validated.project;

    const patterns = await service.listPatterns(options);

    return sendResource(c, "slb_patterns", patterns);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /slb/patterns - Add a pattern
 */
slb.post("/patterns", async (c) => {
  try {
    const body = await c.req.json();
    const validated = AddPatternSchema.parse(body);
    const service = getSlbService();

    const options: { reason?: string; project?: string } = {};
    if (validated.reason !== undefined) options.reason = validated.reason;
    if (validated.project !== undefined) options.project = validated.project;

    await service.addPattern(validated.pattern, validated.tier, options);

    return sendResource(
      c,
      "slb_pattern_added",
      {
        pattern: validated.pattern,
        tier: validated.tier,
        addedAt: new Date().toISOString(),
      },
      201,
    );
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /slb/patterns/suggest - Suggest a pattern for human review
 */
slb.post("/patterns/suggest", async (c) => {
  try {
    const body = await c.req.json();
    const validated = AddPatternSchema.parse(body);
    const service = getSlbService();

    const options: { reason?: string; project?: string } = {};
    if (validated.reason !== undefined) options.reason = validated.reason;
    if (validated.project !== undefined) options.project = validated.project;

    await service.suggestPattern(validated.pattern, validated.tier, options);

    return sendResource(c, "slb_pattern_suggested", {
      pattern: validated.pattern,
      tier: validated.tier,
      suggestedAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

export { slb };
