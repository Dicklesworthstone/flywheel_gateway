/**
 * OpenTelemetry Configuration Tests
 *
 * Ensures OTel tracing config is opt-in and correctly parses env overrides.
 * Part of bead bd-33fkz.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  clearConfigCache,
  flywheelConfigSchema,
  loadConfig,
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
  for (const key of Object.keys(originalEnv)) {
    delete originalEnv[key];
  }
}

describe("OpenTelemetry configuration", () => {
  afterEach(() => {
    restoreEnv();
    clearConfigCache();
  });

  test("schema defaults keep tracing disabled", () => {
    const parsed = flywheelConfigSchema.parse({});

    expect(parsed.otel.enabled).toBe(false);
    expect(parsed.otel.tracesExporter).toBe("none");
    expect(parsed.otel.serviceName).toBe("flywheel-gateway");
    expect(parsed.otel.exportTimeoutMs).toBe(10_000);
    expect(parsed.otel.otlpEndpoint).toBeUndefined();
    expect(parsed.otel.otlpHeaders).toBeUndefined();
  });

  test("OTEL_TRACES_EXPORTER enables exporter selection without OTEL_ENABLED", async () => {
    setEnv("OTEL_TRACES_EXPORTER", "otlp-http");
    const config = await loadConfig({ cwd: "/tmp", forceReload: true });

    expect(config.otel.enabled).toBe(false);
    expect(config.otel.tracesExporter).toBe("otlp-http");
  });

  test("OTEL_ENABLED=true defaults exporter to otlp-proto", async () => {
    setEnv("OTEL_ENABLED", "true");
    const config = await loadConfig({ cwd: "/tmp", forceReload: true });

    expect(config.otel.enabled).toBe(true);
    expect(config.otel.tracesExporter).toBe("otlp-proto");
  });

  test("OTEL_ENABLED=false forces tracesExporter=none", async () => {
    setEnv("OTEL_TRACES_EXPORTER", "otlp-proto");
    setEnv("OTEL_ENABLED", "false");
    const config = await loadConfig({ cwd: "/tmp", forceReload: true });

    expect(config.otel.enabled).toBe(false);
    expect(config.otel.tracesExporter).toBe("none");
  });

  test("OTEL_EXPORTER_OTLP_ENDPOINT overrides endpoint", async () => {
    setEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318");
    const config = await loadConfig({ cwd: "/tmp", forceReload: true });

    expect(config.otel.otlpEndpoint).toBe("http://localhost:4318");
  });

  test("OTEL_SERVICE_NAME overrides serviceName", async () => {
    setEnv("OTEL_SERVICE_NAME", "flywheel-gateway-test");
    const config = await loadConfig({ cwd: "/tmp", forceReload: true });

    expect(config.otel.serviceName).toBe("flywheel-gateway-test");
  });
});
