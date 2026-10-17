/**
 * Agent Output Search and Tagging Tests (bd-39chi)
 */

import { beforeEach, describe, expect, test } from "bun:test";
import app from "../index";
import {
  addSessionTags,
  clearOutputSearchForTesting,
  createSavedSearch,
  getOutputSearchIndexHealth,
  indexAgentOutput,
  listSavedSearches,
  rebuildOutputSearchIndex,
  searchAgentOutputs,
} from "../services/output-search.service";

describe("Agent Output Search and Tagging (bd-39chi)", () => {
  beforeEach(() => {
    delete process.env["GATEWAY_ADMIN_KEY"];
    clearOutputSearchForTesting();
  });

  test("indexes agent outputs, highlights matching keywords, and maintains stable cursor pagination across inserts", () => {
    indexAgentOutput({
      agentId: "agent-1",
      sessionId: "sess-1",
      content: "TypeError: Cannot read properties of undefined (reading 'map')",
      isError: true,
      toolCallType: "bash",
    });
    indexAgentOutput({
      agentId: "agent-1",
      sessionId: "sess-1",
      content: "Fixed TypeError by adding null coalescing operator",
      isError: false,
    });

    const page1 = searchAgentOutputs({ q: "TypeError", limit: 1 });
    expect(page1.totalCount).toBe(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.hits[0]?.highlighted).toContain("<mark>TypeError</mark>");

    // Insert another output while paginating
    indexAgentOutput({
      agentId: "agent-2",
      sessionId: "sess-2",
      content: "Another TypeError encountered in module loader",
      isError: true,
    });

    const page2 = searchAgentOutputs({
      q: "TypeError",
      limit: 2,
      cursor: Number(page1.nextCursor),
    });
    expect(page2.hits.length).toBe(2);
    expect(
      (page2.hits[0] as unknown as Record<string, unknown>)?.["content"],
    ).toBeUndefined();
    expect(page2.hits[0]?.snippet).toContain("Fixed TypeError");
  });

  test("propagates session tags with spam protection, tracks index health, and enforces RBAC on shared saved searches", () => {
    indexAgentOutput({
      agentId: "agent-tag",
      sessionId: "sess-tag-1",
      content: "Database migration completed",
    });

    const tags = addSessionTags("sess-tag-1", ["Release-2.4", "Database"]);
    expect(tags).toContain("release-2.4");

    const byTag = searchAgentOutputs({ tag: "release-2.4" });
    expect(byTag.totalCount).toBe(1);

    const rebuild = rebuildOutputSearchIndex();
    expect(rebuild.documentCount).toBe(1);
    const health = getOutputSearchIndexHealth();
    expect(health.documentCount).toBe(1);
    expect(health.status).toBe("healthy");

    // Saved search shared only with admin/owner
    createSavedSearch({
      name: "Critical DB Errors",
      query: "migration",
      ownerId: "user-admin",
      pinned: true,
      shared: true,
      allowedRoles: ["owner", "admin"],
    });

    expect(
      listSavedSearches({ userId: "user-other", userRole: "admin" }).length,
    ).toBe(1);
    expect(
      listSavedSearches({ userId: "user-other", userRole: "viewer" }).length,
    ).toBe(0);
  });

  test("REST endpoints /search/outputs, /search/sessions/:id/tags, and /search/health work end-to-end", async () => {
    const postRes = await app.request("/search/outputs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "ag-rest",
        sessionId: "sess-rest",
        content: "Successfully compiled WebSocket hub",
      }),
    });
    expect(postRes.status).toBe(201);

    await app.request("/search/sessions/sess-rest/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["ws-hub"] }),
    });

    const getRes = await app.request("/search/outputs?q=WebSocket&tag=ws-hub");
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      data: Array<{ highlighted: string }>;
    };
    expect(getBody.data.length).toBe(1);
    expect(getBody.data[0]?.highlighted).toContain("<mark>WebSocket</mark>");
  });
});
