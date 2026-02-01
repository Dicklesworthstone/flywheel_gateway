/**
 * Agent Service - Manages agent lifecycle and state.
 *
 * Provides a high-level interface for agent operations,
 * coordinating between the REST API and agent drivers.
 */

import {
  type Agent,
  type AgentConfig,
  type AgentDriver,
  selectDriver,
} from "@flywheel/agent-drivers";
import { eq, not } from "drizzle-orm";
import { agents as agentsTable, db } from "../db";
import { getLogger } from "../middleware/correlation";
import { isTerminalState, LifecycleState } from "../models/agent-state";
import {
  clearAgentHealth,
  getAgentHealth,
  getFleetHealthSummary,
  isSafeToRestart,
  pushOutputSample,
} from "./agent-health.service";
import {
  clearAgentErrorEvents,
  recordAgentErrorEvent,
} from "./agent-health-score.events";
import {
  getAgentState,
  hydrateAgentState,
  initializeAgentState,
  markAgentExecuting,
  markAgentFailed,
  markAgentIdle,
  markAgentPaused,
  markAgentReady,
  markAgentTerminated,
  markAgentTerminating,
  removeAgentState,
} from "./agent-state-machine";
import { audit } from "./audit";
import {
  getAutoCheckpointService,
  removeAutoCheckpointService,
} from "./auto-checkpoint.service";
import { createErrorCheckpoint } from "./checkpoint";
import {
  cleanupOutputBuffer,
  getOutput as getOutputFromBuffer,
  pushOutput,
} from "./output.service";

// In-memory agent registry
const agents = new Map<string, AgentRecord>();

// Active monitoring subscriptions (agentId -> AbortController)
const activeMonitors = new Map<string, AbortController>();

// Single driver instance
let driver: AgentDriver | undefined;

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

/**
 * Handle agent events (output, state changes, etc.)
 */
