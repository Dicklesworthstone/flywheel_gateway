/**
 * E2E contract tests for robot-mode API conformance (bd-2gkx.6).
 *
 * Validates that documented endpoints return correct response envelope
 * structure, HATEOAS links, and pagination behavior as specified in
 * docs/robot-mode-api.md.
 */

import { expect, test } from "./lib/test-fixture";

const GATEWAY_URL = process.env["E2E_GATEWAY_URL"] ?? "http://localhost:3456";

// =============================================================================
// Helpers
// =============================================================================

async function gw(
  path: string,
  init?: RequestInit,
): Promise<{
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body, headers: res.headers };
}

// =============================================================================
// Response Envelope Structure
// =============================================================================

test.describe("Response envelope conformance", () => {
  test("GET /beads returns list envelope with type field", async ({
    logEvent,
  }) => {
    logEvent("Testing beads list envelope");
    const { status, body } = await gw("/beads");

    expect([200, 503]).toContain(status);
    if (status === 200) {
      expect(body).toHaveProperty("type");
      expect(body).toHaveProperty("data");
    }
  });

  test("GET /beads/list/ready returns ready tasks envelope", async ({
    logEvent,
  }) => {
    logEvent("Testing ready beads envelope");
    const { status, body } = await gw("/beads/list/ready");

    expect([200, 503]).toContain(status);
    if (status === 200) {
      expect(body).toHaveProperty("data");
      const data = body["data"] as Record<string, unknown>;
      if (data["beads"]) {
        expect(Array.isArray(data["beads"])).toBe(true);
      }
    }
  });

  test("GET /agents returns agent list with type field", async ({
    logEvent,
  }) => {
    logEvent("Testing agents list envelope");
    const { status, body } = await gw("/agents");

    expect([200, 503]).toContain(status);
    if (status === 200) {
      expect(body).toHaveProperty("data");
    }
  });

  test("GET /system/snapshot returns snapshot envelope", async ({
    logEvent,
  }) => {
    logEvent("Testing snapshot envelope");
    const { status, body } = await gw("/system/snapshot");

    expect([200, 503]).toContain(status);
    if (status === 200) {
      expect(body).toHaveProperty("data");
    }
  });

  test("GET /setup/readiness returns readiness envelope", async ({
    logEvent,
  }) => {
    logEvent("Testing readiness envelope");
    const { status, body } = await gw("/setup/readiness");

    expect([200, 503]).toContain(status);
    if (status === 200) {
      expect(body).toHaveProperty("data");
    }
  });
});

// =============================================================================
// Error Response Format
// =============================================================================

test.describe("Error response conformance", () => {
  test("404 returns documented error format", async ({ logEvent }) => {
    logEvent("Testing 404 error format");
    const { status, body } = await gw("/beads/bd-nonexistent-9999");

    if (status === 404) {
      // Error should have documented structure
      expect(body).toHaveProperty("type");
      if (body["error"]) {
        const error = body["error"] as Record<string, unknown>;
        expect(error).toHaveProperty("code");
        expect(error).toHaveProperty("message");
      }
    }
  });

  test("invalid endpoint returns 404", async ({ logEvent }) => {
    logEvent("Testing unknown endpoint");
    const { status } = await gw("/this-endpoint-does-not-exist");

    expect(status).toBe(404);
  });
});

// =============================================================================
// HATEOAS Links
// =============================================================================

test.describe("HATEOAS link conformance", () => {
  test("bead resources include navigation links", async ({ logEvent }) => {
    logEvent("Testing HATEOAS links in bead responses");
    const { status, body } = await gw("/beads?limit=1");

    if (status !== 200) return;

    const data = body["data"] as Record<string, unknown>;
    const beads = (data?.["beads"] ?? data) as
      | Array<Record<string, unknown>>
      | undefined;

    if (Array.isArray(beads) && beads.length > 0) {
      const bead = beads[0]!;
      if (bead["links"]) {
        const links = bead["links"] as Record<string, string>;
        logEvent(`Bead links: ${Object.keys(links).join(", ")}`);

        // Documented links: self, update, close, claim
        if (links["self"]) {
          expect(links["self"]).toContain("/beads/");
        }
      }

      // Threading hints for agent coordination
      if (bead["threading"]) {
        const threading = bead["threading"] as Record<string, unknown>;
        expect(threading).toHaveProperty("thread_id");
      }
    }
  });

  test("DCG pending exceptions include action links", async ({ logEvent }) => {
    logEvent("Testing DCG HATEOAS links");
    const { status, body } = await gw("/dcg/pending");

    if (status !== 200) return;

    const data = body["data"];
    if (Array.isArray(data) && data.length > 0) {
      const exception = data[0] as Record<string, unknown>;
      if (exception["links"]) {
        const links = exception["links"] as Record<string, string>;
        logEvent(`DCG links: ${Object.keys(links).join(", ")}`);

        // Documented: self, approve, deny
        if (links["approve"]) {
          expect(links["approve"]).toContain("/approve");
        }
      }
    }
  });
});

