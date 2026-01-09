import { getCorrelationId, getLogger } from "../middleware/correlation";

/**
 * Auditable actions in the system.
 */
export type AuditAction =
  | "agent.spawn"
  | "agent.terminate"
  | "agent.send"
  | "session.create"
  | "session.restore"
  | "auth.login"
  | "auth.logout"
  | "auth.token_refresh"
  | "api_key.create"
  | "api_key.revoke";

/**
 * Resource types for audit events.
 */
export type ResourceType =
  | "agent"
  | "session"
  | "checkpoint"
  | "api_key"
  | "user"
  | "account";

/**
 * Audit event structure.
 */
export interface AuditEvent {
  id: string;
  timestamp: string;
  correlationId: string;
  workspaceId?: string;
  userId?: string;
  apiKeyId?: string;
  action: AuditAction;
  resource: string;
  resourceType: ResourceType;
  outcome: "success" | "failure";
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Options for creating an audit event.
 */
export interface AuditEventOptions {
  action: AuditAction;
  resource: string;
  resourceType: ResourceType;
  outcome: "success" | "failure";
  workspaceId?: string;
  userId?: string;
  apiKeyId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Create and emit an audit event.
 *
 * Audit events are:
 * 1. Logged to the structured log stream
 * 2. (Future) Written to an audit table in the database
 *
 * @param options - Audit event options
 * @returns The created audit event
 */
export function audit(options: AuditEventOptions): AuditEvent {
  const log = getLogger();
  const correlationId = getCorrelationId();

  // Build event with only defined optional properties to satisfy exactOptionalPropertyTypes
  const event: AuditEvent = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    correlationId,
    action: options.action,
    resource: options.resource,
    resourceType: options.resourceType,
    outcome: options.outcome,
  };

  // Conditionally add optional fields
  if (options.workspaceId !== undefined)
    event.workspaceId = options.workspaceId;
  if (options.userId !== undefined) event.userId = options.userId;
  if (options.apiKeyId !== undefined) event.apiKeyId = options.apiKeyId;
  if (options.metadata !== undefined) event.metadata = options.metadata;
  if (options.ipAddress !== undefined) event.ipAddress = options.ipAddress;
  if (options.userAgent !== undefined) event.userAgent = options.userAgent;

  // Log the audit event
  log.info(
    {
      type: "audit",
      audit: event,
    },
    `[AUDIT] ${options.action} ${options.resourceType}:${options.resource} → ${options.outcome}`,
  );

  // TODO: Persist to audit table when database is set up
  // await db.insert(auditEvents).values(event);

  return event;
}

/**
 * Helper to create a success audit event.
 */
export function auditSuccess(
  options: Omit<AuditEventOptions, "outcome">,
): AuditEvent {
  return audit({ ...options, outcome: "success" });
}

/**
 * Helper to create a failure audit event.
 */
export function auditFailure(
  options: Omit<AuditEventOptions, "outcome">,
): AuditEvent {
  return audit({ ...options, outcome: "failure" });
}
