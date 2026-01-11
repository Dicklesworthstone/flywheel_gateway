/**
 * Conflict Service Tests
 *
 * Tests for conflict detection, management, and resolution.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
  type ConflictSeverity,
  type ConflictType,
  checkReservationConflicts,
  clearConflictState,
  detectResourceContention,
  getActiveConflicts,
  getAlertConfig,
  getConflict,
  getConflictHistory,
  getConflictStats,
  getRecommendedActions,
  recordResourceAccess,
  registerReservation,
  removeReservation,
  resolveConflict,
  updateAlertConfig,
} from "../services/conflict.service";

// Reset state before each test
beforeEach(() => {
  clearConflictState();
});

describe("Conflict Service", () => {
  describe("Reservation Conflict Detection", () => {
    test("detects no conflicts when no reservations exist", () => {
      const result = checkReservationConflicts(
        "project-1",
        "agent-1",
        ["src/**/*.ts"],
        true,
      );

      expect(result.hasConflicts).toBe(false);
      expect(result.canProceed).toBe(true);
      expect(result.conflicts).toHaveLength(0);
    });

    test("detects overlap conflict between exclusive reservations", () => {
      // Register first reservation
      registerReservation({
        id: "res-1",
        projectId: "project-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });

      // Check for conflict with overlapping pattern
      const result = checkReservationConflicts(
        "project-1",
        "agent-2",
        ["src/index.ts"],
        true,
      );

      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.conflicts[0]!.type).toBe("reservation_overlap");
    });

    test("allows non-overlapping reservations", () => {
      // Register first reservation
      registerReservation({
        id: "res-1",
        projectId: "project-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });

      // Check for different directory
      const result = checkReservationConflicts(
        "project-1",
        "agent-2",
        ["test/**/*.ts"],
        true,
      );

      expect(result.hasConflicts).toBe(false);
      expect(result.canProceed).toBe(true);
    });

    test("allows same agent to extend their reservation", () => {
      // Register first reservation
      registerReservation({
        id: "res-1",
        projectId: "project-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });

      // Same agent requesting overlapping pattern
      const result = checkReservationConflicts(
        "project-1",
        "agent-1",
        ["src/index.ts"],
        true,
      );

      expect(result.hasConflicts).toBe(false);
      expect(result.canProceed).toBe(true);
    });

    test("removes reservation correctly", () => {
      // Register reservation
      registerReservation({
        id: "res-1",
        projectId: "project-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });

      // Remove it
      const removed = removeReservation("project-1", "res-1");
      expect(removed).toBe(true);

      // Now another agent should be able to reserve
      const result = checkReservationConflicts(
        "project-1",
        "agent-2",
        ["src/**/*.ts"],
        true,
      );

      expect(result.hasConflicts).toBe(false);
      expect(result.canProceed).toBe(true);
    });
  });

  describe("Resource Contention Detection", () => {
    test("detects no contention with single access", () => {
      recordResourceAccess({
        resourceId: "project-1:api/users",
        agentId: "agent-1",
        accessType: "read",
        timestamp: new Date(),
      });

      const conflicts = detectResourceContention("project-1");
      expect(conflicts).toHaveLength(0);
    });

    test("detects contention with multiple exclusive accesses", () => {
      const now = new Date();

      recordResourceAccess({
        resourceId: "project-1:api/users",
        agentId: "agent-1",
        accessType: "exclusive",
        timestamp: now,
      });

      recordResourceAccess({
        resourceId: "project-1:api/users",
        agentId: "agent-2",
        accessType: "exclusive",
        timestamp: now,
      });

      const conflicts = detectResourceContention("project-1");
      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0]!.type).toBe("resource_contention");
      expect(conflicts[0]!.involvedAgents).toContain("agent-1");
      expect(conflicts[0]!.involvedAgents).toContain("agent-2");
    });

    test("detects contention with write and read access", () => {
      const now = new Date();

      recordResourceAccess({
        resourceId: "project-1:database/table",
        agentId: "agent-1",
        accessType: "write",
        timestamp: now,
      });

      recordResourceAccess({
        resourceId: "project-1:database/table",
        agentId: "agent-2",
        accessType: "read",
        timestamp: now,
      });

      const conflicts = detectResourceContention("project-1");
      expect(conflicts.length).toBeGreaterThan(0);
    });

    test("detects contention with multiple write accesses from different agents", () => {
      const now = new Date();

      recordResourceAccess({
        resourceId: "project-1:database/table",
        agentId: "agent-1",
        accessType: "write",
        timestamp: now,
      });

      recordResourceAccess({
        resourceId: "project-1:database/table",
        agentId: "agent-2",
        accessType: "write",
        timestamp: now,
      });

      const conflicts = detectResourceContention("project-1");
      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0]!.type).toBe("resource_contention");
    });

    test("does not detect contention for same agent multiple accesses", () => {
      const now = new Date();

      recordResourceAccess({
        resourceId: "project-1:api/endpoint",
        agentId: "agent-1",
        accessType: "write",
        timestamp: now,
      });

      recordResourceAccess({
        resourceId: "project-1:api/endpoint",
        agentId: "agent-1",
        accessType: "write",
        timestamp: now,
      });

      const conflicts = detectResourceContention("project-1");
      expect(conflicts).toHaveLength(0);
    });

    test("ignores old accesses outside window", () => {
      const oldTime = new Date(Date.now() - 10000); // 10 seconds ago
      const now = new Date();

      recordResourceAccess({
        resourceId: "project-1:api/users",
        agentId: "agent-1",
        accessType: "exclusive",
        timestamp: oldTime,
      });

      recordResourceAccess({
        resourceId: "project-1:api/users",
        agentId: "agent-2",
        accessType: "exclusive",
        timestamp: now,
      });

      // Using a 5 second window
      const conflicts = detectResourceContention("project-1", 5000);
      expect(conflicts).toHaveLength(0);
    });
  });

  describe("Conflict Management", () => {
    test("tracks active conflicts", () => {
      // Create a conflict
      checkReservationConflicts("project-1", "agent-1", ["src/**/*.ts"], true);
      registerReservation({
        id: "res-1",
        projectId: "project-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });
      checkReservationConflicts("project-1", "agent-2", ["src/**/*.ts"], true);

      const active = getActiveConflicts();
      expect(active.length).toBeGreaterThan(0);
    });

    test("filters conflicts by type", () => {
      // Create reservation conflicts
      registerReservation({
        id: "res-1",
        projectId: "project-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });
      checkReservationConflicts("project-1", "agent-2", ["src/**/*.ts"], true);

      // Create resource contention
      const now = new Date();
      recordResourceAccess({
        resourceId: "project-1:api",
        agentId: "agent-1",
        accessType: "exclusive",
        timestamp: now,
      });
      recordResourceAccess({
        resourceId: "project-1:api",
        agentId: "agent-2",
        accessType: "exclusive",
        timestamp: now,
      });
      detectResourceContention("project-1");

      const reservationConflicts = getActiveConflicts({
        type: ["reservation_overlap"],
      });
      const contentionConflicts = getActiveConflicts({
        type: ["resource_contention"],
      });

      expect(
        reservationConflicts.every((c) => c.type === "reservation_overlap"),
      ).toBe(true);
      expect(
        contentionConflicts.every((c) => c.type === "resource_contention"),
      ).toBe(true);
    });

    test("filters conflicts by severity", () => {
      // Create conflicts with different severities
      registerReservation({
        id: "res-1",
        projectId: "project-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });
      checkReservationConflicts("project-1", "agent-2", ["src/**/*.ts"], true);

      const warningConflicts = getActiveConflicts({
        severity: ["warning"],
      });

      expect(warningConflicts.every((c) => c.severity === "warning")).toBe(
        true,
      );
    });

    test("filters conflicts by project", () => {
      // Create conflicts in different projects
      registerReservation({
        id: "res-1",
        projectId: "project-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });
      checkReservationConflicts("project-1", "agent-2", ["src/**/*.ts"], true);

      registerReservation({
        id: "res-2",
        projectId: "project-2",
        requesterId: "agent-3",
        patterns: ["lib/**/*.ts"],
        exclusive: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });
      checkReservationConflicts("project-2", "agent-4", ["lib/**/*.ts"], true);

      const project1Conflicts = getActiveConflicts({ projectId: "project-1" });
      const project2Conflicts = getActiveConflicts({ projectId: "project-2" });

      expect(project1Conflicts.every((c) => c.projectId === "project-1")).toBe(
        true,
      );
      expect(project2Conflicts.every((c) => c.projectId === "project-2")).toBe(
        true,
      );
    });

    test("gets conflict by ID", () => {
      registerReservation({
        id: "res-1",
        projectId: "project-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });
      const result = checkReservationConflicts(
        "project-1",
        "agent-2",
        ["src/**/*.ts"],
        true,
      );

      const conflictId = result.conflicts[0]!.id;
      const conflict = getConflict(conflictId);

      expect(conflict).toBeDefined();
      expect(conflict!.id).toBe(conflictId);
    });

    test("returns undefined for non-existent conflict", () => {
      const conflict = getConflict("non-existent-id");
      expect(conflict).toBeUndefined();
    });
  });

  describe("Conflict Resolution", () => {
    test("resolves a conflict", () => {
      registerReservation({
        id: "res-1",
        projectId: "project-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });
      const result = checkReservationConflicts(
        "project-1",
        "agent-2",
        ["src/**/*.ts"],
        true,
      );

      const conflictId = result.conflicts[0]!.id;

      const resolved = resolveConflict(conflictId, {
        type: "wait",
        description: "Waiting for existing reservation to expire",
        resolvedBy: "agent-2",
      });

      expect(resolved).toBeDefined();
      expect(resolved!.resolvedAt).toBeDefined();
      expect(resolved!.resolution).toBeDefined();
      expect(resolved!.resolution!.type).toBe("wait");
    });

    test("removes resolved conflict from active list", () => {
      registerReservation({
        id: "res-1",
        projectId: "project-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });
      const result = checkReservationConflicts(
        "project-1",
        "agent-2",
        ["src/**/*.ts"],
        true,
      );

      const conflictId = result.conflicts[0]!.id;
      const beforeCount = getActiveConflicts().length;

      resolveConflict(conflictId, {
        type: "manual",
        description: "Resolved manually",
      });

      const afterCount = getActiveConflicts().length;
      expect(afterCount).toBe(beforeCount - 1);
    });

    test("keeps resolved conflict in history", () => {
      registerReservation({
        id: "res-1",
        projectId: "project-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });
      const result = checkReservationConflicts(
        "project-1",
        "agent-2",
        ["src/**/*.ts"],
        true,
      );

      const conflictId = result.conflicts[0]!.id;

      resolveConflict(conflictId, {
        type: "manual",
        description: "Resolved manually",
      });

      const conflict = getConflict(conflictId);
      expect(conflict).toBeDefined();
      expect(conflict!.resolvedAt).toBeDefined();
    });

    test("returns undefined when resolving non-existent conflict", () => {
      const resolved = resolveConflict("non-existent-id", {
        type: "manual",
        description: "Test",
      });

      expect(resolved).toBeUndefined();
    });
  });

  describe("Recommended Actions", () => {
    test("returns actions for reservation overlap", () => {
      registerReservation({
        id: "res-1",
        projectId: "project-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });
      const result = checkReservationConflicts(
        "project-1",
        "agent-2",
        ["src/**/*.ts"],
        true,
      );

      const conflict = result.conflicts[0]!;
      const actions = getRecommendedActions(conflict);

      expect(actions.length).toBeGreaterThan(0);
      expect(actions.some((a) => a.type === "force")).toBe(true);
    });

    test("returns actions for resource contention", () => {
      const now = new Date();
      recordResourceAccess({
        resourceId: "project-1:api",
        agentId: "agent-1",
        accessType: "exclusive",
        timestamp: now,
      });
      recordResourceAccess({
        resourceId: "project-1:api",
        agentId: "agent-2",
        accessType: "exclusive",
        timestamp: now,
      });

      const conflicts = detectResourceContention("project-1");
      const conflict = conflicts[0]!;
      const actions = getRecommendedActions(conflict);

      expect(actions.length).toBeGreaterThan(0);
      expect(actions.some((a) => a.type === "retry")).toBe(true);
    });
  });

  describe("Conflict History", () => {
    test("tracks conflict history", () => {
      // Create a conflict
      registerReservation({
        id: "res-1",
        projectId: "project-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });
      checkReservationConflicts("project-1", "agent-2", ["src/**/*.ts"], true);

      const { conflicts, total } = getConflictHistory();

      expect(total).toBeGreaterThan(0);
      expect(conflicts.length).toBeGreaterThan(0);
    });

    test("respects limit and offset", () => {
      // Create multiple conflicts
      for (let i = 0; i < 10; i++) {
        registerReservation({
          id: `res-${i}`,
          projectId: `project-${i}`,
          requesterId: `agent-${i}`,
          patterns: ["src/**/*.ts"],
          exclusive: true,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 3600000),
        });
        checkReservationConflicts(
          `project-${i}`,
          `agent-${i + 100}`,
          ["src/**/*.ts"],
          true,
        );
      }

      const { conflicts, total, hasMore } = getConflictHistory(5, 0);

      expect(conflicts.length).toBe(5);
      expect(total).toBe(10);
      expect(hasMore).toBe(true);

      const page2 = getConflictHistory(5, 5);
      expect(page2.conflicts.length).toBe(5);
      expect(page2.hasMore).toBe(false);
    });
  });

  describe("Statistics", () => {
    test("returns correct statistics", () => {
      // Create some conflicts
      registerReservation({
        id: "res-1",
        projectId: "project-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });
      checkReservationConflicts("project-1", "agent-2", ["src/**/*.ts"], true);

      const stats = getConflictStats();

      expect(stats.activeCount).toBeGreaterThan(0);
      expect(stats.byType.reservation_overlap).toBeGreaterThan(0);
      expect(stats.bySeverity.warning).toBeGreaterThan(0);
    });

    test("tracks resolved conflicts in last 24h", () => {
      registerReservation({
        id: "res-1",
        projectId: "project-1",
        requesterId: "agent-1",
        patterns: ["src/**/*.ts"],
        exclusive: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });
      const result = checkReservationConflicts(
        "project-1",
        "agent-2",
        ["src/**/*.ts"],
        true,
      );

      // Resolve the conflict
      resolveConflict(result.conflicts[0]!.id, {
        type: "manual",
        description: "Test",
      });

      const stats = getConflictStats();
      expect(stats.resolved24h).toBe(1);
    });
  });

  describe("Alert Configuration", () => {
    test("returns default configuration", () => {
      const config = getAlertConfig();

      expect(config.minSeverity).toBe("warning");
      expect(config.cooldownMs).toBe(60000);
      expect(config.escalationTimeoutMs).toBe(300000);
    });

    test("updates configuration", () => {
      const updated = updateAlertConfig({
        minSeverity: "error",
        cooldownMs: 30000,
      });

      expect(updated.minSeverity).toBe("error");
      expect(updated.cooldownMs).toBe(30000);
      expect(updated.escalationTimeoutMs).toBe(300000); // unchanged
    });
  });
});
