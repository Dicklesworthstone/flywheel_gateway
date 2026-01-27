# Tooling Delta Audit v2

**Date:** 2026-01-27
**Auditor:** MistyRaven (Claude Code Opus 4.5)
**Bead:** bd-2n73.1
**Source:** ACFS manifest v2 + /dp tool repos survey

## Executive Summary

Audited 183 repos in /dp against Flywheel Gateway integration points. Identified:
- **16 core CLI tools** with robot/JSON output modes
- **13 existing flywheel-client** wrappers
- **6 tools in FALLBACK_REGISTRY** (tool-registry.service.ts)
- **Key gaps:** xf, giil, csctf, toon, wa, rch need gateway integration

## Gateway Integration Points

| Integration Layer | Location | Tools Covered |
|-------------------|----------|---------------|
| **FALLBACK_REGISTRY** | `apps/gateway/src/services/tool-registry.service.ts` | claude, dcg, slb, ubs, br, bv |
| **flywheel-clients** | `packages/flywheel-clients/src/` | agentmail, apr, br, bv, cass, caam, cm, jfp, ms, ntm, pt, ru, scanner |
| **Services** | `apps/gateway/src/services/` | cass, ntm, agentmail (deep integration) |
| **Routes** | `apps/gateway/src/routes/` | dcg, slb, audit, cost-analytics, fleet |

## Tool Matrix

### Core Safety Stack (Phase 0)

| Tool | CLI | Robot Mode | MCP | flywheel-client | FALLBACK_REGISTRY | Notes |
|------|-----|------------|-----|-----------------|-------------------|-------|
| **dcg** | `/dp/destructive_command_guard` (Rust) | `--format json` | ❌ | ❌ | ✅ | Blocking hooks |
| **slb** | `/dp/slb` (Go) | `--json`, `--jsonl` | ❌ | ❌ | ✅ | Two-person rule |
| **ubs** | `/dp/ultimate_bug_scanner` (Rust) | `--format json/jsonl/sarif` | ❌ | ❌ | ✅ | Static analysis |

### Issue Tracking (Phase 1)

| Tool | CLI | Robot Mode | MCP | flywheel-client | FALLBACK_REGISTRY | Notes |
|------|-----|------------|-----|-----------------|-------------------|-------|
| **br** | `/dp/beads_rust` (Rust) | `--json` | ❌ | ✅ | ✅ | Issue tracker |
| **bv** | `/dp/beads_viewer` (Go) | `--robot-*` | ❌ | ✅ | ✅ | Graph triage |

### Agent Infrastructure (Phase 2)

| Tool | CLI | Robot Mode | MCP | flywheel-client | FALLBACK_REGISTRY | Notes |
|------|-----|------------|-----|-----------------|-------------------|-------|
| **cass** | `/dp/coding_agent_session_search` (Rust) | `--robot`, `--json` | ❌ | ✅ | ❌ | Session search |
| **cm** | `/dp/cass_memory_system` | `--json` | ✅ tools/resources | ✅ | ❌ | Procedural memory |
| **ntm** | `/dp/ntm` (Go) | `--robot-*` | ❌ | ✅ | ❌ | Tmux orchestration |
| **caam** | `/dp/coding_agent_account_manager` (Go) | `robot` subcommand | ❌ | ✅ | ❌ | Account rotation |
| **agentmail** | `/dp/mcp_agent_mail` | N/A (MCP-only) | ✅ full MCP server | ✅ | ❌ | Multi-agent coordination |

### Fleet Management (Phase 3)

| Tool | CLI | Robot Mode | MCP | flywheel-client | FALLBACK_REGISTRY | Notes |
|------|-----|------------|-----|-----------------|-------------------|-------|
| **ru** | `/dp/repo_updater` (Bash) | `--json` | ❌ | ✅ | ❌ | Fleet sync |
| **ms** | (mail-sync) | `--json` | ❌ | ✅ | ❌ | Mail synchronization |
| **pt** | (process triage) | `--json` | ❌ | ✅ | ❌ | Process management |
| **apr** | (alert processor) | `--json` | ❌ | ✅ | ❌ | Alert handling |
| **jfp** | (job file processor) | `--json` | ❌ | ✅ | ❌ | Job processing |
| **scanner** | (codebase scanner) | `--json` | ❌ | ✅ | ❌ | Code analysis |

