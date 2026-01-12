/**
 * Audit Trail Types
 *
 * Comprehensive type definitions for audit logging, compliance,
 * and security forensics.
 */

/**
 * Actor types for audit events.
 */
export type ActorType = "user" | "agent" | "system" | "api_key";

/**
 * Operation types for audit events.
 */
export type OperationType =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "execute"
  | "login"
  | "logout";

/**
 * Operation status for audit events.
 */
export type OperationStatus = "success" | "failure" | "partial";

/**
 * Audit actions in the system.
 */
export type AuditAction =
  // Authentication
  | "auth.login"
  | "auth.logout"
  | "auth.login_failed"
  | "auth.password_changed"
  | "auth.mfa_enabled"
  | "auth.mfa_disabled"
  | "auth.api_key_created"
  | "auth.api_key_revoked"
  | "auth.token_refresh"
  // User management
  | "user.created"
  | "user.updated"
  | "user.deleted"
  | "user.role_changed"
  | "user.invited"
  // Agent operations
  | "agent.created"
  | "agent.updated"
  | "agent.deleted"
  | "agent.started"
  | "agent.stopped"
  | "agent.config_changed"
  | "agent.spawn"
  | "agent.terminate"
  | "agent.send"
  // Session operations
  | "session.create"
  | "session.restore"
  | "session.terminate"
  // Pipeline operations
  | "pipeline.created"
  | "pipeline.updated"
  | "pipeline.deleted"
  | "pipeline.executed"
  | "pipeline.approved"
  | "pipeline.rejected"
  // Bead operations
  | "bead.created"
  | "bead.updated"
  | "bead.deleted"
  | "bead.status_changed"
  | "bead.assigned"
  // Conflict operations
  | "conflict.detected"
  | "conflict.resolved"
  | "conflict.escalated"
  // Settings changes
  | "settings.updated"
  | "integration.connected"
  | "integration.disconnected"
  // Data access
  | "data.exported"
  | "data.accessed"
  | "report.generated"
  // CAAM profile actions
  | "profile.create"
  | "profile.update"
  | "profile.delete"
  | "profile.activate"
  | "profile.verify"
  | "profile.cooldown"
  // CAAM pool actions
  | "pool.rotate"
  // DCG actions
  | "dcg.command_blocked"
  | "dcg.exception_approved"
  | "dcg.exception_denied"
  // Handoff actions
  | "handoff.initiated"
  | "handoff.accepted"
  | "handoff.rejected"
  | "handoff.completed"
  | "handoff.failed";

/**
 * Resource types for audit events.
 */
export type ResourceType =
  | "user"
  | "team"
  | "organization"
  | "workspace"
  | "agent"
  | "session"
  | "checkpoint"
  | "pipeline"
  | "bead"
  | "conflict"
  | "dashboard"
  | "api_key"
  | "integration"
  | "settings"
  | "export"
  | "account"
  | "account_profile"
  | "account_pool"
  | "handoff"
  | "reservation";

/**
 * Actor information for audit events.
 */
export interface AuditActor {
  type: ActorType;
  id: string;
  name?: string;
  email?: string;
  ip?: string;
  userAgent?: string;
  sessionId?: string;
}

/**
 * Organization context for audit events.
 */
export interface AuditOrg {
  id: string;
  name?: string;
}

/**
 * Resource reference for audit events.
 */
export interface AuditResource {
  type: ResourceType;
  id: string;
  name?: string;
  parentId?: string;
  parentType?: string;
}

/**
 * Operation details for audit events.
 */
export interface AuditOperation {
  type: OperationType;
  status: OperationStatus;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Change tracking for audit events.
 */
export interface AuditChanges {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  diff?: Array<{ field: string; old: unknown; new: unknown }>;
}

/**
 * Comprehensive audit event structure.
 */
export interface EnhancedAuditEvent {
  // Identification
  id: string;
  correlationId: string;
  parentEventId?: string;

  // Timing
  timestamp: Date;
  duration?: number; // Operation duration in ms

  // Actor information
  actor: AuditActor;

  // Organization context
  org?: AuditOrg;

  // Action details
  action: AuditAction;
  resource: AuditResource;

  // Operation details
  operation: AuditOperation;

  // Change tracking
  changes?: AuditChanges;

