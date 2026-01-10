/**
 * Tests for CAAM (Coding Agent Account Manager) module.
 *
 * Tests profile management, pool operations, and rotation strategies.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { db } from "../db";
import { accountProfiles, accountPools, accountPoolMembers } from "../db/schema";
import { eq } from "drizzle-orm";
import {
  createProfile,
  listProfiles,
  getProfile,
  updateProfile,
  deleteProfile,
  setCooldown,
  activateProfile,
  markVerified,
  getByoaStatus,
  getPool,
  getPoolProfiles,
} from "../caam/account.service";
import {
  rotate,
  handleRateLimit,
  isRateLimitError,
  peekNextProfile,
} from "../caam/rotation";
import type { ProviderId } from "../caam/types";

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
      expect(activated!.lastUsedAt!.getTime()).toBeGreaterThanOrEqual(before - 2000);
      expect(activated!.lastUsedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 2000);
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

      const result = await handleRateLimit("test-ws", "claude", "429 Too Many Requests");

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
