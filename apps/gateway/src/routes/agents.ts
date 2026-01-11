/**
 * Agent Routes - REST API endpoints for agent lifecycle and communication.
 */

import { type ErrorCode, getHttpStatus } from "@flywheel/shared";
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import { isAlive } from "../models/agent-state";
import {
  AgentError,
  getAgent,
  getAgentOutput,
  interruptAgent,
  listAgents,
  sendMessage,
  spawnAgent,
  terminateAgent,
} from "../services/agent";
import {
  getAgentState,
  getAgentStateHistory,
} from "../services/agent-state-machine";
import {
  sendCreated,
  sendError,
  sendInternalError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";

const agents = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const SpawnRequestSchema = z.object({
  workingDirectory: z.string().min(1),
  agentId: z.string().min(1).optional(),
  systemPrompt: z.string().min(1).optional(),
  timeout: z.number().min(1000).max(86400000).optional(),
  maxTokens: z.number().min(1000).max(1000000).optional(),
});

const SendRequestSchema = z.object({
  type: z.enum(["user", "system"]),
  content: z.string().min(1),
  stream: z.boolean().optional(),
});

const InterruptRequestSchema = z.object({
  signal: z.enum(["SIGINT", "SIGTSTP", "SIGCONT"]).default("SIGINT"),
});

// ============================================================================
// Error Handler Helper
// ============================================================================

/**
 * Convert HTTP URL to WebSocket URL.
 * Handles both http→ws and https→wss correctly.
 */
function toWebSocketUrl(httpUrl: string): string {
  const url = new URL(httpUrl);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${url.host}`;
}

/**
 * Safely parse an integer from query param, returning default if invalid.
 */
function safeParseInt(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function handleAgentError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof AgentError) {
    // Try to get HTTP status from error codes, fall back to 500
    let httpStatus: ContentfulStatusCode = 500;
    try {
      const status = getHttpStatus(error.code as ErrorCode);
      if (status) httpStatus = status as ContentfulStatusCode;
    } catch {
      // Unknown error code, use 500
    }
    log.warn(
      { error: error.code, message: error.message },
      "Agent operation failed",
    );
    return sendError(c, error.code, error.message, httpStatus);
  }

  if (error instanceof z.ZodError) {
    const validationErrors = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));
    return sendValidationError(c, validationErrors);
  }

  // Handle JSON parse errors (SyntaxError from c.req.json())
  if (error instanceof SyntaxError && error.message.includes("JSON")) {
    return sendError(c, "INVALID_REQUEST", "Invalid JSON in request body", 400);
  }

  log.error({ error }, "Unexpected error in agent route");
  return sendInternalError(c);
}

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /agents - Spawn a new agent
 */
agents.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const validated = SpawnRequestSchema.parse(body);
    const result = await spawnAgent({
      workingDirectory: validated.workingDirectory,
      ...(validated.agentId && { agentId: validated.agentId }),
      ...(validated.systemPrompt && { systemPrompt: validated.systemPrompt }),
      ...(validated.timeout && { timeout: validated.timeout }),
      ...(validated.maxTokens && { maxTokens: validated.maxTokens }),
    });

    const baseUrl = new URL(c.req.url).origin;

    return sendResource(c, "agent", result, 201, {
      links: {
        self: `${baseUrl}/agents/${result.agentId}`,
        output: `${baseUrl}/agents/${result.agentId}/output`,
        ws: `${toWebSocketUrl(baseUrl)}/agents/${result.agentId}/ws`,
      },
    });
  } catch (error) {
    return handleAgentError(error, c);
  }
});

/**
 * GET /agents - List agents
 */
agents.get("/", async (c) => {
  try {
    const stateParam = c.req.query("state");
    const driverParam = c.req.query("driver");
    const createdAfterParam = c.req.query("createdAfter");
    const createdBeforeParam = c.req.query("createdBefore");
    const limitParam = c.req.query("limit");
    const cursorParam = c.req.query("cursor");

    const result = await listAgents({
      ...(stateParam && { state: stateParam.split(",") }),
      ...(driverParam && { driver: driverParam.split(",") }),
      ...(createdAfterParam && { createdAfter: createdAfterParam }),
      ...(createdBeforeParam && { createdBefore: createdBeforeParam }),
      limit: safeParseInt(limitParam, 50),
      ...(cursorParam && { cursor: cursorParam }),
    });

    const baseUrl = new URL(c.req.url).origin;

    // Add links to each agent
    const agentsWithLinks = result.agents.map((agent) => ({
      ...agent,
      links: {
        self: `${baseUrl}/agents/${agent.agentId}`,
      },
    }));

    const listOptions: Parameters<typeof sendList>[2] = {
      hasMore: result.pagination?.hasMore ?? false,
    };
    if (result.pagination?.cursor) {
      listOptions.nextCursor = result.pagination.cursor;
    }
    if (result.pagination?.total !== undefined) {
      listOptions.total = result.pagination.total;
    }

    return sendList(c, agentsWithLinks, listOptions);
  } catch (error) {
    return handleAgentError(error, c);
  }
});

/**
 * GET /agents/:agentId - Get agent details
 */
agents.get("/:agentId", async (c) => {
  try {
    const agentId = c.req.param("agentId");
    const result = await getAgent(agentId);

    const baseUrl = new URL(c.req.url).origin;

    return sendResource(c, "agent", result, 200, {
      links: {
        self: `${baseUrl}/agents/${agentId}`,
        output: `${baseUrl}/agents/${agentId}/output`,
        ws: `${toWebSocketUrl(baseUrl)}/agents/${agentId}/ws`,
        terminate: `${baseUrl}/agents/${agentId}`,
        send: `${baseUrl}/agents/${agentId}/send`,
        interrupt: `${baseUrl}/agents/${agentId}/interrupt`,
      },
    });
  } catch (error) {
    return handleAgentError(error, c);
  }
});

/**
 * GET /agents/:agentId/status - Get detailed agent status
 *
 * Returns lifecycle state, health checks, and recent state history.
 */
agents.get("/:agentId/status", async (c) => {
  try {
    const agentId = c.req.param("agentId");

    // Get lifecycle state
    const stateRecord = getAgentState(agentId);
    if (!stateRecord) {
      return sendNotFound(c, "agent", agentId);
    }

    // Get agent details for additional metrics
    let agentDetails: Awaited<ReturnType<typeof getAgent>> | null;
    try {
      agentDetails = await getAgent(agentId);
    } catch {
      // Agent may be in terminal state and not in the agent registry
      agentDetails = null;
    }

    const now = new Date();
    const stateEnteredAt = stateRecord.stateEnteredAt;
    const uptime = Math.floor(
      (now.getTime() - stateRecord.createdAt.getTime()) / 1000,
    );

    // Build health checks based on state
    const healthChecks: Record<string, "healthy" | "degraded" | "unhealthy"> = {
      lifecycle: isAlive(stateRecord.currentState) ? "healthy" : "unhealthy",
    };

    if (agentDetails) {
      healthChecks["process"] = "healthy";
      healthChecks["driver"] = "healthy";
    } else if (!isAlive(stateRecord.currentState)) {
      healthChecks["process"] = "unhealthy";
    }

    // Get recent history (last 10 transitions)
    const history = getAgentStateHistory(agentId).slice(-10);

    const statusData = {
      agentId,
      lifecycleState: stateRecord.currentState,
      stateEnteredAt: stateEnteredAt.toISOString(),
      uptime,
      createdAt: stateRecord.createdAt.toISOString(),
      lastActivity:
        agentDetails?.lastActivityAt ?? stateEnteredAt.toISOString(),
      healthChecks,
      metrics: agentDetails
        ? {
            messagesReceived: agentDetails.stats.messagesReceived,
            messagesSent: agentDetails.stats.messagesSent,
            tokensUsed: agentDetails.stats.tokensUsed,
            toolCalls: agentDetails.stats.toolCalls,
          }
        : null,
      history: history.map((t) => ({
        previousState: t.previousState,
        newState: t.newState,
        timestamp: t.timestamp.toISOString(),
        reason: t.reason,
        ...(t.error && { error: t.error }),
      })),
    };

    return sendResource(c, "agent_status", statusData);
  } catch (error) {
    return handleAgentError(error, c);
  }
});

/**
 * DELETE /agents/:agentId - Terminate agent
 */
agents.delete("/:agentId", async (c) => {
  try {
    const agentId = c.req.param("agentId");
    const graceful = c.req.query("graceful") !== "false";
    const result = await terminateAgent(agentId, graceful);

    return sendResource(c, "agent_termination", result, 202);
  } catch (error) {
    return handleAgentError(error, c);
  }
});

/**
 * POST /agents/:agentId/send - Send message to agent
 */
agents.post("/:agentId/send", async (c) => {
  try {
    const agentId = c.req.param("agentId");
    const body = await c.req.json();
    const validated = SendRequestSchema.parse(body);
    const result = await sendMessage(
      agentId,
      validated.type,
      validated.content,
    );

    return sendResource(c, "message_sent", result, 202);
  } catch (error) {
    return handleAgentError(error, c);
  }
});

/**
 * POST /agents/:agentId/interrupt - Interrupt agent
 */
agents.post("/:agentId/interrupt", async (c) => {
  try {
    const agentId = c.req.param("agentId");
    let signal = "SIGINT";

    try {
      const body = await c.req.json();
      const validated = InterruptRequestSchema.parse(body);
      signal = validated.signal;
    } catch (parseError) {
      // Use default SIGINT if no body or empty body, but propagate validation errors
      if (parseError instanceof z.ZodError) {
        throw parseError;
      }
      // SyntaxError or other JSON parsing issues - use default signal
    }

    const result = await interruptAgent(agentId, signal);
    return sendResource(c, "interrupt_sent", result, 202);
  } catch (error) {
    return handleAgentError(error, c);
  }
});

/**
 * GET /agents/:agentId/output - Get agent output
 */
agents.get("/:agentId/output", async (c) => {
  try {
    const agentId = c.req.param("agentId");
    const cursorParam = c.req.query("cursor");
    const limitParam = c.req.query("limit");
    const typesParam = c.req.query("types");

    const result = await getAgentOutput(agentId, {
      ...(cursorParam && { cursor: cursorParam }),
      limit: safeParseInt(limitParam, 100),
      ...(typesParam && { types: typesParam.split(",") }),
    });

    const outputListOptions: Parameters<typeof sendList>[2] = {
      hasMore: result.pagination?.hasMore ?? false,
    };
    if (result.pagination?.cursor) {
      outputListOptions.nextCursor = result.pagination.cursor;
    }

    return sendList(c, result.chunks, outputListOptions);
  } catch (error) {
    return handleAgentError(error, c);
  }
});

export { agents };