async function handleAgentEvents(
  agentId: string,
  drv: AgentDriver,
): Promise<void> {
  const log = getLogger();
  const abortController = new AbortController();

  // Clean up any existing monitor for this agent
  if (activeMonitors.has(agentId)) {
    activeMonitors.get(agentId)?.abort();
  }
  activeMonitors.set(agentId, abortController);

  const eventStream = drv.subscribe(agentId, abortController.signal);

  try {
    for await (const event of eventStream) {
      if (abortController.signal.aborted) break;

      // 1. Handle Output
      if (event.type === "output") {
        let streamType: "stdout" | "stderr" | "system" = "stdout";
        if (event.output.type === "error") {
          streamType = "stderr";
          recordAgentErrorEvent(agentId, "output_error");
        } else if (event.output.type === "system") {
          streamType = "system";
        }
        pushOutput(
          agentId,
          event.output.type,
          event.output.content,
          streamType,
          event.output.metadata,
        );

        // Feed output to health monitoring for work detection
        pushOutputSample(agentId, event.output.content);
      }

      // 2. Handle State Changes
      else if (event.type === "state_change") {
        if (!agents.has(agentId)) continue; // Race condition: Agent deleted

        const { newState } = event;
        // Map ActivityState to LifecycleState actions
        if (["working", "thinking", "tool_calling"].includes(newState)) {
          try {
            markAgentExecuting(agentId);
          } catch (err) {
            // Ignore invalid transitions (e.g. if already executing) but log
            log.warn({ err, agentId }, "Failed to mark agent executing");
          }
        } else if (["idle", "waiting_input"].includes(newState)) {
          try {
            markAgentIdle(agentId);
          } catch (err) {
            // Ignore invalid transitions
            log.warn({ err, agentId }, "Failed to mark agent idle");
          }
        } else if (newState === "stalled") {
          try {
            markAgentPaused(agentId, "timeout");
          } catch (err) {
            // Ignore invalid transitions (e.g. already paused/terminated)
            log.warn({ err, agentId }, "Failed to mark agent paused");
          }
        } else if (newState === "error") {
          try {
            markAgentFailed(agentId, "driver_error", {
              code: "AGENT_ERROR_STATE",
              message: "Agent entered error state",
            });
          } catch (err) {
            // Ignore invalid transitions (e.g. already failed/terminated)
            log.warn({ err, agentId }, "Failed to mark agent failed");
          }
        }
      }

      // 3. Handle Termination
      else if (event.type === "terminated") {
        // Driver reported termination
        try {
          // We might have already initiated termination, so check state first?
          // Actually markAgentTerminated is idempotent-ish safe
          markAgentTerminated(agentId);
          removeAutoCheckpointService(agentId);
          cleanupOutputBuffer(agentId);
          clearAgentHealth(agentId);
          clearAgentErrorEvents(agentId);
          agents.delete(agentId);

          // Update DB to reflect terminated status (prevents stale "ready"/"executing" rows)
          db.update(agentsTable)
            .set({ status: "terminated", updatedAt: new Date() })
            .where(eq(agentsTable.id, agentId))
            .catch((dbErr: unknown) => {
              log.error(
                { dbErr, agentId },
                "Failed to update DB on agent termination event",
              );
            });
        } catch (err) {
          log.error({ err, agentId }, "Error handling agent termination event");
        }
      }

      // 4. Handle tool call events for stats
      else if (event.type === "tool_call_start") {
        const record = agents.get(agentId);
        if (record) {
          record.toolCalls++;
        }
      }

      // 4b. Tool call completion - record failures for health scoring
      else if (event.type === "tool_call_end") {
        if (!event.success) {
          recordAgentErrorEvent(agentId, "tool_call_failed");
        }
      }

      // 5. Handle error events from driver
      else if (event.type === "error") {
        recordAgentErrorEvent(
          agentId,
          event.recoverable ? "driver_error_recoverable" : "driver_error",
        );
        const stateRecord = getAgentState(agentId);
        if (stateRecord && isTerminalState(stateRecord.currentState)) {
          continue;
        }

        const errorMessage =
          event.error instanceof Error
            ? event.error.message
            : String(event.error);

        try {
          markAgentFailed(agentId, "driver_error", {
            code: "AGENT_RUNTIME_ERROR",
            message: errorMessage,
          });
        } catch (err) {
          log.warn({ err, agentId }, "Failed to mark agent failed");
        }
      }
    }
  } catch (error: unknown) {
    if (!abortController.signal.aborted) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error({ error: err, agentId }, "Error in agent event loop");
    }
  } finally {
    if (activeMonitors.get(agentId) === abortController) {
      activeMonitors.delete(agentId);
    }
  }
}

