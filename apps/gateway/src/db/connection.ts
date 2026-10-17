import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { DefaultLogger, type LogWriter } from "drizzle-orm/logger";
import { logger } from "../services/logger";
import * as schema from "./schema";

const isDev = process.env["NODE_ENV"] !== "production";
const isTest =
  process.env["NODE_ENV"] === "test" || process.env["BUN_TEST"] === "1";
const rawSlowQueryThresholdMs = Number(process.env["DB_SLOW_QUERY_MS"] ?? 100);
const slowQueryThresholdMs = Number.isFinite(rawSlowQueryThresholdMs)
  ? rawSlowQueryThresholdMs
  : 100;

class PinoLogWriter implements LogWriter {
  write(message: string) {
    logger.debug({ type: "db", message }, "db:query");
  }
}

const drizzleLogger =
  isDev && !isTest ? new DefaultLogger({ writer: new PinoLogWriter() }) : false;

type DatabaseUrlParseResult =
  | { ok: true; dbFile: string }
  | { ok: false; reason: "unsupported_scheme" | "invalid"; value: string };

function parseSqliteDbFileFromDatabaseUrl(
  value: string,
): DatabaseUrlParseResult {
  const raw = value.trim();
  if (raw.length === 0) {
    return { ok: false, reason: "invalid", value };
  }

  // Accept plain sqlite db paths as well (e.g. "./data/gateway.db").
  // Treat URL-looking values as unsupported unless they are file/sqlite.
  const schemeMatch = raw.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (schemeMatch) {
    const scheme = schemeMatch[1]?.toLowerCase();
    if (
      scheme &&
      scheme !== "file" &&
      scheme !== "sqlite" &&
      scheme !== "sqlite3"
    ) {
      return { ok: false, reason: "unsupported_scheme", value: raw };
    }
  }

  if (raw.startsWith("file://")) {
    try {
      return { ok: true, dbFile: fileURLToPath(new URL(raw)) };
    } catch {
      return { ok: false, reason: "invalid", value: raw };
    }
  }

  for (const prefix of ["file:", "sqlite:", "sqlite3:"] as const) {
    if (!raw.startsWith(prefix)) continue;
    const rest = raw.slice(prefix.length);
    const dbFile = rest.trim();
    if (dbFile.length === 0) {
      return { ok: false, reason: "invalid", value: raw };
    }
    // For sqlite-ish prefixes without //, we treat the remainder as a file path.
    return { ok: true, dbFile };
  }

  return { ok: true, dbFile: raw };
}

function resolveDbFile(defaultDbFile: string): string {
  const explicit = process.env["DB_FILE_NAME"]?.trim();
  if (explicit) return explicit;

  const legacyPath =
    process.env["DATABASE_PATH"]?.trim() ?? process.env["DB_PATH"]?.trim();

  const databaseUrl = process.env["DATABASE_URL"]?.trim();
  if (databaseUrl) {
    const parsed = parseSqliteDbFileFromDatabaseUrl(databaseUrl);
    if (parsed.ok) return parsed.dbFile;

    const message =
      parsed.reason === "unsupported_scheme"
        ? "DATABASE_URL uses an unsupported scheme; only SQLite file URLs/paths are supported"
        : "DATABASE_URL is invalid";

    if (legacyPath) {
      logger.warn(
        { databaseUrl, reason: parsed.reason },
        `${message}; falling back to legacy DB path`,
      );
      return legacyPath;
    }

    // In development we fall back to the default sqlite file to avoid surprising crashes
    // from unrelated shell env vars. In production we fail fast to avoid silently using
    // the wrong database.
    if (isDev || isTest) {
      logger.warn(
        { databaseUrl, reason: parsed.reason },
        `${message}; falling back to default sqlite path`,
      );
      return defaultDbFile;
    }
    throw new Error(`${message}: ${databaseUrl}`);
  }

  if (legacyPath) return legacyPath;

  return defaultDbFile;
}

const defaultDbFile = isTest ? ":memory:" : "./data/gateway.db";
const dbFile = resolveDbFile(defaultDbFile);
if (dbFile !== ":memory:") {
  const dir = dirname(dbFile);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // If directory creation fails, sqlite will surface the error on open.
  }
}
const sqlite = new Database(dbFile);

sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA synchronous = NORMAL");
sqlite.exec("PRAGMA foreign_keys = ON");
sqlite.exec("PRAGMA busy_timeout = 5000");

export const db = drizzle(sqlite, { schema, logger: drizzleLogger });

const shouldAutoMigrate =
  isTest ||
  dbFile === ":memory:" ||
  process.env["DB_AUTO_MIGRATE"] === "1" ||
  process.env["DB_AUTO_MIGRATE"] === "true";

if (shouldAutoMigrate) {
  const migrationsFolder = fileURLToPath(
    new URL("./migrations", import.meta.url),
  );
  migrate(db, { migrationsFolder });
}

// Export underlying sqlite client for raw SQL in tests
export { sqlite };

export function logSlowQuery(details: {
  sql: string;
  params?: unknown[];
  durationMs: number;
}): void {
  if (details.durationMs < slowQueryThresholdMs) return;
  logger.warn(
    {
      type: "db",
      sql: details.sql,
      params: details.params,
      durationMs: details.durationMs,
      thresholdMs: slowQueryThresholdMs,
    },
    "db:slow-query",
  );
}

export function closeDatabase(): void {
  sqlite.close();
}
