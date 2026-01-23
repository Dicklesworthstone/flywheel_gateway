# Setup/Install UX Completeness Audit

**Audit ID**: bd-1p5i
**Auditor**: PearlPond
**Date**: 2026-01-23
**Status**: Complete

## Overview

This document audits the end-to-end user journey through the setup/install flow:
`Setup → Detection → Install → Readiness → Dashboard`

## User Journey Flow

### Phase 1: Detection (Automatic)

| Step | Component | API Call | UX Status |
|------|-----------|----------|-----------|
| 1. User accesses `/setup` | `SetupPage` mounts | - | OK |
| 2. Auto-detect CLIs | `useReadiness()` hook | `GET /setup/readiness` | OK |
| 3. Display readiness score | `ReadinessScore` | - | OK |
| 4. Show agent/tool counts | `DetectStepContent` | - | OK |
| 5. Display auth status | `ToolCard` badges | - | OK |
| 6. List recommendations | `RecommendationsPanel` | - | OK |
| 7. Continue to Install | Tab navigation | - | OK |

**Detection Output**:
- CLI presence via `which <tool>`
- Version via `<tool> --version`
- Auth check via tool-specific command
- Capabilities probe (streaming, vision, etc.)

### Phase 2: Installation (Interactive)

| Step | Component | API Call | UX Status |
|------|-----------|----------|-----------|
| 1. Filter missing tools | `InstallStepContent` | - | OK |
| 2. Sort by install phase | Phase ordering | - | OK |
| 3. Show already installed | Separate section | - | OK |
| 4. Click "Install" button | `ToolCard` | - | OK |
| 5. Confirmation modal | `ConfirmModal` | - | OK |
| 6. Execute installation | Progress state | `POST /setup/install` | **GAP** |
| 7. Show progress feedback | - | - | **MISSING** |
| 8. Verify post-install | Auto-verify | - | OK |

**Installation Output**:
- Success: `{ tool, success: true, version, path, durationMs }`
- Failure: `{ tool, success: false, error: "..." }`

### Phase 3: Verification (Final)

| Step | Component | API Call | UX Status |
|------|-----------|----------|-----------|
| 1. Re-verify all CLIs | Button | `POST /setup/verify/:name` | OK |
| 2. Show success state | `VerifyStepContent` | - | OK |
| 3. Show failure state | Alert banner | - | OK |
| 4. Link to Dashboard | Button | - | OK |
| 5. Link to docs | Button | - | OK |

## Error State Coverage

### Detection Errors

| Scenario | Backend Response | Frontend UX | Status |
|----------|------------------|-------------|--------|
| CLI not in PATH | `available: false` | Red icon, "Not installed" | OK |
| CLI exits non-zero | `available: false` | Same as not installed | OK |
| Auth check fails | `authenticated: false, authError: "..."` | Yellow badge | OK |
| Detection timeout (30s+) | Treated as unavailable | Skeleton → absent | OK |
| Registry manifest missing | Uses fallback | Warning logged | OK |

### Installation Errors

| Scenario | Backend Response | Frontend UX | Status |
|----------|------------------|-------------|--------|
| No install command | Error 400: `NO_INSTALL_AVAILABLE` | Error toast | OK |
| Install script fails | `success: false, error: "..."` | Error display | OK |
| Verification fails post-install | `success: false, error: "not found"` | Warning | OK |
| Tool already installed | `success: true` (idempotent) | No-op | OK |
| Network timeout | Error 500 | Generic error | **BASIC** |

### Readiness Edge Cases

| Scenario | Ready Status | Recommendation | Status |
|----------|--------------|----------------|--------|
| 0 agents detected | `ready: false` | "Install at least one agent CLI" | OK |
| Required tools missing | `ready: false` | "Install required tools: dcg, br" | OK |
| Auth issues exist | `ready: false` | "Resolve authentication issues" | OK |
| All required + 1+ agent | `ready: true` | (None) | OK |

## Identified Gaps

### Gap 1: No Real-Time Installation Progress (HIGH)

**Problem**: User sees no feedback during multi-minute installations.

**Current State**:
- Backend emits progress events to logs
- `sessionId` passed to API for WebSocket correlation
- Frontend doesn't consume WebSocket stream

**Impact**: Users may think installation is stuck.

**Recommendation**: Implement WebSocket progress streaming or polling.