async function refreshAgentRecord(
  record: AgentRecord,
  drv: AgentDriver,
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
async function getDriver(): Promise<AgentDriver> {
  if (!driver) {
    const result = await selectDriver({ preferredType: "sdk" });
    driver = result.driver;
  }
  return driver;
}

/**
 * Generate a cryptographically secure unique agent ID.
 */
function generateAgentId(): string {
  const randomBytes = new Uint8Array(6);
  crypto.getRandomValues(randomBytes);
  const random = Array.from(randomBytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 8);
  return `agent_${Date.now()}_${random}`;
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
  conversationHistory?: unknown[];
  toolState?: Record<string, unknown>;
}): Promise<{
  agentId: string;
  state: "spawning" | "ready";
  createdAt: string;
  driver: string;
}> {
  const log = getLogger();
  const agentId = config.agentId ?? generateAgentId();

  // Check if agent already exists (runtime or lifecycle state)
  const existingState = getAgentState(agentId);
  if (
    agents.has(agentId) ||
    (existingState && !isTerminalState(existingState.currentState))
  ) {
    throw new AgentError(
      "AGENT_ALREADY_EXISTS",
      `Agent ${agentId} already exists`,
    );
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
    providerOptions: {
      conversationHistory: config.conversationHistory,
      toolState: config.toolState,
    },
  };

  try {
    // Persist to DB immediately with spawning status
    await db.insert(agentsTable).values({
      id: agentId,
      repoUrl: config.workingDirectory,
      task: config.systemPrompt?.slice(0, 100) ?? "Interactive Session",
      model: agentConfig.model,
      status: "spawning",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

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

    // Start event monitoring BEFORE marking ready to prevent TOCTOU race.
    // If subscribe comes after markReady + the awaited DB update, a concurrent
    // terminateAgent call during the await could remove the agent from the
    // driver before subscribe runs, causing "Agent not found" errors.
    handleAgentEvents(agentId, drv).catch((err) => {
      log.error(
        { error: err, agentId },
        "Unhandled error in agent event handler",
      );
    });

    // Transition to READY state
    markAgentReady(agentId);
    await db
      .update(agentsTable)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(agentsTable.id, agentId));

    log.info(
      { agentId, workingDirectory: config.workingDirectory },
      "Agent spawned",
    );

    // Initialize auto-checkpointing for the agent
    const acs = getAutoCheckpointService(agentId);
    acs.setStateProvider(async () => {
      const d = await getDriver();
      const state = await d.getState(agentId);
      // Transform driver AgentState to checkpoint-compatible format
      return {
        conversationHistory: [],
        toolState: {},
        tokenUsage: state.tokenUsage,
      };
    });
    acs.start();

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
      // Stop monitoring
      activeMonitors.get(agentId)?.abort();
      removeAutoCheckpointService(agentId);
      cleanupOutputBuffer(agentId);
      clearAgentHealth(agentId);
      clearAgentErrorEvents(agentId);
      try {
        await drv.terminate(agentId, true);
      } catch {
        // Best-effort cleanup; proceed with error handling
      }
      agents.delete(agentId);
    }
    // Mark agent as failed in lifecycle state, then clean up state.
    // Use try-finally to ensure removeAgentState is always called even if markAgentFailed throws.
    try {
      markAgentFailed(agentId, "error", {
        code: "SPAWN_FAILED",
        message: String(error),
      });
    } finally {
      removeAgentState(agentId);
    }

    // Update DB status to failed (record guaranteed to exist now)
    try {
      await db
        .update(agentsTable)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(agentsTable.id, agentId));
    } catch (dbError) {
      log.error({ dbError }, "Failed to update agent status to failed");
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
    await Promise.all(
      agentList.map((record) => refreshAgentRecord(record, drv)),
    );
  }

  // Filter by state
  if (options.state?.length) {
    agentList = agentList.filter((r) =>
      options.state?.includes(r.agent.activityState),
    );
  }

  // Filter by driver
  if (options.driver?.length) {
    agentList = agentList.filter((r) =>
      options.driver?.includes(r.agent.driverType),
    );
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
  graceful = true,
): Promise<{
  agentId: string;
  state: "terminating";
}> {
  const log = getLogger();
  const record = agents.get(agentId);

  if (!record) {
    // Check if agent exists in state machine (e.g. stuck in spawning)
    const state = getAgentState(agentId);
    if (!state || isTerminalState(state.currentState)) {
      throw new AgentError("AGENT_NOT_FOUND", `Agent ${agentId} not found`);
    }
    log.warn(
      { agentId, state: state.currentState },
      "Terminating agent found in state machine but not in memory map",
    );
  }

  // Transition to TERMINATING state
  markAgentTerminating(agentId);

  const drv = await getDriver();

  try {
    await drv.terminate(agentId, graceful);

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
    // If graceful termination failed, attempt force-terminate to avoid orphan
    if (graceful) {
      try {
        await drv.terminate(agentId, false);
        log.warn(
          { agentId },
          "Graceful termination failed; force-terminated agent",
        );

        audit({
          action: "agent.terminate",
          resource: agentId,
          resourceType: "agent",
          outcome: "success",
          metadata: { graceful: false, fallback: true },
        });

        return {
          agentId,
          state: "terminating",
        };
      } catch (forceError) {
        log.error(
          { error: forceError, agentId },
          "Force termination also failed — agent process may be orphaned",
        );
      }
    }

    // Both graceful and force termination failed (or was already non-graceful)
    markAgentFailed(agentId, "driver_error", {
      code: "TERMINATE_FAILED",
      message: String(error),
    });

    log.error({ error, agentId }, "Failed to terminate agent");
    throw new AgentError(
      "DRIVER_COMMUNICATION_ERROR",
      `Failed to terminate: ${error}`,
    );
  } finally {
    // Always clean up local state, even if driver termination fails.
    // This prevents orphaned entries in the agents map and ensures
    // resources are released regardless of the termination outcome.
    agents.delete(agentId);

    // Stop event monitoring
    const monitor = activeMonitors.get(agentId);
    if (monitor) {
      monitor.abort();
      activeMonitors.delete(agentId);
    }

    // Stop auto-checkpointing
    removeAutoCheckpointService(agentId);

    // Clean up output buffer
    cleanupOutputBuffer(agentId);

    // Clean up health monitoring data
    clearAgentHealth(agentId);
    clearAgentErrorEvents(agentId);

    // Update DB status - use terminated even on error since we've cleaned up
    try {
      await db
        .update(agentsTable)
        .set({ status: "terminated", updatedAt: new Date() })
        .where(eq(agentsTable.id, agentId));
    } catch (dbError) {
      log.error({ dbError, agentId }, "Failed to update agent status in DB");
    }

    // Mark as fully terminated in state machine
    try {
      markAgentTerminated(agentId);
    } catch {
      // Ignore - may already be in terminal state from markAgentFailed
    }
  }
}

/**
 * Send a message to an agent.
 */
export async function sendMessage(
  agentId: string,
  type: "user" | "system",
  content: string,
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
    throw new AgentError(
      "AGENT_ERROR_STATE",
      `Agent ${agentId} is in error state`,
    );
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

    // Notify auto-checkpoint system of new message
    await getAutoCheckpointService(agentId).onMessage();

    // Note: Transition back to READY happens when agent finishes processing
    // This is typically detected through output events or polling
    // For now, we stay in EXECUTING until the next status check detects idle state

    log.info(
      { agentId, messageId: result.messageId, type },
      "Message sent to agent",
    );

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
    // Create error checkpoint before propagating the error
    await createErrorCheckpoint(
      agentId,
      {
        conversationHistory: [],
        toolState: {},
        tokenUsage: record.agent.tokenUsage,
      },
      {
        errorType: "SEND_FAILED",
        errorMessage: String(error),
      },
    );

    try {
      markAgentIdle(agentId);
    } catch {
      // Ignore invalid transitions on failure recovery.
    }
    log.error({ error, agentId }, "Failed to send message");
    throw new AgentError(
      "DRIVER_COMMUNICATION_ERROR",
      `Failed to send: ${error}`,
    );
  }
}

