/**
 * Agent State Machine - Defines agent lifecycle states and valid transitions.
 *
 * The state machine ensures agents follow a predictable lifecycle,
 * preventing invalid state transitions and providing clear documentation
 * of agent behavior.
 */

/**
 * Agent lifecycle states.
 */
export enum AgentState {
  /** Process starting, PTY initializing */
  SPAWNING = "spawning",
  /** Agent loading, running init commands */
  INITIALIZING = "initializing",
  /** Agent idle, waiting for input */
  READY = "ready",
  /** Agent processing a command/prompt */
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
 * Terminal states - states from which no further transitions are possible.
 */
export const TERMINAL_STATES: ReadonlySet<AgentState> = new Set([
  AgentState.TERMINATED,
  AgentState.FAILED,
]);

/**
 * Active states - states where the agent is alive and can be interacted with.
 */
export const ACTIVE_STATES: ReadonlySet<AgentState> = new Set([
  AgentState.SPAWNING,
  AgentState.INITIALIZING,
  AgentState.READY,
  AgentState.EXECUTING,
  AgentState.PAUSED,
  AgentState.TERMINATING,
]);

/**
 * Idle states - states where the agent can accept new work.
 */
export const IDLE_STATES: ReadonlySet<AgentState> = new Set([
  AgentState.READY,
  AgentState.PAUSED,
]);

/**
 * Valid state transitions.
 * Key is the current state, value is array of states that can be transitioned to.
 */
export const STATE_TRANSITIONS: Readonly<
  Record<AgentState, readonly AgentState[]>
> = {
  [AgentState.SPAWNING]: [AgentState.INITIALIZING, AgentState.FAILED],
  [AgentState.INITIALIZING]: [AgentState.READY, AgentState.FAILED],
  [AgentState.READY]: [
    AgentState.EXECUTING,
    AgentState.PAUSED,
    AgentState.TERMINATING,
  ],
  [AgentState.EXECUTING]: [
    AgentState.READY,
    AgentState.PAUSED,
    AgentState.TERMINATING,
    AgentState.FAILED,
  ],
  [AgentState.PAUSED]: [AgentState.READY, AgentState.TERMINATING],
  [AgentState.TERMINATING]: [AgentState.TERMINATED, AgentState.FAILED],
  [AgentState.TERMINATED]: [], // Terminal state
  [AgentState.FAILED]: [], // Terminal state
};

/**
 * Reason for a state transition.
 */
export type TransitionReason =
  | "user_action"
  | "timeout"
  | "error"
  | "completed"
  | "health_check_failed"
  | "signal"
  | "system";

/**
 * Error details for failed states.
 */
export interface StateErrorDetails {
  /** Error code */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Stack trace (only in development) */
  stack?: string;
}

/**
 * State transition record.
 */
export interface StateTransition {
  /** Previous state */
  from: AgentState;
  /** New state */
  to: AgentState;
  /** When the transition occurred */
  timestamp: Date;
  /** Why the transition occurred */
  reason: TransitionReason;
  /** Error details (only for transitions to FAILED state) */
  error?: StateErrorDetails;
  /** Correlation ID for tracing */
  correlationId?: string;
}

/**
 * Agent state metadata.
 */
export interface AgentStateMetadata {
  /** Current state */
  state: AgentState;
  /** When the current state was entered */
  stateEnteredAt: Date;
  /** Previous state (undefined if this is the initial state) */
  previousState?: AgentState;
  /** History of state transitions */
  history: StateTransition[];
}

/**
 * Error thrown when an invalid state transition is attempted.
 */
export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly from: AgentState,
    public readonly to: AgentState,
  ) {
    const validTransitions = STATE_TRANSITIONS[from];
    super(
      `Invalid state transition from "${from}" to "${to}". ` +
        `Valid transitions from "${from}": [${validTransitions.join(", ")}]`,
    );
    this.name = "InvalidStateTransitionError";
  }
}

/**
 * Check if a transition from one state to another is valid.
 */
export function isValidTransition(from: AgentState, to: AgentState): boolean {
  const validTargets = STATE_TRANSITIONS[from];
  return validTargets.includes(to);
}

/**
 * Get all valid target states from the current state.
 */
export function getValidTransitions(from: AgentState): readonly AgentState[] {
  return STATE_TRANSITIONS[from];
}

/**
 * Check if a state is terminal (no further transitions possible).
 */
