import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createGatewayHarness, type GatewayHarness } from "../gateway-harness";

let harness: GatewayHarness | null = null;

afterEach(() => {
  harness?.close();
  harness = null;
});

describe("createGatewayHarness", () => {
  test("creates temp DB with all gateway tables", async () => {
    harness = await createGatewayHarness();

    expect(harness.dbPath).toContain("flywheel-test-");
    expect(existsSync(harness.dbPath)).toBe(true);

    // Should have many tables from migrations
    const tables = harness.sqlite
      .query(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as { name: string }[];

    expect(tables.length).toBeGreaterThan(10);

    // Core tables should exist
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("accounts");
    expect(tableNames).toContain("agents");
    expect(tableNames).toContain("alerts");
    expect(tableNames).toContain("checkpoints");
    expect(tableNames).toContain("history");
  });

  test("seed inserts rows into specified tables", async () => {
    harness = await createGatewayHarness();

    harness.seed([
      {
        table: "accounts",
        values: {
          id: "acct-1",
          email: "test@example.com",
          api_key_hash: "hash123",
          role: "admin",
          created_at: new Date(),
          updated_at: new Date(),
        },
      },
    ]);

    const rows = harness.sqlite.query("SELECT * FROM accounts").all() as {
      id: string;
      email: string;
    }[];
    expect(rows).toHaveLength(1);
    const firstRow = rows[0];
    expect(firstRow).toBeDefined();
    expect(firstRow!.id).toBe("acct-1");
    expect(firstRow!.email).toBe("test@example.com");
  });

  test("seed handles foreign key relationships", async () => {
    harness = await createGatewayHarness();

    harness.seed([
      {
        table: "accounts",
        values: {
          id: "acct-1",
          email: "fk@test.com",
          api_key_hash: "hash",
          role: "user",
          created_at: new Date(),
          updated_at: new Date(),
        },
      },
      {
        table: "agents",
        values: {
          id: "agent-1",
          repo_url: "https://github.com/test/repo",
          task: "run tests",
          status: "idle",
          model: "sonnet-4",
          account_id: "acct-1",
          created_at: new Date(),
          updated_at: new Date(),
        },
      },
    ]);

    const agents = harness.sqlite.query("SELECT * FROM agents").all();
    expect(agents).toHaveLength(1);
  });

  test("cleanup removes all data from all tables", async () => {
    harness = await createGatewayHarness();

    harness.seed([
      {
        table: "accounts",
        values: {
          id: "acct-1",
          email: "cleanup@test.com",
          api_key_hash: "h",
          role: "admin",
          created_at: new Date(),
          updated_at: new Date(),
        },
      },
    ]);

    expect(
      harness.sqlite.query("SELECT COUNT(*) as c FROM accounts").get(),
    ).toEqual({ c: 1 });

    harness.cleanup();

    expect(
      harness.sqlite.query("SELECT COUNT(*) as c FROM accounts").get(),
    ).toEqual({ c: 0 });
  });

  test("exec runs raw SQL statements", async () => {
    harness = await createGatewayHarness();

    harness.exec([
      `INSERT INTO accounts (id, email, api_key_hash, role, created_at, updated_at) VALUES ('raw-1', 'raw@test.com', 'h', 'admin', 0, 0)`,
    ]);

    const rows = harness.sqlite.query("SELECT * FROM accounts").all();
    expect(rows).toHaveLength(1);
  });

  test("drizzle ORM queries work with schema", async () => {
    harness = await createGatewayHarness();

    harness.seed([
      {
        table: "accounts",
        values: {
          id: "drizzle-1",
          email: "drizzle@test.com",
          api_key_hash: "h",
          role: "admin",
          created_at: new Date(),
          updated_at: new Date(),
        },
      },
    ]);

    // Use drizzle select API with schema
    const { accounts } = harness.schema as {
      accounts: Parameters<typeof harness.db.select>[0];
    };
    const result = harness.db.select().from(accounts as any).all();
    expect(result).toHaveLength(1);
  });

  test("close removes temp DB files", async () => {
    harness = await createGatewayHarness();
    const path = harness.dbPath;
    expect(existsSync(path)).toBe(true);

    harness.close();
    harness = null; // prevent double-close in afterEach

    expect(existsSync(path)).toBe(false);
  });

  test("each harness gets an isolated database", async () => {
    const h1 = await createGatewayHarness();
    const h2 = await createGatewayHarness();

    h1.seed([
      {
        table: "accounts",
        values: {
          id: "iso-1",
          email: "iso@test.com",
          api_key_hash: "h",
          role: "admin",
          created_at: new Date(),
          updated_at: new Date(),
        },
      },
    ]);

    // h2 should have no data
    const h2rows = h2.sqlite.query("SELECT * FROM accounts").all();
    expect(h2rows).toHaveLength(0);

    h1.close();
    h2.close();
  });
});
