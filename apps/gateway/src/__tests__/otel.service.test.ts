/**
 * OpenTelemetry Tracing Bootstrap Tests
 *
 * Part of bead bd-33fkz.
 */

import { describe, expect, test } from "bun:test";
import { initTracing, shutdownTracing } from "../services/otel.service";

describe("OpenTelemetry tracing bootstrap", () => {
  test("initializes and shuts down (best-effort)", async () => {
    const result = initTracing({
      enabled: true,
      serviceName: "flywheel-gateway-test",
      tracesExporter: "none",
      exportTimeoutMs: 1_000,
    });

    expect(result.enabled).toBe(true);
    await shutdownTracing({ timeoutMs: 1_000 });
  });
});
