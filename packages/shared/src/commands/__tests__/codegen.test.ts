import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { generateOpenAPIJSON, generateOpenAPISpec } from "../codegen/openapi";
import {
  generateRestRoutes,
  generateRoutesFile,
  getRouteMetadata,
} from "../codegen/rest";
import { defineCommand } from "../define";
import { createCommandRegistry } from "../registry";

describe("REST codegen", () => {
  const testCmd = defineCommand({
    name: "test.create",
    description: "Create a test resource",
    input: z.object({ name: z.string() }),
    output: z.object({ id: z.string() }),
    rest: { method: "POST", path: "/tests" },
    metadata: { permissions: ["test:write"] },
    aiHints: {
      whenToUse: "Create a test",
      examples: ["Create a test resource"],
      relatedCommands: [],
    },
  });

  const testGetCmd = defineCommand({
    name: "test.get",
    description: "Get a test resource",
    input: z.object({ testId: z.string() }),
    output: z.object({ id: z.string(), name: z.string() }),
    rest: { method: "GET", path: "/tests/:testId" },
    metadata: { permissions: ["test:read"], safe: true },
    aiHints: {
      whenToUse: "Get a test",
      examples: ["Get test by ID"],
      relatedCommands: ["test.create"],
    },
  });

  const registry = createCommandRegistry([testCmd, testGetCmd]);

  it("generates routes for all commands", () => {
    const routes = generateRestRoutes(registry);
    expect(routes).toHaveLength(2);
  });

  it("extracts correct method and path", () => {
    const routes = generateRestRoutes(registry);
    const createRoute = routes.find((r) => r.commandName === "test.create");
    expect(createRoute?.method).toBe("POST");
    expect(createRoute?.path).toBe("/tests");
  });

  it("extracts path parameters", () => {
    const routes = generateRestRoutes(registry);
    const getRoute = routes.find((r) => r.commandName === "test.get");
    expect(getRoute?.pathParams).toEqual(["testId"]);
  });

  it("generates handler code", () => {
    const routes = generateRestRoutes(registry);
    const createRoute = routes.find((r) => r.commandName === "test.create");
    expect(createRoute?.handlerCode).toContain("app.post");
    expect(createRoute?.handlerCode).toContain("/tests");
    expect(createRoute?.handlerCode).toContain("test.create");
  });

  it("generates full routes file", () => {
    const file = generateRoutesFile(registry);
    expect(file).toContain("import { Hono }");
    expect(file).toContain("app.post");
    expect(file).toContain("app.get");
    expect(file).toContain("export default app");
  });

  it("generates route metadata", () => {
    const metadata = getRouteMetadata(registry);
    expect(metadata).toHaveLength(2);
    const first = metadata[0];
    expect(first).toBeDefined();
    if (first) {
      expect(first.permissions).toContain("test:write");
    }
  });
});

describe("OpenAPI codegen", () => {
  const testCmd = defineCommand({
    name: "test.create",
    description: "Create a test resource",
    input: z.object({ name: z.string() }),
    output: z.object({ id: z.string() }),
    rest: { method: "POST", path: "/tests" },
    metadata: { permissions: ["test:write"] },
    aiHints: {
      whenToUse: "Create a test",
      examples: ["Create a test resource"],
      relatedCommands: [],
    },
  });

  const registry = createCommandRegistry([testCmd]);

  it("generates valid OpenAPI spec", () => {
    const spec = generateOpenAPISpec(registry, {
      title: "Test API",
      version: "1.0.0",
    });
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Test API");
    expect(spec.info.version).toBe("1.0.0");
  });

  it("includes paths for all commands", () => {
    const spec = generateOpenAPISpec(registry, {
      title: "Test API",
      version: "1.0.0",
    });
    const testPath = spec.paths["/tests"];
    expect(testPath).toBeDefined();
    if (testPath) {
      expect(testPath.post).toBeDefined();
    }
  });

  it("includes AI hints as extension", () => {
    const spec = generateOpenAPISpec(registry, {
      title: "Test API",
      version: "1.0.0",
    });
    const testPath = spec.paths["/tests"];
    expect(testPath).toBeDefined();
    if (testPath) {
      const operation = testPath.post;
      expect(operation?.["x-ai-hints"]).toBeDefined();
      expect(operation?.["x-ai-hints"]?.whenToUse).toBe("Create a test");
    }
  });

  it("generates JSON string", () => {
    const json = generateOpenAPIJSON(registry, {
      title: "Test API",
      version: "1.0.0",
    });
    const parsed = JSON.parse(json);
    expect(parsed.openapi).toBe("3.1.0");
  });

  it("includes optional description when provided", () => {
    const spec = generateOpenAPISpec(registry, {
      title: "Test API",
      version: "1.0.0",
      description: "A test API",
    });
    expect(spec.info.description).toBe("A test API");
  });

  it("omits description when not provided", () => {
    const spec = generateOpenAPISpec(registry, {
      title: "Test API",
      version: "1.0.0",
    });
    expect(spec.info.description).toBeUndefined();
  });
});
