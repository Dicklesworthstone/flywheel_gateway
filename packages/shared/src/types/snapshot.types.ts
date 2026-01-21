/**
 * System Snapshot Types
 *
 * Defines the schema for a unified system snapshot that aggregates:
 * - NTM (Named Tmux Manager) session and agent state
 * - Agent Mail messaging and coordination state
 * - br/bv issue tracking and triage state
 * - Tool health status (DCG, SLB, UBS, checksums)
 *
 * Used by the gateway snapshot service and readiness UI.
 */

// ============================================================================
// NTM Snapshot Types
// ============================================================================

/**
 * Agent state within an NTM session.
 */
export interface NtmAgentSnapshot {
  /** Pane identifier (e.g., "%1") */
  pane: string;
  /** Agent type (e.g., "claude", "codex", "gemini") */
  type: string;
  /** Agent variant (e.g., "opus", "sonnet") */
  variant?: string;
  /** Confidence in type detection (0-1) */
  typeConfidence?: number;
  /** Method used for type detection */
  typeMethod?: string;
  /** Current state (e.g., "idle", "working", "error") */
  state: string;
  /** Seconds since last output */
  lastOutputAgeSec?: number;
  /** Number of tail lines captured */
  outputTailLines?: number;
  /** Current bead being worked on */
  currentBead?: string | null;
  /** Number of pending mail messages */
  pendingMail?: number;
  /** Whether the agent is currently active */
  isActive?: boolean;
  /** Window index */
  window?: number;
  /** Pane index within window */
  paneIdx?: number;
}

/**
 * NTM session snapshot.
 */
export interface NtmSessionSnapshot {
  /** Session name */
  name: string;
  /** Whether the session is attached */
  attached: boolean;
  /** Number of windows (if available) */
  windows?: number;
  /** Number of panes (if available) */
  panes?: number;
  /** Session creation time */
  createdAt?: string;
  /** Agents in this session */
  agents: NtmAgentSnapshot[];
}

/**
 * Summary counts for NTM status.
 */
export interface NtmStatusSummary {
  /** Total number of sessions */
  totalSessions: number;
  /** Total number of agents */
  totalAgents: number;
  /** Number of attached sessions */
  attachedCount: number;
  /** Count by agent type */
  byAgentType: {
    claude: number;
    codex: number;
    gemini: number;
    cursor: number;
    windsurf: number;
    aider: number;
    [key: string]: number;
  };
}

/**
 * NTM snapshot data.
 */
export interface NtmSnapshot {
  /** Timestamp of snapshot capture */
  capturedAt: string;
  /** Whether NTM is available */
  available: boolean;
  /** NTM version (if available) */
  version?: string;
  /** Session snapshots */
  sessions: NtmSessionSnapshot[];
  /** Status summary */
  summary: NtmStatusSummary;
  /** Active alerts */
  alerts: string[];
}

// ============================================================================
// Agent Mail Snapshot Types
// ============================================================================

/**
 * Registered agent in Agent Mail.
 */
export interface AgentMailAgentSnapshot {
  /** Agent identifier */
  agentId: string;
  /** Mailbox identifier */
  mailboxId?: string;
  /** Agent capabilities */
  capabilities: string[];
  /** Custom metadata */
  metadata?: Record<string, unknown>;
  /** Registration timestamp */
  registeredAt?: string;
}

/**
 * File reservation in Agent Mail.
 */
export interface AgentMailReservationSnapshot {
  /** Reservation identifier */
  reservationId: string;
  /** Requester agent ID */
  requesterId: string;
  /** Reserved file patterns */
  patterns: string[];
  /** Whether exclusive */
  exclusive: boolean;
  /** Expiration timestamp */
  expiresAt: string;
}

/**
 * Message summary for Agent Mail.
 */
export interface AgentMailMessageSummary {
  /** Total message count */
  total: number;
  /** Unread message count */
  unread: number;
  /** Messages by priority */
  byPriority: {
    low: number;
    normal: number;
    high: number;
    urgent: number;
  };
}

/**
 * Agent Mail snapshot data.
 */
