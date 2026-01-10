import { Database } from "bun:sqlite";

export type TestDatabaseType = "sqlite" | "postgres";

export interface SqlStatement {
  sql: string;
  params?: unknown[];
}

export interface SqliteTestDatabase {
  type: "sqlite";
  db: Database;
  execute: (statement: SqlStatement) => void;
  close: () => void;
}

export interface PostgresTestDatabase {
  type: "postgres";
  client: {
    query: (sql: string, params?: unknown[]) => Promise<unknown>;
    end: () => Promise<void>;
  };
  execute: (statement: SqlStatement) => Promise<unknown>;
  close: () => Promise<void>;
}

export type TestDatabase = SqliteTestDatabase | PostgresTestDatabase;

export interface CreateTestDatabaseOptions {
  type?: TestDatabaseType;
  sqlitePath?: string;
  postgresUrl?: string;
}

export async function createTestDatabase(
  options: CreateTestDatabaseOptions = {},
): Promise<TestDatabase> {
  const type = options.type ?? "sqlite";

  if (type === "sqlite") {
    const path = options.sqlitePath ?? ":memory:";
    const db = new Database(path);
    return {
      type: "sqlite",
      db,
      execute: ({ sql, params }) => {
        if (params && params.length > 0) {
          db.query(sql).run(...params);
        } else {
          db.exec(sql);
        }
      },
      close: () => {
        db.close();
      },
    };
  }

  const { postgresUrl } = options;
  if (!postgresUrl) {
    throw new Error(
      "createTestDatabase: postgresUrl is required for postgres databases.",
    );
  }

  let PgClient:
    | (new (options: {
        connectionString: string;
      }) => {
        connect: () => Promise<void>;
        query: (sql: string, params?: unknown[]) => Promise<unknown>;
        end: () => Promise<void>;
      })
    | undefined;
  try {
    const moduleName = "pg";
    const pgModule = (await import(moduleName)) as {
      Client: new (options: {
        connectionString: string;
      }) => {
        connect: () => Promise<void>;
        query: (sql: string, params?: unknown[]) => Promise<unknown>;
        end: () => Promise<void>;
      };
    };
    PgClient = pgModule.Client;
  } catch (error) {
    throw new Error(
      'createTestDatabase: postgres support requires the "pg" package. Install it in the workspace to use postgres test utils.',
      { cause: error },
    );
  }

  const client = new PgClient({ connectionString: postgresUrl });
  await client.connect();

  return {
    type: "postgres",
    client,
    execute: ({ sql, params }) => client.query(sql, params),
    close: () => client.end(),
  };
}

export async function seedTestData(
  database: TestDatabase,
  statements: SqlStatement[],
): Promise<void> {
  for (const statement of statements) {
    if (database.type === "sqlite") {
      database.execute(statement);
    } else {
      await database.execute(statement);
    }
  }
}

export async function cleanupTestData(
  database: TestDatabase,
  statements: SqlStatement[],
): Promise<void> {
  await seedTestData(database, statements);
}
