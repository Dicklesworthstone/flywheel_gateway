/**
 * Gateway Test Harness
 *
 * Boots the gateway with a real temp SQLite DB, runs all migrations,
 * and provides helpers for seeding, cleanup, and spinning up the
 * HTTP server + WebSocket hub for integration tests.
 *
 * Usage:
 * ```ts
 * import { createGatewayHarness } from "@flywheel/test-utils";
 *
 * const harness = await createGatewayHarness();
 * // harness.db       — drizzle instance with full schema
 * // harness.sqlite   — raw bun:sqlite Database
 * // harness.seed()   — insert test rows
 * // harness.cleanup() — drop all data (TRUNCATE-like)
 * // harness.close()  — close DB and remove temp file
 * ```
 *
 * For server-level integration tests:
 * ```ts
 * const harness = await createGatewayHarness({ startServer: true });
 * // harness.baseUrl  — e.g. "http://localhost:44321"
 * // harness.fetch()  — shorthand for fetch against baseUrl
 * // harness.stop()   — stop server, close DB, remove temp file
 * ```
 */

import { Database } from "bun:sqlite";
import { readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

/** Path to the gateway migration SQL files (resolved at import time). */
const MIGRATIONS_DIR = join(
  import.meta.dir,
  "../../../apps/gateway/src/db/migrations",
);

/** Path to the gateway schema module. */
const SCHEMA_PATH = "../../../apps/gateway/src/db/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GatewayHarnessOptions {
  /** Start the Bun HTTP server (needed for route / WS tests). Default: false */
  startServer?: boolean;
  /** Explicit port; 0 = random ephemeral port (default). */
  port?: number;
  /** Extra environment variables to set during the test run. */
  env?: Record<string, string>;
}

export interface SeedRow {
  table: string;
  values: Record<string, unknown>;
}

export interface GatewayHarness {
  /** Drizzle ORM instance wired to the temp DB with the full gateway schema. */
  db: BunSQLiteDatabase<Record<string, unknown>>;
  /** Raw bun:sqlite Database for escape-hatch SQL. */
  sqlite: Database;
  /** Absolute path to the temp DB file. */
  dbPath: string;
  /** Gateway schema tables (accounts, agents, etc.) for use with db.select().from(). */
  schema: Record<string, unknown>;

  // -- Data helpers --

  /** Insert rows into the test database. */
  seed(rows: SeedRow[]): void;
  /** Execute raw SQL statements against the test database. */
  exec(statements: string[]): void;
  /** Delete all rows from every table (order-safe via PRAGMA foreign_keys OFF). */
  cleanup(): void;

  // -- Server helpers (only available when startServer: true) --

  /** Base URL of the running server, e.g. "http://localhost:54321". */
  baseUrl?: string;
  /** Convenience fetch that prepends baseUrl. */
  fetch?: (path: string, init?: RequestInit) => Promise<Response>;

  // -- Lifecycle --

  /** Stop server (if started), close DB, remove temp file. */
  close(): void;
}

// ---------------------------------------------------------------------------
// Migration runner
// ---------------------------------------------------------------------------

/**
 * Applies all Drizzle-kit SQL migration files in order to the given
 * bun:sqlite Database. Migrations use "--> statement-breakpoint" as
 * a delimiter between statements.
 */
