/**
 * Agent Service - Manages agent lifecycle and state.
 *
 * Provides a high-level interface for agent operations,
 * coordinating between the REST API and agent drivers.
 */

import { createClaudeDriver, type ClaudeSDKDriver } from "@flywheel/agent-drivers";
import type { Agent, AgentConfig } from "@flywheel/agent-drivers";
import { eq } from "drizzle-orm";
import { db, agents as agentsTable } from "../db";
import { getLogger } from "../middleware/correlation";
import { audit } from "./audit";
import {
  initializeAgentState,
  markAgentReady,
  markAgentExecuting,
  markAgentIdle,
  markAgentTerminating,
  markAgentTerminated,
  markAgentFailed,
} from "./agent-state-machine";

// In-memory agent registry
const agents = new Map<string, AgentRecord>();

// Single driver instance (SDK driver for now)
let driver: ClaudeSDKDriver | undefined;

interface AgentRecord {
  agent: Agent;
  createdAt: Date;
  timeout: number;
  /** Count of messages sent TO the agent (from users) */
  messagesReceived: number;
  /** Count of messages sent BY the agent - TODO: implement when output streaming is added */
  messagesSent: number;
  toolCalls: number;
}

async function refreshAgentRecord(
  record: AgentRecord,
  drv: ClaudeSDKDriver
): Promise<void> {
  try {
    const state = await drv.getState(record.agent.id);
    record.agent.activityState = state.activityState;
    record.agent.lastActivityAt = state.lastActivityAt;
    record.agent.tokenUsage = state.tokenUsage;
    record.agent.contextHealth = state.contextHealth;
  } catch {
    // Ignore refresh failures; caller can proceed with cached state.
  }
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

  // Initialize lifecycle state tracking
  initializeAgentState(agentId);

  const drv = await getDriver();
  let spawned = false;

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
    spawned = true;
    const agent = result.agent;

    const record: AgentRecord = {
      agent,
      createdAt: new Date(),
      timeout: config.timeout ?? 3600000, // Default 1 hour
      messagesReceived: 0,
      messagesSent: 0,
      toolCalls: 0,
    };

    agents.set(agentId, record);

    // Persist to DB
    await db.insert(agentsTable).values({
      id: agentId,
      repoUrl: config.workingDirectory,
      task: config.systemPrompt?.slice(0, 100) ?? "Interactive Session",
      model: agentConfig.model,
      status: "spawning",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Transition to READY state
    markAgentReady(agentId);
    await db
      .update(agentsTable)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(agentsTable.id, agentId));
    await db
      .update(agentsTable)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(agentsTable.id, agentId));

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
    if (spawned) {
      try {
        await drv.terminate(agentId, true);
      } catch {
        // Best-effort cleanup; proceed with error handling
      }
      agents.delete(agentId);
    }
    // Mark agent as failed in lifecycle state
    markAgentFailed(agentId, "error", {
      code: "SPAWN_FAILED",
      message: String(error),
    });

    // Best-effort cleanup to avoid leaking agents on partial failures.
    if (agents.has(agentId)) {
      try {
        await drv.terminate(agentId, true);
      } catch {
        // Ignore cleanup failures; we already have a spawn failure.
      }
      agents.delete(agentId);
    }

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
  createdAfter?: string;
  createdBefore?: string;
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
  if (agentList.length > 0) {
    const drv = await getDriver();
    await Promise.all(agentList.map((record) => refreshAgentRecord(record, drv)));
  }

  // Filter by state
  if (options.state?.length) {
    agentList = agentList.filter((r) => options.state!.includes(r.agent.activityState));
  }

  // Filter by driver
  if (options.driver?.length) {
    agentList = agentList.filter((r) => options.driver!.includes(r.agent.driverType));
  }

  // Filter by createdAt time range
  if (options.createdAfter) {
    const parsed = new Date(options.createdAfter);
    if (!Number.isNaN(parsed.getTime())) {
      agentList = agentList.filter((r) => r.createdAt >= parsed);
    }
  }
  if (options.createdBefore) {
    const parsed = new Date(options.createdBefore);
    if (!Number.isNaN(parsed.getTime())) {
      agentList = agentList.filter((r) => r.createdAt <= parsed);
    }
  }

  // Sort by createdAt descending
  agentList.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // Apply pagination
  const total = agentList.length;
  let startIndex = 0;
  if (options.cursor) {
    const parsed = parseInt(options.cursor, 10);
    if (!Number.isNaN(parsed)) {
      startIndex = parsed;
    }
  }
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

  const drv = await getDriver();
  await refreshAgentRecord(record, drv);
  const { agent } = record;

  return {
    agentId: agent.id,
    state: agent.activityState,
    driver: agent.driverType,
    createdAt: record.createdAt.toISOString(),
    lastActivityAt: agent.lastActivityAt.toISOString(),
    config: {
      workingDirectory: agent.config.workingDirectory,
      timeout: record.timeout,
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

  // Transition to TERMINATING state
  markAgentTerminating(agentId);

  const drv = await getDriver();

  try {
    await drv.terminate(agentId, graceful);
    agents.delete(agentId);

    // Update DB status
    await db.update(agentsTable)
      .set({ status: "terminated", updatedAt: new Date() })
      .where(eq(agentsTable.id, agentId));

    // Mark as fully terminated
    markAgentTerminated(agentId);

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
    // Mark as failed if termination fails
    markAgentFailed(agentId, "driver_error", {
      code: "TERMINATE_FAILED",
      message: String(error),
    });

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
    throw new AgentError("AGENT_ERROR_STATE", `Agent ${agentId} is in error state`);
  }

  // Transition to EXECUTING state when processing a message
  try {
    markAgentExecuting(agentId);
  } catch {
    // May already be in EXECUTING state, which is fine
  }

  const drv = await getDriver();

  try {
    const result = await drv.send(agentId, content);
    record.messagesReceived++;

    // Note: Transition back to READY happens when agent finishes processing
    // This is typically detected through output events or polling
    // For now, we stay in EXECUTING until the next status check detects idle state

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
    try {
      markAgentIdle(agentId);
    } catch {
      // Ignore invalid transitions on failure recovery.
    }
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
    types?: string[];
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

  // Safely parse cursor timestamp - invalid values result in no filtering
  let since: Date | undefined;
  if (options.cursor) {
    const parsed = parseInt(options.cursor, 10);
    if (!Number.isNaN(parsed)) {
      since = new Date(parsed);
    }
  }
  const limit = options.limit ?? 100;

  let output = await drv.getOutput(agentId, since, limit);
  if (options.types && options.types.length > 0) {
    output = output.filter((line) => options.types!.includes(line.type));
  }

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
