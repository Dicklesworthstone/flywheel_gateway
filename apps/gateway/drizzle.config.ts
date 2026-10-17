import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

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
    // Avoid throwing inside drizzle-kit config; keep behavior predictable and
    // let runtime validation handle strictness.
    if (legacyPath) return legacyPath;
  }

  if (legacyPath) return legacyPath;

  return defaultDbFile;
}

const defaultDbFile = fileURLToPath(
  new URL("../../data/gateway.db", import.meta.url),
);
const dbFile = resolveDbFile(defaultDbFile);

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: dbFile,
  },
  verbose: true,
  strict: true,
});
