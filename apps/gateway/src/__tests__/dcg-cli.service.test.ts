/**
 * Tests for DCG CLI Service.
 *
 * Tests for the deep DCG CLI integration including explain, test, scan commands.
 */

import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  DCGPackNotFoundError,
  explainCommand,
  getPackInfo,
  getPacksCached,
  invalidatePacksCache,
  listPacks,
  preValidateCommand,
  scanContent,
  scanFile,
  testCommand,
  validateAgentScript,
} from "../services/dcg-cli.service";

// ============================================================================
// Mock Setup
// ============================================================================

// Store original Bun.spawn for restoration
const _originalSpawn = Bun.spawn;

// Helper to create mock spawn result
function createMockSpawn(
  stdout: string,
  exitCode: number = 0,
  stderr: string = "",
) {
  return {
    stdout: new Response(stdout).body,
    stderr: new Response(stderr).body,
    exited: Promise.resolve(exitCode),
    exitCode,
  };
}

// ============================================================================
// Explain Command Tests
// ============================================================================

describe("DCG CLI Service", () => {
  beforeEach(() => {
    // Reset mocks
    invalidatePacksCache();
  });

  describe("explainCommand", () => {
    test("returns explanation for a safe command", async () => {
      const mockResult = {
        command: "ls -la",
        wouldBlock: false,
        matchedRules: [],
        contextClassification: "executed",
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
        createMockSpawn(JSON.stringify(mockResult)) as ReturnType<
          typeof Bun.spawn
        >,
      );

      try {
        const result = await explainCommand("ls -la");

        expect(result.wouldBlock).toBe(false);
        expect(result.matchedRules).toHaveLength(0);
        expect(result.command).toBe("ls -la");
        expect(spawnSpy).toHaveBeenCalledWith(
          ["dcg", "explain", "--json", "ls -la"],
          expect.any(Object),
        );
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("returns explanation for a dangerous command", async () => {
      const mockResult = {
        command: "rm -rf /",
        wouldBlock: true,
        matchedRules: [
          {
            pack: "core.filesystem",
            ruleId: "core.filesystem:rm-rf",
            pattern: "rm -rf",
            severity: "critical",
            reason: "Recursive delete with force can cause data loss",
          },
        ],
        contextClassification: "executed",
        safeAlternatives: ["rm -ri /path"],
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
        createMockSpawn(JSON.stringify(mockResult)) as ReturnType<
          typeof Bun.spawn
        >,
      );

      try {
        const result = await explainCommand("rm -rf /");

        expect(result.wouldBlock).toBe(true);
        expect(result.matchedRules).toHaveLength(1);
        expect(result.matchedRules[0]?.severity).toBe("critical");
        expect(result.safeAlternatives).toBeDefined();
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("handles DCG not available gracefully", async () => {
      const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
        throw new Error("spawn failed");
      });

      try {
        const result = await explainCommand("ls");

        // Should return safe default when DCG not available
        expect(result.wouldBlock).toBe(false);
        expect(result.matchedRules).toHaveLength(0);
      } finally {
        spawnSpy.mockRestore();
      }
    });
  });

  // ============================================================================
  // Test Command Tests
  // ============================================================================

  describe("testCommand", () => {
    test("returns blocked=false for safe commands", async () => {
      const mockResult = {
        command: "echo hello",
        blocked: false,
        allowlisted: false,
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
        createMockSpawn(JSON.stringify(mockResult), 0) as ReturnType<
          typeof Bun.spawn
        >,
      );

      try {
        const result = await testCommand("echo hello");

        expect(result.blocked).toBe(false);
        expect(result.matchedRule).toBeUndefined();
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("returns blocked=true for dangerous commands", async () => {
      const mockResult = {
        command: "chmod 777 /etc/passwd",
        blocked: true,
        matchedRule: {
          pack: "core.filesystem",
          ruleId: "core.filesystem:chmod-777",
          reason: "World-writable permissions are dangerous",
          severity: "high",
        },
        allowlisted: false,
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
        createMockSpawn(JSON.stringify(mockResult), 1) as ReturnType<
          typeof Bun.spawn
        >,
      );

      try {
        const result = await testCommand("chmod 777 /etc/passwd");

        expect(result.blocked).toBe(true);
        expect(result.matchedRule).toBeDefined();
        expect(result.matchedRule?.severity).toBe("high");
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("respects allowlist", async () => {
      const mockResult = {
        command: "special-command",
        blocked: false,
        allowlisted: true,
        allowlistReason: "Testing allowlist",
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
        createMockSpawn(JSON.stringify(mockResult), 0) as ReturnType<
          typeof Bun.spawn
        >,
      );

      try {
        const result = await testCommand("special-command");

        expect(result.allowlisted).toBe(true);
        expect(result.allowlistReason).toBe("Testing allowlist");
      } finally {
        spawnSpy.mockRestore();
      }
    });
  });

  // ============================================================================
  // Scan Tests
  // ============================================================================

  describe("scanFile", () => {
    test("returns findings for file with dangerous commands", async () => {
      const mockResult = {
        file: "/tmp/test.sh",
        lineCount: 5,
        findings: [
          {
            line: 3,
            column: 1,
            command: "rm -rf /tmp/*",
            ruleId: "core.filesystem:rm-rf",
            severity: "medium",
            reason: "Recursive delete can cause data loss",
          },
        ],
        summary: { critical: 0, high: 0, medium: 1, low: 0, total: 1 },
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
        createMockSpawn(JSON.stringify(mockResult), 0) as ReturnType<
          typeof Bun.spawn
        >,
      );

      try {
        const result = await scanFile("/tmp/test.sh");

        expect(result.findings).toHaveLength(1);
        expect(result.findings[0]?.line).toBe(3);
        expect(result.summary.medium).toBe(1);
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("returns empty findings for safe files", async () => {
      const mockResult = {
        file: "/tmp/safe.sh",
        lineCount: 3,
        findings: [],
        summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
        createMockSpawn(JSON.stringify(mockResult), 0) as ReturnType<
          typeof Bun.spawn
        >,
      );

      try {
        const result = await scanFile("/tmp/safe.sh");

        expect(result.findings).toHaveLength(0);
        expect(result.summary.total).toBe(0);
      } finally {
        spawnSpy.mockRestore();
      }
    });
  });

  describe("scanContent", () => {
    test("scans inline content and returns findings", async () => {
      const mockResult = {
        file: "<inline>",
        lineCount: 2,
        findings: [
          {
            line: 2,
            column: 1,
            command: "rm -rf /",
            ruleId: "core.filesystem:rm-rf",
            severity: "critical",
            reason: "Recursive delete is dangerous",
          },
        ],
        summary: { critical: 1, high: 0, medium: 0, low: 0, total: 1 },
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
        createMockSpawn(JSON.stringify(mockResult), 0) as ReturnType<
          typeof Bun.spawn
        >,
      );

      try {
        const result = await scanContent("#!/bin/bash\nrm -rf /", "test.sh");

        expect(result.findings).toHaveLength(1);
        expect(result.file).toBe("test.sh");
        expect(result.summary.critical).toBe(1);
      } finally {
        spawnSpy.mockRestore();
      }
    });
  });

  // ============================================================================
  // Pack Management Tests
  // ============================================================================

  describe("listPacks", () => {
    test("returns list of available packs", async () => {
      const mockPacks = [
        {
          id: "core.git",
          name: "Git",
          description: "Git operations",
          ruleCount: 5,
          enabled: true,
          rules: [],
        },
        {
          id: "core.filesystem",
          name: "Filesystem",
          description: "FS operations",
          ruleCount: 10,
          enabled: true,
          rules: [],
        },
      ];

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
        createMockSpawn(JSON.stringify(mockPacks), 0) as ReturnType<
          typeof Bun.spawn
        >,
      );

      try {
        const packs = await listPacks();

        expect(packs).toHaveLength(2);
        expect(packs[0]?.id).toBe("core.git");
        expect(packs[1]?.ruleCount).toBe(10);
      } finally {
        spawnSpy.mockRestore();
      }
    });
  });

  describe("getPackInfo", () => {
    test("returns detailed pack information", async () => {
      const mockPack = {
        id: "core.git",
        name: "Git",
        description: "Git operations",
        ruleCount: 3,
        enabled: true,
        rules: [
          {
            id: "git:force-push",
            pattern: "git push --force",
            severity: "critical",
            description: "Force push",
          },
          {
            id: "git:hard-reset",
            pattern: "git reset --hard",
            severity: "high",
            description: "Hard reset",
          },
        ],
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
        createMockSpawn(JSON.stringify(mockPack), 0) as ReturnType<
          typeof Bun.spawn
        >,
      );

      try {
        const pack = await getPackInfo("core.git");

        expect(pack.id).toBe("core.git");
        expect(pack.rules).toHaveLength(2);
        expect(pack.rules[0]?.severity).toBe("critical");
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("throws DCGPackNotFoundError for unknown pack", async () => {
      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
        createMockSpawn("", 1, "pack not found") as ReturnType<
          typeof Bun.spawn
        >,
      );

      try {
        await expect(getPackInfo("nonexistent.pack")).rejects.toThrow(
          DCGPackNotFoundError,
        );
      } finally {
        spawnSpy.mockRestore();
      }
    });
  });

  describe("getPacksCached", () => {
    test("caches pack list", async () => {
      const mockPacks = [
        {
          id: "core.git",
          name: "Git",
          description: "Git",
          ruleCount: 5,
          enabled: true,
          rules: [],
        },
      ];

      let callCount = 0;
      const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
        callCount++;
        return createMockSpawn(JSON.stringify(mockPacks), 0) as ReturnType<
          typeof Bun.spawn
        >;
      });

      try {
        // First call should spawn
        await getPacksCached();
        expect(callCount).toBe(1);

        // Second call should use cache
        await getPacksCached();
        expect(callCount).toBe(1);

        // After invalidation, should spawn again
        invalidatePacksCache();
        await getPacksCached();
        expect(callCount).toBe(2);
      } finally {
        spawnSpy.mockRestore();
      }
    });
  });

  // ============================================================================
  // Agent Integration Tests
  // ============================================================================

  describe("preValidateCommand", () => {
    test("allows safe commands", async () => {
      const mockResult = {
        command: "ls -la",
        blocked: false,
        allowlisted: false,
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
        createMockSpawn(JSON.stringify(mockResult), 0) as ReturnType<
          typeof Bun.spawn
        >,
      );

      try {
        const result = await preValidateCommand("agent-123", "ls -la");

        expect(result.allowed).toBe(true);
        expect(result.warning).toBeUndefined();
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("blocks dangerous commands", async () => {
      const mockResult = {
        command: "rm -rf /",
        blocked: true,
        matchedRule: {
          pack: "core.filesystem",
          ruleId: "core.filesystem:rm-rf",
          reason: "Dangerous command",
          severity: "critical",
        },
        allowlisted: false,
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
        createMockSpawn(JSON.stringify(mockResult), 1) as ReturnType<
          typeof Bun.spawn
        >,
      );

      try {
        const result = await preValidateCommand("agent-123", "rm -rf /");

        expect(result.allowed).toBe(false);
        expect(result.warning).toContain("blocked by DCG");
        expect(result.matchedRule).toBeDefined();
      } finally {
        spawnSpy.mockRestore();
      }
    });
  });

  describe("validateAgentScript", () => {
    test("marks script as safe when no critical/high findings", async () => {
      const mockResult = {
        file: "<inline>",
        lineCount: 3,
        findings: [
          {
            line: 2,
            column: 1,
            command: "rm /tmp/cache",
            ruleId: "fs:rm",
            severity: "low",
            reason: "Delete",
          },
        ],
        summary: { critical: 0, high: 0, medium: 0, low: 1, total: 1 },
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
        createMockSpawn(JSON.stringify(mockResult), 0) as ReturnType<
          typeof Bun.spawn
        >,
      );

      try {
        const result = await validateAgentScript(
          "agent-123",
          "#!/bin/bash\nrm /tmp/cache",
          "cleanup.sh",
        );

        expect(result.safe).toBe(true);
        expect(result.findings).toHaveLength(1);
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("marks script as unsafe when critical/high findings present", async () => {
      const mockResult = {
        file: "<inline>",
        lineCount: 2,
        findings: [
          {
            line: 2,
            column: 1,
            command: "rm -rf /",
            ruleId: "fs:rm-rf",
            severity: "critical",
            reason: "Dangerous",
          },
        ],
        summary: { critical: 1, high: 0, medium: 0, low: 0, total: 1 },
      };

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
        createMockSpawn(JSON.stringify(mockResult), 0) as ReturnType<
          typeof Bun.spawn
        >,
      );

      try {
        const result = await validateAgentScript(
          "agent-123",
          "#!/bin/bash\nrm -rf /",
          "bad.sh",
        );

        expect(result.safe).toBe(false);
        expect(result.summary.critical).toBe(1);
      } finally {
        spawnSpy.mockRestore();
      }
    });
  });
});
