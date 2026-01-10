import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { defineCommand } from "../define";
import { createCommandRegistry } from "../registry";
import {
  checkCommandParity,
  runParityCheck,
  formatReport,
  formatReportJSON,
} from "../parity-check";

describe("parity-check", () => {
  describe("checkCommandParity", () => {
    it("passes for valid command", () => {
      const cmd = defineCommand({
        name: "test.create",
        description: "Create a test resource",
        input: z.object({ name: z.string() }),
        output: z.object({ id: z.string() }),
        rest: { method: "POST", path: "/tests" },
        metadata: { permissions: ["test:write"], audit: true },
        aiHints: {
          whenToUse: "Create a test",
          examples: ["Create a test resource"],
          relatedCommands: [],
        },
      });

      const result = checkCommandParity(cmd);
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("fails for long-running command without jobId", () => {
      const cmd = defineCommand({
        name: "test.longop",
        description: "A long running operation",
        input: z.object({ name: z.string() }),
        output: z.object({ status: z.string() }), // Missing jobId!
        rest: { method: "POST", path: "/tests/longop" },
        metadata: { permissions: ["test:write"], longRunning: true },
        aiHints: {
          whenToUse: "Start a long operation",
          examples: ["Start a long operation"],
          relatedCommands: [],
        },
      });

      const result = checkCommandParity(cmd);
      expect(result.passed).toBe(false);
      expect(result.errors).toContain(
        "Long-running command must return a jobId field",
      );
    });

    it("passes for long-running command with jobId", () => {
      const cmd = defineCommand({
        name: "test.longop",
        description: "A long running operation",
        input: z.object({ name: z.string() }),
        output: z.object({ jobId: z.string(), status: z.string() }),
        rest: { method: "POST", path: "/tests/longop" },
        metadata: { permissions: ["test:write"], longRunning: true },
        aiHints: {
          whenToUse: "Start a long operation",
          examples: ["Start a long operation"],
          relatedCommands: [],
        },
      });

      const result = checkCommandParity(cmd);
      expect(result.passed).toBe(true);
    });

    it("warns for mutating operation without audit flag", () => {
      const cmd = defineCommand({
        name: "test.update",
        description: "Update a test resource",
        input: z.object({ id: z.string(), name: z.string() }),
        output: z.object({ id: z.string() }),
        rest: { method: "PUT", path: "/tests/:id" },
        metadata: { permissions: ["test:write"] }, // No audit!
        aiHints: {
          whenToUse: "Update a test",
          examples: ["Update a test resource"],
          relatedCommands: [],
        },
      });

      const result = checkCommandParity(cmd);
      expect(result.passed).toBe(true); // Warnings don't fail
      expect(result.warnings).toContain(
        "Mutating operation should have audit: true",
      );
    });

    it("fails when path param is missing from input schema", () => {
      const cmd = defineCommand({
        name: "test.get",
        description: "Get a test resource",
        input: z.object({ name: z.string() }), // Missing testId!
        output: z.object({ id: z.string() }),
        rest: { method: "GET", path: "/tests/:testId" },
        metadata: { permissions: ["test:read"], safe: true },
        aiHints: {
          whenToUse: "Get a test",
          examples: ["Get test by ID"],
          relatedCommands: [],
        },
      });

      const result = checkCommandParity(cmd);
      expect(result.passed).toBe(false);
      expect(result.errors).toContain(
        'Path parameter ":testId" not found in input schema',
      );
    });

    it("passes when path param exists in input schema", () => {
      const cmd = defineCommand({
        name: "test.get",
        description: "Get a test resource",
        input: z.object({ testId: z.string() }),
        output: z.object({ id: z.string() }),
        rest: { method: "GET", path: "/tests/:testId" },
        metadata: { permissions: ["test:read"], safe: true },
        aiHints: {
          whenToUse: "Get a test",
          examples: ["Get test by ID"],
          relatedCommands: [],
        },
      });

      const result = checkCommandParity(cmd);
      expect(result.passed).toBe(true);
    });

    it("warns for streaming endpoint without ws binding", () => {
      const cmd = defineCommand({
        name: "test.stream",
        description: "Stream test data",
        input: z.object({}),
        output: z.object({ chunk: z.string() }),
        rest: { method: "GET", path: "/tests/stream", streaming: true },
        metadata: { permissions: ["test:read"], safe: true },
        aiHints: {
          whenToUse: "Stream test data",
          examples: ["Get streaming data"],
          relatedCommands: [],
        },
      });

      const result = checkCommandParity(cmd);
      expect(result.passed).toBe(true); // Warnings don't fail
      expect(result.warnings).toContain(
        "Streaming endpoint should have WebSocket binding for real-time events",
      );
    });

    it("does not warn for streaming endpoint with ws binding", () => {
      const cmd = defineCommand({
        name: "test.stream",
        description: "Stream test data",
        input: z.object({}),
        output: z.object({ chunk: z.string() }),
        rest: { method: "GET", path: "/tests/stream", streaming: true },
        ws: { emitsEvents: ["test:chunk"] },
        metadata: { permissions: ["test:read"], safe: true },
        aiHints: {
          whenToUse: "Stream test data",
          examples: ["Get streaming data"],
          relatedCommands: [],
        },
      });

      const result = checkCommandParity(cmd);
      expect(result.passed).toBe(true);
      expect(result.warnings).not.toContain(
        "Streaming endpoint should have WebSocket binding for real-time events",
      );
    });
  });

  describe("runParityCheck", () => {
    it("reports all commands in registry", () => {
      const cmd1 = defineCommand({
        name: "test.create",
        description: "Create test",
        input: z.object({ name: z.string() }),
        output: z.object({ id: z.string() }),
        rest: { method: "POST", path: "/tests" },
        metadata: { permissions: ["test:write"], audit: true },
        aiHints: {
          whenToUse: "Create",
          examples: ["Create test"],
          relatedCommands: [],
        },
      });

      const cmd2 = defineCommand({
        name: "test.get",
        description: "Get test",
        input: z.object({ testId: z.string() }),
        output: z.object({ id: z.string() }),
        rest: { method: "GET", path: "/tests/:testId" },
        metadata: { permissions: ["test:read"], safe: true },
        aiHints: {
          whenToUse: "Get",
          examples: ["Get test"],
          relatedCommands: [],
        },
      });

      const registry = createCommandRegistry([cmd1, cmd2]);
      const report = runParityCheck(registry);

      expect(report.totalCommands).toBe(2);
      expect(report.results).toHaveLength(2);
    });

    it("includes registry validation errors", () => {
      // Create commands where one references a non-existent related command
      const cmd = defineCommand({
        name: "test.create",
        description: "Create test",
        input: z.object({ name: z.string() }),
        output: z.object({ id: z.string() }),
        rest: { method: "POST", path: "/tests" },
        metadata: { permissions: ["test:write"], audit: true },
        aiHints: {
          whenToUse: "Create",
          examples: ["Create test"],
          relatedCommands: ["nonexistent.command"], // References non-existent command
        },
      });

      const registry = createCommandRegistry([cmd]);
      const report = runParityCheck(registry);

      // Registry validation should find the missing related command
      const registryResult = report.results.find(
        (r) => r.command === "__registry__",
      );
      expect(registryResult).toBeDefined();
      expect(registryResult?.passed).toBe(false);
    });

    it("generates correct summary for passing checks", () => {
      const cmd = defineCommand({
        name: "test.create",
        description: "Create test",
        input: z.object({ name: z.string() }),
        output: z.object({ id: z.string() }),
        rest: { method: "POST", path: "/tests" },
        metadata: { permissions: ["test:write"], audit: true },
        aiHints: {
          whenToUse: "Create",
          examples: ["Create test"],
          relatedCommands: [],
        },
      });

      const registry = createCommandRegistry([cmd]);
      const report = runParityCheck(registry);

      expect(report.passed).toBe(1);
      expect(report.failed).toBe(0);
      expect(report.summary).toContain("✅");
    });

    it("generates correct summary for failing checks", () => {
      const cmd = defineCommand({
        name: "test.longop",
        description: "Long op",
        input: z.object({ name: z.string() }),
        output: z.object({ status: z.string() }), // Missing jobId
        rest: { method: "POST", path: "/tests/longop" },
        metadata: { permissions: ["test:write"], longRunning: true },
        aiHints: {
          whenToUse: "Long op",
          examples: ["Start long op"],
          relatedCommands: [],
        },
      });

      const registry = createCommandRegistry([cmd]);
      const report = runParityCheck(registry);

      expect(report.failed).toBeGreaterThan(0);
      expect(report.summary).toContain("❌");
    });
  });

  describe("formatReport", () => {
    it("produces readable console output", () => {
      const cmd = defineCommand({
        name: "test.create",
        description: "Create test",
        input: z.object({ name: z.string() }),
        output: z.object({ id: z.string() }),
        rest: { method: "POST", path: "/tests" },
        metadata: { permissions: ["test:write"], audit: true },
        aiHints: {
          whenToUse: "Create",
          examples: ["Create test"],
          relatedCommands: [],
        },
      });

      const registry = createCommandRegistry([cmd]);
      const report = runParityCheck(registry);
      const output = formatReport(report);

      expect(output).toContain("PARITY CHECK REPORT");
      expect(output).toContain("Commands checked:");
    });
  });

  describe("formatReportJSON", () => {
    it("produces valid JSON", () => {
      const cmd = defineCommand({
        name: "test.create",
        description: "Create test",
        input: z.object({ name: z.string() }),
        output: z.object({ id: z.string() }),
        rest: { method: "POST", path: "/tests" },
        metadata: { permissions: ["test:write"], audit: true },
        aiHints: {
          whenToUse: "Create",
          examples: ["Create test"],
          relatedCommands: [],
        },
      });

      const registry = createCommandRegistry([cmd]);
      const report = runParityCheck(registry);
      const json = formatReportJSON(report);

      expect(() => JSON.parse(json)).not.toThrow();
      const parsed = JSON.parse(json);
      expect(parsed.totalCommands).toBe(1);
    });
  });
});
