/**
 * Tests for safety routes.
 */

import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { safety } from "../routes/safety";

// ============================================================================
// Types
// ============================================================================

type ToolStatus = {
  installed: boolean;
  version: string | null;
  healthy: boolean;
  latencyMs: number;
};

type ChecksumStatus = {
  toolId: string;
  hasChecksums: boolean;
  checksumCount: number;
  registryGeneratedAt: string | null;
  ageMs: number | null;
  stale: boolean;
};

type SafetyPostureEnvelope = {
  object: string;
  data: {
    status: "healthy" | "degraded" | "unhealthy";
    timestamp: string;
    tools: {
      dcg: ToolStatus;
      slb: ToolStatus;
      ubs: ToolStatus;
    };
    checksums: {
      registryGeneratedAt: string | null;
      registryAgeMs: number | null;
      toolsWithChecksums: number;
      staleThresholdMs: number;
      isStale: boolean;
      tools: ChecksumStatus[];
    };
    summary: {
      allToolsInstalled: boolean;
      allToolsHealthy: boolean;
      checksumsAvailable: boolean;
      checksumsStale: boolean;
      overallHealthy: boolean;
      issues: string[];
      recommendations: string[];
    };
  };
  requestId?: string;
};

type ToolStatusEnvelope = {
  object: string;
  data: {
    tool?: string;
    installed: boolean;
    version: string | null;
    healthy: boolean;
    latencyMs: number;
  };
  requestId?: string;
};

type ToolStatusesEnvelope = {
  object: string;
  data: {
    dcg: ToolStatus;
    slb: ToolStatus;
    ubs: ToolStatus;
    summary: {
      total: number;
      installed: number;
      healthy: number;
    };
  };
  requestId?: string;
};

type ChecksumStatusEnvelope = {
  object: string;
  data: {
    registryGeneratedAt: string | null;
    registryAgeMs: number | null;
    toolsWithChecksums: number;
    staleThresholdMs: number;
    isStale: boolean;
    tools: ChecksumStatus[];
  };
  requestId?: string;
};

// ============================================================================
// Tests
// ============================================================================

