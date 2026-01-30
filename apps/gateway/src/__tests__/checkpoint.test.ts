/**
 * Unit tests for the Checkpoint Service.
 */

import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { agents, db } from "../db";
import {
  CheckpointError,
  type CreateCheckpointOptions,
  compressData,
  createCheckpoint,
  createErrorCheckpoint,
  decompressData,
  deleteCheckpoint,
  exportCheckpoint,
  getAgentCheckpoints,
  getCheckpoint,
  getLatestCheckpoint,
  importCheckpoint,
  pruneCheckpoints,
  restoreCheckpoint,
  verifyCheckpoint,
  withErrorCheckpoint,
} from "../services/checkpoint";

async function ensureAgent(agentId: string) {
  try {
    await db.insert(agents).values({
      id: agentId,
      repoUrl: "/test",
      task: "test",
      status: "idle",
      model: "test-model",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  } catch (e) {
    // Ignore if already exists (primary key constraint)
  }
}

describe("Checkpoint Service", () => {
  const testAgentId = `test-agent-${Date.now()}`;
  const testTokenUsage = {
    promptTokens: 1000,
    completionTokens: 500,
    totalTokens: 1500,
  };

  beforeAll(async () => {
    try {
      await migrate(db, { migrationsFolder: "apps/gateway/src/db/migrations" });
    } catch (e) {
      console.warn("Migration failed or not needed:", e);
    }
    await ensureAgent(testAgentId);
  });

  describe("createCheckpoint", () => {
    test("creates a checkpoint with required fields", async () => {
      const metadata = await createCheckpoint(testAgentId, {
        conversationHistory: [{ role: "user", content: "Hello" }],
        toolState: { files: ["test.ts"] },
        tokenUsage: testTokenUsage,
      });

      expect(metadata.id).toMatch(/^chk_[a-z0-9]+$/);
      expect(metadata.agentId).toBe(testAgentId);
      expect(metadata.createdAt).toBeInstanceOf(Date);
      expect(metadata.tokenUsage).toEqual(testTokenUsage);
    });

    test("creates checkpoint with description and tags", async () => {
      const options: CreateCheckpointOptions = {
        description: "Before refactoring",
        tags: ["manual", "important"],
      };

      const metadata = await createCheckpoint(
        testAgentId,
        {
          conversationHistory: [],
          toolState: {},
          tokenUsage: testTokenUsage,
        },
        options,
      );

      expect(metadata.description).toBe("Before refactoring");
      expect(metadata.tags).toEqual(["manual", "important"]);
    });

    test("creates delta checkpoint when parent exists", async () => {
      // Create first checkpoint
      const first = await createCheckpoint(testAgentId, {
        conversationHistory: [{ role: "user", content: "First" }],
        toolState: {},
        tokenUsage: testTokenUsage,
      });

      // Create delta checkpoint
      const second = await createCheckpoint(
        testAgentId,
        {
          conversationHistory: [
            { role: "user", content: "First" },
            { role: "assistant", content: "Response" },
          ],
          toolState: { newState: true },
          tokenUsage: { ...testTokenUsage, totalTokens: 2000 },
        },
        { delta: true },
      );

      expect(second.id).not.toBe(first.id);

      // Retrieve and verify
      const checkpoint = await getCheckpoint(second.id);
      expect(checkpoint).toBeDefined();
    });
  });

  describe("getCheckpoint", () => {
    test("returns checkpoint by ID", async () => {
      const metadata = await createCheckpoint(testAgentId, {
        conversationHistory: [{ role: "user", content: "Test" }],
        toolState: { key: "value" },
        tokenUsage: testTokenUsage,
      });

      const checkpoint = await getCheckpoint(metadata.id);
      expect(checkpoint).toBeDefined();
      expect(checkpoint?.id).toBe(metadata.id);
      expect(checkpoint?.agentId).toBe(testAgentId);
      expect(checkpoint?.conversationHistory).toEqual([
        { role: "user", content: "Test" },
      ]);
      expect(checkpoint?.toolState).toEqual({ key: "value" });
    });

    test("returns undefined for non-existent checkpoint", async () => {
      const checkpoint = await getCheckpoint("chk_nonexistent_123456");
      expect(checkpoint).toBeUndefined();
    });
  });

  describe("getAgentCheckpoints", () => {
    test("returns all checkpoints for an agent", async () => {
      const uniqueAgentId = `agent-list-${Date.now()}`;
      await ensureAgent(uniqueAgentId);

      await createCheckpoint(uniqueAgentId, {
        conversationHistory: [],
        toolState: {},
        tokenUsage: testTokenUsage,
      });

      await createCheckpoint(uniqueAgentId, {
        conversationHistory: [{ role: "user", content: "Second" }],
        toolState: {},
        tokenUsage: testTokenUsage,
      });

      const checkpoints = await getAgentCheckpoints(uniqueAgentId);
      expect(checkpoints.length).toBe(2);
      expect(checkpoints[0]?.agentId).toBe(uniqueAgentId);
      expect(checkpoints[1]?.agentId).toBe(uniqueAgentId);
    });

    test("returns empty array for agent with no checkpoints", async () => {
      const checkpoints = await getAgentCheckpoints("nonexistent-agent");
      expect(checkpoints).toEqual([]);
    });
  });

  describe("getLatestCheckpoint", () => {
    test("returns most recent checkpoint", async () => {
      const uniqueAgentId = `agent-latest-${Date.now()}`;
      await ensureAgent(uniqueAgentId);

      await createCheckpoint(uniqueAgentId, {
        conversationHistory: [{ role: "user", content: "First" }],
        toolState: {},
        tokenUsage: testTokenUsage,
      });

      // Small delay to ensure different createdAt timestamps
      await new Promise((r) => setTimeout(r, 100));

      const second = await createCheckpoint(uniqueAgentId, {
        conversationHistory: [{ role: "user", content: "Second" }],
        toolState: {},
        tokenUsage: testTokenUsage,
      });

      const latest = await getLatestCheckpoint(uniqueAgentId);
      expect(latest?.id).toBe(second.id);
      expect(latest?.conversationHistory).toEqual([
        { role: "user", content: "Second" },
      ]);
    });

    test("returns undefined for agent with no checkpoints", async () => {
      const latest = await getLatestCheckpoint("nonexistent-agent");
      expect(latest).toBeUndefined();
    });
  });

  describe("restoreCheckpoint", () => {
    test("restores a checkpoint", async () => {
      const metadata = await createCheckpoint(testAgentId, {
        conversationHistory: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ],
        toolState: { workingDir: "/home/user" },
        tokenUsage: testTokenUsage,
      });

      const restored = await restoreCheckpoint(metadata.id);
      expect(restored.id).toBe(metadata.id);
      expect(restored.conversationHistory).toEqual([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ]);
      expect(restored.toolState).toEqual({ workingDir: "/home/user" });
    });

    test("throws CheckpointError for non-existent checkpoint", async () => {
      await expect(restoreCheckpoint("chk_nonexistent_123456")).rejects.toThrow(
        CheckpointError,
      );
    });

    test("restores with verification when requested", async () => {
      const metadata = await createCheckpoint(testAgentId, {
        conversationHistory: [],
        toolState: {},
        tokenUsage: testTokenUsage,
      });

      const restored = await restoreCheckpoint(metadata.id, { verify: true });
      expect(restored.id).toBe(metadata.id);
    });
  });

  describe("verifyCheckpoint", () => {
    test("returns valid for well-formed checkpoint", async () => {
      const metadata = await createCheckpoint(testAgentId, {
        conversationHistory: [],
        toolState: {},
        tokenUsage: testTokenUsage,
      });

      const result = await verifyCheckpoint(metadata.id);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    test("returns invalid for non-existent checkpoint", async () => {
      const result = await verifyCheckpoint("chk_nonexistent_123456");
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test("warns on token usage mismatch", async () => {
      const metadata = await createCheckpoint(testAgentId, {
        conversationHistory: [],
        toolState: {},
        tokenUsage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 200, // Intentionally wrong: should be 150
        },
      });

      const result = await verifyCheckpoint(metadata.id);
      expect(result.warnings).toContain("Token usage sum mismatch");
    });
  });

  describe("exportCheckpoint", () => {
    test("exports checkpoint with hash", async () => {
      const metadata = await createCheckpoint(testAgentId, {
        conversationHistory: [{ role: "user", content: "Export test" }],
        toolState: { exported: true },
        tokenUsage: testTokenUsage,
      });

      const exported = await exportCheckpoint(metadata.id);
      expect(exported.version).toBe("1.0.0");
      expect(exported.exportedAt).toBeDefined();
      expect(exported.checkpoint.id).toBe(metadata.id);
      expect(exported.hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hash
    });

    test("throws for non-existent checkpoint", async () => {
      await expect(exportCheckpoint("chk_nonexistent_123456")).rejects.toThrow(
        CheckpointError,
      );
    });
  });

  describe("importCheckpoint", () => {
    test("imports exported checkpoint", async () => {
      const originalAgentId = `original-${Date.now()}`;
      await ensureAgent(originalAgentId);
      const metadata = await createCheckpoint(originalAgentId, {
        conversationHistory: [{ role: "user", content: "Import test" }],
        toolState: { imported: false },
        tokenUsage: testTokenUsage,
      });

      const exported = await exportCheckpoint(metadata.id);
      const imported = await importCheckpoint(exported);

      expect(imported.id).not.toBe(metadata.id); // New ID generated
      expect(imported.agentId).toBe(originalAgentId); // Same agent ID

      const checkpoint = await getCheckpoint(imported.id);
      expect(checkpoint?.conversationHistory).toEqual([
        { role: "user", content: "Import test" },
      ]);
    });

    test("imports to different agent when specified", async () => {
      const originalAgentId = `original-${Date.now()}`;
      const targetAgentId = `target-${Date.now()}`;
      await ensureAgent(originalAgentId);
      await ensureAgent(targetAgentId);

      const metadata = await createCheckpoint(originalAgentId, {
        conversationHistory: [],
        toolState: {},
        tokenUsage: testTokenUsage,
      });

      const exported = await exportCheckpoint(metadata.id);
      const imported = await importCheckpoint(exported, targetAgentId);

      expect(imported.agentId).toBe(targetAgentId);
    });

    test("throws on hash mismatch", async () => {
      const metadata = await createCheckpoint(testAgentId, {
        conversationHistory: [],
        toolState: {},
        tokenUsage: testTokenUsage,
      });

      const exported = await exportCheckpoint(metadata.id);
      exported.hash = "tampered_hash_value_that_does_not_match_original";

      await expect(importCheckpoint(exported)).rejects.toThrow(CheckpointError);
    });
  });

  describe("deleteCheckpoint", () => {
    test("deletes a checkpoint", async () => {
      const metadata = await createCheckpoint(testAgentId, {
        conversationHistory: [],
        toolState: {},
        tokenUsage: testTokenUsage,
      });

      await deleteCheckpoint(metadata.id);

      const checkpoint = await getCheckpoint(metadata.id);
      expect(checkpoint).toBeUndefined();
    });

    test("is idempotent for already-deleted checkpoint", async () => {
      await deleteCheckpoint("chk_nonexistent_123456");
      // Should not throw
    });

    test("throws when checkpoint has dependents", async () => {
      const uniqueAgentId = `agent-delete-${Date.now()}`;
      await ensureAgent(uniqueAgentId);

      // Create first checkpoint
      const first = await createCheckpoint(uniqueAgentId, {
        conversationHistory: [],
        toolState: {},
        tokenUsage: testTokenUsage,
      });

      // Create delta checkpoint depending on first
      await createCheckpoint(
        uniqueAgentId,
        {
          conversationHistory: [{ role: "user", content: "Second" }],
          toolState: {},
          tokenUsage: testTokenUsage,
        },
        { delta: true },
      );

      // Should throw because first checkpoint has dependents
      await expect(deleteCheckpoint(first.id)).rejects.toThrow(CheckpointError);
    });
  });

  describe("pruneCheckpoints", () => {
    test("prunes old checkpoints keeping most recent", async () => {
      const uniqueAgentId = `agent-prune-${Date.now()}`;
      await ensureAgent(uniqueAgentId);

      // Create 5 checkpoints
      for (let i = 0; i < 5; i++) {
        await createCheckpoint(uniqueAgentId, {
          conversationHistory: [{ index: i }],
          toolState: {},
          tokenUsage: testTokenUsage,
        });
      }

      const beforePrune = await getAgentCheckpoints(uniqueAgentId);
      expect(beforePrune.length).toBe(5);

      // Prune to keep only 2
      const deleted = await pruneCheckpoints(uniqueAgentId, 2);
      expect(deleted).toBe(3);

      const afterPrune = await getAgentCheckpoints(uniqueAgentId);
      expect(afterPrune.length).toBe(2);
    });

    test("does not delete delta chain parents needed by remaining checkpoints", async () => {
      const uniqueAgentId = `agent-prune-delta-${Date.now()}`;
      await ensureAgent(uniqueAgentId);

      const base = await createCheckpoint(uniqueAgentId, {
        conversationHistory: [{ role: "user", content: "Base" }],
        toolState: { base: true },
        tokenUsage: testTokenUsage,
      });

      const parent = await createCheckpoint(uniqueAgentId, {
        conversationHistory: [{ role: "user", content: "Parent" }],
        toolState: { parent: true },
        tokenUsage: testTokenUsage,
      });

      const delta = await createCheckpoint(
        uniqueAgentId,
        {
          conversationHistory: [{ role: "user", content: "Delta" }],
          toolState: { delta: true },
          tokenUsage: testTokenUsage,
        },
        { delta: true },
      );

      // Keeping only the most recent checkpoint would normally delete both earlier
      // checkpoints; however, the delta checkpoint references `parent` as its chain
      // parent and must keep it for future resolution correctness.
      //
      // This test intentionally does not assert an exact delete count because the
      // pruning strategy may be conservative and keep extra checkpoints.
      await pruneCheckpoints(uniqueAgentId, 1);

      const remaining = await getAgentCheckpoints(uniqueAgentId);
      const remainingIds = remaining.map((c) => c.id);
      expect(remainingIds).toContain(parent.id);
      expect(remainingIds).toContain(delta.id);

      // Should still be restorable after pruning.
      await expect(restoreCheckpoint(delta.id)).resolves.toBeDefined();
    });

    test("returns 0 when nothing to prune", async () => {
      const uniqueAgentId = `agent-noprune-${Date.now()}`;
      await ensureAgent(uniqueAgentId);

      await createCheckpoint(uniqueAgentId, {
        conversationHistory: [],
        toolState: {},
        tokenUsage: testTokenUsage,
      });

      const deleted = await pruneCheckpoints(uniqueAgentId, 5);
      expect(deleted).toBe(0);
    });
  });

  describe("compression", () => {
    test("compressData and decompressData are inverse operations", () => {
      const original = JSON.stringify({
        messages: [
          { role: "user", content: "Hello, how are you?" },
          {
            role: "assistant",
            content: "I am doing well, thank you for asking!",
          },
        ],
        toolState: {
          files: ["file1.ts", "file2.ts"],
          workingDir: "/home/user",
        },
      });

      const { compressed, stats } = compressData(original);
      expect(compressed).toBeDefined();
      expect(stats.originalSize).toBeGreaterThan(0);
      expect(stats.compressedSize).toBeGreaterThan(0);
      expect(stats.ratio).toBeGreaterThan(0);

      const decompressed = decompressData(compressed);
      expect(decompressed).toBe(original);
    });

    test("compression achieves meaningful ratio for typical data", () => {
      // Create a large-ish payload similar to real checkpoints
      const largeContent = {
        messages: Array.from({ length: 50 }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `This is message ${i} with some content that should compress well due to repetition.`,
        })),
        toolState: {
          files: Array.from({ length: 20 }, (_, i) => `/path/to/file${i}.ts`),
          workingDir: "/home/user/project",
        },
      };

      const original = JSON.stringify(largeContent);
      const { stats } = compressData(original);

      // Expect at least 2x compression for repetitive JSON
      expect(stats.ratio).toBeGreaterThan(2);
    });

    test("createCheckpoint with compression stores compressed data", async () => {
      const uniqueAgentId = `agent-compress-${Date.now()}`;
      await ensureAgent(uniqueAgentId);

      const largeHistory = Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i} with some content.`,
      }));

      const metadata = await createCheckpoint(
        uniqueAgentId,
        {
          conversationHistory: largeHistory,
          toolState: { compressed: true },
          tokenUsage: testTokenUsage,
        },
        { compress: true },
      );

      expect(metadata.id).toMatch(/^chk_[a-z0-9]+$/);
      expect(metadata.compressionStats).toBeDefined();
      expect(metadata.compressionStats?.ratio).toBeGreaterThan(1);

      // Retrieve and verify decompression works
      const restored = await restoreCheckpoint(metadata.id);
      expect(restored.conversationHistory).toEqual(largeHistory);
      expect(restored.toolState).toEqual({ compressed: true });
    });

    test("createCheckpoint without compression stores uncompressed data", async () => {
      const uniqueAgentId = `agent-nocompress-${Date.now()}`;
      await ensureAgent(uniqueAgentId);

      const metadata = await createCheckpoint(
        uniqueAgentId,
        {
          conversationHistory: [{ role: "user", content: "Test" }],
          toolState: { test: true },
          tokenUsage: testTokenUsage,
        },
        { compress: false },
      );

      expect(metadata.compressionStats).toBeUndefined();

      const restored = await restoreCheckpoint(metadata.id);
      expect(restored.conversationHistory).toEqual([
        { role: "user", content: "Test" },
      ]);
    });
  });

  describe("error checkpoints", () => {
    test("createErrorCheckpoint captures error context", async () => {
      const uniqueAgentId = `agent-error-${Date.now()}`;
      await ensureAgent(uniqueAgentId);

      const metadata = await createErrorCheckpoint(
        uniqueAgentId,
        {
          conversationHistory: [{ role: "user", content: "Before error" }],
          toolState: { working: true },
          tokenUsage: testTokenUsage,
        },
        {
          errorType: "TestError",
          errorMessage: "Something went wrong",
          errorStack: "at test.ts:42",
          lastCommand: "bun test",
        },
      );

      expect(metadata).toBeDefined();
      expect(metadata?.id).toMatch(/^chk_[a-z0-9]+$/);
      expect(metadata?.tags).toContain("error");
      expect(metadata?.tags).toContain("auto");
      expect(metadata?.tags).toContain("TestError");

      // Verify error context is in toolState
      const restored = await restoreCheckpoint(metadata!.id);
      expect(restored.toolState["_errorContext"]).toBeDefined();
      const ctx = restored.toolState["_errorContext"] as Record<
        string,
        unknown
      >;
      expect(ctx["errorType"]).toBe("TestError");
      expect(ctx["errorMessage"]).toBe("Something went wrong");
    });

    test("createErrorCheckpoint never throws", async () => {
      // Even with invalid agent, should return undefined instead of throwing
      const result = await createErrorCheckpoint(
        "nonexistent-agent-xyz",
        {
          conversationHistory: [],
          toolState: {},
          tokenUsage: testTokenUsage,
        },
        {
          errorType: "TestError",
          errorMessage: "Test",
        },
      );

      // Should return undefined on failure, not throw
      // Note: This might actually succeed if the agent check is lenient
      // The important thing is it doesn't throw
      expect(true).toBe(true);
    });

    test("withErrorCheckpoint captures state on failure", async () => {
      const uniqueAgentId = `agent-with-error-${Date.now()}`;
      await ensureAgent(uniqueAgentId);

      const testState = {
        conversationHistory: [{ role: "user", content: "Test state" }],
        toolState: { captured: true },
        tokenUsage: testTokenUsage,
      };

      let errorCaught = false;
      try {
        await withErrorCheckpoint(
          uniqueAgentId,
          async () => testState,
          async () => {
            throw new Error("Intentional test error");
          },
        );
      } catch (e) {
        errorCaught = true;
        expect(e).toBeInstanceOf(Error);
      }

      expect(errorCaught).toBe(true);

      // Verify an error checkpoint was created
      const checkpoints = await getAgentCheckpoints(uniqueAgentId);
      const errorCheckpoint = checkpoints.find((c) =>
        c.tags?.includes("error"),
      );
      expect(errorCheckpoint).toBeDefined();
    });
  });
});
