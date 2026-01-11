/**
 * Agent Events Service.
 *
 * Bridges the agent state machine to the WebSocket hub,
 * publishing real-time agent state updates to subscribed clients.
 */

import type { WebSocketHub } from "../ws/hub";
import type { MessageMetadata } from "../ws/messages";
import { onStateChange, type StateChangeEvent } from "./agent-state-machine";
import { logger } from "./logger";

/**
 * Agent state change payload for WebSocket.
 */
export interface AgentStatePayload {
  agentId: string;
  previousState: string;
  currentState: string;
  reason: string;
  timestamp: string;
  correlationId: string;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Agent output payload for WebSocket.
 */
export interface AgentOutputPayload {
  agentId: string;
  type: "text" | "tool_call" | "tool_result" | "error";
  content: string;
  timestamp: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Agent tool event payload for WebSocket.
 */
export interface AgentToolPayload {
  agentId: string;
  type: "tool_call" | "tool_result";
  toolName: string;
  toolId: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  duration?: number;
  timestamp: string;
  correlationId?: string;
}

/**
 * Agent events service for publishing agent-related WebSocket events.
 */
export class AgentEventsService {
  private unsubscribe: (() => void) | undefined;

  constructor(private hub: WebSocketHub) {}

  /**
   * Start listening to agent state changes and publishing to WebSocket.
   */
  start(): void {
    if (this.unsubscribe) return; // Already started

    this.unsubscribe = onStateChange((event: StateChangeEvent) => {
      this.publishStateChange(event);
    });

    logger.info("AgentEventsService started - listening to state changes");
  }

  /**
   * Stop listening to agent state changes.
   */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
      logger.info("AgentEventsService stopped");
    }
  }

  /**
   * Publish a state change event to the WebSocket hub.
   *
   * Sends to: agent:state:{agentId}
   */
  private publishStateChange(event: StateChangeEvent): void {
    const payload: AgentStatePayload = {
      agentId: event.agentId,
      previousState: event.previousState,
      currentState: event.currentState,
      reason: event.reason,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
    };

    if (event.error) {
      payload.error = event.error;
    }

    this.hub.publish(
      { type: "agent:state", agentId: event.agentId },
      "state.change",
      payload,
      {
        correlationId: event.correlationId,
        agentId: event.agentId,
      },
    );
  }

  /**
   * Publish agent output to the WebSocket hub.
   *
   * Sends to: agent:output:{agentId}
   */
  publishOutput(
    agentId: string,
    payload: AgentOutputPayload,
    metadata?: MessageMetadata,
  ): void {
    this.hub.publish(
      { type: "agent:output", agentId },
      "output.chunk",
      payload,
      {
        ...metadata,
        agentId,
      },
    );
  }

  /**
   * Publish agent tool event to the WebSocket hub.
   *
   * Sends to: agent:tools:{agentId}
   */
  publishToolEvent(
    agentId: string,
    payload: AgentToolPayload,
    metadata?: MessageMetadata,
  ): void {
    // Map payload.type to appropriate message type
    const messageType =
      payload.type === "tool_call" ? "tool.start" : "tool.end";
    this.hub.publish({ type: "agent:tools", agentId }, messageType, payload, {
      ...metadata,
      agentId,
    });
  }

  /**
   * Publish a text output event.
   * Convenience method for streaming text output.
   */
  publishTextOutput(
    agentId: string,
    content: string,
    correlationId?: string,
  ): void {
    // Build payload conditionally (for exactOptionalPropertyTypes)
    const payload: AgentOutputPayload = {
      agentId,
      type: "text",
      content,
      timestamp: new Date().toISOString(),
    };
    if (correlationId !== undefined) payload.correlationId = correlationId;
    this.publishOutput(agentId, payload);
  }

  /**
   * Publish a tool call start event.
   */
  publishToolCall(
    agentId: string,
    toolName: string,
    toolId: string,
    input: unknown,
    correlationId?: string,
  ): void {
    // Build payload conditionally (for exactOptionalPropertyTypes)
    const payload: AgentToolPayload = {
      agentId,
      type: "tool_call",
      toolName,
      toolId,
      input,
      timestamp: new Date().toISOString(),
    };
    if (correlationId !== undefined) payload.correlationId = correlationId;
    this.publishToolEvent(agentId, payload);
  }

  /**
   * Publish a tool result event.
   */
  publishToolResult(
    agentId: string,
    toolName: string,
    toolId: string,
    output: unknown,
    duration: number,
    error?: string,
    correlationId?: string,
  ): void {
    // Build payload conditionally (for exactOptionalPropertyTypes)
    const payload: AgentToolPayload = {
      agentId,
      type: "tool_result",
      toolName,
      toolId,
      output,
      duration,
      timestamp: new Date().toISOString(),
    };
    if (error !== undefined) payload.error = error;
    if (correlationId !== undefined) payload.correlationId = correlationId;
    this.publishToolEvent(agentId, payload);
  }
}

// Singleton instance
let serviceInstance: AgentEventsService | undefined;

/**
 * Get or create the agent events service singleton.
 */
export function getAgentEventsService(hub?: WebSocketHub): AgentEventsService {
  if (!serviceInstance) {
    if (!hub) {
      throw new Error(
        "AgentEventsService requires a WebSocketHub on first initialization",
      );
    }
    serviceInstance = new AgentEventsService(hub);
  }
  return serviceInstance;
}

/**
 * Initialize and start the agent events service.
 */
export function startAgentEvents(hub: WebSocketHub): AgentEventsService {
  const service = getAgentEventsService(hub);
  service.start();
  return service;
}

/**
 * Stop the agent events service.
 */
export function stopAgentEvents(): void {
  if (serviceInstance) {
    serviceInstance.stop();
  }
}
