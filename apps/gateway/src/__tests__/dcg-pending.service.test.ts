/**
 * Tests for DCG Pending Exceptions (Allow-Once Workflow).
 *
 * NOTE: These tests use the direct sqlite connection to avoid mock interference
 * from other test files that mock "../db".
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { restoreRealDb } from "./test-utils/db-mock-restore";

// Mock the logger with child method - must be before imports
const mockLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  child: () => mockLogger,
};

mock.module("../services/logger", () => ({
  logger: mockLogger,
}));

// Ensure we use the real db by re-mocking with the real implementation
// This prevents other test files' db mocks from affecting these tests
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../db/schema";

const dbFile = process.env["DB_FILE_NAME"] ?? "./data/gateway.db";
const realSqlite = new Database(dbFile);
const realDb = drizzle(realSqlite, { schema });

mock.module("../db", () => ({
  db: realDb,
  sqlite: realSqlite,
}));

afterAll(() => {
  mock.restore();
  // Restore real db module for other test files (mock.restore doesn't restore mock.module)
  restoreRealDb();
});

import { Hono } from "hono";
import { sqlite } from "../db/connection";
import { dcg } from "../routes/dcg";
import {
  approvePendingException,
  cleanupExpiredExceptions,
  createPendingException,
  denyPendingException,
  getPendingException,
  listPendingExceptions,
  PendingExceptionConflictError,
  PendingExceptionExpiredError,
  PendingExceptionNotFoundError,
  validateExceptionForExecution,
} from "../services/dcg-pending.service";

// Use direct sqlite to clear table (avoids mock interference from other tests)
function clearPendingExceptions(): void {
  sqlite.exec("DELETE FROM dcg_pending_exceptions");
}

// Create the table if it doesn't exist (for test isolation)
beforeAll(() => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS dcg_pending_exceptions (
      id TEXT PRIMARY KEY,
      short_code TEXT NOT NULL UNIQUE,
      command TEXT NOT NULL,
      command_hash TEXT NOT NULL,
      pack TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      severity TEXT NOT NULL,
      agent_id TEXT,
      block_event_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      approved_by TEXT,
      approved_at INTEGER,
      denied_by TEXT,
      denied_at INTEGER,
      deny_reason TEXT,
      executed_at INTEGER,
      execution_result TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
  sqlite.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS dcg_pending_short_code_idx ON dcg_pending_exceptions(short_code)`,
  );
  sqlite.exec(
    `CREATE INDEX IF NOT EXISTS dcg_pending_status_idx ON dcg_pending_exceptions(status)`,
  );
  sqlite.exec(
    `CREATE INDEX IF NOT EXISTS dcg_pending_agent_idx ON dcg_pending_exceptions(agent_id)`,
  );
  sqlite.exec(
    `CREATE INDEX IF NOT EXISTS dcg_pending_expires_idx ON dcg_pending_exceptions(expires_at)`,
  );
  sqlite.exec(
    `CREATE INDEX IF NOT EXISTS dcg_pending_command_hash_idx ON dcg_pending_exceptions(command_hash)`,
  );
});

// ============================================================================
// Service Layer Tests
// ============================================================================

describe("DCG Pending Exceptions Service", () => {
  beforeEach(async () => {
    await clearPendingExceptions();
  });

  describe("createPendingException", () => {
    test("creates exception with short code and hash", async () => {
      const exception = await createPendingException({
        command: "rm -rf /dangerous",
        pack: "core.filesystem",
        ruleId: "core.filesystem:rm-rf",
        reason: "Recursive delete is dangerous",
        severity: "high",
      });

      expect(exception.shortCode).toMatch(/^[a-z0-9]{6}$/);
      expect(exception.commandHash).toHaveLength(64); // SHA256
      expect(exception.status).toBe("pending");
      expect(exception.pack).toBe("core.filesystem");
      expect(exception.severity).toBe("high");
    });

    test("sets expiration based on TTL", async () => {
      const exception = await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
        ttlSeconds: 60,
      });

      const expectedExpiry = new Date(Date.now() + 60 * 1000);
      const actualExpiry = exception.expiresAt;

      // Allow 2 second tolerance
      expect(
        Math.abs(actualExpiry.getTime() - expectedExpiry.getTime()),
      ).toBeLessThan(2000);
    });

    test("includes agent and block event references", async () => {
      const exception = await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
        agentId: "agent-123",
        blockEventId: "block-456",
      });

      expect(exception.agentId).toBe("agent-123");
      expect(exception.blockEventId).toBe("block-456");
    });
  });

  describe("getPendingException", () => {
    test("returns exception by short code", async () => {
      const created = await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
      });

      const found = await getPendingException(created.shortCode);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
    });

    test("returns null for unknown short code", async () => {
      const found = await getPendingException("invalid");
      expect(found).toBeNull();
    });
  });

  describe("listPendingExceptions", () => {
    test("lists all pending exceptions", async () => {
      await createPendingException({
        command: "cmd1",
        pack: "test",
        ruleId: "test:1",
        reason: "Test 1",
        severity: "low",
      });
      await createPendingException({
        command: "cmd2",
        pack: "test",
        ruleId: "test:2",
        reason: "Test 2",
        severity: "medium",
      });

      const result = await listPendingExceptions({});
      expect(result.exceptions.length).toBeGreaterThanOrEqual(2);
    });

    test("filters by status", async () => {
      const exc = await createPendingException({
        command: "cmd1",
        pack: "test",
        ruleId: "test:1",
        reason: "Test 1",
        severity: "low",
      });
      await approvePendingException(exc.shortCode, "tester");

      const pendingResult = await listPendingExceptions({ status: "pending" });
      const approvedResult = await listPendingExceptions({
        status: "approved",
      });

      expect(
        pendingResult.exceptions.every((e) => e.status === "pending"),
      ).toBe(true);
      expect(
        approvedResult.exceptions.some(
          (e) => e.id === exc.id && e.status === "approved",
        ),
      ).toBe(true);
    });

    test("filters by agentId", async () => {
      await createPendingException({
        command: "cmd1",
        pack: "test",
        ruleId: "test:1",
        reason: "Test 1",
        severity: "low",
        agentId: "agent-1",
      });
      await createPendingException({
        command: "cmd2",
        pack: "test",
        ruleId: "test:2",
        reason: "Test 2",
        severity: "low",
        agentId: "agent-2",
      });

      const result = await listPendingExceptions({ agentId: "agent-1" });
      expect(result.exceptions.every((e) => e.agentId === "agent-1")).toBe(
        true,
      );
    });
  });

  describe("approvePendingException", () => {
    test("approves a pending exception", async () => {
      const exc = await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
      });

      const approved = await approvePendingException(
        exc.shortCode,
        "test-user",
      );

      expect(approved.status).toBe("approved");
      expect(approved.approvedBy).toBe("test-user");
      expect(approved.approvedAt).toBeInstanceOf(Date);
    });

    test("throws NotFoundError for unknown short code", async () => {
      await expect(
        approvePendingException("invalid", "test-user"),
      ).rejects.toThrow(PendingExceptionNotFoundError);
    });

    test("throws ConflictError for already approved exception", async () => {
      const exc = await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
      });

      await approvePendingException(exc.shortCode, "user1");

      await expect(
        approvePendingException(exc.shortCode, "user2"),
      ).rejects.toThrow(PendingExceptionConflictError);
    });

    test("throws ExpiredError for expired exception", async () => {
      const exc = await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
        ttlSeconds: 0, // Expires immediately
      });

      // Wait a bit for expiration
      await new Promise((r) => setTimeout(r, 100));

      await expect(
        approvePendingException(exc.shortCode, "test-user"),
      ).rejects.toThrow(PendingExceptionExpiredError);
    });
  });

  describe("denyPendingException", () => {
    test("denies a pending exception", async () => {
      const exc = await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
      });

      const denied = await denyPendingException(
        exc.shortCode,
        "test-user",
        "Too risky",
      );

      expect(denied.status).toBe("denied");
      expect(denied.deniedBy).toBe("test-user");
      expect(denied.denyReason).toBe("Too risky");
    });

    test("throws NotFoundError for unknown short code", async () => {
      await expect(
        denyPendingException("invalid", "test-user"),
      ).rejects.toThrow(PendingExceptionNotFoundError);
    });
  });

  describe("validateExceptionForExecution", () => {
    test("returns approved exception for matching hash", async () => {
      const exc = await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
      });

      await approvePendingException(exc.shortCode, "test-user");

      const valid = await validateExceptionForExecution(exc.commandHash);

      expect(valid).not.toBeNull();
      expect(valid?.shortCode).toBe(exc.shortCode);
      expect(valid?.status).toBe("approved");
    });

    test("returns null for unapproved exception", async () => {
      const exc = await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
      });

      const valid = await validateExceptionForExecution(exc.commandHash);
      expect(valid).toBeNull();
    });

    test("returns null for unknown hash", async () => {
      const valid = await validateExceptionForExecution("0".repeat(64));
      expect(valid).toBeNull();
    });
  });

  describe("cleanupExpiredExceptions", () => {
    test("marks expired exceptions", async () => {
      const exception = await createPendingException({
        command: "test-command-expired",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
        ttlSeconds: 0, // Expires immediately
      });

      // Wait for expiration (must be > 1 second since timestamps are in seconds)
      await new Promise((r) => setTimeout(r, 1100));

      const expiredCount = await cleanupExpiredExceptions();
      expect(expiredCount).toBeGreaterThanOrEqual(1);

      // Verify the specific exception was marked as expired
      const updated = await getPendingException(exception.shortCode);
      expect(updated?.status).toBe("expired");
    });
  });
});

// ============================================================================
// Route Tests
// ============================================================================

describe("DCG Pending Exceptions Routes", () => {
  const app = new Hono().route("/dcg", dcg);

  beforeEach(async () => {
    await clearPendingExceptions();
  });

  describe("GET /dcg/pending", () => {
    test("returns empty list when no exceptions", async () => {
      const res = await app.request("/dcg/pending");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.object).toBe("list");
      expect(body.data).toEqual([]);
    });

    test("returns list of pending exceptions", async () => {
      await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
      });

      const res = await app.request("/dcg/pending");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.object).toBe("list");
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    test("filters by status query param", async () => {
      const exc = await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
      });
      await approvePendingException(exc.shortCode, "tester");

      const res = await app.request("/dcg/pending?status=approved");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(
        body.data.every((e: { status: string }) => e.status === "approved"),
      ).toBe(true);
    });
  });

  describe("GET /dcg/pending/:shortCode", () => {
    test("returns exception by short code", async () => {
      const exc = await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
      });

      const res = await app.request(`/dcg/pending/${exc.shortCode}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.object).toBe("pending_exception");
      expect(body.data.shortCode).toBe(exc.shortCode);
    });

    test("returns 404 for unknown short code", async () => {
      const res = await app.request("/dcg/pending/invalid");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /dcg/pending/:shortCode/approve", () => {
    test("approves pending exception", async () => {
      const exc = await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
      });

      const res = await app.request(`/dcg/pending/${exc.shortCode}/approve`, {
        method: "POST",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.status).toBe("approved");
    });

    test("returns 404 for unknown short code", async () => {
      const res = await app.request("/dcg/pending/invalid/approve", {
        method: "POST",
      });
      expect(res.status).toBe(404);
    });

    test("returns 410 for expired exception", async () => {
      const exc = await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
        ttlSeconds: 0,
      });

      await new Promise((r) => setTimeout(r, 100));

      const res = await app.request(`/dcg/pending/${exc.shortCode}/approve`, {
        method: "POST",
      });
      expect(res.status).toBe(410);
    });

    test("returns 409 for already approved", async () => {
      const exc = await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
      });

      await approvePendingException(exc.shortCode, "user1");

      const res = await app.request(`/dcg/pending/${exc.shortCode}/approve`, {
        method: "POST",
      });
      expect(res.status).toBe(409);
    });
  });

  describe("POST /dcg/pending/:shortCode/deny", () => {
    test("denies pending exception", async () => {
      const exc = await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
      });

      const res = await app.request(`/dcg/pending/${exc.shortCode}/deny`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Too risky" }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.status).toBe("denied");
      expect(body.data.denyReason).toBe("Too risky");
    });

    test("denies without reason body", async () => {
      const exc = await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
      });

      const res = await app.request(`/dcg/pending/${exc.shortCode}/deny`, {
        method: "POST",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.status).toBe("denied");
    });
  });

  describe("POST /dcg/pending/:shortCode/validate", () => {
    test("validates approved exception with matching hash", async () => {
      const exc = await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
      });
      await approvePendingException(exc.shortCode, "tester");

      const res = await app.request(`/dcg/pending/${exc.shortCode}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandHash: exc.commandHash }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.valid).toBe(true);
      expect(body.data.exception.shortCode).toBe(exc.shortCode);
    });

    test("returns invalid for unapproved exception", async () => {
      const exc = await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
      });

      const res = await app.request(`/dcg/pending/${exc.shortCode}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandHash: exc.commandHash }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.valid).toBe(false);
      expect(body.data.reason).toContain("pending");
    });

    test("returns invalid for hash mismatch", async () => {
      const exc = await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
      });
      await approvePendingException(exc.shortCode, "tester");

      const res = await app.request(`/dcg/pending/${exc.shortCode}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandHash: "0".repeat(64) }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.valid).toBe(false);
      expect(body.data.reason).toContain("mismatch");
    });
  });

  describe("POST /dcg/pending/validate-hash", () => {
    test("validates by command hash directly", async () => {
      const exc = await createPendingException({
        command: "test-command",
        pack: "test",
        ruleId: "test:rule",
        reason: "Test",
        severity: "low",
      });
      await approvePendingException(exc.shortCode, "tester");

      const res = await app.request("/dcg/pending/validate-hash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandHash: exc.commandHash }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.valid).toBe(true);
    });

    test("returns invalid for unknown hash", async () => {
      const res = await app.request("/dcg/pending/validate-hash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandHash: "0".repeat(64) }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.valid).toBe(false);
    });
  });
});
