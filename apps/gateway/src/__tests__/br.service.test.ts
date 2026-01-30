/**
 * Unit tests for br.service.ts
 *
 * Tests the gateway br service wrapper behavior with mocked br client.
 * Covers CRUD and list/ready flows, error propagation, input validation.
 * Structured log assertions include action, bead id, and br error kind.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  BrClient,
  BrCloseOptions,
  BrCommandOptions,
  BrCreateInput,
  BrIssue,
  BrListOptions,
  BrReadyOptions,
  BrSyncOptions,
  BrSyncResult,
  BrSyncStatus,
  BrUpdateInput,
} from "@flywheel/flywheel-clients";
import { BrClientError } from "@flywheel/flywheel-clients";
import { requestContextStorage } from "../middleware/correlation";
import {
  clearBrCache,
  closeBrIssues,
  createBrCommandRunner,
  createBrIssue,
  createBrService,
  getBrList,
  getBrProjectRoot,
  getBrReady,
  getBrShow,
  getBrSyncStatus,
  runBrCommand,
  setBrClientForTesting,
  syncBr,
  updateBrIssues,
} from "../services/br.service";

// ============================================================================
// Test Fixtures
// ============================================================================

const sampleIssue: BrIssue = {
  id: "bd-1234",
  title: "Test issue",
  description: "A test issue",
  status: "open",
  priority: 2,
  issue_type: "task",
  created_at: "2026-01-21T00:00:00Z",
  updated_at: "2026-01-21T00:00:00Z",
  labels: ["test"],
};

const sampleIssue2: BrIssue = {
  id: "bd-5678",
  title: "Second issue",
  status: "in_progress",
  priority: 1,
  issue_type: "bug",
  created_at: "2026-01-21T01:00:00Z",
  updated_at: "2026-01-21T02:00:00Z",
};

const sampleSyncStatus: BrSyncStatus = {
  dirty_count: 3,
  last_export_time: "2026-01-21T00:00:00Z",
  last_import_time: "2026-01-20T12:00:00Z",
  jsonl_exists: true,
  jsonl_newer: false,
  db_newer: true,
};

const sampleSyncResult: BrSyncResult = {};

// ============================================================================
// Mock Logger
// ============================================================================

interface LogCall {
  level: string;
  context: Record<string, unknown>;
  message: string;
}

const logCalls: LogCall[] = [];

function recordLog(level: LogCall["level"]) {
  return (...args: unknown[]) => {
    const first = args[0];
    const second = args[1];

    const context =
      first && typeof first === "object" ? (first as Record<string, unknown>) : {};
    const message =
      typeof first === "string"
        ? first
        : typeof second === "string"
          ? second
          : "";

    logCalls.push({ level, context, message });
  };
}

const mockLogger = {
  info: recordLog("info"),
  warn: recordLog("warn"),
  debug: recordLog("debug"),
  error: recordLog("error"),
  child: () => mockLogger,
};

function createMockBrClient(overrides: Partial<BrClient>): BrClient {
  return {
    ready: mock(async () => []),
    list: mock(async () => []),
    show: mock(async () => []),
    create: mock(async () => ({})),
    update: mock(async () => []),
    close: mock(async () => []),
    syncStatus: mock(async () => ({})),
    sync: mock(async () => ({})),
    ...overrides,
  } as unknown as BrClient;
}

beforeEach(() => {
  requestContextStorage.enterWith({
    correlationId: "test-correlation-id",
    requestId: "test-request-id",
    startTime: performance.now(),
    logger: mockLogger,
  });
});

// ============================================================================
// Tests
// ============================================================================

describe("br.service", () => {
  beforeEach(() => {
    logCalls.length = 0;
    clearBrCache();
  });

  afterEach(() => {
    clearBrCache();
  });

  describe("getBrProjectRoot", () => {
    test("uses BR_PROJECT_ROOT env if set", () => {
      const original = process.env["BR_PROJECT_ROOT"];
      process.env["BR_PROJECT_ROOT"] = "/custom/path";
      try {
        expect(getBrProjectRoot()).toBe("/custom/path");
      } finally {
        if (original) {
          process.env["BR_PROJECT_ROOT"] = original;
        } else {
          delete process.env["BR_PROJECT_ROOT"];
        }
      }
    });

    test("uses BEADS_PROJECT_ROOT env as fallback", () => {
      const originalBr = process.env["BR_PROJECT_ROOT"];
      const originalBeads = process.env["BEADS_PROJECT_ROOT"];
      delete process.env["BR_PROJECT_ROOT"];
      process.env["BEADS_PROJECT_ROOT"] = "/beads/path";
      try {
        expect(getBrProjectRoot()).toBe("/beads/path");
      } finally {
        if (originalBr) process.env["BR_PROJECT_ROOT"] = originalBr;
        if (originalBeads) {
          process.env["BEADS_PROJECT_ROOT"] = originalBeads;
        } else {
          delete process.env["BEADS_PROJECT_ROOT"];
        }
      }
    });
  });

  describe("runBrCommand", () => {
    test("executes command and returns result", async () => {
      const result = await runBrCommand("echo", ["hello"], {
        timeout: 5000,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello");
      expect(result.stderr).toBe("");
    });

    test("returns non-zero exit code on failure", async () => {
      const result = await runBrCommand("sh", ["-c", "exit 42"], {
        timeout: 5000,
      });
      expect(result.exitCode).toBe(42);
    });

    test("logs command completion", async () => {
      await runBrCommand("echo", ["test"], { timeout: 5000 });
      const debugLog = logCalls.find(
        (c) => c.level === "debug" && c.message === "br command completed",
      );
      expect(debugLog).toBeDefined();
      expect(debugLog?.context["tool"]).toBe("br");
      expect(debugLog?.context["command"]).toBe("echo");
      expect(debugLog?.context["args"]).toEqual(["test"]);
      expect(debugLog?.context["exitCode"]).toBe(0);
      expect(typeof debugLog?.context["latencyMs"]).toBe("number");
    });

    test("logs warning on timeout", async () => {
      // Use sleep command that will be killed
      const result = await runBrCommand("sleep", ["10"], {
        timeout: 50,
      });
      expect(result.exitCode).toBe(-1);
      const warnLog = logCalls.find(
        (c) => c.level === "warn" && c.message === "br command timed out",
      );
      expect(warnLog).toBeDefined();
      expect(warnLog?.context["tool"]).toBe("br");
      expect(warnLog?.context["command"]).toBe("sleep");
      expect(warnLog?.context["timedOut"]).toBe(true);
    });
  });

  describe("createBrCommandRunner", () => {
    test("creates runner with custom executor", async () => {
      const customExecutor = mock(async () => ({
        stdout: '{"id":"bd-test"}',
        stderr: "",
        exitCode: 0,
      }));

      const runner = createBrCommandRunner(customExecutor);
      const result = await runner.run("br", ["show", "bd-test"]);

      expect(customExecutor).toHaveBeenCalledWith(
        "br",
        ["show", "bd-test"],
        undefined,
      );
      expect(result.stdout).toBe('{"id":"bd-test"}');
      expect(result.exitCode).toBe(0);
    });

    test("passes options through to executor", async () => {
      const customExecutor = mock(async () => ({
        stdout: "[]",
        stderr: "",
        exitCode: 0,
      }));

      const runner = createBrCommandRunner(customExecutor);
      await runner.run("br", ["list"], { cwd: "/test", timeout: 1000 });

      expect(customExecutor).toHaveBeenCalledWith("br", ["list"], {
        cwd: "/test",
        timeout: 1000,
      });
    });
  });

  describe("createBrService", () => {
    test("returns service with all methods", () => {
      const service = createBrService();
      expect(typeof service.ready).toBe("function");
      expect(typeof service.list).toBe("function");
      expect(typeof service.show).toBe("function");
      expect(typeof service.create).toBe("function");
      expect(typeof service.update).toBe("function");
      expect(typeof service.close).toBe("function");
      expect(typeof service.syncStatus).toBe("function");
      expect(typeof service.sync).toBe("function");
    });
  });
});

describe("br.service CRUD operations with mocked client", () => {
  // We'll test via the exported functions which use getBrClient() internally.
  // To mock, we need to mock the flywheel-clients module.

  let mockClient: BrClient;
  let readyMock: ReturnType<typeof mock>;
  let listMock: ReturnType<typeof mock>;
  let showMock: ReturnType<typeof mock>;
  let createMock: ReturnType<typeof mock>;
  let updateMock: ReturnType<typeof mock>;
  let closeMock: ReturnType<typeof mock>;
  let syncStatusMock: ReturnType<typeof mock>;
  let syncMock: ReturnType<typeof mock>;

  beforeEach(() => {
    logCalls.length = 0;
    clearBrCache();

    readyMock = mock(async () => [sampleIssue, sampleIssue2]);
    listMock = mock(async () => [sampleIssue]);
    showMock = mock(async () => [sampleIssue]);
    createMock = mock(async () => sampleIssue);
    updateMock = mock(async () => [sampleIssue]);
    closeMock = mock(async () => [sampleIssue]);
    syncStatusMock = mock(async () => sampleSyncStatus);
    syncMock = mock(async () => sampleSyncResult);

    mockClient = {
      ready: readyMock,
      list: listMock,
      show: showMock,
      create: createMock,
      update: updateMock,
      close: closeMock,
      syncStatus: syncStatusMock,
      sync: syncMock,
    };

    setBrClientForTesting(mockClient);
  });

  afterEach(() => {
    clearBrCache();
  });

  describe("getBrReady", () => {
    test("returns ready issues", async () => {
      const issues = await getBrReady();
      expect(issues).toHaveLength(2);
      expect(issues[0]!.id).toBe("bd-1234");
      expect(issues[1]!.id).toBe("bd-5678");
    });

    test("passes options to client", async () => {
      const options: BrReadyOptions = {
        limit: 5,
        assignee: "user1",
        labels: ["urgent"],
        sort: "priority",
      };
      await getBrReady(options);
      expect(readyMock).toHaveBeenCalledWith(options);
    });

    test("logs fetch with count and latency", async () => {
      await getBrReady();
      const infoLog = logCalls.find(
        (c) => c.level === "info" && c.message === "br ready fetched",
      );
      expect(infoLog).toBeDefined();
      expect(infoLog?.context["tool"]).toBe("br");
      expect(infoLog?.context["operation"]).toBe("br ready");
      expect(infoLog?.context["count"]).toBe(2);
      expect(typeof infoLog?.context["latencyMs"]).toBe("number");
    });
  });

  describe("getBrList", () => {
    test("returns issue list", async () => {
      const issues = await getBrList();
      expect(issues).toHaveLength(1);
      expect(issues[0]!.id).toBe("bd-1234");
    });

    test("passes filter options to client", async () => {
      const options: BrListOptions = {
        statuses: ["open", "in_progress"],
        types: ["bug", "task"],
        priorities: [1, 2],
        limit: 10,
      };
      await getBrList(options);
      expect(listMock).toHaveBeenCalledWith(options);
    });

    test("logs fetch with count and latency", async () => {
      await getBrList();
      const infoLog = logCalls.find(
        (c) => c.level === "info" && c.message === "br list fetched",
      );
      expect(infoLog).toBeDefined();
      expect(infoLog?.context["tool"]).toBe("br");
      expect(infoLog?.context["operation"]).toBe("br list");
      expect(infoLog?.context["count"]).toBe(1);
    });
  });

  describe("getBrShow", () => {
    test("returns issue by single id", async () => {
      const issues = await getBrShow("bd-1234");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.id).toBe("bd-1234");
    });

    test("accepts array of ids", async () => {
      showMock.mockImplementation(async () => [sampleIssue, sampleIssue2]);
      const issues = await getBrShow(["bd-1234", "bd-5678"]);
      expect(issues).toHaveLength(2);
    });

    test("logs fetch with ids", async () => {
      await getBrShow("bd-1234");
      const infoLog = logCalls.find(
        (c) => c.level === "info" && c.message === "br show fetched",
      );
      expect(infoLog).toBeDefined();
      expect(infoLog?.context["tool"]).toBe("br");
      expect(infoLog?.context["operation"]).toBe("br show");
      expect(infoLog?.context["ids"]).toEqual(["bd-1234"]);
    });
  });

  describe("createBrIssue", () => {
    test("creates issue with input", async () => {
      const input: BrCreateInput = {
        title: "New task",
        type: "task",
        priority: 2,
        description: "Description",
        labels: ["test"],
      };
      const issue = await createBrIssue(input);
      expect(issue.id).toBe("bd-1234");
      expect(createMock).toHaveBeenCalledWith(input, undefined);
    });

    test("passes options to client", async () => {
      const input: BrCreateInput = { title: "Test" };
      const options: BrCommandOptions = { timeout: 5000 };
      await createBrIssue(input, options);
      expect(createMock).toHaveBeenCalledWith(input, options);
    });

    test("logs creation with id and title", async () => {
      await createBrIssue({ title: "Test task" });
      const infoLog = logCalls.find(
        (c) => c.level === "info" && c.message === "br issue created",
      );
      expect(infoLog).toBeDefined();
      expect(infoLog?.context["tool"]).toBe("br");
      expect(infoLog?.context["operation"]).toBe("br create");
      expect(infoLog?.context["id"]).toBe("bd-1234");
      expect(infoLog?.context["title"]).toBe("Test task");
    });
  });

  describe("updateBrIssues", () => {
    test("updates single issue", async () => {
      const input: BrUpdateInput = { status: "in_progress" };
      const issues = await updateBrIssues("bd-1234", input);
      expect(issues).toHaveLength(1);
      expect(updateMock).toHaveBeenCalledWith("bd-1234", input, undefined);
    });

    test("updates multiple issues", async () => {
      updateMock.mockImplementation(async () => [sampleIssue, sampleIssue2]);
      const input: BrUpdateInput = { priority: 1 };
      const issues = await updateBrIssues(["bd-1234", "bd-5678"], input);
      expect(issues).toHaveLength(2);
    });

    test("logs update with ids and count", async () => {
      await updateBrIssues("bd-1234", { status: "closed" });
      const infoLog = logCalls.find(
        (c) => c.level === "info" && c.message === "br issues updated",
      );
      expect(infoLog).toBeDefined();
      expect(infoLog?.context["tool"]).toBe("br");
      expect(infoLog?.context["operation"]).toBe("br update");
      expect(infoLog?.context["ids"]).toEqual(["bd-1234"]);
      expect(infoLog?.context["count"]).toBe(1);
    });
  });

  describe("closeBrIssues", () => {
    test("closes single issue", async () => {
      const issues = await closeBrIssues("bd-1234");
      expect(issues).toHaveLength(1);
      expect(closeMock).toHaveBeenCalledWith("bd-1234", undefined);
    });

    test("closes with reason", async () => {
      const options: BrCloseOptions = { reason: "Completed" };
      await closeBrIssues("bd-1234", options);
      expect(closeMock).toHaveBeenCalledWith("bd-1234", options);
    });

    test("closes multiple issues", async () => {
      closeMock.mockImplementation(async () => [sampleIssue, sampleIssue2]);
      const issues = await closeBrIssues(["bd-1234", "bd-5678"]);
      expect(issues).toHaveLength(2);
    });

    test("logs close with ids and count", async () => {
      await closeBrIssues("bd-1234");
      const infoLog = logCalls.find(
        (c) => c.level === "info" && c.message === "br issues closed",
      );
      expect(infoLog).toBeDefined();
      expect(infoLog?.context["tool"]).toBe("br");
      expect(infoLog?.context["operation"]).toBe("br close");
      expect(infoLog?.context["ids"]).toEqual(["bd-1234"]);
      expect(infoLog?.context["count"]).toBe(1);
    });
  });

  describe("getBrSyncStatus", () => {
    test("returns sync status", async () => {
      const status = await getBrSyncStatus();
      expect(status.dirty_count).toBe(3);
      expect(status.jsonl_exists).toBe(true);
    });

    test("logs sync status fetch", async () => {
      await getBrSyncStatus();
      const infoLog = logCalls.find(
        (c) => c.level === "info" && c.message === "br sync status fetched",
      );
      expect(infoLog).toBeDefined();
      expect(infoLog?.context["tool"]).toBe("br");
      expect(infoLog?.context["operation"]).toBe("br sync --status");
      expect(infoLog?.context["dirtyCount"]).toBe(3);
    });
  });

  describe("syncBr", () => {
    test("runs sync with default options", async () => {
      const result = await syncBr();
      expect(result).toEqual(sampleSyncResult);
      expect(syncMock).toHaveBeenCalledWith(undefined);
    });

    test("passes sync options to client", async () => {
      const options: BrSyncOptions = {
        mode: "flush-only",
        force: true,
      };
      await syncBr(options);
      expect(syncMock).toHaveBeenCalledWith(options);
    });

    test("logs sync completion with mode", async () => {
      await syncBr({ mode: "merge" });
      const infoLog = logCalls.find(
        (c) => c.level === "info" && c.message === "br sync completed",
      );
      expect(infoLog).toBeDefined();
      expect(infoLog?.context["tool"]).toBe("br");
      expect(infoLog?.context["operation"]).toBe("br sync");
      expect(infoLog?.context["mode"]).toBe("merge");
    });
  });
});

describe("br.service error handling", () => {
  beforeEach(() => {
    logCalls.length = 0;
    clearBrCache();
  });

  afterEach(() => {
    clearBrCache();
  });

  test("propagates BrClientError from ready", async () => {
    const mockReadyError = mock(async () => {
      throw new BrClientError("command_failed", "br not found", {
        exitCode: 127,
      });
    });

    setBrClientForTesting(createMockBrClient({ ready: mockReadyError }));

    await expect(getBrReady()).rejects.toThrow("br not found");
  });

  test("propagates BrClientError from create", async () => {
    const mockCreateError = mock(async () => {
      throw new BrClientError("validation_error", "Invalid input", {
        field: "title",
      });
    });

    setBrClientForTesting(createMockBrClient({ create: mockCreateError }));

    await expect(createBrIssue({ title: "" })).rejects.toThrow("Invalid input");
  });

  test("propagates timeout errors", async () => {
    const mockTimeoutError = mock(async () => {
      throw new BrClientError("timeout", "Command timed out", {
        timeout: 30000,
      });
    });

    setBrClientForTesting(createMockBrClient({ list: mockTimeoutError }));

    await expect(getBrList()).rejects.toThrow("Command timed out");
  });
});

describe("br.service input validation", () => {
  let createMock: ReturnType<typeof mock>;
  let updateMock: ReturnType<typeof mock>;

  beforeEach(() => {
    logCalls.length = 0;
    clearBrCache();

    createMock = mock(async (input: BrCreateInput) => ({
      id: "bd-new",
      title: input.title ?? "Untitled",
      status: "open",
      priority: input.priority ?? 2,
      issue_type: input.type ?? "task",
    }));

    updateMock = mock(async (_ids: string | string[], input: BrUpdateInput) => [
      {
        id: "bd-1234",
        title: input.title ?? "Test",
        status: input.status ?? "open",
        priority: input.priority ?? 2,
      },
    ]);

    setBrClientForTesting(
      createMockBrClient({
        create: createMock,
        update: updateMock,
      }),
    );
  });

  afterEach(() => {
    clearBrCache();
  });

  test("create accepts minimal input", async () => {
    const issue = await createBrIssue({ title: "Minimal" });
    expect(issue.title).toBe("Minimal");
    expect(createMock).toHaveBeenCalledWith({ title: "Minimal" }, undefined);
  });

  test("create accepts full input", async () => {
    const input: BrCreateInput = {
      title: "Full task",
      type: "bug",
      priority: 1,
      description: "Full description",
      assignee: "user1",
      owner: "owner1",
      labels: ["urgent", "frontend"],
      parent: "bd-parent",
      deps: ["bd-dep1", "bd-dep2"],
      estimateMinutes: 120,
      due: "2026-02-01",
      defer: "2026-01-25",
      externalRef: "GH-123",
    };
    await createBrIssue(input);
    expect(createMock).toHaveBeenCalledWith(input, undefined);
  });

  test("update accepts status change", async () => {
    await updateBrIssues("bd-1234", { status: "in_progress" });
    expect(updateMock).toHaveBeenCalledWith(
      "bd-1234",
      { status: "in_progress" },
      undefined,
    );
  });

  test("update accepts label modifications", async () => {
    const input: BrUpdateInput = {
      addLabels: ["new-label"],
      removeLabels: ["old-label"],
    };
    await updateBrIssues("bd-1234", input);
    expect(updateMock).toHaveBeenCalledWith("bd-1234", input, undefined);
  });

  test("update accepts claim flag", async () => {
    await updateBrIssues("bd-1234", { claim: true });
    expect(updateMock).toHaveBeenCalledWith(
      "bd-1234",
      { claim: true },
      undefined,
    );
  });
});
