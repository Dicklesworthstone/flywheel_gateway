/**
 * Agent Routes - REST API endpoints for agent lifecycle and communication.
 */

import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import {
  spawnAgent,
  listAgents,
  getAgent,
  terminateAgent,
  sendMessage,
  getAgentOutput,
  interruptAgent,
  AgentError,
} from "../services/agent";
import {
  getAgentState,
  getAgentStateHistory,
} from "../services/agent-state-machine";
import { LifecycleState, isAlive } from "../models/agent-state";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import { type ErrorCode, getHttpStatus } from "@flywheel/shared";

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
  return httpUrl.replace(/^http/, "ws");
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
  const correlationId = getCorrelationId();

  if (error instanceof AgentError) {
    // Try to get HTTP status from error codes, fall back to 500
    let httpStatus: ContentfulStatusCode = 500;
    try {
      const status = getHttpStatus(error.code as ErrorCode);
      if (status) httpStatus = status as ContentfulStatusCode;
    } catch {
      // Unknown error code, use 500
    }
    log.warn({ error: error.code, message: error.message }, "Agent operation failed");
    return c.json(
      {
        error: {
          code: error.code,
          message: error.message,
          correlationId,
          timestamp: new Date().toISOString(),
        },
      },
      httpStatus
    );
  }

  if (error instanceof z.ZodError) {
    return c.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Validation failed",
          correlationId,
          timestamp: new Date().toISOString(),
          details: error.issues,
        },
      },
      400
    );
  }

  // Handle JSON parse errors (SyntaxError from c.req.json())
  if (error instanceof SyntaxError && error.message.includes("JSON")) {
    return c.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid JSON in request body",
          correlationId,
          timestamp: new Date().toISOString(),
        },
      },
      400
    );
  }

  log.error({ error }, "Unexpected error in agent route");
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        correlationId,
        timestamp: new Date().toISOString(),
      },
    },
    500
  );
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

    return c.json(
      {
        ...result,
        links: {
          self: `${baseUrl}/agents/${result.agentId}`,
          output: `${baseUrl}/agents/${result.agentId}/output`,
          ws: `${toWebSocketUrl(baseUrl)}/agents/${result.agentId}/ws`,
        },
      },
      201
    );
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
    const limitParam = c.req.query("limit");
    const cursorParam = c.req.query("cursor");

    const result = await listAgents({
      ...(stateParam && { state: stateParam.split(",") }),
      ...(driverParam && { driver: driverParam.split(",") }),
      limit: safeParseInt(limitParam, 50),
      ...(cursorParam && { cursor: cursorParam }),
    });

    const baseUrl = new URL(c.req.url).origin;

    return c.json({
      agents: result.agents.map((agent) => ({
        ...agent,
        links: {
          self: `${baseUrl}/agents/${agent.agentId}`,
        },
      })),
      pagination: result.pagination,
    });
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

    return c.json({
      ...result,
      links: {
        self: `${baseUrl}/agents/${agentId}`,
        output: `${baseUrl}/agents/${agentId}/output`,
        ws: `${toWebSocketUrl(baseUrl)}/agents/${agentId}/ws`,
        terminate: `${baseUrl}/agents/${agentId}`,
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
    const correlationId = getCorrelationId();

    // Get lifecycle state
    const stateRecord = getAgentState(agentId);
    if (!stateRecord) {
      return c.json(
        {
          error: {
            code: "AGENT_NOT_FOUND",
            message: `Agent ${agentId} not found`,
            correlationId,
            timestamp: new Date().toISOString(),
          },
        },
        404
      );
    }

    // Get agent details for additional metrics
    let agentDetails;
    try {
      agentDetails = await getAgent(agentId);
    } catch {
      // Agent may be in terminal state and not in the agent registry
      agentDetails = null;
    }

    const now = new Date();
    const stateEnteredAt = stateRecord.stateEnteredAt;
    const uptime = Math.floor(
      (now.getTime() - stateRecord.createdAt.getTime()) / 1000
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

    return c.json({
      agentId,
      lifecycleState: stateRecord.currentState,
      stateEnteredAt: stateEnteredAt.toISOString(),
      uptime,
      createdAt: stateRecord.createdAt.toISOString(),
      lastActivity: agentDetails?.lastActivityAt ?? stateEnteredAt.toISOString(),
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
      correlationId,
    });
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

    return c.json(result, 202);
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
    const result = await sendMessage(agentId, validated.type, validated.content);

    return c.json(result);
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
    } catch {
      // Use default SIGINT if no body provided or parsing fails
    }

    const result = await interruptAgent(agentId, signal);
    return c.json(result);
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

    const result = await getAgentOutput(agentId, {
      ...(cursorParam && { cursor: cursorParam }),
      limit: safeParseInt(limitParam, 100),
    });
    return c.json(result);
  } catch (error) {
    return handleAgentError(error, c);
  }
});

export { agents };
