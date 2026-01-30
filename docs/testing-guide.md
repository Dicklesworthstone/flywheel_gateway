# Testing Guide

This document describes how to run tests, understand test patterns, and write new tests for Flywheel Gateway.

## Quick Reference

| Command | Description |
|---------|-------------|
| `bun run test` | Run all unit tests |
| `bun test <path>` | Run specific test file |
| `bun test --filter <pattern>` | Run tests matching pattern |
| `bun test:e2e` | Run Playwright E2E tests |
| `bun test:contract` | Run API contract tests |
| `bun test:integration` | Run integration tests |
| `bun lint` | Check code style |
| `bun typecheck` | TypeScript type checking |

## Test Structure

### Directory Layout

```
flywheel_gateway/
├── apps/gateway/src/__tests__/      # Gateway unit + route tests
├── apps/web/src/**/__tests__/       # Web component tests
├── packages/flywheel-clients/src/
│   ├── __tests__/                   # CLI runner + contract tests
│   └── <client>/__tests__/          # Per-client tests
├── packages/shared/src/**/__tests__/ # Shared utilities
├── packages/agent-drivers/src/__tests__/ # Driver tests
└── tests/
    ├── contract/                    # API contract tests
    ├── integration/                 # Integration tests
    └── load/                        # k6 load tests
```

### Naming Conventions

| Pattern | Usage |
|---------|-------|
| `*.test.ts` | All test files |
| `*.routes.test.ts` | API route tests |
| `*.service.test.ts` | Service layer tests |
| `client.test.ts` | Client SDK tests |

## Test Framework

