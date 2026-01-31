# Public Repository Safety Audit

**Audit Date:** 2026-01-22
**Auditor:** JadeBadger
**Bead:** bd-2j2s

## Overview

This document records the safety audit of the Flywheel Gateway public repository to ensure no private infrastructure details, secrets, or internal paths are inappropriately exposed through API responses.

## Scope

- Setup endpoints (`/setup/*`)
- Snapshot endpoints (`/snapshots/*`)
- Health endpoints (`/health/*`)
- Beads endpoints (`/beads/*`)
- Agent endpoints (`/agents/*`)

## Summary

| Category | Status | Notes |
|----------|--------|-------|
| Secret/Credential Leakage | PASS | Well-filtered via SAFE_ENV_PREFIXES |
| Absolute Path Exposure | DOCUMENTED | Paths exposed in detection APIs |
| Environment Variable Exposure | DOCUMENTED | Limited exposure (NODE_ENV, capability flags) |
| User Data Exposure | PASS | No PII leakage identified |

## Findings

### 1. Path Exposure in Detection APIs

**Severity:** Medium
**Status:** Documented (intentional design)

The following endpoints expose absolute filesystem paths to detected CLI tools:

| Endpoint | Field | Example Value |
|----------|-------|---------------|
| `GET /setup/readiness` | `agents[].path`, `tools[].path` | `/usr/local/bin/claude` |
| `GET /setup/tools/:name` | `detection.path` | `/opt/homebrew/bin/br` |
| `POST /setup/verify/:name` | `path` | `/home/user/.cargo/bin/ru` |
| `GET /agents/detected` | `path` for all CLIs | Various absolute paths |

**Risk Assessment:**
- Reveals installation patterns and user directory structures
- May include usernames in paths (e.g., `/home/{username}/...`)
- Standard practice for CLI detection APIs but worth documenting

**Decision:** Paths are intentionally exposed to support debugging and troubleshooting of tool detection. The gateway is designed for local/internal use where this information aids operators.

**Future Consideration:** If the gateway is deployed in multi-tenant or public-facing contexts, consider:
- Adding a `redact_paths` query parameter
- Providing path hashes instead of full paths
- Making path exposure configurable via environment variable

### 2. Environment Variable Handling

**Severity:** Low
**Status:** PASS

Environment variable filtering is well-implemented in `agent-detection.service.ts:438-476`:

**Safely Excluded:**
- `*_API_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`
- `DATABASE_URL`, `*_DSN`
- Cloud provider credentials (`AWS_*`, `GOOGLE_*`, `AZURE_*`)
- Auth-related variables (`AUTH_*`, `SESSION_*`, `JWT_*`)

**Safely Included (SAFE_ENV_PREFIXES):**
- `PATH`, `HOME`, `USER`, `SHELL`
- `LANG`, `LC_*`, `TERM`
- `TMPDIR`, `TEMP`, `TMP`
- `XDG_*` (XDG base directory spec)

### 3. Health Endpoint Exposure

**Severity:** Low
**Status:** Documented

The health endpoints expose:

| Field | Value Type | Example |
|-------|------------|---------|
| `environment` | String | "development", "production" |
| `agentMail` | Boolean | `true` (indicates `AGENT_MAIL_MCP_ENABLED` / `AGENT_MAIL_MCP_COMMAND` is set) |
| `version` | String | Package version from npm |
| `commit` | String | Git short SHA |
| `branch` | String | Git branch name |

**Assessment:** Standard operational metadata. Does not expose sensitive infrastructure details.

### 4. BR/BV Output Reflection

**Severity:** Low
**Status:** Documented

BR and BV command outputs are passed through the API. If issue descriptions or notes contain file paths, those will be reflected in:

- `GET /beads/triage`
- `GET /beads/ready`
- `GET /beads/:id`

**Assessment:** This is expected behavior - beads contain user-authored content. Content sanitization is the responsibility of bead authors, not the gateway.

### 5. Agent Working Directory Storage

**Severity:** Low
**Status:** Documented

Working directories provided to agent spawn are:
- Stored in the database (`repoUrl` field)
- Logged in audit records

**Assessment:** This is necessary for agent operation and audit trails. The database is local and not exposed via public APIs.

## Checklist

### Secrets & Credentials

- [x] No API keys in responses
- [x] No database credentials exposed
- [x] No authentication tokens in output
- [x] Environment variables properly filtered

### Infrastructure Details

- [x] No internal hostnames exposed
- [x] No internal URLs in public responses
- [x] No cloud resource ARNs/IDs leaked
- [ ] Filesystem paths exposed (documented, intentional)

### User Data

- [x] No PII in health endpoints
- [x] No user credentials exposed
- [x] No session data leaked

### Operational Data

- [x] Version info appropriate for public
- [x] Build metadata sanitized
- [x] Error messages don't leak internals

## Recommendations

### Immediate (No Action Required)

The current implementation is suitable for the gateway's designed use case (local/internal deployment). No immediate changes required.

### Future Considerations

1. **Path Redaction Mode**: Add `GATEWAY_REDACT_PATHS=true` environment variable to optionally redact paths in detection responses.

2. **API Versioning**: When implementing path redaction, consider a `/v2/setup/` prefix to maintain backward compatibility.

3. **Audit Logging Review**: Periodically review audit log contents to ensure no sensitive data accumulates.

## Conclusion

The Flywheel Gateway implements appropriate safeguards for a public repository:

- **Secrets**: Properly excluded from all responses
- **Environment Variables**: Filtered via allowlist pattern
- **Paths**: Intentionally exposed for debugging (documented)
- **User Data**: No PII leakage

The audit passes with documented exceptions for path exposure, which is an intentional design choice for the gateway's local/internal deployment model.

## Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-22 | JadeBadger | Initial audit - bd-2j2s |
