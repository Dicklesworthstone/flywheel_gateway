/**
 * Scanner Routes Tests
 *
 * Tests for the UBS (Ultimate Bug Scanner) REST API endpoints.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import { scanner } from "../routes/scanner";
import {
  type UBSService,
  setUBSService,
  _resetUBSStore,
  type ScanResult,
  type Finding,
} from "../services/ubs.service";

// ============================================================================
// Test Setup
// ============================================================================

const app = new Hono();
app.route("/scanner", scanner);

function createMockFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "fnd_test123",
    type: "bug",
    severity: "high",
    file: "src/app.ts",
    line: 42,
    column: 10,
    message: "Potential null reference",
    suggestion: "Add null check",
    category: "null-safety",
    confidence: 0.95,
    status: "open",
    ...overrides,
  };
}

function createMockScanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  const findings = overrides.findings || [createMockFinding()];
  return {
    scanId: "scan_test123",
    status: "success",
    exitCode: 0,
    startedAt: new Date("2026-01-11T10:00:00Z"),
    completedAt: new Date("2026-01-11T10:00:03Z"),
    durationMs: 3000,
    filesScanned: 100,
    findings,
    summary: {
      total: findings.length,
      critical: findings.filter((f) => f.severity === "critical").length,
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
      byCategory: {},
    },
    ...overrides,
  };
}

function createMockService(): UBSService {
  const findings = new Map<string, Finding>();
  const scans = new Map<string, ScanResult>();

  return {
    runScan: mock(async () => {
      const result = createMockScanResult();
      scans.set(result.scanId, result);
      result.findings.forEach((f) => findings.set(f.id, f));
      return result;
    }),
    getFindings: mock(() => Array.from(findings.values())),
    getFinding: mock((id: string) => findings.get(id)),
    dismissFinding: mock((id: string, dismissedBy: string, reason: string) => {
      const finding = findings.get(id);
      if (!finding) return false;
      finding.status = "dismissed";
      finding.dismissedBy = dismissedBy;
      finding.dismissedAt = new Date();
      finding.dismissReason = reason;
      return true;
    }),
    getScanHistory: mock(() => [
      {
        scanId: "scan_test123",
        startedAt: new Date("2026-01-11T10:00:00Z"),
        completedAt: new Date("2026-01-11T10:00:03Z"),
        durationMs: 3000,
        exitCode: 0,
        filesScanned: 100,
        totalFindings: 5,
        criticalFindings: 1,
        paths: ["."],
      },
    ]),
    getScan: mock((id: string) => scans.get(id)),
    getStats: mock(() => ({
      totalScans: 10,
      totalFindings: 50,
      openFindings: 35,
      dismissedFindings: 15,
    })),
    checkHealth: mock(async () => ({
      available: true,
      version: "ubs 1.0.0",
    })),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("Scanner Routes", () => {
  let mockService: UBSService;

  beforeEach(() => {
    _resetUBSStore();
    mockService = createMockService();
    setUBSService(mockService);
  });

  describe("POST /scanner/run", () => {
    test("runs a scan with default options", async () => {
      const res = await app.request("/scanner/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.scanId).toBeDefined();
      expect(body.data.status).toBe("success");
      expect(body.data.findings).toBeInstanceOf(Array);
      expect(mockService.runScan).toHaveBeenCalled();
    });

    test("runs a scan with custom options", async () => {
      const res = await app.request("/scanner/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paths: ["src/"],
          languages: ["typescript"],
          profile: "strict",
          failOnWarning: true,
        }),
      });

      expect(res.status).toBe(201);
      expect(mockService.runScan).toHaveBeenCalledWith(
        expect.objectContaining({
          paths: ["src/"],
          languages: ["typescript"],
          profile: "strict",
          failOnWarning: true,
        })
      );
    });

    test("validates scan options", async () => {
      const res = await app.request("/scanner/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: "invalid",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("GET /scanner/findings", () => {
    test("returns findings list", async () => {
      // First run a scan to populate findings
      await app.request("/scanner/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await app.request("/scanner/findings");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(mockService.getFindings).toHaveBeenCalled();
    });

    test("filters findings by severity", async () => {
      const res = await app.request("/scanner/findings?severity=critical");

      expect(res.status).toBe(200);
      expect(mockService.getFindings).toHaveBeenCalledWith(
        expect.objectContaining({ severity: "critical" })
      );
    });

    test("filters findings by status", async () => {
      const res = await app.request("/scanner/findings?status=open");

      expect(res.status).toBe(200);
      expect(mockService.getFindings).toHaveBeenCalledWith(
        expect.objectContaining({ status: "open" })
      );
    });

    test("supports pagination", async () => {
      const res = await app.request("/scanner/findings?limit=10&offset=5");

      expect(res.status).toBe(200);
      expect(mockService.getFindings).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 5 })
      );
    });
  });

  describe("GET /scanner/findings/:id", () => {
    test("returns a specific finding", async () => {
      // Populate the mock with a finding
      const finding = createMockFinding({ id: "fnd_specific" });
      (mockService.getFinding as ReturnType<typeof mock>).mockImplementation(
        (id: string) => (id === "fnd_specific" ? finding : undefined)
      );

      const res = await app.request("/scanner/findings/fnd_specific");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe("fnd_specific");
    });

    test("returns 404 for unknown finding", async () => {
      (mockService.getFinding as ReturnType<typeof mock>).mockImplementation(
        () => undefined
      );

      const res = await app.request("/scanner/findings/fnd_unknown");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /scanner/findings/:id/dismiss", () => {
    test("dismisses a finding", async () => {
      const finding = createMockFinding({ id: "fnd_todismiss" });

      // Mock dismissFinding to return true (success)
      (mockService.dismissFinding as ReturnType<typeof mock>).mockImplementation(
        () => true
      );

      // Mock getFinding to return the updated finding after dismissal
      (mockService.getFinding as ReturnType<typeof mock>).mockImplementation(
        (id: string) => {
          if (id === "fnd_todismiss") {
            return {
              ...finding,
              status: "dismissed",
              dismissedBy: "agent-1",
              dismissedAt: new Date(),
              dismissReason: "False positive - intentional pattern",
            };
          }
          return undefined;
        }
      );

      const res = await app.request("/scanner/findings/fnd_todismiss/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dismissedBy: "agent-1",
          reason: "False positive - intentional pattern",
        }),
      });

      expect(res.status).toBe(200);
      expect(mockService.dismissFinding).toHaveBeenCalledWith(
        "fnd_todismiss",
        "agent-1",
        "False positive - intentional pattern"
      );
    });

    test("returns 404 for unknown finding", async () => {
      (mockService.dismissFinding as ReturnType<typeof mock>).mockImplementation(
        () => false
      );

      const res = await app.request("/scanner/findings/fnd_unknown/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dismissedBy: "agent-1",
          reason: "Test",
        }),
      });

      expect(res.status).toBe(404);
    });

    test("validates dismiss request", async () => {
      const res = await app.request("/scanner/findings/fnd_test/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Missing required fields
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /scanner/history", () => {
    test("returns scan history", async () => {
      const res = await app.request("/scanner/history");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(mockService.getScanHistory).toHaveBeenCalled();
    });

    test("respects limit parameter", async () => {
      const res = await app.request("/scanner/history?limit=5");

      expect(res.status).toBe(200);
      expect(mockService.getScanHistory).toHaveBeenCalledWith(5);
    });
  });

  describe("GET /scanner/scans/:id", () => {
    test("returns a specific scan", async () => {
      const scan = createMockScanResult({ scanId: "scan_specific" });
      (mockService.getScan as ReturnType<typeof mock>).mockImplementation(
        (id: string) => (id === "scan_specific" ? scan : undefined)
      );

      const res = await app.request("/scanner/scans/scan_specific");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.scanId).toBe("scan_specific");
    });

    test("returns 404 for unknown scan", async () => {
      (mockService.getScan as ReturnType<typeof mock>).mockImplementation(
        () => undefined
      );

      const res = await app.request("/scanner/scans/scan_unknown");

      expect(res.status).toBe(404);
    });
  });

  describe("GET /scanner/stats", () => {
    test("returns scanner statistics", async () => {
      const res = await app.request("/scanner/stats");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.totalScans).toBe(10);
      expect(body.data.totalFindings).toBe(50);
      expect(body.data.openFindings).toBe(35);
      expect(body.data.dismissedFindings).toBe(15);
    });
  });

  describe("GET /scanner/health", () => {
    test("returns health status when available", async () => {
      const res = await app.request("/scanner/health");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.available).toBe(true);
      expect(body.data.version).toBeDefined();
    });

    test("returns health status when unavailable", async () => {
      (mockService.checkHealth as ReturnType<typeof mock>).mockImplementation(
        async () => ({
          available: false,
          error: "UBS not found",
        })
      );

      const res = await app.request("/scanner/health");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.available).toBe(false);
      expect(body.data.error).toBe("UBS not found");
    });
  });
});
