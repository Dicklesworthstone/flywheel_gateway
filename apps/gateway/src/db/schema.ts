import {
  blob,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
    falsePositive: integer("false_positive", { mode: "boolean" })
      .notNull()
      .default(false),
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
    reason: text("reason"),
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

// ============================================================================
// CAAM (Coding Agent Account Manager) Tables
// ============================================================================

/**
 * Account profiles for BYOA (Bring Your Own Account).
 * Gateway stores only metadata - auth artifacts live in workspace containers.
 */
export const accountProfiles = sqliteTable(
  "account_profiles",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    provider: text("provider").notNull(), // 'claude' | 'codex' | 'gemini'
    name: text("name").notNull(), // Profile label (e.g., "work", "personal")
    authMode: text("auth_mode").notNull(), // 'oauth_browser' | 'device_code' | 'api_key'

    // Status & health (no secrets)
    status: text("status").notNull().default("unlinked"), // 'unlinked' | 'linked' | 'verified' | 'expired' | 'cooldown' | 'error'
    statusMessage: text("status_message"),
    healthScore: integer("health_score"), // 0..100 (gateway-computed)
    healthStatus: text("health_status"), // 'unknown' | 'healthy' | 'warning' | 'critical'
    lastVerifiedAt: integer("last_verified_at", { mode: "timestamp" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }), // Legacy
    cooldownUntil: integer("cooldown_until", { mode: "timestamp" }),
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),

    // Health penalty tracking (harmonized with CAAM CLI health/storage.go)
    tokenExpiresAt: integer("token_expires_at", { mode: "timestamp" }),
    lastErrorAt: integer("last_error_at", { mode: "timestamp" }),
    errorCount1h: integer("error_count_1h").default(0),
    penaltyScore: real("penalty_score").default(0),
    penaltyUpdatedAt: integer("penalty_updated_at", { mode: "timestamp" }),
    planType: text("plan_type"), // 'free' | 'pro' | 'enterprise'

    // Auth artifacts metadata (no secrets)
    authFilesPresent: integer("auth_files_present", { mode: "boolean" })
      .notNull()
      .default(false),
    authFileHash: text("auth_file_hash"),
    storageMode: text("storage_mode"), // 'file' | 'keyring' | 'unknown'

    // Labels for organization
    labels: blob("labels", { mode: "json" }).$type<string[]>(),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("account_profiles_workspace_idx").on(table.workspaceId),
    index("account_profiles_provider_idx").on(table.provider),
    index("account_profiles_status_idx").on(table.status),
    index("account_profiles_workspace_provider_idx").on(
      table.workspaceId,
      table.provider,
    ),
  ],
);

/**
 * Account pools group profiles by provider for rotation.
 */
export const accountPools = sqliteTable(
  "account_pools",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    provider: text("provider").notNull(), // 'claude' | 'codex' | 'gemini'
    rotationStrategy: text("rotation_strategy").notNull().default("smart"), // 'smart' | 'round_robin' | 'least_recent' | 'random'
    cooldownMinutesDefault: integer("cooldown_minutes_default")
      .notNull()
      .default(15),
    maxRetries: integer("max_retries").notNull().default(3),
    activeProfileId: text("active_profile_id"),
    lastRotatedAt: integer("last_rotated_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("account_pools_workspace_idx").on(table.workspaceId),
    uniqueIndex("account_pools_workspace_provider_idx").on(
      table.workspaceId,
      table.provider,
    ),
  ],
);

/**
 * Links profiles to pools (many-to-many, though typically 1 pool per provider).
 */
export const accountPoolMembers = sqliteTable(
  "account_pool_members",
  {
    id: text("id").primaryKey(),
    poolId: text("pool_id")
      .notNull()
      .references(() => accountPools.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => accountProfiles.id, { onDelete: "cascade" }),
    priority: integer("priority").notNull().default(0), // Lower = higher priority
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("account_pool_members_pool_idx").on(table.poolId),
    index("account_pool_members_profile_idx").on(table.profileId),
    uniqueIndex("account_pool_members_unique_idx").on(
      table.poolId,
      table.profileId,
    ),
  ],
);
