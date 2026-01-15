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
    command: text("command"), // Redacted command content
    reason: text("reason").notNull(),
    createdBy: text("created_by"),
    falsePositive: integer("false_positive", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),

    // Enhanced details
    pack: text("pack"),
    severity: text("severity"),
    ruleId: text("rule_id"),
    contextClassification: text("context_classification"),
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

/**
 * DCG Pending Exceptions - Allow-once workflow for bypassing false positives.
 *
 * Workflow:
 * 1. DCG blocks a command and generates a short code
 * 2. User reviews blocked command and decides it's safe
 * 3. User approves via API/UI using short code
 * 4. DCG allows that specific command+hash once
 * 5. Same command requires new approval
 */
export const dcgPendingExceptions = sqliteTable(
  "dcg_pending_exceptions",
  {
    id: text("id").primaryKey(),
    shortCode: text("short_code").unique().notNull(), // e.g., "abc123"

    // Command details
    command: text("command").notNull(), // The blocked command
    commandHash: text("command_hash").notNull(), // SHA256 for verification

    // Rule that triggered block
    pack: text("pack").notNull(),
    ruleId: text("rule_id").notNull(),
    reason: text("reason").notNull(),
    severity: text("severity").notNull(), // low | medium | high | critical

    // Context
    agentId: text("agent_id"),
    blockEventId: text("block_event_id"), // Reference to dcgBlocks entry

    // Status: pending | approved | denied | expired | executed
    status: text("status").notNull().default("pending"),
    approvedBy: text("approved_by"),
    approvedAt: integer("approved_at", { mode: "timestamp" }),
    deniedBy: text("denied_by"),
    deniedAt: integer("denied_at", { mode: "timestamp" }),
    denyReason: text("deny_reason"),

    // Execution tracking
    executedAt: integer("executed_at", { mode: "timestamp" }),
    executionResult: text("execution_result"), // success | failed

    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(), // Short TTL
  },
  (table) => [
    uniqueIndex("dcg_pending_short_code_idx").on(table.shortCode),
    index("dcg_pending_status_idx").on(table.status),
    index("dcg_pending_agent_idx").on(table.agentId),
    index("dcg_pending_expires_idx").on(table.expiresAt),
    index("dcg_pending_command_hash_idx").on(table.commandHash),
  ],
);

/**
 * DCG Configuration - Persisted pack settings and severity modes.
 *
 * Replaces in-memory config for persistence across restarts and
 * consistent state across multiple instances.
 */
export const dcgConfig = sqliteTable("dcg_config", {
  id: text("id").primaryKey(), // "current" for active config
  enabledPacks: text("enabled_packs").notNull(), // JSON array
  disabledPacks: text("disabled_packs").notNull(), // JSON array
  criticalMode: text("critical_mode").notNull().default("deny"), // deny|warn|log
  highMode: text("high_mode").notNull().default("deny"),
  mediumMode: text("medium_mode").notNull().default("warn"),
  lowMode: text("low_mode").notNull().default("log"),
  updatedBy: text("updated_by"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/**
 * DCG Configuration History - Audit trail of all config changes.
 */
export const dcgConfigHistory = sqliteTable(
  "dcg_config_history",
  {
    id: text("id").primaryKey(),
    configSnapshot: text("config_snapshot").notNull(), // Full JSON snapshot
    previousSnapshot: text("previous_snapshot"), // For diff comparison
    changedBy: text("changed_by"),
    changedAt: integer("changed_at", { mode: "timestamp" }).notNull(),
    changeReason: text("change_reason"),
    changeType: text("change_type").notNull(), // pack_enabled|pack_disabled|severity_changed|bulk_update|initial
  },
  (table) => [
    index("dcg_config_history_changed_at_idx").on(table.changedAt),
    index("dcg_config_history_changed_by_idx").on(table.changedBy),
  ],
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

// ============================================================================
// Job Orchestration Tables
// ============================================================================

/**
 * Jobs - Long-running operations with progress tracking, cancellation, and retry.
 *
 * Job types include:
 * - Context operations: context_build, context_compact
 * - Scan operations: codebase_scan, dependency_scan
 * - Export operations: session_export, bead_export
 * - Import operations: codebase_import, memory_import
 * - Analysis operations: semantic_index, embedding_generate
 * - Maintenance operations: checkpoint_compact, cache_warm
 */
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),

    // Job identification
    type: text("type").notNull(),
    name: text("name"),

    // Status: pending | running | paused | completed | failed | cancelled | timeout
    status: text("status").notNull().default("pending"),

    // Priority: 0=low, 1=normal, 2=high, 3=critical
    priority: integer("priority").notNull().default(1),

    // Ownership
    sessionId: text("session_id"),
    agentId: text("agent_id").references(() => agents.id),
    userId: text("user_id"),

    // Input/Output (JSON blobs)
    input: blob("input", { mode: "json" }),
    output: blob("output", { mode: "json" }),

    // Progress tracking
    progressCurrent: integer("progress_current").notNull().default(0),
    progressTotal: integer("progress_total").notNull().default(100),
    progressMessage: text("progress_message"),
    progressStage: text("progress_stage"),

    // Timing
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    estimatedDurationMs: integer("estimated_duration_ms"),
    actualDurationMs: integer("actual_duration_ms"),

    // Error handling
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    errorStack: text("error_stack"),
    errorRetryable: integer("error_retryable", { mode: "boolean" }),

    // Retry configuration
    retryAttempts: integer("retry_attempts").notNull().default(0),
    retryMaxAttempts: integer("retry_max_attempts").notNull().default(3),
    retryBackoffMs: integer("retry_backoff_ms").notNull().default(1000),
    retryNextAt: integer("retry_next_at", { mode: "timestamp" }),

    // Cancellation
    cancelRequestedAt: integer("cancel_requested_at", { mode: "timestamp" }),
    cancelRequestedBy: text("cancel_requested_by"),
    cancelReason: text("cancel_reason"),

    // Checkpointing (for resume)
    checkpointState: blob("checkpoint_state", { mode: "json" }),
    checkpointAt: integer("checkpoint_at", { mode: "timestamp" }),

    // Metadata
    metadata: blob("metadata", { mode: "json" }),
    correlationId: text("correlation_id"),
  },
  (table) => [
    index("jobs_type_idx").on(table.type),
    index("jobs_status_idx").on(table.status),
    index("jobs_priority_idx").on(table.priority),
    index("jobs_session_idx").on(table.sessionId),
    index("jobs_agent_idx").on(table.agentId),
    index("jobs_created_at_idx").on(table.createdAt),
    index("jobs_correlation_idx").on(table.correlationId),
  ],
);

/**
 * Job logs - Detailed execution logs for jobs.
 */
export const jobLogs = sqliteTable(
  "job_logs",
  {
    id: text("id").primaryKey(),

    // Reference
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),

    // Log entry
    level: text("level").notNull(), // debug | info | warn | error
    message: text("message").notNull(),
    data: blob("data", { mode: "json" }),

    // Timing
    timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
    durationMs: integer("duration_ms"),
  },
  (table) => [
    index("job_logs_job_idx").on(table.jobId),
    index("job_logs_timestamp_idx").on(table.timestamp),
    index("job_logs_level_idx").on(table.level),
  ],
);

