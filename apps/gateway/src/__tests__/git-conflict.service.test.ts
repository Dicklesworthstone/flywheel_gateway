import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  analyzeRepositoryConflicts,
  clearBranchChanges,
  getAnalysisHistory,
  getBranchChanges,
  getConflictPatterns,
  getConflictStats,
  isConflictProneFile,
  registerBranchChanges,
  wouldFilesConflict,
  _clearAllConflictData,
  type BranchChanges,
  type FileChange,
} from "../services/git-conflict.service";

describe("Git Conflict Prediction Service", () => {
  beforeEach(() => {
    _clearAllConflictData();
  });

  afterEach(() => {
    _clearAllConflictData();
  });

  describe("registerBranchChanges", () => {
    test("stores branch changes in cache", async () => {
      const changes: BranchChanges = {
        branchName: "feature/test",
        baseBranch: "main",
        commitCount: 3,
        files: [
          {
            path: "src/index.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
        ],
        lastUpdated: new Date(),
      };

      await registerBranchChanges("repo-1", changes);

      const retrieved = await getBranchChanges("repo-1", "feature/test");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.branchName).toBe("feature/test");
      expect(retrieved?.files.length).toBe(1);
    });

    test("overwrites previous changes for same branch", async () => {
      const changes1: BranchChanges = {
        branchName: "feature/test",
        baseBranch: "main",
        commitCount: 3,
        files: [
          {
            path: "src/a.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
        ],
        lastUpdated: new Date(),
      };

      const changes2: BranchChanges = {
        branchName: "feature/test",
        baseBranch: "main",
        commitCount: 5,
        files: [
          {
            path: "src/b.ts",
            changeType: "added",
            linesAdded: 20,
            linesDeleted: 0,
            isBinary: false,
          },
        ],
        lastUpdated: new Date(),
      };

      await registerBranchChanges("repo-1", changes1);
      await registerBranchChanges("repo-1", changes2);

      const retrieved = await getBranchChanges("repo-1", "feature/test");
      expect(retrieved?.commitCount).toBe(5);
      expect(retrieved?.files[0]?.path).toBe("src/b.ts");
    });
  });

  describe("analyzeRepositoryConflicts", () => {
    test("detects no conflicts when branches modify different files", async () => {
      await registerBranchChanges("repo-1", {
        branchName: "feature/a",
        baseBranch: "main",
        commitCount: 2,
        files: [
          {
            path: "src/a.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
        ],
        lastUpdated: new Date(),
      });

      await registerBranchChanges("repo-1", {
        branchName: "feature/b",
        baseBranch: "main",
        commitCount: 3,
        files: [
          {
            path: "src/b.ts",
            changeType: "modified",
            linesAdded: 15,
            linesDeleted: 3,
            isBinary: false,
          },
        ],
        lastUpdated: new Date(),
      });

      const analysis = await analyzeRepositoryConflicts("repo-1");

      expect(analysis.conflicts.length).toBe(0);
      expect(analysis.overallSeverity).toBe("low");
    });

    test("detects conflicts when branches modify same file", async () => {
      await registerBranchChanges("repo-1", {
        branchName: "feature/a",
        baseBranch: "main",
        commitCount: 2,
        files: [
          {
            path: "src/shared.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
        ],
        lastUpdated: new Date(),
      });

      await registerBranchChanges("repo-1", {
        branchName: "feature/b",
        baseBranch: "main",
        commitCount: 3,
        files: [
          {
            path: "src/shared.ts",
            changeType: "modified",
            linesAdded: 20,
            linesDeleted: 8,
            isBinary: false,
          },
        ],
        lastUpdated: new Date(),
      });

      const analysis = await analyzeRepositoryConflicts("repo-1");

      expect(analysis.conflicts.length).toBe(1);
      expect(analysis.conflicts[0]?.file).toBe("src/shared.ts");
    });

    test("assigns high severity to delete/modify conflicts", async () => {
      await registerBranchChanges("repo-1", {
        branchName: "feature/a",
        baseBranch: "main",
        commitCount: 1,
        files: [
          {
            path: "src/deprecated.ts",
            changeType: "deleted",
            linesAdded: 0,
            linesDeleted: 100,
            isBinary: false,
          },
        ],
        lastUpdated: new Date(),
      });

      await registerBranchChanges("repo-1", {
        branchName: "feature/b",
        baseBranch: "main",
        commitCount: 2,
        files: [
          {
            path: "src/deprecated.ts",
            changeType: "modified",
            linesAdded: 5,
            linesDeleted: 2,
            isBinary: false,
          },
        ],
        lastUpdated: new Date(),
      });

      const analysis = await analyzeRepositoryConflicts("repo-1");

      expect(analysis.conflicts.length).toBe(1);
      expect(analysis.conflicts[0]?.severity).toBe("critical");
    });

    test("assigns high severity to add/add conflicts", async () => {
      await registerBranchChanges("repo-1", {
        branchName: "feature/a",
        baseBranch: "main",
        commitCount: 1,
        files: [
          {
            path: "src/new-feature.ts",
            changeType: "added",
            linesAdded: 50,
            linesDeleted: 0,
            isBinary: false,
          },
        ],
        lastUpdated: new Date(),
      });

      await registerBranchChanges("repo-1", {
        branchName: "feature/b",
        baseBranch: "main",
        commitCount: 1,
        files: [
          {
            path: "src/new-feature.ts",
            changeType: "added",
            linesAdded: 30,
            linesDeleted: 0,
            isBinary: false,
          },
        ],
        lastUpdated: new Date(),
      });

      const analysis = await analyzeRepositoryConflicts("repo-1");

      expect(analysis.conflicts.length).toBe(1);
      expect(analysis.conflicts[0]?.severity).toBe("high");
    });

    test("filters analysis to specific branches", async () => {
      await registerBranchChanges("repo-1", {
        branchName: "feature/a",
        baseBranch: "main",
        commitCount: 1,
        files: [
          {
            path: "src/shared.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
        ],
        lastUpdated: new Date(),
      });

      await registerBranchChanges("repo-1", {
        branchName: "feature/b",
        baseBranch: "main",
        commitCount: 1,
        files: [
          {
            path: "src/shared.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
        ],
        lastUpdated: new Date(),
      });

      await registerBranchChanges("repo-1", {
        branchName: "feature/c",
        baseBranch: "main",
        commitCount: 1,
        files: [
          {
            path: "src/shared.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
        ],
        lastUpdated: new Date(),
      });

      const analysis = await analyzeRepositoryConflicts("repo-1", [
        "feature/a",
        "feature/b",
      ]);

      // Only 1 conflict between a and b, not involving c
      expect(analysis.branchPairs.length).toBe(1);
    });

    test("generates appropriate recommendations", async () => {
      await registerBranchChanges("repo-1", {
        branchName: "feature/a",
        baseBranch: "main",
        commitCount: 1,
        files: [
          {
            path: "src/file1.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
          {
            path: "src/file2.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
          {
            path: "src/file3.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
          {
            path: "src/file4.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
          {
            path: "src/file5.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
          {
            path: "src/file6.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
        ],
        lastUpdated: new Date(),
      });

      await registerBranchChanges("repo-1", {
        branchName: "feature/b",
        baseBranch: "main",
        commitCount: 1,
        files: [
          {
            path: "src/file1.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
          {
            path: "src/file2.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
          {
            path: "src/file3.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
          {
            path: "src/file4.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
          {
            path: "src/file5.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
          {
            path: "src/file6.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
        ],
        lastUpdated: new Date(),
      });

      const analysis = await analyzeRepositoryConflicts("repo-1");

      // Should recommend smaller branches for many conflicts
      expect(analysis.recommendations.some((r) => r.includes("smaller"))).toBe(
        true,
      );
    });
  });

  describe("getAnalysisHistory", () => {
    test("stores analysis history", async () => {
      await registerBranchChanges("repo-1", {
        branchName: "feature/a",
        baseBranch: "main",
        commitCount: 1,
        files: [],
        lastUpdated: new Date(),
      });

      await analyzeRepositoryConflicts("repo-1");
      await analyzeRepositoryConflicts("repo-1");
      await analyzeRepositoryConflicts("repo-1");

      const history = await getAnalysisHistory("repo-1");

      expect(history.length).toBe(3);
    });

    test("limits history size", async () => {
      await registerBranchChanges("repo-1", {
        branchName: "feature/a",
        baseBranch: "main",
        commitCount: 1,
        files: [],
        lastUpdated: new Date(),
      });

      const history = await getAnalysisHistory("repo-1", 2);
      expect(history.length).toBeLessThanOrEqual(2);
    });
  });

  describe("clearBranchChanges", () => {
    test("clears specific branch changes", async () => {
      await registerBranchChanges("repo-1", {
        branchName: "feature/a",
        baseBranch: "main",
        commitCount: 1,
        files: [],
        lastUpdated: new Date(),
      });

      await registerBranchChanges("repo-1", {
        branchName: "feature/b",
        baseBranch: "main",
        commitCount: 1,
        files: [],
        lastUpdated: new Date(),
      });

      const cleared = await clearBranchChanges("repo-1", "feature/a");

      expect(cleared).toBe(1);
      expect(await getBranchChanges("repo-1", "feature/a")).toBeNull();
      expect(await getBranchChanges("repo-1", "feature/b")).not.toBeNull();
    });

    test("clears all repository changes when no branch specified", async () => {
      await registerBranchChanges("repo-1", {
        branchName: "feature/a",
        baseBranch: "main",
        commitCount: 1,
        files: [],
        lastUpdated: new Date(),
      });

      await registerBranchChanges("repo-1", {
        branchName: "feature/b",
        baseBranch: "main",
        commitCount: 1,
        files: [],
        lastUpdated: new Date(),
      });

      const cleared = await clearBranchChanges("repo-1");

      expect(cleared).toBe(2);
      expect(await getBranchChanges("repo-1", "feature/a")).toBeNull();
      expect(await getBranchChanges("repo-1", "feature/b")).toBeNull();
    });
  });

  describe("wouldFilesConflict", () => {
    test("detects overlapping files", () => {
      const result = wouldFilesConflict(
        ["src/a.ts", "src/shared.ts", "src/b.ts"],
        ["src/shared.ts", "src/c.ts"],
      );

      expect(result.hasConflict).toBe(true);
      expect(result.overlapping).toEqual(["src/shared.ts"]);
    });

    test("returns no conflict for disjoint files", () => {
      const result = wouldFilesConflict(
        ["src/a.ts", "src/b.ts"],
        ["src/c.ts", "src/d.ts"],
      );

      expect(result.hasConflict).toBe(false);
      expect(result.overlapping).toEqual([]);
    });
  });

  describe("isConflictProneFile", () => {
    test("identifies lock files as conflict-prone", () => {
      expect(isConflictProneFile("package-lock.json").isProne).toBe(true);
      expect(isConflictProneFile("yarn.lock").isProne).toBe(true);
      expect(isConflictProneFile("bun.lockb").isProne).toBe(true);
    });

    test("identifies minified files as conflict-prone", () => {
      expect(isConflictProneFile("dist/bundle.min.js").isProne).toBe(true);
      expect(isConflictProneFile("dist/styles.min.css").isProne).toBe(true);
    });

    test("identifies schema files as conflict-prone", () => {
      expect(isConflictProneFile("src/db/schema.ts").isProne).toBe(true);
    });

    test("identifies index/barrel files as conflict-prone", () => {
      expect(isConflictProneFile("src/index.ts").isProne).toBe(true);
    });

    test("identifies route files as conflict-prone", () => {
      expect(isConflictProneFile("src/routes.ts").isProne).toBe(true);
      expect(isConflictProneFile("src/router.tsx").isProne).toBe(true);
    });

    test("returns not prone for regular files", () => {
      expect(isConflictProneFile("src/components/Button.tsx").isProne).toBe(
        false,
      );
      expect(isConflictProneFile("src/utils/helpers.ts").isProne).toBe(false);
    });
  });

  describe("getConflictPatterns", () => {
    test("tracks conflict patterns from analysis", async () => {
      await registerBranchChanges("repo-1", {
        branchName: "feature/a",
        baseBranch: "main",
        commitCount: 1,
        files: [
          {
            path: "src/services/auth.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
        ],
        lastUpdated: new Date(),
      });

      await registerBranchChanges("repo-1", {
        branchName: "feature/b",
        baseBranch: "main",
        commitCount: 1,
        files: [
          {
            path: "src/services/auth.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
        ],
        lastUpdated: new Date(),
      });

      await analyzeRepositoryConflicts("repo-1");

      const patterns = await getConflictPatterns("repo-1");

      expect(patterns.length).toBeGreaterThan(0);
    });
  });

  describe("getConflictStats", () => {
    test("returns statistics about conflict tracking", async () => {
      await registerBranchChanges("repo-1", {
        branchName: "feature/a",
        baseBranch: "main",
        commitCount: 1,
        files: [
          {
            path: "src/shared.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
        ],
        lastUpdated: new Date(),
      });

      await registerBranchChanges("repo-1", {
        branchName: "feature/b",
        baseBranch: "main",
        commitCount: 1,
        files: [
          {
            path: "src/shared.ts",
            changeType: "modified",
            linesAdded: 10,
            linesDeleted: 5,
            isBinary: false,
          },
        ],
        lastUpdated: new Date(),
      });

      await analyzeRepositoryConflicts("repo-1");

      const stats = getConflictStats();

      expect(stats.cachedBranchChanges).toBe(2);
      expect(stats.analysisHistorySize).toBeGreaterThan(0);
    });
  });
});
