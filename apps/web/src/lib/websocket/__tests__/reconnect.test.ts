import { describe, expect, it } from "bun:test";
import {
  calculateBackoff,
  createInitialStatus,
  DEFAULT_BACKOFF_CONFIG,
  getStatusHint,
  shouldRetry,
} from "../reconnect";

describe("reconnect utilities", () => {
  describe("calculateBackoff", () => {
    it("should return base delay on first attempt", () => {
      const delays: number[] = [];
      // Run multiple times to account for jitter
      for (let i = 0; i < 100; i++) {
        delays.push(calculateBackoff(0, { jitterFactor: 0 }));
      }
      // With no jitter, should always be base delay
      expect(
        delays.every((d) => d === DEFAULT_BACKOFF_CONFIG.baseDelayMs),
      ).toBe(true);
    });

    it("should increase delay exponentially", () => {
      // With no jitter, delays should double each attempt
      const attempt0 = calculateBackoff(0, { jitterFactor: 0 });
      const attempt1 = calculateBackoff(1, { jitterFactor: 0 });
      const attempt2 = calculateBackoff(2, { jitterFactor: 0 });

      expect(attempt0).toBe(1000);
      expect(attempt1).toBe(2000);
      expect(attempt2).toBe(4000);
    });

    it("should cap delay at maxDelayMs", () => {
      // After many attempts, should hit the cap
      const delay = calculateBackoff(100, { jitterFactor: 0 });
      expect(delay).toBe(DEFAULT_BACKOFF_CONFIG.maxDelayMs);
    });

    it("should apply jitter within bounds", () => {
      const delays: number[] = [];
      // Run many times to test jitter distribution
      for (let i = 0; i < 1000; i++) {
        delays.push(calculateBackoff(2, { jitterFactor: 1 }));
      }

      // With full jitter, delays should be between 0 and exponential delay
      const exponentialDelay = 4000; // baseDelay * 2^2
      const min = Math.min(...delays);
      const max = Math.max(...delays);

      expect(min).toBeGreaterThanOrEqual(0);
      expect(max).toBeLessThanOrEqual(exponentialDelay);
      // With 1000 samples, we should see good distribution
      expect(max - min).toBeGreaterThan(1000); // Not all the same
    });

    it("should respect custom configuration", () => {
      const delay = calculateBackoff(0, {
        baseDelayMs: 500,
        multiplier: 3,
        jitterFactor: 0,
      });
      expect(delay).toBe(500);

      const delayAttempt1 = calculateBackoff(1, {
        baseDelayMs: 500,
        multiplier: 3,
        jitterFactor: 0,
      });
      expect(delayAttempt1).toBe(1500);
    });

    it("should return integer values", () => {
      for (let i = 0; i < 100; i++) {
        const delay = calculateBackoff(i % 10);
        expect(Number.isInteger(delay)).toBe(true);
      }
    });
  });

  describe("shouldRetry", () => {
    it("should return true when under max attempts", () => {
      expect(shouldRetry(0)).toBe(true);
      expect(shouldRetry(5)).toBe(true);
      expect(shouldRetry(9)).toBe(true);
    });

    it("should return false when at or over max attempts", () => {
      expect(shouldRetry(10)).toBe(false);
      expect(shouldRetry(11)).toBe(false);
      expect(shouldRetry(100)).toBe(false);
    });

    it("should respect custom maxAttempts", () => {
      expect(shouldRetry(3, { maxAttempts: 3 })).toBe(false);
      expect(shouldRetry(2, { maxAttempts: 3 })).toBe(true);
      expect(shouldRetry(0, { maxAttempts: 1 })).toBe(true);
      expect(shouldRetry(1, { maxAttempts: 1 })).toBe(false);
    });
  });

  describe("getStatusHint", () => {
    it("should return correct hint for disconnected state", () => {
      expect(getStatusHint("disconnected", 0, 10)).toBe("Disconnected");
    });

    it("should return correct hint for connecting state", () => {
      expect(getStatusHint("connecting", 0, 10)).toBe("Connecting...");
    });

    it("should return correct hint for connected state", () => {
      expect(getStatusHint("connected", 0, 10)).toBe("Connected");
    });

    it("should return correct hint for reconnecting state with attempt info", () => {
      expect(getStatusHint("reconnecting", 0, 10)).toBe(
        "Reconnecting (attempt 1/10)...",
      );
      expect(getStatusHint("reconnecting", 4, 10)).toBe(
        "Reconnecting (attempt 5/10)...",
      );
      expect(getStatusHint("reconnecting", 9, 10)).toBe(
        "Reconnecting (attempt 10/10)...",
      );
    });

    it("should return correct hint for failed state", () => {
      expect(getStatusHint("failed", 10, 10)).toBe(
        "Connection failed. Click to retry.",
      );
    });
  });

  describe("createInitialStatus", () => {
    it("should create status with disconnected state", () => {
      const status = createInitialStatus();
      expect(status.state).toBe("disconnected");
    });

    it("should create status with zero attempt count", () => {
      const status = createInitialStatus();
      expect(status.attempt).toBe(0);
    });

    it("should create status with null timestamps", () => {
      const status = createInitialStatus();
      expect(status.lastConnectedAt).toBeNull();
      expect(status.lastDisconnectedAt).toBeNull();
    });

    it("should create status with null nextRetryInMs", () => {
      const status = createInitialStatus();
      expect(status.nextRetryInMs).toBeNull();
    });

    it("should create status with disconnected hint", () => {
      const status = createInitialStatus();
      expect(status.hint).toBe("Disconnected");
    });
  });

  describe("DEFAULT_BACKOFF_CONFIG", () => {
    it("should have expected default values", () => {
      expect(DEFAULT_BACKOFF_CONFIG.baseDelayMs).toBe(1000);
      expect(DEFAULT_BACKOFF_CONFIG.maxDelayMs).toBe(30_000);
      expect(DEFAULT_BACKOFF_CONFIG.multiplier).toBe(2);
      expect(DEFAULT_BACKOFF_CONFIG.jitterFactor).toBe(1);
      expect(DEFAULT_BACKOFF_CONFIG.maxAttempts).toBe(10);
    });
  });
});
