/**
 * Tests for utilities routes.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { utilities } from "../routes/utilities";

describe("Utilities Routes", () => {
  const app = new Hono().route("/utilities", utilities);

  describe("GET /utilities", () => {
    test("returns list of utilities", async () => {
      const res = await app.request("/utilities");

      expect(res.status).toBe(200);
      const body = await res.json();
      // Canonical envelope format - list response
      expect(body.object).toBe("list");
      expect(body.data).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.requestId).toBeDefined();
    });
  });

  describe("GET /utilities/doctor", () => {
    test("returns health check results", async () => {
      const res = await app.request("/utilities/doctor");

      expect(res.status).toBe(200);
      const body = await res.json();
      // Canonical envelope format
      expect(body.object).toBe("doctor_result");
      expect(body.data).toBeDefined();
      expect(body.requestId).toBeDefined();
    });
  });

  describe("GET /utilities/:name", () => {
    test("returns status for known utility", async () => {
      const res = await app.request("/utilities/giil");

      expect(res.status).toBe(200);
      const body = await res.json();
      // Canonical envelope format
      expect(body.object).toBe("utility");
      expect(body.data).toBeDefined();
      expect(body.data.name).toBe("giil");
      expect(body.requestId).toBeDefined();
    });

    test("returns 404 for unknown utility", async () => {
      const res = await app.request("/utilities/nonexistent");

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("UTILITY_NOT_FOUND");
    });
  });

  describe("POST /utilities/giil/run - validation", () => {
    test("rejects missing url", async () => {
      const res = await app.request("/utilities/giil/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_FAILED");
    });

    test("rejects invalid url", async () => {
      const res = await app.request("/utilities/giil/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "not-a-url" }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /utilities/csctf/run - validation", () => {
    test("rejects missing url", async () => {
      const res = await app.request("/utilities/csctf/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });
});
