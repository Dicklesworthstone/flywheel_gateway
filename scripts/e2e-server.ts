#!/usr/bin/env bun
/**
 * E2E Test Server Bootstrap
 *
 * Boots the gateway API against a temp seeded SQLite DB and exposes
 * a health endpoint. Designed to be used by Playwright's webServer
 * config or run standalone for local E2E development.
 *
 * Usage:
 *   bun scripts/e2e-server.ts              # Start on default port 3456
 *   E2E_GATEWAY_PORT=4000 bun scripts/e2e-server.ts
 *
 * The script:
 * 1. Creates a temp SQLite DB in /tmp
 * 2. Runs all gateway migrations
 * 3. Seeds the DB with baseline test data (accounts, agents)
 * 4. Starts the Hono server on the configured port
 * 5. Prints the base URL to stdout for Playwright to detect
 * 6. Cleans up temp DB on SIGINT/SIGTERM
 */

import { Database } from "bun:sqlite";
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env["E2E_GATEWAY_PORT"] ?? 3456);
const ADMIN_KEY = process.env["E2E_GATEWAY_ADMIN_KEY"] ?? "e2e-admin-key";
const MIGRATIONS_DIR = join(
  import.meta.dir,
  "../apps/gateway/src/db/migrations",
);

// ---------------------------------------------------------------------------
// 1. Create temp DB and run migrations
// ---------------------------------------------------------------------------

const repoRoot = join(import.meta.dir, "..");
const workspaceRoot = mkdtempSync(join(tmpdir(), "flywheel-e2e-"));

// Isolate Beads/BR/BV state for E2E runs so tests don't mutate the repo's real
// `.beads/` directory via /beads CRUD endpoints.
try {
  cpSync(join(repoRoot, ".beads"), join(workspaceRoot, ".beads"), {
    recursive: true,
  });
} catch {
  // If the repo doesn't have .beads yet, the gateway will create it on demand.
}

const dbPath = join(workspaceRoot, "gateway.db");
const sqliteDb = new Database(dbPath);

sqliteDb.exec("PRAGMA journal_mode = WAL");
sqliteDb.exec("PRAGMA synchronous = NORMAL");
sqliteDb.exec("PRAGMA foreign_keys = ON");

// Run migrations
sqliteDb.exec(`
  CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL,
    created_at INTEGER
  )
`);

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

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

// ---------------------------------------------------------------------------
// 2. Seed baseline test data
// ---------------------------------------------------------------------------

const now = Math.floor(Date.now() / 1000);

sqliteDb.exec(`
  INSERT INTO accounts (id, email, api_key_hash, role, created_at, updated_at)
  VALUES ('e2e-account-1', 'e2e@test.flywheel.dev', 'e2e-hash-001', 'admin', ${now}, ${now});
`);

sqliteDb.exec(`
  INSERT INTO agents (id, repo_url, task, status, model, account_id, created_at, updated_at)
  VALUES ('e2e-agent-1', 'https://github.com/test/e2e-repo', 'E2E test agent', 'idle', 'sonnet-4', 'e2e-account-1', ${now}, ${now});
`);

sqliteDb.close();

// ---------------------------------------------------------------------------
// 3. Set env and start gateway
// ---------------------------------------------------------------------------

process.env["DB_FILE_NAME"] = dbPath;
process.env["NODE_ENV"] = "test";
process.env["GATEWAY_ADMIN_KEY"] = ADMIN_KEY;
process.env["BEADS_PROJECT_ROOT"] = workspaceRoot;

// Dynamic import so it picks up the env vars
const { default: app } = await import("../apps/gateway/src/index");

const server = Bun.serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`E2E gateway listening on http://localhost:${server.port}`);
console.log(`DB: ${dbPath}`);

// ---------------------------------------------------------------------------
// 4. Cleanup on exit
// ---------------------------------------------------------------------------

function cleanup() {
  console.log("\nShutting down E2E server...");
  try {
    server.stop(true);
  } catch {
    /* ignore */
  }

  // Safety: only delete under the OS temp dir.
  try {
    const tmp = tmpdir();
    if (
      workspaceRoot.startsWith(tmp) &&
      workspaceRoot.includes("flywheel-e2e-")
    ) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }

  console.log("Cleanup complete.");
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
