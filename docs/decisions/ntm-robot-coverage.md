# Decision: NTM Robot Command Coverage Extension

**Decision ID**: bd-31kw
**Author**: PearlPond
**Date**: 2026-01-23
**Status**: Decided

## Context

The gateway currently integrates 8 NTM robot commands. NTM provides 60+ robot commands. This decision determines which additional commands should be integrated into the Flywheel Gateway.

## Current Integration

| Command | Status | Usage |
|---------|--------|-------|
| `--robot-status` | Integrated | Session discovery |
| `--robot-snapshot` | Integrated | Alerts + agent state |
| `--robot-health` | Integrated | Agent health checks |
| `--robot-context` | Integrated | Context usage (method exists, not exposed) |
| `--robot-files` | Integrated | File tracking (method exists, not exposed) |
| `--robot-metrics` | Integrated | Token metrics (method exists, not exposed) |
| `--robot-tail` | Integrated | Output streaming |
| `--robot-is-working` | Integrated | Work detection |

## Candidate Commands

### Tier 1: INCLUDE (High Value)

| Command | Rationale |
|---------|-----------|
| `--robot-plan` | Exposes bv execution plan with parallelizable tracks; critical for multi-agent coordination |
| `--robot-triage` | Provides bv triage analysis with recommendations, quick wins, blockers; essential for agent work assignment |
| `--robot-dashboard` | Token-efficient system overview in markdown; valuable for LLM context consumption |
| `--robot-terse` | Minimal-token state line; efficient for frequent polling/monitoring |
| `--robot-spawn` | Create sessions with agents; enables gateway-controlled agent provisioning |
| `--robot-send` | Send messages to panes; critical for agent orchestration |
| `--robot-interrupt` | Stop agents gracefully; necessary for work management |
| `--robot-mail` | Agent Mail inbox/outbox state; coordination-critical |

### Tier 2: INCLUDE (Medium Value)

| Command | Rationale |
|---------|-----------|
| `--robot-graph` | Dependency graph insights (PageRank, critical path, cycles); useful for planning |
| `--robot-suggest` | Hygiene suggestions (duplicates, missing deps); quality improvement |
| `--robot-assign` | Work distribution recommendations; supports agent load balancing |
| `--robot-route` | Routing recommendations; useful for task distribution |
| `--robot-beads-list` | List beads with filtering; needed for bead management UI |
| `--robot-bead-show` | Show bead details; needed for bead detail view |
| `--robot-alerts` | List active alerts with filtering; extends alert management |
| `--robot-diagnose` | Comprehensive health check with fix recommendations; troubleshooting |

### Tier 3: EXCLUDE (Low Priority)

| Command | Rationale |
|---------|-----------|
| `--robot-palette` | Palette commands are TUI-specific; less relevant for gateway API |
| `--robot-cass-*` | CASS integration has dedicated client; avoid duplication |
| `--robot-jfp-*` | JeffreysPrompts is separate concern; not core gateway function |
| `--robot-pipeline-*` | Pipeline orchestration is advanced feature; defer |
| `--robot-forecast` | ETA predictions are experimental; defer |
| `--robot-history` | Command history is debugging feature; low priority |
| `--robot-save/restore` | Session backup/restore is ops feature; not critical path |
| `--robot-tokens` | Token analytics can use existing metrics; redundant |
| `--robot-search` | Semantic search is experimental; defer |

### Tier 4: DO NOT INCLUDE

| Command | Rationale |
|---------|-----------|
| `--robot-account-*` | CAAM account management is separate concern |
| `--robot-dcg-status` | DCG has dedicated client |
| `--robot-quota-*` | Quota management is CAAM/caut concern |
| `--robot-switch-account` | Account switching is user-initiated |
| `--robot-label-*` | Label analysis is experimental |
| `--robot-file-*` (hotspots, relations, beads) | File analysis is advanced feature |

## Decision

### Phase 1: Core Orchestration (Immediate)

Extend NtmClient with:
- `--robot-plan` - Execution plan
- `--robot-triage` - Work triage
- `--robot-spawn` - Session creation
- `--robot-send` - Message sending
- `--robot-interrupt` - Agent interruption
- `--robot-mail` - Agent Mail state

### Phase 2: Enhanced Visibility (Next Sprint)

Add:
- `--robot-dashboard` - System overview
- `--robot-terse` - Minimal state
- `--robot-graph` - Dependency insights
- `--robot-assign` - Work distribution
- `--robot-route` - Task routing

### Phase 3: Advanced Features (Backlog)

Defer:
- `--robot-beads-*` - Bead management
- `--robot-alerts` - Alert management
- `--robot-diagnose` - Troubleshooting
- `--robot-suggest` - Hygiene suggestions

### Explicitly Excluded

Do not integrate:
- CAAM/caut commands (separate concern)
- CASS commands (separate client)
- JFP commands (separate feature)
- Pipeline commands (too complex)
- Experimental features (search, forecast, label analysis)

## Rationale

1. **Focus on orchestration**: Gateway's primary function is agent coordination, so orchestration commands take priority.

2. **Avoid duplication**: Commands that duplicate dedicated clients (CASS, DCG, CAAM) are excluded.

3. **Token efficiency**: Commands like `--robot-terse` and `--robot-dashboard` provide value for LLM-integrated workflows.

4. **Phased rollout**: Prioritize core functionality, add visibility features second, defer advanced features.

## Implementation Notes

1. Each command should have:
   - Typed interface method in NtmClient
   - Zod schema for response validation
   - Error handling with typed exceptions

2. Consider adding gateway routes for:
   - `GET /ntm/plan` → `--robot-plan`
   - `GET /ntm/triage` → `--robot-triage`
   - `POST /ntm/spawn` → `--robot-spawn`
   - `POST /ntm/send` → `--robot-send`

3. WebSocket events for:
   - Spawn progress
   - Send confirmation
   - Interrupt acknowledgment

## Related Beads

- bd-284u: NTM execution plane integration (CLOSED - provided foundation)
- bd-1khz: NTM driver vs tmux adapter decision (CLOSED - chose NTM)
- bd-12cw: Gap closure pass (blocked by this decision)

---

*Decision made as part of bd-3oop (Integration completeness audit)*
