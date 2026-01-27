# Coverage Matrix: Tools × Integration Planes

This document maps each tool's integration coverage across all integration planes, providing a comprehensive view of what's implemented and any gaps.

**Last Updated**: 2026-01-27
**Bead**: bd-2bfy (Coverage matrix: tools × integration planes)
**Status**: Complete

## Integration Planes

| Plane | Description |
|-------|-------------|
| **Registry** | Tool defined in ACFS manifest or FALLBACK_REGISTRY |
| **Detection** | installedCheck and verify commands configured |
| **Install** | Install spec with commands/installer defined |
| **Client Adapter** | TypeScript client wrapper in `flywheel-clients` |
| **Gateway Service** | Service layer in `apps/gateway/src/services/` |
| **API Route** | REST endpoints in `apps/gateway/src/routes/` |
| **UI Surface** | Web UI pages/components in `apps/web/` |
| **Metrics/Alerts** | Prometheus metrics and alert rules |
| **Snapshot** | Included in system snapshot aggregation |

---

## Coverage Matrix

### Safety Tools (Phase 0)

| Tool | Registry | Detection | Install | Client | Service | Route | UI | Metrics | Snapshot |
|------|----------|-----------|---------|--------|---------|-------|----|---------|---------:|
| **DCG** | ✓ | ✓ | ✓ | - | ✓ | ✓ | ✓ | ✓ | ✓ |
| **SLB** | ✓ | ✓ | ✓ | - | ✓ | ✓ | - | ✓ | ✓ |
| **UBS** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | - | ✓ | ✓ |

### Core Tools (Phase 1)

| Tool | Registry | Detection | Install | Client | Service | Route | UI | Metrics | Snapshot |
|------|----------|-----------|---------|--------|---------|-------|----|---------|---------:|
| **Claude** | ✓ | ✓ | - | - | - | - | - | - | - |
| **br** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### Recommended Tools (Phase 2)

| Tool | Registry | Detection | Install | Client | Service | Route | UI | Metrics | Snapshot |
|------|----------|-----------|---------|--------|---------|-------|----|---------|---------:|
| **bv** | ✓ | ✓ | ✓ | ✓ | ✓ | - | - | - | ✓ |
| **NTM** | - | - | - | ✓ | ✓ | - | - | - | ✓ |
| **CASS** | - | - | - | ✓ | ✓ | ✓ | - | - | - |
| **CM** | - | - | - | ✓ | ✓ | ✓ | - | - | - |

### Optional Tools (Phase 3)

| Tool | Registry | Detection | Install | Client | Service | Route | UI | Metrics | Snapshot |
|------|----------|-----------|---------|--------|---------|-------|----|---------|---------:|
| **RU** | - | - | - | - | ✓ | ✓ | ✓ | - | - |
| **APR** | - | - | - | ✓ | ✓ | - | - | - | - |
| **JFP** | - | - | - | ✓ | ✓ | - | - | - | - |
| **MS** | - | - | - | ✓ | ✓ | - | - | - | - |
| **PT** | - | - | - | ✓ | ✓ | - | - | - | - |
| **CAAM** | - | - | - | ✓ | - | - | - | - | - |
| **Agent Mail** | - | - | - | ✓ | ✓ | ✓ | - | - | ✓ |

---

## Detailed Tool Integration

### DCG (Destructive Command Guard)

| Plane | Status | Details |
|-------|--------|---------|
| Registry | ✓ | `tools.dcg` in FALLBACK_REGISTRY |
| Detection | ✓ | `dcg --version`, `command -v dcg` |
| Install | ✓ | curl install script |
| Client Adapter | - | Uses direct CLI via service |
| Gateway Service | ✓ | `dcg.service.ts`, `dcg-cli.service.ts`, `dcg-config.service.ts`, `dcg-pending.service.ts`, `dcg-ru-integration.service.ts`, `dcg-stats.service.ts` |
| API Route | ✓ | `/dcg/*` endpoints in `dcg.ts` |
| UI Surface | ✓ | `/dcg` page in `DCG.tsx` |
| Metrics/Alerts | ✓ | DCG alert rules in `alerts.ts:1167` |
| Snapshot | ✓ | Safety posture check in `snapshot.service.ts` |

### SLB (Simultaneous Launch Button)

