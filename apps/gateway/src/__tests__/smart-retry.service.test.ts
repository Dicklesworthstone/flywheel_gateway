/**
 * Smart Retry with Backoff Profiles Tests (bd-m4fk1)
 */

import { beforeEach, describe, expect, test } from "bun:test";
import app from "../index";
import {
  applyJitter,
  calculateDelay,
  clearSmartRetryForTesting,
  openCircuitForTesting,
  withRetry,
} from "../services/smart-retry.service";

describe("Smart Retry with Backoff Profiles (bd-m4fk1)", () => {
  beforeEach(() => {
    delete process.env["GATEWAY_ADMIN_KEY"];
    clearSmartRetryForTesting();
  });

  test("calculates delays for fixed, linear, exponential, and fibonacci strategies and respects maxDelayMs", () => {
    expect(
      calculateDelay(1, { strategy: "linear", initialDelayMs: 100 }, 0),
    ).toBe(100);
    expect(
      calculateDelay(3, { strategy: "linear", initialDelayMs: 100 }, 200),
    ).toBe(300);

    const fibProfile = { strategy: "fibonacci" as const, initialDelayMs: 100 };
    expect(calculateDelay(1, fibProfile, 0)).toBe(100);
    expect(calculateDelay(2, fibProfile, 100)).toBe(100);
    expect(calculateDelay(3, fibProfile, 100)).toBe(200);
    expect(calculateDelay(4, fibProfile, 200)).toBe(300);
    expect(calculateDelay(5, fibProfile, 300)).toBe(500);

    expect(
      calculateDelay(
        3,
        {
          strategy: "exponential",
          initialDelayMs: 100,
          maxDelayMs: 500,
          multiplier: 10,
        },
        0,
      ),
    ).toBe(500);
  });

  test("applies full, equal, and decorrelated jitter within expected bounds", () => {
    const fullResults = Array.from({ length: 50 }, () =>
      applyJitter(1000, "full", 0, {}),
    );
    expect(fullResults.every((r) => r >= 0 && r <= 1000)).toBe(true);

    const equalResults = Array.from({ length: 50 }, () =>
      applyJitter(1000, "equal", 0, { jitterFactor: 0.5 }),
    );
    expect(equalResults.every((r) => r >= 500 && r <= 1000)).toBe(true);

    const decorrelatedResults = Array.from({ length: 50 }, () =>
      applyJitter(1000, "decorrelated", 500, {
        initialDelayMs: 100,
        maxDelayMs: 5000,
      }),
    );
    expect(decorrelatedResults.every((r) => r >= 100 && r <= 1500)).toBe(true);
  });

  test("withRetry retries retryable errors, aborts on non-retryable errors, and respects open circuit breakers", async () => {
    let calls = 0;
    const res1 = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("TIMEOUT: transient network failure");
        return "ok";
      },
      {
        name: "test-retry",
        strategy: "exponential",
        initialDelayMs: 10,
        maxAttempts: 4,
        retryableErrors: ["TIMEOUT"],
      },
      { sleepFn: async () => {} },
    );
    expect(res1.success).toBe(true);
    expect(res1.attempts).toBe(3);

    // Non-retryable error stops after 1 attempt
    let nonRetryCalls = 0;
    const res2 = await withRetry(
      async () => {
        nonRetryCalls++;
        throw new Error("INVALID_INPUT: bad schema");
      },
      {
        name: "test-non-retry",
        maxAttempts: 4,
        retryableErrors: ["TIMEOUT"],
      },
      { sleepFn: async () => {} },
    );
    expect(res2.success).toBe(false);
    expect(res2.attempts).toBe(1);
    expect(nonRetryCalls).toBe(1);

    // Open circuit breaker short-circuits immediately
    openCircuitForTesting("anthropic-api");
    let circuitCalls = 0;
    const res3 = await withRetry(
      async () => {
        circuitCalls++;
        return "ok";
      },
      {
        name: "circuit-test",
        respectCircuitBreaker: true,
        circuitName: "anthropic-api",
      },
      { circuitName: "anthropic-api" },
    );
    expect(res3.success).toBe(false);
    expect(res3.circuitShortCircuited).toBe(true);
    expect(circuitCalls).toBe(0);
  });

  test("REST endpoints /retry-profiles and /retry-profiles/:id/simulate work end-to-end", async () => {
    const listRes = await app.request("/retry-profiles");
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      data: Array<{ name: string }>;
    };
    expect(listBody.data.length).toBeGreaterThanOrEqual(5);
    expect(listBody.data.some((p) => p.name === "api_rate_limit")).toBe(true);

    const simRes = await app.request(
      "/retry-profiles/api_rate_limit/simulate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attempts: 4 }),
      },
    );
    expect(simRes.status).toBe(200);
    const simBody = (await simRes.json()) as {
      data: { delays: number[] };
    };
    expect(simBody.data.delays).toHaveLength(4);
    expect(simBody.data.delays[1]!).toBeGreaterThan(simBody.data.delays[0]!);
  });
});
