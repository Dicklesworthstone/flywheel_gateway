# ADR-008: Shutdown Coordinator + Maintenance/Drain Mode

> **Bead**: bd-32lz3
> **Status**: Accepted
> **Date**: 2026-02-01

## Context

Flywheel Gateway runs long-lived background jobs (cleanup loops, ingest pollers, WS heartbeat), hosts WebSocket connections, and executes agent sessions. We need a **predictable, operator-controlled** way to:

- Enter **maintenance mode** (block new work, keep admin visibility)
- Enter **drain mode** for graceful shutdown (stop taking work, allow in-flight work to finish)
- Provide a stable **HTTP + WS contract** so the UI/clients can respond correctly

Without a consistent shutdown/maintenance contract, the system risks:

- Partial writes and inconsistent DB state
- “Hanging” WS clients with no clear reconnect hints
- Agents stuck mid-operation with unclear termination semantics
- Ad-hoc behavior spread across services

## Decision

Introduce a single in-process coordinator responsible for shutdown/maintenance state and enforcement:

### 1) Canonical State Machine

The coordinator owns a state machine:

```
running  ── requestDrain(...) ──▶ draining ── complete/timeout ──▶ stopped
   │                               │
   └── setMaintenance(true) ───────┘  (maintenance is implied while draining)
```

Definitions:

- `running`: Normal operation.
- `draining`: Best-effort completion of in-flight work; new work is rejected.
- `stopped`: Process is exiting (or already stopped).

Maintenance is modeled as a flag (manual operator intent):

- `maintenanceEnabled`: `true` blocks new work even if `state === "running"`.
- When `state === "draining"`, `maintenanceEnabled` is treated as `true` regardless of manual setting.

### 2) Shutdown Coordinator API Surface

Proposed module location: `apps/gateway/src/services/shutdown-coordinator.service.ts`

```ts
export type ShutdownState = "running" | "draining" | "stopped";

export type ShutdownTrigger = "api" | "sigint" | "sigterm";

export type MaintenanceReason =
  | "operator"
  | "deploy"
  | "incident"
  | "dependency_outage"
  | "unknown";

export type MaintenanceSnapshot = {
  state: ShutdownState;
  maintenanceEnabled: boolean;
  reason: {
    kind: MaintenanceReason;
    detail?: string;
  } | null;
  updatedAt: string; // ISO
  draining: null | {
    trigger: ShutdownTrigger;
    startedAt: string; // ISO
    deadlineAt: string; // ISO
    timeoutMs: number;
  };
};

export interface ShutdownCoordinator {
  getSnapshot(): MaintenanceSnapshot;

  setMaintenance(input: {
    enabled: boolean;
    reason?: { kind: MaintenanceReason; detail?: string };
  }): MaintenanceSnapshot;

  requestDrain(input: {
    trigger: ShutdownTrigger;
    timeoutMs?: number; // default from config
    reason?: { kind: MaintenanceReason; detail?: string };
  }): Promise<MaintenanceSnapshot>;
}
```

Notes:

- `requestDrain(...)` is idempotent. If already draining, it returns the existing `draining` snapshot.
- No new long-lived loops are introduced; the coordinator is event-driven and used by existing loops to decide whether to continue.
- Structured logging must include state transitions and deadlines (via existing `logger` / correlation middleware).

### 3) HTTP Maintenance Guard

Add an HTTP guard middleware with clear semantics:

```ts
export type MaintenanceGuardDecision =
  | { allow: true }
  | { allow: false; code: "MAINTENANCE_MODE" | "DRAINING"; retryAfterMs?: number };

export function maintenanceGuardForRequest(req: Request): MaintenanceGuardDecision;
```

Policy:

- If `maintenanceEnabled === true` and request is not an allowlisted path → reject with `MAINTENANCE_MODE` (503).
- If `state === "draining"` and request is not allowlisted → reject with `DRAINING` (503).

Allowlist guidance (minimal operator access remains available):

- `GET /health`
- `GET /system/maintenance` (admin)
- `GET /system/snapshot` (admin)

Error envelope must use the canonical response wrapper (`sendError`) with:

- `code`: `"MAINTENANCE_MODE"` or `"DRAINING"`
- `status`: `503`
- optional `Retry-After` header when `retryAfterMs` is known

### 4) WebSocket Behavior

WS behavior must be deterministic so the dashboard can react instantly.

#### Channel + Event

Add a system channel:

- `system:maintenance`

