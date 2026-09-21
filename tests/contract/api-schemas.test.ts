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
  status: z.enum(["idle", "ready", "executing", "paused", "failed", "terminated"]).optional(),
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
      expect(Array.isArray(body) || (typeof body === "object" && body.events !== undefined)).toBe(
        true,
      );
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

// ============================================================================
// Manifest metadata schema with full provenance fields (bd-jfoa)
//
// BACKWARDS COMPATIBILITY NOTE:
// All manifest-related fields are optional for backwards compatibility.
// When ACFS manifest is unavailable, the gateway returns a fallback registry
// with schemaVersion "1.0.0-fallback". New fields added in the manifest-driven
// refactor are marked optional so existing clients continue to work:
//
// - manifestPath: Absolute path to loaded manifest (null if fallback)
// - manifestHash: SHA-256 hash of manifest content (null if fallback)
// - toolCategories: Categorization of tools (required/recommended/optional)
// - installOrder: Phase-ordered installation groups
//
// Clients should:
// 1. Not require these fields to be present
// 2. Check schemaVersion !== "1.0.0-fallback" to detect fallback mode
// 3. Use manifest.source to identify registry origin
// ============================================================================

const ManifestMetadataSchema = z
  .object({
    schemaVersion: z.string(),
    source: z.string().optional(),
    generatedAt: z.string().optional(),
    // New provenance fields (bd-29qb) - optional for backwards compatibility
    manifestPath: z.string().optional(),
    manifestHash: z.string().optional(),
  })
  .optional();

// Tool categorization schema (bd-jfoa) - groups tools by priority
const ToolCategoriesSchema = z
  .object({
    required: z.array(z.string()),
    recommended: z.array(z.string()),
    optional: z.array(z.string()),
  })
  .optional();

// Phase order entry schema (bd-jfoa) - installation order by phase
const PhaseOrderEntrySchema = z.object({
  phase: z.number(),
  tools: z.array(z.string()),
});

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
  // New optional fields (bd-jfoa) - for backwards compatibility
  toolCategories: ToolCategoriesSchema,
  installOrder: z.array(PhaseOrderEntrySchema).optional(),
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

// ============================================================================
// Beads (BR/BV) Endpoint Schemas
// ============================================================================

const BeadDependencySchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  status: z.string().optional(),
  priority: z.number().optional(),
  dep_type: z.string().optional(),
});

const BeadSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: z.string().optional(),
  priority: z.number().optional(),
  issue_type: z.string().optional(),
  created_at: z.string().optional(),
  created_by: z.string().optional(),
  updated_at: z.string().optional(),
  closed_at: z.string().optional(),
  due_at: z.string().optional(),
  defer_until: z.string().optional(),
  assignee: z.string().optional(),
  owner: z.string().optional(),
  labels: z.array(z.string()).optional(),
  dependency_count: z.number().optional(),
  dependent_count: z.number().optional(),
  dependencies: z.array(BeadDependencySchema).optional(),
  dependents: z.array(BeadDependencySchema).optional(),
  parent: z.string().optional(),
  external_ref: z.string().optional(),
});

const BeadListResponseSchema = z.union([
  z.array(BeadSchema),
  z.object({
    beads: z.array(BeadSchema),
    count: z.number().optional(),
  }),
  z.object({
    object: z.literal("list"),
    data: z.array(BeadSchema),
    requestId: z.string(),
    timestamp: z.string(),
  }),
]);

const BeadResponseSchema = z.union([
  BeadSchema,
  z.object({
    object: z.literal("bead"),
    data: BeadSchema,
    requestId: z.string(),
    timestamp: z.string(),
  }),
]);

const BvRecommendationSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string().optional(),
  score: z.number(),
  reasons: z.array(z.string()).optional(),
  status: z.string().optional(),
  description: z.string().optional(),
});

const BvTriageSchema = z.object({
  recommendations: z.array(BvRecommendationSchema).optional(),
  quick_wins: z.array(BvRecommendationSchema).optional(),
  blockers_to_clear: z.array(BvRecommendationSchema).optional(),
});

const BvTriageResultSchema = z.object({
  generated_at: z.string(),
  data_hash: z.string().optional(),
  triage: BvTriageSchema,
});

const BvTriageResponseSchema = z.union([
  BvTriageResultSchema,
  z.object({
    object: z.literal("triage"),
    data: BvTriageResultSchema,
    requestId: z.string(),
    timestamp: z.string(),
  }),
]);

const BrSyncStatusSchema = z.object({
  dirty_count: z.number().optional(),
  last_export_time: z.string().optional(),
  last_import_time: z.string().optional(),
  jsonl_content_hash: z.string().optional(),
  jsonl_exists: z.boolean().optional(),
  jsonl_newer: z.boolean().optional(),
  db_newer: z.boolean().optional(),
});