| Plane | Status | Details |
|-------|--------|---------|
| Registry | ✓ | `tools.slb` in FALLBACK_REGISTRY |
| Detection | ✓ | `slb --version`, `command -v slb` |
| Install | ✓ | `go install github.com/Dicklesworthstone/slb@latest` |
| Client Adapter | - | Uses direct CLI via service |
| Gateway Service | ✓ | `slb.service.ts` |
| API Route | ✓ | `/slb/*` endpoints in `slb.ts` |
| UI Surface | - | No dedicated page |
| Metrics/Alerts | ✓ | SLB alert rules in `alerts.ts` |
| Snapshot | ✓ | Safety posture check in `snapshot.service.ts` |

### UBS (Ultimate Bug Scanner)

| Plane | Status | Details |
|-------|--------|---------|
| Registry | ✓ | `tools.ubs` in FALLBACK_REGISTRY |
| Detection | ✓ | `ubs --version`, `command -v ubs` |
| Install | ✓ | `cargo install ubs` |
| Client Adapter | ✓ | `flywheel-clients/src/scanner/` |
| Gateway Service | ✓ | `ubs.service.ts` |
| API Route | ✓ | `/scanner/*` endpoints in `scanner.ts` |
| UI Surface | - | No dedicated page |
| Metrics/Alerts | ✓ | UBS alert rules in `alerts.ts:1184-1201` |
| Snapshot | ✓ | Safety posture check in `snapshot.service.ts` |

### br (Beads Rust)

| Plane | Status | Details |
|-------|--------|---------|
| Registry | ✓ | `tools.br` in FALLBACK_REGISTRY |
| Detection | ✓ | `br --version`, `command -v br` |
| Install | ✓ | curl install script |
| Client Adapter | ✓ | `flywheel-clients/src/br/` |
| Gateway Service | ✓ | `beads.service.ts`, `br.service.ts` |
| API Route | ✓ | `/beads/*` endpoints in `beads.ts` |
| UI Surface | ✓ | `/beads` page in `Beads.tsx` |
| Metrics/Alerts | ✓ | Bead velocity metrics |
| Snapshot | ✓ | Beads snapshot in `snapshot.service.ts` |

### bv (Beads Visualizer/Triage)

| Plane | Status | Details |
|-------|--------|---------|
| Registry | ✓ | `tools.bv` in FALLBACK_REGISTRY |
| Detection | ✓ | `bv --version`, `command -v bv` |
| Install | ✓ | curl install script |
| Client Adapter | ✓ | `flywheel-clients/src/bv/` |
| Gateway Service | ✓ | `bv.service.ts` |
| API Route | - | Uses beads routes |
| UI Surface | - | Uses beads UI |
| Metrics/Alerts | - | Not implemented |
| Snapshot | ✓ | Included in beads snapshot |

### NTM (Named Tmux Manager)

| Plane | Status | Details |
|-------|--------|---------|
| Registry | - | Not in manifest (recommended for addition) |
| Detection | - | Not implemented |
| Install | - | Not implemented |
| Client Adapter | ✓ | `flywheel-clients/src/ntm/` |
| Gateway Service | ✓ | `ntm-ingest.service.ts`, `ntm-ws-bridge.service.ts` |
| API Route | - | Uses WebSocket bridge |
| UI Surface | - | No dedicated page |
| Metrics/Alerts | - | Not implemented |
| Snapshot | ✓ | NTM snapshot in `snapshot.service.ts` |

### CASS (Cross-Agent Search System)

| Plane | Status | Details |
|-------|--------|---------|
| Registry | - | Not in manifest (recommended for addition) |
| Detection | - | Not implemented |
| Install | - | Not implemented |
| Client Adapter | ✓ | `flywheel-clients/src/cass/` |
| Gateway Service | ✓ | `cass.service.ts` |
| API Route | ✓ | `/cass/*` endpoints in `cass.ts` |
| UI Surface | - | No dedicated page |
| Metrics/Alerts | - | Not implemented |
| Snapshot | - | Not included |

### CM (CASS Memory)

| Plane | Status | Details |
|-------|--------|---------|
| Registry | - | Not in manifest (recommended for addition) |
| Detection | - | Not implemented |
| Install | - | Not implemented |
| Client Adapter | ✓ | `flywheel-clients/src/cm/` |
| Gateway Service | ✓ | `cm.service.ts` |
| API Route | ✓ | `/memory/*` endpoints in `memory.ts` |
| UI Surface | - | No dedicated page |
| Metrics/Alerts | - | Not implemented |
| Snapshot | - | Not included |

