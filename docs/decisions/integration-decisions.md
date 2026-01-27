# ADR: Integration Decisions + Data Source Precedence

**Decision ID**: bd-49h4
**Author**: TealReef
**Date**: 2026-01-27
**Status**: Decided

## Context

The Flywheel Gateway integrates multiple tools (DCG, SLB, UBS, br, bv, NTM, CASS, CM, RU, Agent Mail) to provide a unified interface for multi-agent orchestration. This ADR documents the key integration decisions and establishes the data source precedence rules.

## Decision Summary

### 1. Tool Integration Tiers

Tools are integrated in phases based on criticality:

| Tier | Tools | Phase | Rationale |
|------|-------|-------|-----------|
| **Critical** | DCG, SLB, UBS | 0 | Safety guardrails must be installed first |
| **Core** | Claude, br | 1 | Agent and issue tracking are foundational |
| **Recommended** | bv, NTM, CASS, CM | 2 | Enhance orchestration and coordination |
| **Optional** | RU, APR, JFP, MS, PT | 3 | Additional tooling for specific workflows |

### 2. Data Source Precedence

When multiple data sources provide overlapping information, the following precedence applies:

```
NTM → Direct CLI Clients → Fallback Defaults
```

| Data Type | Primary Source | Fallback Source | Rationale |
|-----------|---------------|-----------------|-----------|
| **Session State** | NTM (--robot-snapshot) | Gateway database | NTM is source of truth for tmux sessions |
| **Agent Health** | NTM (--robot-health) | Direct CLI check | NTM provides unified health across sessions |
| **Bead Status** | br CLI (via client) | Empty state | br is authoritative for issue tracking |
| **Bead Triage** | bv CLI (via client) | Empty recommendations | bv provides graph-aware prioritization |
| **Tool Health** | Direct CLI (--version) | Registry fallback | Direct verification is most accurate |
| **Agent Mail** | MCP server + files | Empty inbox | MCP server is authoritative |
| **Safety Posture** | Combined (DCG+SLB+UBS) | Unhealthy default | All three must be healthy |

### 3. Snapshot Aggregation Strategy

The system snapshot service (`snapshot.service.ts`) follows these rules:

1. **Parallel Collection**: All data sources are queried in parallel with independent timeouts
2. **Graceful Degradation**: Partial data is returned when some sources fail
3. **Fallback Values**: Each source has typed fallback structures
4. **Health Derivation**: Overall status is `min(all component statuses)`

```typescript
// Health status derivation
if (any unhealthy) → status = "unhealthy"
else if (any degraded OR any unknown) → status = "degraded"
else → status = "healthy"
```

### 4. NTM vs Direct Clients

**Decision**: Use NTM as the primary orchestration layer, with direct CLI clients as fallback.

| Use Case | Approach | Rationale |
|----------|----------|-----------|
| Session discovery | NTM --robot-status | NTM manages tmux sessions |
| Agent state | NTM --robot-snapshot | Unified view of all agents |
| Bead management | br CLI directly | br is authoritative for beads |
| Safety checks | Direct CLI (dcg/slb/ubs) | Must verify actual tool state |
| Agent coordination | Agent Mail MCP | MCP server handles mailbox |

### 5. Tool Registry Strategy

**Decision**: Use ACFS manifest with built-in fallback registry.

```
ACFS Manifest (primary) → FALLBACK_REGISTRY (built-in)
```

The fallback registry contains only critical tools (DCG, SLB, UBS, br, bv) to ensure basic functionality when the manifest is unavailable.

## Consequences

### Positive

1. **Clear data ownership**: Each data type has a defined authoritative source
2. **Graceful degradation**: System remains functional when individual sources fail
3. **Phased adoption**: Tools can be integrated incrementally without blocking others
4. **Safety-first**: Critical safety tools are always checked, even in fallback mode

### Negative

1. **Multiple CLI invocations**: Some queries require calling multiple tools
2. **Stale data risk**: Parallel collection may return slightly inconsistent snapshots
3. **Complexity**: Fallback logic adds code paths to maintain

### Mitigations

1. **Caching**: 10-second TTL reduces redundant CLI calls
2. **Timeouts**: 5-second per-source timeout prevents blocking
3. **Structured errors**: All failures are logged with correlation IDs

## Related Decisions

| Bead | Title | Status |
|------|-------|--------|
| bd-htsv | Design: data source precedence (NTM vs direct clients) | CLOSED |
| bd-31kw | Decision: extend NTM robot command coverage | CLOSED |
| bd-8c8a | Write Stack Contract doc | CLOSED |
| bd-3oop | Integration completeness audit + gap closure | CLOSED |
| bd-2bfy | Coverage matrix: tools × integration planes | CLOSED |
| bd-1hac | ACFS tool registry integration | CLOSED |
| bd-284u | NTM execution plane integration | CLOSED |

## Implementation References

| Component | Location | Purpose |
|-----------|----------|---------|
| Snapshot Service | `apps/gateway/src/services/snapshot.service.ts` | Aggregates all data sources |
| Tool Registry | `apps/gateway/src/services/tool-registry.service.ts` | Loads manifest with fallback |
| Safety Service | `apps/gateway/src/services/safety.service.ts` | Checks DCG/SLB/UBS status |
| NTM Services | `apps/gateway/src/services/ntm-*.ts` | NTM ingest and WebSocket bridge |
| Coverage Matrix | `docs/coverage-matrix.md` | Tool × integration plane mapping |
| Stack Contract | `docs/architecture.md` | Component boundaries |

## Appendix: Fallback Structure Examples

### NTM Fallback
```typescript
{
  capturedAt: timestamp,
  available: false,
  sessions: [],
  summary: { totalSessions: 0, totalAgents: 0, ... },
  alerts: []
}
```

### Beads Fallback
```typescript
{
  capturedAt: timestamp,
  brAvailable: false,
  bvAvailable: false,
  statusCounts: { open: 0, closed: 0, in_progress: 0, blocked: 0 },
  ...
}
```

### Tool Health Fallback
```typescript
{
  capturedAt: timestamp,
  status: "unhealthy",
  issues: ["Tool health check failed"],
  ...
}
```

---

*ADR created as part of bd-3nam (Documentation: stack contract + integration guidance)*
