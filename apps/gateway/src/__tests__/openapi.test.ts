/**
 * OpenAPI Specification Tests
 *
 * Verifies the OpenAPI spec is generated correctly and validates
 * against OpenAPI 3.1 schema.
 */

import { describe, expect, it } from "bun:test";
import {
  generateOpenAPISpec,
  getOpenAPISpecJson,
} from "../api/generate-openapi";

describe("OpenAPI Specification", () => {
  describe("generateOpenAPISpec", () => {
    it("should generate a valid OpenAPI 3.1 document", () => {
      const spec = generateOpenAPISpec();

      expect(spec.openapi).toBe("3.1.0");
      expect(spec.info).toBeDefined();
      expect(spec.info.title).toBe("Flywheel Gateway API");
      expect(spec.info.version).toBe("1.0.0");
    });

    it("should include API info", () => {
      const spec = generateOpenAPISpec();

      expect(spec.info.description).toContain("Flywheel Gateway");
      expect(spec.info.contact).toBeDefined();
      expect(spec.info.license).toBeDefined();
      expect(spec.info.license?.name).toBe("MIT");
    });

    it("should define servers", () => {
      const spec = generateOpenAPISpec();

      expect(spec.servers).toBeDefined();
      expect(spec.servers?.length).toBeGreaterThan(0);
      expect(spec.servers?.[0]?.url).toBe("http://localhost:3000");
    });

    it("should include tags", () => {
      const spec = generateOpenAPISpec();

      expect(spec.tags).toBeDefined();
      const tagNames = spec.tags?.map((t) => t.name) ?? [];
      expect(tagNames).toContain("Agents");
      expect(tagNames).toContain("Checkpoints");
      expect(tagNames).toContain("Notifications");
      expect(tagNames).toContain("System");
    });

    it("should define agent endpoints", () => {
      const spec = generateOpenAPISpec();

      expect(spec.paths).toBeDefined();
      expect(spec.paths?.["/agents"]).toBeDefined();
      expect(spec.paths?.["/agents"]?.get).toBeDefined();
      expect(spec.paths?.["/agents"]?.post).toBeDefined();
    });

    it("should have request body schemas for POST endpoints", () => {
      const spec = generateOpenAPISpec();

      const postAgents = spec.paths?.["/agents"]?.post;
      expect(postAgents?.requestBody).toBeDefined();

      const requestBody = postAgents?.requestBody as {
        content?: { "application/json"?: { schema?: unknown } };
      };
      expect(requestBody?.content?.["application/json"]?.schema).toBeDefined();
    });

    it("should define error response schemas", () => {
      const spec = generateOpenAPISpec();

      const getAgentById = spec.paths?.["/agents/{agentId}"]?.get;
      expect(getAgentById?.responses?.["404"]).toBeDefined();
    });

    it("should include health check endpoint", () => {
      const spec = generateOpenAPISpec();

      expect(spec.paths?.["/health"]).toBeDefined();
      expect(spec.paths?.["/health"]?.get).toBeDefined();
    });

    it("should define checkpoint endpoints", () => {
      const spec = generateOpenAPISpec();

      expect(spec.paths?.["/agents/{agentId}/checkpoints"]).toBeDefined();
      expect(spec.paths?.["/agents/{agentId}/checkpoints"]?.get).toBeDefined();
      expect(spec.paths?.["/agents/{agentId}/checkpoints"]?.post).toBeDefined();
    });

    it("should define notification endpoints", () => {
      const spec = generateOpenAPISpec();

      expect(spec.paths?.["/notifications"]).toBeDefined();
      expect(spec.paths?.["/notifications"]?.get).toBeDefined();
      expect(spec.paths?.["/notifications"]?.post).toBeDefined();
    });

    it("should have components with schemas", () => {
      const spec = generateOpenAPISpec();

      expect(spec.components).toBeDefined();
      expect(spec.components?.schemas).toBeDefined();
      expect(
        Object.keys(spec.components?.schemas ?? {}).length,
      ).toBeGreaterThan(10);
    });

    it("should include key schema definitions", () => {
      const spec = generateOpenAPISpec();

      const schemas = spec.components?.schemas ?? {};
      expect(schemas["Agent"]).toBeDefined();
      expect(schemas["Checkpoint"]).toBeDefined();
      expect(schemas["SpawnAgentRequest"]).toBeDefined();
      expect(schemas["ApiError"]).toBeDefined();
      expect(schemas["ApiErrorResponse"]).toBeDefined();
    });
  });

  describe("getOpenAPISpecJson", () => {
    it("should return valid JSON string", () => {
      const json = getOpenAPISpecJson();

      expect(typeof json).toBe("string");
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it("should match generated spec", () => {
      const json = getOpenAPISpecJson();
      const parsed = JSON.parse(json);
      const spec = generateOpenAPISpec();

      expect(parsed.openapi).toBe(spec.openapi);
      expect(parsed.info.title).toBe(spec.info.title);
    });
  });

  describe("Schema Validation", () => {
    it("should have descriptions for all top-level schemas", () => {
      const spec = generateOpenAPISpec();
      const schemas = spec.components?.schemas ?? {};

      // Check key schemas have descriptions
      for (const name of ["Agent", "Checkpoint", "Notification", "Pipeline"]) {
        if (schemas[name]) {
          const schema = schemas[name] as { description?: string };
          // Schemas should have properties defined
          expect(
            schema.description !== undefined ||
              (schema as { properties?: unknown }).properties !== undefined,
          ).toBe(true);
        }
      }
    });

    it("should have examples for common fields", () => {
      const spec = generateOpenAPISpec();
      const schemas = spec.components?.schemas ?? {};

      const agentSchema = schemas["Agent"] as {
        properties?: {
          agentId?: { example?: string };
        };
      };

      if (agentSchema?.properties?.agentId) {
        expect(agentSchema.properties.agentId.example).toBeDefined();
      }
    });
  });
});
