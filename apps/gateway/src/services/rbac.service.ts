/**
 * RBAC and Scoped API Keys Service (bd-66wud)
 *
 * Implements Role-Based Access Control (RBAC), scoped API keys with service
 * account ownership metadata and resource filters, fail-closed endpoint
 * permission annotation enforcement, role permission diffs, and compliance
 * audit export.
 */

import { createHash, randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { z } from "zod";

// ============================================================================
// Schemas & Types
// ============================================================================

export const PermissionSchema = z.enum([
  "agents:read",
  "agents:write",
  "sessions:read",
  "sessions:write",
  "policies:read",
  "policies:write",
  "analytics:read",
  "admin:manage",
]);

export type Permission = z.infer<typeof PermissionSchema>;

export const ResourceFilterSchema = z.object({
  agentIds: z.array(z.string()).optional(),
  workspaceIds: z.array(z.string()).optional(),
});

export const CreateRoleSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(80),
  description: z.string().max(400).default(""),
  permissions: z.array(PermissionSchema).min(1),
});

export const CreateScopedApiKeySchema = z.object({
  name: z.string().min(1).max(120),
  ownerId: z.string().min(1),
  serviceAccountName: z.string().min(1).optional(),
  permissions: z.array(PermissionSchema).min(1),
  resourceFilters: ResourceFilterSchema.optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

export interface RoleDefinition {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  builtIn: boolean;
  updatedAt: string;
}

export interface RolePermissionDiff {
  roleId: string;
  beforePermissions: Permission[];
  afterPermissions: Permission[];
  added: Permission[];
  removed: Permission[];
  unchanged: Permission[];
}

export interface ScopedApiKeyRecord {
  id: string;
  name: string;
  ownerId: string;
  serviceAccountName?: string;
  keyPrefix: string;
  keyHash: string;
  permissions: Permission[];
  resourceFilters?: z.infer<typeof ResourceFilterSchema>;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
}

export interface RbacAuditEvent {
  id: string;
  action:
    | "role.created"
    | "role.updated"
    | "user.role_assigned"
    | "api_key.created"
    | "api_key.revoked"
    | "permission.checked";
  actor: string;
  subjectId: string;
  details: Record<string, unknown>;
  timestamp: string;
}

// ============================================================================
// Built-in Roles & Endpoint Annotations
// ============================================================================

const BUILT_IN_ROLES: RoleDefinition[] = [
  {
    id: "owner",
    name: "Owner",
    description: "Full access to all gateway resources and administration",
    permissions: [
      "agents:read",
      "agents:write",
      "sessions:read",
      "sessions:write",
      "policies:read",
      "policies:write",
      "analytics:read",
      "admin:manage",
    ],
    builtIn: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "admin",
    name: "Admin",
    description: "Manage agents, policies, sessions, and analytics dashboards",
    permissions: [
      "agents:read",
      "agents:write",
      "sessions:read",
      "sessions:write",
      "policies:read",
      "policies:write",
      "analytics:read",
    ],
    builtIn: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "developer",
    name: "Developer",
    description: "Manage agents and sessions and view analytics",
    permissions: [
      "agents:read",
      "agents:write",
      "sessions:read",
      "sessions:write",
      "analytics:read",
    ],
    builtIn: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "viewer",
    name: "Viewer",
    description:
      "Read-only access to agents, sessions, policies, and analytics",
    permissions: [
      "agents:read",
      "sessions:read",
      "policies:read",
      "analytics:read",
    ],
    builtIn: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "automation",
    name: "Automation",
    description: "Scoped automation key role",
    permissions: ["agents:read", "sessions:read"],
    builtIn: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

const DEFAULT_ENDPOINT_ANNOTATIONS: Record<string, Permission> = {
  "GET /agents": "agents:read",
  "POST /agents": "agents:write",
  "DELETE /agents/:id": "agents:write",
  "GET /sessions": "sessions:read",
  "POST /sessions": "sessions:write",
  "GET /routing/policies": "policies:read",
  "POST /routing/policies": "policies:write",
  "GET /cost-analytics": "analytics:read",
  "POST /rbac/roles": "admin:manage",
};

// ============================================================================
// State Stores
// ============================================================================

const rolesStore = new Map<string, RoleDefinition>();
const userRolesStore = new Map<string, string>();
const apiKeysById = new Map<string, ScopedApiKeyRecord>();
const apiKeysByHash = new Map<string, ScopedApiKeyRecord>();
const endpointAnnotations = new Map<string, Permission>();
const auditStore: RbacAuditEvent[] = [];

function ensureDefaults(): void {
  if (rolesStore.size === 0) {
    for (const r of BUILT_IN_ROLES) {
      rolesStore.set(r.id, structuredClone(r));
    }
  }
  if (endpointAnnotations.size === 0) {
    for (const [k, v] of Object.entries(DEFAULT_ENDPOINT_ANNOTATIONS)) {
      endpointAnnotations.set(k, v);
    }
  }
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function recordRbacAudit(
  action: RbacAuditEvent["action"],
  actor: string,
  subjectId: string,
  details: Record<string, unknown>,
): void {
  auditStore.push({
    id: `rbaca_${ulid()}`,
    action,
    actor,
    subjectId,
    details,
    timestamp: new Date().toISOString(),
  });
}

// ============================================================================
// Role Management & Diffs
// ============================================================================

export function listRoles(): RoleDefinition[] {
  ensureDefaults();
  return Array.from(rolesStore.values());
}

export function createCustomRole(
  input: z.input<typeof CreateRoleSchema>,
  actor: string = "admin",
): RoleDefinition {
  ensureDefaults();
  const parsed = CreateRoleSchema.parse(input);
  const id = parsed.id ?? `role_${ulid()}`;
  const role: RoleDefinition = {
    id,
    name: parsed.name,
    description: parsed.description,
    permissions: Array.from(new Set(parsed.permissions)),
    builtIn: false,
    updatedAt: new Date().toISOString(),
  };
  rolesStore.set(id, role);
  recordRbacAudit("role.created", actor, id, {
    name: role.name,
    permissions: role.permissions,
  });
  return role;
}

export function updateRolePermissions(
  roleId: string,
  permissions: Permission[],
  actor: string = "admin",
): { role: RoleDefinition; diff: RolePermissionDiff } | undefined {
  ensureDefaults();
  const existing = rolesStore.get(roleId);
  if (!existing) return undefined;

  const beforePermissions = [...existing.permissions];
  const afterPermissions = Array.from(new Set(permissions));

  const added = afterPermissions.filter((p) => !beforePermissions.includes(p));
  const removed = beforePermissions.filter(
    (p) => !afterPermissions.includes(p),
  );
  const unchanged = afterPermissions.filter((p) =>
    beforePermissions.includes(p),
  );

  const updated: RoleDefinition = {
    ...existing,
    permissions: afterPermissions,
    updatedAt: new Date().toISOString(),
  };
  rolesStore.set(roleId, updated);

  const diff: RolePermissionDiff = {
    roleId,
    beforePermissions,
    afterPermissions,
    added,
    removed,
    unchanged,
  };

  recordRbacAudit("role.updated", actor, roleId, { diff });
  return { role: updated, diff };
}

export function assignUserRole(
  userId: string,
  roleId: string,
  actor: string = "admin",
): { userId: string; role: RoleDefinition } | undefined {
  ensureDefaults();
  const role = rolesStore.get(roleId);
  if (!role) return undefined;
  userRolesStore.set(userId, roleId);
  recordRbacAudit("user.role_assigned", actor, userId, { roleId });
  return { userId, role };
}

// ============================================================================
// Scoped API Keys & Service Accounts
// ============================================================================

export function createScopedApiKey(
  input: z.input<typeof CreateScopedApiKeySchema>,
  actor: string = "admin",
): { record: ScopedApiKeyRecord; rawApiKey: string } {
  ensureDefaults();
  const parsed = CreateScopedApiKeySchema.parse(input);
  const rawSecret = randomBytes(18).toString("hex");
  const rawApiKey = `fwk_${rawSecret}`;
  const keyHash = hashToken(rawApiKey);
  const nowMs = Date.now();

  const record: ScopedApiKeyRecord = {
    id: `key_${ulid()}`,
    name: parsed.name,
    ownerId: parsed.ownerId,
    ...(parsed.serviceAccountName !== undefined && {
      serviceAccountName: parsed.serviceAccountName,
    }),
    keyPrefix: rawApiKey.slice(0, 10),
    keyHash,
    permissions: Array.from(new Set(parsed.permissions)),
    ...(parsed.resourceFilters !== undefined && {
      resourceFilters: parsed.resourceFilters,
    }),
    createdAt: new Date(nowMs).toISOString(),
    ...(parsed.expiresInDays !== undefined && {
      expiresAt: new Date(
        nowMs + parsed.expiresInDays * 24 * 60 * 60 * 1000,
      ).toISOString(),
    }),
  };

  apiKeysById.set(record.id, record);
  apiKeysByHash.set(keyHash, record);

  recordRbacAudit("api_key.created", actor, record.id, {
    name: record.name,
    ownerId: record.ownerId,
    serviceAccountName: record.serviceAccountName,
    permissions: record.permissions,
    resourceFilters: record.resourceFilters,
  });

  return { record, rawApiKey };
}

export function revokeScopedApiKey(
  keyId: string,
  actor: string = "admin",
): boolean {
  const existing = apiKeysById.get(keyId);
  if (!existing) return false;
  existing.revokedAt = new Date().toISOString();
  apiKeysByHash.delete(existing.keyHash);
  apiKeysById.delete(keyId);
  recordRbacAudit("api_key.revoked", actor, keyId, {
    ownerId: existing.ownerId,
  });
  return true;
}

// ============================================================================
// Fail-Closed Endpoint Permission & Resource Scope Enforcement
// ============================================================================

export function registerEndpointPermissionAnnotation(
  endpointKey: string,
  permission: Permission,
): void {
  ensureDefaults();
  endpointAnnotations.set(endpointKey, permission);
}

export function checkEndpointPermission(params: {
  endpoint: string;
  rawApiKey?: string | undefined;
  userId?: string | undefined;
  resourceContext?:
    | { agentId?: string | undefined; workspaceId?: string | undefined }
    | undefined;
}): {
  allowed: boolean;
  requiredPermission: Permission | null;
  reason: string;
} {
  ensureDefaults();
  const requiredPermission = endpointAnnotations.get(params.endpoint) ?? null;

  // Fail closed if endpoint annotation is missing
  if (!requiredPermission) {
    return {
      allowed: false,
      requiredPermission: null,
      reason: `Fail-closed: no permission annotation registered for '${params.endpoint}'`,
    };
  }

  let effectivePermissions: Permission[] = [];
  let filters: z.infer<typeof ResourceFilterSchema> | undefined;
  let subjectId = "anonymous";

  if (params.rawApiKey) {
    const keyRecord = apiKeysByHash.get(hashToken(params.rawApiKey));
    if (!keyRecord || keyRecord.revokedAt) {
      return {
        allowed: false,
        requiredPermission,
        reason: "Invalid or revoked API key",
      };
    }
    effectivePermissions = keyRecord.permissions;
    filters = keyRecord.resourceFilters;
    subjectId = keyRecord.serviceAccountName ?? keyRecord.id;
  } else if (params.userId) {
    const roleId = userRolesStore.get(params.userId);
    const role = roleId ? rolesStore.get(roleId) : undefined;
    if (!role) {
      return {
        allowed: false,
        requiredPermission,
        reason: `No role assigned to user '${params.userId}'`,
      };
    }
    effectivePermissions = role.permissions;
    subjectId = params.userId;
  } else {
    return {
      allowed: false,
      requiredPermission,
      reason: "No credentials provided",
    };
  }

  const hasPerm =
    effectivePermissions.includes("admin:manage") ||
    effectivePermissions.includes(requiredPermission);
  if (!hasPerm) {
    return {
      allowed: false,
      requiredPermission,
      reason: `Subject '${subjectId}' lacks required permission '${requiredPermission}'`,
    };
  }

  // Enforce resource filters if present on scoped API key
  if (filters) {
    if (
      params.resourceContext?.agentId &&
      filters.agentIds?.length &&
      !filters.agentIds.includes(params.resourceContext.agentId)
    ) {
      return {
        allowed: false,
        requiredPermission,
        reason: `Agent '${params.resourceContext.agentId}' is outside key's allowed agentIds scope`,
      };
    }
    if (
      params.resourceContext?.workspaceId &&
      filters.workspaceIds?.length &&
      !filters.workspaceIds.includes(params.resourceContext.workspaceId)
    ) {
      return {
        allowed: false,
        requiredPermission,
        reason: `Workspace '${params.resourceContext.workspaceId}' is outside key's allowed workspaceIds scope`,
      };
    }
  }

  recordRbacAudit("permission.checked", subjectId, params.endpoint, {
    requiredPermission,
    allowed: true,
    resourceContext: params.resourceContext,
  });

  return {
    allowed: true,
    requiredPermission,
    reason: `Allowed via permission '${requiredPermission}'`,
  };
}

export function exportRbacComplianceAudit() {
  ensureDefaults();
  return {
    exportedAt: new Date().toISOString(),
    roles: listRoles(),
    userAssignments: Object.fromEntries(userRolesStore.entries()),
    activeApiKeys: Array.from(apiKeysById.values()).map(
      ({ keyHash: _hash, ...rest }) => rest,
    ),
    auditEvents: [...auditStore],
  };
}

export function clearRbacForTesting(): void {
  rolesStore.clear();
  userRolesStore.clear();
  apiKeysById.clear();
  apiKeysByHash.clear();
  endpointAnnotations.clear();
  auditStore.length = 0;
}
