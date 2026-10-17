/**
 * Tests for shared route error handler utility.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import { createRouteErrorHandler } from "../utils/error-handler";
import { sendNotFound } from "../utils/response";

// Custom error for testing domain-specific handling
class CustomNotFoundError extends Error {
  constructor(public readonly resourceId: string) {
    super(`Resource ${resourceId} not found`);
    this.name = "CustomNotFoundError";
  }
}

describe("createRouteErrorHandler", () => {
  test("handles ZodError and returns 400 with validation errors", async () => {
    const handleError = createRouteErrorHandler("test");

    const app = new Hono();
    const TestSchema = z.object({ name: z.string().min(1) });

    app.post("/test", async (c) => {
      try {
        const body = await c.req.json();
        TestSchema.parse(body);
        return c.json({ success: true });
      } catch (error) {
        return handleError(error, c);
      }
    });

    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.object).toBe("error");
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  test("handles SyntaxError for invalid JSON and returns 400", async () => {
    const handleError = createRouteErrorHandler("test");

    const app = new Hono();
    app.post("/test", async (c) => {
      try {
        await c.req.json();
        return c.json({ success: true });
      } catch (error) {
        return handleError(error, c);
      }
    });

    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ invalid }",
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.error.message).toContain("JSON");
  });

  test("handles domain-specific errors with custom handlers", async () => {
    const handleError = createRouteErrorHandler("test", [
      {
        match: (err) => err instanceof CustomNotFoundError,
        handle: (err, c) =>
          sendNotFound(c, "resource", (err as CustomNotFoundError).resourceId),
      },
    ]);

    const app = new Hono();
    app.get("/test/:id", (c) => {
      try {
        throw new CustomNotFoundError(c.req.param("id"));
      } catch (error) {
        return handleError(error, c);
      }
    });

    const res = await app.request("/test/abc123");

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(body.error.message).toContain("abc123");
  });

  test("falls through to internal error when match returns false", async () => {
    const handleError = createRouteErrorHandler("test", [
      {
        match: (err) => err instanceof CustomNotFoundError,
        handle: (err, c) =>
          sendNotFound(c, "resource", (err as CustomNotFoundError).resourceId),
      },
    ]);

    const app = new Hono();
    app.get("/test", (c) => {
      try {
        throw new Error("Something else went wrong");
      } catch (error) {
        // This should fall through to the default internal error handler
        return handleError(error, c);
      }
    });

    // Since CustomNotFoundError doesn't match, should fall through to 500
    const res = await app.request("/test");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  test("domain handler can return undefined to fall through", async () => {
    const handleError = createRouteErrorHandler("test", [
      {
        match: () => true, // Always matches
        handle: () => undefined, // But returns undefined
      },
    ]);

    const TestSchema = z.object({ name: z.string().min(1) });

    const app = new Hono();
    app.post("/test", async (c) => {
      try {
        const body = await c.req.json();
        TestSchema.parse(body);
        return c.json({ success: true });
      } catch (error) {
        return handleError(error, c);
      }
    });

    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });

    // Should fall through to ZodError handler
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});
