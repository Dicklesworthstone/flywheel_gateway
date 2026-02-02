# ADR-009: OpenTelemetry Instrumentation in Bun

> **Bead**: bd-11zok
> **Status**: Accepted
> **Date**: 2026-02-02

## Context

Flywheel Gateway needs standard, vendor-neutral observability primitives:

- **traces** for request + background job latency breakdowns
- **metrics** for SLOs, alerting, and capacity planning
- (later) **logs** with trace correlation

The gateway runtime is **Bun** (not Node.js), and the HTTP ingress is primarily via `Bun.serve()` and Hono middleware. This affects which OpenTelemetry (OTel) JS SDKs and auto-instrumentation packages can be used safely.

This ADR chooses an OTel approach that:

- targets Bun 1.3+ with explicit compatibility guards
- avoids depending on Node-specific HTTP auto-instrumentation (since Bun does not use Node’s `http` server for ingress)
- keeps overhead low and makes enablement optional via config

## Decision

Adopt a **minimal, Bun-compatible OTel JS stack** for the gateway:

1. **Traces first** (manual + framework instrumentation).
2. Use **OTLP/HTTP** exporters (protobuf preferred; JSON acceptable).
3. Use `AsyncLocalStorage`-based context propagation when available, with explicit caveats about Bun’s `async_hooks` compatibility.
4. Avoid `@opentelemetry/auto-instrumentations-node` as a default path for Bun ingress; use targeted/manual instrumentation instead.

## Selected Packages

### Core (tracing)

- `@opentelemetry/api`
- `@opentelemetry/sdk-trace-base`
- `@opentelemetry/resources`
- `@opentelemetry/semantic-conventions`

### Context propagation

- `@opentelemetry/context-async-hooks`
  - Use `AsyncLocalStorageContextManager` when Bun’s `node:async_hooks` is available and behaves correctly for our request patterns.

### Exporters (OTLP over HTTP)

Prefer protobuf when possible:

- `@opentelemetry/exporter-trace-otlp-proto` (OTLP/HTTP protobuf)

Acceptable fallback:

- `@opentelemetry/exporter-trace-otlp-http` (OTLP/HTTP JSON)

### Later (metrics/logs)

- `@opentelemetry/sdk-metrics` + OTLP metrics exporter (HTTP/proto or HTTP/json)
- `@opentelemetry/sdk-logs` + OTLP logs exporter (HTTP/proto)

## Bootstrap Strategy (Gateway)

### Where initialization happens

Initialize telemetry **once**, early in process startup (before creating background loops) so all subsequent code sees a real tracer provider and context manager (not no-op defaults).

Recommended location:

- `apps/gateway/src/index.ts` (inside `if (import.meta.main)` after config load, before starting services)

### Configuration surface

Add explicit config flags so telemetry can be disabled (default) and tuned:

- `OTEL_ENABLED` (`true|false`)
- `OTEL_SERVICE_NAME` (default `flywheel-gateway`)
- `OTEL_EXPORTER_OTLP_ENDPOINT` (e.g. `http://localhost:4318`)
- `OTEL_EXPORTER_OTLP_HEADERS` (optional, for auth)
- `OTEL_EXPORTER_OTLP_PROTOCOL` / `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` (`http/protobuf` preferred; `http/json` acceptable)
- `OTEL_TRACES_EXPORTER` (`otlp-proto|otlp-http|none`)
- `OTEL_TRACES_SAMPLER` + sampling ratio (e.g. parent-based traceidratio)
- timeouts / batch sizes (export timeout, queue size, flush interval)

### Span model (what we actually trace)

Because Bun ingress is not Node `http`, “auto-instrument everything” won’t create useful root spans by default.

Instead:

- Add a **Hono middleware** that:
  - extracts W3C trace context (`traceparent`, `tracestate`) when present
  - starts a root span per request
  - attaches minimal, low-cardinality attributes (`http.method`, `http.route`, `http.status_code`)
  - ends span on response completion
- Wrap key internal operations with spans:
  - DB (Drizzle) calls
  - NTM / tool runner calls
  - outbound HTTP calls (`fetch`) if/when needed
  - background jobs (cleanup loops, pollers), with “tick spans” and child spans for work units
- WebSockets:
  - span for connect/upgrade
  - optional span per message batch with channel/topic tags (bounded cardinality)

## Expected Performance Overhead

Traces add overhead primarily via:

- span creation/attribute setting on hot paths
- context propagation
- export buffering and network flushes

Mitigations:

- keep telemetry **off by default**
- enable **batch** span processor (avoid sync export)
- enable **sampling** in production (default low ratio; bump for incidents)
- cap attribute cardinality (never include raw prompts, tokens, or user text)
- export timeout + bounded queue sizes to prevent backpressure cascades

## Bun Limitations / Workarounds

### Context propagation

The OTel `context-async-hooks` package inherits limitations and bugs from the underlying `async_hooks` / `AsyncLocalStorage` implementation. In Bun, `node:async_hooks` is implemented, but some promise-hook behavior differs from Node.

In particular, Bun documents that while `AsyncLocalStorage`/`AsyncResource` exist, some V8 promise hooks are not invoked, which can reduce compatibility for context propagation across certain async patterns.

Workarounds / guards:

- add an integration test that validates context propagation for our typical patterns:
  - `await` chains
  - timers (`setTimeout`)
  - concurrent promises (`Promise.all`)
- if context propagation is incomplete in Bun for a given pattern:
  - fall back to explicit parent span passing in the hottest code paths
  - treat missing parent as acceptable (new trace) rather than throwing

### Auto-instrumentation mismatch

Node auto-instrumentations may not “see” Bun’s ingress path (`Bun.serve`). Plan for explicit/manual instrumentation for gateway requests.

## Alternatives Considered

### 1) Node SDK (`@opentelemetry/sdk-node`)

Pros:
- batteries-included defaults and integrations
- common in Node deployments

Cons in Bun:
- auto-instrumentations are heavily Node-HTTP oriented
- additional dependency weight
- still requires custom middleware for Bun ingress

### 2) Web SDK (`@opentelemetry/sdk-trace-web`)

Pros:
- fetch-friendly exporters and browser-first ergonomics

Cons:
- not a good conceptual fit for a server runtime
- context managers/instrumentations optimized for browsers, not Bun server workloads

## Next Steps

- Implement tracing bootstrap + config flags: bd-33fkz
- Add integration tests validating Bun context propagation and basic export behavior
- Add route-level middleware spans (Hono) and a minimal set of internal spans (tool runner / DB / background jobs)

## References

- Bun `node:async_hooks`: https://bun.com/reference/node/async_hooks
- OTel JS `@opentelemetry/context-async-hooks`: https://www.npmjs.com/package/@opentelemetry/context-async-hooks
- OTel JS `@opentelemetry/sdk-node`: https://open-telemetry.github.io/opentelemetry-js/modules/_opentelemetry_sdk-node.html
- OTel JS OTLP exporters:
  - https://www.npmjs.com/package/@opentelemetry/exporter-trace-otlp-http
  - https://open-telemetry.github.io/opentelemetry-js/modules/_opentelemetry_exporter-trace-otlp-proto.html
- OTel spec (OTLP protocols + headers env vars): https://opentelemetry.io/docs/specs/otel/protocol/exporter/