// ============================================================================
// Git Coordination Tables
// ============================================================================

/**
 * Branch assignments - Exclusive branch ownership for multi-agent coordination.
 */
export const branchAssignments = sqliteTable(
  "branch_assignments",
  {
    id: text("id").primaryKey(),

    // References
    agentId: text("agent_id").references(() => agents.id),
    repositoryId: text("repository_id").notNull(),

    // Branch info
    branchName: text("branch_name").notNull(),
    baseBranch: text("base_branch").notNull().default("main"),

    // Status: active | stale | merged | expired
    status: text("status").notNull().default("active"),

    // Timing
    assignedAt: integer("assigned_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    lastActivityAt: integer("last_activity_at", {
      mode: "timestamp",
    }).notNull(),

    // Metadata
    taskId: text("task_id"),
    taskDescription: text("task_description"),
    reservedPatterns: text("reserved_patterns"), // JSON array of glob patterns

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
  },
  (table) => [
    index("branch_assignments_agent_idx").on(table.agentId),
    index("branch_assignments_repository_idx").on(table.repositoryId),
    index("branch_assignments_status_idx").on(table.status),
    uniqueIndex("branch_assignments_repo_branch_idx").on(
      table.repositoryId,
      table.branchName,
    ),
  ],
);

/**
 * Conflict predictions - Cached predictions for branch pair conflicts.
 */
