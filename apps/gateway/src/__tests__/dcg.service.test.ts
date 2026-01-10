/**
 * Unit tests for the DCG Service.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
  type DCGBlockEvent,
  disablePack,
  enablePack,
  getBlockEvents,
  getConfig,
  getStats,
  ingestBlockEvent,
  listPacks,
  markFalsePositive,
  updateConfig,
} from "../services/dcg.service";

describe("DCG Service", () => {
  describe("Configuration", () => {
    test("getConfig returns current configuration", () => {
      const config = getConfig();

      expect(config).toBeDefined();
      expect(Array.isArray(config.enabledPacks)).toBe(true);
      expect(Array.isArray(config.disabledPacks)).toBe(true);
      expect(Array.isArray(config.allowlist)).toBe(true);
    });

    test("updateConfig updates enabled packs", async () => {
      const config = await updateConfig({
        enabledPacks: ["core.git", "core.filesystem"],
      });

      expect(config.enabledPacks).toContain("core.git");
      expect(config.enabledPacks).toContain("core.filesystem");
    });

    test("updateConfig rejects unknown packs", async () => {
      await expect(
        updateConfig({
          enabledPacks: ["unknown.pack"],
        }),
      ).rejects.toThrow("Unknown packs");
    });
  });

  describe("Packs", () => {
    test("listPacks returns all known packs", () => {
      const packs = listPacks();

      expect(packs.length).toBeGreaterThan(0);
      expect(packs.some((p) => p.name === "core.git")).toBe(true);
      expect(packs.some((p) => p.name === "core.filesystem")).toBe(true);
    });

    test("each pack has required fields", () => {
      const packs = listPacks();

      for (const pack of packs) {
        expect(pack.name).toBeDefined();
        expect(pack.description).toBeDefined();
        expect(typeof pack.enabled).toBe("boolean");
        expect(typeof pack.patternCount).toBe("number");
      }
    });

    test("enablePack enables a pack", async () => {
      await disablePack("core.git"); // Ensure it's disabled first
      const result = await enablePack("core.git");

      expect(result).toBe(true);

      const packs = listPacks();
      const gitPack = packs.find((p) => p.name === "core.git");
      expect(gitPack?.enabled).toBe(true);
    });

    test("disablePack disables a pack", async () => {
      await enablePack("core.git"); // Ensure it's enabled first
      const result = await disablePack("core.git");

      expect(result).toBe(true);

      const packs = listPacks();
      const gitPack = packs.find((p) => p.name === "core.git");
      expect(gitPack?.enabled).toBe(false);

      // Re-enable for other tests
      await enablePack("core.git");
    });

    test("enablePack returns false for unknown pack", async () => {
      const result = await enablePack("unknown.pack");
      expect(result).toBe(false);
    });

    test("disablePack returns false for unknown pack", async () => {
      const result = await disablePack("unknown.pack");
      expect(result).toBe(false);
    });
  });

  describe("Block Events", () => {
    const testEvent: Omit<DCGBlockEvent, "id"> = {
      timestamp: new Date(),
      agentId: "test-agent-123",
      command: "git push --force origin main",
      pack: "core.git",
      pattern: "git push --force",
      ruleId: "git.force-push",
      severity: "high",
      reason: "Force push to protected branch",
      contextClassification: "executed",
    };

    test("ingestBlockEvent creates event with ID", async () => {
      const event = await ingestBlockEvent(testEvent);

      expect(event.id).toMatch(/^dcg_/);
      expect(event.agentId).toBe(testEvent.agentId);
      expect(event.pack).toBe(testEvent.pack);
      expect(event.severity).toBe(testEvent.severity);
    });

    test("ingestBlockEvent redacts sensitive info", async () => {
      const sensitiveEvent = {
        ...testEvent,
        command:
          "curl -H 'Authorization: Bearer secret123' https://api.example.com",
      };

      const event = await ingestBlockEvent(sensitiveEvent);

      expect(event.command).not.toContain("secret123");
      expect(event.command).toContain("[REDACTED]");
    });

    test("getBlockEvents returns events", async () => {
      // Ingest some events first
      await ingestBlockEvent(testEvent);

      const result = await getBlockEvents({ limit: 10 });

      expect(result.events.length).toBeGreaterThan(0);
      expect(result.pagination).toBeDefined();
    });

    test("getBlockEvents filters by agentId", async () => {
      const uniqueAgent = `test-agent-${Date.now()}`;
      await ingestBlockEvent({ ...testEvent, agentId: uniqueAgent });

      const result = await getBlockEvents({ agentId: uniqueAgent });

      expect(result.events.every((e) => e.agentId === uniqueAgent)).toBe(true);
    });

    test("getBlockEvents filters by severity", async () => {
      await ingestBlockEvent({ ...testEvent, severity: "critical" });
      await ingestBlockEvent({ ...testEvent, severity: "low" });

      const result = await getBlockEvents({ severity: ["critical"] });

      expect(result.events.every((e) => e.severity === "critical")).toBe(true);
    });

    test("getBlockEvents respects limit", async () => {
      // Ingest multiple events
      for (let i = 0; i < 5; i++) {
        await ingestBlockEvent({ ...testEvent, command: `command-${i}` });
      }

      const result = await getBlockEvents({ limit: 3 });

      expect(result.events.length).toBeLessThanOrEqual(3);
    });
  });

  describe("False Positives", () => {
    test("markFalsePositive marks event correctly", async () => {
      const event = await ingestBlockEvent({
        timestamp: new Date(),
        agentId: "test-agent-fp",
        command: "rm -rf node_modules",
        pack: "core.filesystem",
        pattern: "rm -rf",
        ruleId: "fs.rm-rf",
        severity: "medium",
        reason: "Recursive delete",
        contextClassification: "executed",
      });

      const marked = await markFalsePositive(event.id, "test-user");

      expect(marked).not.toBeNull();
      expect(marked?.falsePositive).toBe(true);
    });

    test("markFalsePositive returns null for unknown event", async () => {
      const result = await markFalsePositive("nonexistent-id", "test-user");
      expect(result).toBeNull();
    });
  });

  describe("Statistics", () => {
    test("getStats returns statistics", async () => {
      const stats = await getStats();

      expect(typeof stats.totalBlocks).toBe("number");
      expect(stats.blocksByPack).toBeDefined();
      expect(stats.blocksBySeverity).toBeDefined();
      expect(typeof stats.falsePositiveRate).toBe("number");
      expect(Array.isArray(stats.topBlockedCommands)).toBe(true);
    });

    test("getStats includes all severities", async () => {
      const stats = await getStats();

      expect(stats.blocksBySeverity).toHaveProperty("critical");
      expect(stats.blocksBySeverity).toHaveProperty("high");
      expect(stats.blocksBySeverity).toHaveProperty("medium");
      expect(stats.blocksBySeverity).toHaveProperty("low");
    });
  });
});