We use [Bun Test](https://bun.sh/docs/cli/test) with the following imports:

```typescript
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
```

### Basic Test Structure

```typescript
describe("FeatureName", () => {
  describe("methodName", () => {
    test("does expected behavior", () => {
      // Arrange
      const input = createTestInput();

      // Act
      const result = methodUnderTest(input);

      // Assert
      expect(result).toEqual(expected);
    });
  });
});
```

## CLI Runner Test Patterns

The `flywheel-clients` package uses a shared CLI runner pattern for testing tool integrations.

### Mock Runner

For deterministic testing without spawning real processes:

```typescript
import type { CliCommandRunner, CliCommandResult } from "../cli-runner";

function createMockRunner(result: Partial<CliCommandResult>): CliCommandRunner {
  return {
    run: async () => ({
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode ?? 0,
      ...result,
    }),
  };
}
```

### Stub Command Runner (Pattern Matching)

For contract tests with deterministic responses based on command patterns:

```typescript
type StubPattern = {
  pattern: RegExp;
  result: Partial<CliCommandResult>;
};

function createStubCommandRunner(patterns: StubPattern[]): CliCommandRunner {
  return {
    run: async (command, args) => {
      const fullCommand = `${command} ${args.join(" ")}`;
      for (const { pattern, result } of patterns) {
        if (pattern.test(fullCommand)) {
          return { stdout: "", stderr: "", exitCode: 0, ...result };
        }
      }
      return { stdout: "", stderr: "No match", exitCode: 127 };
    },
  };
}
```

### Testing Error Conditions

```typescript
test("throws on timeout", async () => {
  const runner = createBunCliRunner({ timeoutMs: 50 });

  let error: CliCommandError | undefined;
  try {
    await runner.run("sleep", ["10"]);
  } catch (e) {
    error = e as CliCommandError;
  }

  expect(error).toBeInstanceOf(CliCommandError);
  expect(error?.kind).toBe("timeout");
  expect(error?.details?.timeoutMs).toBe(50);
});
```

## Logging Conventions

### Test Logging Structure

Tests should verify that services emit structured logs with actionable details:

```typescript
test("logs error details for debugging", async () => {
  let error: CliCommandError | undefined;
  try {
    await runner.run("nonexistent", []);
  } catch (e) {
    error = e as CliCommandError;
  }

  // Verify error details are actionable
  expect(error?.details?.command).toBe("nonexistent");
  expect(error?.details?.cause).toBeDefined();
});
```

### Required Log Fields

When testing logging behavior, verify these fields are present:

| Field | Description |
|-------|-------------|
| `command` | The CLI command executed |
| `args` | Command arguments |
| `exitCode` | Process exit code |
| `latencyMs` | Execution duration |
| `correlationId` | Request correlation ID (if applicable) |
| `cause` | Error cause for debugging |

### Logging Assertions

```typescript
describe("error detail logging", () => {
  test("timeout error includes command info", async () => {
    const runner = createBunCliRunner({ timeoutMs: 10 });

    let error: CliCommandError | undefined;
    try {
      await runner.run("sleep", ["100"]);
    } catch (e) {
      error = e as CliCommandError;
    }

    expect(error?.details?.command).toBe("sleep");
    expect(error?.details?.args).toEqual(["100"]);
    expect(error?.details?.timeoutMs).toBe(10);
  });
});
```

## Writing New Tests

### Service Tests

```typescript
// apps/gateway/src/__tests__/my.service.test.ts
import { describe, expect, test } from "bun:test";
import { MyService } from "../services/my.service";

describe("MyService", () => {
  test("returns expected result", async () => {
    const service = new MyService();
    const result = await service.doSomething();
    expect(result.status).toBe("success");
  });
});
```

### Route Tests

```typescript
// apps/gateway/src/__tests__/my.routes.test.ts
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { myRoutes } from "../routes/my";

describe("My Routes", () => {
  const app = new Hono().route("/my", myRoutes);

  test("GET /my returns data", async () => {
    const res = await app.request("/my");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.object).toBe("my_resource");
  });
});
```

### Client Tests (flywheel-clients)

```typescript
// packages/flywheel-clients/src/myclient/__tests__/client.test.ts
import { describe, expect, test } from "bun:test";
import { createMyClient } from "..";

describe("MyClient", () => {
  test("parses JSON output correctly", async () => {
    const runner = createMockRunner({
      stdout: '{"status": "ok"}',
      exitCode: 0,
    });

    const client = createMyClient({ runner });
    const result = await client.getStatus();

    expect(result.status).toBe("ok");
  });
});
```

## Contract Tests

Contract tests validate that clients parse CLI tool JSON output correctly using fixtures:

```typescript
// packages/flywheel-clients/src/__tests__/contract.test.ts

const FIXTURES = {
  brList: {
    stdout: `[{"id":"bd-123","title":"Test","status":"open"}]`,
  },
};

describe("br client contract", () => {
  test("parses list output", async () => {
    const runner = createStubCommandRunner([
      { pattern: /br list/, result: FIXTURES.brList },
    ]);

    const client = createBrClient({ runner });
    const result = await client.list();

    expect(result[0].id).toBe("bd-123");
  });
});
```

## Running Tests

### All Tests

```bash
bun run test
```

### Specific File

```bash
bun test apps/gateway/src/__tests__/safety.routes.test.ts
```

### Watch Mode

```bash
bun run test -- --watch
```

### With Coverage

```bash
bun run test -- --coverage
```

### Filtering by Name

```bash
bun test --filter "CLI runner"
```

## Troubleshooting

### Test Timeouts

If tests timeout, check:
1. Real process timeouts are set low (50-100ms for test commands)
2. Mock runners are used instead of real CLI execution
3. Network calls are mocked in unit tests

### Flaky Tests

Common causes:
- Time-dependent assertions (use relative comparisons)
- Shared state between tests (use beforeEach to reset)
- Real filesystem/network access (use mocks)

### Debugging Failures

```bash
# Run single test with verbose output
bun test --filter "my test name" --verbose

# Run with debug logging
DEBUG=* bun test path/to/test.ts
```

## E2E Testing

### Prerequisites

E2E tests use Playwright and require a running gateway server.

| Prerequisite | Required | How to check |
|---|---|---|
| Bun | Yes | `bun --version` |
| Playwright browsers | Yes | `bunx playwright install chromium` |
| E2E gateway server | Yes | `bun scripts/e2e-server.ts` |
| dcg | Optional | `command -v dcg` |
| ntm | Optional | `command -v ntm` |
| Agent Mail MCP | Optional | MCP server on port 8765 |

### Running E2E Tests

```bash
# Start E2E gateway (temp SQLite DB with seed data)
E2E_GATEWAY_PORT=3456 bun scripts/e2e-server.ts &

# Wait for server
curl -s http://localhost:3456/health

# Run all E2E tests
bun run test:e2e

# Run specific browser
bun run test:e2e --project=chromium

# Run single spec
bun run test:e2e tests/e2e/dashboard.spec.ts
```

### E2E Test Architecture

E2E tests use the logging fixtures framework:

```typescript
import { test, expect } from "./lib/fixtures";

test("page loads without errors", async ({ loggedPage, testLogger }) => {
  await loggedPage.goto("/setup");
  await loggedPage.waitForLoadState("networkidle");

  const summary = testLogger.getSummary();
  expect(summary.pageErrors).toBe(0);
  expect(summary.consoleErrors).toBe(0);
  expect(summary.networkRequests).toBeGreaterThan(0);
});
```

**Key fixtures:**

| Fixture | Description |
|---|---|
| `loggedPage` | Playwright page with auto console/network/error capture |
| `testLogger` | Structured log collector with `getSummary()` for assertions |

### E2E Server (`scripts/e2e-server.ts`)

The E2E server boots a standalone gateway with:
- Temporary SQLite database (auto-cleaned)
- Schema migrations applied
- Seed data for agents, beads, notifications
- Port configurable via `E2E_GATEWAY_PORT` (default: 3456)

### Interpreting E2E Failures

| Symptom | Likely Cause | Fix |
|---|---|---|
| `net::ERR_CONNECTION_REFUSED` | E2E server not running | Start with `bun scripts/e2e-server.ts` |
| `Timeout waiting for selector` | UI element not rendered | Check API responses, seed data |
| `pageErrors > 0` | JavaScript error in browser | Check console output in test logs |
| `consoleErrors > 0` | Console.error called | May indicate API failure or missing data |
| `networkRequests === 0` | No API calls made | Page may not have loaded correctly |

### E2E Artifacts (CI)

| Artifact | Retention | When |
|---|---|---|
| `e2e-report-<browser>` | 14 days | Always |
| `e2e-failures-<browser>` | 30 days | On failure |
| `e2e-logs-<browser>` | 14 days | Always (if present) |

## Structured Logging Interpretation

### Gateway Logs

The gateway uses structured JSON logging via `getLogger()`:

```
level=warn manifestPath=/path/to/manifest.yaml errorCategory=manifest_parse_error manifestHash=abc123...
```

| Field | Description |
|---|---|
| `manifestPath` | Path to the ACFS manifest file attempted |
| `manifestHash` | SHA256 of manifest content (for integrity checks) |
| `errorCategory` | One of: `manifest_missing`, `manifest_read_error`, `manifest_parse_error`, `manifest_validation_error` |
| `schemaVersion` | Manifest schema version (null if unparseable) |
| `correlationId` | Request correlation ID for tracing |

### Tool Detection Logs

```
level=info tool=dcg available=true detectionMs=45 version=0.9.2
level=warn tool=ntm available=false reason=not_installed
```

| Field | Description |
|---|---|
| `tool` | Tool name |
| `available` | Whether tool was detected |
| `detectionMs` | Detection latency |
| `version` | Detected version (if available) |
| `reason` | Unavailability reason (see `ToolUnavailabilityReason` enum) |

### Unavailability Reasons

| Reason | Description |
|---|---|
| `not_installed` | Binary not found in PATH |
| `permission_denied` | Insufficient permissions |
| `version_unsupported` | Version below minimum |
| `auth_required` | Authentication/API key missing |
| `network_unreachable` | Cannot reach required service |
| `timeout` | Detection timed out |
| `crash` | Process crashed during detection |
| `config_invalid` | Configuration file malformed |
| `dependency_missing` | Required dependency not found |
| `license_expired` | License validation failed |
| `platform_unsupported` | OS/arch not supported |
| `resource_exhausted` | System resources exceeded |
| `mcp_unreachable` | MCP server not available |
| `unknown` | Unclassified failure |

## Real Tool Integration Testing

Some tests can exercise real tool binaries when available:

```bash
# Check which tools are available
curl http://localhost:3456/agents/detected | jq '.data.agents'

# Run with real tool detection
E2E_GATEWAY_PORT=3456 bun scripts/e2e-server.ts &
bun run test:e2e
```

Tests handle tool unavailability gracefully:
- API tests accept both success and "tool unavailable" status codes
- UI tests verify pages render regardless of tool availability
- The `testLogger.getSummary()` tracks errors independently

## Best Practices

1. **Use mock runners** for CLI tool tests to avoid external dependencies
2. **Test error paths** - verify error kinds and actionable details
3. **Keep tests fast** - unit tests should complete in milliseconds
4. **Use fixtures** - share test data for consistency
5. **Test logging** - verify structured log fields for debugging
6. **Isolate state** - reset shared state in beforeEach hooks
7. **E2E: use logging fixtures** - always capture `testLogger.getSummary()` for diagnostics
8. **E2E: handle unavailability** - accept multiple status codes when tools may not be installed
9. **Coverage matrix** - run `bun scripts/generate-coverage-matrix.ts` after adding new integrations
