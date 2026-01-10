import { describe, expect, it, beforeEach } from "bun:test";
import {
  AgentState,
  AgentStateMachine,
  InvalidStateTransitionError,
  isValidTransition,
  getValidTransitions,
  isTerminalState,
  isActiveState,
  isIdleState,
  TERMINAL_STATES,
  ACTIVE_STATES,
  IDLE_STATES,
  STATE_TRANSITIONS,
} from "../state";

describe("AgentState enum", () => {
  it("defines all expected states", () => {
    expect(AgentState.SPAWNING).toBe("spawning");
    expect(AgentState.INITIALIZING).toBe("initializing");
    expect(AgentState.READY).toBe("ready");
    expect(AgentState.EXECUTING).toBe("executing");
    expect(AgentState.PAUSED).toBe("paused");
    expect(AgentState.TERMINATING).toBe("terminating");
    expect(AgentState.TERMINATED).toBe("terminated");
    expect(AgentState.FAILED).toBe("failed");
  });
});

describe("State constants", () => {
  it("TERMINAL_STATES contains only terminated and failed", () => {
    expect(TERMINAL_STATES.size).toBe(2);
    expect(TERMINAL_STATES.has(AgentState.TERMINATED)).toBe(true);
    expect(TERMINAL_STATES.has(AgentState.FAILED)).toBe(true);
  });

  it("ACTIVE_STATES contains all non-terminal states", () => {
    expect(ACTIVE_STATES.size).toBe(6);
    expect(ACTIVE_STATES.has(AgentState.SPAWNING)).toBe(true);
    expect(ACTIVE_STATES.has(AgentState.INITIALIZING)).toBe(true);
    expect(ACTIVE_STATES.has(AgentState.READY)).toBe(true);
    expect(ACTIVE_STATES.has(AgentState.EXECUTING)).toBe(true);
    expect(ACTIVE_STATES.has(AgentState.PAUSED)).toBe(true);
    expect(ACTIVE_STATES.has(AgentState.TERMINATING)).toBe(true);
    expect(ACTIVE_STATES.has(AgentState.TERMINATED)).toBe(false);
    expect(ACTIVE_STATES.has(AgentState.FAILED)).toBe(false);
  });

  it("IDLE_STATES contains only ready and paused", () => {
    expect(IDLE_STATES.size).toBe(2);
    expect(IDLE_STATES.has(AgentState.READY)).toBe(true);
    expect(IDLE_STATES.has(AgentState.PAUSED)).toBe(true);
  });
});

describe("STATE_TRANSITIONS", () => {
  it("SPAWNING can only go to INITIALIZING or FAILED", () => {
    expect(STATE_TRANSITIONS[AgentState.SPAWNING]).toEqual([
      AgentState.INITIALIZING,
      AgentState.FAILED,
    ]);
  });

  it("INITIALIZING can only go to READY or FAILED", () => {
    expect(STATE_TRANSITIONS[AgentState.INITIALIZING]).toEqual([
      AgentState.READY,
      AgentState.FAILED,
    ]);
  });

  it("READY can go to EXECUTING, PAUSED, or TERMINATING", () => {
    expect(STATE_TRANSITIONS[AgentState.READY]).toEqual([
      AgentState.EXECUTING,
      AgentState.PAUSED,
      AgentState.TERMINATING,
    ]);
  });

  it("EXECUTING can go to READY, PAUSED, TERMINATING, or FAILED", () => {
    expect(STATE_TRANSITIONS[AgentState.EXECUTING]).toEqual([
      AgentState.READY,
      AgentState.PAUSED,
      AgentState.TERMINATING,
      AgentState.FAILED,
    ]);
  });

  it("PAUSED can only go to READY or TERMINATING", () => {
    expect(STATE_TRANSITIONS[AgentState.PAUSED]).toEqual([
      AgentState.READY,
      AgentState.TERMINATING,
    ]);
  });

  it("TERMINATING can only go to TERMINATED or FAILED", () => {
    expect(STATE_TRANSITIONS[AgentState.TERMINATING]).toEqual([
      AgentState.TERMINATED,
      AgentState.FAILED,
    ]);
  });

  it("TERMINATED has no valid transitions (terminal)", () => {
    expect(STATE_TRANSITIONS[AgentState.TERMINATED]).toEqual([]);
  });

  it("FAILED has no valid transitions (terminal)", () => {
    expect(STATE_TRANSITIONS[AgentState.FAILED]).toEqual([]);
  });
});