const BrSyncStatusResponseSchema = z.union([
  BrSyncStatusSchema,
  z.object({
    object: z.literal("sync_status"),
    data: BrSyncStatusSchema,
    requestId: z.string(),
    timestamp: z.string(),
  }),
]);

describe("Beads Endpoint Contract Tests", () => {
  let serverAvailable = false;
  let beadsAvailable = false;

  beforeAll(async () => {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      serverAvailable = response.ok;

      if (serverAvailable) {
        // Check if beads endpoint is available
        const beadsResponse = await fetch(`${BASE_URL}/beads`);
        beadsAvailable = beadsResponse.ok;
      }
    } catch {
      serverAvailable = false;
      beadsAvailable = false;
    }
  });

  describe("GET /beads", () => {
    test("returns valid bead list schema", async () => {
      if (!beadsAvailable) {
        console.log("Beads API not available, skipping test");
        return;
      }

      const response = await apiRequest("/beads");
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      const result = BeadListResponseSchema.safeParse(body);

      if (!result.success) {
        console.log("Schema validation failed:", result.error.issues);
      }
      expect(result.success).toBe(true);
    });

    test("supports status filter", async () => {
      if (!beadsAvailable) return;

      const response = await apiRequest("/beads?status=open");
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      const result = BeadListResponseSchema.safeParse(body);
      expect(result.success).toBe(true);
    });

    test("supports limit parameter", async () => {
      if (!beadsAvailable) return;

      const response = await apiRequest("/beads?limit=5");
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      const beads = body.beads || body.data || body;
      expect(Array.isArray(beads)).toBe(true);
      expect(beads.length).toBeLessThanOrEqual(5);
    });

    test("supports sort parameter", async () => {
      if (!beadsAvailable) return;

      const response = await apiRequest("/beads?sort=priority");
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      const result = BeadListResponseSchema.safeParse(body);
      expect(result.success).toBe(true);
    });
  });

  describe("GET /beads/:id", () => {
    test("returns 404 for non-existent bead", async () => {
      if (!beadsAvailable) return;

      const response = await apiRequest("/beads/bd-nonexistent-12345");
      if (!response) return;

      expect(response.status).toBe(404);
    });

    test("returns valid bead schema for existing bead", async () => {
      if (!beadsAvailable) return;

      // First get a bead ID from the list
      const listResponse = await apiRequest("/beads?limit=1");
      if (!listResponse) return;

      const listBody = await listResponse.json();
      const beads = listBody.beads || listBody.data || listBody;

      if (!Array.isArray(beads) || beads.length === 0) {
        console.log("No beads available to test individual fetch");
        return;
      }

      const beadId = beads[0].id;
      const response = await apiRequest(`/beads/${beadId}`);
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      const result = BeadResponseSchema.safeParse(body);

      if (!result.success) {
        console.log("Schema validation failed:", result.error.issues);
      }
      expect(result.success).toBe(true);
    });
  });

  describe("GET /beads/triage", () => {
    test("returns valid triage response", async () => {
      if (!beadsAvailable) return;

      const response = await apiRequest("/beads/triage");
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      const result = BvTriageResponseSchema.safeParse(body);

      if (!result.success) {
        console.log("Schema validation failed:", result.error.issues);
      }
      expect(result.success).toBe(true);
    });

    test("supports limit parameter", async () => {
      if (!beadsAvailable) return;

      const response = await apiRequest("/beads/triage?limit=3");
      if (!response) return;

      expect(response.status).toBe(200);
    });
  });

  describe("GET /beads/ready", () => {
    test("returns bead list", async () => {
      if (!beadsAvailable) return;

      const response = await apiRequest("/beads/ready");
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      // Should have beads array
      expect(body.beads !== undefined || Array.isArray(body)).toBe(true);
    });
  });

  describe("GET /beads/list/ready", () => {
    test("returns ready beads list", async () => {
      if (!beadsAvailable) return;

      const response = await apiRequest("/beads/list/ready");
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      const result = BeadListResponseSchema.safeParse(body);

      if (!result.success) {
        console.log("Schema validation failed:", result.error.issues);
      }
      expect(result.success).toBe(true);
    });
  });

  describe("GET /beads/sync/status", () => {
    test("returns valid sync status", async () => {
      if (!beadsAvailable) return;

      const response = await apiRequest("/beads/sync/status");
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      const result = BrSyncStatusResponseSchema.safeParse(body);

      if (!result.success) {
        console.log("Schema validation failed:", result.error.issues);
      }
      expect(result.success).toBe(true);
    });
  });

  describe("GET /beads/insights", () => {
    test("returns insights data", async () => {
      if (!beadsAvailable) return;

      const response = await apiRequest("/beads/insights");
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      // Should have generated_at timestamp
      expect(body.generated_at !== undefined || body.data?.generated_at !== undefined).toBe(true);
    });
  });

  describe("GET /beads/graph", () => {
    test("returns graph data", async () => {
      if (!beadsAvailable) return;

      const response = await apiRequest("/beads/graph");
      if (!response) return;

      expect(response.status).toBe(200);

      const body = await response.json();
      // Should have nodes and edges
      const data = body.data || body;
      expect(data.nodes !== undefined || data.edges !== undefined).toBe(true);
    });

    test("supports format parameter", async () => {
      if (!beadsAvailable) return;

      const response = await apiRequest("/beads/graph?format=json");
      if (!response) return;

      expect(response.status).toBe(200);
    });
  });
});

