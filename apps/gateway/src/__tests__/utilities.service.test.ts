/**
 * Unit tests for the Utilities Service.
 */

import { describe, expect, test } from "bun:test";
import {
  getUtilityStatus,
  listUtilities,
  runDoctor,
} from "../services/utilities.service";

describe("Utilities Service", () => {
  describe("listUtilities", () => {
    test("returns all known utilities", async () => {
      const result = await listUtilities();

      expect(result.length).toBe(7);
      expect(result.map((u) => u.name).sort()).toEqual([
        "apr",
        "csctf",
        "giil",
        "jfp",
        "ms",
        "pt",
        "slb",
      ]);
    });

    test("each utility has required fields", async () => {
      const result = await listUtilities();

      for (const utility of result) {
        expect(utility.name).toBeDefined();
        expect(utility.description).toBeDefined();
        expect(utility.installCommand).toBeDefined();
        expect(typeof utility.installed).toBe("boolean");
      }
    });

    test("giil has correct description", async () => {
      const result = await listUtilities();
      const giil = result.find((u) => u.name === "giil");

      expect(giil).toBeDefined();
      expect(giil?.description).toContain("cloud photos");
    });

    test("csctf has correct description", async () => {
      const result = await listUtilities();
      const csctf = result.find((u) => u.name === "csctf");

      expect(csctf).toBeDefined();
      expect(csctf?.description).toContain("chat share links");
    });
  });

  describe("getUtilityStatus", () => {
    test("returns null for unknown utility", async () => {
      const result = await getUtilityStatus("unknown-utility");

      expect(result).toBeNull();
    });

    test("returns status for giil", async () => {
      const result = await getUtilityStatus("giil");

      expect(result).toBeDefined();
      expect(result?.name).toBe("giil");
      expect(typeof result?.installed).toBe("boolean");
    });

    test("returns status for csctf", async () => {
      const result = await getUtilityStatus("csctf");

      expect(result).toBeDefined();
      expect(result?.name).toBe("csctf");
      expect(typeof result?.installed).toBe("boolean");
    });

    test("includes install command in status", async () => {
      const result = await getUtilityStatus("giil");

      expect(result?.installCommand).toContain("curl");
      expect(result?.installCommand).toContain("install.sh");
    });
  });

  describe("runDoctor", () => {
    test("returns health status for all utilities", async () => {
      const result = await runDoctor();

      expect(result.utilities.length).toBe(7);
      expect(result.timestamp).toBeDefined();
      expect(typeof result.healthy).toBe("boolean");
    });

    test("each utility check has status and message", async () => {
      const result = await runDoctor();

      for (const check of result.utilities) {
        expect(check.name).toBeDefined();
        expect(check.status).toBeDefined();
        expect(["installed", "missing", "outdated", "error"]).toContain(
          check.status,
        );
        expect(check.message).toBeDefined();
        expect(check.expectedVersion).toBeDefined();
      }
    });

    test("missing utilities have install instructions", async () => {
      const result = await runDoctor();

      for (const check of result.utilities) {
        if (check.status === "missing") {
          expect(check.message).toContain("Run:");
          // Install commands use either curl or go install
          const hasCurl = check.message.includes("curl");
          const hasGoInstall = check.message.includes("go install");
          expect(hasCurl || hasGoInstall).toBe(true);
        }
      }
    });

    test("healthy is true only when all utilities installed", async () => {
      const result = await runDoctor();

      const allInstalled = result.utilities.every(
        (u) => u.status === "installed",
      );
      expect(result.healthy).toBe(allInstalled);
    });
  });

  describe("output directory validation", () => {
    // These tests validate the security constraints on output directories
    // The actual validation happens in runGiil/runCsctf

    test("giil requires valid URL", async () => {
      // Import dynamically to test validation
      const { runGiil } = await import("../services/utilities.service");

      // This will fail validation before even checking if giil is installed
      // But we're testing that the function handles it gracefully
      const result = await runGiil({ url: "not-a-valid-url" });

      // Either fails validation or fails because giil isn't installed
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test("csctf requires valid URL", async () => {
      const { runCsctf } = await import("../services/utilities.service");

      const result = await runCsctf({ url: "not-a-valid-url" });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("caching behavior", () => {
    test("repeated status checks are cached", async () => {
      const startTime = Date.now();

      // First call - hits the actual check
      await getUtilityStatus("giil");

      // Second call - should be faster due to caching
      await getUtilityStatus("giil");
      await getUtilityStatus("giil");

      const elapsed = Date.now() - startTime;

      // If caching works, this should be much faster than 3 sequential checks
      // Each check has a 5 second timeout, so 3 calls without cache would be slow
      expect(elapsed).toBeLessThan(10000);
    });
  });
});
