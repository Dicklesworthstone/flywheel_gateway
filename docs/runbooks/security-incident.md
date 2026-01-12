# Security Incident Runbook

## Risk Profile
- **Likelihood**: Low
- **Impact**: Critical
- **Symptoms**: Unauthorized access, data exfiltration, malicious commands

## Detection

### Automated Alerts
- DCG blocks suspicious commands
- Unusual API key usage patterns
- Audit log anomalies
- Failed authentication spikes

### Manual Indicators
- Unexpected file modifications
- API keys used from unknown IPs
- Agents executing unexpected commands
- Data access outside normal patterns

## Response Steps

### 1. Assess and Contain (< 5 min)

**CRITICAL: Do not delete evidence**

```bash
# Snapshot current state
curl http://localhost:3000/audit/export > audit-$(date +%Y%m%d-%H%M%S).json

# List active agents
curl http://localhost:3000/agents?status=active

# Check DCG blocks
curl http://localhost:3000/dcg/blocks?limit=100
```

### 2. Isolate Affected Components

```bash
# Suspend suspicious agents
curl -X POST http://localhost:3000/agents/{agentId}/suspend

# Revoke potentially compromised API keys
curl -X POST http://localhost:3000/caam/profiles/{profileId}/revoke

# Enable enhanced DCG mode
curl -X POST http://localhost:3000/dcg/config \
  -d '{"mode": "strict", "blockUnknown": true}'
```

### 3. Preserve Evidence

```bash
# Export full audit trail
curl http://localhost:3000/audit/export?full=true > full-audit.json

# Snapshot database
cp data/gateway.db data/gateway-incident-$(date +%Y%m%d).db

# Export agent history
curl http://localhost:3000/agents/{agentId}/history > agent-history.json
```

### 4. Investigate

Check for:
- [ ] Unauthorized agent spawns
- [ ] API key compromise (check CAAM logs)
- [ ] DCG bypass attempts
- [ ] File exfiltration (check reservations)
- [ ] Privilege escalation attempts

### 5. Remediate

```bash
# Rotate all API keys
curl -X POST http://localhost:3000/caam/rotate-all

# Clear compromised sessions
curl -X POST http://localhost:3000/sessions/invalidate-all

# Update DCG rules if needed
curl -X POST http://localhost:3000/dcg/rules \
  -d '{"pattern": "...", "action": "block"}'
```

### 6. Document

Create incident report including:
- Timeline of events
- Attack vector identified
- Data potentially exposed
- Remediation steps taken
- Prevention measures added

## Prevention Checklist

- [ ] API keys encrypted at rest
- [ ] Tokens never leave workspace
- [ ] Audit logging enabled
- [ ] DCG rules comprehensive
- [ ] Regular security reviews
- [ ] Key rotation schedule active

## Escalation

1. **Immediate**: Security team lead
2. **Within 1 hour**: CTO/CISO
3. **If data breach**: Legal team
4. **If customer data**: Privacy officer

## Related

- flywheel_gateway-bz1: Security Hardening
- DCG Dashboard: `/dcg`
- Audit Logs: `/audit`
- CAAM: `/settings/caam`
