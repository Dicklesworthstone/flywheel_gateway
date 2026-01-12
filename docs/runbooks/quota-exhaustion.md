# Account Quota Exhaustion Runbook

## Risk Profile
- **Likelihood**: High
- **Impact**: High
- **Symptoms**: All API keys hit rate limits, agents blocked

## Detection

### Automated Alerts
- Rate limit errors spike
- Pool utilization reaches 100%
- All profiles on cooldown

### Manual Indicators
- Agents queued waiting for API access
- CAAM dashboard shows all profiles on cooldown
- Provider dashboard shows rate limit warnings

## Response Steps

### 1. Check Pool Status (< 1 min)
```bash
# Get CAAM status
curl http://localhost:3000/caam/status

# Check pool profiles
curl http://localhost:3000/caam/pools/{poolId}/profiles
```

### 2. Identify Bottleneck
- All profiles exhausted → Add more profiles or wait
- Single profile exhausted → Rotation should handle
- Provider outage → Switch providers

### 3. Emergency Profile Activation
```bash
# Activate backup profile if available
curl -X POST http://localhost:3000/caam/profiles/{backupId}/activate

# Reduce cooldown for critical profile (use sparingly)
curl -X PATCH http://localhost:3000/caam/profiles/{profileId} \
  -H "Content-Type: application/json" \
  -d '{"cooldownUntil": null}'
```

### 4. Enable Provider Fallback
```bash
# If Claude exhausted, enable Codex fallback
curl -X PATCH http://localhost:3000/caam/pools/{poolId} \
  -H "Content-Type: application/json" \
  -d '{"fallbackProvider": "codex", "fallbackEnabled": true}'
```

### 5. Queue Management
```bash
# Check queued requests
curl http://localhost:3000/caam/queue

# Prioritize critical agents
curl -X POST http://localhost:3000/caam/queue/prioritize \
  -d '{"agentId": "{criticalAgentId}", "priority": 1}'
```

## Prevention Checklist

- [ ] Multiple API keys per provider
- [ ] Pool rotation strategy configured
- [ ] Cooldown tracking enabled
- [ ] Fallback providers configured
- [ ] Usage alerts set below limits
- [ ] Regular key rotation scheduled

## Provider-Specific Limits

| Provider | Requests/Min | Tokens/Min | Daily Limit |
|----------|--------------|------------|-------------|
| Claude | 60 | 100K | 1M |
| Codex | 30 | 90K | 500K |
| Gemini | 60 | 120K | 1.5M |

## Escalation

If all options exhausted:
1. Contact provider support for limit increase
2. Implement request queuing with backpressure
3. Consider temporary service degradation

## Related

- flywheel_gateway-41h: CAAM Account Management
- CAAM Dashboard: `/settings/caam`
- Provider Documentation: See provider-specific docs
