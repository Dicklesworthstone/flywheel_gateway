/**
 * Tests for DCG routes.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { dcg } from "../routes/dcg";

describe("DCG Routes", () => {
  const app = new Hono().route("/dcg", dcg);

  describe("GET /dcg/config", () => {
    test("returns current configuration", async () => {
      const res = await app.request("/dcg/config");

      expect(res.status).toBe(200);
      const body = await res.json();
      // Canonical envelope format
      expect(body.object).toBe("dcg_config");
      expect(body.data).toBeDefined();
      expect(body.data.enabledPacks).toBeDefined();
      expect(body.requestId).toBeDefined();
    });
  });

  describe("GET /dcg/packs", () => {
    test("returns list of packs", async () => {
      const res = await app.request("/dcg/packs");

      expect(res.status).toBe(200);
      const body = await res.json();
      // Canonical envelope format - list response
      expect(body.object).toBe("list");
      expect(body.data).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.requestId).toBeDefined();
    });

    test("packs have required properties", async () => {
      const res = await app.request("/dcg/packs");
      const body = await res.json();

      if (body.data.length > 0) {
        const pack = body.data[0];
        expect(pack.name).toBeDefined();
        expect(pack.description).toBeDefined();
        expect(typeof pack.enabled).toBe("boolean");
      }
    });
  });

  describe("GET /dcg/allowlist", () => {
    test("returns allowlist entries", async () => {
      const res = await app.request("/dcg/allowlist");

      expect(res.status).toBe(200);
      const body = await res.json();
      // Canonical envelope format - list response
      expect(body.object).toBe("list");
      expect(body.data).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.requestId).toBeDefined();
    });
  });

  describe("GET /dcg/stats", () => {
    test("returns statistics", async () => {
      const res = await app.request("/dcg/stats");

      expect(res.status).toBe(200);
      const body = await res.json();
      // Canonical envelope format
      expect(body.object).toBe("dcg_statistics");
      expect(body.data).toBeDefined();
      expect(typeof body.data.totalBlocks).toBe("number");
      expect(body.data.blocksByPack).toBeDefined();
      expect(body.data.blocksBySeverity).toBeDefined();
      expect(body.requestId).toBeDefined();
    });
  });

  describe("GET /dcg/status", () => {
    test("returns DCG availability status", async () => {
      const res = await app.request("/dcg/status");

      expect(res.status).toBe(200);
      const body = await res.json();
      // Canonical envelope format
      expect(body.object).toBe("dcg_status");
      expect(body.data).toBeDefined();
      expect(typeof body.data.available).toBe("boolean");
      expect(body.data.message).toBeDefined();
      expect(body.requestId).toBeDefined();
    });
  });

  describe("POST /dcg/blocks/:id/false-positive", () => {
    test("returns 404 for non-existent block", async () => {
      const res = await app.request("/dcg/blocks/nonexistent/false-positive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("BLOCK_EVENT_NOT_FOUND");
    });
  });
});