function runMigrations(sqliteDb: Database): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // Create the Drizzle migrations tracking table so drizzle-kit doesn't
  // try to re-run these if the production migrator is invoked later.
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at INTEGER
    )
  `);

  for (const file of files) {
    const raw = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    // Drizzle-kit uses "--> statement-breakpoint" to delimit statements
    const statements = raw
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      sqliteDb.exec(stmt);
    }

    // Record the migration so it won't be replayed
    sqliteDb
      .query(
        `INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)`,
      )
      .run(file, Date.now());
  }
}

// ---------------------------------------------------------------------------
// Table list helper
// ---------------------------------------------------------------------------

interface TableRow {
  name: string;
}

function getAllTableNames(sqliteDb: Database): string[] {
  const rows = sqliteDb
    .query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'`,
    )
    .all() as TableRow[];
  return rows.map((r) => r.name);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export async function createGatewayHarness(
  options: GatewayHarnessOptions = {},
): Promise<GatewayHarness> {
  const { startServer = false, port = 0, env = {} } = options;

  // 1. Create temp DB file
  const dbPath = join(
    tmpdir(),
    `flywheel-test-${process.pid}-${Date.now()}.db`,
  );
  const sqliteDb = new Database(dbPath);

  // Apply standard PRAGMAs
  sqliteDb.exec("PRAGMA journal_mode = WAL");
  sqliteDb.exec("PRAGMA synchronous = NORMAL");
  sqliteDb.exec("PRAGMA foreign_keys = ON");

  // 2. Run all migrations
  runMigrations(sqliteDb);

  // 3. Wrap with Drizzle ORM (dynamic import to get the schema)
  const schema = await import(SCHEMA_PATH);
  const db = drizzle(sqliteDb, { schema });

  // 4. Build seed helper
  function seed(rows: SeedRow[]): void {
    for (const row of rows) {
      const columns = Object.keys(row.values);
      const placeholders = columns.map(() => "?").join(", ");
      const colNames = columns.map((c) => `"${c}"`).join(", ");
      const vals = columns.map((c) => {
        const v = row.values[c];
        // Convert Date objects to unix timestamps (Drizzle integer timestamps)
        if (v instanceof Date) return Math.floor(v.getTime() / 1000);
        // Convert objects/arrays to JSON strings
        if (v !== null && typeof v === "object") return JSON.stringify(v);
        return v;
      });
      sqliteDb
        .query(`INSERT INTO "${row.table}" (${colNames}) VALUES (${placeholders})`)
        .run(...(vals as Parameters<ReturnType<Database["query"]>["run"]>));
    }
  }

  function exec(statements: string[]): void {
    for (const stmt of statements) {
      sqliteDb.exec(stmt);
    }
  }

  function cleanup(): void {
    sqliteDb.exec("PRAGMA foreign_keys = OFF");
    for (const table of getAllTableNames(sqliteDb)) {
      sqliteDb.exec(`DELETE FROM "${table}"`);
    }
    sqliteDb.exec("PRAGMA foreign_keys = ON");
  }

  // 5. Optionally start server
  let baseUrl: string | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  let fetchFn: ((path: string, init?: RequestInit) => Promise<Response>) | undefined;
  let restoreEnv: (() => void) | undefined;

  if (startServer) {
    // Set env so the gateway's connection.ts picks up our temp DB
    const savedEnv: Record<string, string | undefined> = {};
    savedEnv["DB_FILE_NAME"] = process.env["DB_FILE_NAME"];
    savedEnv["NODE_ENV"] = process.env["NODE_ENV"];
    process.env["DB_FILE_NAME"] = dbPath;
    process.env["NODE_ENV"] = "test";
    for (const [k, v] of Object.entries(env)) {
      savedEnv[k] = process.env[k];
      process.env[k] = v;
    }

    restoreEnv = () => {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
          delete process.env[key];
          continue;
        }
        process.env[key] = value;
      }
    };

    // Dynamic import to get the Hono app (it will use the env we just set)
    const { default: app } = await import(
      "../../../apps/gateway/src/index"
    );

    server = Bun.serve({
      fetch: app.fetch,
      port: port || 0,
    });

    baseUrl = `http://localhost:${server.port}`;
    fetchFn = (path: string, init?: RequestInit) =>
      fetch(`${baseUrl}${path}`, init);
  }

  function close(): void {
    try {
      restoreEnv?.();
    } catch {
      // ignore
    }
    try {
      server?.stop(true);
    } catch {
      // ignore
    }
    try {
      sqliteDb.close();
    } catch {
      // ignore
    }
    try {
      unlinkSync(dbPath);
    } catch {
      // ignore
    }
    // Also clean up WAL/SHM files
    try {
      unlinkSync(`${dbPath}-wal`);
    } catch {
      // ignore
    }
    try {
      unlinkSync(`${dbPath}-shm`);
    } catch {
      // ignore
    }
  }

  return {
    db,
    sqlite: sqliteDb,
    dbPath,
    schema,
    seed,
    exec,
    cleanup,
    baseUrl,
    fetch: fetchFn,
    close,
  };
}
