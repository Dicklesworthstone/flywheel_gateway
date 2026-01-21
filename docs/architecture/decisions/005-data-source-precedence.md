# ADR-005: Data Source Precedence for Beads, Agent Mail, and CASS

## Status

Accepted

## Context

Gateway now pulls telemetry from multiple sources:

- Direct clients (br/bv, Agent Mail MCP, cass) provide canonical domain data.
- NTM robot outputs can include overlapping signals (for example, current_bead
  or pending_mail per agent) and are increasingly used for real-time state.

Without explicit precedence, the system risks double counting, conflicting
summaries, and UI confusion when both NTM and direct clients are available.

## Decision

Define a clear precedence model:

1. **Canonical source is always the direct client for its domain.**
2. **NTM is telemetry-only for those domains and never overrides canonical
   counts or lists.**
3. **NTM may be used as a degraded fallback only when the canonical client is
   unavailable, and must be labeled as such.**

### Data Source Map

| Domain | Canonical Source | Telemetry / Fallback | Notes |
| --- | --- | --- | --- |
| Beads (issues, counts, triage) | br CLI + .beads | NTM current_bead | NTM can annotate per-agent context only. Never use for counts or lists. |
| Agent Mail (agents, reservations, messages) | Agent Mail MCP | NTM pending_mail / robot-mail | Only surface as hint when MCP is unavailable. Do not merge counts. |
| CASS (search, session history) | cass CLI | NTM (none) | No NTM substitution; if NTM adds metadata later, treat as telemetry only. |

## Rationale

- **Accuracy:** br/Agent Mail/cass are authoritative, transactional sources.
- **Consistency:** NTM samples are derived and can be stale or partial.
- **Clarity:** UI can display NTM as real-time hints without confusing it with
  canonical counts and lists.
- **Resilience:** If a canonical source is down, the system can still present
  partial telemetry without mislabeling it as authoritative.

## Consequences

### Positive

- Eliminates double counting and conflicting summaries.
- Clarifies what to trust during incidents (canonical vs telemetry).
- Enables graceful degradation with explicit provenance.

### Negative

- Some UI surfaces must show "degraded" state even when NTM has partial data.
- Requires consistent provenance labeling in API responses and logs.

## Implementation Notes

- Keep canonical sections (beads, agentMail, cass) sourced only from their
  direct clients.
- Treat NTM signals like current_bead and pending_mail as per-agent annotations
  inside the NTM section or as explicitly labeled hints.
- If a canonical client is unavailable and NTM offers partial data, expose it
  with `source: "ntm"` and `available: false` for the canonical section.
- Log mismatches between canonical counts and NTM telemetry at debug level to
  avoid alert noise but preserve auditability.

## References

- `docs/architecture/decisions/004-ntm-driver-vs-tmux.md`
- `apps/gateway/src/services/snapshot.service.ts`
- `packages/shared/src/types/snapshot.types.ts`
