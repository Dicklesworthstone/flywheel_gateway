/**
 * Agent State Machine Service
 *
 * Manages agent lifecycle state transitions with validation,
 * logging, and event emission.
 */

import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  getValidTransitions,
  InvalidStateTransitionError,
  isTerminalState,
  isValidTransition,
  LifecycleState,
  type StateTransition,
  type TransitionReason,
} from "../models/agent-state";

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
 * Check if an agent state exists.
 */
export function hasAgentState(agentId: string): boolean {
  return agentStates.has(agentId);
}

/**
 * Initialize state tracking for a new agent.
 * Starts in SPAWNING state.
 */
export function initializeAgentState(agentId: string): AgentStateRecord {
  if (agentStates.has(agentId)) {
    throw new Error(`Agent state already exists for ${agentId}`);
  }

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
    `[LIFECYCLE] Agent ${agentId} initialized in SPAWNING state`,
  );

  // Opportunistic cleanup of stale states (older than 1 hour)
  cleanupStaleStates(3600000);

  return record;
}

/**
 * Hydrate agent state from persistence.
 * Skips transition validation and logging.
 */
export function hydrateAgentState(
  agentId: string,
  state: LifecycleState,
  history: StateTransition[] = [],
): AgentStateRecord {
  const log = getLogger();
  const now = new Date();

  const record: AgentStateRecord = {
    agentId,
    currentState: state,
    stateEnteredAt: now, // We don't have the exact time, so use now
    createdAt: now,
    history,
  };

  agentStates.set(agentId, record);

  log.debug(
    {
      type: "lifecycle",
      agentId,
      state,
    },
    `[LIFECYCLE] Agent ${agentId} hydrated in ${state} state`,
  );

  return record;
}

/**
 * Cleanup states for agents that have been in a terminal state
 * for longer than the specified TTL.
 */
export function cleanupStaleStates(ttlMs: number): number {
  const now = Date.now();
  let cleaned = 0;
  const log = getLogger();

  for (const [id, record] of agentStates.entries()) {
    if (isTerminalState(record.currentState)) {
      const terminalDuration = now - record.stateEnteredAt.getTime();
      if (terminalDuration > ttlMs) {
        agentStates.delete(id);
        cleaned++;
      }
    }
  }

  if (cleaned > 0) {
    log.info({ cleaned, ttlMs }, "Cleaned up stale agent states");
  }

  return cleaned;
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
  metadata?: Record<string, unknown>,
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
      `[LIFECYCLE] Invalid state transition rejected: ${previousState} -> ${newState}`,
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
    `[LIFECYCLE] Agent ${agentId}: ${previousState} -> ${newState} (${reason})`,
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
      `Agent reached terminal state`,
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
  const log = getLogger();
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      // Don't let listener errors break the state machine
      log.error({ error, event }, "State change listener threw an error");
    }
  }
}

/** Cleanup interval handle */
let cleanupIntervalHandle: ReturnType<typeof setInterval> | null = null;

/** Cleanup interval in milliseconds (default: 5 minutes) */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Start the periodic state cleanup job.
 */
export function startStateCleanupJob(): void {
  if (cleanupIntervalHandle !== null) {
    return;
  }

  const log = getLogger();

  cleanupIntervalHandle = setInterval(() => {
    // Cleanup states older than 1 hour
    cleanupStaleStates(3600000);
  }, CLEANUP_INTERVAL_MS);

  // Ensure the interval doesn't prevent process exit
  if (cleanupIntervalHandle.unref) {
    cleanupIntervalHandle.unref();
  }

  log.info("Agent state cleanup job started");
}

/**
 * Stop the periodic state cleanup job.
 */
export function stopStateCleanupJob(): void {
  if (cleanupIntervalHandle !== null) {
    clearInterval(cleanupIntervalHandle);
    cleanupIntervalHandle = null;
    const log = getLogger();
    log.info("Agent state cleanup job stopped");
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
    "terminate_requested",
  );
}

/**
 * Helper: Mark agent as successfully terminated.
 */
export function markAgentTerminated(agentId: string): StateTransition {
  return transitionState(
    agentId,
    LifecycleState.TERMINATED,
    "terminate_complete",
  );
}

/**
 * Helper: Mark agent as failed.
 */
export function markAgentFailed(
  agentId: string,
  reason: TransitionReason,
  error: { code: string; message: string },
): StateTransition {
  return transitionState(agentId, LifecycleState.FAILED, reason, error);
}
