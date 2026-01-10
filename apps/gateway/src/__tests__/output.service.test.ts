/**
 * Unit tests for the Output Streaming Service.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  getOutput,
  pushOutput,
  cleanupOutputBuffer,
  getOutputStats,
  backfillOutput,
} from "../services/output.service";

describe("Output Service", () => {
  const testAgentId = `test-agent-${Date.now()}`;

  beforeEach(() => {
    // Clean up any existing buffer for this agent
    cleanupOutputBuffer(testAgentId);
  });

  describe("pushOutput", () => {
    test("creates output chunk with correct fields", () => {
      const chunk = pushOutput(testAgentId, "text", "Hello, world!");

      expect(chunk.id).toMatch(/^out_/);
      expect(chunk.agentId).toBe(testAgentId);
      expect(chunk.type).toBe("text");
      expect(chunk.content).toBe("Hello, world!");
      expect(chunk.streamType).toBe("stdout");
      expect(chunk.sequence).toBe(1);
      expect(chunk.timestamp).toBeDefined();
    });

    test("increments sequence numbers", () => {
      const chunk1 = pushOutput(testAgentId, "text", "First");
      const chunk2 = pushOutput(testAgentId, "text", "Second");
      const chunk3 = pushOutput(testAgentId, "text", "Third");

      expect(chunk1.sequence).toBe(1);
      expect(chunk2.sequence).toBe(2);
      expect(chunk3.sequence).toBe(3);
    });

    test("sets correct stream type for error output", () => {
      const chunk = pushOutput(testAgentId, "error", "Something failed", "stderr");

      expect(chunk.streamType).toBe("stderr");
    });

    test("handles object content", () => {
      const content = { key: "value", nested: { data: true } };
      const chunk = pushOutput(testAgentId, "tool_result", content);

      expect(chunk.content).toEqual(content);
    });
  });

  describe("getOutput", () => {
    test("returns empty array for agent with no output", () => {
      const result = getOutput("nonexistent-agent");

      expect(result.chunks).toEqual([]);
      expect(result.pagination.hasMore).toBe(false);
    });

    test("returns all chunks when no cursor specified", () => {
      pushOutput(testAgentId, "text", "First");
      pushOutput(testAgentId, "text", "Second");
      pushOutput(testAgentId, "text", "Third");

      const result = getOutput(testAgentId);

      expect(result.chunks.length).toBe(3);
      expect(result.chunks[0]?.content).toBe("First");
      expect(result.chunks[2]?.content).toBe("Third");
    });

    test("respects limit parameter", () => {
      for (let i = 0; i < 10; i++) {
        pushOutput(testAgentId, "text", `Message ${i}`);
      }

      const result = getOutput(testAgentId, { limit: 3 });

      expect(result.chunks.length).toBe(3);
      expect(result.pagination.hasMore).toBe(true);
    });

    test("cursor-based pagination works correctly", () => {
      for (let i = 0; i < 10; i++) {
        pushOutput(testAgentId, "text", `Message ${i}`);
      }

      // Get first page
      const page1 = getOutput(testAgentId, { limit: 3 });
      expect(page1.chunks.length).toBe(3);
      expect(page1.pagination.hasMore).toBe(true);

      // Get second page using cursor
      const page2 = getOutput(testAgentId, {
        cursor: page1.pagination.cursor,
        limit: 3,
      });
      expect(page2.chunks.length).toBe(3);
      expect(page2.chunks[0]?.sequence).toBe(4); // Should start after page1's last

      // Get third page
      const page3 = getOutput(testAgentId, {
        cursor: page2.pagination.cursor,
        limit: 3,
      });
      expect(page3.chunks.length).toBe(3);

      // Get fourth page (only 1 remaining)
      const page4 = getOutput(testAgentId, {
        cursor: page3.pagination.cursor,
        limit: 3,
      });
      expect(page4.chunks.length).toBe(1);
      expect(page4.pagination.hasMore).toBe(false);
    });

    test("filters by type", () => {
      pushOutput(testAgentId, "text", "Text message");
      pushOutput(testAgentId, "error", "Error message");
      pushOutput(testAgentId, "text", "Another text");
      pushOutput(testAgentId, "tool_result", { result: true });

      const result = getOutput(testAgentId, { types: ["text"] });

      expect(result.chunks.length).toBe(2);
      expect(result.chunks.every((c) => c.type === "text")).toBe(true);
    });

    test("filters by stream type", () => {
      pushOutput(testAgentId, "text", "Stdout message", "stdout");
      pushOutput(testAgentId, "error", "Stderr message", "stderr");
      pushOutput(testAgentId, "system", "System message", "system");

      const result = getOutput(testAgentId, { streamType: "stderr" });

      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0]?.streamType).toBe("stderr");
    });
  });

  describe("backfillOutput", () => {
    test("returns chunks after cursor", () => {
      pushOutput(testAgentId, "text", "First");
      pushOutput(testAgentId, "text", "Second");
      pushOutput(testAgentId, "text", "Third");

      const result = backfillOutput(testAgentId, "1", 10);

      expect(result.chunks.length).toBe(2);
      expect(result.chunks[0]?.content).toBe("Second");
      expect(result.cursorExpired).toBe(false);
    });

    test("returns all chunks when cursor is 0", () => {
      pushOutput(testAgentId, "text", "First");
      pushOutput(testAgentId, "text", "Second");

      const result = backfillOutput(testAgentId, "0", 10);

      expect(result.chunks.length).toBe(2);
    });

    test("returns empty for agent with no output", () => {
      const result = backfillOutput("nonexistent", "0", 10);

      expect(result.chunks).toEqual([]);
      expect(result.cursorExpired).toBe(false);
    });
  });

  describe("cleanupOutputBuffer", () => {
    test("removes buffer for agent", () => {
      pushOutput(testAgentId, "text", "Message");

      const beforeCleanup = getOutput(testAgentId);
      expect(beforeCleanup.chunks.length).toBe(1);

      cleanupOutputBuffer(testAgentId);

      const afterCleanup = getOutput(testAgentId);
      expect(afterCleanup.chunks.length).toBe(0);
    });
  });

  describe("getOutputStats", () => {
    test("returns correct statistics", () => {
      const agent1 = `stats-agent-1-${Date.now()}`;
      const agent2 = `stats-agent-2-${Date.now()}`;

      pushOutput(agent1, "text", "Agent 1 message 1");
      pushOutput(agent1, "text", "Agent 1 message 2");
      pushOutput(agent2, "text", "Agent 2 message");

      const stats = getOutputStats();

      expect(stats.bufferedAgents).toBeGreaterThanOrEqual(2);
      expect(stats.totalChunks).toBeGreaterThanOrEqual(3);

      // Cleanup
      cleanupOutputBuffer(agent1);
      cleanupOutputBuffer(agent2);
    });
  });

  describe("ring buffer behavior", () => {
    test("maintains order under rapid inserts", () => {
      const count = 100;
      for (let i = 0; i < count; i++) {
        pushOutput(testAgentId, "text", `Message ${i}`);
      }

      const result = getOutput(testAgentId);

      // Verify order
      for (let i = 0; i < result.chunks.length - 1; i++) {
        const current = result.chunks[i];
        const next = result.chunks[i + 1];
        if (current && next) {
          expect(current.sequence).toBeLessThan(next.sequence);
        }
      }
    });
  });
});
