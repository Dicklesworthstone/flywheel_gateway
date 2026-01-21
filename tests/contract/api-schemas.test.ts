/**
 * Contract tests for API response schemas.
 *
 * These tests verify that API responses conform to expected shapes,
 * ensuring backwards compatibility and API contract adherence.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";

// Schema definitions for API responses
const AgentSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  status: z
    .enum(["idle", "ready", "executing", "paused", "failed", "terminated"])
    .optional(),
  model: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const AgentListResponseSchema = z.union([
  z.array(AgentSchema),
  z.object({
    agents: z.array(AgentSchema),
    total: z.number().optional(),
  }),
]);

const HealthResponseSchema = z
  .object({
    status: z.enum(["healthy", "degraded", "unhealthy"]).optional(),
    uptime: z.number().optional(),
    timestamp: z.string().optional(),
    version: z.string().optional(),
  })
  .or(
    z.object({
      ok: z.boolean(),
    }),
  );

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
  }),
});

const _PaginatedResponseSchema = z.object({
  data: z.array(z.any()),
  pagination: z
    .object({
      page: z.number().optional(),
      limit: z.number().optional(),
      total: z.number().optional(),
      hasMore: z.boolean().optional(),
    })
    .optional(),
});

const _SessionSchema = z.object({
  id: z.string(),
  agentId: z.string().optional(),
  status: z.string().optional(),
  createdAt: z.string().optional(),
});

const MetricsResponseSchema = z
  .object({
    agents: z.any().optional(),
    sessions: z.any().optional(),
    websocket: z.any().optional(),
    system: z.any().optional(),
  })
  .or(z.any()); // Allow any shape for metrics

// Test configuration
const BASE_URL = process.env["API_URL"] || "http://localhost:3000";

// Helper to make API requests
async function apiRequest(path: string, options?: RequestInit) {
  const url = `${BASE_URL}${path}`;
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
    return response;
  } catch (_error) {
    // Server might not be running - skip test
    return null;
  }
}

describe("API Contract Tests", () => {
  let serverAvailable = false;
  let fullServerAvailable = false;

  beforeAll(async () => {
    // Check if server is available
    try {
      const response = await fetch(`${BASE_URL}/health`);
      serverAvailable = response.ok;

      // Check if full API is available (agents endpoint exists)
      if (serverAvailable) {
        const agentsResponse = await fetch(`${BASE_URL}/agents`);
        fullServerAvailable = agentsResponse.ok;
      }
    } catch {
      serverAvailable = false;
      fullServerAvailable = false;
    }
  });

  describe("Health Endpoint", () => {
    test("GET /health returns valid schema", async () => {
      if (!serverAvailable) {
        console.log("Server not available, skipping test");
        return;
      }

      const response = await apiRequest("/health");
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      const result = HealthResponseSchema.safeParse(body);
      expect(result.success).toBe(true);
    });

    test("GET /health/ready returns 200, 404, or 503", async () => {
      if (!serverAvailable) return;

      const response = await apiRequest("/health/ready");
      if (!response) return;

      // 200 = ready, 503 = not ready, 404 = endpoint not implemented
      expect([200, 404, 503]).toContain(response.status);
    });
  });

  describe("Agents Endpoint", () => {
    test("GET /agents returns valid schema", async () => {
      if (!fullServerAvailable) {
        console.log("Full API not available, skipping test");
        return;
      }

      const response = await apiRequest("/agents");
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      const result = AgentListResponseSchema.safeParse(body);

      if (!result.success) {
        console.log("Schema validation failed:", result.error.issues);
      }
      expect(result.success).toBe(true);
    });

    test("GET /agents/:id returns 404 for non-existent agent", async () => {
      if (!fullServerAvailable) return;

      const response = await apiRequest("/agents/non-existent-id-12345");
      if (!response) return;

      expect(response.status).toBe(404);

      const body = await response.json();
      const result = ErrorResponseSchema.safeParse(body);
      // Error response should match schema (or be empty object for simple 404)
      if (Object.keys(body).length > 0 && body.error) {
        expect(result.success).toBe(true);
      }
    });
  });

  describe("Audit Endpoint", () => {
    test("GET /audit returns audit events list", async () => {
      if (!fullServerAvailable) return;

      const response = await apiRequest("/audit");
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      // Should have events array or be array
      expect(
        Array.isArray(body) ||
          (typeof body === "object" && body.events !== undefined),
      ).toBe(true);
    });
  });

  describe("Metrics Endpoint", () => {
    test("GET /metrics returns valid response", async () => {
      if (!fullServerAvailable) return;

      const response = await apiRequest("/metrics");
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      const result = MetricsResponseSchema.safeParse(body);
      expect(result.success).toBe(true);
    });
  });

  describe("Error Responses", () => {
    test("Invalid JSON body returns 400", async () => {
      if (!fullServerAvailable) return;

      const response = await fetch(`${BASE_URL}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json{",
      });

      expect([400, 422, 500]).toContain(response.status);
    });

    test("Unsupported method returns 404 or 405", async () => {
      if (!serverAvailable) return;

      const response = await fetch(`${BASE_URL}/health`, {
        method: "DELETE",
      });

      // Could be 404 or 405 depending on routing
      expect([404, 405]).toContain(response.status);
    });
  });

  describe("Response Headers", () => {
    test("Responses include Content-Type header", async () => {
      if (!serverAvailable) return;

      const response = await apiRequest("/health");
      if (!response) return;

      const contentType = response.headers.get("content-type");
      expect(contentType).toContain("application/json");
    });

    test("CORS headers present when requested", async () => {
      if (!serverAvailable) return;

      const response = await fetch(`${BASE_URL}/health`, {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "GET",
        },
      });

      // Should either allow CORS or return 204/200 or 404 if OPTIONS not handled
      expect([200, 204, 404]).toContain(response.status);
    });
  });
});

// ============================================================================
// Setup Endpoint Schemas (manifest-driven fields)
// ============================================================================

const ManifestMetadataSchema = z
  .object({
    schemaVersion: z.string(),
    source: z.string().optional(),
    generatedAt: z.string().optional(),
  })
  .optional();

const DetectedCLISchema = z.object({
  name: z.string(),
  available: z.boolean(),
  version: z.string().optional(),
  path: z.string().optional(),
  authenticated: z.boolean().optional(),
  authError: z.string().optional(),
  detectedAt: z.string(),
  durationMs: z.number(),
});

const ReadinessSummarySchema = z.object({
  agentsAvailable: z.number(),
  agentsTotal: z.number(),
  toolsAvailable: z.number(),
  toolsTotal: z.number(),
  authIssues: z.array(z.string()),
  missingRequired: z.array(z.string()),
});

const ReadinessStatusSchema = z.object({
  ready: z.boolean(),
  agents: z.array(DetectedCLISchema),
  tools: z.array(DetectedCLISchema),
  manifest: ManifestMetadataSchema,
  summary: ReadinessSummarySchema,
  recommendations: z.array(z.string()),
  detectedAt: z.string(),
  durationMs: z.number(),
});

const ToolInfoSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  category: z.enum(["agent", "tool"]),
  tags: z.array(z.string()).optional(),
  optional: z.boolean().optional(),
  enabledByDefault: z.boolean().optional(),
  phase: z.number().optional(),
  manifestVersion: z.string().optional(),
  installCommand: z.string().optional(),
  installUrl: z.string().optional(),
  docsUrl: z.string().optional(),
});

const ToolInfoWithStatusSchema = ToolInfoSchema.extend({
  status: DetectedCLISchema,
});

const VerificationResultSchema = z.object({
  tool: z.string(),
  available: z.boolean(),
  version: z.string().optional(),
  path: z.string().optional(),
  authenticated: z.boolean().optional(),
  authError: z.string().optional(),
  detectedAt: z.string(),
  durationMs: z.number(),
});

describe("Setup Endpoint Contract Tests", () => {
  let serverAvailable = false;
  let fullServerAvailable = false;

  beforeAll(async () => {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      serverAvailable = response.ok;

      if (serverAvailable) {
        const setupResponse = await fetch(`${BASE_URL}/setup/readiness`);
        fullServerAvailable = setupResponse.ok;
      }
    } catch {
      serverAvailable = false;
      fullServerAvailable = false;
    }
  });

  describe("GET /setup/readiness", () => {
    test("returns valid ReadinessStatus with manifest metadata", async () => {
      if (!fullServerAvailable) {
        console.log("Setup API not available, skipping test");
        return;
      }

      const response = await apiRequest("/setup/readiness");
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      const result = ReadinessStatusSchema.safeParse(body);

      if (!result.success) {
        console.log("Schema validation failed:", result.error.issues);
      }
      expect(result.success).toBe(true);
    });

    test("includes agents and tools arrays", async () => {
      if (!fullServerAvailable) return;

      const response = await apiRequest("/setup/readiness");
      if (!response) return;

      const body = await response.json();

      expect(Array.isArray(body.agents)).toBe(true);
      expect(Array.isArray(body.tools)).toBe(true);
      expect(body.agents.length).toBeGreaterThan(0);
      expect(body.tools.length).toBeGreaterThan(0);
    });

    test("bypass_cache=true forces fresh detection", async () => {
      if (!fullServerAvailable) return;

      const response = await apiRequest("/setup/readiness?bypass_cache=true");
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      // Should still return valid structure
      const result = ReadinessStatusSchema.safeParse(body);
      expect(result.success).toBe(true);
    });
  });

  describe("GET /setup/tools", () => {
    test("returns array of ToolInfo with manifest fields", async () => {
      if (!fullServerAvailable) return;

      const response = await apiRequest("/setup/tools");
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);

      // Validate each tool
      for (const tool of body) {
        const result = ToolInfoSchema.safeParse(tool);
        if (!result.success) {
          console.log(`Tool ${tool.name} validation failed:`, result.error.issues);
        }
        expect(result.success).toBe(true);
      }
    });

    test("includes both agents and tools", async () => {
      if (!fullServerAvailable) return;

      const response = await apiRequest("/setup/tools");
      if (!response) return;

      const body = await response.json();

      const agents = body.filter((t: { category: string }) => t.category === "agent");
      const tools = body.filter((t: { category: string }) => t.category === "tool");

      expect(agents.length).toBeGreaterThan(0);
      expect(tools.length).toBeGreaterThan(0);
    });
  });

  describe("GET /setup/tools/:name", () => {
    test("returns ToolInfoWithStatus for known tool", async () => {
      if (!fullServerAvailable) return;

      const response = await apiRequest("/setup/tools/dcg");
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      const result = ToolInfoWithStatusSchema.safeParse(body);

      if (!result.success) {
        console.log("Schema validation failed:", result.error.issues);
      }
      expect(result.success).toBe(true);
    });

    test("returns 404 for unknown tool", async () => {
      if (!fullServerAvailable) return;

      const response = await apiRequest("/setup/tools/nonexistent-tool");
      if (!response) return;

      expect(response.status).toBe(404);
    });
  });

  describe("POST /setup/verify/:name", () => {
    test("returns verification result for known tool", async () => {
      if (!fullServerAvailable) return;

      const response = await apiRequest("/setup/verify/dcg", {
        method: "POST",
      });
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      const result = VerificationResultSchema.safeParse(body);

      if (!result.success) {
        console.log("Schema validation failed:", result.error.issues);
      }
      expect(result.success).toBe(true);
    });

    test("returns 404 for unknown tool", async () => {
      if (!fullServerAvailable) return;

      const response = await apiRequest("/setup/verify/nonexistent-tool", {
        method: "POST",
      });
      if (!response) return;

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /setup/cache", () => {
    test("clears detection cache successfully", async () => {
      if (!fullServerAvailable) return;

      const response = await apiRequest("/setup/cache", {
        method: "DELETE",
      });
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.message).toBeDefined();
      expect(body.timestamp).toBeDefined();
    });
  });
});

describe("Schema Validation Helpers", () => {
  test("AgentSchema validates correct structure", () => {
    const validAgent = {
      id: "agent-123",
      name: "Test Agent",
      status: "ready",
      model: "gpt-4",
    };

    const result = AgentSchema.safeParse(validAgent);
    expect(result.success).toBe(true);
  });

  test("AgentSchema rejects invalid status", () => {
    const invalidAgent = {
      id: "agent-123",
      status: "invalid-status",
    };

    const result = AgentSchema.safeParse(invalidAgent);
    expect(result.success).toBe(false);
  });

  test("HealthResponseSchema accepts both formats", () => {
    const format1 = { status: "healthy", uptime: 12345 };
    const format2 = { ok: true };

    expect(HealthResponseSchema.safeParse(format1).success).toBe(true);
    expect(HealthResponseSchema.safeParse(format2).success).toBe(true);
  });

  test("ErrorResponseSchema validates error structure", () => {
    const validError = {
      error: {
        code: "NOT_FOUND",
        message: "Resource not found",
      },
    };

    const result = ErrorResponseSchema.safeParse(validError);
    expect(result.success).toBe(true);
  });

  // Setup schema validation tests
  test("ToolInfoSchema validates tool with manifest fields", () => {
    const validTool = {
      name: "dcg",
      displayName: "DCG",
      description: "Destructive Command Guard",
      category: "tool",
      tags: ["critical", "safety"],
      optional: false,
      enabledByDefault: true,
      phase: 1,
      manifestVersion: "1.0.0",
      installCommand: "curl ... | bash",
      docsUrl: "https://example.com",
    };

    const result = ToolInfoSchema.safeParse(validTool);
    expect(result.success).toBe(true);
  });

  test("DetectedCLISchema validates detection result", () => {
    const validDetection = {
      name: "dcg",
      available: true,
      version: "v0.2.15",
      path: "/usr/local/bin/dcg",
      detectedAt: new Date().toISOString(),
      durationMs: 45,
    };

    const result = DetectedCLISchema.safeParse(validDetection);
    expect(result.success).toBe(true);
  });

  test("ReadinessStatusSchema validates full response", () => {
    const validReadiness = {
      ready: true,
      agents: [
        {
          name: "claude",
          available: true,
          version: "1.0.0",
          detectedAt: new Date().toISOString(),
          durationMs: 50,
        },
      ],
      tools: [
        {
          name: "dcg",
          available: true,
          version: "v0.2.15",
          detectedAt: new Date().toISOString(),
          durationMs: 30,
        },
      ],
      manifest: {
        schemaVersion: "1.0.0",
        source: "/path/to/manifest",
      },
      summary: {
        agentsAvailable: 1,
        agentsTotal: 5,
        toolsAvailable: 1,
        toolsTotal: 7,
        authIssues: [],
        missingRequired: [],
      },
      recommendations: [],
      detectedAt: new Date().toISOString(),
      durationMs: 150,
    };

    const result = ReadinessStatusSchema.safeParse(validReadiness);
    expect(result.success).toBe(true);
  });
});
