/**
 * Agent State Machine Service
 *
 * Manages agent lifecycle state transitions with validation,
 * logging, and event emission.
 */

import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  LifecycleState,
  type StateTransition,
  type TransitionReason,
  InvalidStateTransitionError,
  isValidTransition,
  isTerminalState,
  getValidTransitions,
} from "../models/agent-state";
import { logger } from "./logger";

/**
 * Agent state record with history.
 */
export interface AgentStateRecord {
  agentId: string;
  currentState: LifecycleState;
  stateEnteredAt: Date;
  createdAt: Date;
  /** Recent state transitions (last N for debugging) */
  history: StateTransition[];
}

/**
 * Event emitted when agent state changes.
 */
export interface StateChangeEvent {
  type: "agent.state.changed";
  agentId: string;
  previousState: LifecycleState;
  currentState: LifecycleState;
  timestamp: string;
  reason: TransitionReason;
  correlationId: string;
  error?: {
    code: string;
    message: string;
  };
}

/** Maximum history entries to keep per agent */
const MAX_HISTORY_SIZE = 50;

/** In-memory state storage */
const agentStates = new Map<string, AgentStateRecord>();

/** Event listeners for state changes */
type StateChangeListener = (event: StateChangeEvent) => void;
const listeners: StateChangeListener[] = [];

/**
 * Initialize state tracking for a new agent.
 * Starts in SPAWNING state.
 */
export function initializeAgentState(agentId: string): AgentStateRecord {
  const correlationId = getCorrelationId();
  const log = getLogger();
  const now = new Date();

  const record: AgentStateRecord = {
    agentId,
    currentState: LifecycleState.SPAWNING,
    stateEnteredAt: now,
    createdAt: now,
    history: [],
  };

  agentStates.set(agentId, record);

  log.info(
    {
      type: "lifecycle",
      agentId,
      state: LifecycleState.SPAWNING,
      correlationId,
    },
    `[LIFECYCLE] Agent ${agentId} initialized in SPAWNING state`
  );

  return record;
}

/**
 * Transition an agent to a new state.
 *
 * @throws InvalidStateTransitionError if the transition is not valid
 */
export function transitionState(
  agentId: string,
  newState: LifecycleState,
  reason: TransitionReason,
  error?: { code: string; message: string },
  metadata?: Record<string, unknown>
): StateTransition {
  const correlationId = getCorrelationId();
  const log = getLogger();

  const record = agentStates.get(agentId);
  if (!record) {
    throw new Error(`Agent ${agentId} not found in state registry`);
  }

  const previousState = record.currentState;

  // Validate transition
  if (!isValidTransition(previousState, newState)) {
    const validTargets = getValidTransitions(previousState);
    log.warn(
      {
        type: "lifecycle",
        agentId,
        previousState,
        attemptedState: newState,
        validTransitions: validTargets,
        correlationId,
      },
      `[LIFECYCLE] Invalid state transition rejected: ${previousState} -> ${newState}`
    );
    throw new InvalidStateTransitionError(previousState, newState, agentId);
  }

  const now = new Date();
  const transition: StateTransition = {
    previousState,
    newState,
    timestamp: now,
    reason,
    correlationId,
  };

  // Add error details if transitioning to FAILED
  if (error) {
    transition.error = error;
  }
  if (metadata) {
    transition.metadata = metadata;
  }

  // Update state
  record.currentState = newState;
  record.stateEnteredAt = now;

  // Add to history (trim if needed)
  record.history.push(transition);
  if (record.history.length > MAX_HISTORY_SIZE) {
    record.history = record.history.slice(-MAX_HISTORY_SIZE);
  }

  // Log the transition
  const logLevel = newState === LifecycleState.FAILED ? "error" : "info";
  log[logLevel](
    {
      type: "lifecycle",
      agentId,
      previousState,
      newState,
      reason,
      correlationId,
      ...(error && { error }),
    },
    `[LIFECYCLE] Agent ${agentId}: ${previousState} -> ${newState} (${reason})`
  );

  // Emit event to listeners
  const event: StateChangeEvent = {
    type: "agent.state.changed",
    agentId,
    previousState,
    currentState: newState,
    timestamp: now.toISOString(),
    reason,
    correlationId,
  };
  if (error) {
    event.error = error;
  }
  emitStateChange(event);

  // Clean up if terminal state
  if (isTerminalState(newState)) {
    // Keep the record for a while for debugging, but mark for cleanup
    // In production, you'd want a TTL-based cleanup
    log.debug(
      { agentId, finalState: newState },
      `Agent reached terminal state`
    );
  }

  return transition;
}

/**
 * Get the current state of an agent.
 */
export function getAgentState(agentId: string): AgentStateRecord | undefined {
  return agentStates.get(agentId);
}

/**
 * Get the state history for an agent.
 */
export function getAgentStateHistory(agentId: string): StateTransition[] {
  const record = agentStates.get(agentId);
  return record ? [...record.history] : [];
}

/**
 * Remove an agent from state tracking.
 * Should only be called after agent is in terminal state.
 */
export function removeAgentState(agentId: string): void {
  agentStates.delete(agentId);
}

/**
 * Get all tracked agents with their current states.
 */
export function getAllAgentStates(): Map<string, AgentStateRecord> {
  return new Map(agentStates);
}

/**
 * Register a listener for state change events.
 * Returns an unsubscribe function.
 */
export function onStateChange(listener: StateChangeListener): () => void {
  listeners.push(listener);
  return () => {
    const index = listeners.indexOf(listener);
    if (index >= 0) {
      listeners.splice(index, 1);
    }
  };
}

/**
 * Emit a state change event to all listeners.
 */
function emitStateChange(event: StateChangeEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      // Don't let listener errors break the state machine
      logger.error(
        { error, event },
        "State change listener threw an error"
      );
    }
  }
}

/**
 * Helper: Transition agent to READY state after initialization.
 */
export function markAgentReady(agentId: string): StateTransition {
  const record = agentStates.get(agentId);
  if (!record) {
    throw new Error(`Agent ${agentId} not found`);
  }

  // Handle transition from SPAWNING -> INITIALIZING -> READY
  if (record.currentState === LifecycleState.SPAWNING) {
    transitionState(agentId, LifecycleState.INITIALIZING, "spawn_started");
  }

  return transitionState(agentId, LifecycleState.READY, "init_complete");
}

/**
 * Helper: Transition agent to EXECUTING state.
 */
export function markAgentExecuting(agentId: string): StateTransition {
  return transitionState(agentId, LifecycleState.EXECUTING, "command_started");
}

/**
 * Helper: Transition agent back to READY after execution.
 */
export function markAgentIdle(agentId: string): StateTransition {
  return transitionState(agentId, LifecycleState.READY, "command_complete");
}

/**
 * Helper: Start graceful termination.
 */
export function markAgentTerminating(agentId: string): StateTransition {
  return transitionState(
    agentId,
    LifecycleState.TERMINATING,
    "terminate_requested"
  );
}

/**
 * Helper: Mark agent as successfully terminated.
 */
export function markAgentTerminated(agentId: string): StateTransition {
  return transitionState(
    agentId,
    LifecycleState.TERMINATED,
    "terminate_complete"
  );
}

/**
 * Helper: Mark agent as failed.
 */
export function markAgentFailed(
  agentId: string,
  reason: TransitionReason,
  error: { code: string; message: string }
): StateTransition {
  return transitionState(agentId, LifecycleState.FAILED, reason, error);
}