export interface AgentMailSnapshot {
  /** Timestamp of snapshot capture */
  capturedAt: string;
  /** Whether Agent Mail server is available */
  available: boolean;
  /** Server status */
  status?: "healthy" | "degraded" | "unhealthy";
  /** Project identifier */
  projectId?: string;
  /** Registered agents */
  agents: AgentMailAgentSnapshot[];
  /** Active reservations */
  reservations: AgentMailReservationSnapshot[];
  /** Message summary */
  messages: AgentMailMessageSummary;
}

// ============================================================================
// Beads (br/bv) Snapshot Types
// ============================================================================

/**
 * Issue counts by status.
 */
export interface BeadsStatusCounts {
  open: number;
  inProgress: number;
  blocked: number;
  closed: number;
  total: number;
}

/**
 * Issue counts by type.
 */
export interface BeadsTypeCounts {
  bug: number;
  feature: number;
  task: number;
  epic: number;
  chore: number;
  [key: string]: number;
}

/**
 * Issue counts by priority.
 */
export interface BeadsPriorityCounts {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
}

/**
 * Top recommendation from bv triage.
 */
export interface BeadsTriageRecommendation {
  /** Issue ID */
  id: string;
  /** Issue title */
  title: string;
  /** Triage score */
  score: number;
  /** Number of issues this unblocks */
  unblocks?: number;
  /** IDs of issues this unblocks */
  unblocksIds?: string[];
  /** Reasons for recommendation */
  reasons?: string[];
  /** Suggested action */
  action?: string;
}

/**
 * Sync status between DB and JSONL.
 */
export interface BeadsSyncStatus {
  /** Number of dirty (uncommitted) changes */
  dirtyCount: number;
  /** Last export timestamp */
  lastExportTime?: string;
  /** Last import timestamp */
  lastImportTime?: string;
  /** Whether JSONL file exists */
  jsonlExists: boolean;
  /** Whether JSONL is newer than DB */
  jsonlNewer: boolean;
  /** Whether DB is newer than JSONL */
  dbNewer: boolean;
}

/**
 * Beads (br/bv) snapshot data.
 */
export interface BeadsSnapshot {
  /** Timestamp of snapshot capture */
  capturedAt: string;
  /** Whether br CLI is available */
  brAvailable: boolean;
  /** Whether bv CLI is available */
  bvAvailable: boolean;
  /** Issue counts by status */
  statusCounts: BeadsStatusCounts;
  /** Issue counts by type */
  typeCounts: BeadsTypeCounts;
  /** Issue counts by priority */
  priorityCounts: BeadsPriorityCounts;
  /** Number of actionable (ready to work) issues */
  actionableCount: number;
  /** Sync status */
  syncStatus?: BeadsSyncStatus;
  /** Top triage recommendations */
  topRecommendations: BeadsTriageRecommendation[];
  /** Quick wins */
  quickWins: BeadsTriageRecommendation[];
  /** High-impact blockers to clear */
  blockersToClean: BeadsTriageRecommendation[];
}

// ============================================================================
// Tool Health Snapshot Types
// ============================================================================

/**
 * Individual tool health status.
 */
export interface ToolHealthStatus {
  /** Whether the tool is installed */
  installed: boolean;
  /** Tool version (if available) */
  version: string | null;
  /** Whether the tool is healthy/responding */
  healthy: boolean;
  /** Health check latency in milliseconds */
  latencyMs?: number;
}

/**
 * Checksum status for a tool.
 */
export interface ToolChecksumStatus {
  /** Tool identifier */
  toolId: string;
  /** Whether checksums are available */
  hasChecksums: boolean;
  /** Number of checksums */
  checksumCount: number;
  /** When the registry was generated */
  registryGeneratedAt: string | null;
  /** Age of checksums in milliseconds */
  ageMs: number | null;
  /** Whether checksums are stale */
  stale: boolean;
}

/**
 * Tool health snapshot data (DCG, SLB, UBS).
 */
