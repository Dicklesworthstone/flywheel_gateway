import {
  context,
  propagation,
  type TextMapPropagator,
  trace,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { OTLPTraceExporter as OTLPHttpTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPTraceExporter as OTLPProtoTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import type { OtelConfig } from "./config.service";
import { logger } from "./logger";

export interface OtelBootstrapResult {
  enabled: boolean;
  exporter?: Exclude<OtelConfig["tracesExporter"], "none">;
}

let tracerProvider: BasicTracerProvider | null = null;
let tracerEnabled = false;

function buildOtlpTraceUrl(baseEndpoint: string): string {
  const trimmed = baseEndpoint.trim().replace(/\/+$/, "");
  // If the user already provided a full traces endpoint, preserve it.
  if (trimmed.endsWith("/v1/traces")) {
    return trimmed;
  }
  return `${trimmed}/v1/traces`;
}

function parseOtlpHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) continue;

    const headerKey = trimmed.slice(0, equalsIndex).trim();
    const headerValue = trimmed.slice(equalsIndex + 1).trim();

    if (!headerKey || !headerValue) continue;
    out[headerKey] = headerValue;
  }

  return out;
}

function defaultPropagator(): TextMapPropagator {
  return new CompositePropagator({
    propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
  });
}

function shouldEnableTracing(config: OtelConfig): boolean {
  // Explicit OTEL_ENABLED=false disables everything (handled at config layer too),
  // but also keep a defensive check here.
  if (config.enabled === false && config.tracesExporter === "none") {
    return false;
  }
  return config.enabled || config.tracesExporter !== "none";
}

function resolveExporter(
  config: OtelConfig,
): Exclude<OtelConfig["tracesExporter"], "none"> | null {
  if (config.tracesExporter !== "none") {
    return config.tracesExporter;
  }
  // If tracing was enabled without an explicit exporter, default to OTLP/proto.
  return config.enabled ? "otlp-proto" : null;
}

export function initTracing(config: OtelConfig): OtelBootstrapResult {
  if (tracerProvider) {
    return tracerEnabled ? { enabled: true } : { enabled: false };
  }

  if (!shouldEnableTracing(config)) {
    tracerEnabled = false;
    return { enabled: false };
  }

  const exporterKind = resolveExporter(config);
  if (!exporterKind) {
    tracerEnabled = false;
    return { enabled: false };
  }

  try {
    const resource = resourceFromAttributes({
      [SemanticResourceAttributes.SERVICE_NAME]: config.serviceName,
    });

    const exporterOptions: {
      url?: string;
      headers?: Record<string, string>;
    } = {};

    if (config.otlpEndpoint?.trim()) {
      exporterOptions.url = buildOtlpTraceUrl(config.otlpEndpoint);
    }
    if (config.otlpHeaders?.trim()) {
      exporterOptions.headers = parseOtlpHeaders(config.otlpHeaders);
    }

    const exporter =
      exporterKind === "otlp-http"
        ? new OTLPHttpTraceExporter(exporterOptions)
        : new OTLPProtoTraceExporter(exporterOptions);

    const spanProcessor = new BatchSpanProcessor(exporter, {
      exportTimeoutMillis: config.exportTimeoutMs,
    });

    const provider = new BasicTracerProvider({
      resource,
      spanProcessors: [spanProcessor],
    });

    const contextManager = new AsyncLocalStorageContextManager().enable();
    const propagator = defaultPropagator();

    // Register global provider + context propagation.
    context.setGlobalContextManager(contextManager);
    propagation.setGlobalPropagator(propagator);
    trace.setGlobalTracerProvider(provider);

    tracerProvider = provider;
    tracerEnabled = true;

    logger.info(
      {
        otel: {
          enabled: true,
          exporter: exporterKind,
          endpointConfigured: Boolean(config.otlpEndpoint?.trim()),
          headersConfigured: Boolean(config.otlpHeaders?.trim()),
        },
      },
      "OpenTelemetry tracing initialized",
    );

    return { enabled: true, exporter: exporterKind };
  } catch (error) {
    tracerProvider = null;
    tracerEnabled = false;
    logger.warn(
      { error },
      "OpenTelemetry tracing failed to initialize; continuing without tracing",
    );
    return { enabled: false };
  }
}

export async function shutdownTracing(options?: {
  timeoutMs?: number;
}): Promise<void> {
  const provider = tracerProvider;
  tracerProvider = null;
  tracerEnabled = false;

  if (!provider) return;

  const timeoutMs = options?.timeoutMs ?? 5_000;

  try {
    const shutdownPromise = provider.shutdown().catch((error) => {
      logger.warn({ error }, "OpenTelemetry provider shutdown rejected");
    });
    await Promise.race([
      shutdownPromise,
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch (error) {
    logger.warn({ error }, "OpenTelemetry tracing shutdown failed");
  }

  // Reset API globals so subsequent tests (or re-init in long-lived processes) can safely register again.
  trace.disable();
  propagation.disable();
  context.disable();
}