Broadcast message on any maintenance/drain transition:

```json
{
  "type": "system:maintenance",
  "data": {
    "state": "running|draining|stopped",
    "maintenanceEnabled": true,
    "reason": { "kind": "deploy", "detail": "Rolling restart" },
    "updatedAt": "2026-02-01T18:00:00.000Z",
    "draining": { "deadlineAt": "2026-02-01T18:01:00.000Z" }
  }
}
```

#### Close Semantics

When entering `draining`, the server:

1. Broadcasts `system:maintenance` to all WS clients.
2. Begins closing existing WS connections after a short grace window (e.g. 250–1000ms).

Close code mapping (documented constants):

- `1012` (“Service Restart”) when `state` transitions to `draining` (clients should reconnect).
- `1013` (“Try Again Later”) when `maintenanceEnabled` is toggled `true` while `state === "running"` (optional; if we decide to keep existing sockets open, only enforce via HTTP guard).

Close reason should be short and stable:

- `"draining"` or `"maintenance"`

Reconnect hints:

- If we know `deadlineAt`, clients can use `retryAfterMs = max(0, deadlineAt - now)` from the event payload.

### 5) Route Spec (API Contract)

Implementation location: `apps/gateway/src/routes/system.ts` (admin-only under existing `requireAdminMiddleware()`).

#### `GET /system/maintenance`

Response (wrapped via `sendResource(c, "maintenance", ...)`):

```json
{
  "object": "maintenance",
  "data": {
    "state": "running|draining|stopped",
    "maintenanceEnabled": true,
    "reason": { "kind": "deploy", "detail": "Rolling restart" },
    "updatedAt": "2026-02-01T18:00:00.000Z",
    "draining": {
      "trigger": "sigterm",
      "startedAt": "2026-02-01T18:00:00.000Z",
      "deadlineAt": "2026-02-01T18:01:00.000Z",
      "timeoutMs": 60000
    }
  },
  "requestId": "corr_..."
}
```

#### `POST /system/maintenance`

Request body:

```ts
type MaintenanceCommand =
  | { action: "set_maintenance"; enabled: boolean; reason?: { kind: MaintenanceReason; detail?: string } }
  | { action: "start_draining"; timeoutMs?: number; reason?: { kind: MaintenanceReason; detail?: string } };
```

Behavior:

- `set_maintenance` updates only the maintenance flag (no shutdown).
- `start_draining` transitions to `draining` and initiates drain hooks; returns snapshot immediately (and the WS event broadcasts).

Response: same shape as `GET /system/maintenance`.

### 6) Error Codes

Add canonical error codes to `packages/shared/src/errors/codes.ts`:

- `MAINTENANCE_MODE` → `503`
- `DRAINING` → `503`

These should be treated similarly to `SYSTEM_UNAVAILABLE` but with more actionable meaning for clients.

## Test Plan Notes

Implementation beads should lift this directly.

### Unit

- `ShutdownCoordinator` state transitions:
  - `running → draining` (idempotent)
  - `maintenanceEnabled` toggling
  - deadline calculation (`deadlineAt`)
- `maintenanceGuardForRequest` allowlist and decisions
- WS close code selection logic (pure function)

### Integration

- HTTP:
  - `GET /system/maintenance` returns stable shape
  - `POST /system/maintenance` starts draining and blocks non-allowlisted endpoints with `503` + correct error code
  - verify `Retry-After` behavior when applicable
- WebSocket:
  - subscribing clients receive `system:maintenance` broadcast on transition
  - on drain: clients closed with code `1012` and reason `draining`

### E2E (Playwright)

- UI shows a maintenance/draining banner after receiving `system:maintenance`.
- Attempting blocked actions yields a friendly error path (503 → banner/retry UX).

## Consequences

### Positive

- Single source of truth for maintenance/drain state
- Clear behavior for HTTP and WS clients (less UI guesswork)
- Predictable operator workflows (API + signals)

### Negative / Trade-offs

- Requires touchpoints across HTTP middleware, WS hub, and background jobs to honor drain state.
- Must be careful to keep allowlist minimal to avoid “accidental bypass.”

## Related Beads

- **bd-32lz3**: This ADR (design + contract)
- **bd-9mcg1**: Implement HTTP maintenance guard + status endpoints
- **bd-ws55y**: Implement WS drain + maintenance broadcast
- **bd-1prjp**: Wire SIGINT/SIGTERM to drain background jobs + exit