describe("isValidTransition", () => {
  it("returns true for valid transitions", () => {
    expect(isValidTransition(AgentState.SPAWNING, AgentState.INITIALIZING)).toBe(true);
    expect(isValidTransition(AgentState.INITIALIZING, AgentState.READY)).toBe(true);
    expect(isValidTransition(AgentState.READY, AgentState.EXECUTING)).toBe(true);
    expect(isValidTransition(AgentState.EXECUTING, AgentState.READY)).toBe(true);
  });

  it("returns false for invalid transitions", () => {
    expect(isValidTransition(AgentState.SPAWNING, AgentState.READY)).toBe(false);
    expect(isValidTransition(AgentState.READY, AgentState.SPAWNING)).toBe(false);
    expect(isValidTransition(AgentState.TERMINATED, AgentState.READY)).toBe(false);
    expect(isValidTransition(AgentState.FAILED, AgentState.READY)).toBe(false);
  });
});

describe("getValidTransitions", () => {
  it("returns valid transitions for each state", () => {
    expect(getValidTransitions(AgentState.SPAWNING)).toContain(AgentState.INITIALIZING);
    expect(getValidTransitions(AgentState.READY)).toContain(AgentState.EXECUTING);
    expect(getValidTransitions(AgentState.TERMINATED)).toHaveLength(0);
  });
});

describe("isTerminalState", () => {
  it("returns true for terminal states", () => {
    expect(isTerminalState(AgentState.TERMINATED)).toBe(true);
    expect(isTerminalState(AgentState.FAILED)).toBe(true);
  });

  it("returns false for non-terminal states", () => {
    expect(isTerminalState(AgentState.SPAWNING)).toBe(false);
    expect(isTerminalState(AgentState.READY)).toBe(false);
    expect(isTerminalState(AgentState.EXECUTING)).toBe(false);
  });
});

describe("isActiveState", () => {
  it("returns true for active states", () => {
    expect(isActiveState(AgentState.SPAWNING)).toBe(true);
    expect(isActiveState(AgentState.READY)).toBe(true);
    expect(isActiveState(AgentState.EXECUTING)).toBe(true);
  });

  it("returns false for terminal states", () => {
    expect(isActiveState(AgentState.TERMINATED)).toBe(false);
    expect(isActiveState(AgentState.FAILED)).toBe(false);
  });
});

describe("isIdleState", () => {
  it("returns true for idle states", () => {
    expect(isIdleState(AgentState.READY)).toBe(true);
    expect(isIdleState(AgentState.PAUSED)).toBe(true);
  });

  it("returns false for non-idle states", () => {
    expect(isIdleState(AgentState.SPAWNING)).toBe(false);
    expect(isIdleState(AgentState.EXECUTING)).toBe(false);
    expect(isIdleState(AgentState.TERMINATED)).toBe(false);
  });
});

describe("InvalidStateTransitionError", () => {
  it("contains from and to states", () => {
    const error = new InvalidStateTransitionError(AgentState.SPAWNING, AgentState.READY);
    expect(error.from).toBe(AgentState.SPAWNING);
    expect(error.to).toBe(AgentState.READY);
    expect(error.name).toBe("InvalidStateTransitionError");
  });

  it("includes helpful error message", () => {
    const error = new InvalidStateTransitionError(AgentState.SPAWNING, AgentState.READY);
    expect(error.message).toContain("spawning");
    expect(error.message).toContain("ready");
    expect(error.message).toContain("initializing");
    expect(error.message).toContain("failed");
  });
});

