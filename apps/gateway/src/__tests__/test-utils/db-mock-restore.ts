/**
 * Utility for restoring real modules after tests that mock them.
 *
 * PROBLEM: Bun's mock.module() persists across test files, causing test pollution.
 * When one test file mocks "../db" or "drizzle-orm", other test files that run later
 * get the mock instead of the real module, causing failures.
 *
 * SOLUTION: Tests that mock these modules should call the restore functions in afterAll
 * to restore the real modules for subsequent test files.
 *
 * USAGE:
 * ```ts
 * import { afterAll } from "bun:test";
 * import { restoreRealDb, restoreDrizzleOrm } from "./test-utils/db-mock-restore";
 *
 * // Your mock.module calls here
 *
 * afterAll(() => {
 *   restoreRealDb();
 *   restoreDrizzleOrm(); // if you mocked drizzle-orm
 * });
 * ```
 */

import { Database } from "bun:sqlite";
import { mock } from "bun:test";
import * as drizzleOrmExports from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../db/schema";

// Create a fresh connection to the real database
// This is created at import time, before any mocks are applied
const dbFile = process.env["DB_FILE_NAME"] ?? "./data/gateway.db";

/**
 * Restore the real db module after tests that mock it.
 * Call this in afterAll() for any test file that uses mock.module("../db", ...).
 */
export function restoreRealDb(): void {
  // Create a fresh database connection
  const realSqlite = new Database(dbFile);
  realSqlite.exec("PRAGMA journal_mode = WAL");
  realSqlite.exec("PRAGMA synchronous = NORMAL");
  realSqlite.exec("PRAGMA foreign_keys = ON");

  const realDb = drizzle(realSqlite, { schema });

  // Re-mock with the real implementation to restore for other test files
  mock.module("../../db", () => ({
    db: realDb,
    sqlite: realSqlite,
    ...schema,
  }));

  // Also restore the relative path that tests use
  mock.module("../db", () => ({
    db: realDb,
    sqlite: realSqlite,
    ...schema,
  }));
}

/**
 * Restore the real drizzle-orm module after tests that mock it.
 * Call this in afterAll() for any test file that uses mock.module("drizzle-orm", ...).
 */
export function restoreDrizzleOrm(): void {
  mock.module("drizzle-orm", () => drizzleOrmExports);
}

/**
 * Restore the real utils/response module after tests that mock it.
 * Call this in afterAll() for any test file that uses mock.module("../utils/response", ...).
 */
export function restoreResponseUtils(): void {
  // Import the real module dynamically to avoid circular dependencies
  const realResponse = require("../../utils/response");
  mock.module("../utils/response", () => realResponse);
  mock.module("../../utils/response", () => realResponse);
}

/**
 * Restore the real middleware/correlation module after tests that mock it.
 * Call this in afterAll() for any test file that uses mock.module("../middleware/correlation", ...).
 */
export function restoreCorrelation(): void {
  const realCorrelation = require("../../middleware/correlation");
  mock.module("../middleware/correlation", () => realCorrelation);
  mock.module("../../middleware/correlation", () => realCorrelation);
}