  // Additional context
  metadata: {
    requestId: string;
    endpoint?: string;
    method?: string;
    sourceService?: string;
    tags?: string[];
    [key: string]: unknown;
  };
}

/**
 * Options for creating an enhanced audit event.
 */
export interface EnhancedAuditEventOptions {
  action: AuditAction;
  resource: AuditResource;
  operation: AuditOperation;
  actor?: Partial<AuditActor>;
  org?: AuditOrg;
  changes?: AuditChanges;
  metadata?: Record<string, unknown>;
  parentEventId?: string;
  duration?: number;
}

/**
 * Audit search query parameters.
 */
export interface AuditSearchQuery {
  // Full-text search
  query?: string;

  // Time range (required for performance)
  timeRange: {
    start: Date;
    end: Date;
  };

  // Filters
  filters?: {
    correlationId?: string;
    actorTypes?: ActorType[];
    actorIds?: string[];
    actions?: AuditAction[];
    resourceTypes?: ResourceType[];
    resourceIds?: string[];
    statuses?: OperationStatus[];
    hasErrors?: boolean;
  };

  // Pagination
  pagination?: {
    limit: number;
    offset?: number;
    cursor?: string;
  };

  // Sorting
  sort?: {
    field: "timestamp" | "action" | "actor";
    direction: "asc" | "desc";
  };
}

/**
 * Audit search result.
 */
export interface AuditSearchResult {
  events: EnhancedAuditEvent[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
  aggregations?: {
    byAction: Record<string, number>;
    byActor: Record<string, number>;
    byResource: Record<string, number>;
    byStatus: Record<string, number>;
    timeline: Array<{ bucket: string; count: number }>;
  };
}

/**
 * Export format options.
 */
export type ExportFormat = "csv" | "json" | "json_lines";

/**
 * Compression options for export.
 */
export type CompressionType = "none" | "gzip" | "zip";

/**
 * Export options for audit logs.
 */
export interface AuditExportOptions {
  format: ExportFormat;
  dateRange: {
    start: Date;
    end: Date;
  };
  filters?: AuditSearchQuery["filters"];
  includeFields?: string[];
  excludeFields?: string[];
  compression?: CompressionType;
}

/**
 * Export job result.
 */
export interface AuditExportResult {
  jobId: string;
  filename: string;
  downloadUrl?: string;
  expiresAt?: Date;
  recordCount: number;
  fileSize: number;
  status: "pending" | "processing" | "completed" | "failed";
  error?: string;
}

/**
 * Retention policy for audit logs.
 */
export interface RetentionPolicy {
  id: string;
  name: string;
  description?: string;

  // What to retain
  filter: {
    actions?: AuditAction[];
    severities?: string[];
    resourceTypes?: ResourceType[];
  };

  // How long to retain
  retention: {
    duration: number; // Days
    archiveFirst: boolean; // Archive to cold storage before delete
    archiveLocation?: string; // S3 bucket/path
  };

  // When created/modified
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  enabled: boolean;
}

/**
 * Default retention policies.
 */
export const DEFAULT_RETENTION_POLICIES: Omit<
  RetentionPolicy,
  "id" | "createdAt" | "updatedAt" | "createdBy"
>[] = [
  {
    name: "Authentication Events",
    description: "Login, logout, and authentication failures",
    filter: {
      actions: [
        "auth.login",
        "auth.logout",
        "auth.login_failed",
        "auth.password_changed",
      ],
    },
    retention: { duration: 365, archiveFirst: true },
    enabled: true,
  },
  {
    name: "Data Access Events",
    description: "Data exports and sensitive data access",
    filter: { actions: ["data.accessed", "data.exported"] },
    retention: { duration: 730, archiveFirst: true }, // 2 years
    enabled: true,
  },
  {
    name: "Configuration Changes",
    description: "Settings and agent configuration changes",
    filter: {
      actions: ["settings.updated", "agent.config_changed"],
    },
    retention: { duration: 365, archiveFirst: true },
    enabled: true,
  },
  {
    name: "Security Events",
    description: "DCG blocks, exceptions, and security-related events",
    filter: {
      actions: [
        "dcg.command_blocked",
        "dcg.exception_approved",
        "dcg.exception_denied",
      ],
    },
    retention: { duration: 730, archiveFirst: true }, // 2 years
    enabled: true,
  },
  {
    name: "Default Policy",
    description: "Catch-all policy for events not matching other policies",
    filter: {},
    retention: { duration: 90, archiveFirst: false },
    enabled: true,
  },
];