/**
 * Get agent output with cursor-based pagination.
 * Uses the in-memory ring buffer for fast access.
 */
export async function getAgentOutput(
  agentId: string,
  options: {
    cursor?: string;
    limit?: number;
    types?: string[];
  },
): Promise<{
  chunks: Array<{
    cursor: string;
    timestamp: string;
    type: string;
    content: string | Record<string, unknown>;
    streamType?: string;
    sequence?: number;
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

  // Build options conditionally (for exactOptionalPropertyTypes)
  const bufferOptions: Parameters<typeof getOutputFromBuffer>[1] = {};
  if (options.cursor !== undefined) bufferOptions.cursor = options.cursor;
  if (options.limit !== undefined) bufferOptions.limit = options.limit;
  if (options.types !== undefined) bufferOptions.types = options.types;

  // Use the output buffer service for cursor-based pagination
  const result = getOutputFromBuffer(agentId, bufferOptions);

  // Transform chunks to match the existing API format
  const chunks = result.chunks.map((chunk) => ({
    cursor: String(chunk.sequence),
    timestamp: chunk.timestamp,
    type: chunk.type,
    content: chunk.content,
    streamType: chunk.streamType,
    sequence: chunk.sequence,
  }));

  return {
    chunks,
    pagination: result.pagination,
  };
}

/**
 * Interrupt an agent.
 */
export async function interruptAgent(
  agentId: string,
  signal: string = "SIGINT",
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
    throw new AgentError(
      "DRIVER_COMMUNICATION_ERROR",
      `Failed to interrupt: ${error}`,
    );
  }
}

/**
 * Custom error class for agent operations.
 */
export class AgentError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

// =============================================================================
// Health Monitoring
// =============================================================================

/**
 * Get health status for a specific agent.
 * Combines local state assessment with provider usage tracking.
 */
