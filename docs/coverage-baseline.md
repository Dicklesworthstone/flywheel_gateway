# Coverage Baseline Report

Generated: 2026-01-29
Command: `bun run test -- --coverage`

## Test Suite Summary

| Metric | Count |
|--------|-------|
| Total tests | 3162 |
| Passing | 2620 |
| Failing | 531 |
| Skipped | 11 |
| Errors | 139 |
| Files | 141 |
| Runtime | ~80s |

## Coverage by Directory

| Directory | Files | Avg Fn% | Avg Line% |
|-----------|-------|---------|-----------|
| apps/gateway/src/services | 65 | 63.8 | 59.9 |
| apps/gateway/src/routes | 16 | 82.1 | 66.4 |
| apps/gateway/src/models | 6 | 95.8 | 98.8 |
| apps/gateway/src/middleware | 4 | 80.3 | 73.2 |
| apps/gateway/src/ws | 5 | 78.1 | 81.8 |
| apps/gateway/src/caam | 4 | 70.5 | 52.2 |
| apps/web/src/lib/websocket | 4 | 98.8 | 99.6 |
| packages/agent-drivers | 15 | 72.1 | 73.1 |
| packages/flywheel-clients | 16 | 73.9 | 68.8 |
| packages/shared | 37 | 88.7 | 84.8 |
| packages/test-utils | 11 | 33.7 | 39.2 |

**Total files with coverage data: 207**

## Critical Gaps: 0% Function Coverage (25 files)

### Gateway Services (critical)
- `agent-analytics.service.ts` (line 2.4%)
- `agent-health.service.ts` (line 15.7%)
- `auto-checkpoint.service.ts` (line 9.9%)
- `cass.service.ts` (line 7.3%)
- `cm.service.ts` (line 6.8%)
- `db/connection.ts` (line 65.3%)
- `utils/validation.ts` (line 1.8%)

### Agent Drivers
- `ntm/ntm-driver.ts` (line 1.4%)
- `work-detection.ts` (line 39.8%)

### Flywheel Clients
- `giil/index.ts` (line 19.3%)
- `rch/index.ts` (line 29.9%)
- `slb/index.ts` (line 35.2%)
- `xf/index.ts` (line 29.3%)

### Shared Commands (codegen)
- `codegen/client.ts` (line 0.7%)
- `codegen/trpc.ts` (line 3.4%)
- `codegen/websocket.ts` (line 2.4%)

### Test Utilities (not exercised)
- `agent.ts`, `api.ts`, `assertions.ts`, `db.ts`, `logging.ts`, `time.ts`, `ws.ts`

### E2E Infrastructure
- `tests/e2e/lib/fixtures.ts`, `tests/e2e/lib/logging.ts`

## Low Coverage (<50% line) — 28 files

| File | Fn% | Line% |
|------|-----|-------|
| approval.service.ts | 11 | 4.4 |
| update-checker.service.ts | 38 | 4.6 |
| cost-tracker.service.ts | 17 | 4.9 |
| job.service.ts | 2 | 5.5 |
| slb.service.ts | 9 | 6.5 |
| handoff.service.ts | 19 | 9.0 |
| ntm-ingest.service.ts | 8 | 9.6 |
| ubs.service.ts | 38 | 12.7 |
| caam/rotation.ts | 46 | 13.0 |
| budget.service.ts | 17 | 13.5 |
| acp-driver.ts | 23 | 13.8 |
| ntm-ws-bridge.service.ts | 32 | 16.7 |
| safety.service.ts | 43 | 19.5 |
| correlation.ts | 40 | 20.0 |
| caam/account.service.ts | 52 | 20.7 |
| health.ts (route) | 50 | 22.1 |
| dcg-config.service.ts | 40 | 22.1 |
| agentmail.ts | 25 | 27.3 |
| dashboard.service.ts | 57 | 28.3 |
| dcg.ts (route) | 48 | 36.2 |
| pipeline.service.ts | 61 | 37.3 |
| agent.ts (service) | 43 | 39.2 |
| history.service.ts | 26 | 41.2 |
| dcg-stats.service.ts | 56 | 41.6 |
| claude-driver.ts | 50 | 42.1 |
| setup.service.ts | 88 | 43.5 |
| utilities.ts (route) | 85 | 44.6 |
| performance/monitor.ts | 60 | 44.8 |

## Failing Tests — Root Causes

1. **DB schema mismatch**: Many service tests use mock DBs without running migrations (e.g., `agent-analytics`, `job.service`)
2. **Missing test harness**: Tests for services with DB deps fail with "no such table" — blocked on bd-1vr1.3 (test harness)
3. **Flywheel CLI tests**: `scripts/__tests__/flywheel.test.ts` expects 2 services but gets 1
4. **Contract tests**: Server not available during unit test run
5. **Snapshot mismatches**: 3 failed snapshots need updating

## How to Regenerate

```bash
bun test --coverage 2>&1 | python3 -c "
import sys, re
for line in sys.stdin:
    m = re.match(r'\s+(\S+\.tsx?)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|', line)
    if m:
        print(f'{m.group(1)} | fn={m.group(2)}% | ln={m.group(3)}%')
"
```

## Priority Recommendations

1. **Complete bd-1vr1.3** (test harness) — unblocks most service test fixes
2. **Fix snapshot mismatches** — quick wins
3. **Add tests for 0% services**: agent-analytics, agent-health, auto-checkpoint
4. **Cover critical paths**: agent.ts (39%), pipeline.service.ts (37%), safety.service.ts (19%)
5. **Test utility files** need actual exercising by tests (currently dead code)
