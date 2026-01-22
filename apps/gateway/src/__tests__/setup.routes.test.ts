/**
 * Tests for setup routes.
 *
 * Note: Readiness tests are skipped by default because CLI auth checks
 * (especially for claude) can take 30-60+ seconds due to network timeouts.
 * To run these tests, set RUN_SLOW_TESTS=1 environment variable.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { setup } from "../routes/setup";
import { clearDetectionCache } from "../services/agent-detection.service";

type Envelope<T> = {
  object: string;
  data: T;
  error?: {
    code?: string;
  };
};

type ReadinessSummary = {
  agentsAvailable: number;
  toolsAvailable: number;
  agentsTotal: number;
  toolsTotal: number;
  authIssues: unknown[];
  missingRequired: unknown[];
};

type ReadinessData = {
  ready: boolean;
  agents: unknown[];
  tools: unknown[];
  summary: ReadinessSummary;
  recommendations: unknown[];
  detectedAt: string;
  durationMs: number;
};

type ToolInfo = {
  name: string;
  displayName: string;
  description?: string;
  category: string;
  status?: string;
  installCommand?: string | null;
};

type VerificationData = {
  tool: string;
  available: boolean;
  detectedAt: string;
  durationMs: number;
};

type CacheClearData = {
  message: string;
  timestamp: string;
};

type ManifestMetadata = {
  schemaVersion: string;
  source?: string;
  generatedAt?: string;
};

type RegistryRefreshData = {
  manifest: ManifestMetadata;
  toolCount: number;
  refreshedAt: string;
};

describe("Setup Routes", () => {
  const app = new Hono().route("/setup", setup);

  // Note: Readiness tests require full CLI detection which can take 30-60+ seconds
  const runSlowTests = process.env["RUN_SLOW_TESTS"] === "1";

  describe.skipIf(!runSlowTests)("GET /setup/readiness", () => {
    test("returns readiness status with agents and tools", async () => {
      const res = await app.request("/setup/readiness");

      expect(res.status).toBe(200);
      const body = (await res.json()) as Envelope<ReadinessData>;

      // Canonical envelope format
      expect(body.object).toBe("readiness_status");
      expect(body.data).toBeDefined();

      const data = body.data;
      expect(typeof data.ready).toBe("boolean");
      expect(Array.isArray(data.agents)).toBe(true);
      expect(Array.isArray(data.tools)).toBe(true);
      expect(data.summary).toBeDefined();
      expect(typeof data.summary.agentsAvailable).toBe("number");
      expect(typeof data.summary.toolsAvailable).toBe("number");
      expect(Array.isArray(data.recommendations)).toBe(true);
      expect(data.detectedAt).toBeDefined();
      expect(typeof data.durationMs).toBe("number");
    });

    test("includes summary with counts", async () => {
      const res = await app.request("/setup/readiness");
      const body = (await res.json()) as Envelope<ReadinessData>;
      const summary = body.data.summary;

      expect(typeof summary.agentsTotal).toBe("number");
      expect(typeof summary.toolsTotal).toBe("number");
      expect(Array.isArray(summary.authIssues)).toBe(true);
      expect(Array.isArray(summary.missingRequired)).toBe(true);
    });

    test("respects bypass_cache parameter", async () => {
      // First request to populate cache
      await app.request("/setup/readiness");

      // Second request with bypass_cache
      const res = await app.request("/setup/readiness?bypass_cache=true");
      expect(res.status).toBe(200);

      const body = (await res.json()) as Envelope<ReadinessData>;
      expect(body.data.detectedAt).toBeDefined();
    });
  });

  describe("GET /setup/tools", () => {
    test("returns list of known tools", async () => {
      const res = await app.request("/setup/tools");

      expect(res.status).toBe(200);
      const body = (await res.json()) as Envelope<ToolInfo[]>;

      expect(body.object).toBe("list");
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);

      // Check structure of first tool
      const tool = body.data[0]!;
      expect(tool.name).toBeDefined();
      expect(tool.displayName).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.category).toMatch(/^(agent|tool)$/);
    });

    test("includes expected tools", async () => {
      const res = await app.request("/setup/tools");
      const body = (await res.json()) as Envelope<ToolInfo[]>;

      const toolNames = body.data.map((t: { name: string }) => t.name);
      expect(toolNames).toContain("claude");
      expect(toolNames).toContain("dcg");
      expect(toolNames).toContain("br");
    });
  });

  describe("GET /setup/tools/:name", () => {
    test("returns info for known tool", async () => {
      const res = await app.request("/setup/tools/dcg");

      expect(res.status).toBe(200);
      const body = (await res.json()) as Envelope<ToolInfo>;

      expect(body.object).toBe("tool_info");
      expect(body.data.name).toBe("dcg");
      expect(body.data.displayName).toBe("DCG");
      expect(body.data.category).toBe("tool");
      expect(body.data.status).toBeDefined();
    });

    test("returns 404 for unknown tool", async () => {
      const res = await app.request("/setup/tools/nonexistent");

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: unknown };
      expect(body.error).toBeDefined();
    });
  });

  describe("POST /setup/install", () => {
    test("validates request body", async () => {
      const res = await app.request("/setup/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: unknown };
      expect(body.error).toBeDefined();
    });

    test("rejects unknown tool", async () => {
      const res = await app.request("/setup/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "unknown" }),
      });

      expect(res.status).toBe(400);
    });

    test("rejects tool without install command", async () => {
      // claude doesn't have an installCommand in the registry
      const res = await app.request("/setup/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "claude" }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as Envelope<unknown>;
      expect(body.error?.code).toBe("NO_INSTALL_AVAILABLE");
    });
  });

  describe("POST /setup/verify/:name", () => {
    test("verifies tool detection", async () => {
      const res = await app.request("/setup/verify/dcg", {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Envelope<VerificationData>;

      expect(body.object).toBe("verification_result");
      expect(body.data.tool).toBe("dcg");
      expect(typeof body.data.available).toBe("boolean");
      expect(body.data.detectedAt).toBeDefined();
      expect(typeof body.data.durationMs).toBe("number");
    });

    test("returns 404 for unknown tool", async () => {
      const res = await app.request("/setup/verify/nonexistent", {
        method: "POST",
      });

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /setup/cache", () => {
    test("clears detection cache", async () => {
      const res = await app.request("/setup/cache", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Envelope<CacheClearData>;

      expect(body.object).toBe("cache_cleared");
      expect(body.data.message).toBe("Detection cache cleared");
      expect(body.data.timestamp).toBeDefined();
    });
  });

  // ============================================================================
  // Contract tests for manifest refresh endpoint (bd-1jdm)
  //
  // These tests validate the API contract for both success and error cases.
  // When the ACFS manifest is unavailable, the endpoint returns a structured
  // error response - this is tested below.
  // ============================================================================

  describe("POST /setup/registry/refresh", () => {
    test("returns structured error when manifest is unavailable", async () => {
      // Without a manifest file, the endpoint should return a structured error
      const res = await app.request("/setup/registry/refresh", {
        method: "POST",
      });

      // May succeed (200) if manifest exists, or error (5xx) if not
      const body = (await res.json()) as Envelope<RegistryRefreshData>;

      if (res.status === 200) {
        // Success path: verify response schema
        expect(body.object).toBe("registry_refresh");
        expect(body.data).toBeDefined();
        expect(body.data.manifest).toBeDefined();
        expect(typeof body.data.manifest.schemaVersion).toBe("string");
        expect(typeof body.data.toolCount).toBe("number");
        expect(body.data.toolCount).toBeGreaterThanOrEqual(0);
        expect(body.data.refreshedAt).toBeDefined();
        expect(typeof body.data.refreshedAt).toBe("string");
      } else {
        // Error path: verify error response schema
        expect(res.status).toBeGreaterThanOrEqual(500);
        expect(body.error).toBeDefined();
        // Error code may be SYSTEM_UNAVAILABLE (original) or INTERNAL_ERROR (wrapped)
        expect(["SYSTEM_UNAVAILABLE", "INTERNAL_ERROR"]).toContain(
          body.error?.code,
        );
      }
    });

    test("response has valid envelope format", async () => {
      const res = await app.request("/setup/registry/refresh", {
        method: "POST",
      });
      const body = (await res.json()) as Envelope<unknown>;

      // Either success or error should have valid envelope
      if (res.status === 200) {
        expect(body.object).toBe("registry_refresh");
        expect(body.data).toBeDefined();
      } else {
        expect(body.error).toBeDefined();
      }
    });

    test("returns proper content type", async () => {
      const res = await app.request("/setup/registry/refresh", {
        method: "POST",
      });

      expect(res.headers.get("content-type")).toContain("application/json");
    });
  });

  describe("DELETE /setup/registry/cache", () => {
    test("clears tool registry cache", async () => {
      const res = await app.request("/setup/registry/cache", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Envelope<CacheClearData>;

      // Verify canonical envelope format
      expect(body.object).toBe("registry_cache_cleared");
      expect(body.data).toBeDefined();

      // Verify response structure
      expect(body.data.message).toBe("Tool registry cache cleared");
      expect(body.data.timestamp).toBeDefined();
      expect(typeof body.data.timestamp).toBe("string");

      // Should be valid ISO timestamp
      expect(new Date(body.data.timestamp).toISOString()).toBe(
        body.data.timestamp,
      );
    });

    test("returns success even when cache is already empty", async () => {
      // Clear cache first
      await app.request("/setup/registry/cache", { method: "DELETE" });

      // Clear again - should still succeed
      const res = await app.request("/setup/registry/cache", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Envelope<CacheClearData>;
      expect(body.object).toBe("registry_cache_cleared");
      expect(body.data.message).toBe("Tool registry cache cleared");
    });

    test("returns proper content type", async () => {
      const res = await app.request("/setup/registry/cache", {
        method: "DELETE",
      });

      expect(res.headers.get("content-type")).toContain("application/json");
    });

    test("idempotent operation - multiple clears are safe", async () => {
      // Clear multiple times in succession
      for (let i = 0; i < 3; i++) {
        const res = await app.request("/setup/registry/cache", {
          method: "DELETE",
        });
        expect(res.status).toBe(200);
      }
    });
  });
});
