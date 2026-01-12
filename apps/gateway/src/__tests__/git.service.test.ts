import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  assignBranch,
  coordinateSync,
  getAssignment,
  getBranchAssignments,
  getGitGraph,
  getGitStats,
  getMergeBase,
  getOverlappingFiles,
  predictConflicts,
  recordSyncResult,
  releaseBranch,
  renewAssignment,
  updateAssignmentStatus,
  _clearAllGitData,
  type BranchAssignment,
} from "../services/git.service";

describe("Git Coordination Service", () => {
  beforeEach(() => {
    _clearAllGitData();
  });

  afterEach(() => {
    _clearAllGitData();
  });

  describe("assignBranch", () => {
    test("creates a new branch assignment", async () => {
      const result = await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/test",
        baseBranch: "main",
      });

      expect(result.granted).toBe(true);
      expect(result.assignment).not.toBeNull();
      expect(result.assignment?.branchName).toBe("feature/test");
      expect(result.assignment?.agentId).toBe("agent-1");
      expect(result.assignment?.status).toBe("active");
    });

    test("allows same agent to reassign same branch", async () => {
      const first = await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/test",
      });

      const second = await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/test",
      });

      expect(second.granted).toBe(true);
      expect(second.assignment?.id).toBe(first.assignment?.id);
    });

    test("prevents different agent from taking assigned branch", async () => {
      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/test",
      });

      const result = await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-2",
        branchName: "feature/test",
      });

      expect(result.granted).toBe(false);
      expect(result.error).toContain("already assigned");
      expect(result.existingAssignment).toBeDefined();
    });

    test("allows different agents for different branches", async () => {
      const first = await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/a",
      });

      const second = await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-2",
        branchName: "feature/b",
      });

      expect(first.granted).toBe(true);
      expect(second.granted).toBe(true);
    });

    test("caps TTL at maximum value", async () => {
      const result = await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/test",
        ttlMs: 24 * 60 * 60 * 1000, // 24 hours (over max)
      });

      expect(result.granted).toBe(true);
      // Max is 4 hours
      const maxTtl = 4 * 60 * 60 * 1000;
      const actualTtl =
        result.assignment!.expiresAt.getTime() -
        result.assignment!.assignedAt.getTime();
      expect(actualTtl).toBeLessThanOrEqual(maxTtl + 1000); // 1s tolerance
    });

    test("stores metadata in assignment", async () => {
      const result = await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/test",
        taskId: "task-123",
        taskDescription: "Implement new feature",
        reservedPatterns: ["src/**/*.ts"],
      });

      expect(result.assignment?.metadata.taskId).toBe("task-123");
      expect(result.assignment?.metadata.taskDescription).toBe(
        "Implement new feature",
      );
      expect(result.assignment?.metadata.reservedPatterns).toEqual([
        "src/**/*.ts",
      ]);
    });

    test("rejects empty branch name", async () => {
      const result = await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "",
      });

      expect(result.granted).toBe(false);
      expect(result.error).toBe("Branch name is required");
    });
  });

  describe("releaseBranch", () => {
    test("releases an assignment by specific branch", async () => {
      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/test",
      });

      const result = await releaseBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/test",
      });

      expect(result.released).toBe(true);
      expect(result.releasedAssignments.length).toBe(1);
    });

    test("releases all assignments for agent when no branch specified", async () => {
      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/a",
      });

      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/b",
      });

      const result = await releaseBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
      });

      expect(result.released).toBe(true);
      expect(result.releasedAssignments.length).toBe(2);
    });

    test("returns error for non-existent branch assignment", async () => {
      const result = await releaseBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "nonexistent",
      });

      expect(result.released).toBe(false);
      expect(result.error).toBe("No matching assignment found");
    });

    test("does not release other agent's assignments", async () => {
      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/test",
      });

      const result = await releaseBranch({
        repositoryId: "repo-1",
        agentId: "agent-2",
        branchName: "feature/test",
      });

      expect(result.released).toBe(false);

      // Verify still assigned to agent-1
      const assignments = await getBranchAssignments("repo-1");
      expect(assignments.length).toBe(1);
      expect(assignments[0]?.agentId).toBe("agent-1");
    });
  });

  describe("renewAssignment", () => {
    test("extends assignment expiration", async () => {
      const { assignment } = await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/test",
      });

      const originalExpiry = assignment!.expiresAt;

      const result = await renewAssignment({
        assignmentId: assignment!.id,
        agentId: "agent-1",
        additionalTtlMs: 30 * 60 * 1000, // 30 minutes
      });

      expect(result.renewed).toBe(true);
      expect(result.newExpiresAt!.getTime()).toBeGreaterThan(
        originalExpiry.getTime(),
      );
    });

    test("rejects renewal by non-holder", async () => {
      const { assignment } = await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/test",
      });

      const result = await renewAssignment({
        assignmentId: assignment!.id,
        agentId: "agent-2",
      });

      expect(result.renewed).toBe(false);
      expect(result.error).toContain("does not hold");
    });

    test("returns error for non-existent assignment", async () => {
      const result = await renewAssignment({
        assignmentId: "nonexistent",
        agentId: "agent-1",
      });

      expect(result.renewed).toBe(false);
      expect(result.error).toBe("Assignment not found");
    });
  });

  describe("getBranchAssignments", () => {
    test("returns all active assignments for repository", async () => {
      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/a",
      });

      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-2",
        branchName: "feature/b",
      });

      const assignments = await getBranchAssignments("repo-1");

      expect(assignments.length).toBe(2);
    });

    test("filters by agentId", async () => {
      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/a",
      });

      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-2",
        branchName: "feature/b",
      });

      const assignments = await getBranchAssignments("repo-1", {
        agentId: "agent-1",
      });

      expect(assignments.length).toBe(1);
      expect(assignments[0]?.agentId).toBe("agent-1");
    });

    test("returns empty array for repository with no assignments", async () => {
      const assignments = await getBranchAssignments("repo-1");
      expect(assignments).toEqual([]);
    });
  });

  describe("updateAssignmentStatus", () => {
    test("updates status to merged", async () => {
      const { assignment } = await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/test",
      });

      const updated = await updateAssignmentStatus(
        assignment!.id,
        "merged",
        "agent-1",
      );

      expect(updated).toBe(true);

      const current = await getAssignment(assignment!.id);
      expect(current?.status).toBe("merged");
    });

    test("rejects status update by non-holder", async () => {
      const { assignment } = await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/test",
      });

      const updated = await updateAssignmentStatus(
        assignment!.id,
        "merged",
        "agent-2",
      );

      expect(updated).toBe(false);
    });
  });

  describe("predictConflicts", () => {
    test("returns no conflicts for branches without overlapping patterns", async () => {
      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/a",
        reservedPatterns: ["src/a/**"],
      });

      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-2",
        branchName: "feature/b",
        reservedPatterns: ["src/b/**"],
      });

      const prediction = await predictConflicts({
        repositoryId: "repo-1",
        branchA: "feature/a",
        branchB: "feature/b",
      });

      expect(prediction.hasConflicts).toBe(false);
      expect(prediction.severity).toBe("none");
    });

    test("detects conflicts for overlapping patterns", async () => {
      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/a",
        reservedPatterns: ["src/shared/**", "src/utils/**"],
      });

      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-2",
        branchName: "feature/b",
        reservedPatterns: ["src/shared/**", "src/models/**"],
      });

      const prediction = await predictConflicts({
        repositoryId: "repo-1",
        branchA: "feature/a",
        branchB: "feature/b",
      });

      expect(prediction.hasConflicts).toBe(true);
      expect(prediction.conflictingFiles).toContain("src/shared/**");
    });

    test("caches predictions for 5 minutes", async () => {
      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/a",
        reservedPatterns: ["src/**"],
      });

      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-2",
        branchName: "feature/b",
        reservedPatterns: ["src/**"],
      });

      const first = await predictConflicts({
        repositoryId: "repo-1",
        branchA: "feature/a",
        branchB: "feature/b",
      });

      const second = await predictConflicts({
        repositoryId: "repo-1",
        branchA: "feature/a",
        branchB: "feature/b",
      });

      // Same prediction ID means it was cached
      expect(second.id).toBe(first.id);
    });
  });

  describe("getOverlappingFiles", () => {
    test("finds overlapping reserved patterns", async () => {
      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/a",
        reservedPatterns: ["src/shared/**", "src/utils/**"],
      });

      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-2",
        branchName: "feature/b",
        reservedPatterns: ["src/shared/**", "src/models/**"],
      });

      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-3",
        branchName: "feature/c",
        reservedPatterns: ["src/shared/**"],
      });

      const report = await getOverlappingFiles({
        repositoryId: "repo-1",
        branches: ["feature/a", "feature/b", "feature/c"],
      });

      expect(report.overlappingFiles.length).toBeGreaterThan(0);
      const sharedFile = report.overlappingFiles.find(
        (f) => f.path === "src/shared/**",
      );
      expect(sharedFile?.modifiedIn.length).toBe(3);
      expect(sharedFile?.risk).toBe("high");
    });
  });

  describe("getMergeBase", () => {
    test("returns merge base info", async () => {
      const info = await getMergeBase("repo-1", "feature/test", "main");

      expect(info.branch).toBe("feature/test");
      expect(info.target).toBe("main");
      expect(info.mergeBase).toBeDefined();
    });

    test("caches merge base for 1 minute", async () => {
      const first = await getMergeBase("repo-1", "feature/test", "main");
      const second = await getMergeBase("repo-1", "feature/test", "main");

      expect(first.lastChecked.getTime()).toBe(second.lastChecked.getTime());
    });
  });

  describe("coordinateSync", () => {
    test("approves sync for agent with assignment", async () => {
      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/test",
      });

      const result = await coordinateSync("repo-1", "agent-1", {
        type: "push",
        branch: "feature/test",
      });

      expect(result.approved).toBe(true);
    });

    test("rejects push without assignment", async () => {
      const result = await coordinateSync("repo-1", "agent-1", {
        type: "push",
        branch: "feature/test",
      });

      expect(result.approved).toBe(false);
      expect(result.error).toContain("does not have branch assignment");
    });

    test("approves pull without assignment but adds recommendation", async () => {
      const result = await coordinateSync("repo-1", "agent-1", {
        type: "pull",
        branch: "feature/test",
      });

      expect(result.approved).toBe(true);
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    test("adds warning for force operations", async () => {
      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/test",
      });

      const result = await coordinateSync("repo-1", "agent-1", {
        type: "push",
        branch: "feature/test",
        force: true,
      });

      expect(result.approved).toBe(true);
      expect(result.warnings.some((w) => w.includes("Force"))).toBe(true);
    });
  });

  describe("recordSyncResult", () => {
    test("updates assignment activity on sync", async () => {
      const { assignment } = await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/test",
      });

      const originalActivity = assignment!.lastActivityAt;

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      await recordSyncResult("repo-1", "agent-1", {
        success: true,
        operation: { type: "push", branch: "feature/test" },
        filesChanged: 5,
        duration: 1000,
      });

      const updated = await getAssignment(assignment!.id);
      expect(updated!.lastActivityAt.getTime()).toBeGreaterThan(
        originalActivity.getTime(),
      );
    });
  });

  describe("getGitGraph", () => {
    test("returns graph with assigned branches", async () => {
      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/test",
      });

      const graph = await getGitGraph("repo-1");

      expect(graph.branches.length).toBeGreaterThan(0);
      const featureBranch = graph.branches.find(
        (b) => b.name === "feature/test",
      );
      expect(featureBranch?.assignedTo).toBe("agent-1");
    });

    test("always includes main branch", async () => {
      const graph = await getGitGraph("repo-1");

      const mainBranch = graph.branches.find((b) => b.name === "main");
      expect(mainBranch).toBeDefined();
      expect(mainBranch?.isDefault).toBe(true);
    });
  });

  describe("getGitStats", () => {
    test("returns accurate statistics", async () => {
      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-1",
        branchName: "feature/a",
      });

      await assignBranch({
        repositoryId: "repo-1",
        agentId: "agent-2",
        branchName: "feature/b",
      });

      await assignBranch({
        repositoryId: "repo-2",
        agentId: "agent-3",
        branchName: "feature/c",
      });

      const stats = getGitStats();

      expect(stats.totalActiveAssignments).toBe(3);
      expect(stats.byRepository["repo-1"]).toBe(2);
      expect(stats.byRepository["repo-2"]).toBe(1);
      expect(stats.byStatus.active).toBe(3);
    });
  });
});