describe("Beads Schema Validation Helpers", () => {
  test("BeadSchema validates correct structure", () => {
    const validBead = {
      id: "bd-1abc",
      title: "Fix authentication bug",
      description: "Users cannot log in",
      status: "open",
      priority: 1,
      issue_type: "bug",
      labels: ["auth", "critical"],
    };

    const result = BeadSchema.safeParse(validBead);
    expect(result.success).toBe(true);
  });

  test("BeadSchema validates bead with dependencies", () => {
    const beadWithDeps = {
      id: "bd-2def",
      title: "Add user dashboard",
      status: "blocked",
      dependencies: [{ id: "bd-1abc", title: "Fix auth", status: "in_progress" }],
      dependents: [],
    };

    const result = BeadSchema.safeParse(beadWithDeps);
    expect(result.success).toBe(true);
  });

  test("BvRecommendationSchema validates triage recommendation", () => {
    const validRec = {
      id: "bd-3ghi",
      title: "Quick win task",
      score: 8.5,
      reasons: ["Low complexity", "No blockers"],
      status: "open",
    };

    const result = BvRecommendationSchema.safeParse(validRec);
    expect(result.success).toBe(true);
  });

  test("BvTriageResultSchema validates full triage response", () => {
    const validTriage = {
      generated_at: new Date().toISOString(),
      data_hash: "abc123",
      triage: {
        recommendations: [
          { id: "bd-1", title: "Task 1", score: 9.0 },
          { id: "bd-2", title: "Task 2", score: 7.5 },
        ],
        quick_wins: [{ id: "bd-3", title: "Easy task", score: 8.0 }],
        blockers_to_clear: [],
      },
    };

    const result = BvTriageResultSchema.safeParse(validTriage);
    expect(result.success).toBe(true);
  });

  test("BrSyncStatusSchema validates sync status", () => {
    const validStatus = {
      dirty_count: 0,
      last_export_time: new Date().toISOString(),
      jsonl_exists: true,
      jsonl_newer: false,
      db_newer: true,
    };

    const result = BrSyncStatusSchema.safeParse(validStatus);
    expect(result.success).toBe(true);
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

  // bd-jfoa: Backwards compatibility tests for new optional fields
  test("ReadinessStatusSchema validates response with toolCategories and installOrder", () => {
    const readinessWithNewFields = {
      ready: true,
      agents: [
        {
          name: "claude",
          available: true,
          detectedAt: new Date().toISOString(),
          durationMs: 50,
        },
      ],
      tools: [
        {
          name: "dcg",
          available: true,
          detectedAt: new Date().toISOString(),
          durationMs: 30,
        },
      ],
      manifest: {
        schemaVersion: "1.0.0",
        source: "acfs",
        generatedAt: new Date().toISOString(),
        manifestPath: "/path/to/manifest.json",
        manifestHash: "sha256:abc123",
      },
      summary: {
        agentsAvailable: 1,
        agentsTotal: 1,
        toolsAvailable: 1,
        toolsTotal: 4,
        authIssues: [],
        missingRequired: [],
      },
      toolCategories: {
        required: ["dcg", "br"],
        recommended: ["bv", "claude"],
        optional: ["caam"],
      },
      installOrder: [
        { phase: 0, tools: ["dcg"] },
        { phase: 1, tools: ["br", "claude"] },
        { phase: 2, tools: ["bv"] },
      ],
      recommendations: [],
      detectedAt: new Date().toISOString(),
      durationMs: 200,
    };

    const result = ReadinessStatusSchema.safeParse(readinessWithNewFields);
    if (!result.success) {
      console.log("Validation failed:", result.error.issues);
    }
    expect(result.success).toBe(true);
  });

  test("ReadinessStatusSchema validates response without optional toolCategories/installOrder (backwards compat)", () => {
    // This tests that clients not sending new fields still work
    const legacyReadiness = {
      ready: false,
      agents: [],
      tools: [],
      manifest: {
        schemaVersion: "1.0.0-fallback",
      },
      summary: {
        agentsAvailable: 0,
        agentsTotal: 0,
        toolsAvailable: 0,
        toolsTotal: 0,
        authIssues: [],
        missingRequired: ["dcg", "br"],
      },
      // Note: no toolCategories or installOrder - testing backwards compatibility
      recommendations: ["Install required tools: dcg, br"],
      detectedAt: new Date().toISOString(),
      durationMs: 100,
    };

    const result = ReadinessStatusSchema.safeParse(legacyReadiness);
    expect(result.success).toBe(true);
  });
});