describe("AgentStateMachine", () => {
  let machine: AgentStateMachine;

  beforeEach(() => {
    machine = new AgentStateMachine();
  });

  describe("initialization", () => {
    it("starts in SPAWNING state by default", () => {
      expect(machine.state).toBe(AgentState.SPAWNING);
    });

    it("can start in a custom initial state", () => {
      const customMachine = new AgentStateMachine(AgentState.READY);
      expect(customMachine.state).toBe(AgentState.READY);
    });

    it("sets stateEnteredAt to current time", () => {
      const now = Date.now();
      expect(machine.stateEnteredAt.getTime()).toBeGreaterThanOrEqual(now - 100);
      expect(machine.stateEnteredAt.getTime()).toBeLessThanOrEqual(now + 100);
    });

    it("has no previous state initially", () => {
      expect(machine.previousState).toBeUndefined();
    });

    it("has empty history initially", () => {
      expect(machine.history).toHaveLength(0);
    });
  });

  describe("state queries", () => {
    it("isTerminal returns false for active states", () => {
      expect(machine.isTerminal).toBe(false);
    });

    it("isTerminal returns true for terminal states", () => {
      const terminatedMachine = new AgentStateMachine(AgentState.TERMINATED);
      expect(terminatedMachine.isTerminal).toBe(true);
    });

    it("isActive returns true for active states", () => {
      expect(machine.isActive).toBe(true);
    });

    it("isIdle returns false for non-idle states", () => {
      expect(machine.isIdle).toBe(false);
    });

    it("isIdle returns true for ready state", () => {
      const readyMachine = new AgentStateMachine(AgentState.READY);
      expect(readyMachine.isIdle).toBe(true);
    });

    it("timeInCurrentState increases over time", async () => {
      const initial = machine.timeInCurrentState;
      await new Promise((r) => setTimeout(r, 10));
      expect(machine.timeInCurrentState).toBeGreaterThan(initial);
    });
  });

  describe("transition", () => {
    it("successfully transitions to valid state", () => {
      const result = machine.transition(AgentState.INITIALIZING, { reason: "system" });

      expect(result.from).toBe(AgentState.SPAWNING);
      expect(result.to).toBe(AgentState.INITIALIZING);
      expect(result.reason).toBe("system");
      expect(machine.state).toBe(AgentState.INITIALIZING);
    });

    it("updates previousState after transition", () => {
      machine.transition(AgentState.INITIALIZING, { reason: "system" });

      expect(machine.previousState).toBe(AgentState.SPAWNING);
    });

    it("updates stateEnteredAt after transition", () => {
      const beforeTime = machine.stateEnteredAt;
      machine.transition(AgentState.INITIALIZING, { reason: "system" });

      expect(machine.stateEnteredAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
    });

    it("adds transition to history", () => {
      machine.transition(AgentState.INITIALIZING, { reason: "system" });

      expect(machine.history).toHaveLength(1);
      const record = machine.history[0];
      expect(record?.from).toBe(AgentState.SPAWNING);
      expect(record?.to).toBe(AgentState.INITIALIZING);
    });

    it("includes correlationId in transition", () => {
      const result = machine.transition(AgentState.INITIALIZING, {
        reason: "system",
        correlationId: "test-123",
      });

      expect(result.correlationId).toBe("test-123");
    });

    it("throws InvalidStateTransitionError for invalid transition", () => {
      expect(() => {
        machine.transition(AgentState.READY, { reason: "system" });
      }).toThrow(InvalidStateTransitionError);
    });

    it("includes error details when transitioning to FAILED", () => {
      const error = { code: "TEST_ERROR", message: "Test error" };
      const result = machine.transition(AgentState.FAILED, {
        reason: "error",
        error,
      });

      expect(result.error).toEqual(error);
    });

    it("does not include error for non-FAILED transitions", () => {
      const result = machine.transition(AgentState.INITIALIZING, {
        reason: "system",
        error: { code: "TEST", message: "Should not appear" },
      });

      expect(result.error).toBeUndefined();
    });
  });

  describe("history management", () => {
    it("limits history size", () => {
      const smallMachine = new AgentStateMachine(AgentState.READY, { maxHistorySize: 3 });

      // Cycle through states to generate history
      smallMachine.transition(AgentState.EXECUTING, { reason: "user_action" });
      smallMachine.transition(AgentState.READY, { reason: "completed" });
      smallMachine.transition(AgentState.EXECUTING, { reason: "user_action" });
      smallMachine.transition(AgentState.READY, { reason: "completed" });
      smallMachine.transition(AgentState.EXECUTING, { reason: "user_action" });

      expect(smallMachine.history.length).toBeLessThanOrEqual(3);
    });
  });

  describe("canTransitionTo", () => {
    it("returns true for valid transitions", () => {
      expect(machine.canTransitionTo(AgentState.INITIALIZING)).toBe(true);
      expect(machine.canTransitionTo(AgentState.FAILED)).toBe(true);
    });

    it("returns false for invalid transitions", () => {
      expect(machine.canTransitionTo(AgentState.READY)).toBe(false);
      expect(machine.canTransitionTo(AgentState.TERMINATED)).toBe(false);
    });
  });

  describe("getValidTransitions", () => {
    it("returns valid transitions for current state", () => {
      const validTransitions = machine.getValidTransitions();
      expect(validTransitions).toContain(AgentState.INITIALIZING);
      expect(validTransitions).toContain(AgentState.FAILED);
      expect(validTransitions).not.toContain(AgentState.READY);
    });
  });

  describe("getMetadata", () => {
    it("returns complete metadata", () => {
      machine.transition(AgentState.INITIALIZING, { reason: "system" });
      const metadata = machine.getMetadata();

      expect(metadata.state).toBe(AgentState.INITIALIZING);
      expect(metadata.previousState).toBe(AgentState.SPAWNING);
      expect(metadata.stateEnteredAt).toBeInstanceOf(Date);
      expect(metadata.history).toHaveLength(1);
    });

    it("returns a copy of history", () => {
      machine.transition(AgentState.INITIALIZING, { reason: "system" });
      const metadata = machine.getMetadata();

      expect(metadata.history).not.toBe(machine.history);
    });
  });

  describe("serialization", () => {
    it("toJSON serializes the state machine", () => {
      machine.transition(AgentState.INITIALIZING, { reason: "system", correlationId: "test" });
      const json = machine.toJSON();

      expect(json.state).toBe(AgentState.INITIALIZING);
      expect(json.previousState).toBe(AgentState.SPAWNING);
      expect(typeof json.stateEnteredAt).toBe("string");
      expect(json.history).toHaveLength(1);
      expect(json.history[0]?.correlationId).toBe("test");
    });

    it("fromJSON deserializes correctly", () => {
      machine.transition(AgentState.INITIALIZING, { reason: "system" });
      const json = machine.toJSON();
      const restored = AgentStateMachine.fromJSON(json);

      expect(restored.state).toBe(machine.state);
      expect(restored.previousState).toBe(machine.previousState);
      expect(restored.history).toHaveLength(machine.history.length);
    });

    it("roundtrip preserves all data", () => {
      machine.transition(AgentState.INITIALIZING, { reason: "system" });
      machine.transition(AgentState.READY, { reason: "completed" });
      machine.transition(AgentState.EXECUTING, { reason: "user_action" });

      const json = machine.toJSON();
      const restored = AgentStateMachine.fromJSON(json);

      expect(restored.toJSON()).toEqual(json);
    });
  });

  describe("full lifecycle scenarios", () => {
    it("supports happy path: spawn -> init -> ready -> execute -> ready -> terminate", () => {
      const m = new AgentStateMachine();

      m.transition(AgentState.INITIALIZING, { reason: "system" });
      expect(m.state).toBe(AgentState.INITIALIZING);

      m.transition(AgentState.READY, { reason: "completed" });
      expect(m.state).toBe(AgentState.READY);

      m.transition(AgentState.EXECUTING, { reason: "user_action" });
      expect(m.state).toBe(AgentState.EXECUTING);

      m.transition(AgentState.READY, { reason: "completed" });
      expect(m.state).toBe(AgentState.READY);

      m.transition(AgentState.TERMINATING, { reason: "user_action" });
      expect(m.state).toBe(AgentState.TERMINATING);

      m.transition(AgentState.TERMINATED, { reason: "completed" });
      expect(m.state).toBe(AgentState.TERMINATED);
      expect(m.isTerminal).toBe(true);
    });

    it("supports failure path: spawn -> failed", () => {
      const m = new AgentStateMachine();

      m.transition(AgentState.FAILED, {
        reason: "error",
        error: { code: "SPAWN_ERROR", message: "Failed to start" },
      });

      expect(m.state).toBe(AgentState.FAILED);
      expect(m.isTerminal).toBe(true);
      expect(m.history[0]?.error?.code).toBe("SPAWN_ERROR");
    });

    it("supports pause/resume: ready -> paused -> ready", () => {
      const m = new AgentStateMachine(AgentState.READY);

      m.transition(AgentState.PAUSED, { reason: "signal" });
      expect(m.state).toBe(AgentState.PAUSED);
      expect(m.isIdle).toBe(true);

      m.transition(AgentState.READY, { reason: "signal" });
      expect(m.state).toBe(AgentState.READY);
    });
  });
});
