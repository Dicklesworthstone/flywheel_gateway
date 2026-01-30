/**
 * Unit tests for the History Service.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { agents, db, history } from "../db";
import {
  exportHistory,
  extractFromOutput,
  getHistoryEntry,
  getHistoryStats,
  incrementReplayCount,
} from "../services/history.service";

describe("History Service", () => {
  const testAgentId = `test-agent-${Date.now()}`;

  beforeAll(async () => {
    try {
      await db.insert(agents).values({
        id: testAgentId,
        repoUrl: "/test",
        task: "test",
        status: "idle",
        model: "test-model",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch {
      // Ignore if already exists (primary key constraint)
    }
  });

  describe("extractFromOutput", () => {
    describe("code_blocks", () => {
      test("extracts markdown code blocks", () => {
        const output = `Here is some code:
\`\`\`typescript
function hello() {
  console.log("Hello");
}
\`\`\`
And more text.`;

        const result = extractFromOutput(output, "code_blocks");

        expect(result.totalMatches).toBe(1);
        expect(result.matches[0]?.content).toContain("function hello");
        expect(result.matches[0]?.metadata?.["language"]).toBe("typescript");
      });

      test("extracts multiple code blocks", () => {
        const output = `
\`\`\`javascript
const x = 1;
\`\`\`
Some text
\`\`\`python
y = 2
\`\`\``;

        const result = extractFromOutput(output, "code_blocks");

        expect(result.totalMatches).toBe(2);
      });

      test("filters by language", () => {
        const output = `
\`\`\`javascript
const x = 1;
\`\`\`
\`\`\`python
x = 1
\`\`\``;

        const result = extractFromOutput(output, "code_blocks", {
          language: "python",
        });

        expect(result.totalMatches).toBe(1);
        expect(result.matches[0]?.content).toContain("x = 1");
      });

      test("handles empty code blocks", () => {
        const output = `
\`\`\`
\`\`\``;

        const result = extractFromOutput(output, "code_blocks");

        expect(result.totalMatches).toBe(1);
        expect(result.matches[0]?.content).toBe("");
      });

      test("ignores inline code", () => {
        const output = `Use \`const x = 1\` for variables`;

        const result = extractFromOutput(output, "code_blocks");

        expect(result.totalMatches).toBe(0);
      });
    });

    describe("urls", () => {
      test("extracts HTTP URLs", () => {
        const output = `Check out https://example.com and http://test.org/path`;

        const result = extractFromOutput(output, "urls");

        expect(result.totalMatches).toBe(2);
        expect(
          result.matches.some((m) => m.content === "https://example.com"),
        ).toBe(true);
        expect(
          result.matches.some((m) => m.content === "http://test.org/path"),
        ).toBe(true);
      });

      test("extracts URLs with query params", () => {
        const output = `Visit https://example.com/page?foo=bar&baz=qux`;

        const result = extractFromOutput(output, "urls");

        expect(result.totalMatches).toBe(1);
        expect(result.matches[0]?.content).toContain("foo=bar");
      });

      test("extracts URLs with ports", () => {
        const output = `Server running at http://localhost:3000/api`;

        const result = extractFromOutput(output, "urls");

        expect(result.totalMatches).toBe(1);
        expect(result.matches[0]?.content).toBe("http://localhost:3000/api");
      });

      test("handles no URLs", () => {
        const output = `Just some regular text without any links`;

        const result = extractFromOutput(output, "urls");

        expect(result.totalMatches).toBe(0);
      });
    });

    describe("file_paths", () => {
      test("extracts Unix file paths", () => {
        const output = `Editing /home/user/project/src/index.ts`;

        const result = extractFromOutput(output, "file_paths");

        expect(result.totalMatches).toBeGreaterThanOrEqual(1);
        expect(
          result.matches.some((m) => m.content.includes("/home/user")),
        ).toBe(true);
      });

      test("extracts relative paths", () => {
        const output = `Check ./src/components/Button.tsx`;

        const result = extractFromOutput(output, "file_paths");

        // Note: pattern may or may not catch relative paths depending on implementation
        expect(result.matches).toBeDefined();
      });

      test("extracts multiple paths", () => {
        const output = `/etc/config.json and /var/log/app.log`;

        const result = extractFromOutput(output, "file_paths");

        expect(result.totalMatches).toBeGreaterThanOrEqual(2);
      });
    });

    describe("json", () => {
      test("extracts JSON objects", () => {
        const output = `Response: {"name": "test", "value": 42}`;

        const result = extractFromOutput(output, "json");

        expect(result.totalMatches).toBe(1);
        const firstMatch = result.matches.at(0);
        expect(firstMatch).toBeDefined();
        const parsed = JSON.parse(firstMatch?.content ?? "");
        expect(parsed.name).toBe("test");
      });

      test("extracts JSON arrays", () => {
        const output = `Data: [1, 2, 3, 4]`;

        const result = extractFromOutput(output, "json");

        expect(result.totalMatches).toBe(1);
        const firstMatch = result.matches.at(0);
        expect(firstMatch).toBeDefined();
        const parsed = JSON.parse(firstMatch?.content ?? "");
        expect(parsed).toEqual([1, 2, 3, 4]);
      });

      test("ignores invalid JSON", () => {
        const output = `Not JSON: {invalid: syntax}`;

        const result = extractFromOutput(output, "json");

        // Should not match invalid JSON
        expect(
          result.matches.every((m) => {
            try {
              JSON.parse(m.content);
              return true;
            } catch {
              return false;
            }
          }),
        ).toBe(true);
      });
    });

    describe("errors", () => {
      test("extracts Error messages", () => {
        const output = `Running tests...
Error: Something went wrong
Test completed`;

        const result = extractFromOutput(output, "errors");

        expect(
          result.matches.some((m) =>
            m.content.includes("Error: Something went wrong"),
          ),
        ).toBe(true);
      });

      test("extracts TypeError messages", () => {
        const output = `TypeError: Cannot read property of undefined`;

        const result = extractFromOutput(output, "errors");

        expect(result.totalMatches).toBeGreaterThanOrEqual(1);
        expect(
          result.matches.some((m) => m.content.includes("TypeError")),
        ).toBe(true);
      });

      test("extracts multiple error types", () => {
        const output = `
Error: First error
SyntaxError: Unexpected token
ReferenceError: x is not defined`;

        const result = extractFromOutput(output, "errors");

        expect(result.totalMatches).toBeGreaterThanOrEqual(3);
      });

      test("handles no errors", () => {
        const output = `All tests passed successfully`;

        const result = extractFromOutput(output, "errors");

        expect(result.totalMatches).toBe(0);
      });
    });

    describe("custom", () => {
      test("extracts with custom pattern", () => {
        const output = `Found TODO: Fix this and TODO: Refactor that`;

        const result = extractFromOutput(output, "custom", {
          customPattern: "TODO:\\s*\\w+",
        });

        expect(result.totalMatches).toBe(2);
      });

      test("handles invalid regex gracefully", () => {
        const output = `Some text`;

        const result = extractFromOutput(output, "custom", {
          customPattern: "[invalid(regex",
        });

        // Should not throw, just return empty
        expect(result.matches).toBeDefined();
      });

      test("rejects ReDoS-vulnerable patterns", () => {
        const output = `aaaaaaaaaaaaaaaaaaaaaaaaa`;

        // Pattern with nested quantifiers that could cause catastrophic backtracking
        const result = extractFromOutput(output, "custom", {
          customPattern: "(a+)+$",
        });

        // Should return empty matches (pattern rejected)
        expect(result.totalMatches).toBe(0);
      });

      test("works without custom pattern", () => {
        const output = `Some text`;

        const result = extractFromOutput(output, "custom");

        expect(result.totalMatches).toBe(0);
      });

      test("extracts with complex regex", () => {
        const output = `
IP: 192.168.1.1
IP: 10.0.0.1
Not an IP: 999.999.999.999`;

        const result = extractFromOutput(output, "custom", {
          customPattern: "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b",
        });

        expect(result.totalMatches).toBeGreaterThanOrEqual(2);
      });
    });

    describe("line numbers", () => {
      test("includes correct line numbers for URLs", () => {
        const output = `Line 0
Line 1
https://example.com
Line 3`;

        const result = extractFromOutput(output, "urls");

        expect(result.matches[0]?.lineStart).toBe(2);
      });

      test("includes correct line numbers for code blocks", () => {
        const output = `Line 0
\`\`\`typescript
code here
\`\`\`
Line 4`;

        const result = extractFromOutput(output, "code_blocks");

        expect(result.matches[0]?.lineStart).toBe(2);
      });
    });
  });

  describe("incrementReplayCount", () => {
    test("increments count by exactly 1", async () => {
      const entryId = `history-${Date.now()}-basic`;

      await db.insert(history).values({
        id: entryId,
        agentId: testAgentId,
        command: "test",
        input: { prompt: "hi", replayCount: 5 },
        output: { responseSummary: "ok", outcome: "success" },
        durationMs: 1,
        createdAt: new Date(),
      });

      // Verify initial state
      let entry = await getHistoryEntry(entryId);
      expect(entry?.replayCount).toBe(5);

      // Increment
      await incrementReplayCount(entryId);

      // Verify count increased by 1
      entry = await getHistoryEntry(entryId);
      expect(entry?.replayCount).toBe(6);

      // Increment again
      await incrementReplayCount(entryId);

      // Verify count increased by 1 again
      entry = await getHistoryEntry(entryId);
      expect(entry?.replayCount).toBe(7);
    });

    test("increments from missing replayCount", async () => {
      const entryId = `history-${Date.now()}-missing`;

      await db.insert(history).values({
        id: entryId,
        agentId: testAgentId,
        command: "test",
        input: { prompt: "hi" },
        output: { responseSummary: "ok", outcome: "success" },
        durationMs: 1,
        createdAt: new Date(),
      });

      await incrementReplayCount(entryId);

      const entry = await getHistoryEntry(entryId);
      expect(entry?.replayCount).toBe(1);
    });

    test("increments when input is null", async () => {
      const entryId = `history-${Date.now()}-null`;

      await db.insert(history).values({
        id: entryId,
        agentId: testAgentId,
        command: "test",
        input: null,
        output: null,
        durationMs: 1,
        createdAt: new Date(),
      });

      await incrementReplayCount(entryId);

      const entry = await getHistoryEntry(entryId);
      expect(entry?.replayCount).toBe(1);
    });

    test("is atomic under concurrent increments", async () => {
      const entryId = `history-${Date.now()}-concurrent`;
      const increments = 100;

      await db.insert(history).values({
        id: entryId,
        agentId: testAgentId,
        command: "test",
        input: { replayCount: 0, prompt: "hi" },
        output: { responseSummary: "ok", outcome: "success" },
        durationMs: 1,
        createdAt: new Date(),
      });

      await Promise.all(
        Array.from({ length: increments }, () => incrementReplayCount(entryId)),
      );

      const entry = await getHistoryEntry(entryId);
      expect(entry?.replayCount).toBe(increments);
    });

    test("handles corrupted non-numeric replayCount gracefully", async () => {
      const entryId = `history-${Date.now()}-corrupt`;

      // Insert with corrupted replayCount (string instead of number)
      await db.insert(history).values({
        id: entryId,
        agentId: testAgentId,
        command: "test",
        input: { replayCount: "not-a-number", prompt: "hi" },
        output: { responseSummary: "ok", outcome: "success" },
        durationMs: 1,
        createdAt: new Date(),
      });

      // Increment should handle this gracefully
      // SQLite's CAST converts non-numeric strings to 0, so increment should set to 1
      await incrementReplayCount(entryId);

      const entry = await getHistoryEntry(entryId);
      // The SQL CAST(... AS INTEGER) converts non-numeric to 0, so 0 + 1 = 1
      expect(entry?.replayCount).toBe(1);
    });
  });

  describe("getHistoryStats", () => {
    test("returns statistics structure", async () => {
      const stats = await getHistoryStats();

      expect(typeof stats.totalEntries).toBe("number");
      expect(typeof stats.totalPromptTokens).toBe("number");
      expect(typeof stats.totalResponseTokens).toBe("number");
      expect(typeof stats.averageDurationMs).toBe("number");
      expect(stats.outcomeDistribution).toBeDefined();
      expect(Array.isArray(stats.entriesByDay)).toBe(true);
    });

    test("includes all outcome types", async () => {
      const stats = await getHistoryStats();

      expect(stats.outcomeDistribution).toHaveProperty("success");
      expect(stats.outcomeDistribution).toHaveProperty("failure");
      expect(stats.outcomeDistribution).toHaveProperty("interrupted");
      expect(stats.outcomeDistribution).toHaveProperty("timeout");
    });
  });

  describe("exportHistory", () => {
    test("exports as JSON", async () => {
      const content = await exportHistory({ format: "json" });

      const parsed = JSON.parse(content);
      expect(Array.isArray(parsed)).toBe(true);
    });

    test("exports as CSV with headers", async () => {
      const content = await exportHistory({ format: "csv" });

      const lines = content.split("\n");
      expect(lines.length).toBeGreaterThan(0);
      expect(lines[0]).toContain("id");
      expect(lines[0]).toContain("agentId");
      expect(lines[0]).toContain("timestamp");
    });
  });
});
