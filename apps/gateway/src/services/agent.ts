/**
 * Agent Service - Manages agent lifecycle and state.
 *
 * Provides a high-level interface for agent operations,
 * coordinating between the REST API and agent drivers.
 */

import { createClaudeDriver, type ClaudeSDKDriver } from "@flywheel/agent-drivers";
import type { Agent, AgentConfig, SendResult, OutputLine } from "@flywheel/agent-drivers";
import { getLogger } from "../middleware/correlation";
import { audit } from "./audit";

// In-memory agent registry
const agents = new Map<string, AgentRecord>();

// Single driver instance (SDK driver for now)
let driver: ClaudeSDKDriver | undefined;

interface AgentRecord {
  agent: Agent;
  createdAt: Date;
  messagesReceived: number;
  messagesSent: number;
  toolCalls: number;
}

/**
 * Get or create the agent driver.
 */
async function getDriver(): Promise<ClaudeSDKDriver> {
  if (!driver) {
    driver = await createClaudeDriver();
  }
  return driver;
}

/**
 * Generate a unique agent ID.
 */
function generateAgentId(): string {
  return `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Spawn a new agent.
 */
export async function spawnAgent(config: {
  workingDirectory: string;
  agentId?: string;
  systemPrompt?: string;
  timeout?: number;
  maxTokens?: number;
}): Promise<{
  agentId: string;
  state: "spawning" | "ready";
  createdAt: string;
  driver: string;
}> {
  const log = getLogger();
  const agentId = config.agentId ?? generateAgentId();

  // Check if agent already exists
  if (agents.has(agentId)) {
    throw new AgentError("AGENT_ALREADY_EXISTS", `Agent ${agentId} already exists`);
  }

  const drv = await getDriver();

  const agentConfig: AgentConfig = {
    id: agentId,
    name: `Agent ${agentId}`,
    provider: "claude",
    model: "sonnet-4",
    workingDirectory: config.workingDirectory,
    ...(config.systemPrompt && { systemPrompt: config.systemPrompt }),
    ...(config.maxTokens && { maxTokens: config.maxTokens }),
  };

  try {
    const result = await drv.spawn(agentConfig);
    const agent = result.agent;

    const record: AgentRecord = {
      agent,
      createdAt: new Date(),
      messagesReceived: 0,
      messagesSent: 0,
      toolCalls: 0,
    };

    agents.set(agentId, record);

    log.info({ agentId, workingDirectory: config.workingDirectory }, "Agent spawned");

    audit({
      action: "agent.spawn",
      resource: agentId,
      resourceType: "agent",
      outcome: "success",
      metadata: { workingDirectory: config.workingDirectory },
    });

    return {
      agentId,
      state: agent.activityState === "idle" ? "ready" : "spawning",
      createdAt: agent.startedAt.toISOString(),
      driver: agent.driverType,
    };
  } catch (error) {
    log.error({ error, agentId }, "Failed to spawn agent");
    audit({
      action: "agent.spawn",
      resource: agentId,
      resourceType: "agent",
      outcome: "failure",
      metadata: { error: String(error) },
    });
    throw new AgentError("SPAWN_FAILED", `Failed to spawn agent: ${error}`);
  }
}

/**
 * List all agents.
 */
export async function listAgents(options: {
  state?: string[];
  driver?: string[];
  limit?: number;
  cursor?: string;
}): Promise<{
  agents: Array<{
    agentId: string;
    state: string;
    driver: string;
    createdAt: string;
    lastActivityAt: string;
  }>;
  pagination: {
    cursor?: string;
    hasMore: boolean;
    total: number;
  };
}> {
  const limit = options.limit ?? 50;
  let agentList = Array.from(agents.values());

  // Filter by state
  if (options.state?.length) {
    agentList = agentList.filter((r) => options.state!.includes(r.agent.activityState));
  }

  // Filter by driver
  if (options.driver?.length) {
    agentList = agentList.filter((r) => options.driver!.includes(r.agent.driverType));
  }

  // Sort by createdAt descending
  agentList.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // Apply pagination
  const total = agentList.length;
  const startIndex = options.cursor ? parseInt(options.cursor, 10) : 0;
  const paginatedList = agentList.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < total;
  const nextCursor = hasMore ? String(startIndex + limit) : undefined;

  return {
    agents: paginatedList.map((r) => ({
      agentId: r.agent.id,
      state: r.agent.activityState,
      driver: r.agent.driverType,
      createdAt: r.createdAt.toISOString(),
      lastActivityAt: r.agent.lastActivityAt.toISOString(),
    })),
    pagination: {
      ...(nextCursor && { cursor: nextCursor }),
      hasMore,
      total,
    },
  };
}

/**
 * Get agent details.
 */
export async function getAgent(agentId: string): Promise<{
  agentId: string;
  state: string;
  driver: string;
  createdAt: string;
  lastActivityAt: string;
  config: {
    workingDirectory: string;
    timeout: number;
    maxTokens: number;
    pty: boolean;
  };
  stats: {
    messagesReceived: number;
    messagesSent: number;
    tokensUsed: number;
    toolCalls: number;
  };
}> {
  const record = agents.get(agentId);
  if (!record) {
    throw new AgentError("AGENT_NOT_FOUND", `Agent ${agentId} not found`);
  }

  const { agent } = record;

  return {
    agentId: agent.id,
    state: agent.activityState,
    driver: agent.driverType,
    createdAt: record.createdAt.toISOString(),
    lastActivityAt: agent.lastActivityAt.toISOString(),
    config: {
      workingDirectory: agent.config.workingDirectory,
      timeout: 3600000,
      maxTokens: agent.config.maxTokens ?? 100000,
      pty: false,
    },
    stats: {
      messagesReceived: record.messagesReceived,
      messagesSent: record.messagesSent,
      tokensUsed: agent.tokenUsage.totalTokens,
      toolCalls: record.toolCalls,
    },
  };
}

/**
 * Terminate an agent.
 */
export async function terminateAgent(
  agentId: string,
  graceful = true
): Promise<{
  agentId: string;
  state: "terminating";
}> {
  const log = getLogger();
  const record = agents.get(agentId);

  if (!record) {
    throw new AgentError("AGENT_NOT_FOUND", `Agent ${agentId} not found`);
  }

  const drv = await getDriver();

  try {
    await drv.terminate(agentId, graceful);
    agents.delete(agentId);

    log.info({ agentId, graceful }, "Agent terminated");

    audit({
      action: "agent.terminate",
      resource: agentId,
      resourceType: "agent",
      outcome: "success",
      metadata: { graceful },
    });

    return {
      agentId,
      state: "terminating",
    };
  } catch (error) {
    log.error({ error, agentId }, "Failed to terminate agent");
    throw new AgentError("DRIVER_COMMUNICATION_ERROR", `Failed to terminate: ${error}`);
  }
}

/**
 * Send a message to an agent.
 */
export async function sendMessage(
  agentId: string,
  type: "user" | "system",
  content: string
): Promise<{
  messageId: string;
  receivedAt: string;
  state: "queued" | "processing";
}> {
  const log = getLogger();
  const record = agents.get(agentId);

  if (!record) {
    throw new AgentError("AGENT_NOT_FOUND", `Agent ${agentId} not found`);
  }

  if (record.agent.activityState === "error") {
    throw new AgentError("AGENT_TERMINATED", `Agent ${agentId} is in error state`);
  }

  const drv = await getDriver();

  try {
    const result = await drv.send(agentId, content);
    record.messagesReceived++;

    log.info({ agentId, messageId: result.messageId, type }, "Message sent to agent");

    audit({
      action: "agent.send",
      resource: agentId,
      resourceType: "agent",
      outcome: "success",
      metadata: { messageId: result.messageId, type },
    });

    return {
      messageId: result.messageId,
      receivedAt: new Date().toISOString(),
      state: result.queued ? "queued" : "processing",
    };
  } catch (error) {
    log.error({ error, agentId }, "Failed to send message");
    throw new AgentError("DRIVER_COMMUNICATION_ERROR", `Failed to send: ${error}`);
  }
}

/**
 * Get agent output.
 */
export async function getAgentOutput(
  agentId: string,
  options: {
    cursor?: string;
    limit?: number;
  }
): Promise<{
  chunks: Array<{
    cursor: string;
    timestamp: string;
    type: string;
    content: string | Record<string, unknown>;
  }>;
  pagination: {
    cursor: string;
    hasMore: boolean;
  };
}> {
  const record = agents.get(agentId);

  if (!record) {
    throw new AgentError("AGENT_NOT_FOUND", `Agent ${agentId} not found`);
  }

  const drv = await getDriver();
  const since = options.cursor ? new Date(parseInt(options.cursor, 10)) : undefined;
  const limit = options.limit ?? 100;

  const output = await drv.getOutput(agentId, since, limit);

  const chunks = output.map((line) => ({
    cursor: String(line.timestamp.getTime()),
    timestamp: line.timestamp.toISOString(),
    type: line.type,
    content: line.content,
  }));

  const lastChunk = chunks[chunks.length - 1];
  const nextCursor = lastChunk?.cursor ?? options.cursor ?? "0";

  return {
    chunks,
    pagination: {
      cursor: nextCursor,
      hasMore: chunks.length >= limit,
    },
  };
}

/**
 * Interrupt an agent.
 */
export async function interruptAgent(
  agentId: string,
  signal: string = "SIGINT"
): Promise<{
  agentId: string;
  signal: string;
  sentAt: string;
  previousState: string;
}> {
  const log = getLogger();
  const record = agents.get(agentId);

  if (!record) {
    throw new AgentError("AGENT_NOT_FOUND", `Agent ${agentId} not found`);
  }

  const previousState = record.agent.activityState;
  const drv = await getDriver();

  try {
    await drv.interrupt(agentId);

    log.info({ agentId, signal }, "Agent interrupted");

    return {
      agentId,
      signal,
      sentAt: new Date().toISOString(),
      previousState,
    };
  } catch (error) {
    log.error({ error, agentId }, "Failed to interrupt agent");
    throw new AgentError("DRIVER_COMMUNICATION_ERROR", `Failed to interrupt: ${error}`);
  }
}

/**
 * Custom error class for agent operations.
 */
export class AgentError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "AgentError";
  }
}
