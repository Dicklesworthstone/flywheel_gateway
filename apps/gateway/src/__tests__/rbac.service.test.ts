/**
 * RBAC and API Key Scopes Tests (bd-66wud)
 */

import { beforeEach, describe, expect, test } from "bun:test";
import app from "../index";
import {
  assignUserRole,
  checkEndpointPermission,
  clearRbacForTesting,
  createScopedApiKey,
  exportRbacComplianceAudit,
  revokeScopedApiKey,
  updateRolePermissions,
} from "../services/rbac.service";

describe("RBAC and API Key Scopes (bd-66wud)", () => {
  beforeEach(() => {
    delete process.env["GATEWAY_ADMIN_KEY"];
    clearRbacForTesting();
  });

  test("enforces fail-closed endpoint permission annotations and computes role permission diffs", () => {
    assignUserRole("user-viewer", "viewer");

    // Viewer can read agents
    const readCheck = checkEndpointPermission({
      endpoint: "GET /agents",
      userId: "user-viewer",
    });
    expect(readCheck.allowed).toBe(true);

    // Viewer cannot mutate agents
    const writeCheck = checkEndpointPermission({
      endpoint: "POST /agents",
      userId: "user-viewer",
    });
    expect(writeCheck.allowed).toBe(false);

    // Unannotated endpoint fails closed even for owner
    assignUserRole("user-owner", "owner");
    const missingAnnotation = checkEndpointPermission({
      endpoint: "POST /unregistered-endpoint",
      userId: "user-owner",
    });
    expect(missingAnnotation.allowed).toBe(false);
    expect(missingAnnotation.reason).toContain("Fail-closed");

    // Role permission diff computation
    const updated = updateRolePermissions("viewer", [
      "agents:read",
      "agents:write",
      "sessions:read",
    ]);
    expect(updated?.diff.added).toEqual(["agents:write"]);
    expect(updated?.diff.removed).toContain("policies:read");
    expect(updated?.diff.unchanged).toContain("agents:read");
  });

  test("enforces scoped service account API keys with agentIds and workspaceIds resource filters", () => {
    const { record, rawApiKey } = createScopedApiKey({
      name: "ci-runner-key",
      ownerId: "team-platform",
      serviceAccountName: "svc-ci-runner",
      permissions: ["agents:read", "agents:write"],
      resourceFilters: {
        workspaceIds: ["ws-allowed"],
        agentIds: ["agent-1"],
      },
    });

    // Allowed within resource scope
    const ok = checkEndpointPermission({
      endpoint: "POST /agents",
      rawApiKey,
      resourceContext: { workspaceId: "ws-allowed", agentId: "agent-1" },
    });
    expect(ok.allowed).toBe(true);

    // Denied outside workspace scope
    const badWs = checkEndpointPermission({
      endpoint: "POST /agents",
      rawApiKey,
      resourceContext: { workspaceId: "ws-other", agentId: "agent-1" },
    });
    expect(badWs.allowed).toBe(false);

    // Denied after revocation
    revokeScopedApiKey(record.id);
    const afterRevoke = checkEndpointPermission({
      endpoint: "POST /agents",
      rawApiKey,
      resourceContext: { workspaceId: "ws-allowed", agentId: "agent-1" },
    });
    expect(afterRevoke.allowed).toBe(false);

    const audit = exportRbacComplianceAudit();
    expect(audit.auditEvents.length).toBeGreaterThanOrEqual(3);
  });

  test("REST endpoints /rbac/roles, /rbac/api-keys, /rbac/check, and /rbac/audit/export work end-to-end", async () => {
    const rolesRes = await app.request("/rbac/roles");
    expect(rolesRes.status).toBe(200);

    const keyRes = await app.request("/rbac/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "bot-key",
        ownerId: "user-1",
        permissions: ["agents:read"],
      }),
    });
    expect(keyRes.status).toBe(201);
    const keyBody = (await keyRes.json()) as {
      data: { rawApiKey: string };
    };

    const checkRes = await app.request("/rbac/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "GET /agents",
        rawApiKey: keyBody.data.rawApiKey,
      }),
    });
    expect(checkRes.status).toBe(200);
    const checkBody = (await checkRes.json()) as {
      data: { allowed: boolean };
    };
    expect(checkBody.data.allowed).toBe(true);
  });
});