export const conflictPredictions = sqliteTable(
  "conflict_predictions",
  {
    id: text("id").primaryKey(),

    // Branch pair
    repositoryId: text("repository_id").notNull(),
    branchA: text("branch_a").notNull(),
    branchB: text("branch_b").notNull(),

    // Prediction result
    hasConflicts: integer("has_conflicts", { mode: "boolean" })
      .notNull()
      .default(false),
    conflictingFiles: text("conflicting_files"), // JSON array
    severity: text("severity").notNull().default("none"), // none | low | medium | high
    recommendation: text("recommendation"),

    // Details
    commonAncestor: text("common_ancestor"),
    changesInA: integer("changes_in_a").notNull().default(0),
    changesInB: integer("changes_in_b").notNull().default(0),
    overlappingFiles: text("overlapping_files"), // JSON array

    // Timing
    predictedAt: integer("predicted_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("conflict_predictions_repository_idx").on(table.repositoryId),
    index("conflict_predictions_branches_idx").on(table.branchA, table.branchB),
    index("conflict_predictions_predicted_at_idx").on(table.predictedAt),
  ],
);

/**
 * Git sync operations - History of sync operations for audit.
 */
export const gitSyncOperations = sqliteTable(
  "git_sync_operations",
  {
    id: text("id").primaryKey(),

    // References
    repositoryId: text("repository_id").notNull(),
    agentId: text("agent_id").references(() => agents.id),

    // Operation details
    operation: text("operation").notNull(), // pull | push | fetch | rebase | merge
    branch: text("branch").notNull(),
    targetBranch: text("target_branch"),
    remote: text("remote"),
    force: integer("force", { mode: "boolean" }).default(false),

    // Status: queued | running | completed | failed | cancelled | timeout
    status: text("status").notNull(),

    // Timing
    queuedAt: integer("queued_at", { mode: "timestamp" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    durationMs: integer("duration_ms"),

    // Result
    success: integer("success", { mode: "boolean" }),
    fromCommit: text("from_commit"),
    toCommit: text("to_commit"),
    filesChanged: integer("files_changed"),
    insertions: integer("insertions"),
    deletions: integer("deletions"),

    // Conflict info
    conflictsDetected: integer("conflicts_detected", { mode: "boolean" }),
    conflictFiles: text("conflict_files"), // JSON array

    // Error handling
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    attempt: integer("attempt").notNull().default(1),
    maxRetries: integer("max_retries").notNull().default(3),

    // Tracking
    correlationId: text("correlation_id"),
  },
  (table) => [
    index("git_sync_operations_repository_idx").on(table.repositoryId),
    index("git_sync_operations_agent_idx").on(table.agentId),
    index("git_sync_operations_status_idx").on(table.status),
    index("git_sync_operations_queued_at_idx").on(table.queuedAt),
    index("git_sync_operations_correlation_idx").on(table.correlationId),
  ],
);

// ============================================================================
// SLB Safety Guardrails Tables
// ============================================================================

/**
 * Safety configurations - Per-workspace safety settings.
 */
export const safetyConfigs = sqliteTable(
  "safety_configs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),

    // Category enables (JSON object)
    categoryEnables: text("category_enables").notNull(), // JSON: { filesystem: true, git: true, ... }

    // Rate limits (JSON object)
    rateLimits: text("rate_limits").notNull(), // JSON: SafetyRateLimitConfig

    // Budget config (JSON object)
    budget: text("budget").notNull(), // JSON: SafetyBudgetConfig

    // Approval workflow (JSON object)
    approvalWorkflow: text("approval_workflow").notNull(), // JSON: ApprovalWorkflowConfig

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("safety_configs_workspace_idx").on(table.workspaceId),
    uniqueIndex("safety_configs_workspace_name_idx").on(
      table.workspaceId,
      table.name,
    ),
  ],
);

/**
 * Safety rules - Custom safety rules per workspace.
 */
export const safetyRules = sqliteTable(
  "safety_rules",
  {
    id: text("id").primaryKey(),
    configId: text("config_id")
      .notNull()
      .references(() => safetyConfigs.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),

    // Rule definition
    name: text("name").notNull(),
    description: text("description"),
    category: text("category").notNull(), // filesystem | git | network | execution | resources | content
    conditions: text("conditions").notNull(), // JSON array of RuleCondition
    conditionLogic: text("condition_logic").notNull().default("and"), // and | or
    action: text("action").notNull(), // allow | deny | warn | approve
    severity: text("severity").notNull(), // low | medium | high | critical
    message: text("message").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    alternatives: text("alternatives"), // JSON array of strings

    // Ordering (lower = higher priority)
    priority: integer("priority").notNull().default(100),

    // Metadata
    metadata: blob("metadata", { mode: "json" }),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("safety_rules_config_idx").on(table.configId),
    index("safety_rules_workspace_idx").on(table.workspaceId),
    index("safety_rules_category_idx").on(table.category),
    index("safety_rules_enabled_idx").on(table.enabled),
    index("safety_rules_priority_idx").on(table.priority),
  ],
);

/**
 * Safety violations - Record of blocked/warned operations.
 */
export const safetyViolations = sqliteTable(
  "safety_violations",
  {
    id: text("id").primaryKey(),

    // Context
    workspaceId: text("workspace_id").notNull(),
    agentId: text("agent_id").references(() => agents.id),
    sessionId: text("session_id"),

    // Rule that triggered
    ruleId: text("rule_id").references(() => safetyRules.id),
    ruleName: text("rule_name").notNull(),
    ruleCategory: text("rule_category").notNull(),
    ruleSeverity: text("rule_severity").notNull(),

    // Operation details
    operationType: text("operation_type").notNull(),
    operationDetails: blob("operation_details", { mode: "json" }),

    // Action taken: blocked | warned | pending_approval
    actionTaken: text("action_taken").notNull(),

    // Context
    taskDescription: text("task_description"),
    recentHistory: text("recent_history"), // JSON array

    // Tracking
    correlationId: text("correlation_id"),
    timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("safety_violations_workspace_idx").on(table.workspaceId),
    index("safety_violations_agent_idx").on(table.agentId),
    index("safety_violations_rule_idx").on(table.ruleId),
    index("safety_violations_severity_idx").on(table.ruleSeverity),
    index("safety_violations_timestamp_idx").on(table.timestamp),
    index("safety_violations_correlation_idx").on(table.correlationId),
  ],
);

/**
 * Approval requests - Operations pending human approval.
 */
export const approvalRequests = sqliteTable(
  "approval_requests",
  {
    id: text("id").primaryKey(),

    // Context
    workspaceId: text("workspace_id").notNull(),
    agentId: text("agent_id").references(() => agents.id),
    sessionId: text("session_id"),

    // Rule that triggered approval
    ruleId: text("rule_id").references(() => safetyRules.id),
    ruleName: text("rule_name").notNull(),

    // Operation details
    operationType: text("operation_type").notNull(),
    operationCommand: text("operation_command"),
    operationPath: text("operation_path"),
    operationDescription: text("operation_description").notNull(),
    operationDetails: blob("operation_details", { mode: "json" }),

    // Context
    taskDescription: text("task_description"),
    recentActions: text("recent_actions"), // JSON array

    // Status: pending | approved | denied | expired | cancelled
    status: text("status").notNull().default("pending"),

    // Priority: low | normal | high | urgent
    priority: text("priority").notNull().default("normal"),

    // Timing
    requestedAt: integer("requested_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),

    // Decision
    decidedBy: text("decided_by"),
    decidedAt: integer("decided_at", { mode: "timestamp" }),
    decisionReason: text("decision_reason"),

    // Tracking
    correlationId: text("correlation_id"),
  },
  (table) => [
    index("approval_requests_workspace_idx").on(table.workspaceId),
    index("approval_requests_agent_idx").on(table.agentId),
    index("approval_requests_status_idx").on(table.status),
    index("approval_requests_priority_idx").on(table.priority),
    index("approval_requests_requested_at_idx").on(table.requestedAt),
    index("approval_requests_expires_at_idx").on(table.expiresAt),
    index("approval_requests_correlation_idx").on(table.correlationId),
  ],
);

/**
 * Budget usage tracking - Track token/cost usage per scope.
 */
export const budgetUsage = sqliteTable(
  "budget_usage",
  {
    id: text("id").primaryKey(),

    // Scope
    scope: text("scope").notNull(), // agent | workspace | session
    scopeId: text("scope_id").notNull(), // agentId, workspaceId, or sessionId
    workspaceId: text("workspace_id").notNull(),

    // Usage
    tokensUsed: integer("tokens_used").notNull().default(0),
    dollarsUsed: real("dollars_used").notNull().default(0),

    // Period
    periodStart: integer("period_start", { mode: "timestamp" }).notNull(),
    periodEnd: integer("period_end", { mode: "timestamp" }),

    // Last update
    lastUpdatedAt: integer("last_updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("budget_usage_workspace_idx").on(table.workspaceId),
    index("budget_usage_scope_idx").on(table.scope, table.scopeId),
    uniqueIndex("budget_usage_scope_period_idx").on(
      table.scope,
      table.scopeId,
      table.periodStart,
    ),
  ],
);

// ============================================================================
// Pipeline Engine Tables
// ============================================================================

/**
 * Pipelines - Workflow definitions for orchestrating multi-step agent operations.
 *
 * Features:
 * - Step-by-step workflow definition
 * - Conditional branching and parallel execution
 * - Human-in-the-loop approval gates
 * - Multiple trigger types (manual, schedule, webhook, bead_event)
 * - Retry with exponential backoff
 */
export const pipelines = sqliteTable(
  "pipelines",
  {
    id: text("id").primaryKey(),

    // Basic info
    name: text("name").notNull(),
    description: text("description"),
    version: integer("version").notNull().default(1),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),

    // Trigger configuration (JSON blob)
    triggerType: text("trigger_type").notNull(), // manual | schedule | webhook | bead_event
    triggerConfig: blob("trigger_config", { mode: "json" }).notNull(),
    triggerEnabled: integer("trigger_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    nextTriggerAt: integer("next_trigger_at", { mode: "timestamp" }),
    lastTriggeredAt: integer("last_triggered_at", { mode: "timestamp" }),

    // Steps configuration (JSON blob - array of PipelineStep)
    steps: blob("steps", { mode: "json" }).notNull(),

    // Global configuration
    contextDefaults: blob("context_defaults", { mode: "json" }),
    retryPolicy: blob("retry_policy", { mode: "json" }),

    // Metadata
    tags: blob("tags", { mode: "json" }).$type<string[]>(),
    ownerId: text("owner_id"),

    // Statistics
    totalRuns: integer("total_runs").notNull().default(0),
    successfulRuns: integer("successful_runs").notNull().default(0),
    failedRuns: integer("failed_runs").notNull().default(0),
    averageDurationMs: integer("average_duration_ms").notNull().default(0),

    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    lastRunAt: integer("last_run_at", { mode: "timestamp" }),
  },
  (table) => [
    index("pipelines_name_idx").on(table.name),
    index("pipelines_enabled_idx").on(table.enabled),
    index("pipelines_owner_idx").on(table.ownerId),
    index("pipelines_trigger_type_idx").on(table.triggerType),
    index("pipelines_next_trigger_idx").on(table.nextTriggerAt),
    index("pipelines_created_at_idx").on(table.createdAt),
  ],
);

/**
 * Pipeline runs - Execution history for pipelines.
 *
 * Tracks each invocation with:
 * - Status progression (running, paused, completed, failed, cancelled)
 * - Context variables passed between steps
 * - Execution timestamps and duration
 * - Error information if failed
 */
export const pipelineRuns = sqliteTable(
  "pipeline_runs",
  {
    id: text("id").primaryKey(),

    // Pipeline reference
    pipelineId: text("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    pipelineVersion: integer("pipeline_version").notNull(),

    // Status: pending | running | paused | completed | failed | cancelled | timeout
    status: text("status").notNull().default("pending"),

    // Execution state
    currentStepIndex: integer("current_step_index").notNull().default(0),
    executedStepIds: blob("executed_step_ids", { mode: "json" })
      .notNull()
      .$type<string[]>(),

    // Context (shared variables between steps)
    context: blob("context", { mode: "json" }).notNull(),
    triggerParams: blob("trigger_params", { mode: "json" }),

    // Trigger info
    triggeredByType: text("triggered_by_type").notNull(), // user | schedule | webhook | bead_event | api
    triggeredById: text("triggered_by_id"),

    // Timing
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    durationMs: integer("duration_ms"),

    // Error info
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    errorStepId: text("error_step_id"),

    // Metadata
    correlationId: text("correlation_id"),
  },
  (table) => [
    index("pipeline_runs_pipeline_idx").on(table.pipelineId),
    index("pipeline_runs_status_idx").on(table.status),
    index("pipeline_runs_started_at_idx").on(table.startedAt),
    index("pipeline_runs_correlation_idx").on(table.correlationId),
  ],
);

/**
 * Pipeline step results - Execution results for individual steps within a run.
 *
 * Tracks per-step:
 * - Status and timing
 * - Output data
 * - Retry count
 * - Error details if failed
 */
export const pipelineStepResults = sqliteTable(
  "pipeline_step_results",
  {
    id: text("id").primaryKey(),

    // References
    runId: text("run_id")
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: "cascade" }),
    stepId: text("step_id").notNull(),
    stepName: text("step_name").notNull(),
    stepType: text("step_type").notNull(),

    // Status: pending | running | completed | failed | skipped | cancelled
    status: text("status").notNull().default("pending"),

    // Result
    success: integer("success", { mode: "boolean" }),
    output: blob("output", { mode: "json" }),

    // Error info
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    errorDetails: blob("error_details", { mode: "json" }),

    // Retry tracking
    retryCount: integer("retry_count").notNull().default(0),

    // Timing
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    durationMs: integer("duration_ms"),
  },
  (table) => [
    index("pipeline_step_results_run_idx").on(table.runId),
    index("pipeline_step_results_step_idx").on(table.stepId),
    index("pipeline_step_results_status_idx").on(table.status),
    uniqueIndex("pipeline_step_results_run_step_idx").on(
      table.runId,
      table.stepId,
    ),
  ],
);

/**
 * Pipeline approvals - Pending approval requests for pipeline steps.
 *
 * Tracks approval workflow:
 * - Pending approvals with timeout
 * - Approver decisions with comments
 * - Auto-approve/reject on timeout
 */
export const pipelineApprovals = sqliteTable(
  "pipeline_approvals",
  {
    id: text("id").primaryKey(),

    // References
    runId: text("run_id")
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: "cascade" }),
    stepId: text("step_id").notNull(),

    // Approval config
    approvers: blob("approvers", { mode: "json" }).notNull().$type<string[]>(),
    message: text("message").notNull(),
    minApprovals: integer("min_approvals").notNull().default(1),

    // Status: pending | approved | rejected | expired
    status: text("status").notNull().default("pending"),

    // Decisions (JSON array of ApprovalRecord)
    decisions: blob("decisions", { mode: "json" }).$type<
      Array<{
        userId: string;
        decision: "approved" | "rejected";
        comment?: string;
        timestamp: string;
      }>
    >(),

    // Timeout config
    timeoutAt: integer("timeout_at", { mode: "timestamp" }),
    onTimeout: text("on_timeout").notNull().default("fail"), // approve | reject | fail

    // Timing
    requestedAt: integer("requested_at", { mode: "timestamp" }).notNull(),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  },
  (table) => [
    index("pipeline_approvals_run_idx").on(table.runId),
    index("pipeline_approvals_status_idx").on(table.status),
    index("pipeline_approvals_timeout_idx").on(table.timeoutAt),
    uniqueIndex("pipeline_approvals_run_step_idx").on(
      table.runId,
      table.stepId,
    ),
  ],
);

/**
 * Pipeline scheduled triggers - Active schedule entries for pipelines.
 *
 * Manages cron-based triggers:
 * - Next execution time calculation
 * - Timezone handling
 * - Start/end date constraints
 */
export const pipelineSchedules = sqliteTable(
  "pipeline_schedules",
  {
    id: text("id").primaryKey(),

    // Pipeline reference
    pipelineId: text("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),

    // Schedule config
    cron: text("cron").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    startDate: integer("start_date", { mode: "timestamp" }),
    endDate: integer("end_date", { mode: "timestamp" }),

    // State
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    nextRunAt: integer("next_run_at", { mode: "timestamp" }),
    lastRunAt: integer("last_run_at", { mode: "timestamp" }),
    lastRunId: text("last_run_id"),

    // Statistics
    runCount: integer("run_count").notNull().default(0),
    failureCount: integer("failure_count").notNull().default(0),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("pipeline_schedules_pipeline_idx").on(table.pipelineId),
    index("pipeline_schedules_enabled_idx").on(table.enabled),
    index("pipeline_schedules_next_run_idx").on(table.nextRunAt),
  ],
);

// ============================================================================
// Cost Analytics Tables
// ============================================================================

/**
 * Cost records - Individual cost events from API usage.
 *
 * Tracks:
 * - Token usage with prompt/completion/cached breakdown
 * - Cost calculation in millicents for precision
 * - Attribution to agent, project, organization
 * - Task type and complexity for analysis
 */
export const costRecords = sqliteTable(
  "cost_records",
  {
    id: text("id").primaryKey(),
    timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),

    // Attribution dimensions
    organizationId: text("organization_id"),
    projectId: text("project_id"),
    agentId: text("agent_id").references(() => agents.id),
    taskId: text("task_id"),
    sessionId: text("session_id"),

    // Model info
    model: text("model").notNull(),
    provider: text("provider").notNull(), // 'anthropic' | 'openai' | 'google' | 'local'

    // Token breakdown
    promptTokens: integer("prompt_tokens").notNull(),
    completionTokens: integer("completion_tokens").notNull(),
    cachedTokens: integer("cached_tokens").notNull().default(0),

    // Cost calculation (in millicents for precision)
    promptCostUnits: integer("prompt_cost_units").notNull(),
    completionCostUnits: integer("completion_cost_units").notNull(),
    cachedCostUnits: integer("cached_cost_units").notNull().default(0),
    totalCostUnits: integer("total_cost_units").notNull(),

    // Context
    taskType: text("task_type"),
    complexityTier: text("complexity_tier"), // 'simple' | 'moderate' | 'complex'
    success: integer("success", { mode: "boolean" }).notNull(),

    // Request metadata
    requestDurationMs: integer("request_duration_ms"),
    correlationId: text("correlation_id"),
  },
  (table) => [
    index("cost_records_timestamp_idx").on(table.timestamp),
    index("cost_records_organization_idx").on(table.organizationId),
    index("cost_records_project_idx").on(table.projectId),
    index("cost_records_agent_idx").on(table.agentId),
    index("cost_records_model_idx").on(table.model),
    index("cost_records_provider_idx").on(table.provider),
    index("cost_records_correlation_idx").on(table.correlationId),
    index("cost_records_org_timestamp_idx").on(
      table.organizationId,
      table.timestamp,
    ),
  ],
);

/**
 * Cost aggregates - Pre-computed rollups by time period.
 *
 * Supports:
 * - Per-minute for real-time dashboards
 * - Hourly for trend analysis
 * - Daily for reporting
 * - Monthly for billing
 */
export const costAggregates = sqliteTable(
  "cost_aggregates",
  {
    id: text("id").primaryKey(),

    // Period definition
    period: text("period").notNull(), // 'minute' | 'hour' | 'day' | 'week' | 'month'
    periodStart: integer("period_start", { mode: "timestamp" }).notNull(),
    periodEnd: integer("period_end", { mode: "timestamp" }).notNull(),

    // Scope (null = global)
    organizationId: text("organization_id"),
    projectId: text("project_id"),
    agentId: text("agent_id"),

    // Totals
    totalCostUnits: integer("total_cost_units").notNull(),
    totalTokens: integer("total_tokens").notNull(),
    promptTokens: integer("prompt_tokens").notNull(),
    completionTokens: integer("completion_tokens").notNull(),
    cachedTokens: integer("cached_tokens").notNull().default(0),

    // Request stats
    requestCount: integer("request_count").notNull(),
    successCount: integer("success_count").notNull(),
    failureCount: integer("failure_count").notNull(),

    // Breakdowns (JSON blobs)
    byModel: blob("by_model", { mode: "json" }),
    byProvider: blob("by_provider", { mode: "json" }),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("cost_aggregates_period_idx").on(table.period),
    index("cost_aggregates_period_start_idx").on(table.periodStart),
    index("cost_aggregates_organization_idx").on(table.organizationId),
    index("cost_aggregates_project_idx").on(table.projectId),
    index("cost_aggregates_agent_idx").on(table.agentId),
    uniqueIndex("cost_aggregates_unique_idx").on(
      table.period,
      table.periodStart,
      table.organizationId,
      table.projectId,
      table.agentId,
    ),
  ],
);

/**
 * Budgets - Cost budget configurations.
 */
export const budgets = sqliteTable(
  "budgets",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),

    // Scope
    organizationId: text("organization_id"),
    projectId: text("project_id"),

    // Budget config
    period: text("period").notNull(), // 'daily' | 'weekly' | 'monthly' | 'yearly'
    amountUnits: integer("amount_units").notNull(), // In millicents
    alertThresholds: text("alert_thresholds").notNull(), // JSON array [50, 75, 90, 100]
    actionOnExceed: text("action_on_exceed").notNull().default("alert"), // 'alert' | 'throttle' | 'block'
    rollover: integer("rollover", { mode: "boolean" }).notNull().default(false),

    // Dates
    effectiveDate: integer("effective_date", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("budgets_organization_idx").on(table.organizationId),
    index("budgets_project_idx").on(table.projectId),
    index("budgets_enabled_idx").on(table.enabled),
    index("budgets_effective_date_idx").on(table.effectiveDate),
  ],
);

