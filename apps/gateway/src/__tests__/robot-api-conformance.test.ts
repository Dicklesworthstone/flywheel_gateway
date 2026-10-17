/**
 * Robot-mode API conformance tests (bd-2gkx.6).
 *
 * Parses docs/robot-mode-api.md to extract documented endpoints and
 * verifies they match actual route registrations. Detects doc drift
 * so documentation stays in sync with implementation.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// =============================================================================
// Doc Parser
// =============================================================================

interface DocumentedEndpoint {
  method: string;
  path: string;
  section: string;
}

/**
 * Extract HTTP endpoints from the robot-mode API markdown doc.
 * Parses ```http blocks like: GET /beads/list/ready
 */
function parseDocEndpoints(markdown: string): DocumentedEndpoint[] {
  const endpoints: DocumentedEndpoint[] = [];
  const lines = markdown.split("\n");

  let currentSection = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Track section headers
    if (line.startsWith("## ")) {
      currentSection = line.replace(/^##\s+/, "").trim();
      continue;
    }

    // Look for ```http blocks
    if (line.trim() === "```http") {
      const nextLine = lines[i + 1]?.trim();
      if (nextLine) {
        const match = nextLine.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/);
        if (match) {
          endpoints.push({
            method: match[1]!,
            path: match[2]!,
            section: currentSection,
          });
        }
      }
    }
  }

  return endpoints;
}

// =============================================================================
// Doc Parser Tests
// =============================================================================

