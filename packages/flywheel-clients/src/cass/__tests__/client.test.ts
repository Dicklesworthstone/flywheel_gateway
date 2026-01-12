/**
 * CASS Client Unit Tests
 */

import { describe, expect, test, beforeEach } from "bun:test";
import {
  type CassCommandRunner,
  CassClientError,
  createCassClient,
} from "../index";

// ============================================================================
// Mock Command Runner
// ============================================================================

class MockCassRunner implements CassCommandRunner {
  private responses: Map<
    string,
    { stdout: string; stderr: string; exitCode: number }
  > = new Map();
  private callHistory: { command: string; args: string[] }[] = [];

  setResponse(
    pattern: string,
    response: { stdout: string; stderr: string; exitCode: number },
  ): void {
    this.responses.set(pattern, response);
  }

  getCallHistory(): { command: string; args: string[] }[] {
    return [...this.callHistory];
  }

  clearHistory(): void {
    this.callHistory = [];
  }

  async run(
    command: string,
    args: string[],
    _options?: { cwd?: string; timeout?: number },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    this.callHistory.push({ command, args });

    // Find matching response
    for (const [pattern, response] of this.responses) {
      if (args.join(" ").includes(pattern)) {
        return response;
      }
    }

    // Default failure response
    return { stdout: "", stderr: "Command not mocked", exitCode: 1 };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("CASS Client", () => {
  let runner: MockCassRunner;

  beforeEach(() => {
    runner = new MockCassRunner();
  });

  describe("health", () => {
    test("returns health status when cass is healthy", async () => {
      runner.setResponse("health", {
        stdout: JSON.stringify({ healthy: true, latency_ms: 5 }),
        stderr: "",
        exitCode: 0,
      });

      const client = createCassClient({ runner });
      const health = await client.health();

      expect(health.healthy).toBe(true);
      expect(health.latency_ms).toBe(5);
    });

    test("includes meta when requested", async () => {
      runner.setResponse("health", {
        stdout: JSON.stringify({
          healthy: true,
          latency_ms: 3,
          _meta: { elapsed_ms: 2, data_dir: "/home/user/.cass" },
        }),
        stderr: "",
        exitCode: 0,
      });

      const client = createCassClient({ runner });
      const health = await client.health({ includeMeta: true });

      expect(health.healthy).toBe(true);
      expect(health._meta?.data_dir).toBe("/home/user/.cass");

      // Verify --robot-meta flag was included
      const calls = runner.getCallHistory();
      expect(calls[0]!.args).toContain("--robot-meta");
    });

    test("throws CassClientError on command failure", async () => {
      runner.setResponse("health", {
        stdout: "",
        stderr: "cass: command not found",
        exitCode: 127,
      });

      const client = createCassClient({ runner });

      await expect(client.health()).rejects.toThrow(CassClientError);
    });
  });

  describe("isAvailable", () => {
    test("returns true when cass responds", async () => {
      runner.setResponse("health", {
        stdout: "OK",
        stderr: "",
        exitCode: 0,
      });

      const client = createCassClient({ runner });
      const available = await client.isAvailable();

      expect(available).toBe(true);
    });

    test("returns false when cass fails", async () => {
      runner.setResponse("health", {
        stdout: "",
        stderr: "error",
        exitCode: 1,
      });

      const client = createCassClient({ runner });
      const available = await client.isAvailable();

      expect(available).toBe(false);
    });
  });

  describe("search", () => {
    test("searches with query and returns results", async () => {
      runner.setResponse("search", {
        stdout: JSON.stringify({
          count: 2,
          cursor: null,
          hits: [
            {
              agent: "claude_code",
              line_number: 1,
              source_path: "/path/to/session.jsonl",
              score: 10.5,
              title: "Test session",
            },
            {
              agent: "claude_code",
              line_number: 5,
              source_path: "/path/to/session.jsonl",
              score: 8.2,
            },
          ],
          hits_clamped: false,
          limit: 10,
          offset: 0,
          query: "test query",
          request_id: null,
          total_matches: 2,
        }),
        stderr: "",
        exitCode: 0,
      });

      const client = createCassClient({ runner });
      const result = await client.search("test query");

      expect(result.count).toBe(2);
      expect(result.hits.length).toBe(2);
      expect(result.hits[0]!.agent).toBe("claude_code");
      expect(result.hits[0]!.score).toBe(10.5);
      expect(result.query).toBe("test query");
    });

    test("includes search options in command", async () => {
      runner.setResponse("search", {
        stdout: JSON.stringify({
          count: 0,
          cursor: null,
          hits: [],
          limit: 5,
          offset: 10,
          query: "test",
          total_matches: 0,
        }),
        stderr: "",
        exitCode: 0,
      });

      const client = createCassClient({ runner });
      await client.search("test", {
        limit: 5,
        offset: 10,
        agent: "claude_code",
        days: 7,
        mode: "semantic",
      });

      const calls = runner.getCallHistory();
      const args = calls[0]!.args;

      expect(args).toContain("--limit");
      expect(args).toContain("5");
      expect(args).toContain("--offset");
      expect(args).toContain("10");
      expect(args).toContain("--agent");
      expect(args).toContain("claude_code");
      expect(args).toContain("--days");
      expect(args).toContain("7");
      expect(args).toContain("--mode");
      expect(args).toContain("semantic");
    });

    test("throws on command failure", async () => {
      runner.setResponse("search", {
        stdout: "",
        stderr: "Search failed",
        exitCode: 1,
      });

      const client = createCassClient({ runner });

      await expect(client.search("test")).rejects.toThrow(CassClientError);
    });

    test("throws on invalid JSON response", async () => {
      runner.setResponse("search", {
        stdout: "not json",
        stderr: "",
        exitCode: 0,
      });

      const client = createCassClient({ runner });

      try {
        await client.search("test");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(CassClientError);
        expect((error as CassClientError).kind).toBe("parse_error");
      }
    });
  });

  describe("view", () => {
    test("views session at specific line", async () => {
      runner.setResponse("view", {
        stdout: JSON.stringify({
          path: "/path/to/session.jsonl",
          line_number: 42,
          content: "This is the content at line 42",
          context_before: ["line 40", "line 41"],
          context_after: ["line 43", "line 44"],
          role: "assistant",
        }),
        stderr: "",
        exitCode: 0,
      });

      const client = createCassClient({ runner });
      const result = await client.view("/path/to/session.jsonl", { line: 42 });

      expect(result.path).toBe("/path/to/session.jsonl");
      expect(result.line_number).toBe(42);
      expect(result.content).toBe("This is the content at line 42");
      expect(result.role).toBe("assistant");
    });

    test("includes context parameter", async () => {
      runner.setResponse("view", {
        stdout: JSON.stringify({
          path: "/path/to/session.jsonl",
          line_number: 10,
          content: "content",
        }),
        stderr: "",
        exitCode: 0,
      });

      const client = createCassClient({ runner });
      await client.view("/path/to/session.jsonl", { line: 10, context: 10 });

      const calls = runner.getCallHistory();
      const args = calls[0]!.args;

      expect(args).toContain("-C");
      expect(args).toContain("10");
    });
  });

  describe("expand", () => {
    test("expands messages around line", async () => {
      runner.setResponse("expand", {
        stdout: JSON.stringify({
          path: "/path/to/session.jsonl",
          target_line: 50,
          messages: [
            { line_number: 48, role: "user", content: "Question?" },
            { line_number: 50, role: "assistant", content: "Answer!" },
            { line_number: 52, role: "user", content: "Thanks" },
          ],
          total_messages: 3,
        }),
        stderr: "",
        exitCode: 0,
      });

      const client = createCassClient({ runner });
      const result = await client.expand("/path/to/session.jsonl", {
        line: 50,
      });

      expect(result.path).toBe("/path/to/session.jsonl");
      expect(result.target_line).toBe(50);
      expect(result.messages.length).toBe(3);
      expect(result.messages[1]!.role).toBe("assistant");
    });

    test("includes context parameter", async () => {
      runner.setResponse("expand", {
        stdout: JSON.stringify({
          path: "/path/to/session.jsonl",
          target_line: 10,
          messages: [],
        }),
        stderr: "",
        exitCode: 0,
      });

      const client = createCassClient({ runner });
      await client.expand("/path/to/session.jsonl", { line: 10, context: 5 });

      const calls = runner.getCallHistory();
      const args = calls[0]!.args;

      expect(args).toContain("-C");
      expect(args).toContain("5");
    });
  });

  describe("CassClientError", () => {
    test("includes kind and details", () => {
      const error = new CassClientError("command_failed", "Test error", {
        exitCode: 1,
      });

      expect(error.kind).toBe("command_failed");
      expect(error.message).toBe("Test error");
      expect(error.details?.["exitCode"]).toBe(1);
    });

    test("works without details", () => {
      const error = new CassClientError("unavailable", "Not available");

      expect(error.kind).toBe("unavailable");
      expect(error.details).toBeUndefined();
    });
  });
});
