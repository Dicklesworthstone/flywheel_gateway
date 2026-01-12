# Agent Runaway Runbook

## Risk Profile
- **Likelihood**: Medium
- **Impact**: High
- **Symptoms**: Agent consumes excessive tokens, runs indefinitely, produces harmful output

## Detection

### Automated Alerts
- Token usage exceeds 90% of limit
- No progress detected for 5+ minutes
- Tool call rate exceeds normal thresholds

### Manual Indicators
- Dashboard shows high token consumption
- Agent output becomes repetitive or nonsensical
- External API costs spike unexpectedly

## Response Steps

### 1. Assess Severity (< 1 min)
```bash
# Check agent status via API
curl http://localhost:3000/agents/{agentId}

# Review recent output
curl http://localhost:3000/agents/{agentId}/output?limit=100
```

### 2. Interrupt Agent (< 30 sec)
```bash
# Send interrupt signal
curl -X POST http://localhost:3000/agents/{agentId}/interrupt

# Verify state changed to "interrupted"
curl http://localhost:3000/agents/{agentId}
```

### 3. Create Checkpoint (if valuable work exists)
```bash
# Create emergency checkpoint
curl -X POST http://localhost:3000/agents/{agentId}/checkpoint \
  -H "Content-Type: application/json" \
  -d '{"reason": "emergency", "tags": ["runaway-recovery"]}'
```

### 4. Terminate if Interrupt Fails
```bash
# Force terminate
curl -X POST http://localhost:3000/agents/{agentId}/terminate?force=true
```

### 5. Post-Incident
- Review DCG logs for blocked commands
- Check if token limits need adjustment
- Document in incident log

## Prevention Checklist

- [ ] Token limits configured per agent type
- [ ] Activity monitoring enabled
- [ ] Auto-interrupt timeout set (default: 30 min)
- [ ] DCG rules active for destructive commands
- [ ] Alerts configured for token thresholds

## Escalation

If agent cannot be terminated:
1. Contact platform administrator
2. Consider gateway restart (affects all agents)
3. Document for post-mortem

## Related

- flywheel_gateway-398: Agent Lifecycle Management
- DCG Configuration: `/dcg` dashboard
- Token Limits: Agent spawn configuration
