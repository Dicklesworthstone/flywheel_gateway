/**
 * Tests for CAAM (Coding Agent Account Manager) module.
 *
 * Tests profile management, pool operations, and rotation strategies.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  activateProfile,
  createProfile,
  deleteProfile,
  getByoaStatus,
  getPool,
  getPoolProfiles,
  getProfile,
  listProfiles,
  markVerified,
  setCooldown,
  updateProfile,
} from "../caam/account.service";
import { CaamRunner } from "../caam/runner";
import {
  handleRateLimit,
  isRateLimitError,
  peekNextProfile,
  rotate,
} from "../caam/rotation";
import type { ProviderId } from "../caam/types";
import { db } from "../db";
import {
  accountPoolMembers,
  accountPools,
  accountProfiles,
} from "../db/schema";
import { createMockCaamExecutor, type MockCaamExecutor } from "@flywheel/test-utils";

describe("CAAM Account Service", () => {
  // Clean up test data after each test
  afterEach(async () => {
    await db.delete(accountPoolMembers);
    await db.delete(accountProfiles);
    await db.delete(accountPools);
  });

  describe("createProfile", () => {
    test("creates a profile with default values", async () => {
      const profile = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Test Profile",
        authMode: "device_code",
      });

      expect(profile.id).toMatch(/^prof_/);
      expect(profile.workspaceId).toBe("test-ws");
      expect(profile.provider).toBe("claude");
      expect(profile.name).toBe("Test Profile");
      expect(profile.authMode).toBe("device_code");
      expect(profile.status).toBe("unlinked");
      expect(profile.artifacts.authFilesPresent).toBe(false);
    });

    test("creates a profile with labels", async () => {
      const profile = await createProfile({
        workspaceId: "test-ws",
        provider: "codex",
        name: "Work Account",
        authMode: "api_key",
        labels: ["work", "primary"],
      });

      expect(profile.labels).toEqual(["work", "primary"]);
    });

    test("automatically creates a pool for the provider", async () => {
      await createProfile({
        workspaceId: "test-ws",
        provider: "gemini",
        name: "Gemini Profile",
        authMode: "oauth_browser",
      });

      const pool = await getPool("test-ws", "gemini");
      expect(pool).not.toBeNull();
      expect(pool!.provider).toBe("gemini");
      expect(pool!.rotationStrategy).toBe("smart");
    });
  });

  describe("getProfile", () => {
    test("returns profile by ID", async () => {
      const created = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Test",
        authMode: "device_code",
      });

      const profile = await getProfile(created.id);
      expect(profile).not.toBeNull();
      expect(profile!.id).toBe(created.id);
    });

    test("returns null for non-existent profile", async () => {
      const profile = await getProfile("non-existent-id");
      expect(profile).toBeNull();
    });
  });

  describe("listProfiles", () => {
    test("lists all profiles", async () => {
      await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Profile 1",
        authMode: "device_code",
      });
      await createProfile({
        workspaceId: "test-ws",
        provider: "codex",
        name: "Profile 2",
        authMode: "api_key",
      });

      const result = await listProfiles();
      expect(result.profiles.length).toBeGreaterThanOrEqual(2);
    });

    test("filters by workspaceId", async () => {
      await createProfile({
        workspaceId: "ws-1",
        provider: "claude",
        name: "WS1 Profile",
        authMode: "device_code",
      });
      await createProfile({
        workspaceId: "ws-2",
        provider: "claude",
        name: "WS2 Profile",
        authMode: "device_code",
      });

      const result = await listProfiles({ workspaceId: "ws-1" });
      expect(result.profiles.every((p) => p.workspaceId === "ws-1")).toBe(true);
    });

    test("filters by provider", async () => {
      await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Claude Profile",
        authMode: "device_code",
      });
      await createProfile({
        workspaceId: "test-ws",
        provider: "codex",
        name: "Codex Profile",
        authMode: "api_key",
      });

      const result = await listProfiles({ provider: "claude" });
      expect(result.profiles.every((p) => p.provider === "claude")).toBe(true);
    });

    test("respects limit", async () => {
      for (let i = 0; i < 5; i++) {
        await createProfile({
          workspaceId: "test-ws",
          provider: "claude",
          name: `Profile ${i}`,
          authMode: "device_code",
        });
      }

      const result = await listProfiles({ limit: 3 });
      expect(result.profiles.length).toBeLessThanOrEqual(3);
      expect(result.pagination.hasMore).toBe(true);
    });
  });

  describe("updateProfile", () => {
    test("updates profile name", async () => {
      const created = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Original",
        authMode: "device_code",
      });

      const updated = await updateProfile(created.id, { name: "Updated" });
      expect(updated!.name).toBe("Updated");
    });

    test("updates profile status", async () => {
      const created = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Test",
        authMode: "device_code",
      });

      const updated = await updateProfile(created.id, {
        status: "error",
        statusMessage: "Test error",
      });
      expect(updated!.status).toBe("error");
      expect(updated!.statusMessage).toBe("Test error");
    });

    test("returns null for non-existent profile", async () => {
      const result = await updateProfile("non-existent", { name: "Test" });
      expect(result).toBeNull();
    });
  });

  describe("deleteProfile", () => {
    test("deletes existing profile", async () => {
      const created = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "To Delete",
        authMode: "device_code",
      });

      const deleted = await deleteProfile(created.id);
      expect(deleted).toBe(true);

      const after = await getProfile(created.id);
      expect(after).toBeNull();
    });

    test("returns false for non-existent profile", async () => {
      const deleted = await deleteProfile("non-existent");
      expect(deleted).toBe(false);
    });
  });

  describe("setCooldown", () => {
    test("sets profile to cooldown status", async () => {
      const created = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Test",
        authMode: "device_code",
      });

      await markVerified(created.id);
      const cooled = await setCooldown(created.id, 15, "Rate limited");

      expect(cooled!.status).toBe("cooldown");
      expect(cooled!.statusMessage).toContain("Rate limited");
      expect(cooled!.cooldownUntil).toBeDefined();
      expect(cooled!.cooldownUntil!.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("markVerified", () => {
    test("marks profile as verified", async () => {
      const created = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Test",
        authMode: "device_code",
      });

      const verified = await markVerified(created.id);

      expect(verified!.status).toBe("verified");
      expect(verified!.healthScore).toBe(100);
      expect(verified!.artifacts.authFilesPresent).toBe(true);
      expect(verified!.lastVerifiedAt).toBeDefined();
    });
  });

  describe("activateProfile", () => {
    test("activates a profile and updates lastUsedAt", async () => {
      const created = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Test",
        authMode: "device_code",
      });

      const before = Date.now();
      const activated = await activateProfile(created.id);

      expect(activated!.lastUsedAt).toBeDefined();
      // Allow 2 second tolerance for database timestamp precision
      expect(activated!.lastUsedAt!.getTime()).toBeGreaterThanOrEqual(
        before - 2000,
      );
      expect(activated!.lastUsedAt!.getTime()).toBeLessThanOrEqual(
        Date.now() + 2000,
      );
    });

    test("updates pool's active profile", async () => {
      const created = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Test",
        authMode: "device_code",
      });

      await activateProfile(created.id);
      const pool = await getPool("test-ws", "claude");

      expect(pool!.activeProfileId).toBe(created.id);
    });
  });

  describe("getByoaStatus", () => {
    test("returns not ready when no verified profiles", async () => {
      await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Unlinked",
        authMode: "device_code",
      });

      const status = await getByoaStatus("test-ws");

      expect(status.ready).toBe(false);
      expect(status.verifiedProviders).toEqual([]);
      expect(status.recommendedAction).toBeDefined();
    });

    test("returns ready with verified profile", async () => {
      const created = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Verified",
        authMode: "device_code",
      });
      await markVerified(created.id);

      const status = await getByoaStatus("test-ws");

      expect(status.ready).toBe(true);
      expect(status.verifiedProviders).toContain("claude");
      expect(status.profileSummary.verified).toBe(1);
    });

    test("counts cooldown and error profiles", async () => {
      const p1 = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Profile 1",
        authMode: "device_code",
      });
      const p2 = await createProfile({
        workspaceId: "test-ws",
        provider: "codex",
        name: "Profile 2",
        authMode: "api_key",
      });

      await markVerified(p1.id);
      await setCooldown(p1.id, 15);
      await updateProfile(p2.id, { status: "error" });

      const status = await getByoaStatus("test-ws");

      expect(status.profileSummary.inCooldown).toBe(1);
      expect(status.profileSummary.error).toBe(1);
    });
  });

  describe("getPoolProfiles", () => {
    test("returns profiles in a pool", async () => {
      const p1 = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Profile 1",
        authMode: "device_code",
      });
      const p2 = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Profile 2",
        authMode: "device_code",
      });

      const pool = await getPool("test-ws", "claude");
      const profiles = await getPoolProfiles(pool!.id);

      expect(profiles.length).toBe(2);
      expect(profiles.some((p) => p.id === p1.id)).toBe(true);
      expect(profiles.some((p) => p.id === p2.id)).toBe(true);
    });
  });
});

describe("CAAM Rotation", () => {
  afterEach(async () => {
    await db.delete(accountPoolMembers);
    await db.delete(accountProfiles);
    await db.delete(accountPools);
  });

  describe("rotate", () => {
    test("rotates to next available profile", async () => {
      const p1 = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Profile 1",
        authMode: "device_code",
      });
      const p2 = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Profile 2",
        authMode: "device_code",
      });

      await markVerified(p1.id);
      await markVerified(p2.id);
      await activateProfile(p1.id);

      const result = await rotate("test-ws", "claude", "Test rotation");

      expect(result.success).toBe(true);
      expect(result.previousProfileId).toBe(p1.id);
      expect(result.newProfileId).toBe(p2.id);
      expect(result.retriesRemaining).toBeGreaterThanOrEqual(0);
    });

    test("fails when no pool exists", async () => {
      const result = await rotate("non-existent-ws", "claude");

      expect(result.success).toBe(false);
      expect(result.reason).toContain("No pool found");
    });

    test("fails when no profiles available", async () => {
      await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Unverified",
        authMode: "device_code",
      });

      const result = await rotate("test-ws", "claude");

      expect(result.success).toBe(false);
      expect(result.reason).toContain("No available profiles");
    });

    test("skips profiles in cooldown", async () => {
      const p1 = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Profile 1",
        authMode: "device_code",
      });
      const p2 = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Profile 2",
        authMode: "device_code",
      });

      await markVerified(p1.id);
      await markVerified(p2.id);
      // Put BOTH profiles in cooldown
      await setCooldown(p1.id, 15);
      await setCooldown(p2.id, 15);

      const result = await rotate("test-ws", "claude");

      // Should fail since all profiles are in cooldown
      expect(result.success).toBe(false);
      expect(result.reason).toContain("No available profiles");
    });
  });

  describe("handleRateLimit", () => {
    test("puts current profile in cooldown and rotates", async () => {
      const p1 = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Profile 1",
        authMode: "device_code",
      });
      const p2 = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Profile 2",
        authMode: "device_code",
      });

      await markVerified(p1.id);
      await markVerified(p2.id);
      await activateProfile(p1.id);

      const result = await handleRateLimit(
        "test-ws",
        "claude",
        "429 Too Many Requests",
      );

      expect(result.success).toBe(true);
      expect(result.newProfileId).toBe(p2.id);

      // Check p1 is in cooldown
      const updatedP1 = await getProfile(p1.id);
      expect(updatedP1!.status).toBe("cooldown");
    });

    test("fails when no active profile", async () => {
      await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Profile",
        authMode: "device_code",
      });

      const result = await handleRateLimit("test-ws", "claude");

      expect(result.success).toBe(false);
      expect(result.reason).toContain("No active profile");
    });
  });

  describe("isRateLimitError", () => {
    test("detects Claude rate limit errors", () => {
      expect(isRateLimitError("claude", "rate_limit_error")).toBe(true);
      expect(isRateLimitError("claude", "overloaded_error")).toBe(true);
      expect(isRateLimitError("claude", "429")).toBe(true);
      expect(isRateLimitError("claude", "normal error")).toBe(false);
    });

    test("detects Codex rate limit errors", () => {
      expect(isRateLimitError("codex", "rate_limit_exceeded")).toBe(true);
      expect(isRateLimitError("codex", "Too Many Requests")).toBe(true);
      expect(isRateLimitError("codex", "429")).toBe(true);
      expect(isRateLimitError("codex", "normal error")).toBe(false);
    });

    test("detects Gemini rate limit errors", () => {
      expect(isRateLimitError("gemini", "RESOURCE_EXHAUSTED")).toBe(true);
      expect(isRateLimitError("gemini", "quota exceeded")).toBe(true);
      expect(isRateLimitError("gemini", "429")).toBe(true);
      expect(isRateLimitError("gemini", "normal error")).toBe(false);
    });
  });

  describe("peekNextProfile", () => {
    test("returns next profile without actually rotating", async () => {
      const p1 = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Profile 1",
        authMode: "device_code",
      });
      const p2 = await createProfile({
        workspaceId: "test-ws",
        provider: "claude",
        name: "Profile 2",
        authMode: "device_code",
      });

      await markVerified(p1.id);
      await markVerified(p2.id);
      await activateProfile(p1.id);

      const next = await peekNextProfile("test-ws", "claude");

      expect(next).not.toBeNull();

      // Verify pool wasn't actually rotated
      const pool = await getPool("test-ws", "claude");
      expect(pool!.activeProfileId).toBe(p1.id);
    });

    test("returns null when no pool exists", async () => {
      const next = await peekNextProfile("non-existent", "claude");
      expect(next).toBeNull();
    });
  });
});

describe("CAAM Types", () => {
  // Import type conversion functions
  const {
    caamAuthModeToGateway,
    gatewayAuthModeToCaam,
    parseHealthStatus,
    RATE_LIMIT_SIGNATURES,
    DEFAULT_COOLDOWN_MINUTES,
  } = require("../caam/types");

  describe("caamAuthModeToGateway", () => {
    test("converts oauth to oauth_browser", () => {
      expect(caamAuthModeToGateway("oauth")).toBe("oauth_browser");
    });

    test("converts device-code to device_code", () => {
      expect(caamAuthModeToGateway("device-code")).toBe("device_code");
    });

    test("converts api-key to api_key", () => {
      expect(caamAuthModeToGateway("api-key")).toBe("api_key");
    });

    test("converts vertex-adc to vertex_adc", () => {
      expect(caamAuthModeToGateway("vertex-adc")).toBe("vertex_adc");
    });

    test("returns device_code for unknown mode", () => {
      expect(caamAuthModeToGateway("unknown" as any)).toBe("device_code");
    });
  });

  describe("gatewayAuthModeToCaam", () => {
    test("converts oauth_browser to oauth", () => {
      expect(gatewayAuthModeToCaam("oauth_browser")).toBe("oauth");
    });

    test("converts device_code to device-code", () => {
      expect(gatewayAuthModeToCaam("device_code")).toBe("device-code");
    });

    test("converts api_key to api-key", () => {
      expect(gatewayAuthModeToCaam("api_key")).toBe("api-key");
    });

    test("converts vertex_adc to vertex-adc", () => {
      expect(gatewayAuthModeToCaam("vertex_adc")).toBe("vertex-adc");
    });

    test("returns device-code for unknown mode", () => {
      expect(gatewayAuthModeToCaam("unknown" as any)).toBe("device-code");
    });
  });

  describe("parseHealthStatus", () => {
    test("parses healthy status", () => {
      expect(parseHealthStatus("healthy")).toBe("healthy");
      expect(parseHealthStatus("HEALTHY")).toBe("healthy");
      expect(parseHealthStatus("Healthy")).toBe("healthy");
    });

    test("parses warning status", () => {
      expect(parseHealthStatus("warning")).toBe("warning");
      expect(parseHealthStatus("WARNING")).toBe("warning");
    });

    test("parses critical status", () => {
      expect(parseHealthStatus("critical")).toBe("critical");
      expect(parseHealthStatus("CRITICAL")).toBe("critical");
    });

    test("returns unknown for invalid input", () => {
      expect(parseHealthStatus("invalid")).toBe("unknown");
      expect(parseHealthStatus("")).toBe("unknown");
      expect(parseHealthStatus("error")).toBe("unknown");
    });
  });

  describe("RATE_LIMIT_SIGNATURES", () => {
    test("has patterns for claude", () => {
      expect(RATE_LIMIT_SIGNATURES.claude).toBeDefined();
      expect(RATE_LIMIT_SIGNATURES.claude.length).toBeGreaterThan(0);
      expect(RATE_LIMIT_SIGNATURES.claude).toContain("rate limit");
      expect(RATE_LIMIT_SIGNATURES.claude).toContain("429");
    });

    test("has patterns for codex", () => {
      expect(RATE_LIMIT_SIGNATURES.codex).toBeDefined();
      expect(RATE_LIMIT_SIGNATURES.codex.length).toBeGreaterThan(0);
      expect(RATE_LIMIT_SIGNATURES.codex).toContain("429");
    });

    test("has patterns for gemini", () => {
      expect(RATE_LIMIT_SIGNATURES.gemini).toBeDefined();
      expect(RATE_LIMIT_SIGNATURES.gemini.length).toBeGreaterThan(0);
      expect(RATE_LIMIT_SIGNATURES.gemini).toContain("RESOURCE_EXHAUSTED");
      expect(RATE_LIMIT_SIGNATURES.gemini).toContain("429");
    });
  });

  describe("DEFAULT_COOLDOWN_MINUTES", () => {
    test("has values for all providers", () => {
      expect(DEFAULT_COOLDOWN_MINUTES.claude).toBeDefined();
      expect(DEFAULT_COOLDOWN_MINUTES.codex).toBeDefined();
      expect(DEFAULT_COOLDOWN_MINUTES.gemini).toBeDefined();
    });

    test("has positive cooldown values", () => {
      expect(DEFAULT_COOLDOWN_MINUTES.claude).toBeGreaterThan(0);
      expect(DEFAULT_COOLDOWN_MINUTES.codex).toBeGreaterThan(0);
      expect(DEFAULT_COOLDOWN_MINUTES.gemini).toBeGreaterThan(0);
    });

    test("claude has longer cooldown than gemini", () => {
      // Claude has stricter rate limits, so longer cooldown
      expect(DEFAULT_COOLDOWN_MINUTES.claude).toBeGreaterThan(
        DEFAULT_COOLDOWN_MINUTES.gemini,
      );
    });
  });
});

describe("CAAM Runner", () => {
  let mockExecutor: MockCaamExecutor;
  let runner: CaamRunner;

  beforeEach(() => {
    mockExecutor = createMockCaamExecutor({
      profiles: [
        {
          tool: "claude",
          name: "work",
          active: true,
          health: { status: "healthy", error_count: 0 },
          identity: { email: "user@example.com", plan_type: "pro" },
        },
        {
          tool: "claude",
          name: "personal",
          active: false,
          health: { status: "warning", error_count: 2 },
        },
        {
          tool: "codex",
          name: "default",
          active: true,
          health: { status: "healthy" },
        },
      ],
      statusTools: [
        {
          tool: "claude",
          logged_in: true,
          active_profile: "work",
          health: { status: "healthy", error_count: 0 },
          identity: { email: "user@example.com", plan_type: "pro" },
        },
      ],
    });
    runner = new CaamRunner(mockExecutor as any);
  });

  describe("listProfiles", () => {
    test("lists all profiles from mock CLI", async () => {
      const profiles = await runner.listProfiles("test-ws");

      expect(profiles.length).toBe(3);
      expect(profiles[0]!.name).toBe("work");
      expect(profiles[0]!.active).toBe(true);
    });

    test("filters profiles by provider", async () => {
      const profiles = await runner.listProfiles("test-ws", "claude");

      expect(profiles.length).toBe(2);
      expect(profiles.every((p) => p.provider === "claude")).toBe(true);
    });

    test("returns empty array on CLI failure", async () => {
      mockExecutor.injectFailure("ls", "CLI not found", 127);

      const profiles = await runner.listProfiles("test-ws");

      expect(profiles).toEqual([]);
    });
  });

  describe("getStatus", () => {
    test("returns status for provider", async () => {
      const status = await runner.getStatus("test-ws", "claude");

      expect(status.provider).toBe("claude");
      expect(status.logged_in).toBe(true);
      expect(status.profile).toBe("work");
    });

    test("returns error status on CLI failure", async () => {
      mockExecutor.injectFailure("status", "Command failed", 1);

      const status = await runner.getStatus("test-ws", "claude");

      expect(status.logged_in).toBe(false);
      expect(status.error).toBeDefined();
    });
  });

  describe("activate", () => {
    test("activates a specific profile", async () => {
      const result = await runner.activate("test-ws", "claude", "personal");

      expect(result.success).toBe(true);
      expect(result.profile).toBe("personal");
    });

    test("returns failure on CLI error", async () => {
      mockExecutor.injectFailure("activate", "Profile not found", 1);

      const result = await runner.activate("test-ws", "claude", "nonexistent");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("activateAuto", () => {
    test("activates using smart rotation", async () => {
      const result = await runner.activateAuto("test-ws", "claude");

      expect(result.success).toBe(true);
      expect(result.new_profile).toBeDefined();
    });

    test("returns failure when no profiles available", async () => {
      mockExecutor.injectFailure("activate", "No profiles available", 1);

      const result = await runner.activateAuto("test-ws", "claude");

      expect(result.success).toBe(false);
      expect(result.reason).toContain("No profiles available");
    });
  });

  describe("setCooldown", () => {
    test("sets cooldown for a profile", async () => {
      // Should complete without throwing
      await runner.setCooldown("test-ws", "claude", "work", 15, "Rate limited");

      const calls = mockExecutor.getCallHistory();
      const cooldownCall = calls.find((c) => c.args[0] === "cooldown");
      expect(cooldownCall).toBeDefined();
      expect(cooldownCall!.args).toContain("set");
      expect(cooldownCall!.args).toContain("15");
    });

    test("throws on CLI failure", async () => {
      mockExecutor.injectFailure("cooldown set", "Failed to set", 1);

      await expect(
        runner.setCooldown("test-ws", "claude", "work", 15),
      ).rejects.toThrow();
    });
  });

  describe("clearCooldown", () => {
    test("clears cooldown for a profile", async () => {
      // Should complete without throwing
      await runner.clearCooldown("test-ws", "claude", "work");

      const calls = mockExecutor.getCallHistory();
      const cooldownCall = calls.find((c) => c.args[0] === "cooldown");
      expect(cooldownCall).toBeDefined();
      expect(cooldownCall!.args).toContain("clear");
    });
  });

  describe("listCooldowns", () => {
    test("lists active cooldowns", async () => {
      mockExecutor.setCooldowns([
        {
          provider: "claude",
          profile: "work",
          hit_at: new Date().toISOString(),
          cooldown_until: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          remaining_minutes: 15,
          notes: "Rate limited",
        },
      ]);

      const cooldowns = await runner.listCooldowns("test-ws");

      expect(cooldowns.length).toBe(1);
      expect(cooldowns[0]!.profile).toBe("work");
      expect(cooldowns[0]!.remaining_minutes).toBe(15);
    });

    test("returns empty array when no cooldowns", async () => {
      const cooldowns = await runner.listCooldowns("test-ws");
      expect(cooldowns).toEqual([]);
    });
  });

  describe("backup", () => {
    test("creates a backup", async () => {
      // Should complete without throwing
      await runner.backup("test-ws", "claude", "pre-update");

      const calls = mockExecutor.getCallHistory();
      const backupCall = calls.find((c) => c.args[0] === "backup");
      expect(backupCall).toBeDefined();
      expect(backupCall!.args).toContain("claude");
      expect(backupCall!.args).toContain("pre-update");
    });
  });

  describe("clear", () => {
    test("clears auth files for a provider", async () => {
      // Should complete without throwing
      await runner.clear("test-ws", "claude");

      const calls = mockExecutor.getCallHistory();
      const clearCall = calls.find((c) => c.args[0] === "clear");
      expect(clearCall).toBeDefined();
      expect(clearCall!.args).toContain("claude");
      expect(clearCall!.args).toContain("--force");
    });
  });

  describe("isAvailable", () => {
    test("returns true when CLI responds", async () => {
      const available = await runner.isAvailable("test-ws");
      expect(available).toBe(true);
    });

    test("returns false when CLI fails", async () => {
      mockExecutor.injectFailure("version", "Not found", 127);

      const available = await runner.isAvailable("test-ws");
      expect(available).toBe(false);
    });
  });

  describe("call history tracking", () => {
    test("tracks all CLI calls", async () => {
      await runner.listProfiles("test-ws");
      await runner.getStatus("test-ws", "claude");
      await runner.isAvailable("test-ws");

      const calls = mockExecutor.getCallHistory();
      expect(calls.length).toBe(3);
      expect(calls[0]!.args[0]).toBe("ls");
      expect(calls[1]!.args[0]).toBe("status");
      expect(calls[2]!.args[0]).toBe("version");
    });
  });
});
