/**
 * Service Layer Integration Tests (bd-1vr1.7)
 *
 * Tests DB-backed services (history, dcg, safety) against a real SQLite DB
 * with zero mock.module usage. The DB_FILE_NAME env var is set before any
 * service imports so the singleton db module connects to our temp database.
 */

import { Database } from "bun:sqlite";
import { readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

// ---------------------------------------------------------------------------
// 1. Create temp DB and run migrations BEFORE importing any services
// ---------------------------------------------------------------------------

const savedDbFile = process.env["DB_FILE_NAME"];
const savedNodeEnv = process.env["NODE_ENV"];

const dbPath = join(tmpdir(), `flywheel-svc-test-${process.pid}-${Date.now()}.db`);
const sqliteDb = new Database(dbPath);

sqliteDb.exec("PRAGMA journal_mode = WAL");
sqliteDb.exec("PRAGMA synchronous = NORMAL");
sqliteDb.exec("PRAGMA foreign_keys = ON");

const MIGRATIONS_DIR = join(import.meta.dir, "../db/migrations");
const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

sqliteDb.exec(`
  CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL,
    created_at INTEGER
  )
`);

for (const file of migrationFiles) {
  const raw = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
  const statements = raw
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    sqliteDb.exec(stmt);
  }
  sqliteDb
    .query(
      `INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)`,
    )
    .run(file, Date.now());
}

sqliteDb.close();

// Set env BEFORE service imports so the db singleton picks up our temp DB
process.env["DB_FILE_NAME"] = dbPath;
process.env["NODE_ENV"] = "test";

// ---------------------------------------------------------------------------
// 2. Now import services (they will connect to our temp DB)
// ---------------------------------------------------------------------------

const {
  createHistoryEntry,
  completeHistoryEntry,
  getHistoryEntry,
  queryHistory,
  getHistoryStats,
  exportHistory,
  extractFromOutput,
} = await import("../services/history.service");

const {
  ingestBlockEvent,
  getBlockEvents,
  markFalsePositive,
  getConfig: getDcgConfig,
  updateConfig: updateDcgConfig,
  getStats: getDcgStats,
  listPacks,
} = await import("../services/dcg.service");

// ---------------------------------------------------------------------------
// 3. Seed baseline data
// ---------------------------------------------------------------------------

const { db } = await import("../db");
const { accounts, agents } = await import("../db/schema");

const now = new Date();

