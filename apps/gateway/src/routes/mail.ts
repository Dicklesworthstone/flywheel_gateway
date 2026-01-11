/**
 * Agent Mail Routes - REST API endpoints for inter-agent messaging and coordination.
 *
 * Endpoints:
 * - Projects: /mail/projects
 * - Agents: /mail/agents
 * - Messages: /mail/messages
 * - Reservations: /mail/reservations
 * - Sessions: /mail/sessions (macro)
 */

import {
  AgentMailClientError,
  type AgentMailPriority,
} from "@flywheel/flywheel-clients";
import type { GatewayError } from "@flywheel/shared/errors";
import { serializeGatewayError } from "@flywheel/shared/errors";
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  type AgentMailService,
  createAgentMailServiceFromEnv,
} from "../services/agentmail";
import {
  sendResource,
  sendList,
  sendNotFound,
  sendError,
  sendValidationError,
  sendInternalError,
  sendCreated,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

// ============================================================================
// Validation Schemas
// ============================================================================

const EnsureProjectSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const RegisterAgentSchema = z.object({
  projectId: z.string().min(1),
  agentId: z.string().min(1),
  capabilities: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const SendMessageSchema = z.object({
  projectId: z.string().min(1),
  to: z.string().min(1),
  subject: z.string().min(1),
  body: z.unknown(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  ttl: z.number().int().positive().optional(),
});

const ReplySchema = z.object({
  messageId: z.string().min(1),
  body: z.unknown(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
});

const ReserveFilesSchema = z.object({
  projectId: z.string().min(1),
  requesterId: z.string().min(1),
  patterns: z.array(z.string().min(1)).min(1),
  duration: z.number().int().positive().optional(),
  exclusive: z.boolean(),
});

const StartSessionSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  agentId: z.string().min(1),
  capabilities: z.array(z.string()).optional(),
  projectMetadata: z.record(z.string(), z.unknown()).optional(),
  agentMetadata: z.record(z.string(), z.unknown()).optional(),
});

const HealthSchema = z.object({
  probe: z.enum(["liveness", "readiness"]).optional(),
});

// ============================================================================
// Helper Functions
// ============================================================================

function respondWithGatewayError(c: Context, error: GatewayError) {
  const payload = serializeGatewayError(error);
  return sendError(
    c,
    payload.code,
    payload.message,
    payload.httpStatus as ContentfulStatusCode,
  );
}

function handleError(error: unknown, c: Context) {
  const log = getLogger();
  const service = c.get("agentMail") ?? createAgentMailServiceFromEnv();

  if (error instanceof z.ZodError) {
    return sendValidationError(c, transformZodError(error));
  }

  if (error instanceof AgentMailClientError) {
    const mapped = service.mapError(error);
    return respondWithGatewayError(c, mapped);
  }

  log.error({ error }, "Unexpected error in mail route");
  return sendInternalError(c);
}

// ============================================================================
// Project Routes
// ============================================================================

/**
 * POST /mail/projects - Ensure a project exists (idempotent)
 */
function createMailRoutes(service?: AgentMailService) {
  const mail = new Hono<{ Variables: { agentMail: AgentMailService } }>();
  let cachedService: AgentMailService | undefined = service;

  mail.use("*", async (c, next) => {
    if (!cachedService) {
      cachedService = createAgentMailServiceFromEnv();
    }
    c.set("agentMail", cachedService);
    await next();
  });

  mail.post("/projects", async (c) => {
    try {
      const body = await c.req.json();
      const validated = EnsureProjectSchema.parse(body);
      const service = c.get("agentMail");

      const result = await service.client.ensureProject(validated);

      const status = result.created ? 201 : 200;
      return sendResource(
        c,
        "project",
        {
          projectId: result.projectId,
          created: result.created,
        },
        status as ContentfulStatusCode,
      );
    } catch (error) {
      return handleError(error, c);
    }
  });

  // ============================================================================
  // Agent Routes
  // ============================================================================

  /**
   * POST /mail/agents - Register an agent
   */
  mail.post("/agents", async (c) => {
    try {
      const body = await c.req.json();
      const validated = RegisterAgentSchema.parse(body);
      const service = c.get("agentMail");

      const result = await service.client.registerAgent(validated);

      return sendCreated(c, "agent", result, `/mail/agents/${result["agentId"] || "unknown"}`);
    } catch (error) {
      return handleError(error, c);
    }
  });

  // ============================================================================
  // Message Routes
  // ============================================================================

  /**
   * POST /mail/messages - Send a message
   */
  mail.post("/messages", async (c) => {
    try {
      const body = await c.req.json();
      const validated = SendMessageSchema.parse(body);
      const service = c.get("agentMail");

      const message = await service.client.sendMessage({
        projectId: validated.projectId,
        to: validated.to,
        subject: validated.subject,
        body: validated.body,
        priority: validated.priority as AgentMailPriority,
        ttl: validated.ttl,
      });

      return sendCreated(
        c,
        "message",
        message,
        `/mail/messages/${message.messageId || "unknown"}`,
      );
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * POST /mail/messages/:messageId/reply - Reply to a message
   */
  mail.post("/messages/:messageId/reply", async (c) => {
    try {
      const messageId = c.req.param("messageId");
      const body = await c.req.json();
      const validated = ReplySchema.omit({ messageId: true }).parse(body);
      const service = c.get("agentMail");

      const result = await service.client.reply({
        messageId,
        body: validated.body,
        priority: validated.priority as AgentMailPriority | undefined,
      });

      return sendCreated(
        c,
        "reply",
        result,
        `/mail/messages/${messageId}/reply`,
      );
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * GET /mail/messages/inbox - Fetch inbox for an agent
   */
  mail.get("/messages/inbox", async (c) => {
    try {
      const projectId = c.req.query("projectId");
      const agentId = c.req.query("agentId");

      if (!projectId || !agentId) {
        return sendError(
          c,
          "MISSING_PARAMETERS",
          "projectId and agentId are required",
          400,
        );
      }

      const service = c.get("agentMail");
      const limitStr = c.req.query("limit");
      const parsedLimit = limitStr ? parseInt(limitStr, 10) : undefined;
      // Ensure we don't pass NaN if limit is not a valid number
      const limit =
        parsedLimit !== undefined && !Number.isNaN(parsedLimit)
          ? parsedLimit
          : undefined;
      const since = c.req.query("since");
      const priority = c.req.query("priority") as AgentMailPriority | undefined;

      const fetchInput: Parameters<typeof service.client.fetchInbox>[0] = {
        projectId,
        agentId,
      };
      if (limit !== undefined) fetchInput.limit = limit;
      if (since !== undefined) fetchInput.since = since;
      if (priority !== undefined) fetchInput.priority = priority;

      const result = await service.client.fetchInbox(fetchInput);

      if (Array.isArray(result) && result.length === 0) {
        return sendList(c, result);
      }

      return sendList(c, Array.isArray(result) ? result : [result]);
    } catch (error) {
      return handleError(error, c);
    }
  });

  // ============================================================================
  // Reservation Routes
  // ============================================================================

  /**
   * POST /mail/reservations - Create file reservations
   */
  mail.post("/reservations", async (c) => {
    try {
      const body = await c.req.json();
      const validated = ReserveFilesSchema.parse(body);
      const service = c.get("agentMail");

      const result = await service.client.reservationCycle({
        projectId: validated.projectId,
        requesterId: validated.requesterId,
        patterns: validated.patterns,
        duration: validated.duration,
        exclusive: validated.exclusive,
      });

      return sendCreated(
        c,
        "reservation",
        result,
        `/mail/reservations/${result.reservationId || "unknown"}`,
      );
    } catch (error) {
      return handleError(error, c);
    }
  });

  // ============================================================================
  // Session Macro Routes
  // ============================================================================

  /**
   * POST /mail/sessions - Start a session (macro: ensure project + register agent)
   */
  mail.post("/sessions", async (c) => {
    try {
      const body = await c.req.json();
      const validated = StartSessionSchema.parse(body);
      const service = c.get("agentMail");

      const sessionInput: Parameters<typeof service.client.startSession>[0] = {
        projectId: validated.projectId,
        name: validated.name,
        agentId: validated.agentId,
      };
      if (validated.capabilities !== undefined)
        sessionInput.capabilities = validated.capabilities;
      if (validated.projectMetadata !== undefined)
        sessionInput.projectMetadata = validated.projectMetadata;
      if (validated.agentMetadata !== undefined)
        sessionInput.agentMetadata = validated.agentMetadata;

      const result = await service.client.startSession(sessionInput);

      return sendCreated(
        c,
        "session",
        {
          project: result.project,
          agent: result.registration,
        },
        `/mail/sessions/${result.registration?.["agentId"] || "unknown"}`,
      );
    } catch (error) {
      return handleError(error, c);
    }
  });

  // ============================================================================
  // Health Routes
  // ============================================================================

  /**
   * GET /mail/health - Health check for Agent Mail MCP server
   */
  mail.get("/health", async (c) => {
    try {
      const service = c.get("agentMail");
      const validated = HealthSchema.parse({
        probe: c.req.query("probe"),
      });
      const result = await service.client.healthCheck(validated);
      return sendResource(c, "health", result);
    } catch (error) {
      return handleError(error, c);
    }
  });

  return mail;
}

const mail = createMailRoutes();

export { mail, createMailRoutes };