export interface ToolHealthSnapshot {
  /** Timestamp of snapshot capture */
  capturedAt: string;
  /** DCG (Destructive Command Guard) status */
  dcg: ToolHealthStatus;
  /** SLB (Simultaneous Launch Button) status */
  slb: ToolHealthStatus;
  /** UBS (Ultimate Bug Scanner) status */
  ubs: ToolHealthStatus;
  /** Overall health status */
  status: "healthy" | "degraded" | "unhealthy";
  /** Registry generation timestamp */
  registryGeneratedAt: string | null;
  /** Registry age in milliseconds */
  registryAgeMs: number | null;
  /** Number of tools with checksums */
  toolsWithChecksums: number;
  /** Whether checksums are stale */
  checksumsStale: boolean;
  /** Tool checksum statuses */
  checksumStatuses: ToolChecksumStatus[];
  /** Current issues */
  issues: string[];
  /** Recommendations */
  recommendations: string[];
}

// ============================================================================
// Unified System Snapshot
// ============================================================================

/**
 * Overall system health status.
 */
export type SystemHealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

/**
 * System snapshot metadata.
 */
export interface SystemSnapshotMeta {
  /** Schema version for forward compatibility */
  schemaVersion: "1.0.0";
  /** Timestamp when snapshot was generated */
  generatedAt: string;
  /** Generation duration in milliseconds */
  generationDurationMs: number;
  /** Correlation ID for tracing */
  correlationId?: string;
  /** Gateway version */
  gatewayVersion?: string;
}

/**
 * Summary of system health across all components.
 */
export interface SystemHealthSummary {
  /** Overall system status */
  status: SystemHealthStatus;
  /** NTM health status */
  ntm: SystemHealthStatus;
  /** Agent Mail health status */
  agentMail: SystemHealthStatus;
  /** Beads health status */
  beads: SystemHealthStatus;
  /** Tool health status */
  tools: SystemHealthStatus;
  /** Number of healthy components */
  healthyCount: number;
  /** Number of degraded components */
  degradedCount: number;
  /** Number of unhealthy components */
  unhealthyCount: number;
  /** Number of unknown status components */
  unknownCount: number;
  /** High-level issues requiring attention */
  issues: string[];
}

/**
 * Unified system snapshot aggregating all subsystem states.
 *
 * This is the primary type returned by the /system/snapshot endpoint.
 * It provides a comprehensive view of the entire agent orchestration system.
 *
 * @example
 * ```typescript
 * const snapshot: SystemSnapshot = await gateway.getSystemSnapshot();
 * if (snapshot.summary.status !== "healthy") {
 *   console.log("Issues:", snapshot.summary.issues);
 * }
 * ```
 */
export interface SystemSnapshot {
  /** Snapshot metadata */
  meta: SystemSnapshotMeta;
  /** Health summary across all components */
  summary: SystemHealthSummary;
  /** NTM (Named Tmux Manager) state */
  ntm: NtmSnapshot;
  /** Agent Mail state */
  agentMail: AgentMailSnapshot;
  /** Beads (br/bv) state */
  beads: BeadsSnapshot;
  /** Tool health state */
  tools: ToolHealthSnapshot;
}

// ============================================================================
// Delta/Change Types (for incremental updates)
// ============================================================================

/**
 * Type of change in a snapshot delta.
 */
export type SnapshotChangeType =
  | "session_added"
  | "session_removed"
  | "agent_added"
  | "agent_removed"
  | "agent_state_changed"
  | "issue_created"
  | "issue_updated"
  | "issue_closed"
  | "reservation_acquired"
  | "reservation_released"
  | "message_received"
  | "tool_status_changed"
  | "alert_added"
  | "alert_cleared";

/**
 * A single change in a snapshot delta.
 */
export interface SnapshotChange {
  /** Type of change */
  type: SnapshotChangeType;
  /** Timestamp of change */
  timestamp: string;
  /** Component affected (ntm, agentMail, beads, tools) */
  component: "ntm" | "agentMail" | "beads" | "tools";
  /** Entity identifier (session name, issue ID, etc.) */
  entityId?: string;
  /** Previous value (for updates) */
  previousValue?: unknown;
  /** New value */
  newValue?: unknown;
  /** Additional context */
  details?: Record<string, unknown>;
}

/**
 * Snapshot delta for incremental updates.
 */
export interface SystemSnapshotDelta {
  /** Schema version */
  schemaVersion: "1.0.0";
  /** Timestamp of delta generation */
  generatedAt: string;
  /** Reference timestamp (since when) */
  since: string;
  /** List of changes */
  changes: SnapshotChange[];
  /** Updated summary (always included) */
  summary: SystemHealthSummary;
}
