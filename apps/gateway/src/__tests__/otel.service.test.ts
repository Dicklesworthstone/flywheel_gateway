/**
 * OpenTelemetry Tracing Bootstrap & OTLP Collector Export Tests
 *
 * Part of beads bd-33fkz, bd-1y5so, bd-2t3t0, bd-2sesi.
 */

import { describe, expect, test } from "bun:test";
import {
  forceFlushTracing,
  initTracing,
  shutdownTracing,
  withDbSpan,
  withJobSpan,
} from "../services/otel.service";

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

  test("exports DB and Job spans to an in-process OTLP HTTP collector stub", async () => {
    const receivedRequests: Array<{
      path: string;
      headers: Record<string, string>;
      body: string;
    }> = [];

    const collector = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        const body = await req.text();
        const headers: Record<string, string> = {};
        req.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
        receivedRequests.push({ path: url.pathname, headers, body });
        return new Response(JSON.stringify({ partialSuccess: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    try {
      const endpoint = `http://127.0.0.1:${collector.port}`;
      const result = initTracing({
        enabled: true,
        serviceName: "flywheel-gateway-otlp-test",
        tracesExporter: "otlp-http",
        otlpEndpoint: endpoint,
        otlpHeaders: "x-otlp-test=1,authorization=Bearer stub-token",
        exportTimeoutMs: 2_000,
      });

      expect(result.enabled).toBe(true);
      expect(result.exporter).toBe("otlp-http");

      await withJobSpan("context_build", "job-otlp-1", async () => {
        await withDbSpan("SELECT", "jobs", async () => {
          return [{ id: "job-otlp-1" }];
        });
      });

      await forceFlushTracing();
      await shutdownTracing({ timeoutMs: 2_000 });

      expect(receivedRequests.length).toBeGreaterThan(0);
      const traceReq = receivedRequests.find((r) => r.path === "/v1/traces");
      expect(traceReq).toBeDefined();
      expect(traceReq?.headers["x-otlp-test"]).toBe("1");
      expect(traceReq?.body).toContain("Job context_build");
      expect(traceReq?.body).toContain("DB SELECT jobs");
    } finally {
      await shutdownTracing({ timeoutMs: 1_000 });
      collector.stop(true);
    }
  });
});
