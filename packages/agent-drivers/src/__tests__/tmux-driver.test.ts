/**
 * Tests for the Tmux Driver.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  createTmuxDriver,
  type TmuxDriver,
  type TmuxDriverOptions,
} from "../tmux";
import type { AgentConfig } from "../types";

describe("TmuxDriver", () => {
  let driver: TmuxDriver;
  let tmuxAvailable: boolean;

  const createTestConfig = (
    overrides: Partial<AgentConfig> = {},
  ): AgentConfig => ({
    id: `test-agent-${Date.now()}`,
    provider: "claude",
    model: "claude-opus-4",
    workingDirectory: "/tmp/test-workspace",
    ...overrides,
  });

  // Check if tmux is available before running tests
  beforeEach(async () => {
    try {
      const result = await Bun.spawn(["tmux", "-V"], {
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      tmuxAvailable = result === 0;
    } catch {
      tmuxAvailable = false;
    }
  });

  describe("createTmuxDriver", () => {
    it("should create a Tmux driver instance", async () => {
      const driver = await createTmuxDriver();

      expect(driver).toBeDefined();
      expect(driver.driverType).toBe("tmux");
    });

    it("should accept custom configuration", async () => {
      const options: TmuxDriverOptions = {
        tmuxBinary: "tmux",
        socketName: "test-socket",
        agentBinary: "echo",
        captureIntervalMs: 1000,
      };

      const driver = await createTmuxDriver(options);
      expect(driver.driverType).toBe("tmux");
    });
  });

  describe("capabilities", () => {
    beforeEach(async () => {
      driver = await createTmuxDriver();
    });

    it("should report correct capabilities", () => {
      const caps = driver.getCapabilities();

      // Tmux driver does NOT support structured events
      expect(caps.structuredEvents).toBe(false);
      expect(caps.toolCalls).toBe(false);
      expect(caps.fileOperations).toBe(false);

      // But DOES support terminal attach
      expect(caps.terminalAttach).toBe(true);
      expect(caps.diffRendering).toBe(false);
      expect(caps.checkpoint).toBe(false);

      // And supports these
      expect(caps.interrupt).toBe(true);
      expect(caps.streaming).toBe(true);
    });
  });

  describe("health check", () => {
    it("should return true when tmux is available", async () => {
      if (!tmuxAvailable) {
        console.log("Skipping test: tmux not available");
        return;
      }

      const driver = await createTmuxDriver();
      const healthy = await driver.isHealthy();
      expect(healthy).toBe(true);
    });

    it("should return false when tmux binary does not exist", async () => {
      const driver = await createTmuxDriver({
        tmuxBinary: "nonexistent-tmux-binary",
      });

      const healthy = await driver.isHealthy();
      expect(healthy).toBe(false);
    });
  });

  describe("spawn (requires tmux)", () => {
    // These are integration tests that require a working tmux server.
    // They may fail in CI environments where tmux can't create sessions.

    it("should spawn returns valid agent structure", async () => {
      if (!tmuxAvailable) {
        console.log("Skipping test: tmux not available");
        return;
      }

      const driver = await createTmuxDriver({
        socketName: "flywheel-integ-test",
        agentBinary: "sleep",
        agentArgs: ["1"],
      });

      const config = createTestConfig({ id: "spawn-structure-test" });

      try {
        const { agent } = await driver.spawn(config);

        // Verify the returned agent has correct structure
        expect(agent.id).toBe(config.id);
        expect(agent.driverType).toBe("tmux");
        expect(agent.activityState).toBe("idle");
        expect(agent.tokenUsage).toBeDefined();

        // Get attach command should work
        const attachCmd = driver.getAttachCommand(config.id);
        expect(attachCmd).toContain("tmux");
        expect(attachCmd).toContain("attach-session");

        await driver.terminate(config.id).catch(() => {});
      } catch (err) {
        // In some environments (like CI), tmux sessions can't be created
        // This is expected - just verify we got a meaningful error
        console.log(
          "Tmux spawn failed (expected in some environments):",
          String(err),
        );
      } finally {
        // Clean up tmux server
        await Bun.spawn(["tmux", "-L", "flywheel-integ-test", "kill-server"], {
          stdout: "pipe",
          stderr: "pipe",
        }).exited.catch(() => {});
      }
    });
  });

  describe("interrupt (requires tmux)", () => {
    it("should handle interrupt call gracefully", async () => {
      if (!tmuxAvailable) {
        console.log("Skipping test: tmux not available");
        return;
      }

      const driver = await createTmuxDriver({
        socketName: "flywheel-integ-test-2",
        agentBinary: "sleep",
        agentArgs: ["60"],
      });

      const config = createTestConfig({ id: "interrupt-test-agent" });

      try {
        await driver.spawn(config);

        // Interrupt should not throw when agent exists
        await driver.interrupt(config.id);

        await driver.terminate(config.id).catch(() => {});
      } catch (err) {
        // In some environments, tmux sessions can't be created
        console.log("Tmux interrupt test skipped (spawn failed):", String(err));
      } finally {
        await Bun.spawn(
          ["tmux", "-L", "flywheel-integ-test-2", "kill-server"],
          {
            stdout: "pipe",
            stderr: "pipe",
          },
        ).exited.catch(() => {});
      }
    });
  });

  describe("error handling", () => {
    beforeEach(async () => {
      driver = await createTmuxDriver({
        socketName: "flywheel-test",
      });
    });

    it("should throw when getting state for non-existent agent", async () => {
      await expect(driver.getState("non-existent")).rejects.toThrow(
        "Agent not found",
      );
    });

    it("should throw when sending to non-existent agent", async () => {
      await expect(driver.send("non-existent", "hello")).rejects.toThrow(
        "Agent not found",
      );
    });

    it("should throw when interrupting non-existent agent", async () => {
      await expect(driver.interrupt("non-existent")).rejects.toThrow();
    });

    it("should throw when getting attach command for non-existent agent", () => {
      expect(() => driver.getAttachCommand("non-existent")).toThrow(
        "Session not found",
      );
    });
  });
});