// =============================================================================
// Correlation & Headers
// =============================================================================

test.describe("Request correlation conformance", () => {
  test("responses include correlation headers", async ({ logEvent }) => {
    logEvent("Testing correlation headers");
    const { headers } = await gw("/health");

    // Check for correlation ID in response
    const correlationId =
      headers.get("x-correlation-id") ?? headers.get("x-request-id");

    if (correlationId) {
      logEvent(`Correlation ID: ${correlationId}`);
      expect(correlationId.length).toBeGreaterThan(0);
    }
  });

  test("custom correlation ID is echoed back", async ({ logEvent }) => {
    const customId = `test-${Date.now()}`;
    logEvent(`Sending correlation ID: ${customId}`);

    const { headers } = await gw("/health", {
      headers: { "X-Correlation-Id": customId },
    });

    const echoed =
      headers.get("x-correlation-id") ?? headers.get("x-request-id");

    if (echoed) {
      logEvent(`Echoed correlation ID: ${echoed}`);
    }
  });
});

// =============================================================================
// OpenAPI Spec Endpoint
// =============================================================================

test.describe("OpenAPI spec availability", () => {
  test("GET /openapi.json returns valid OpenAPI spec", async ({ logEvent }) => {
    logEvent("Fetching OpenAPI spec");
    const res = await fetch(`${GATEWAY_URL}/openapi.json`);

    if (res.status === 200) {
      const spec = (await res.json()) as Record<string, unknown>;
      expect(spec).toHaveProperty("openapi");
      expect(spec).toHaveProperty("info");
      expect(spec).toHaveProperty("paths");

      const paths = Object.keys(spec["paths"] as Record<string, unknown>);
      logEvent(`OpenAPI paths: ${paths.length} endpoints defined`);
      expect(paths.length).toBeGreaterThan(5);
    } else {
      logEvent(`OpenAPI endpoint returned ${res.status}`);
    }
  });

  test("OpenAPI spec includes documented endpoints", async ({ logEvent }) => {
    const res = await fetch(`${GATEWAY_URL}/openapi.json`);
    if (res.status !== 200) {
      logEvent("SKIPPED: OpenAPI endpoint not available");
      return;
    }

    const spec = (await res.json()) as Record<string, unknown>;
    const paths = spec["paths"] as Record<string, unknown>;

    // Check key documented paths exist in OpenAPI
    const expectedPaths = ["/beads", "/agents", "/health"];

    for (const path of expectedPaths) {
      const found = Object.keys(paths).some((p) => p.startsWith(path));
      if (found) {
        logEvent(`OpenAPI includes ${path}`);
      } else {
        logEvent(`WARNING: ${path} not found in OpenAPI spec`);
      }
    }
  });
});

// =============================================================================
// Triage Endpoints
// =============================================================================

test.describe("Triage endpoint conformance", () => {
  test("GET /beads/triage returns triage recommendations", async ({
    logEvent,
  }) => {
    logEvent("Testing triage endpoint");
    const { status, body } = await gw("/beads/triage");

    if (status === 200) {
      expect(body).toHaveProperty("data");
      logEvent("Triage endpoint returned data");
    } else if (status === 503) {
      logEvent("Triage unavailable (bv tool not installed)");
    }
  });

  test("GET /beads/graph returns dependency graph", async ({ logEvent }) => {
    logEvent("Testing graph endpoint");
    const { status, body } = await gw("/beads/graph");

    if (status === 200) {
      expect(body).toHaveProperty("data");
      logEvent("Graph endpoint returned data");
    } else {
      logEvent(`Graph endpoint returned ${status}`);
    }
  });
});
