import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { ServerWebSocket } from "bun";
import app from "../index";
import { withDbSpan, withJobSpan } from "../services/otel.service";
import { handleWSMessage, handleWSOpen } from "../ws/handlers";
import { type ConnectionData, resetHub } from "../ws/hub";
import { createHubMessage } from "../ws/messages";

function installInMemoryTracing(): {
  exporter: InMemorySpanExporter;
  provider: BasicTracerProvider;
} {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(provider);

  return { exporter, provider };
}

describe("OTel instrumentation", () => {
  const originalEnv = {
    jwtSecret: process.env["JWT_SECRET"],
    adminKey: process.env["GATEWAY_ADMIN_KEY"],
    trustIncoming: process.env["OTEL_TRUST_INCOMING_TRACE_CONTEXT"],
  };

  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeEach(() => {
    resetHub();
    ({ exporter, provider } = installInMemoryTracing());
  });

  afterEach(async () => {
    await provider.shutdown().catch(() => undefined);
    trace.disable();
    propagation.disable();
    context.disable();
    resetHub();

    const restoreEnv = (key: string, value: string | undefined) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };

    restoreEnv("JWT_SECRET", originalEnv.jwtSecret);
    restoreEnv("GATEWAY_ADMIN_KEY", originalEnv.adminKey);
    restoreEnv("OTEL_TRUST_INCOMING_TRACE_CONTEXT", originalEnv.trustIncoming);
  });

  it("creates an HTTP span per request with basic attributes", async () => {
    delete process.env["JWT_SECRET"];
    delete process.env["GATEWAY_ADMIN_KEY"];
    delete process.env["OTEL_TRUST_INCOMING_TRACE_CONTEXT"];

    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const spans = exporter.getFinishedSpans();
    const httpSpan = spans.find((s) => s.name.startsWith("HTTP "));
    expect(httpSpan).toBeDefined();
    expect(httpSpan?.attributes["http.method"]).toBe("GET");
    expect(httpSpan?.attributes["http.route"]).toBe("/health");
    expect(httpSpan?.attributes["http.status_code"]).toBe(200);
    expect(typeof httpSpan?.attributes["http.duration_ms"]).toBe("number");
    expect(typeof httpSpan?.attributes["flywheel.correlation_id"]).toBe(
      "string",
    );
    expect(typeof httpSpan?.attributes["flywheel.request_id"]).toBe("string");
  });

  it("does not trust incoming trace context when auth is enabled", async () => {
    process.env["JWT_SECRET"] = "test-secret";
    delete process.env["OTEL_TRUST_INCOMING_TRACE_CONTEXT"];

    const incomingTraceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const traceparent = `00-${incomingTraceId}-00f067aa0ba902b7-01`;

    const res = await app.request("/health", {
      headers: { traceparent },
    });
    expect(res.status).toBe(200);

    const spans = exporter.getFinishedSpans();
    const httpSpan = spans.find((s) => s.name.startsWith("HTTP "));
    expect(httpSpan).toBeDefined();
    expect(httpSpan?.spanContext().traceId).not.toBe(incomingTraceId);
  });

  it("respects incoming trace context when explicitly allowed", async () => {
    process.env["JWT_SECRET"] = "test-secret";
    process.env["OTEL_TRUST_INCOMING_TRACE_CONTEXT"] = "true";

    const incomingTraceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const traceparent = `00-${incomingTraceId}-00f067aa0ba902b7-01`;

    const res = await app.request("/health", {
      headers: { traceparent },
    });
    expect(res.status).toBe(200);

    const spans = exporter.getFinishedSpans();
    const httpSpan = spans.find((s) => s.name.startsWith("HTTP "));
    expect(httpSpan).toBeDefined();
    expect(httpSpan?.spanContext().traceId).toBe(incomingTraceId);
  });

  it("creates a WS span per message with channel attributes", () => {
    const sent: string[] = [];

    const ws = {
      data: {
        connectionId: "ws_test",
        connectedAt: new Date(),
        auth: { isAdmin: true, workspaceIds: [], userId: "user_1" },
        subscriptions: new Map<string, string | undefined>(),
        lastHeartbeat: new Date(),
        pendingAcks: new Map(),
        activeReplays: 0,
      } satisfies ConnectionData,
      send(payload: string) {
        sent.push(payload);
      },
      close() {},
    } as unknown as ServerWebSocket<ConnectionData>;

    handleWSOpen(ws);
    handleWSMessage(
      ws,
      JSON.stringify({
        type: "subscribe",
        channel: "agent:output:agent_123",
      }),
    );

    expect(sent.length).toBeGreaterThan(0);

    const spans = exporter.getFinishedSpans();
    const wsSpan = spans.find((s) => s.name === "WS message subscribe");
    expect(wsSpan).toBeDefined();
    expect(wsSpan?.attributes["ws.message_type"]).toBe("subscribe");
    expect(wsSpan?.attributes["ws.channel"]).toBe("agent:output:agent_123");
    expect(wsSpan?.attributes["ws.agent_id"]).toBe("agent_123");
  });

  it("sets X-Trace-ID response header and propagates traceId into HubMessage metadata", async () => {
    delete process.env["JWT_SECRET"];
    delete process.env["GATEWAY_ADMIN_KEY"];

    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const headerTraceId = res.headers.get("X-Trace-ID");
    expect(headerTraceId).toBeDefined();

    const spans = exporter.getFinishedSpans();
    const httpSpan = spans.find((s) => s.name.startsWith("HTTP "));
    expect(httpSpan?.spanContext().traceId).toBe(headerTraceId!);

    // Verify createHubMessage captures active span traceId and spanId
    const tracer = trace.getTracer("flywheel-gateway");
    const customSpan = tracer.startSpan("WS publish test");
    const spanCtx = trace.setSpan(context.active(), customSpan);
    const hubMsg = context.with(spanCtx, () =>
      createHubMessage("output.chunk", "agent:output:a1", { text: "hello" }),
    );
    customSpan.end();

    expect(hubMsg.metadata?.traceId).toBe(customSpan.spanContext().traceId);
    expect(hubMsg.metadata?.spanId).toBe(customSpan.spanContext().spanId);
  });

  it("creates DB and Job spans with table, operation, and job attributes", async () => {
    const result = await withJobSpan("codebase_scan", "job_999", async () => {
      return await withDbSpan("INSERT", "jobs", async () => {
        return { inserted: true };
      });
    });

    expect(result).toEqual({ inserted: true });

    const spans = exporter.getFinishedSpans();
    const dbSpan = spans.find((s) => s.name === "DB INSERT jobs");
    const jobSpan = spans.find((s) => s.name === "Job codebase_scan");

    expect(dbSpan).toBeDefined();
    expect(dbSpan?.attributes["db.system"]).toBe("sqlite");
    expect(dbSpan?.attributes["db.operation"]).toBe("INSERT");
    expect(dbSpan?.attributes["db.sql.table"]).toBe("jobs");
    expect(typeof dbSpan?.attributes["db.duration_ms"]).toBe("number");

    expect(jobSpan).toBeDefined();
    expect(jobSpan?.attributes["flywheel.job.type"]).toBe("codebase_scan");
    expect(jobSpan?.attributes["flywheel.job.id"]).toBe("job_999");
    expect(jobSpan?.attributes["flywheel.job.success"]).toBe(true);
    expect(typeof jobSpan?.attributes["flywheel.job.duration_ms"]).toBe(
      "number",
    );
  });
});
