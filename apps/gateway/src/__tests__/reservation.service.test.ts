/**
 * Unit tests for the File Reservation Service.
 *
 * Tests core reservation operations: create, check, release, renew, list.
 * Also tests conflict detection, TTL handling, and pattern matching.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  _clearAllReservations,
  checkReservation,
  createReservation,
  getReservation,
  getReservationStats,
  listConflicts,
  listReservations,
  releaseReservation,
  renewReservation,
  resolveConflict,
  startCleanupJob,
  stopCleanupJob,
} from "../services/reservation.service";

// Clean up before each test
beforeEach(() => {
  _clearAllReservations();
  stopCleanupJob();
});

afterEach(() => {
  _clearAllReservations();
  stopCleanupJob();
});

describe("Reservation Service", () => {
  describe("createReservation", () => {
    test("creates reservation with valid parameters", async () => {
      const result = await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
        ttl: 300,
        reason: "Editing source files",
      });

      expect(result.granted).toBe(true);
      expect(result.reservation).not.toBeNull();
      expect(result.reservation!.id).toMatch(/^rsv_/);
      expect(result.reservation!.projectId).toBe("project-1");
      expect(result.reservation!.agentId).toBe("agent-1");
      expect(result.reservation!.patterns).toEqual(["src/**/*.ts"]);
      expect(result.reservation!.mode).toBe("exclusive");
      expect(result.reservation!.ttl).toBe(300);
      expect(result.reservation!.renewCount).toBe(0);
      expect(result.reservation!.metadata.reason).toBe("Editing source files");
      expect(result.conflicts).toHaveLength(0);
    });

    test("creates shared reservation", async () => {
      const result = await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["docs/**/*.md"],
        mode: "shared",
      });

      expect(result.granted).toBe(true);
      expect(result.reservation!.mode).toBe("shared");
    });

    test("uses default TTL when not provided", async () => {
      const result = await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**"],
        mode: "exclusive",
      });

      expect(result.granted).toBe(true);
      expect(result.reservation!.ttl).toBe(300); // Default 5 minutes
    });

    test("caps TTL at maximum (1 hour)", async () => {
      const result = await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**"],
        mode: "exclusive",
        ttl: 7200, // 2 hours - exceeds max
      });

      expect(result.granted).toBe(true);
      expect(result.reservation!.ttl).toBe(3600); // Capped to 1 hour
    });

    test("rejects empty patterns array", async () => {
      const result = await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: [],
        mode: "exclusive",
      });

      expect(result.granted).toBe(false);
      expect(result.reservation).toBeNull();
    });

    test("detects conflict with overlapping exclusive reservation", async () => {
      // First reservation
      await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      // Conflicting reservation
      const result = await createReservation({
        projectId: "project-1",
        agentId: "agent-2",
        patterns: ["src/index.ts"], // Overlaps with src/**/*.ts
        mode: "exclusive",
      });

      expect(result.granted).toBe(false);
      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.conflicts[0]!.existingReservation.requesterId).toBe(
        "agent-1",
      );
    });

    test("allows shared reservations to overlap", async () => {
      // First shared reservation
      await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["docs/**/*.md"],
        mode: "shared",
      });

      // Second shared reservation on same patterns
      const result = await createReservation({
        projectId: "project-1",
        agentId: "agent-2",
        patterns: ["docs/**/*.md"],
        mode: "shared",
      });

      expect(result.granted).toBe(true);
    });

    test("detects conflict when exclusive overlaps with shared", async () => {
      // First exclusive reservation
      await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      // Shared reservation that overlaps
      const result = await createReservation({
        projectId: "project-1",
        agentId: "agent-2",
        patterns: ["src/index.ts"],
        mode: "shared",
      });

      expect(result.granted).toBe(false);
      expect(result.conflicts.length).toBeGreaterThan(0);
    });

    test("allows same agent to extend reservation patterns", async () => {
      // First reservation
      await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      // Same agent, overlapping pattern
      const result = await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/index.ts"],
        mode: "exclusive",
      });

      expect(result.granted).toBe(true);
    });

    test("allows reservations in different projects", async () => {
      // First reservation in project 1
      await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      // Same pattern in different project
      const result = await createReservation({
        projectId: "project-2",
        agentId: "agent-2",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      expect(result.granted).toBe(true);
    });
  });

  describe("checkReservation", () => {
    test("allows access to file not covered by any reservation", async () => {
      const result = await checkReservation({
        projectId: "project-1",
        agentId: "agent-1",
        filePath: "src/index.ts",
      });

      expect(result.allowed).toBe(true);
      expect(result.heldBy).toBeUndefined();
    });

    test("allows access to own exclusive reservation", async () => {
      await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      const result = await checkReservation({
        projectId: "project-1",
        agentId: "agent-1",
        filePath: "src/index.ts",
      });

      expect(result.allowed).toBe(true);
      expect(result.heldBy).toBe("agent-1");
      expect(result.mode).toBe("exclusive");
    });

    test("denies access to file held by another agent exclusively", async () => {
      await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      const result = await checkReservation({
        projectId: "project-1",
        agentId: "agent-2",
        filePath: "src/index.ts",
      });

      expect(result.allowed).toBe(false);
      expect(result.heldBy).toBe("agent-1");
      expect(result.mode).toBe("exclusive");
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    test("allows access to shared reservation", async () => {
      await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["docs/**/*.md"],
        mode: "shared",
      });

      const result = await checkReservation({
        projectId: "project-1",
        agentId: "agent-2",
        filePath: "docs/README.md",
      });

      expect(result.allowed).toBe(true);
      expect(result.heldBy).toBe("agent-1");
      expect(result.mode).toBe("shared");
    });

    test("allows access to file in different project", async () => {
      await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      const result = await checkReservation({
        projectId: "project-2",
        agentId: "agent-2",
        filePath: "src/index.ts",
      });

      expect(result.allowed).toBe(true);
      expect(result.heldBy).toBeUndefined();
    });
  });

  describe("releaseReservation", () => {
    test("releases reservation successfully", async () => {
      const createResult = await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      const releaseResult = await releaseReservation({
        reservationId: createResult.reservation!.id,
        agentId: "agent-1",
      });

      expect(releaseResult.released).toBe(true);

      // Verify reservation is gone
      const reservation = await getReservation(createResult.reservation!.id);
      expect(reservation).toBeNull();
    });

    test("returns error for non-existent reservation", async () => {
      const result = await releaseReservation({
        reservationId: "rsv_nonexistent",
        agentId: "agent-1",
      });

      expect(result.released).toBe(false);
      expect(result.error).toBe("Reservation not found");
    });

    test("returns error when non-holder tries to release", async () => {
      const createResult = await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      const releaseResult = await releaseReservation({
        reservationId: createResult.reservation!.id,
        agentId: "agent-2", // Different agent
      });

      expect(releaseResult.released).toBe(false);
      expect(releaseResult.error).toBe("Agent does not hold this reservation");
    });

    test("file becomes available after release", async () => {
      const createResult = await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      await releaseReservation({
        reservationId: createResult.reservation!.id,
        agentId: "agent-1",
      });

      // Now another agent can reserve
      const newResult = await createReservation({
        projectId: "project-1",
        agentId: "agent-2",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      expect(newResult.granted).toBe(true);
    });
  });

  describe("renewReservation", () => {
    test("renews reservation successfully", async () => {
      const createResult = await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
        ttl: 60,
      });

      const originalExpiry = createResult.reservation!.expiresAt;

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      const renewResult = await renewReservation({
        reservationId: createResult.reservation!.id,
        agentId: "agent-1",
        additionalTtl: 120,
      });

      expect(renewResult.renewed).toBe(true);
      expect(renewResult.newExpiresAt).toBeInstanceOf(Date);
      expect(renewResult.newExpiresAt!.getTime()).toBeGreaterThan(
        originalExpiry.getTime(),
      );
    });

    test("uses original TTL if additionalTtl not provided", async () => {
      const createResult = await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
        ttl: 120,
      });

      const renewResult = await renewReservation({
        reservationId: createResult.reservation!.id,
        agentId: "agent-1",
      });

      expect(renewResult.renewed).toBe(true);
    });

    test("caps additionalTtl at maximum", async () => {
      const createResult = await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
        ttl: 60, // Short initial TTL for clearer testing
      });

      const beforeRenew = Date.now();
      const originalExpiry = createResult.reservation!.expiresAt;

      const renewResult = await renewReservation({
        reservationId: createResult.reservation!.id,
        agentId: "agent-1",
        additionalTtl: 7200, // 2 hours - exceeds max
      });

      expect(renewResult.renewed).toBe(true);
      // Renewal extends from original expiry (which is still in the future)
      // New expiry = originalExpiry + 1 hour (capped from 2 hours)
      const expectedExpiry = originalExpiry.getTime() + 3600 * 1000;
      expect(renewResult.newExpiresAt!.getTime()).toBeLessThanOrEqual(
        expectedExpiry + 100,
      );
      expect(renewResult.newExpiresAt!.getTime()).toBeGreaterThanOrEqual(
        expectedExpiry - 100,
      );
    });

    test("returns error for non-existent reservation", async () => {
      const result = await renewReservation({
        reservationId: "rsv_nonexistent",
        agentId: "agent-1",
      });

      expect(result.renewed).toBe(false);
      expect(result.error).toBe("Reservation not found");
    });

    test("returns error when non-holder tries to renew", async () => {
      const createResult = await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      const result = await renewReservation({
        reservationId: createResult.reservation!.id,
        agentId: "agent-2",
      });

      expect(result.renewed).toBe(false);
      expect(result.error).toBe("Agent does not hold this reservation");
    });

    test("enforces maximum renewal limit", async () => {
      const createResult = await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
        ttl: 60,
      });

      // Renew 10 times (the max)
      for (let i = 0; i < 10; i++) {
        const result = await renewReservation({
          reservationId: createResult.reservation!.id,
          agentId: "agent-1",
          additionalTtl: 60,
        });
        expect(result.renewed).toBe(true);
      }

      // 11th renewal should fail
      const result = await renewReservation({
        reservationId: createResult.reservation!.id,
        agentId: "agent-1",
        additionalTtl: 60,
      });

      expect(result.renewed).toBe(false);
      expect(result.error).toContain("Maximum renewals");
    });

    test("increments renewCount on each renewal", async () => {
      const createResult = await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      await renewReservation({
        reservationId: createResult.reservation!.id,
        agentId: "agent-1",
      });

      await renewReservation({
        reservationId: createResult.reservation!.id,
        agentId: "agent-1",
      });

      const reservation = await getReservation(createResult.reservation!.id);
      expect(reservation!.renewCount).toBe(2);
    });
  });

  describe("listReservations", () => {
    test("lists all reservations for a project", async () => {
      await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      await createReservation({
        projectId: "project-1",
        agentId: "agent-2",
        patterns: ["docs/**/*.md"],
        mode: "shared",
      });

      const reservations = await listReservations({ projectId: "project-1" });

      expect(reservations).toHaveLength(2);
    });

    test("filters by agentId", async () => {
      await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      await createReservation({
        projectId: "project-1",
        agentId: "agent-2",
        patterns: ["docs/**/*.md"],
        mode: "shared",
      });

      const reservations = await listReservations({
        projectId: "project-1",
        agentId: "agent-1",
      });

      expect(reservations).toHaveLength(1);
      expect(reservations[0]!.agentId).toBe("agent-1");
    });

    test("filters by filePath", async () => {
      await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      await createReservation({
        projectId: "project-1",
        agentId: "agent-2",
        patterns: ["docs/**/*.md"],
        mode: "shared",
      });

      const reservations = await listReservations({
        projectId: "project-1",
        filePath: "src/index.ts",
      });

      expect(reservations).toHaveLength(1);
      expect(reservations[0]!.patterns).toContain("src/**/*.ts");
    });

    test("returns empty array for project with no reservations", async () => {
      const reservations = await listReservations({ projectId: "project-999" });

      expect(reservations).toHaveLength(0);
    });

    test("sorts by creation time (newest first)", async () => {
      await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      await createReservation({
        projectId: "project-1",
        agentId: "agent-2",
        patterns: ["docs/**/*.md"],
        mode: "shared",
      });

      const reservations = await listReservations({ projectId: "project-1" });

      expect(reservations[0]!.agentId).toBe("agent-2"); // Newer one first
    });
  });

  describe("getReservation", () => {
    test("returns reservation by ID", async () => {
      const createResult = await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      const reservation = await getReservation(createResult.reservation!.id);

      expect(reservation).not.toBeNull();
      expect(reservation!.id).toBe(createResult.reservation!.id);
    });

    test("returns null for non-existent ID", async () => {
      const reservation = await getReservation("rsv_nonexistent");

      expect(reservation).toBeNull();
    });
  });

  describe("getReservationStats", () => {
    test("returns correct statistics", async () => {
      await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      await createReservation({
        projectId: "project-1",
        agentId: "agent-2",
        patterns: ["docs/**/*.md"],
        mode: "shared",
      });

      await createReservation({
        projectId: "project-2",
        agentId: "agent-3",
        patterns: ["lib/**/*.ts"],
        mode: "exclusive",
      });

      const stats = getReservationStats();

      expect(stats.totalActive).toBe(3);
      expect(stats.byProject["project-1"]).toBe(2);
      expect(stats.byProject["project-2"]).toBe(1);
      expect(stats.byMode.exclusive).toBe(2);
      expect(stats.byMode.shared).toBe(1);
      expect(stats.averageRenewCount).toBe(0);
    });

    test("returns zeros for empty state", async () => {
      const stats = getReservationStats();

      expect(stats.totalActive).toBe(0);
      expect(Object.keys(stats.byProject)).toHaveLength(0);
      expect(stats.byMode.exclusive).toBe(0);
      expect(stats.byMode.shared).toBe(0);
    });
  });

  describe("cleanup job", () => {
    test("starts and stops cleanup job", () => {
      expect(() => startCleanupJob()).not.toThrow();
      expect(() => stopCleanupJob()).not.toThrow();
    });

    test("can be called multiple times without error", () => {
      startCleanupJob();
      startCleanupJob(); // Should not start another
      stopCleanupJob();
      stopCleanupJob(); // Should not error
    });
  });

  describe("conflict resolutions", () => {
    test("suggests wait resolution when expiry is soon", async () => {
      // Create reservation with short TTL (30 seconds)
      await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
        ttl: 30,
      });

      // Try to create conflicting reservation
      const result = await createReservation({
        projectId: "project-1",
        agentId: "agent-2",
        patterns: ["src/index.ts"],
        mode: "exclusive",
      });

      expect(result.granted).toBe(false);
      expect(result.conflicts.length).toBeGreaterThan(0);

      const resolutions = result.conflicts[0]!.resolutions;
      const waitResolution = resolutions.find((r) => r.type === "wait");
      expect(waitResolution).toBeDefined();
    });

    test("suggests share resolution when existing reservation is shared", async () => {
      await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "shared",
      });

      const result = await createReservation({
        projectId: "project-1",
        agentId: "agent-2",
        patterns: ["src/index.ts"],
        mode: "exclusive",
      });

      expect(result.granted).toBe(false);

      const resolutions = result.conflicts[0]!.resolutions;
      const shareResolution = resolutions.find((r) => r.type === "share");
      expect(shareResolution).toBeDefined();
    });

    test("does not suggest share when existing reservation is exclusive", async () => {
      await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      const result = await createReservation({
        projectId: "project-1",
        agentId: "agent-2",
        patterns: ["src/index.ts"],
        mode: "exclusive",
      });

      expect(result.granted).toBe(false);

      const resolutions = result.conflicts[0]!.resolutions;
      const shareResolution = resolutions.find((r) => r.type === "share");
      expect(shareResolution).toBeUndefined();
    });
  });

  describe("conflict tracking", () => {
    test("records conflicts and lists them by project", async () => {
      await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      await createReservation({
        projectId: "project-1",
        agentId: "agent-2",
        patterns: ["src/index.ts"],
        mode: "exclusive",
      });

      const conflicts = await listConflicts({ projectId: "project-1" });
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.status).toBe("open");
      expect(conflicts[0]!.requesterId).toBe("agent-2");
      expect(conflicts[0]!.existingReservationId).toBeDefined();
    });

    test("resolves conflicts and filters by status", async () => {
      await createReservation({
        projectId: "project-1",
        agentId: "agent-1",
        patterns: ["src/**/*.ts"],
        mode: "exclusive",
      });

      await createReservation({
        projectId: "project-1",
        agentId: "agent-2",
        patterns: ["src/index.ts"],
        mode: "exclusive",
      });

      const conflicts = await listConflicts({ projectId: "project-1" });
      const conflictId = conflicts[0]!.conflictId;

      const resolved = await resolveConflict({
        conflictId,
        resolvedBy: "agent-2",
        reason: "manual",
      });

      expect(resolved.resolved).toBe(true);
      expect(resolved.conflict?.status).toBe("resolved");

      const openConflicts = await listConflicts({
        projectId: "project-1",
        status: "open",
      });
      expect(openConflicts).toHaveLength(0);

      const resolvedConflicts = await listConflicts({
        projectId: "project-1",
        status: "resolved",
      });
      expect(resolvedConflicts).toHaveLength(1);
    });
  });
});
