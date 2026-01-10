import { blob, integer, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    repoUrl: text("repo_url").notNull(),
    task: text("task").notNull(),
    status: text("status").notNull().default("idle"),
    model: text("model").notNull().default("sonnet-4"),
    accountId: text("account_id").references(() => accounts.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("agents_status_idx").on(table.status),
    index("agents_account_idx").on(table.accountId),
    index("agents_created_at_idx").on(table.createdAt),
  ],
);

export const checkpoints = sqliteTable(
  "checkpoints",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    state: blob("state", { mode: "json" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("checkpoints_agent_idx").on(table.agentId),
    index("checkpoints_created_at_idx").on(table.createdAt),
  ],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    apiKeyHash: text("api_key_hash").notNull(),
    role: text("role").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("accounts_email_idx").on(table.email),
    uniqueIndex("accounts_api_key_hash_idx").on(table.apiKeyHash),
  ],
);

export const history = sqliteTable(
  "history",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    command: text("command").notNull(),
    input: blob("input", { mode: "json" }),
    output: blob("output", { mode: "json" }),
    durationMs: integer("duration_ms").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("history_agent_idx").on(table.agentId),
    index("history_command_idx").on(table.command),
    index("history_created_at_idx").on(table.createdAt),
  ],
);

export const alerts = sqliteTable(
  "alerts",
  {
    id: text("id").primaryKey(),
    severity: text("severity").notNull(),
    message: text("message").notNull(),
    acknowledged: integer("acknowledged", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("alerts_severity_idx").on(table.severity)],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").references(() => accounts.id),
    action: text("action").notNull(),
    resource: text("resource").notNull(),
    resourceType: text("resource_type").notNull(),
    outcome: text("outcome").notNull(),
    correlationId: text("correlation_id"),
    metadata: blob("metadata", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("audit_logs_account_idx").on(table.accountId),
    index("audit_logs_action_idx").on(table.action),
    index("audit_logs_created_at_idx").on(table.createdAt),
  ],
);

export const dcgBlocks = sqliteTable(
  "dcg_blocks",
  {
    id: text("id").primaryKey(),
    pattern: text("pattern").notNull(),
    reason: text("reason").notNull(),
    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("dcg_blocks_created_at_idx").on(table.createdAt)],
);

export const dcgAllowlist = sqliteTable(
  "dcg_allowlist",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id").notNull(),
    pattern: text("pattern").notNull(),
    approvedBy: text("approved_by"),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [uniqueIndex("dcg_allowlist_rule_id_idx").on(table.ruleId)],
);

export const fleetRepos = sqliteTable(
  "fleet_repos",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    branch: text("branch").notNull(),
    path: text("path").notNull(),
    status: text("status").notNull(),
    lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [uniqueIndex("fleet_repos_path_idx").on(table.path)],
);

export const agentSweeps = sqliteTable(
  "agent_sweeps",
  {
    id: text("id").primaryKey(),
    query: text("query").notNull(),
    action: text("action").notNull(),
    status: text("status").notNull(),
    affectedCount: integer("affected_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("agent_sweeps_status_idx").on(table.status)],
);
