/**
 * Unit tests for the Circuit Breaker Service.
 *
 * Tests the state machine (CLOSED → OPEN → HALF_OPEN → CLOSED),
 * exponential backoff, configuration, and the withCircuitBreaker wrapper.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  _clearAllBreakers,
  configureBreaker,
  getAllBreakerStatuses,
  getBreakerStatus,
  recordFailure,
  recordSuccess,
  resetBreaker,
  shouldCheck,
  withCircuitBreaker,
} from "../services/circuit-breaker.service";

beforeEach(() => {
  _clearAllBreakers();
});

afterEach(() => {
  _clearAllBreakers();
});

describe("Circuit Breaker State Machine", () => {
  test("starts in CLOSED state", () => {
    const status = getBreakerStatus("test-tool");
    expect(status.state).toBe("CLOSED");
    expect(status.consecutiveFailures).toBe(0);
  });

  test("stays CLOSED below failure threshold", () => {
    recordFailure("test-tool");
    recordFailure("test-tool");
    expect(getBreakerStatus("test-tool").state).toBe("CLOSED");
  });

  test("transitions to OPEN after failure threshold", () => {
    recordFailure("test-tool");
    recordFailure("test-tool");
    recordFailure("test-tool");
    recordFailure("test-tool");
    recordFailure("test-tool");
    expect(getBreakerStatus("test-tool").state).toBe("OPEN");
  });

  test("success resets consecutive failures", () => {
    recordFailure("test-tool");
    recordFailure("test-tool");
    recordSuccess("test-tool");
    expect(getBreakerStatus("test-tool").consecutiveFailures).toBe(0);

    // Now 5 more failures needed to open (default threshold)
    recordFailure("test-tool");
    recordFailure("test-tool");
    expect(getBreakerStatus("test-tool").state).toBe("CLOSED");
  });

  test("OPEN circuit blocks checks", () => {
    recordFailure("test-tool");
    recordFailure("test-tool");
    recordFailure("test-tool");
    recordFailure("test-tool");
    recordFailure("test-tool");

    expect(shouldCheck("test-tool")).toBe(false);
  });

  test("CLOSED circuit allows checks", () => {
    expect(shouldCheck("test-tool")).toBe(true);
  });

  test("OPEN transitions to HALF_OPEN after backoff", async () => {
    configureBreaker("fast-tool", {
      failureThreshold: 1,
      resetTimeoutMs: 5,
    });

    recordFailure("fast-tool");
    expect(getBreakerStatus("fast-tool").state).toBe("OPEN");

    const status = getBreakerStatus("fast-tool");
    expect(status.nextRetryAt).not.toBeNull();

    // Wait for backoff to elapse
    await Bun.sleep(10);

    const canCheck = shouldCheck("fast-tool");
    expect(canCheck).toBe(true);
    expect(getBreakerStatus("fast-tool").state).toBe("HALF_OPEN");
  });

  test("HALF_OPEN + success → CLOSED", async () => {
    configureBreaker("recover-tool", {
      failureThreshold: 1,
      resetTimeoutMs: 5,
      successThreshold: 2,
    });

    recordFailure("recover-tool");
    expect(getBreakerStatus("recover-tool").state).toBe("OPEN");

    await Bun.sleep(10);
    shouldCheck("recover-tool");
    expect(getBreakerStatus("recover-tool").state).toBe("HALF_OPEN");

    recordSuccess("recover-tool");
    expect(getBreakerStatus("recover-tool").state).toBe("HALF_OPEN");

    recordSuccess("recover-tool");
    expect(getBreakerStatus("recover-tool").state).toBe("CLOSED");
  });

  test("HALF_OPEN + failure → OPEN with increased backoff", async () => {
    configureBreaker("stubborn-tool", {
      failureThreshold: 1,
      resetTimeoutMs: 5,
      backoffMultiplier: 2,
      maxBackoffMs: 1000,
    });

    recordFailure("stubborn-tool");
    expect(getBreakerStatus("stubborn-tool").currentBackoffMs).toBe(5);

    await Bun.sleep(10);
    shouldCheck("stubborn-tool"); // → HALF_OPEN
    recordFailure("stubborn-tool"); // → OPEN with doubled backoff

    const status = getBreakerStatus("stubborn-tool");
    expect(status.state).toBe("OPEN");
    expect(status.currentBackoffMs).toBe(10); // 5 * 2
  });
});

describe("Circuit Breaker Configuration", () => {
  test("custom failure threshold", () => {
    configureBreaker("custom-tool", { failureThreshold: 5 });

    for (let i = 0; i < 4; i++) {
      recordFailure("custom-tool");
    }
    expect(getBreakerStatus("custom-tool").state).toBe("CLOSED");

    recordFailure("custom-tool");
    expect(getBreakerStatus("custom-tool").state).toBe("OPEN");
  });

  test("backoff respects maxBackoffMs", async () => {
    configureBreaker("max-tool", {
      failureThreshold: 1,
      resetTimeoutMs: 5,
      backoffMultiplier: 10,
      maxBackoffMs: 20,
    });

    recordFailure("max-tool");
    await Bun.sleep(10);
    shouldCheck("max-tool"); // → HALF_OPEN
    recordFailure("max-tool"); // → OPEN, backoff = min(5*10, 20) = 20

    expect(getBreakerStatus("max-tool").currentBackoffMs).toBe(20);
  });
});

describe("Circuit Breaker Counters", () => {
  test("tracks total checks, failures, successes", () => {
    recordSuccess("counter-tool");
    recordSuccess("counter-tool");
    recordFailure("counter-tool");

    const status = getBreakerStatus("counter-tool");
    expect(status.totalChecks).toBe(3);
    expect(status.totalSuccesses).toBe(2);
    expect(status.totalFailures).toBe(1);
  });

  test("records last failure/success timestamps", () => {
    recordFailure("time-tool");
    const s1 = getBreakerStatus("time-tool");
    expect(s1.lastFailedAt).not.toBeNull();
    expect(s1.lastSucceededAt).toBeNull();

    recordSuccess("time-tool");
    const s2 = getBreakerStatus("time-tool");
    expect(s2.lastSucceededAt).not.toBeNull();
  });
});

describe("withCircuitBreaker wrapper", () => {
  test("returns check result when circuit is closed", async () => {
    const { result, fromCache } = await withCircuitBreaker(
      "wrap-tool",
      async () => ({ healthy: true, version: "1.0.0" }),
      { healthy: false, version: "unknown" },
    );

    expect(result.healthy).toBe(true);
    expect(fromCache).toBe(false);
  });

  test("records failure when isSuccess predicate returns false (without falling back)", async () => {
    configureBreaker("predicate-tool", {
      failureThreshold: 1,
      resetTimeoutMs: 5,
    });

    const { result, fromCache } = await withCircuitBreaker(
      "predicate-tool",
      async () => ({ healthy: false, reason: "not installed" }),
      { healthy: true, reason: "fallback" },
      { isSuccess: (r) => r.healthy === true },
    );

    expect(result.healthy).toBe(false);
    expect(fromCache).toBe(false);
    expect(getBreakerStatus("predicate-tool").state).toBe("OPEN");
  });

  test("returns fallback when check throws", async () => {
    const { result, fromCache } = await withCircuitBreaker(
      "fail-tool",
      async () => {
        throw new Error("connection refused");
      },
      { healthy: false },
    );

    expect(result.healthy).toBe(false);
    expect(fromCache).toBe(true);
  });

  test("returns fallback when circuit is open", async () => {
    // Open the circuit
    recordFailure("open-tool");
    recordFailure("open-tool");
    recordFailure("open-tool");
    recordFailure("open-tool");
    recordFailure("open-tool");

    let checkCalled = false;
    const { result, fromCache } = await withCircuitBreaker(
      "open-tool",
      async () => {
        checkCalled = true;
        return { healthy: true };
      },
      { healthy: false },
    );

    expect(result.healthy).toBe(false);
    expect(fromCache).toBe(true);
    expect(checkCalled).toBe(false);
  });
});

describe("getAllBreakerStatuses", () => {
  test("returns all tracked breakers", () => {
    recordSuccess("tool-a");
    recordFailure("tool-b");

    const statuses = getAllBreakerStatuses();
    expect(statuses.length).toBe(2);
    expect(statuses.map((s) => s.tool).sort()).toEqual(["tool-a", "tool-b"]);
  });
});

describe("resetBreaker", () => {
  test("resets to CLOSED with initial backoff", () => {
    recordFailure("reset-tool");
    recordFailure("reset-tool");
    recordFailure("reset-tool");
    recordFailure("reset-tool");
    recordFailure("reset-tool");
    expect(getBreakerStatus("reset-tool").state).toBe("OPEN");

    resetBreaker("reset-tool");
    const status = getBreakerStatus("reset-tool");
    expect(status.state).toBe("CLOSED");
    expect(status.consecutiveFailures).toBe(0);
    expect(status.nextRetryAt).toBeNull();
  });
});

describe("Independent per-tool breakers", () => {
  test("different tools have independent state", () => {
    recordFailure("tool-x");
    recordFailure("tool-x");
    recordFailure("tool-x");
    recordFailure("tool-x");
    recordFailure("tool-x");

    recordSuccess("tool-y");

    expect(getBreakerStatus("tool-x").state).toBe("OPEN");
    expect(getBreakerStatus("tool-y").state).toBe("CLOSED");
  });
});