export function isTerminalState(state: AgentState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Check if a state is active (agent is alive).
 */
export function isActiveState(state: AgentState): boolean {
  return ACTIVE_STATES.has(state);
}

/**
 * Check if a state is idle (agent can accept new work).
 */
export function isIdleState(state: AgentState): boolean {
  return IDLE_STATES.has(state);
}

/**
 * Agent State Machine - manages state transitions for a single agent.
 */
export class AgentStateMachine {
  private _state: AgentState;
  private _stateEnteredAt: Date;
  private _previousState?: AgentState;
  private _history: StateTransition[] = [];
  private readonly maxHistorySize: number;

  constructor(
    initialState: AgentState = AgentState.SPAWNING,
    options: { maxHistorySize?: number } = {},
  ) {
    this._state = initialState;
    this._stateEnteredAt = new Date();
    this.maxHistorySize = options.maxHistorySize ?? 100;
  }

  /** Current state */
  get state(): AgentState {
    return this._state;
  }

  /** When the current state was entered */
  get stateEnteredAt(): Date {
    return this._stateEnteredAt;
  }

  /** Previous state */
  get previousState(): AgentState | undefined {
    return this._previousState;
  }

  /** State transition history */
  get history(): readonly StateTransition[] {
    return this._history;
  }

  /** Check if agent is in a terminal state */
  get isTerminal(): boolean {
    return isTerminalState(this._state);
  }

  /** Check if agent is active */
  get isActive(): boolean {
    return isActiveState(this._state);
  }

  /** Check if agent is idle */
  get isIdle(): boolean {
    return isIdleState(this._state);
  }

  /** Time spent in current state (milliseconds) */
  get timeInCurrentState(): number {
    return Date.now() - this._stateEnteredAt.getTime();
  }

  /**
   * Attempt to transition to a new state.
   * @throws InvalidStateTransitionError if the transition is not valid
   */
  transition(
    to: AgentState,
    options: {
      reason: TransitionReason;
      error?: StateErrorDetails;
      correlationId?: string;
    },
  ): StateTransition {
    if (!isValidTransition(this._state, to)) {
      throw new InvalidStateTransitionError(this._state, to);
    }

    const transition: StateTransition = {
      from: this._state,
      to,
      timestamp: new Date(),
      reason: options.reason,
    };
    if (options.correlationId !== undefined) {
      transition.correlationId = options.correlationId;
    }

    // Only include error for transitions to FAILED state
    if (to === AgentState.FAILED && options.error) {
      transition.error = options.error;
    }

    // Update state
    this._previousState = this._state;
    this._state = to;
    this._stateEnteredAt = transition.timestamp;

    // Add to history (with size limit)
    this._history.push(transition);
    if (this._history.length > this.maxHistorySize) {
      this._history.shift();
    }

    return transition;
  }

  /**
   * Check if a transition to the target state is valid.
   */
  canTransitionTo(to: AgentState): boolean {
    return isValidTransition(this._state, to);
  }

  /**
   * Get valid transitions from current state.
   */
  getValidTransitions(): readonly AgentState[] {
    return getValidTransitions(this._state);
  }

  /**
   * Get state metadata.
   */
  getMetadata(): AgentStateMetadata {
    const metadata: AgentStateMetadata = {
      state: this._state,
      stateEnteredAt: this._stateEnteredAt,
      history: [...this._history],
    };
    if (this._previousState !== undefined) {
      metadata.previousState = this._previousState;
    }
    return metadata;
  }

  /**
   * Serialize state machine to JSON-compatible object.
   */
  toJSON(): {
    state: AgentState;
    stateEnteredAt: string;
    previousState?: AgentState;
    history: Array<{
      from: AgentState;
      to: AgentState;
      timestamp: string;
      reason: TransitionReason;
      error?: StateErrorDetails;
      correlationId?: string;
    }>;
  } {
    const result: ReturnType<AgentStateMachine["toJSON"]> = {
      state: this._state,
      stateEnteredAt: this._stateEnteredAt.toISOString(),
      history: this._history.map((t) => {
        const entry: ReturnType<AgentStateMachine["toJSON"]>["history"][number] = {
          from: t.from,
          to: t.to,
          timestamp: t.timestamp.toISOString(),
          reason: t.reason,
        };
        if (t.error !== undefined) entry.error = t.error;
        if (t.correlationId !== undefined) entry.correlationId = t.correlationId;
        return entry;
      }),
    };
    if (this._previousState !== undefined) {
      result.previousState = this._previousState;
    }
    return result;
  }

  /**
   * Create state machine from serialized JSON.
   */
  static fromJSON(
    json: ReturnType<AgentStateMachine["toJSON"]>,
    options?: { maxHistorySize?: number },
  ): AgentStateMachine {
    const machine = new AgentStateMachine(json.state, options);
    machine._stateEnteredAt = new Date(json.stateEnteredAt);
    if (json.previousState !== undefined) {
      machine._previousState = json.previousState;
    }
    machine._history = json.history.map((t) => {
      const transition: StateTransition = {
        from: t.from,
        to: t.to,
        timestamp: new Date(t.timestamp),
        reason: t.reason,
      };
      if (t.error !== undefined) transition.error = t.error;
      if (t.correlationId !== undefined) transition.correlationId = t.correlationId;
      return transition;
    });
    return machine;
  }
}