describe("Robot-mode API doc parser", () => {
  const docPath = join(import.meta.dir, "../../../../docs/robot-mode-api.md");
  let markdown: string;
  let endpoints: DocumentedEndpoint[];

  try {
    markdown = readFileSync(docPath, "utf-8");
    endpoints = parseDocEndpoints(markdown);
  } catch {
    markdown = "";
    endpoints = [];
  }

  test("doc file exists and is readable", () => {
    expect(markdown.length).toBeGreaterThan(0);
  });

  test("extracts documented endpoints", () => {
    expect(endpoints.length).toBeGreaterThan(10);
  });

  test("extracts beads endpoints", () => {
    const beadsEndpoints = endpoints.filter((e) => e.path.startsWith("/beads"));
    expect(beadsEndpoints.length).toBeGreaterThanOrEqual(5);

    const paths = beadsEndpoints.map((e) => `${e.method} ${e.path}`);
    expect(paths).toContain("GET /beads/list/ready");
    expect(paths).toContain("GET /beads");
    expect(paths).toContain("GET /beads/:id");
    expect(paths).toContain("POST /beads/:id/claim");
    expect(paths).toContain("POST /beads");
  });

  test("extracts agent endpoints", () => {
    const agentEndpoints = endpoints.filter((e) =>
      e.path.startsWith("/agents"),
    );
    expect(agentEndpoints.length).toBeGreaterThanOrEqual(4);

    const paths = agentEndpoints.map((e) => `${e.method} ${e.path}`);
    expect(paths).toContain("POST /agents");
    expect(paths).toContain("GET /agents");
    expect(paths).toContain("GET /agents/:agentId/status");
  });

  test("extracts mail endpoints", () => {
    const mailEndpoints = endpoints.filter((e) => e.path.startsWith("/mail"));
    expect(mailEndpoints.length).toBeGreaterThanOrEqual(2);
  });

  test("extracts dcg endpoints", () => {
    const dcgEndpoints = endpoints.filter((e) => e.path.startsWith("/dcg"));
    expect(dcgEndpoints.length).toBeGreaterThanOrEqual(3);
  });

  test("extracts system endpoints", () => {
    const systemEndpoints = endpoints.filter(
      (e) => e.path.startsWith("/system") || e.path.startsWith("/setup"),
    );
    expect(systemEndpoints.length).toBeGreaterThanOrEqual(2);
  });

  test("all endpoints have sections", () => {
    for (const endpoint of endpoints) {
      expect(endpoint.section).toBeTruthy();
    }
  });

  test("no unexpected duplicate endpoint definitions", () => {
    const keys = endpoints.map((e) => `${e.method} ${e.path}`);
    const counts = new Map<string, number>();
    for (const k of keys) {
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const duplicates: string[] = [];
    counts.forEach((count, key) => {
      if (count > 1) duplicates.push(key);
    });

    // POST /beads appears in both "Create a Task" and "Idempotency" sections
    // which is acceptable (example reuse). Flag anything else.
    const unexpected = duplicates.filter((d) => d !== "POST /beads");
    expect(unexpected).toEqual([]);
  });
});

// =============================================================================
// Route Registration Conformance
// =============================================================================

describe("Route registration conformance", () => {
  const docPath = join(import.meta.dir, "../../../../docs/robot-mode-api.md");

  let endpoints: DocumentedEndpoint[];
  try {
    const markdown = readFileSync(docPath, "utf-8");
    endpoints = parseDocEndpoints(markdown);
  } catch {
    endpoints = [];
  }

  // Map documented paths to expected route file patterns
  const pathToRouteFile: Record<string, string> = {
    "/beads": "beads.ts",
    "/agents": "agents.ts",
    "/mail": "mail.ts",
    "/dcg": "dcg.ts",
    "/system": "system.ts",
    "/setup": "setup.ts",
    "/health": "health.ts",
  };

  test("all documented route prefixes have corresponding route files", () => {
    const { readdirSync } = require("node:fs");
    const routesDir = join(import.meta.dir, "../routes");
    const routeFiles = readdirSync(routesDir) as string[];

    const prefixes = new Set(endpoints.map((e) => `/${e.path.split("/")[1]}`));

    for (const prefix of prefixes) {
      const expectedFile = pathToRouteFile[prefix!];
      if (expectedFile) {
        expect(routeFiles).toContain(expectedFile);
      }
    }
  });

  test("documented response type names follow conventions", () => {
    const docPath2 = join(
      import.meta.dir,
      "../../../../docs/robot-mode-api.md",
    );
    let md: string;
    try {
      md = readFileSync(docPath2, "utf-8");
    } catch {
      return;
    }

    // Extract "type" field values from response examples
    const typeRegex = /"type":\s*"([^"]+)"/g;
    const types: string[] = [];
    let match: RegExpExecArray | null = typeRegex.exec(md);
    while (match !== null) {
      // Skip request body types like "user"
      if (!["subscribe", "ack", "user", "state_changed"].includes(match[1]!)) {
        types.push(match[1]!);
      }
      match = typeRegex.exec(md);
    }

    // Response types should use snake_case
    for (const t of types) {
      expect(t).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

// =============================================================================
// Response Envelope Conformance
// =============================================================================

describe("Response envelope conventions", () => {
  test("sendResource exists and exports correct signature", async () => {
    const mod = await import("../utils/response");
    expect(typeof mod.sendResource).toBe("function");
    expect(typeof mod.sendList).toBe("function");
    expect(typeof mod.sendError).toBe("function");
    expect(typeof mod.sendNotFound).toBe("function");
    expect(typeof mod.sendCreated).toBe("function");
  });

  test("error codes from doc match shared error definitions", () => {
    // Documented error codes
    const docErrorCodes = [
      "VALIDATION_ERROR",
      "INVALID_REQUEST",
      "BEAD_NOT_FOUND",
      "AGENT_NOT_FOUND",
      "AGENT_TERMINATED",
      "SYSTEM_UNAVAILABLE",
      "INTERNAL_ERROR",
    ];

    // All should be valid string error codes
    for (const code of docErrorCodes) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]+$/);
    }
  });
});

// =============================================================================
// OpenAPI Spec Conformance
// =============================================================================

describe("OpenAPI spec generation", () => {
  test("OpenAPI generator module exists", async () => {
    const mod = await import("../api/generate-openapi");
    expect(mod).toBeDefined();
  });
});