### GAP: Missing Gateway Integration

| Tool | CLI Repo | Robot Mode | MCP | Description | Priority |
|------|----------|------------|-----|-------------|----------|
| **xf** | `/dp/je_twitter_data` (Rust) | `--format json/jsonl/csv` | ❌ | X archive search | P3 (optional) |
| **giil** | `/dp/giil` | `--json`, `--base64` | ❌ | Image from cloud links | P3 (optional) |
| **csctf** | `/dp/chat_shared_conversation_to_file` | `--md-only` | ❌ | Chat transcript export | P3 (optional) |
| **toon** | `/dp/toon_rust` (Rust) | TOON format output | ❌ | Structured output format | P2 (emerging standard) |
| **wa** | (unknown repo) | `--json` | ❌ | Listed in matrix | P2 |
| **rch** | `/dp/remote_compilation_helper` | `--json` | ❌ | Remote compilation | P2 |

## Action Items

### High Priority (bd-2n73.2 - bd-2n73.5)

1. **Add to FALLBACK_REGISTRY** (tool-registry.service.ts):
   - `tools.cass` - session search
   - `tools.cm` - memory system
   - `tools.ntm` - tmux orchestration
   - `tools.caam` - account manager
   - `tools.ru` - fleet sync
   - `tools.agentmail` - MCP coordination server

2. **Create flywheel-clients** for missing tools:
   - `xf/` - X archive search client
   - `giil/` - Image download client
   - `csctf/` - Transcript export client
   - `toon/` - TOON format parser
   - `rch/` - Remote compilation client
   - `wa/` - (investigate what this is)
   - `dcg/` - DCG client (blocking integration)
   - `slb/` - SLB client (approval workflows)
   - `ubs/` - UBS client (code scanning)

### Medium Priority (bd-2n73.6 - bd-2n73.7)

3. **NTM Integration Refresh** - Update NTM client for new `--robot-*` flags
4. **Agent Mail Upgrade** - Update for new MCP tools and HTTP details

### Low Priority (Future)

5. **TOON Format Support** - Add TOON output parsing to CLI runner
6. **ast-grep Integration** - Add structural code search

## Robot Output Mode Reference

| Pattern | Tools Using It | Notes |
|---------|---------------|-------|
| `--json` | br, cm, ru, ms, pt, apr, slb, xf | Standard JSON output |
| `--robot` | cass | Robot-optimized output |
| `--robot-*` | bv, ntm | Multiple robot subcommands |
| `--format json` | dcg, ubs | Format flag |
| `--format jsonl` | ubs, xf | Streaming JSONL |
| `--format sarif` | ubs | SARIF security format |
| `robot` subcommand | caam | Subcommand-based |

## MCP Surface Summary

| Tool | MCP Type | Available Operations |
|------|----------|---------------------|
| **agentmail** | Full MCP server | 30+ tools (messages, file reservations, threads, contacts) |
| **cm** | MCP tools/resources | Context retrieval, playbook management |

## Files Audited

- `/dp/AGENT_FRIENDLY_MATRIX.json` - Tool capability matrix
- `/dp/AGENT_FRIENDLY_MATRIX.csv` - Same in CSV format
- `/dp/AGENTS.md` - Tool documentation
- `/data/projects/flywheel_gateway/apps/gateway/src/services/tool-registry.service.ts`
- `/data/projects/flywheel_gateway/packages/flywheel-clients/src/index.ts`
- `/data/projects/flywheel_gateway/docs/acfs-manifest-gap-audit.md` (prior audit)

## Blocked Tasks (Unblocked by This Audit)

- **bd-2n73.2**: ACFS manifest ingestion + tool registry sync
- **bd-2n73.3**: Tool detection vNext (manifest-driven + new CLIs)
- **bd-2n73.4**: Gateway tool registry expansion (robot/TOON/MCP metadata)
- **bd-2n73.5**: New tool service clients (ms/wa/pt/rch/giil/csctf/xf/toon/etc)
- **bd-2n73.6**: NTM integration refresh
- **bd-2n73.7**: Agent Mail integration upgrade
- **bd-2n73.12**: flywheel_private: secrets/config for new tools
