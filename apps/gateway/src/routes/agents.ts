/**
 * Agent Routes - REST API endpoints for agent lifecycle and communication.
 */

import { Hono } from "hono";
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
import { getCorrelationId, getLogger } from "../middleware/correlation";
import { ErrorCodes, getHttpStatus } from "@flywheel/shared";

const agents = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const SpawnRequestSchema = z.object({
  workingDirectory: z.string().min(1),
  agentId: z.string().optional(),
  systemPrompt: z.string().optional(),
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

function handleAgentError(error: unknown, c: any) {
  const log = getLogger();
  const correlationId = getCorrelationId();

  if (error instanceof AgentError) {
    const httpStatus = getHttpStatus(error.code as any) ?? 500;
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
          ws: `${baseUrl.replace("http", "ws")}/agents/${result.agentId}/ws`,
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
      limit: limitParam ? parseInt(limitParam, 10) : 50,
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
        ws: `${baseUrl.replace("http", "ws")}/agents/${agentId}/ws`,
        terminate: `${baseUrl}/agents/${agentId}`,
      },
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
      // Use default signal if no body
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
      limit: limitParam ? parseInt(limitParam, 10) : 100,
    });
    return c.json(result);
  } catch (error) {
    return handleAgentError(error, c);
  }
});

export { agents };
