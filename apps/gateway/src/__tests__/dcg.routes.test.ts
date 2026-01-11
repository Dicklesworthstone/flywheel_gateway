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
      expect(body.config).toBeDefined();
      expect(body.config.enabledPacks).toBeDefined();
    });
  });

  describe("GET /dcg/packs", () => {
    test("returns list of packs", async () => {
      const res = await app.request("/dcg/packs");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.packs).toBeDefined();
      expect(Array.isArray(body.packs)).toBe(true);
    });

    test("packs have required properties", async () => {
      const res = await app.request("/dcg/packs");
      const body = await res.json();

      if (body.packs.length > 0) {
        const pack = body.packs[0];
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
      expect(body.allowlist).toBeDefined();
      expect(Array.isArray(body.allowlist)).toBe(true);
    });
  });

  describe("GET /dcg/stats", () => {
    test("returns statistics", async () => {
      const res = await app.request("/dcg/stats");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.stats).toBeDefined();
      expect(typeof body.stats.totalBlocks).toBe("number");
      expect(body.stats.blocksByPack).toBeDefined();
      expect(body.stats.blocksBySeverity).toBeDefined();
    });
  });

  describe("GET /dcg/status", () => {
    test("returns DCG availability status", async () => {
      const res = await app.request("/dcg/status");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body.available).toBe("boolean");
      expect(body.message).toBeDefined();
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
      expect(body.error.code).toBe("BLOCK_NOT_FOUND");
    });
  });
});