export function getAgentHealthStatus(agentId: string) {
  const record = agents.get(agentId);
  if (!record) {
    throw new AgentError("AGENT_NOT_FOUND", `Agent ${agentId} not found`);
  }

  return getAgentHealth(agentId, record.agent.driverType);
}

/**
 * Check if it's safe to restart an agent.
 * Returns false if the agent is actively working.
 */
export function checkSafeToRestart(agentId: string) {
  const record = agents.get(agentId);
  if (!record) {
    throw new AgentError("AGENT_NOT_FOUND", `Agent ${agentId} not found`);
  }

  return isSafeToRestart(agentId, record.agent.driverType);
}

/**
 * Get fleet-wide health summary.
 */
export function getFleetHealth() {
  const agentIds = Array.from(agents.keys());

  // First, refresh health for all agents
  for (const agentId of agentIds) {
    const record = agents.get(agentId);
    if (record) {
      getAgentHealth(agentId, record.agent.driverType);
    }
  }

  return getFleetHealthSummary(agentIds);
}

/**
 * Initialize the agent service by restoring active agents from the database.
 * Agents that are found in the DB but cannot be recovered from the driver
 * (e.g., process died) are marked as terminated.
 */
export async function initializeAgentService(): Promise<void> {
  const log = getLogger();
  const drv = await getDriver();

  const activeAgents = await db
    .select()
    .from(agentsTable)
    .where(not(eq(agentsTable.status, "terminated")));

  if (activeAgents.length === 0) {
    log.info("No active agents found in database to restore");
    return;
  }

  log.info(
    { count: activeAgents.length },
    "Attempting to restore active agents from database",
  );

  let restored = 0;
  let cleaned = 0;

  for (const row of activeAgents) {
    try {
      // Check if driver knows about this agent
      const state = await drv.getState(row.id);

      // Reconstruct AgentRecord
      // Note: Some config data (timeout, systemPrompt) is not in DB schema currently.
      // We use safe defaults.
      const record: AgentRecord = {
        agent: {
          id: row.id,
          driverId: drv.driverId,
          driverType: drv.driverType,
          activityState: state.activityState,
          lastActivityAt: state.lastActivityAt,
          tokenUsage: state.tokenUsage,
          contextHealth: state.contextHealth,
          config: {
            id: row.id,
            name: `Agent ${row.id}`,
            provider: "claude",
            model: row.model,
            workingDirectory: row.repoUrl,
            maxTokens: 100000, // Default
          },
          startedAt: state.startedAt,
        },
        createdAt: row.createdAt,
        timeout: 3600000, // Default 1 hour
        messagesReceived: 0,
        messagesSent: 0,
        toolCalls: 0,
      };

      agents.set(row.id, record);

      // Subscribe BEFORE hydrating state to prevent TOCTOU race.
      // Once hydrated to READY, a concurrent terminateAgent could remove
      // the agent from the driver before subscribe runs.
      handleAgentEvents(row.id, drv).catch((err) => {
        log.error(
          { error: err, agentId: row.id },
          "Unhandled error in restored agent event handler",
        );
      });

      // Hydrate state machine
      // Map DB status to LifecycleState if possible, or default to READY
      // DB status: idle, spawning, ready, failed, terminated
      let lifecycleState = LifecycleState.READY;
      if (row.status === "spawning") lifecycleState = LifecycleState.SPAWNING;
      // ... others map to READY or EXECUTING mostly

      hydrateAgentState(row.id, lifecycleState);

      // Initialize auto-checkpointing
      const acs = getAutoCheckpointService(row.id);
      acs.setStateProvider(async () => {
        const d = await getDriver();
        const s = await d.getState(row.id);
        return {
          conversationHistory: [],
          toolState: {},
          tokenUsage: s.tokenUsage,
        };
      });
      acs.start();

      restored++;
    } catch (err) {
      // Driver cannot find agent - assume it died while we were down
      log.warn(
        { agentId: row.id, error: String(err) },
        "Agent found in DB but unreachable - marking terminated",
      );

      // Mark as terminated in DB
      await db
        .update(agentsTable)
        .set({ status: "terminated", updatedAt: new Date() })
        .where(eq(agentsTable.id, row.id));

      cleaned++;
    }
  }

  log.info({ restored, cleaned }, "Agent service initialization complete");
}