### RU (Repo Updater)

| Plane | Status | Details |
|-------|--------|---------|
| Registry | - | Not in manifest |
| Detection | - | Not implemented |
| Install | - | Not implemented |
| Client Adapter | - | Not implemented |
| Gateway Service | ✓ | `ru-fleet.service.ts`, `ru-sweep.service.ts`, `ru-sync.service.ts`, `ru-events.ts` |
| API Route | ✓ | `/ru/*` endpoints in `ru.ts` |
| UI Surface | ✓ | `/fleet` page in `Fleet.tsx` |
| Metrics/Alerts | - | Not implemented |
| Snapshot | - | Not included |

### Agent Mail

| Plane | Status | Details |
|-------|--------|---------|
| Registry | - | Not in manifest (MCP-based) |
| Detection | - | N/A (MCP server) |
| Install | - | N/A (MCP server) |
| Client Adapter | ✓ | `flywheel-clients/src/agentmail/` |
| Gateway Service | ✓ | `agentmail.ts`, `mail-events.ts`, `mcp-agentmail.ts`, `reservation.service.ts` |
| API Route | ✓ | `/mail/*`, `/reservations/*` endpoints |
| UI Surface | - | WebSocket-based |
| Metrics/Alerts | - | Not implemented |
| Snapshot | ✓ | Agent Mail snapshot in `snapshot.service.ts` |

---

## Gap Analysis

### Registry Gaps (Need ACFS Manifest Addition)

| Tool | Priority | Rationale |
|------|----------|-----------|
| NTM | High | Deep integration via services/WebSocket |
| CASS | Medium | Session search functionality |
| CM | Medium | Procedural memory system |
| RU | Low | Fleet management (optional) |

### Client Adapter Gaps

| Tool | Priority | Rationale |
|------|----------|-----------|
| DCG | Low | Direct CLI sufficient for current use |
| SLB | Low | Direct CLI sufficient for current use |
| RU | Medium | Would benefit from CLI runner pattern |

### UI Surface Gaps

| Tool | Priority | Rationale |
|------|----------|-----------|
| SLB | Low | Can be integrated into DCG page |
| UBS | Low | Can be integrated into safety page |
| NTM | Medium | Session management UI |
| CASS | Low | Search functionality |

### Snapshot Gaps

| Tool | Priority | Rationale |
|------|----------|-----------|
| CASS | Low | Add session search status |
| CM | Low | Add memory system status |
| RU | Medium | Add fleet status summary |

---

## Related Beads

| Bead ID | Title | Status | Relation |
|---------|-------|--------|----------|
| bd-2bfy | Coverage matrix (this doc) | Complete | Primary |
| bd-12cw | Gap closure pass | Blocked | Depends on this |
| bd-3g1y | Plan validation | Blocked | Depends on this |
| bd-1hac | ACFS tool registry integration | Closed | Blocker |
| bd-27xr | Beads standardization | Closed | Blocker |
| bd-284u | NTM execution plane | Closed | Blocker |
| bd-2p50 | Tool adapter layer | Closed | Blocker |
| bd-2p3h | Safety + updates integration | Closed | Blocker |
| bd-uipx | Unified system snapshot | Closed | Blocker |

---

## Methodology

1. Enumerated tools from FALLBACK_REGISTRY in `tool-registry.service.ts`
2. Cross-referenced with `flywheel-clients/src/` for client adapters
3. Audited `apps/gateway/src/services/` for service implementations
4. Audited `apps/gateway/src/routes/` for API endpoints
5. Checked `apps/web/src/pages/` for UI surfaces
6. Reviewed `alerts.ts` and `metrics.ts` for observability
7. Checked `snapshot.service.ts` for snapshot inclusion
8. Referenced `acfs-manifest-gap-audit.md` for registry recommendations

## Conclusion

The Flywheel Gateway has comprehensive integration coverage for **safety-critical tools** (DCG, SLB, UBS) and **core tools** (br, bv). The main gaps are:

1. **Registry gaps**: NTM, CASS, CM should be added to ACFS manifest
2. **UI gaps**: SLB, UBS, NTM lack dedicated UI pages (can use existing pages)
3. **Snapshot gaps**: CASS, CM, RU not included in system snapshot

These gaps are tracked in bd-12cw (Gap closure pass) for resolution.