beforeAll(async () => {
  await db.insert(accounts).values({
    id: "test-account-1",
    email: "test@flywheel.dev",
    apiKeyHash: "test-hash-001",
    role: "admin",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(agents).values({
    id: "test-agent-1",
    repoUrl: "https://github.com/test/repo",
    task: "Integration test agent",
    status: "idle",
    model: "sonnet-4",
    accountId: "test-account-1",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(agents).values({
    id: "test-agent-2",
    repoUrl: "https://github.com/test/repo2",
    task: "Second test agent",
    status: "running",
    model: "opus-4",
    accountId: "test-account-1",
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(() => {
  if (savedDbFile === undefined) {
    delete process.env["DB_FILE_NAME"];
  } else {
    process.env["DB_FILE_NAME"] = savedDbFile;
  }

  if (savedNodeEnv === undefined) {
    delete process.env["NODE_ENV"];
  } else {
    process.env["NODE_ENV"] = savedNodeEnv;
  }

  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${dbPath}${suffix}`);
    } catch {
      /* ignore */
    }
  }
});

// ============================================================================
// History Service (real DB)
// ============================================================================

describe("History Service (real DB)", () => {
  test("createHistoryEntry inserts into DB and returns entry", async () => {
    const entry = await createHistoryEntry("test-agent-1", {
      prompt: "Write a hello world function",
      promptTokens: 42,
      tags: ["code", "intro"],
    });

    expect(entry.id).toMatch(/^hist_/);
    expect(entry.agentId).toBe("test-agent-1");
    expect(entry.prompt).toBe("Write a hello world function");
    expect(entry.promptTokens).toBe(42);
    expect(entry.outcome).toBe("pending");
    expect(entry.tags).toEqual(["code", "intro"]);
  });

  test("completeHistoryEntry updates the entry", async () => {
    const entry = await createHistoryEntry("test-agent-1", {
      prompt: "Fix the bug",
    });

    const completed = await completeHistoryEntry(
      entry.id,
      {
        responseSummary: "Bug fixed by updating the condition",
        responseTokens: 25,
        outcome: "success",
      },
      150,
    );

    expect(completed).not.toBeNull();
    expect(completed!.outcome).toBe("success");
    expect(completed!.responseSummary).toBe(
      "Bug fixed by updating the condition",
    );
    expect(completed!.durationMs).toBe(150);
  });

  test("getHistoryEntry retrieves by ID", async () => {
    const entry = await createHistoryEntry("test-agent-1", {
      prompt: "Unique prompt for lookup",
    });

    const found = await getHistoryEntry(entry.id);
    expect(found).not.toBeNull();
    expect(found!.prompt).toBe("Unique prompt for lookup");
  });

  test("getHistoryEntry returns null for missing ID", async () => {
    const found = await getHistoryEntry("nonexistent-id");
    expect(found).toBeNull();
  });

  test("queryHistory filters by agentId", async () => {
    // Create entries for different agents
    await createHistoryEntry("test-agent-2", {
      prompt: "Agent 2 prompt",
    });

    const result = await queryHistory({ agentId: "test-agent-2" });
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
    for (const entry of result.entries) {
      expect(entry.agentId).toBe("test-agent-2");
    }
  });

  test("queryHistory filters by outcome", async () => {
    const entry = await createHistoryEntry("test-agent-1", {
      prompt: "Will fail",
    });
    await completeHistoryEntry(
      entry.id,
      { responseSummary: "Error", outcome: "failure", error: "Boom" },
      10,
    );

    const result = await queryHistory({ outcome: ["failure"] });
    expect(result.entries.some((e) => e.outcome === "failure")).toBe(true);
  });

  test("getHistoryStats returns stats structure", async () => {
    const stats = await getHistoryStats();

    expect(typeof stats.totalEntries).toBe("number");
    expect(stats.totalEntries).toBeGreaterThan(0);
    expect(typeof stats.totalPromptTokens).toBe("number");
    expect(typeof stats.totalResponseTokens).toBe("number");
    expect(stats.outcomeDistribution).toBeDefined();
  });

  test("exportHistory as JSON includes entries", async () => {
    const content = await exportHistory({ format: "json" });
    const parsed = JSON.parse(content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  test("exportHistory as CSV has headers", async () => {
    const content = await exportHistory({ format: "csv" });
    const lines = content.split("\n");
    expect(lines[0]).toContain("id");
    expect(lines[0]).toContain("agentId");
  });

  // extractFromOutput is pure — verify it still works without mocks
  test("extractFromOutput works for code blocks", () => {
    const result = extractFromOutput(
      "```typescript\nconst x = 1;\n```",
      "code_blocks",
    );
    expect(result.totalMatches).toBe(1);
  });
});

// ============================================================================
// DCG Service (real DB)
// ============================================================================

describe("DCG Service (real DB)", () => {
  test("getDcgConfig returns configuration", () => {
    const config = getDcgConfig();
    expect(config).toBeDefined();
    expect(Array.isArray(config.enabledPacks)).toBe(true);
  });

  test("updateDcgConfig updates enabled packs", async () => {
    const config = await updateDcgConfig({
      enabledPacks: ["core.git", "core.filesystem"],
    });
    expect(config.enabledPacks).toContain("core.git");
    expect(config.enabledPacks).toContain("core.filesystem");
  });

  test("listPacks returns available packs", () => {
    const packs = listPacks();
    expect(Array.isArray(packs)).toBe(true);
    expect(packs.length).toBeGreaterThan(0);
  });

  test("ingestBlockEvent stores event in DB", async () => {
    const event = {
      agentId: "test-agent-1",
      command: "rm -rf /",
      pattern: "rm -rf",
      reason: "Dangerous recursive deletion",
      severity: "critical" as const,
      pack: "core.filesystem",
      ruleId: "rm-rf-root",
      timestamp: new Date(),
    };

    const result = await ingestBlockEvent(event);
    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
  });

  test("getBlockEvents retrieves stored events", async () => {
    const result = await getBlockEvents({});
    expect(Array.isArray(result.events)).toBe(true);
    expect(result.events.length).toBeGreaterThan(0);
  });

  test("markFalsePositive updates an event", async () => {
    const result = await getBlockEvents({ limit: 1 });
    const events = result.events;
    if (events.length > 0) {
      const result = await markFalsePositive(events[0]!.id);
      expect(result).toBeDefined();
    }
  });

  test("getDcgStats returns statistics", async () => {
    const stats = await getDcgStats();
    expect(stats).toBeDefined();
    expect(typeof stats.totalBlocks).toBe("number");
  });
});