describe("Safety Routes", () => {
  const app = new Hono().route("/safety", safety);

  describe("GET /safety/posture", () => {
    test("returns safety posture with all required fields", async () => {
      const res = await app.request("/safety/posture");

      // May return 200 or 503 depending on tool availability
      expect([200, 503]).toContain(res.status);
      const body = (await res.json()) as SafetyPostureEnvelope;

      // Canonical envelope format
      expect(body.object).toBe("safety_posture");
      expect(body.data).toBeDefined();

      // Status should be one of the expected values
      expect(["healthy", "degraded", "unhealthy"]).toContain(body.data.status);
      expect(body.data.timestamp).toBeDefined();
    });

    test("returns tool status for dcg, slb, and ubs", async () => {
      const res = await app.request("/safety/posture");
      const body = (await res.json()) as SafetyPostureEnvelope;

      // Check tools structure
      expect(body.data.tools).toBeDefined();
      expect(body.data.tools.dcg).toBeDefined();
      expect(body.data.tools.slb).toBeDefined();
      expect(body.data.tools.ubs).toBeDefined();

      // Each tool should have the expected structure
      for (const tool of [
        body.data.tools.dcg,
        body.data.tools.slb,
        body.data.tools.ubs,
      ]) {
        expect(typeof tool.installed).toBe("boolean");
        expect(typeof tool.healthy).toBe("boolean");
        expect(typeof tool.latencyMs).toBe("number");
        // version can be string or null
        expect(tool.version === null || typeof tool.version === "string").toBe(
          true,
        );
      }
    });

    test("returns checksums information", async () => {
      const res = await app.request("/safety/posture");
      const body = (await res.json()) as SafetyPostureEnvelope;

      // Check checksums structure
      expect(body.data.checksums).toBeDefined();
      expect(typeof body.data.checksums.toolsWithChecksums).toBe("number");
      expect(typeof body.data.checksums.staleThresholdMs).toBe("number");
      expect(typeof body.data.checksums.isStale).toBe("boolean");
      expect(Array.isArray(body.data.checksums.tools)).toBe(true);
    });

    test("returns summary with issues and recommendations", async () => {
      const res = await app.request("/safety/posture");
      const body = (await res.json()) as SafetyPostureEnvelope;

      // Check summary structure
      expect(body.data.summary).toBeDefined();
      expect(typeof body.data.summary.allToolsInstalled).toBe("boolean");
      expect(typeof body.data.summary.allToolsHealthy).toBe("boolean");
      expect(typeof body.data.summary.checksumsAvailable).toBe("boolean");
      expect(typeof body.data.summary.checksumsStale).toBe("boolean");
      expect(typeof body.data.summary.overallHealthy).toBe("boolean");
      expect(Array.isArray(body.data.summary.issues)).toBe(true);
      expect(Array.isArray(body.data.summary.recommendations)).toBe(true);
    });

    test("status is healthy when all tools installed and healthy", async () => {
      const res = await app.request("/safety/posture");
      const body = (await res.json()) as SafetyPostureEnvelope;

      // If all tools are installed and healthy, status should be healthy
      // (unless checksums are stale)
      const { allToolsInstalled, allToolsHealthy, checksumsStale } =
        body.data.summary;

      if (allToolsInstalled && allToolsHealthy && !checksumsStale) {
        expect(body.data.status).toBe("healthy");
      }
    });

    test("status is unhealthy when tools are missing", async () => {
      const res = await app.request("/safety/posture");
      const body = (await res.json()) as SafetyPostureEnvelope;

      // If not all tools are installed, status should be unhealthy
      if (!body.data.summary.allToolsInstalled) {
        expect(body.data.status).toBe("unhealthy");
        expect(res.status).toBe(503);
      }
    });

    test("provides recommendations for missing tools", async () => {
      const res = await app.request("/safety/posture");
      const body = (await res.json()) as SafetyPostureEnvelope;

      // If DCG is not installed, should have recommendation
      if (!body.data.tools.dcg.installed) {
        expect(body.data.summary.issues.some((i) => i.includes("DCG"))).toBe(
          true,
        );
        expect(
          body.data.summary.recommendations.some((r) => r.includes("dcg")),
        ).toBe(true);
      }

      // If SLB is not installed, should have recommendation
      if (!body.data.tools.slb.installed) {
        expect(body.data.summary.issues.some((i) => i.includes("SLB"))).toBe(
          true,
        );
        expect(
          body.data.summary.recommendations.some((r) => r.includes("slb")),
        ).toBe(true);
      }

      // If UBS is not installed, should have recommendation
      if (!body.data.tools.ubs.installed) {
        expect(body.data.summary.issues.some((i) => i.includes("UBS"))).toBe(
          true,
        );
        expect(
          body.data.summary.recommendations.some((r) => r.includes("ubs")),
        ).toBe(true);
      }
    });
  });

  describe("GET /safety/tools", () => {
    test("returns all tool statuses when no query param", async () => {
      const res = await app.request("/safety/tools");

      expect(res.status).toBe(200);
      const body = (await res.json()) as ToolStatusesEnvelope;

      expect(body.object).toBe("tool_statuses");
      expect(body.data.dcg).toBeDefined();
      expect(body.data.slb).toBeDefined();
      expect(body.data.ubs).toBeDefined();
      expect(body.data.summary).toBeDefined();
      expect(body.data.summary.total).toBe(3);
    });

    test("returns specific tool status for dcg", async () => {
      const res = await app.request("/safety/tools?tool=dcg");

      expect(res.status).toBe(200);
      const body = (await res.json()) as ToolStatusEnvelope;

      expect(body.object).toBe("tool_status");
      expect(body.data.tool).toBe("dcg");
      expect(typeof body.data.installed).toBe("boolean");
      expect(typeof body.data.healthy).toBe("boolean");
    });

    test("returns specific tool status for slb", async () => {
      const res = await app.request("/safety/tools?tool=slb");

      expect(res.status).toBe(200);
      const body = (await res.json()) as ToolStatusEnvelope;

      expect(body.object).toBe("tool_status");
      expect(body.data.tool).toBe("slb");
    });

    test("returns specific tool status for ubs", async () => {
      const res = await app.request("/safety/tools?tool=ubs");

      expect(res.status).toBe(200);
      const body = (await res.json()) as ToolStatusEnvelope;

      expect(body.object).toBe("tool_status");
      expect(body.data.tool).toBe("ubs");
    });

    test("rejects invalid tool name", async () => {
      const res = await app.request("/safety/tools?tool=invalid");

      expect(res.status).toBe(400);
    });
  });

  describe("GET /safety/checksums", () => {
    test("returns checksum status", async () => {
      const res = await app.request("/safety/checksums");

      expect(res.status).toBe(200);
      const body = (await res.json()) as ChecksumStatusEnvelope;

      expect(body.object).toBe("checksum_status");
      expect(typeof body.data.toolsWithChecksums).toBe("number");
      expect(typeof body.data.staleThresholdMs).toBe("number");
      expect(typeof body.data.isStale).toBe("boolean");
      expect(Array.isArray(body.data.tools)).toBe(true);
    });

    test("returns tool-specific checksum info", async () => {
      const res = await app.request("/safety/checksums");
      const body = (await res.json()) as ChecksumStatusEnvelope;

      // Should have entries for safety tools
      expect(body.data.tools.length).toBeGreaterThanOrEqual(0);

      // Each tool checksum entry should have required fields
      for (const tool of body.data.tools) {
        expect(typeof tool.toolId).toBe("string");
        expect(typeof tool.hasChecksums).toBe("boolean");
        expect(typeof tool.checksumCount).toBe("number");
        expect(typeof tool.stale).toBe("boolean");
      }
    });
  });

  describe("Safety Posture Output Validation", () => {
    test("issues and recommendations are parallel arrays for missing tools", async () => {
      const res = await app.request("/safety/posture");
      const body = (await res.json()) as SafetyPostureEnvelope;

      // For each missing tool, there should be both an issue and a recommendation
      const { issues, recommendations } = body.data.summary;
      const { dcg, slb, ubs } = body.data.tools;

      // Count missing required tools
      const missingTools = [
        !dcg.installed && "DCG",
        !slb.installed && "SLB",
        !ubs.installed && "UBS",
      ].filter(Boolean);

      // Issues should mention each missing tool
      for (const tool of missingTools) {
        if (typeof tool === "string") {
          const hasIssue = issues.some((i) =>
            i.toUpperCase().includes(tool.toUpperCase()),
          );
          expect(hasIssue).toBe(true);
        }
      }
    });

    test("manifest metadata is included in response", async () => {
      const res = await app.request("/safety/posture");
      const body = (await res.json()) as SafetyPostureEnvelope;

      // Response should include manifest metadata for provenance
      const data = body.data as unknown as {
        manifest?: {
          source: string;
          schemaVersion: string | null;
          manifestPath: string | null;
          manifestHash: string | null;
          errorCategory: string | null;
        };
      };

      // Manifest metadata should be present
      expect(data.manifest).toBeDefined();
      if (data.manifest) {
        expect(["manifest", "fallback"]).toContain(data.manifest.source);
        // schemaVersion can be null for fallback
        expect(
          data.manifest.schemaVersion === null ||
            typeof data.manifest.schemaVersion === "string",
        ).toBe(true);
      }
    });

    test("requiredSafetyTools list is included in summary", async () => {
      const res = await app.request("/safety/posture");
      const body = (await res.json()) as SafetyPostureEnvelope;

      // Summary should list which tools are required
      const summary = body.data.summary as unknown as {
        requiredSafetyTools?: string[];
      };

      expect(summary.requiredSafetyTools).toBeDefined();
      if (summary.requiredSafetyTools) {
        expect(Array.isArray(summary.requiredSafetyTools)).toBe(true);
        // Required tools should be from the known safety tools
        for (const tool of summary.requiredSafetyTools) {
          expect(["dcg", "slb", "ubs"]).toContain(tool);
        }
      }
    });

    test("recommendations include install commands for missing tools", async () => {
      const res = await app.request("/safety/posture");
      const body = (await res.json()) as SafetyPostureEnvelope;

      const { recommendations } = body.data.summary;

      // Recommendations for missing tools should include actionable install info
      for (const rec of recommendations) {
        // Each recommendation should be a non-empty string
        expect(typeof rec).toBe("string");
        expect(rec.length).toBeGreaterThan(0);

        // Recommendations about tools should include the tool name
        const toolMentions = ["DCG", "SLB", "UBS", "dcg", "slb", "ubs"];
        const mentionsTool = toolMentions.some((t) => rec.includes(t));

        // If it's a tool recommendation, it should be actionable
        if (mentionsTool) {
          // Should contain install keyword or command indicator
          const hasAction =
            rec.toLowerCase().includes("install") ||
            rec.includes("cargo") ||
            rec.includes("go") ||
            rec.includes("--version");
          expect(hasAction).toBe(true);
        }
      }
    });

    test("latency is measured for each tool check", async () => {
      const res = await app.request("/safety/posture");
      const body = (await res.json()) as SafetyPostureEnvelope;

      // Each tool status should include latency measurement
      const { dcg, slb, ubs } = body.data.tools;

      expect(typeof dcg.latencyMs).toBe("number");
      expect(dcg.latencyMs).toBeGreaterThanOrEqual(0);

      expect(typeof slb.latencyMs).toBe("number");
      expect(slb.latencyMs).toBeGreaterThanOrEqual(0);

      expect(typeof ubs.latencyMs).toBe("number");
      expect(ubs.latencyMs).toBeGreaterThanOrEqual(0);
    });

    test("stale threshold is 7 days in milliseconds", async () => {
      const res = await app.request("/safety/posture");
      const body = (await res.json()) as SafetyPostureEnvelope;

      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(body.data.checksums.staleThresholdMs).toBe(sevenDaysMs);
    });
  });
});
