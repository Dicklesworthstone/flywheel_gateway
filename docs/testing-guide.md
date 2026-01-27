# Testing Guide

This document describes how to run tests, understand test patterns, and write new tests for Flywheel Gateway.

## Quick Reference

| Command | Description |
|---------|-------------|
| `bun test` | Run all unit tests |
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
bun test
```

### Specific File

```bash
bun test apps/gateway/src/__tests__/safety.routes.test.ts
```

### Watch Mode

```bash
bun test --watch
```

### With Coverage

```bash
bun test --coverage
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

## Best Practices

1. **Use mock runners** for CLI tool tests to avoid external dependencies
2. **Test error paths** - verify error kinds and actionable details
3. **Keep tests fast** - unit tests should complete in milliseconds
4. **Use fixtures** - share test data for consistency
5. **Test logging** - verify structured log fields for debugging
6. **Isolate state** - reset shared state in beforeEach hooks