### Gap 2: No Batch Install UI (MEDIUM)

**Problem**: Users must install tools one-by-one.

**Current State**:
- Backend supports `POST /setup/install/batch`
- Frontend hook `useBatchInstall()` exists
- No UI exposes this functionality

**Impact**: Tedious setup for new users with multiple missing tools.

**Recommendation**: Add "Install All Missing" button with progress tracking.

### Gap 3: No Authentication Flow UI (MEDIUM)

**Problem**: Unauthenticated tools are stuck in yellow state.

**Current State**:
- `authenticated` field detected and displayed
- No "Re-authenticate" or "Configure" button

**Impact**: Users must use CLI to authenticate, breaking the GUI flow.

**Recommendation**: Add auth flow link or embedded terminal for auth commands.

### Gap 4: Cache Control Hidden (LOW)

**Problem**: Force refresh only available via API.

**Current State**:
- `DELETE /setup/cache` endpoint exists
- No UI button to trigger it

**Impact**: Debugging difficult when detection is stale.

**Recommendation**: Add "Force Re-detect" option (advanced section).

### Gap 5: No Installation History (LOW)

**Problem**: No record of past installation attempts.

**Current State**:
- Installations are fire-and-forget
- No backend logging of outcomes

**Impact**: "Why did my last install fail?" is unanswerable.

**Recommendation**: Add installation log with timestamps and outcomes.

## Component Inventory

### Frontend (apps/web)

| File | Purpose | Lines |
|------|---------|-------|
| `src/pages/Setup.tsx` | Main wizard component | 1,169 |
| `src/hooks/useSetup.ts` | API integration hooks | 525 |
| `src/router.tsx` | Route: `/setup` → SetupPage | - |

### Backend (apps/gateway)

| File | Purpose | Lines |
|------|---------|-------|
| `src/routes/setup.ts` | REST endpoints | 397 |
| `src/services/setup.service.ts` | Business logic | 775 |
| `src/services/agent-detection.service.ts` | CLI detection | ~980 |
| `src/services/tool-registry.service.ts` | Registry management | ~837 |

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/setup/readiness` | GET | Check system readiness |
| `/setup/tools` | GET | List all known tools |
| `/setup/tools/:name` | GET | Get specific tool info |
| `/setup/install` | POST | Install single tool |
| `/setup/install/batch` | POST | Install multiple tools |
| `/setup/verify/:name` | POST | Force verify tool |
| `/setup/cache` | DELETE | Clear detection cache |
| `/setup/registry/cache` | DELETE | Clear registry cache |
| `/setup/registry/refresh` | POST | Reload registry manifest |

## Readiness Criteria

The system is "ready" when ALL of the following are true:

1. No missing required tools (`dcg`, `br`)
2. At least 1 agent CLI available (`claude`, `codex`, `gemini`, etc.)
3. No authentication issues

## Supported Tools

### Agents (at least 1 required)
- `claude` - Claude Code CLI
- `codex` - OpenAI Codex CLI
- `gemini` - Google Gemini CLI
- `aider` - Aider CLI
- `gh-copilot` - GitHub Copilot CLI

### Tools
- `dcg` - DCG safety tool (required)
- `br` - Beads issue tracker (required)
- `bv` - Graph-aware triage (recommended)
- `ubs` - Bug scanner (recommended)
- `cass` - Session archaeology (optional)
- `cm` - CASS Memory (optional)
- `ru` - Repo utility (optional)

## Test Coverage

| Test File | Coverage |
|-----------|----------|
| `setup.routes.test.ts` | Route contracts (fast tests) |
| `setup-readiness.test.ts` | Integration harness (23 tests) |

Note: Readiness tests with real CLI detection skipped by default (30-60s timeouts).
Enable with `RUN_SLOW_TESTS=1`.

## Conclusion

The setup/install UX flow is **substantially complete**:

- **Strengths**:
  - Clear 3-step wizard progression
  - Good error state handling
  - Proper categorization (required/recommended/optional)
  - Phase-based install ordering
  - Registry-driven extensibility

- **Gaps to Address**:
  - Real-time installation progress (HIGH priority)
  - Batch install UI (MEDIUM priority)
  - Authentication management (MEDIUM priority)

The flow is usable for production but would benefit from the identified enhancements.

---

*Audit completed as part of bd-3oop (Integration completeness audit)*
