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

// ============================================================================
// RU (Repo Updater) Fleet Management Tables
// ============================================================================

/**
 * Fleet repositories - all repos being managed by RU.
 */
export const fleetRepos = sqliteTable(
  "fleet_repos",
  {
    id: text("id").primaryKey(),

    // Repository identification
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(), // owner/name
    url: text("url").notNull(),
    sshUrl: text("ssh_url"),

    // Local state
    localPath: text("local_path"),
    isCloned: integer("is_cloned", { mode: "boolean" })
      .notNull()
      .default(false),

    // Git state
    currentBranch: text("current_branch"),
    defaultBranch: text("default_branch"),
    lastCommit: text("last_commit"),
    lastCommitDate: integer("last_commit_date", { mode: "timestamp" }),
    lastCommitAuthor: text("last_commit_author"),

    // Status: healthy | dirty | behind | ahead | diverged | unknown
    status: text("status").notNull().default("unknown"),
    hasUncommittedChanges: integer("has_uncommitted_changes", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    hasUnpushedCommits: integer("has_unpushed_commits", { mode: "boolean" })
      .notNull()
      .default(false),
    aheadBy: integer("ahead_by").notNull().default(0),
    behindBy: integer("behind_by").notNull().default(0),

    // Metadata
    description: text("description"),
    language: text("language"),
    stars: integer("stars"),
    isPrivate: integer("is_private", { mode: "boolean" }),
    isArchived: integer("is_archived", { mode: "boolean" }),

    // RU integration
    ruGroup: text("ru_group"),
    ruConfig: blob("ru_config", { mode: "json" }),
    agentsmdPath: text("agentsmd_path"),
    lastScanDate: integer("last_scan_date", { mode: "timestamp" }),

    // Timestamps
    addedAt: integer("added_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
    lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
  },
  (table) => [
    index("fleet_repos_owner_idx").on(table.owner),
    index("fleet_repos_status_idx").on(table.status),
    index("fleet_repos_group_idx").on(table.ruGroup),
    uniqueIndex("fleet_repos_full_name_idx").on(table.fullName),
  ],
);

/**
 * Sync operations - history of clone/pull/fetch/push operations.
 */
export const fleetSyncOps = sqliteTable(
  "fleet_sync_ops",
  {
    id: text("id").primaryKey(),

    // Target
    repoId: text("repo_id").references(() => fleetRepos.id),
    repoFullName: text("repo_full_name").notNull(),

    // Operation type: clone | pull | fetch | push
    operation: text("operation").notNull(),

    // Status: pending | running | success | failed | cancelled
    status: text("status").notNull(),

    // Results
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    durationMs: integer("duration_ms"),

    // Git details
    fromCommit: text("from_commit"),
    toCommit: text("to_commit"),
    commitCount: integer("commit_count"),
    filesChanged: integer("files_changed"),

    // Error handling
    error: text("error"),
    errorCode: text("error_code"),
    retryCount: integer("retry_count").notNull().default(0),

    // Metadata
    triggeredBy: text("triggered_by"),
    correlationId: text("correlation_id"),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("fleet_sync_ops_repo_idx").on(table.repoId),
    index("fleet_sync_ops_status_idx").on(table.status),
    index("fleet_sync_ops_created_at_idx").on(table.createdAt),
    index("fleet_sync_ops_correlation_idx").on(table.correlationId),
  ],
);

/**
 * Agent sweep sessions - multi-phase automated maintenance runs.
 */
export const agentSweepSessions = sqliteTable(
  "agent_sweep_sessions",
  {
    id: text("id").primaryKey(),

    // Scope
    targetRepos: text("target_repos").notNull(), // JSON array of repo IDs or "*"
    repoCount: integer("repo_count").notNull(),

    // Configuration
    config: blob("config", { mode: "json" }),
    parallelism: integer("parallelism").notNull().default(1),

    // Phase tracking: phase1_analysis | phase2_planning | phase3_execution
    currentPhase: text("current_phase"),
    phase1CompletedAt: integer("phase1_completed_at", { mode: "timestamp" }),
    phase2CompletedAt: integer("phase2_completed_at", { mode: "timestamp" }),
    phase3CompletedAt: integer("phase3_completed_at", { mode: "timestamp" }),

    // Status: pending | running | paused | completed | failed | cancelled
    status: text("status").notNull(),

    // Progress
    reposAnalyzed: integer("repos_analyzed").notNull().default(0),
    reposPlanned: integer("repos_planned").notNull().default(0),
    reposExecuted: integer("repos_executed").notNull().default(0),
    reposFailed: integer("repos_failed").notNull().default(0),
    reposSkipped: integer("repos_skipped").notNull().default(0),

    // Timing
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    totalDurationMs: integer("total_duration_ms"),

    // SLB integration
    slbApprovalRequired: integer("slb_approval_required", { mode: "boolean" })
      .notNull()
      .default(true),
    slbApprovalId: text("slb_approval_id"),
    slbApprovedBy: text("slb_approved_by"),
    slbApprovedAt: integer("slb_approved_at", { mode: "timestamp" }),

    // Metadata
    triggeredBy: text("triggered_by"),
    notes: text("notes"),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
  },
  (table) => [
    index("agent_sweep_sessions_status_idx").on(table.status),
    index("agent_sweep_sessions_phase_idx").on(table.currentPhase),
    index("agent_sweep_sessions_created_at_idx").on(table.createdAt),
  ],
);

/**
 * Agent sweep plans - JSON plans produced by agents in Phase 2.
 */
export const agentSweepPlans = sqliteTable(
  "agent_sweep_plans",
  {
    id: text("id").primaryKey(),

    // References
    sessionId: text("session_id").references(() => agentSweepSessions.id),
    repoId: text("repo_id").references(() => fleetRepos.id),
    repoFullName: text("repo_full_name").notNull(),

    // Plan content
    planJson: text("plan_json").notNull(),
    planVersion: integer("plan_version").notNull().default(1),

    // Plan summary
    actionCount: integer("action_count"),
    estimatedDurationMs: integer("estimated_duration_ms"),
    riskLevel: text("risk_level"), // low | medium | high | critical

    // Actions breakdown
    commitActions: integer("commit_actions").notNull().default(0),
    releaseActions: integer("release_actions").notNull().default(0),
    branchActions: integer("branch_actions").notNull().default(0),
    prActions: integer("pr_actions").notNull().default(0),
    otherActions: integer("other_actions").notNull().default(0),

    // Validation
    validatedAt: integer("validated_at", { mode: "timestamp" }),
    validationResult: text("validation_result"), // valid | invalid | warning
    validationErrors: text("validation_errors"), // JSON array

    // Approval: pending | approved | rejected | auto_approved
    approvalStatus: text("approval_status").notNull().default("pending"),
    approvedBy: text("approved_by"),
    approvedAt: integer("approved_at", { mode: "timestamp" }),
    rejectedReason: text("rejected_reason"),

    // Execution: pending | running | completed | failed | skipped
    executionStatus: text("execution_status"),
    executedAt: integer("executed_at", { mode: "timestamp" }),
    executionResult: text("execution_result"), // JSON result

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
  },
  (table) => [
    index("agent_sweep_plans_session_idx").on(table.sessionId),
    index("agent_sweep_plans_repo_idx").on(table.repoId),
    index("agent_sweep_plans_approval_idx").on(table.approvalStatus),
  ],
);

/**
 * Agent sweep logs - detailed execution logs.
 */
export const agentSweepLogs = sqliteTable(
  "agent_sweep_logs",
  {
    id: text("id").primaryKey(),

    // References
    sessionId: text("session_id").references(() => agentSweepSessions.id),
    planId: text("plan_id").references(() => agentSweepPlans.id),
    repoId: text("repo_id").references(() => fleetRepos.id),

    // Log entry
    phase: text("phase").notNull(), // phase1 | phase2 | phase3
    level: text("level").notNull(), // debug | info | warn | error
    message: text("message").notNull(),
    data: blob("data", { mode: "json" }),

    // Timing
    timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
    durationMs: integer("duration_ms"),

    // Context
    actionType: text("action_type"),
    actionIndex: integer("action_index"),
  },
  (table) => [
    index("agent_sweep_logs_session_idx").on(table.sessionId),
    index("agent_sweep_logs_timestamp_idx").on(table.timestamp),
    index("agent_sweep_logs_level_idx").on(table.level),
  ],
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
