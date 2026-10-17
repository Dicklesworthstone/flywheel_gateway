import { AsyncLocalStorage } from "node:async_hooks";
import {
  context as otelContext,
  propagation,
  SpanKind,
  SpanStatusCode,
  type TextMapGetter,
  trace,
} from "@opentelemetry/api";
import type { Context, Next } from "hono";
import type { Logger } from "../services/logger";
import { createChildLogger, logger } from "../services/logger";
import { isAuthEnabled } from "./auth";

const TRUST_TRACE_ENV_KEY = "OTEL_TRUST_INCOMING_TRACE_CONTEXT";

const headersGetter: TextMapGetter<Headers> = {
  get(carrier, key) {
    const value = carrier.get(key);
    return value ?? undefined;
  },
  keys(carrier) {
    const out: string[] = [];
    carrier.forEach((_, headerKey) => {
      out.push(headerKey);
    });
    return out;
  },
};

function shouldTrustIncomingTraceContext(): boolean {
  // When auth is enabled, do not trust user-provided trace IDs unless explicitly allowed.
  if (isAuthEnabled()) {
    return process.env[TRUST_TRACE_ENV_KEY]?.trim().toLowerCase() === "true";
  }
  // In local/dev (auth disabled), allow trace context propagation by default.
  return true;
}

/**
 * Request context stored in AsyncLocalStorage.
 */
export interface RequestContext {
  correlationId: string;
  requestId: string;
  traceId?: string;
  spanId?: string;
  startTime: number;
  logger: Logger;
}

/**
 * AsyncLocalStorage instance for request context propagation.
 */
const baseRequestContextStorage = new AsyncLocalStorage<RequestContext>();
const nativeEnterWith = baseRequestContextStorage.enterWith.bind(
  baseRequestContextStorage,
);
const nativeDisable = baseRequestContextStorage.disable.bind(
  baseRequestContextStorage,
);
let fallbackEnteredContext: RequestContext | undefined;

export const requestContextStorage: AsyncLocalStorage<RequestContext> =
  Object.assign(baseRequestContextStorage, {
    enterWith(store: RequestContext): void {
      fallbackEnteredContext = store;
      nativeEnterWith(store);
    },
    disable(): void {
      fallbackEnteredContext = undefined;
      nativeDisable();
    },
  });

/**
 * Get the current request context from AsyncLocalStorage.
 * Returns undefined if called outside of a request context.
 */
export function getRequestContext(): RequestContext | undefined {
  return baseRequestContextStorage.getStore() ?? fallbackEnteredContext;
}

/**
 * Get the correlation ID from the current request context.
 * Returns "unknown" if called outside of a request context.
 */
export function getCorrelationId(): string {
  return getRequestContext()?.correlationId ?? "unknown";
}

/**
 * Get the trace ID from the current request context or active OTel span.
 */
export function getTraceId(): string | undefined {
  const ctxTraceId = getRequestContext()?.traceId;
  if (ctxTraceId) return ctxTraceId;
  const activeSpan = trace.getSpan(otelContext.active());
  const spanTraceId = activeSpan?.spanContext().traceId;
  if (spanTraceId && spanTraceId !== "00000000000000000000000000000000") {
    return spanTraceId;
  }
  return undefined;
}

/**
 * Get the span ID from the current request context or active OTel span.
 */
export function getSpanId(): string | undefined {
  const ctxSpanId = getRequestContext()?.spanId;
  if (ctxSpanId) return ctxSpanId;
  const activeSpan = trace.getSpan(otelContext.active());
  const spanId = activeSpan?.spanContext().spanId;
  if (spanId && spanId !== "0000000000000000") {
    return spanId;
  }
  return undefined;
}

/**
 * Get the request-scoped logger from the current context.
 * Falls back to the base logger if called outside of a request context.
 */
export function getLogger(): Logger {
  return getRequestContext()?.logger ?? logger;
}

/**
 * Generate a UUID v4 for correlation IDs.
 * Uses crypto.randomUUID which is available in Bun/Node.
 */
function generateId(): string {
  return crypto.randomUUID();
}

function generateHexTraceId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function generateHexSpanId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

/**
 * Correlation ID middleware for Hono.
 *
 * - Accepts incoming X-Correlation-ID header or generates a new one
 * - Stores context in AsyncLocalStorage for automatic propagation
 * - Adds X-Correlation-ID, X-Request-ID, and X-Trace-ID to response headers
 */
export function correlationMiddleware() {
  return async (c: Context, next: Next) => {
    const incomingCorrelationId = c.req.header("x-correlation-id");
    const correlationId = incomingCorrelationId || generateId();
    const requestId = generateId();
    const startTime = performance.now();

    const tracer = trace.getTracer("flywheel-gateway");
    const trustIncoming = shouldTrustIncomingTraceContext();
    const parentContext = trustIncoming
      ? propagation.extract(
          otelContext.active(),
          c.req.raw.headers,
          headersGetter,
        )
      : otelContext.active();

    const span = tracer.startSpan(
      `HTTP ${c.req.method} ${c.req.path}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          "http.method": c.req.method,
          "http.route": c.req.path,
          "flywheel.correlation_id": correlationId,
          "flywheel.request_id": requestId,
        },
      },
      parentContext,
    );

    const otelSpanCtx = span.spanContext();
    const hasValidOtelTrace =
      otelSpanCtx.traceId &&
      otelSpanCtx.traceId !== "00000000000000000000000000000000";
    const incomingTraceHeader = trustIncoming
      ? c.req.header("x-trace-id")?.trim()
      : undefined;

    const traceId = hasValidOtelTrace
      ? otelSpanCtx.traceId
      : incomingTraceHeader || generateHexTraceId();
    const spanId =
      otelSpanCtx.spanId && otelSpanCtx.spanId !== "0000000000000000"
        ? otelSpanCtx.spanId
        : generateHexSpanId();

    span.setAttribute("flywheel.trace_id", traceId);

    const requestLogger = createChildLogger({
      correlationId,
      requestId,
      traceId,
      spanId,
      method: c.req.method,
      path: c.req.path,
    });

    const context: RequestContext = {
      correlationId,
      requestId,
      traceId,
      spanId,
      startTime,
      logger: requestLogger,
    };

    // Set response headers
    c.header("X-Correlation-ID", correlationId);
    c.header("X-Request-ID", requestId);
    c.header("X-Trace-ID", traceId);
    c.set("correlationId", correlationId);
    c.set("requestId", requestId);
    c.set("traceId", traceId);

    // Run the rest of the middleware chain within the request context and span context.
    await requestContextStorage.run(context, async () => {
      const spanContext = trace.setSpan(parentContext, span);
      await otelContext.with(spanContext, async () => {
        let status = 500;
        let caughtError: unknown | undefined;

        try {
          await next();
          status = c.res.status;
        } catch (err) {
          caughtError = err;
          throw err;
        } finally {
          const durationMs = Math.round(performance.now() - startTime);
          span.setAttribute("http.status_code", status);
          span.setAttribute("http.duration_ms", durationMs);

          if (caughtError) {
            span.setStatus({ code: SpanStatusCode.ERROR });
            const error =
              caughtError instanceof Error
                ? caughtError
                : new Error(String(caughtError));
            span.recordException(error);
          } else if (status >= 500) {
            span.setStatus({ code: SpanStatusCode.ERROR });
          } else {
            span.setStatus({ code: SpanStatusCode.OK });
          }

          span.end();
        }
      });
    });
  };
}
