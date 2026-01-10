/**
 * Unit tests for the Agent State Machine.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  LifecycleState,
  isValidTransition,
  getValidTransitions,
  isTerminalState,
  canAcceptCommands,
  isAlive,
  InvalidStateTransitionError,
} from "../models/agent-state";
import {
  initializeAgentState,
  transitionState,
  getAgentState,
  getAgentStateHistory,
  removeAgentState,
  markAgentReady,
  markAgentExecuting,
  markAgentIdle,
  markAgentTerminating,
  markAgentTerminated,
  markAgentFailed,
} from "../services/agent-state-machine";

describe("Agent State Model", () => {
  describe("isValidTransition", () => {
    test("allows SPAWNING -> INITIALIZING", () => {
      expect(isValidTransition(LifecycleState.SPAWNING, LifecycleState.INITIALIZING)).toBe(true);
    });

    test("allows SPAWNING -> FAILED", () => {
      expect(isValidTransition(LifecycleState.SPAWNING, LifecycleState.FAILED)).toBe(true);
    });

    test("rejects SPAWNING -> READY (must go through INITIALIZING)", () => {
      expect(isValidTransition(LifecycleState.SPAWNING, LifecycleState.READY)).toBe(false);
    });

    test("allows INITIALIZING -> READY", () => {
      expect(isValidTransition(LifecycleState.INITIALIZING, LifecycleState.READY)).toBe(true);
    });

    test("allows READY -> EXECUTING", () => {
      expect(isValidTransition(LifecycleState.READY, LifecycleState.EXECUTING)).toBe(true);
    });

    test("allows READY -> PAUSED", () => {
      expect(isValidTransition(LifecycleState.READY, LifecycleState.PAUSED)).toBe(true);
    });

    test("allows READY -> TERMINATING", () => {
      expect(isValidTransition(LifecycleState.READY, LifecycleState.TERMINATING)).toBe(true);
    });

    test("allows EXECUTING -> READY (command complete)", () => {
      expect(isValidTransition(LifecycleState.EXECUTING, LifecycleState.READY)).toBe(true);
    });

    test("allows EXECUTING -> FAILED", () => {
      expect(isValidTransition(LifecycleState.EXECUTING, LifecycleState.FAILED)).toBe(true);
    });

    test("allows TERMINATING -> TERMINATED", () => {
      expect(isValidTransition(LifecycleState.TERMINATING, LifecycleState.TERMINATED)).toBe(true);
    });

    test("allows TERMINATING -> FAILED", () => {
      expect(isValidTransition(LifecycleState.TERMINATING, LifecycleState.FAILED)).toBe(true);
    });

    test("rejects any transition from TERMINATED", () => {
      expect(isValidTransition(LifecycleState.TERMINATED, LifecycleState.READY)).toBe(false);
      expect(isValidTransition(LifecycleState.TERMINATED, LifecycleState.SPAWNING)).toBe(false);
    });

    test("rejects any transition from FAILED", () => {
      expect(isValidTransition(LifecycleState.FAILED, LifecycleState.READY)).toBe(false);
      expect(isValidTransition(LifecycleState.FAILED, LifecycleState.SPAWNING)).toBe(false);
    });

    test("rejects READY -> TERMINATED (must go through TERMINATING)", () => {
      expect(isValidTransition(LifecycleState.READY, LifecycleState.TERMINATED)).toBe(false);
    });
  });

  describe("getValidTransitions", () => {
    test("returns valid targets for SPAWNING", () => {
      const valid = getValidTransitions(LifecycleState.SPAWNING);
      expect(valid).toContain(LifecycleState.INITIALIZING);
      expect(valid).toContain(LifecycleState.FAILED);
      expect(valid.length).toBe(2);
    });

    test("returns empty array for terminal states", () => {
      expect(getValidTransitions(LifecycleState.TERMINATED)).toEqual([]);
      expect(getValidTransitions(LifecycleState.FAILED)).toEqual([]);
    });
  });

  describe("isTerminalState", () => {
    test("returns true for TERMINATED", () => {
      expect(isTerminalState(LifecycleState.TERMINATED)).toBe(true);
    });

    test("returns true for FAILED", () => {
      expect(isTerminalState(LifecycleState.FAILED)).toBe(true);
    });

    test("returns false for non-terminal states", () => {
      expect(isTerminalState(LifecycleState.READY)).toBe(false);
      expect(isTerminalState(LifecycleState.EXECUTING)).toBe(false);
      expect(isTerminalState(LifecycleState.TERMINATING)).toBe(false);
    });
  });

  describe("canAcceptCommands", () => {
    test("returns true only for READY state", () => {
      expect(canAcceptCommands(LifecycleState.READY)).toBe(true);
      expect(canAcceptCommands(LifecycleState.EXECUTING)).toBe(false);
      expect(canAcceptCommands(LifecycleState.PAUSED)).toBe(false);
      expect(canAcceptCommands(LifecycleState.SPAWNING)).toBe(false);
    });
  });

  describe("isAlive", () => {
    test("returns true for active states", () => {
      expect(isAlive(LifecycleState.SPAWNING)).toBe(true);
      expect(isAlive(LifecycleState.INITIALIZING)).toBe(true);
      expect(isAlive(LifecycleState.READY)).toBe(true);
      expect(isAlive(LifecycleState.EXECUTING)).toBe(true);
      expect(isAlive(LifecycleState.PAUSED)).toBe(true);
    });

    test("returns false for TERMINATING", () => {
      expect(isAlive(LifecycleState.TERMINATING)).toBe(false);
    });

    test("returns false for terminal states", () => {
      expect(isAlive(LifecycleState.TERMINATED)).toBe(false);
      expect(isAlive(LifecycleState.FAILED)).toBe(false);
    });
  });
});

describe("Agent State Machine Service", () => {
  const testAgentId = "test-agent-" + Date.now();

  beforeEach(() => {
    // Clean up any existing state
    removeAgentState(testAgentId);
  });

  describe("initializeAgentState", () => {
    test("creates agent in SPAWNING state", () => {
      const record = initializeAgentState(testAgentId);
      expect(record.currentState).toBe(LifecycleState.SPAWNING);
      expect(record.agentId).toBe(testAgentId);
      expect(record.history).toEqual([]);
    });
  });

  describe("transitionState", () => {
    test("transitions to valid state", () => {
      initializeAgentState(testAgentId);
      const transition = transitionState(
        testAgentId,
        LifecycleState.INITIALIZING,
        "spawn_started"
      );

      expect(transition.previousState).toBe(LifecycleState.SPAWNING);
      expect(transition.newState).toBe(LifecycleState.INITIALIZING);
      expect(transition.reason).toBe("spawn_started");

      const state = getAgentState(testAgentId);
      expect(state?.currentState).toBe(LifecycleState.INITIALIZING);
    });

    test("throws InvalidStateTransitionError for invalid transition", () => {
      initializeAgentState(testAgentId);

      expect(() => {
        transitionState(testAgentId, LifecycleState.READY, "spawn_started");
      }).toThrow(InvalidStateTransitionError);
    });

    test("records transition in history", () => {
      initializeAgentState(testAgentId);
      transitionState(testAgentId, LifecycleState.INITIALIZING, "spawn_started");

      const history = getAgentStateHistory(testAgentId);
      expect(history.length).toBe(1);
      expect(history[0]?.previousState).toBe(LifecycleState.SPAWNING);
      expect(history[0]?.newState).toBe(LifecycleState.INITIALIZING);
    });

    test("includes error details when transitioning to FAILED", () => {
      initializeAgentState(testAgentId);
      const error = { code: "SPAWN_FAILED", message: "Test error" };
      const transition = transitionState(
        testAgentId,
        LifecycleState.FAILED,
        "error",
        error
      );

      expect(transition.error).toEqual(error);
    });
  });

  describe("helper functions", () => {
    test("markAgentReady transitions through INITIALIZING to READY", () => {
      initializeAgentState(testAgentId);
      markAgentReady(testAgentId);

      const state = getAgentState(testAgentId);
      expect(state?.currentState).toBe(LifecycleState.READY);

      const history = getAgentStateHistory(testAgentId);
      expect(history.length).toBe(2);
      expect(history[0]?.newState).toBe(LifecycleState.INITIALIZING);
      expect(history[1]?.newState).toBe(LifecycleState.READY);
    });

    test("markAgentExecuting transitions READY -> EXECUTING", () => {
      initializeAgentState(testAgentId);
      markAgentReady(testAgentId);
      markAgentExecuting(testAgentId);

      const state = getAgentState(testAgentId);
      expect(state?.currentState).toBe(LifecycleState.EXECUTING);
    });

    test("markAgentIdle transitions EXECUTING -> READY", () => {
      initializeAgentState(testAgentId);
      markAgentReady(testAgentId);
      markAgentExecuting(testAgentId);
      markAgentIdle(testAgentId);

      const state = getAgentState(testAgentId);
      expect(state?.currentState).toBe(LifecycleState.READY);
    });

    test("markAgentTerminating transitions READY -> TERMINATING", () => {
      initializeAgentState(testAgentId);
      markAgentReady(testAgentId);
      markAgentTerminating(testAgentId);

      const state = getAgentState(testAgentId);
      expect(state?.currentState).toBe(LifecycleState.TERMINATING);
    });

    test("markAgentTerminated transitions TERMINATING -> TERMINATED", () => {
      initializeAgentState(testAgentId);
      markAgentReady(testAgentId);
      markAgentTerminating(testAgentId);
      markAgentTerminated(testAgentId);

      const state = getAgentState(testAgentId);
      expect(state?.currentState).toBe(LifecycleState.TERMINATED);
    });

    test("markAgentFailed transitions to FAILED with error", () => {
      initializeAgentState(testAgentId);
      markAgentFailed(testAgentId, "error", {
        code: "TEST_ERROR",
        message: "Test failure",
      });

      const state = getAgentState(testAgentId);
      expect(state?.currentState).toBe(LifecycleState.FAILED);

      const history = getAgentStateHistory(testAgentId);
      const lastTransition = history[history.length - 1];
      expect(lastTransition?.error?.code).toBe("TEST_ERROR");
    });
  });

  describe("full lifecycle flow", () => {
    test("spawn -> ready -> executing -> ready -> terminating -> terminated", () => {
      // Spawn
      initializeAgentState(testAgentId);
      expect(getAgentState(testAgentId)?.currentState).toBe(LifecycleState.SPAWNING);

      // Ready
      markAgentReady(testAgentId);
      expect(getAgentState(testAgentId)?.currentState).toBe(LifecycleState.READY);

      // Execute command
      markAgentExecuting(testAgentId);
      expect(getAgentState(testAgentId)?.currentState).toBe(LifecycleState.EXECUTING);

      // Command complete
      markAgentIdle(testAgentId);
      expect(getAgentState(testAgentId)?.currentState).toBe(LifecycleState.READY);

      // Start termination
      markAgentTerminating(testAgentId);
      expect(getAgentState(testAgentId)?.currentState).toBe(LifecycleState.TERMINATING);

      // Complete termination
      markAgentTerminated(testAgentId);
      expect(getAgentState(testAgentId)?.currentState).toBe(LifecycleState.TERMINATED);

      // Verify history
      const history = getAgentStateHistory(testAgentId);
      expect(history.length).toBe(6);
    });
  });
});
