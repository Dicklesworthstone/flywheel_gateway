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

import { Hono, type Context } from "hono";
import { z } from "zod";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  createAgentMailService,
  type AgentMailService,
} from "../services/agentmail";
import {
  AgentMailClientError,
  type AgentMailPriority,
} from "@flywheel/flywheel-clients";

const mail = new Hono<{ Variables: { agentMail: AgentMailService } }>();

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

// ============================================================================
// Helper Functions
// ============================================================================

function handleError(error: unknown, c: Context) {
  const log = getLogger();
  const correlationId = getCorrelationId();
  const timestamp = new Date().toISOString();

  if (error instanceof z.ZodError) {
    return c.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Validation failed",
          correlationId,
          timestamp,
          details: error.issues,
        },
      },
      400
    );
  }

  if (error instanceof AgentMailClientError) {
    const statusMap = {
      input_validation: 400,
      response_validation: 502,
      transport: 503,
    } as const;

    const status = statusMap[error.kind];

    return c.json(
      {
        error: {
          code: `AGENT_MAIL_${error.kind.toUpperCase()}`,
          message: error.message,
          correlationId,
          timestamp,
          details: error.details,
        },
      },
      status
    );
  }

  log.error({ error }, "Unexpected error in mail route");
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        correlationId,
        timestamp,
      },
    },
    500
  );
}

// ============================================================================
// Project Routes
// ============================================================================

/**
 * POST /mail/projects - Ensure a project exists (idempotent)
 */
mail.post("/projects", async (c) => {
  try {
    const body = await c.req.json();
    const validated = EnsureProjectSchema.parse(body);
    const service = c.get("agentMail");

    const result = await service.client.ensureProject(validated);

    return c.json(
      {
        projectId: result.projectId,
        created: result.created,
      },
      result.created ? 201 : 200
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

    return c.json(result, 201);
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

    return c.json(message, 201);
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

    return c.json(result, 201);
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
      return c.json(
        {
          error: {
            code: "MISSING_PARAMETERS",
            message: "projectId and agentId are required",
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        400
      );
    }

    const service = c.get("agentMail");
    const limitStr = c.req.query("limit");
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;
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

    return c.json(result);
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

    const result = await service.client.requestFileReservation({
      projectId: validated.projectId,
      requesterId: validated.requesterId,
      patterns: validated.patterns,
      duration: validated.duration,
      exclusive: validated.exclusive,
    });

    return c.json(result, 201);
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

    return c.json(
      {
        project: result.project,
        agent: result.registration,
      },
      201
    );
  } catch (error) {
    return handleError(error, c);
  }
});

export { mail };
