import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { DefaultLogger, type LogWriter } from "drizzle-orm/logger";
import { logger } from "../services/logger";
import * as schema from "./schema";

const isDev = process.env["NODE_ENV"] !== "production";
const slowQueryThresholdMs = Number(process.env["DB_SLOW_QUERY_MS"] ?? 100);

class PinoLogWriter implements LogWriter {
  write(message: string) {
    logger.debug({ type: "db", message }, "db:query");
  }
}

const drizzleLogger = isDev ? new DefaultLogger({ writer: new PinoLogWriter() }) : false;

const dbFile = process.env["DB_FILE_NAME"] ?? "./data/gateway.db";
const sqlite = new Database(dbFile);

sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA synchronous = NORMAL");
sqlite.exec("PRAGMA foreign_keys = ON");

export const db = drizzle(sqlite, { schema, logger: drizzleLogger });

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
