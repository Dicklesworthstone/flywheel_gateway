/**
 * NTM Configuration Tests
 *
 * Tests for NTM feature flags and config gating.
 * Part of bead bd-2nr0: Tests: NTM feature flags + config gating.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearConfigCache,
  flywheelConfigSchema,
  getConfig,
  loadConfig,
  type NtmConfig,
} from "../services/config.service";

// ============================================================================
// Test Helpers
// ============================================================================

/** Save original env vars for restoration */
const originalEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string): void {
  if (!(key in originalEnv)) {
    originalEnv[key] = process.env[key];
  }
  process.env[key] = value;
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  // Clear the saved values
  for (const key of Object.keys(originalEnv)) {
    delete originalEnv[key];
  }
}

// ============================================================================
// NTM Config Schema Tests
// ============================================================================

describe("NTM Configuration", () => {
  afterEach(() => {
    restoreEnv();
    clearConfigCache();
  });

  describe("schema defaults", () => {
    test("parses empty config with NTM defaults", () => {
      const result = flywheelConfigSchema.safeParse({});
      expect(result.success).toBe(true);

      if (result.success) {
        const ntm = result.data.ntm;

        // NTM ingest defaults
        expect(ntm.enabled).toBe(true);
        expect(ntm.pollIntervalMs).toBe(5000);
        expect(ntm.commandTimeoutMs).toBe(10000);
        expect(ntm.maxBackoffMultiplier).toBe(6);

        // WS bridge defaults
        expect(ntm.wsBridge.enabled).toBe(true);
        expect(ntm.wsBridge.tailPollIntervalMs).toBe(2000);
        expect(ntm.wsBridge.tailLines).toBe(50);
        expect(ntm.wsBridge.enableOutputStreaming).toBe(true);

        // Throttling defaults
        expect(ntm.wsBridge.throttling.enabled).toBe(true);
        expect(ntm.wsBridge.throttling.batchWindowMs).toBe(100);
        expect(ntm.wsBridge.throttling.maxEventsPerBatch).toBe(50);
        expect(ntm.wsBridge.throttling.debounceMs).toBe(50);
      }
    });

    test("allows disabling NTM integration", () => {
      const result = flywheelConfigSchema.safeParse({
        ntm: { enabled: false },
      });
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.ntm.enabled).toBe(false);
        // Other defaults should still be set
        expect(result.data.ntm.pollIntervalMs).toBe(5000);
      }
    });

    test("allows custom polling interval", () => {
      const result = flywheelConfigSchema.safeParse({
        ntm: { pollIntervalMs: 10000 },
      });
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.ntm.pollIntervalMs).toBe(10000);
        expect(result.data.ntm.enabled).toBe(true); // Default preserved
      }
    });

    test("allows disabling WS bridge while keeping ingest", () => {
      const result = flywheelConfigSchema.safeParse({
        ntm: {
          enabled: true,
          wsBridge: { enabled: false },
        },
      });
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.ntm.enabled).toBe(true);
        expect(result.data.ntm.wsBridge.enabled).toBe(false);
      }
    });

    test("allows custom throttling config", () => {
      const result = flywheelConfigSchema.safeParse({
        ntm: {
          wsBridge: {
            throttling: {
              batchWindowMs: 200,
              maxEventsPerBatch: 100,
              debounceMs: 25,
            },
          },
        },
      });
      expect(result.success).toBe(true);

      if (result.success) {
        const throttling = result.data.ntm.wsBridge.throttling;
        expect(throttling.batchWindowMs).toBe(200);
        expect(throttling.maxEventsPerBatch).toBe(100);
        expect(throttling.debounceMs).toBe(25);
        expect(throttling.enabled).toBe(true); // Default preserved
      }
    });
  });

  describe("schema validation", () => {
    test("rejects pollIntervalMs below minimum", () => {
      const result = flywheelConfigSchema.safeParse({
        ntm: { pollIntervalMs: 500 }, // Min is 1000
      });
      expect(result.success).toBe(false);
    });

    test("rejects commandTimeoutMs below minimum", () => {
      const result = flywheelConfigSchema.safeParse({
        ntm: { commandTimeoutMs: 500 }, // Min is 1000
      });
      expect(result.success).toBe(false);
    });

    test("rejects maxBackoffMultiplier above maximum", () => {
      const result = flywheelConfigSchema.safeParse({
        ntm: { maxBackoffMultiplier: 25 }, // Max is 20
      });
      expect(result.success).toBe(false);
    });

    test("rejects tailPollIntervalMs below minimum", () => {
      const result = flywheelConfigSchema.safeParse({
        ntm: { wsBridge: { tailPollIntervalMs: 100 } }, // Min is 500
      });
      expect(result.success).toBe(false);
    });

    test("rejects batchWindowMs below minimum", () => {
      const result = flywheelConfigSchema.safeParse({
        ntm: { wsBridge: { throttling: { batchWindowMs: 5 } } }, // Min is 10
      });
      expect(result.success).toBe(false);
    });
  });

  describe("environment variable overrides", () => {
    test("NTM_ENABLED=false disables NTM", async () => {
      setEnv("NTM_ENABLED", "false");
      clearConfigCache();

      const config = await loadConfig({ cwd: "/tmp" });
      expect(config.ntm.enabled).toBe(false);
    });

    test("NTM_POLL_INTERVAL_MS overrides polling interval", async () => {
      setEnv("NTM_POLL_INTERVAL_MS", "15000");
      clearConfigCache();

      const config = await loadConfig({ cwd: "/tmp" });
      expect(config.ntm.pollIntervalMs).toBe(15000);
    });

    test("NTM_COMMAND_TIMEOUT_MS overrides command timeout", async () => {
      setEnv("NTM_COMMAND_TIMEOUT_MS", "20000");
      clearConfigCache();

      const config = await loadConfig({ cwd: "/tmp" });
      expect(config.ntm.commandTimeoutMs).toBe(20000);
    });

    test("NTM_MAX_BACKOFF_MULTIPLIER overrides backoff multiplier", async () => {
      setEnv("NTM_MAX_BACKOFF_MULTIPLIER", "10");
      clearConfigCache();

      const config = await loadConfig({ cwd: "/tmp" });
      expect(config.ntm.maxBackoffMultiplier).toBe(10);
    });

    test("NTM_WS_BRIDGE_ENABLED=false disables WS bridge", async () => {
      setEnv("NTM_WS_BRIDGE_ENABLED", "false");
      clearConfigCache();

      const config = await loadConfig({ cwd: "/tmp" });
      expect(config.ntm.wsBridge.enabled).toBe(false);
    });

    test("NTM_WS_TAIL_POLL_INTERVAL_MS overrides tail polling", async () => {
      setEnv("NTM_WS_TAIL_POLL_INTERVAL_MS", "5000");
      clearConfigCache();

      const config = await loadConfig({ cwd: "/tmp" });
      expect(config.ntm.wsBridge.tailPollIntervalMs).toBe(5000);
    });

    test("NTM_WS_THROTTLING_ENABLED=false disables throttling", async () => {
      setEnv("NTM_WS_THROTTLING_ENABLED", "false");
      clearConfigCache();

      const config = await loadConfig({ cwd: "/tmp" });
      expect(config.ntm.wsBridge.throttling.enabled).toBe(false);
    });

    test("multiple env overrides work together", async () => {
      setEnv("NTM_ENABLED", "true");
      setEnv("NTM_POLL_INTERVAL_MS", "3000");
      setEnv("NTM_WS_BRIDGE_ENABLED", "false");
      setEnv("NTM_WS_THROTTLING_ENABLED", "false");
      clearConfigCache();

      const config = await loadConfig({ cwd: "/tmp" });
      expect(config.ntm.enabled).toBe(true);
      expect(config.ntm.pollIntervalMs).toBe(3000);
      expect(config.ntm.wsBridge.enabled).toBe(false);
      expect(config.ntm.wsBridge.throttling.enabled).toBe(false);
    });

    test("RATE_LIMIT_ENABLED=false disables HTTP rate limiting (config)", async () => {
      setEnv("RATE_LIMIT_ENABLED", "false");
      clearConfigCache();

      const config = await loadConfig({ cwd: "/tmp" });
      expect(config.security.rateLimitEnabled).toBe(false);
    });

    test("RATE_LIMIT_PER_MINUTE overrides rateLimitPerMinute (config)", async () => {
      setEnv("RATE_LIMIT_PER_MINUTE", "123");
      clearConfigCache();

      const config = await loadConfig({ cwd: "/tmp" });
      expect(config.security.rateLimitPerMinute).toBe(123);
    });
  });

  describe("config caching", () => {
    test("getConfig returns defaults when not loaded", () => {
      clearConfigCache();
      const config = getConfig();

      // Should return default NTM config
      expect(config.ntm.enabled).toBe(true);
      expect(config.ntm.pollIntervalMs).toBe(5000);
    });

    test("loadConfig caches the result", async () => {
      clearConfigCache();

      const config1 = await loadConfig({ cwd: "/tmp" });
      const config2 = await loadConfig({ cwd: "/tmp" });

      // Should be the same reference (cached)
      expect(config1).toBe(config2);
    });

    test("forceReload bypasses cache", async () => {
      clearConfigCache();

      const config1 = await loadConfig({ cwd: "/tmp" });

      // Change env (won't affect cached config)
      setEnv("NTM_POLL_INTERVAL_MS", "9999");

      // Without force reload, should get cached value
      const config2 = await loadConfig({ cwd: "/tmp" });
      expect(config2.ntm.pollIntervalMs).toBe(config1.ntm.pollIntervalMs);

      // With force reload, should get new value
      const config3 = await loadConfig({ cwd: "/tmp", forceReload: true });
      expect(config3.ntm.pollIntervalMs).toBe(9999);
    });
  });

  describe("config type exports", () => {
    test("NtmConfig type is correct", () => {
      const config: NtmConfig = {
        enabled: true,
        pollIntervalMs: 5000,
        commandTimeoutMs: 10000,
        maxBackoffMultiplier: 6,
        wsBridge: {
          enabled: true,
          tailPollIntervalMs: 2000,
          tailLines: 50,
          enableOutputStreaming: true,
          throttling: {
            enabled: true,
            batchWindowMs: 100,
            maxEventsPerBatch: 50,
            debounceMs: 50,
          },
        },
      };

      // Type checking - this compiles means types are correct
      expect(config.enabled).toBe(true);
      expect(config.wsBridge.throttling.batchWindowMs).toBe(100);
    });
  });
});
