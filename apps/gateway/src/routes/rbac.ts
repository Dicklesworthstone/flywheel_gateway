/**
 * RBAC and API Key Scopes Routes (bd-66wud)
 *
 * Endpoints:
 * - GET /rbac/roles - List all roles and permission matrix
 * - POST /rbac/roles - Create a custom role
 * - PUT /rbac/roles/:id - Update role permissions (returns before/after diff)
 * - POST /rbac/users/:userId/role - Assign a role to a user
 * - POST /rbac/api-keys - Create a scoped API key / service account key
 * - DELETE /rbac/api-keys/:id - Revoke an API key
 * - POST /rbac/check - Check permission against endpoint annotation + resource filters
 * - GET /rbac/audit/export - Export RBAC compliance audit report
 */

import { Hono } from "hono";
import { z } from "zod";
import { requireAdminMiddleware } from "../middleware/auth";
import {
  assignUserRole,
  CreateRoleSchema,
  CreateScopedApiKeySchema,
  checkEndpointPermission,
  createCustomRole,
  createScopedApiKey,
  exportRbacComplianceAudit,
  listRoles,
  PermissionSchema,
  revokeScopedApiKey,
  updateRolePermissions,
} from "../services/rbac.service";
import {
  sendCreated,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const rbac = new Hono();
rbac.use("*", requireAdminMiddleware());

const UpdateRolePermissionsSchema = z.object({
  permissions: z.array(PermissionSchema).min(1),
});

const AssignRoleSchema = z.object({
  roleId: z.string().min(1),
});

const CheckPermissionSchema = z.object({
  endpoint: z.string().min(1),
  rawApiKey: z.string().optional(),
  userId: z.string().optional(),
  resourceContext: z
    .object({
      agentId: z.string().optional(),
      workspaceId: z.string().optional(),
    })
    .optional(),
});

rbac.get("/roles", (c) => {
  const roles = listRoles();
  return sendList(c, roles, { total: roles.length });
});

rbac.post("/roles", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CreateRoleSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const role = createCustomRole(parsed.data);
  return sendCreated(c, "rbac_role", role, `/rbac/roles/${role.id}`);
});

rbac.put("/roles/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = UpdateRolePermissionsSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const updated = updateRolePermissions(id, parsed.data.permissions);
  if (!updated) return sendNotFound(c, "rbac_role", id);
  return sendResource(c, "rbac_role_update", updated);
});

rbac.post("/users/:userId/role", async (c) => {
  const userId = c.req.param("userId");
  const body = await c.req.json().catch(() => null);
  const parsed = AssignRoleSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const assigned = assignUserRole(userId, parsed.data.roleId);
  if (!assigned) return sendNotFound(c, "rbac_role", parsed.data.roleId);
  return sendResource(c, "user_role_assignment", assigned);
});

rbac.post("/api-keys", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CreateScopedApiKeySchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const created = createScopedApiKey(parsed.data);
  return sendCreated(
    c,
    "scoped_api_key",
    created,
    `/rbac/api-keys/${created.record.id}`,
  );
});

rbac.delete("/api-keys/:id", (c) => {
  const id = c.req.param("id");
  const revoked = revokeScopedApiKey(id);
  if (!revoked) return sendNotFound(c, "scoped_api_key", id);
  return sendResource(c, "scoped_api_key_revoked", { id, revoked: true });
});

rbac.post("/check", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CheckPermissionSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const result = checkEndpointPermission(parsed.data);
  return sendResource(c, "permission_check", result);
});

rbac.get("/audit/export", (c) => {
  const exported = exportRbacComplianceAudit();
  return sendResource(c, "rbac_compliance_audit", exported);
});

export { rbac };
