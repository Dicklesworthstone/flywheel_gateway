# Risk Mitigation Runbooks

This directory contains operational runbooks for handling high-impact risk scenarios in Flywheel Gateway.

## Quick Reference

| Risk | Impact | Runbook | Primary Mitigation |
|------|--------|---------|-------------------|
| Agent Runaway | High | [agent-runaway.md](./agent-runaway.md) | Token limits, DCG |
| Account Quota Exhaustion | High | [quota-exhaustion.md](./quota-exhaustion.md) | CAAM rotation |
| Daemon Failure | High | [daemon-recovery.md](./daemon-recovery.md) | Supervisor auto-restart |
| Data Loss | Critical | [data-recovery.md](./data-recovery.md) | WAL + Git backup |
| Security Breach | Critical | [security-incident.md](./security-incident.md) | DCG + encryption |
| Provider Outage | High | [provider-failover.md](./provider-failover.md) | Multi-provider fallback |
| Cost Overruns | High | [cost-controls.md](./cost-controls.md) | Cost analytics + alerts |

## When to Use These Runbooks

1. **During incidents** - Follow the relevant runbook step-by-step
2. **During on-call** - Review before shift to refresh knowledge
3. **During planning** - Reference when designing new features
4. **During review** - Verify mitigations still apply

## Risk Matrix Summary

```
             │ Low Impact │ Medium Impact │ High Impact │ Critical │
─────────────┼────────────┼───────────────┼─────────────┼──────────┤
Low          │            │               │ Daemon      │ Data Loss│
Likelihood   │            │               │ Failure     │ Security │
─────────────┼────────────┼───────────────┼─────────────┼──────────┤
Medium       │ Notif.     │ File Conflict │ Agent       │          │
Likelihood   │ Fatigue    │ Network Int.  │ Runaway     │          │
             │            │ Handoff Fail  │ Perf. Degrad│          │
─────────────┼────────────┼───────────────┼─────────────┼──────────┤
High         │            │ Context       │ Account     │          │
Likelihood   │            │ Overflow      │ Quota       │          │
             │            │               │ Cost Overrun│          │
```

## Testing Mitigations

All mitigations are verified by tests in:
- `apps/gateway/src/__tests__/risk-mitigations.test.ts` - Core verification tests (40 tests)
- Individual service tests for each mitigation system

Run verification tests:
```bash
bun test apps/gateway/src/__tests__/risk-mitigations.test.ts
```

## Mitigation Owners

| Mitigation | Primary Bead | Tests |
|------------|--------------|-------|
| Token Limits | flywheel_gateway-398 | agent-state-machine.test.ts |
| CAAM Rotation | flywheel_gateway-41h | caam.test.ts |
| File Reservations | flywheel_gateway-5nm | reservation.service.test.ts |
| Context Health | flywheel_gateway-ew1 | context-health.service.test.ts |
| Handoff Protocol | flywheel_gateway-2pl | handoff.service.test.ts |
| Delta Checkpoints | flywheel_gateway-36m | checkpoint.test.ts |
| WebSocket Durability | flywheel_gateway-46c | agent-ws.test.ts |
| Supervisor | flywheel_gateway-76h | supervisor.service.test.ts |
| Security Headers | flywheel_gateway-bz1 | security-headers.middleware.test.ts |
| DCG | flywheel_gateway-bqs | dcg.service.test.ts |

## See Also

- PLAN.md §26 - Risk Register & Mitigations
- flywheel_gateway-kue - Risk Mitigations bead
- Individual mitigation beads for implementation details
