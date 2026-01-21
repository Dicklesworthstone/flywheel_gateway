# ADR-004: NTM Driver vs Tmux Adapter

## Status

Accepted

## Context

Flywheel Gateway needs an execution/telemetry plane for agent orchestration. The
AgentDriver abstraction currently supports `sdk`, `acp`, and `tmux`. NTM (Named
Tmux Manager) provides:

- Structured robot JSON outputs (events, tool calls, health)
- Session lifecycle control (spawn/terminate/attach)
- Health detection and metadata beyond terminal text

Two viable integration paths were identified:

1. **Tmux adapter**: Use the existing tmux driver and treat NTM as a thin
   wrapper around tmux sessions.
2. **Dedicated NTM AgentDriver**: Implement a new driver that speaks NTM
   commands/robot JSON directly and maps those events into AgentDriver
   semantics.

## Decision

Implement a **dedicated NTM AgentDriver** (new driver type `ntm`). Do not route
NTM through the tmux driver.

## Rationale

- **Structured telemetry**: NTM emits robot JSON with explicit state changes and
  tool events; the tmux driver only infers state from terminal output.
- **Accurate state mapping**: NTM provides explicit session and health state,
  which maps cleanly onto `AgentEvent` and `AgentState` without heuristics.
- **Capability alignment**: A dedicated driver can advertise
  `structuredEvents`, `toolCalls`, and `checkpoint` (if available) rather than
  under-reporting due to tmux limitations.
- **Backpressure and quotas**: NTM can enforce concurrency and lifecycle
  controls that a tmux adapter would bypass.
- **Evolvability**: Keeping NTM integration separate avoids coupling NTM
  protocol changes to tmux-specific behaviors.

## Consequences

### Positive

- Rich event stream for WebSocket and UI features
- Cleaner mapping to AgentDriver interface and driver registry selection
- Easier future interoperability with ACP-style structured events

### Negative

- New driver type and configuration surface area
- More implementation effort than reusing the tmux driver

### Mitigation

- Keep tmux driver as a fallback for visual/terminal workflows
- Implement NTM driver in phases: spawn/terminate, output ingestion, structured
  events, checkpoint support

## Implementation Notes

- Add `ntm` to `AgentDriverType` and register it in the driver registry.
- Define `NtmDriverOptions` (binary path, data dir, timeouts).
- Map NTM robot events to `AgentEvent` and `AgentState`.
- Support `terminalAttach` capability via `ntm attach` (or direct tmux attach
  where appropriate).

## References

- `reference/ntm/` (protocol examples)
- `packages/agent-drivers/src/tmux` (current tmux fallback)
