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
const rawSlowQueryThresholdMs = Number(process.env["DB_SLOW_QUERY_MS"] ?? 100);
const slowQueryThresholdMs = Number.isFinite(rawSlowQueryThresholdMs)
  ? rawSlowQueryThresholdMs
  : 100;

class PinoLogWriter implements LogWriter {
  write(message: string) {
    logger.debug({ type: "db", message }, "db:query");
  }
}

const drizzleLogger = isDev
  ? new DefaultLogger({ writer: new PinoLogWriter() })
  : false;

const dbFile = process.env["DB_FILE_NAME"] ?? "./data/gateway.db";
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

export const db = drizzle(sqlite, { schema, logger: drizzleLogger });

const shouldAutoMigrate =
  dbFile === ":memory:" ||
  process.env["DB_AUTO_MIGRATE"] === "1" ||
  process.env["DB_AUTO_MIGRATE"] === "true";

if (shouldAutoMigrate) {
  const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url));
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
