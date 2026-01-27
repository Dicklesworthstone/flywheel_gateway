# ACFS Manifest Gap Audit

**Date:** 2026-01-27
**Auditor:** TealEagle (Claude Code)
**Bead:** bd-2sx6

## Summary

Audited tools referenced in flywheel_gateway codebase versus FALLBACK_REGISTRY in `apps/gateway/src/services/tool-registry.service.ts`. Identified 9 tools that should be added to the ACFS manifest.

## Current FALLBACK_REGISTRY (4 tools)

| ID | Name | Category | Status |
|----|------|----------|--------|
| `agents.claude` | Claude Code | agent | critical |
| `tools.dcg` | DCG | tool | critical |
| `tools.br` | br (Beads) | tool | critical |
| `tools.bv` | bv | tool | recommended |

## Recommended Additions

### Critical/Required (Safety Stack)

These tools are referenced in safety posture checks (`safety.ts`, `alerts.ts`, `snapshot.service.ts`):

| ID | Name | Description | Source |
|----|------|-------------|--------|
| `tools.slb` | SLB | Simultaneous Launch Button - two-person rule for destructive commands | `routes/slb.ts`, `alerts.ts:1167` |
| `tools.ubs` | UBS | Ultimate Bug Scanner - code security scanning | `alerts.ts:1184-1201`, `safety.ts:269` |

### Recommended

| ID | Name | Description | Source |
|----|------|-------------|--------|
| `tools.ntm` | NTM | Named Tmux Manager - multi-agent orchestration | `index.ts:13-106`, `ntm-ingest.service.ts` |
| `tools.cass` | CASS | Cross-Agent Search System - session search | `cass.service.ts`, `cli-logging.ts:5` |

### Optional

| ID | Name | Description | Source |
|----|------|-------------|--------|
| `tools.cm` | cm | Cass Memory System - procedural memory | `cli-logging.ts:5`, AGENTS.md |
| `tools.ru` | RU | Repo Updater - fleet management | AGENTS.md section "RU (Repo Updater)" |
| `tools.giil` | giil | Get Image from Internet Link | AGENTS.md section "giil" |
| `tools.csctf` | csctf | Chat Shared Conversation to File | AGENTS.md section "csctf" |
| `tools.ast-grep` | ast-grep | Structural code search/rewrite | AGENTS.md section "ast-grep" |

## Checklist for ACFS Repo Maintainers

- [ ] Add `tools.slb` with `tags: ["critical", "required"]`, `phase: 0`
- [ ] Add `tools.ubs` with `tags: ["critical", "required"]`, `phase: 0`
- [ ] Add `tools.ntm` with `tags: ["recommended"]`, `phase: 2`
- [ ] Add `tools.cass` with `tags: ["recommended"]`, `phase: 2`
- [ ] Add `tools.cm` with `tags: ["optional"]`, `phase: 3`
- [ ] Add `tools.ru` with `tags: ["optional"]`, `phase: 3`
- [ ] Add `tools.giil` with `tags: ["optional"]`, `phase: 3`
- [ ] Add `tools.csctf` with `tags: ["optional"]`, `phase: 3`
- [ ] Add `tools.ast-grep` with `tags: ["optional"]`, `phase: 2`

## Tool Definition Templates

### tools.slb (Critical)
```yaml
- id: "tools.slb"
  name: "slb"
  displayName: "SLB"
  description: "Simultaneous Launch Button - two-person rule for destructive commands"
  category: "tool"
  tags: ["critical", "required"]
  optional: false
  enabledByDefault: true
  phase: 0
  docsUrl: "https://github.com/Dicklesworthstone/slb"
  verify:
    command: ["slb", "--version"]
    expectedExitCodes: [0]
  installedCheck:
    command: ["command", "-v", "slb"]
```

### tools.ubs (Critical)
```yaml
- id: "tools.ubs"
  name: "ubs"
  displayName: "UBS"
  description: "Ultimate Bug Scanner - code security scanning"
  category: "tool"
  tags: ["critical", "required"]
  optional: false
  enabledByDefault: true
  phase: 0
  docsUrl: "https://github.com/Dicklesworthstone/ubs"
  verify:
    command: ["ubs", "--version"]
    expectedExitCodes: [0]
  installedCheck:
    command: ["command", "-v", "ubs"]
```

### tools.ntm (Recommended)
```yaml
- id: "tools.ntm"
  name: "ntm"
  displayName: "NTM"
  description: "Named Tmux Manager - multi-agent orchestration"
  category: "tool"
  tags: ["recommended"]
  optional: true
  enabledByDefault: true
  phase: 2
  docsUrl: "https://github.com/Dicklesworthstone/ntm"
  verify:
    command: ["ntm", "--version"]
    expectedExitCodes: [0]
  installedCheck:
    command: ["command", "-v", "ntm"]
```

### tools.cass (Recommended)
```yaml
- id: "tools.cass"
  name: "cass"
  displayName: "CASS"
  description: "Cross-Agent Search System - session search"
  category: "tool"
  tags: ["recommended"]
  optional: true
  enabledByDefault: true
  phase: 2
  docsUrl: "https://github.com/Dicklesworthstone/cass"
  verify:
    command: ["cass", "--version"]
    expectedExitCodes: [0]
  installedCheck:
    command: ["command", "-v", "cass"]
```

## Notes

- **SLB and UBS** are part of the safety posture trio with DCG - all three are checked in `safety.ts` and `snapshot.service.ts`
- **NTM** has deep integration via `ntm-ingest.service.ts` and `ntm-ws-bridge.service.ts`
- **CASS** is initialized at startup in `index.ts:66`
- Tools in AGENTS.md but not in codebase (giil, csctf, ru, ast-grep) are documentation-only for now

## Files Audited

- `apps/gateway/src/services/tool-registry.service.ts` (FALLBACK_REGISTRY)
- `apps/gateway/src/services/alerts.ts` (safety tool checks)
- `apps/gateway/src/routes/safety.ts` (safety posture)
- `apps/gateway/src/services/snapshot.service.ts` (tool health)
- `apps/gateway/src/index.ts` (service initialization)
- `apps/gateway/src/utils/cli-logging.ts` (tool client references)
- `AGENTS.md` (tool documentation)
