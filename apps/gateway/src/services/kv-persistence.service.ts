/**
 * Durable SQLite Key-Value Persistence Service (bd-7ojci.5)
 *
 * Provides write-through and read-through SQLite storage (`gateway_kv_store`)
 * for control-plane services (`config.service.ts`, `feature-flag.service.ts`,
 * `cost-cap.service.ts`, and `secrets-provider.service.ts`) so runtime state
 * survives process restarts.
 */

import { sqlite } from "../db";

let tableInitialized = false;

function ensureKvTable(): void {
  if (tableInitialized) return;
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS gateway_kv_store (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, key)
      )
    `);
    tableInitialized = true;
  } catch {
    // Ignore if sqlite is closed during teardown
  }
}

export function kvSet<T>(namespace: string, key: string, value: T): void {
  ensureKvTable();
  try {
    sqlite
      .query(
        `INSERT OR REPLACE INTO gateway_kv_store (namespace, key, value_json, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(namespace, key, JSON.stringify(value), Date.now());
  } catch {
    // Non-fatal fallback if DB is closed
  }
}

export function kvGet<T>(namespace: string, key: string): T | undefined {
  ensureKvTable();
  try {
    const row = sqlite
      .query(
        `SELECT value_json FROM gateway_kv_store WHERE namespace = ? AND key = ? LIMIT 1`,
      )
      .get(namespace, key) as { value_json?: string } | null;
    if (!row || typeof row.value_json !== "string") return undefined;
    return JSON.parse(row.value_json) as T;
  } catch {
    return undefined;
  }
}

export function kvGetAll<T>(
  namespace: string,
): Array<{ key: string; value: T; updatedAt: number }> {
  ensureKvTable();
  try {
    const rows = sqlite
      .query(
        `SELECT key, value_json, updated_at FROM gateway_kv_store WHERE namespace = ? ORDER BY updated_at ASC`,
      )
      .all(namespace) as Array<{
      key: string;
      value_json: string;
      updated_at: number;
    }>;
    const out: Array<{ key: string; value: T; updatedAt: number }> = [];
    for (const row of rows) {
      try {
        out.push({
          key: row.key,
          value: JSON.parse(row.value_json) as T,
          updatedAt: Number(row.updated_at),
        });
      } catch {
        // Skip malformed entry
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function kvDelete(namespace: string, key: string): void {
  ensureKvTable();
  try {
    sqlite
      .query(`DELETE FROM gateway_kv_store WHERE namespace = ? AND key = ?`)
      .run(namespace, key);
  } catch {
    // Ignore
  }
}

export function kvClearNamespace(namespace: string): void {
  ensureKvTable();
  try {
    sqlite
      .query(`DELETE FROM gateway_kv_store WHERE namespace = ?`)
      .run(namespace);
  } catch {
    // Ignore
  }
}
