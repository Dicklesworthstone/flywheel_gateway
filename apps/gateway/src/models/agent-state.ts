/**
 * Agent Lifecycle State Model
 *
 * Defines the formal state machine for agent lifecycle management.
 * This is separate from ActivityState (thinking, working, etc.) which
 * represents what the agent is currently doing.
 *
 * LifecycleState represents the agent's existence status:
 * - Is it starting up?
 * - Is it ready to accept work?
 * - Is it shutting down?
 * - Has it terminated?
 */

/**
 * Lifecycle states an agent can be in.
 */
export enum LifecycleState {
  /** Process starting, driver initializing */
  SPAWNING = "spawning",
  /** Agent loading, running init commands */
  INITIALIZING = "initializing",
  /** Agent idle, ready to accept input */
  READY = "ready",
  /** Agent actively processing a command/prompt */
  EXECUTING = "executing",
  /** Agent temporarily suspended */
  PAUSED = "paused",
  /** Graceful shutdown in progress */
  TERMINATING = "terminating",
  /** Process ended normally */
  TERMINATED = "terminated",
  /** Process ended with error */
  FAILED = "failed",
}

/**
 * Terminal states - no transitions allowed from these.
 */
export const TERMINAL_STATES: ReadonlySet<LifecycleState> = new Set([
  LifecycleState.TERMINATED,
  LifecycleState.FAILED,
]);

/**
 * Valid state transitions.
 * Key is the current state, value is array of valid target states.
 */
export const VALID_TRANSITIONS: Readonly<
  Record<LifecycleState, readonly LifecycleState[]>
> = {
  [LifecycleState.SPAWNING]: [
    LifecycleState.INITIALIZING,
    LifecycleState.FAILED,
  ],
  [LifecycleState.INITIALIZING]: [LifecycleState.READY, LifecycleState.FAILED],
  [LifecycleState.READY]: [
    LifecycleState.EXECUTING,
    LifecycleState.PAUSED,
    LifecycleState.TERMINATING,
  ],
  [LifecycleState.EXECUTING]: [
    LifecycleState.READY,
    LifecycleState.PAUSED,
    LifecycleState.TERMINATING,
    LifecycleState.FAILED,
  ],
  [LifecycleState.PAUSED]: [LifecycleState.READY, LifecycleState.TERMINATING],
  [LifecycleState.TERMINATING]: [
    LifecycleState.TERMINATED,
    LifecycleState.FAILED,
  ],
  [LifecycleState.TERMINATED]: [],
  [LifecycleState.FAILED]: [],
};

/**
 * Reasons for state transitions.
 */
export type TransitionReason =
  | "spawn_started"
  | "init_complete"
  | "user_action"
  | "command_started"
  | "command_complete"
  | "pause_requested"
  | "resume_requested"
  | "terminate_requested"
  | "terminate_complete"
  | "error"
  | "timeout"
  | "health_check_failed"
  | "driver_error"
  | "resource_limit";

/**
 * Record of a state transition.
 */
export interface StateTransition {
  /** Previous lifecycle state */
  previousState: LifecycleState;
  /** New lifecycle state */
  newState: LifecycleState;
  /** When the transition occurred */
  timestamp: Date;
  /** Why the transition happened */
  reason: TransitionReason;
  /** Correlation ID for request tracing */
  correlationId: string;
  /** Error details if transitioning to FAILED */
  error?: {
    code: string;
    message: string;
  };
  /** Additional context */
  metadata?: Record<string, unknown>;
}

/**
 * Error thrown when an invalid state transition is attempted.
 */
export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly fromState: LifecycleState,
    public readonly toState: LifecycleState,
    public readonly agentId: string,
  ) {
    super(
      `Invalid state transition for agent ${agentId}: ${fromState} -> ${toState}`,
    );
    this.name = "InvalidStateTransitionError";
  }
}

/**
 * Check if a state transition is valid.
 */
export function isValidTransition(
  from: LifecycleState,
  to: LifecycleState,
): boolean {
  const validTargets = VALID_TRANSITIONS[from];
  return validTargets.includes(to);
}

/**
 * Get all valid target states from a given state.
 */
export function getValidTransitions(from: LifecycleState): LifecycleState[] {
  return [...VALID_TRANSITIONS[from]];
}

/**
 * Check if a state is terminal (no further transitions allowed).
 */
export function isTerminalState(state: LifecycleState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Check if an agent in the given state can accept commands.
 */
export function canAcceptCommands(state: LifecycleState): boolean {
  return state === LifecycleState.READY;
}

/**
 * Check if an agent in the given state is considered "alive".
 */
export function isAlive(state: LifecycleState): boolean {
  return !TERMINAL_STATES.has(state) && state !== LifecycleState.TERMINATING;
}