/**
 * Budget alerts - History of budget threshold alerts.
 */
export const budgetAlerts = sqliteTable(
  "budget_alerts",
  {
    id: text("id").primaryKey(),

    // Budget reference
    budgetId: text("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),

    // Alert info
    threshold: integer("threshold").notNull(), // The threshold that was crossed (e.g., 75)
    usedPercent: real("used_percent").notNull(),
    usedUnits: integer("used_units").notNull(),
    budgetUnits: integer("budget_units").notNull(),

    // Period info
    periodStart: integer("period_start", { mode: "timestamp" }).notNull(),
    periodEnd: integer("period_end", { mode: "timestamp" }).notNull(),

    // Status
    acknowledged: integer("acknowledged", { mode: "boolean" })
      .notNull()
      .default(false),
    acknowledgedBy: text("acknowledged_by"),
    acknowledgedAt: integer("acknowledged_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("budget_alerts_budget_idx").on(table.budgetId),
    index("budget_alerts_threshold_idx").on(table.threshold),
    index("budget_alerts_created_at_idx").on(table.createdAt),
  ],
);

/**
 * Cost forecasts - Stored forecast predictions.
 */
export const costForecasts = sqliteTable(
  "cost_forecasts",
  {
    id: text("id").primaryKey(),

    // Scope
    organizationId: text("organization_id"),
    projectId: text("project_id"),

    // Forecast config
    forecastDate: integer("forecast_date", { mode: "timestamp" }).notNull(),
    horizonDays: integer("horizon_days").notNull(),
    methodology: text("methodology").notNull(), // 'linear' | 'arima' | 'prophet' | 'exponential' | 'ensemble'

    // Forecast data (JSON blob - array of DailyForecast)
    dailyForecasts: blob("daily_forecasts", { mode: "json" }).notNull(),

    // Summary
    totalForecastUnits: integer("total_forecast_units").notNull(),
    confidenceLower: integer("confidence_lower").notNull(),
    confidenceUpper: integer("confidence_upper").notNull(),

    // Accuracy metrics
    mape: real("mape"), // Mean Absolute Percentage Error
    rmse: real("rmse"), // Root Mean Square Error

    // Historical basis
    historicalDaysUsed: integer("historical_days_used").notNull(),
    seasonalityDetected: integer("seasonality_detected", { mode: "boolean" })
      .notNull()
      .default(false),
    trendDirection: text("trend_direction"), // 'up' | 'down' | 'stable'
    trendStrength: real("trend_strength"),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("cost_forecasts_organization_idx").on(table.organizationId),
    index("cost_forecasts_project_idx").on(table.projectId),
    index("cost_forecasts_forecast_date_idx").on(table.forecastDate),
    index("cost_forecasts_created_at_idx").on(table.createdAt),
  ],
);

/**
 * Optimization recommendations - AI-generated cost optimization suggestions.
 */
export const optimizationRecommendations = sqliteTable(
  "optimization_recommendations",
  {
    id: text("id").primaryKey(),

    // Category
    category: text("category").notNull(), // 'model_optimization' | 'caching' | 'batching' | etc.
    title: text("title").notNull(),
    description: text("description").notNull(),

    // Savings estimation (in millicents)
    currentCostUnits: integer("current_cost_units").notNull(),
    optimizedCostUnits: integer("optimized_cost_units").notNull(),
    estimatedSavingsUnits: integer("estimated_savings_units").notNull(),
    savingsPercent: real("savings_percent").notNull(),
    confidence: real("confidence").notNull(), // 0-1

    // Implementation
    implementation: text("implementation").notNull(),
    risk: text("risk").notNull(), // 'low' | 'medium' | 'high'
    effortHours: integer("effort_hours"),
    prerequisites: text("prerequisites"), // JSON array

    // Scope
    organizationId: text("organization_id"),
    projectId: text("project_id"),
    affectedAgents: text("affected_agents"), // JSON array
    affectedModels: text("affected_models"), // JSON array

    // Status
    status: text("status").notNull().default("pending"), // 'pending' | 'in_progress' | 'implemented' | 'rejected' | 'failed'
    implementedAt: integer("implemented_at", { mode: "timestamp" }),
    implementedBy: text("implemented_by"),
    rejectedReason: text("rejected_reason"),

    // Validation
    actualSavingsUnits: integer("actual_savings_units"),
    validatedAt: integer("validated_at", { mode: "timestamp" }),

    // Metadata
    priority: integer("priority").notNull().default(3), // 1-5
    expiresAt: integer("expires_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("optimization_recommendations_category_idx").on(table.category),
    index("optimization_recommendations_status_idx").on(table.status),
    index("optimization_recommendations_organization_idx").on(
      table.organizationId,
    ),
    index("optimization_recommendations_project_idx").on(table.projectId),
    index("optimization_recommendations_priority_idx").on(table.priority),
    index("optimization_recommendations_created_at_idx").on(table.createdAt),
  ],
);

/**
 * Model rate cards - Cost rates for different models.
 */
export const modelRateCards = sqliteTable(
  "model_rate_cards",
  {
    id: text("id").primaryKey(),

    // Model identification
    model: text("model").notNull(),
    provider: text("provider").notNull(), // 'anthropic' | 'openai' | 'google' | 'local'

    // Rates (in millicents per 1k tokens)
    promptCostPer1kTokens: integer("prompt_cost_per_1k_tokens").notNull(),
    completionCostPer1kTokens: integer(
      "completion_cost_per_1k_tokens",
    ).notNull(),
    cachedPromptCostPer1kTokens: integer("cached_prompt_cost_per_1k_tokens"),

    // Validity period
    effectiveDate: integer("effective_date", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("model_rate_cards_model_idx").on(table.model),
    index("model_rate_cards_provider_idx").on(table.provider),
    index("model_rate_cards_effective_date_idx").on(table.effectiveDate),
    uniqueIndex("model_rate_cards_model_effective_idx").on(
      table.model,
      table.provider,
      table.effectiveDate,
    ),
  ],
);

// ============================================================================
// Custom Dashboard Builder Tables
// ============================================================================

/**
 * Dashboards - Custom dashboard definitions.
 *
 * Features:
 * - Drag-and-drop widget placement via react-grid-layout
 * - Multiple widget types (metrics, charts, tables, feeds)
 * - Sharing and access control (private, team, public)
 * - Auto-refresh with configurable intervals
 */
export const dashboards = sqliteTable(
  "dashboards",
  {
    id: text("id").primaryKey(),

    // Basic info
    name: text("name").notNull(),
    description: text("description"),
    workspaceId: text("workspace_id").notNull(),
    ownerId: text("owner_id").notNull(),

    // Layout configuration (JSON blob)
    layout: blob("layout", { mode: "json" }).notNull(),

    // Widgets (JSON array)
    widgets: blob("widgets", { mode: "json" }).notNull(),

    // Sharing settings
    visibility: text("visibility").notNull().default("private"), // 'private' | 'team' | 'public'
    teamId: text("team_id"),
    publicSlug: text("public_slug"),
    requireAuth: integer("require_auth", { mode: "boolean" })
      .notNull()
      .default(true),
    embedEnabled: integer("embed_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    embedToken: text("embed_token"),

    // Refresh settings
    refreshInterval: integer("refresh_interval").notNull().default(60), // seconds, 0 = manual only

    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("dashboards_workspace_idx").on(table.workspaceId),
    index("dashboards_owner_idx").on(table.ownerId),
    index("dashboards_visibility_idx").on(table.visibility),
    index("dashboards_team_idx").on(table.teamId),
    uniqueIndex("dashboards_public_slug_idx").on(table.publicSlug),
    index("dashboards_created_at_idx").on(table.createdAt),
  ],
);

/**
 * Dashboard permissions - Granular access control for dashboards.
 */
export const dashboardPermissions = sqliteTable(
  "dashboard_permissions",
  {
    id: text("id").primaryKey(),

    // References
    dashboardId: text("dashboard_id")
      .notNull()
      .references(() => dashboards.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),

    // Permission level
    permission: text("permission").notNull(), // 'view' | 'edit'

    // Timestamps
    grantedAt: integer("granted_at", { mode: "timestamp" }).notNull(),
    grantedBy: text("granted_by"),
  },
  (table) => [
    index("dashboard_permissions_dashboard_idx").on(table.dashboardId),
    index("dashboard_permissions_user_idx").on(table.userId),
    uniqueIndex("dashboard_permissions_unique_idx").on(
      table.dashboardId,
      table.userId,
    ),
  ],
);

/**
 * Dashboard favorites - Quick access to favorite dashboards.
 */
export const dashboardFavorites = sqliteTable(
  "dashboard_favorites",
  {
    id: text("id").primaryKey(),

    // References
    userId: text("user_id").notNull(),
    dashboardId: text("dashboard_id")
      .notNull()
      .references(() => dashboards.id, { onDelete: "cascade" }),

    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("dashboard_favorites_user_idx").on(table.userId),
    index("dashboard_favorites_dashboard_idx").on(table.dashboardId),
    uniqueIndex("dashboard_favorites_unique_idx").on(
      table.userId,
      table.dashboardId,
    ),
  ],
);
