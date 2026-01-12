/**
 * Tests for audit routes.
 */

import { describe, expect, test, mock, beforeEach } from "bun:test";
import { Hono } from "hono";
import audit from "../routes/audit";

// Mock the correlation middleware
mock.module("../middleware/correlation", () => ({
  getCorrelationId: () => "test-correlation-id",
  getLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

// Mock the utils/response module
mock.module("../utils/response", () => ({
  sendError: (c: any, status: number, code: string, message: string) =>
    c.json({ error: { code, message } }, status),
  sendInternalError: (c: any) =>
    c.json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, 500),
  sendNotFound: (c: any, type: string, id: string) =>
    c.json({ error: { code: "NOT_FOUND", message: `${type} not found: ${id}` } }, 404),
  sendResource: (c: any, data: any) => c.json(data),
  sendValidationError: (c: any, errors: any) =>
    c.json({ error: { code: "VALIDATION_ERROR", details: errors } }, 400),
}));

// Mock the utils/validation module
mock.module("../utils/validation", () => ({
  transformZodError: (error: any) =>
    error.errors?.map((e: any) => ({ path: e.path.join("."), message: e.message })) ?? [],
}));

// Mock the database
const mockEvents = [
  {
    id: "event-1",
    correlationId: "corr-1",
    accountId: "user-1",
    action: "agent.spawn",
    resource: "agent-123",
    resourceType: "agent",
    outcome: "success",
    metadata: { foo: "bar" },
    createdAt: new Date("2026-01-10T10:00:00Z"),
  },
  {
    id: "event-2",
    correlationId: "corr-1",
    accountId: "user-1",
    action: "agent.terminate",
    resource: "agent-123",
    resourceType: "agent",
    outcome: "success",
    metadata: null,
    createdAt: new Date("2026-01-10T11:00:00Z"),
  },
];

mock.module("../db", () => ({
  db: {
    select: () => ({
      from: () => {
        // Create a chainable mock that supports multiple query patterns
        const chain: any = {
          where: (cond: any) => ({
            orderBy: () => {
              // For correlated events route - returns a thenable
              const orderByChain: any = {
                limit: (n: number) => ({
                  offset: () => Promise.resolve(mockEvents.slice(0, n)),
                }),
                then: (resolve: any) => resolve(mockEvents),
              };
              return orderByChain;
            },
            groupBy: () => Promise.resolve([{ action: "agent.spawn", count: 5 }]),
            limit: (n: number) => Promise.resolve(mockEvents.slice(0, n)),
          }),
          orderBy: () => ({
            limit: (n: number) => Promise.resolve(mockEvents.slice(0, n)),
          }),
          groupBy: () => Promise.resolve([{ action: "agent.spawn", count: 5 }]),
          limit: (n: number) => Promise.resolve(mockEvents.slice(0, n)),
        };
        return chain;
      },
    }),
  },
}));

// Mock drizzle-orm operators
mock.module("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  desc: (col: unknown) => col,
  eq: (col: unknown, val: unknown) => ({ col, val }),
  gte: (col: unknown, val: unknown) => ({ col, val }),
  lte: (col: unknown, val: unknown) => ({ col, val }),
  like: (col: unknown, val: unknown) => ({ col, val }),
  inArray: (col: unknown, vals: unknown) => ({ col, vals }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => strings.join(""),
  count: () => "count",
}));

describe("Audit Routes", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route("/audit", audit);
  });

  describe("GET /audit - Search", () => {
    test("returns audit events with default parameters", async () => {
      const res = await app.request("/audit");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("events");
      expect(body).toHaveProperty("total");
      expect(body).toHaveProperty("hasMore");
    });

    test("accepts limit parameter", async () => {
      const res = await app.request("/audit?limit=10");
      expect(res.status).toBe(200);
    });

    test("accepts offset parameter", async () => {
      const res = await app.request("/audit?offset=20");
      expect(res.status).toBe(200);
    });

    test("accepts sort parameter", async () => {
      const res = await app.request("/audit?sort=asc");
      expect(res.status).toBe(200);
    });

    test("accepts correlationId filter", async () => {
      const res = await app.request("/audit?correlationId=corr-1");
      expect(res.status).toBe(200);
    });

    test("accepts action filter", async () => {
      const res = await app.request("/audit?action=agent.spawn");
      expect(res.status).toBe(200);
    });

    test("accepts resourceType filter", async () => {
      const res = await app.request("/audit?resourceType=agent");
      expect(res.status).toBe(200);
    });

    test("accepts status filter", async () => {
      const res = await app.request("/audit?status=success");
      expect(res.status).toBe(200);
    });

    test("accepts date range filters", async () => {
      const res = await app.request(
        "/audit?startDate=2026-01-01T00:00:00Z&endDate=2026-01-31T23:59:59Z",
      );
      expect(res.status).toBe(200);
    });

    test("rejects invalid limit", async () => {
      const res = await app.request("/audit?limit=5000");
      expect(res.status).toBe(400);
    });

    test("rejects invalid sort value", async () => {
      const res = await app.request("/audit?sort=invalid");
      expect(res.status).toBe(400);
    });
  });

  describe("GET /audit/correlation/:correlationId - Correlated Events", () => {
    test("returns events for correlation ID", async () => {
      const res = await app.request("/audit/correlation/corr-1");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("events");
      expect(body).toHaveProperty("correlationId", "corr-1");
    });
  });

  describe("POST /audit/export - Create Export", () => {
    test("creates export job with valid parameters", async () => {
      const res = await app.request("/audit/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "json",
          startDate: "2026-01-01T00:00:00Z",
          endDate: "2026-01-31T23:59:59Z",
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("jobId");
      expect(body).toHaveProperty("status", "processing");
    });

    test("rejects missing date range", async () => {
      const res = await app.request("/audit/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "json",
        }),
      });
      expect(res.status).toBe(400);
    });

    test("rejects invalid format", async () => {
      const res = await app.request("/audit/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "invalid",
          startDate: "2026-01-01T00:00:00Z",
          endDate: "2026-01-31T23:59:59Z",
        }),
      });
      expect(res.status).toBe(400);
    });

    test("accepts csv format", async () => {
      const res = await app.request("/audit/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "csv",
          startDate: "2026-01-01T00:00:00Z",
          endDate: "2026-01-31T23:59:59Z",
        }),
      });
      expect(res.status).toBe(200);
    });

    test("accepts json_lines format", async () => {
      const res = await app.request("/audit/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "json_lines",
          startDate: "2026-01-01T00:00:00Z",
          endDate: "2026-01-31T23:59:59Z",
        }),
      });
      expect(res.status).toBe(200);
    });

    test("accepts compression option", async () => {
      const res = await app.request("/audit/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "json",
          startDate: "2026-01-01T00:00:00Z",
          endDate: "2026-01-31T23:59:59Z",
          compression: "gzip",
        }),
      });
      expect(res.status).toBe(200);
    });

    test("accepts action filters", async () => {
      const res = await app.request("/audit/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "json",
          startDate: "2026-01-01T00:00:00Z",
          endDate: "2026-01-31T23:59:59Z",
          actions: ["agent.spawn", "agent.terminate"],
        }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe("GET /audit/export/:jobId - Get Export Status", () => {
    test("returns 404 for non-existent job", async () => {
      const res = await app.request("/audit/export/non-existent-job");
      expect(res.status).toBe(404);
    });
  });

  describe("Retention Policies", () => {
    describe("GET /audit/retention-policies - List Policies", () => {
      test("returns list of retention policies", async () => {
        const res = await app.request("/audit/retention-policies");
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty("policies");
        expect(Array.isArray(body.policies)).toBe(true);
        // Should have default policies
        expect(body.policies.length).toBeGreaterThan(0);
      });
    });

    describe("POST /audit/retention-policies - Create Policy", () => {
      test("creates new retention policy", async () => {
        const res = await app.request("/audit/retention-policies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Test Policy",
            description: "A test retention policy",
            filter: {
              actions: ["auth.login"],
            },
            retention: {
              duration: 180,
              archiveFirst: true,
            },
            enabled: true,
          }),
        });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body).toHaveProperty("id");
        expect(body).toHaveProperty("name", "Test Policy");
        expect(body).toHaveProperty("retention");
        expect(body.retention.duration).toBe(180);
      });

      test("rejects policy without name", async () => {
        const res = await app.request("/audit/retention-policies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filter: {},
            retention: { duration: 90 },
          }),
        });
        expect(res.status).toBe(400);
      });

      test("rejects policy without retention duration", async () => {
        const res = await app.request("/audit/retention-policies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Test",
            filter: {},
            retention: {},
          }),
        });
        expect(res.status).toBe(400);
      });

      test("rejects retention duration over 10 years", async () => {
        const res = await app.request("/audit/retention-policies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Test",
            filter: {},
            retention: { duration: 4000 }, // > 3650 days
          }),
        });
        expect(res.status).toBe(400);
      });
    });

    describe("PUT /audit/retention-policies/:id - Update Policy", () => {
      test("returns 404 for non-existent policy", async () => {
        const res = await app.request(
          "/audit/retention-policies/non-existent-id",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "Updated Name",
            }),
          },
        );
        expect(res.status).toBe(404);
      });
    });

    describe("DELETE /audit/retention-policies/:id - Delete Policy", () => {
      test("returns 404 for non-existent policy", async () => {
        const res = await app.request(
          "/audit/retention-policies/non-existent-id",
          {
            method: "DELETE",
          },
        );
        expect(res.status).toBe(404);
      });
    });
  });

  describe("Analytics", () => {
    describe("GET /audit/analytics/summary - Get Summary", () => {
      test("returns analytics summary", async () => {
        const res = await app.request("/audit/analytics/summary");
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty("total");
        expect(body).toHaveProperty("byAction");
        expect(body).toHaveProperty("byOutcome");
        expect(body).toHaveProperty("byResourceType");
      });

      test("accepts date range", async () => {
        const res = await app.request(
          "/audit/analytics/summary?startDate=2026-01-01T00:00:00Z&endDate=2026-01-31T23:59:59Z",
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty("timeRange");
        expect(body.timeRange.start).toBe("2026-01-01T00:00:00Z");
        expect(body.timeRange.end).toBe("2026-01-31T23:59:59Z");
      });
    });
  });
});
