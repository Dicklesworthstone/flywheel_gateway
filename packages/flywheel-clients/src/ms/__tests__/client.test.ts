import { describe, expect, test } from "bun:test";
import { MsClientError, createMsClient } from "../index";

function createRunner(stdout: string, exitCode = 0) {
  const calls: { command: string; args: string[] }[] = [];
  return {
    calls,
    run: async (command: string, args: string[]) => {
      calls.push({ command, args });
      return {
        stdout,
        stderr: exitCode === 0 ? "" : "ms error",
        exitCode,
      };
    },
  };
}

function envelope(
  data: unknown,
  ok = true,
  code = "OK",
  hint?: string,
): string {
  return JSON.stringify({
    ok,
    code,
    data,
    hint,
    meta: { v: "1.0.0", ts: "2026-01-27T00:00:00Z" },
  });
}

describe("MS client", () => {
  describe("doctor command", () => {
    test("parses doctor output", async () => {
      const data = {
        status: "healthy",
        checks: [
          { name: "database", status: "ok" },
          { name: "embedding", status: "ok" },
        ],
        embedding_service: {
          available: true,
          model: "text-embedding-3-small",
          latency_ms: 150,
        },
        storage: {
          data_dir: "/home/user/.ms/data",
          size_bytes: 1048576,
          index_count: 5,
        },
      };
      const runner = createRunner(envelope(data));
      const client = createMsClient({ runner });

      const result = await client.doctor();

      expect(result.status).toBe("healthy");
      expect(result.checks).toHaveLength(2);
      expect(result.embedding_service.available).toBe(true);
      expect(result.storage.index_count).toBe(5);
      expect(runner.calls[0]?.args).toContain("doctor");
      expect(runner.calls[0]?.args).toContain("--json");
    });

    test("handles degraded status", async () => {
      const data = {
        status: "degraded",
        checks: [
          { name: "database", status: "ok" },
          { name: "embedding", status: "warning", message: "High latency" },
        ],
        embedding_service: {
          available: true,
          latency_ms: 5000,
        },
        storage: {
          data_dir: "/home/user/.ms/data",
          size_bytes: 0,
          index_count: 0,
        },
      };
      const runner = createRunner(envelope(data));
      const client = createMsClient({ runner });

      const result = await client.doctor();

      expect(result.status).toBe("degraded");
      expect(result.checks[1]?.status).toBe("warning");
    });
  });

  describe("listKnowledgeBases command", () => {
    test("parses knowledge base list", async () => {
      const data = {
        knowledge_bases: [
          {
            name: "skills",
            description: "Claude Code skills",
            entry_count: 150,
            created_at: "2026-01-01T00:00:00Z",
          },
          {
            name: "docs",
            entry_count: 500,
          },
        ],
      };
      const runner = createRunner(envelope(data));
      const client = createMsClient({ runner });

      const result = await client.listKnowledgeBases();

      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe("skills");
      expect(result[0]?.entry_count).toBe(150);
      expect(runner.calls[0]?.args).toContain("list");
    });

    test("returns empty array when no knowledge bases", async () => {
      const runner = createRunner(envelope({}));
      const client = createMsClient({ runner });

      const result = await client.listKnowledgeBases();

      expect(result).toHaveLength(0);
    });
  });

  describe("search command", () => {
    test("parses search results", async () => {
      const data = {
        query: "typescript error handling",
        results: [
          {
            id: "skill-123",
            title: "Error Handling Best Practices",
            snippet: "When handling errors in TypeScript...",
            score: 0.92,
            knowledge_base: "skills",
            source: "error-handling.md",
          },
        ],
        total: 1,
        took_ms: 45,
        semantic_enabled: true,
      };
      const runner = createRunner(envelope(data));
      const client = createMsClient({ runner });

      const result = await client.search("typescript error handling");

      expect(result.query).toBe("typescript error handling");
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.score).toBe(0.92);
      expect(result.semantic_enabled).toBe(true);
      expect(runner.calls[0]?.args).toContain("search");
      expect(runner.calls[0]?.args).toContain("typescript error handling");
    });

    test("passes knowledge base filter", async () => {
      const data = {
        query: "test",
        results: [],
        total: 0,
        took_ms: 10,
        semantic_enabled: true,
      };
      const runner = createRunner(envelope(data));
      const client = createMsClient({ runner });

      await client.search("test", { knowledgeBase: "skills" });

      expect(runner.calls[0]?.args).toContain("-kb");
      expect(runner.calls[0]?.args).toContain("skills");
    });

    test("passes limit option", async () => {
      const data = {
        query: "test",
        results: [],
        total: 0,
        took_ms: 10,
        semantic_enabled: true,
      };
      const runner = createRunner(envelope(data));
      const client = createMsClient({ runner });

      await client.search("test", { limit: 5 });

      expect(runner.calls[0]?.args).toContain("-n");
      expect(runner.calls[0]?.args).toContain("5");
    });

    test("passes threshold option", async () => {
      const data = {
        query: "test",
        results: [],
        total: 0,
        took_ms: 10,
        semantic_enabled: true,
      };
      const runner = createRunner(envelope(data));
      const client = createMsClient({ runner });

      await client.search("test", { threshold: 0.8 });

      expect(runner.calls[0]?.args).toContain("-t");
      expect(runner.calls[0]?.args).toContain("0.8");
    });

    test("disables semantic search", async () => {
      const data = {
        query: "test",
        results: [],
        total: 0,
        took_ms: 5,
        semantic_enabled: false,
      };
      const runner = createRunner(envelope(data));
      const client = createMsClient({ runner });

      await client.search("test", { semantic: false });

      expect(runner.calls[0]?.args).toContain("--no-semantic");
    });
  });

  describe("isAvailable", () => {
    test("returns true when doctor succeeds", async () => {
      const data = {
        status: "healthy",
        checks: [],
        embedding_service: { available: true },
        storage: { data_dir: "", size_bytes: 0, index_count: 0 },
      };
      const runner = createRunner(envelope(data));
      const client = createMsClient({ runner });

      const available = await client.isAvailable();

      expect(available).toBe(true);
    });

    test("returns false when doctor fails", async () => {
      const runner = createRunner("", 1);
      const client = createMsClient({ runner });

      const available = await client.isAvailable();

      expect(available).toBe(false);
    });
  });

  describe("error handling", () => {
    test("throws MsClientError on command failure", async () => {
      const runner = createRunner("", 1);
      const client = createMsClient({ runner });

      let thrown: unknown;
      try {
        await client.doctor();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(MsClientError);
      expect((thrown as MsClientError).kind).toBe("command_failed");
    });

    test("throws parse_error on invalid JSON", async () => {
      const runner = createRunner("not valid json");
      const client = createMsClient({ runner });

      let thrown: unknown;
      try {
        await client.doctor();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(MsClientError);
      expect((thrown as MsClientError).kind).toBe("parse_error");
    });

    test("throws validation_error on schema mismatch", async () => {
      // Missing required fields
      const runner = createRunner(envelope({ status: "healthy" }));
      const client = createMsClient({ runner });

      let thrown: unknown;
      try {
        await client.doctor();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(MsClientError);
      expect((thrown as MsClientError).kind).toBe("validation_error");
    });

    test("throws command_failed when envelope ok is false", async () => {
      const runner = createRunner(
        envelope({}, false, "ERR_NOT_FOUND", "Knowledge base not found"),
      );
      const client = createMsClient({ runner });

      let thrown: unknown;
      try {
        await client.search("test");
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(MsClientError);
      expect((thrown as MsClientError).kind).toBe("command_failed");
    });

    test("error includes diagnostic details", async () => {
      const runner = createRunner("", 42);
      const client = createMsClient({ runner });

      let thrown: unknown;
      try {
        await client.doctor();
      } catch (error) {
        thrown = error;
      }

      const details = (thrown as MsClientError).details;
      expect(details?.exitCode).toBe(42);
    });
  });
});
