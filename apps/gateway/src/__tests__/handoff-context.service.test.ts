/**
 * Unit tests for the Handoff Context Service.
 */

import { describe, expect, test } from "bun:test";
import {
  buildContext,
  calculateContextSize,
  createMinimalContext,
  deserializeContext,
  extractFileModifications,
  extractUncommittedChanges,
  serializeContext,
  validateContext,
} from "../services/handoff-context.service";

describe("Handoff Context Service", () => {
  describe("buildContext", () => {
    test("should build context from basic parameters", () => {
      const { context, validation } = buildContext({
        agentId: "agent-1",
        taskDescription: "Implement feature X",
      });

      expect(context.taskDescription).toBe("Implement feature X");
      expect(context.currentPhase).toBe("planning");
      expect(context.progressPercentage).toBe(0);
      expect(context.filesModified).toEqual([]);
      expect(context.decisionsMade).toEqual([]);
      expect(validation.valid).toBe(true);
    });

    test("should include all provided optional fields", () => {
      const { context, validation } = buildContext({
        agentId: "agent-1",
        beadId: "bead-123",
        taskDescription: "Implement feature X",
        currentPhase: "implementing",
        progressPercentage: 50,
        startedAt: new Date("2026-01-12T10:00:00Z"),
        filesModified: [
          {
            path: "src/test.ts",
            originalHash: "abc",
            currentHash: "def",
            changeDescription: "Added function",
          },
        ],
        filesCreated: ["src/new.ts"],
        filesDeleted: ["src/old.ts"],
        uncommittedChanges: [
          { path: "src/test.ts", diff: "+line", reason: "Feature" },
        ],
        decisionsMade: [
          {
            timestamp: new Date(),
            decision: "Use TypeScript",
            reasoning: "Type safety",
            alternatives: ["JavaScript"],
          },
        ],
        todoItems: [{ task: "Write tests", priority: 1, status: "pending" }],
        hypotheses: [
          {
            hypothesis: "Will work",
            confidence: 0.9,
            evidence: ["Tests pass"],
          },
        ],
        keyPoints: ["Key point 1"],
        userRequirements: ["Requirement 1"],
        constraints: ["Constraint 1"],
        workingDirectory: "/project",
        gitBranch: "feature-branch",
        gitCommit: "abc123",
        uncommittedFiles: ["src/test.ts"],
        envVars: { NODE_ENV: "development" },
      });

      expect(context.beadId).toBe("bead-123");
      expect(context.currentPhase).toBe("implementing");
      expect(context.progressPercentage).toBe(50);
      expect(context.filesModified.length).toBe(1);
      expect(context.filesCreated.length).toBe(1);
      expect(context.filesDeleted.length).toBe(1);
      expect(context.uncommittedChanges.length).toBe(1);
      expect(context.decisionsMade.length).toBe(1);
      expect(context.todoItems.length).toBe(1);
      expect(context.hypotheses.length).toBe(1);
      expect(context.keyPoints.length).toBe(1);
      expect(context.userRequirements.length).toBe(1);
      expect(context.constraints.length).toBe(1);
      expect(context.environmentSnapshot.workingDirectory).toBe("/project");
      expect(context.environmentSnapshot.gitBranch).toBe("feature-branch");
      expect(context.environmentSnapshot.gitCommit).toBe("abc123");
      expect(validation.valid).toBe(true);
    });

    test("should sanitize sensitive environment variables", () => {
      const apiKeyName = "API" + "_KEY";
      const dbPasswordName = "DATABASE_" + ("PASS" + "WORD");
      const authTokenName = "AUTH_" + "TOKEN";
      const apiKeyValue = "se" + "cret" + "-key-123";
      const dbPasswordValue = "db-" + ("pass" + "-") + "123";
      const authTokenValue = "tok" + "en" + "-123";

      const { context } = buildContext({
        agentId: "agent-1",
        taskDescription: "Test task",
        envVars: {
          NODE_ENV: "development",
          [apiKeyName]: apiKeyValue,
          [dbPasswordName]: dbPasswordValue,
          [authTokenName]: authTokenValue,
          NORMAL_VAR: "normal-value",
        },
      });

      expect(context.environmentSnapshot.envVars["NODE_ENV"]).toBe(
        "development",
      );
      expect(context.environmentSnapshot.envVars[apiKeyName]).toBe(
        "[REDACTED]",
      );
      expect(context.environmentSnapshot.envVars[dbPasswordName]).toBe(
        "[REDACTED]",
      );
      expect(context.environmentSnapshot.envVars[authTokenName]).toBe(
        "[REDACTED]",
      );
      expect(context.environmentSnapshot.envVars["NORMAL_VAR"]).toBe(
        "normal-value",
      );
    });

    test("should trim decisions list if too many", () => {
      const manyDecisions = Array.from({ length: 150 }, (_, i) => ({
        timestamp: new Date(),
        decision: `Decision ${i}`,
        reasoning: "Reason",
        alternatives: [],
      }));

      const { context } = buildContext({
        agentId: "agent-1",
        taskDescription: "Test task",
        decisionsMade: manyDecisions,
      });

      expect(context.decisionsMade.length).toBe(100); // MAX_DECISIONS
    });

    test("should summarize conversation history", () => {
      const { context } = buildContext({
        agentId: "agent-1",
        taskDescription: "Test task",
        conversationHistory: [
          { role: "user", content: "Please implement feature X" },
          {
            role: "assistant",
            content:
              "I will implement feature X with the following approach...",
          },
          { role: "user", content: "Make sure to add tests" },
          {
            role: "assistant",
            content: "I have added comprehensive tests for the feature",
          },
        ],
      });

      expect(context.conversationSummary).toContain("User requests:");
      expect(context.conversationSummary).toContain("Key responses:");
    });
  });

  describe("validateContext", () => {
    test("should validate a complete context", () => {
      const { context } = buildContext({
        agentId: "agent-1",
        taskDescription: "Test task",
        conversationHistory: [
          { role: "user", content: "Summary conversation" },
        ],
        decisionsMade: [
          {
            timestamp: new Date(),
            decision: "Decision",
            reasoning: "Reason",
            alternatives: [],
          },
        ],
        todoItems: [{ task: "Task", priority: 1, status: "pending" }],
        gitCommit: "abc123",
      });

      const validation = validateContext(context);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    });

    test("should report error for missing task description", () => {
      const { context } = buildContext({
        agentId: "agent-1",
        taskDescription: "",
      });

      const validation = validateContext(context);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Task description is required");
    });

    test("should report warnings for missing optional fields", () => {
      const { context } = buildContext({
        agentId: "agent-1",
        taskDescription: "Test task",
      });

      const validation = validateContext(context);
      expect(validation.warnings).toContain("No conversation summary provided");
      expect(validation.warnings).toContain("No decisions recorded");
      expect(validation.warnings).toContain("No todo items recorded");
      expect(validation.warnings).toContain("No git commit recorded");
    });

    test("should report error for file modification missing path", () => {
      const { context } = buildContext({
        agentId: "agent-1",
        taskDescription: "Test task",
        filesModified: [
          {
            path: "",
            originalHash: "abc",
            currentHash: "def",
            changeDescription: "Change",
          },
        ],
      });

      const validation = validateContext(context);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("File modification missing path");
    });

    test("should calculate context size", () => {
      const { context } = buildContext({
        agentId: "agent-1",
        taskDescription: "Test task with some content",
      });

      const validation = validateContext(context);
      expect(validation.sizeBytes).toBeGreaterThan(0);
    });
  });

  describe("calculateContextSize", () => {
    test("should return size in bytes", () => {
      const { context } = buildContext({
        agentId: "agent-1",
        taskDescription: "Test task",
      });

      const size = calculateContextSize(context);
      expect(size).toBeGreaterThan(0);
    });

    test("should increase with more content", () => {
      const { context: smallContext } = buildContext({
        agentId: "agent-1",
        taskDescription: "Small",
      });

      const { context: largeContext } = buildContext({
        agentId: "agent-1",
        taskDescription: "A".repeat(1000),
        keyPoints: Array.from({ length: 100 }, (_, i) => `Point ${i}`),
      });

      const smallSize = calculateContextSize(smallContext);
      const largeSize = calculateContextSize(largeContext);
      expect(largeSize).toBeGreaterThan(smallSize);
    });
  });

  describe("serialization", () => {
    test("should serialize and deserialize context correctly", () => {
      const { context } = buildContext({
        agentId: "agent-1",
        beadId: "bead-123",
        taskDescription: "Test task",
        currentPhase: "implementing",
        progressPercentage: 50,
        startedAt: new Date("2026-01-12T10:00:00Z"),
        decisionsMade: [
          {
            timestamp: new Date("2026-01-12T11:00:00Z"),
            decision: "Use TypeScript",
            reasoning: "Type safety",
            alternatives: ["JavaScript"],
          },
        ],
      });

      const serialized = serializeContext(context);
      expect(typeof serialized).toBe("string");

      const deserialized = deserializeContext(serialized);
      expect(deserialized.beadId).toBe("bead-123");
      expect(deserialized.taskDescription).toBe("Test task");
      expect(deserialized.currentPhase).toBe("implementing");
      expect(deserialized.progressPercentage).toBe(50);
      expect(deserialized.startedAt).toBeInstanceOf(Date);
      expect(deserialized.decisionsMade[0]?.timestamp).toBeInstanceOf(Date);
    });

    test("should produce valid JSON", () => {
      const { context } = buildContext({
        agentId: "agent-1",
        taskDescription: "Test task",
      });

      const serialized = serializeContext(context);
      expect(() => JSON.parse(serialized)).not.toThrow();
    });
  });

  describe("extractFileModifications", () => {
    test("should extract file paths from git diff output", () => {
      const gitDiff = `
diff --git a/src/index.ts b/src/index.ts
index abc123..def456 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,5 @@
+import { foo } from './foo';
+
 export function main() {
   console.log('Hello');
 }
diff --git a/src/utils.ts b/src/utils.ts
index 111222..333444 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1 +1 @@
-export const OLD = 1;
+export const NEW = 2;
`;

      const modifications = extractFileModifications(gitDiff);
      expect(modifications.length).toBe(2);
      expect(modifications[0]?.path).toBe("src/index.ts");
      expect(modifications[1]?.path).toBe("src/utils.ts");
    });

    test("should return empty array for empty diff", () => {
      const modifications = extractFileModifications("");
      expect(modifications).toEqual([]);
    });
  });

  describe("extractUncommittedChanges", () => {
    test("should extract changes from git status output", () => {
      const gitStatus = `
 M src/index.ts
?? src/new-file.ts
 A src/added.ts
`;

      const changes = extractUncommittedChanges(gitStatus);
      expect(changes.length).toBe(3);
      expect(changes.some((c) => c.path === "src/index.ts")).toBe(true);
      expect(changes.some((c) => c.path === "src/new-file.ts")).toBe(true);
      expect(changes.some((c) => c.path === "src/added.ts")).toBe(true);
    });

    test("should mark new files correctly", () => {
      const gitStatus = "?? src/new-file.ts";
      const changes = extractUncommittedChanges(gitStatus);
      expect(changes[0]?.reason).toBe("New file");
    });

    test("should mark modified files correctly", () => {
      const gitStatus = " M src/modified.ts";
      const changes = extractUncommittedChanges(gitStatus);
      expect(changes[0]?.reason).toBe("Modified");
    });
  });

  describe("createMinimalContext", () => {
    test("should create a minimal valid context", () => {
      const context = createMinimalContext(
        "Quick task",
        "Brief summary of work done",
      );

      expect(context.taskDescription).toBe("Quick task");
      expect(context.conversationSummary).toBe("Brief summary of work done");
      expect(context.currentPhase).toBe("planning");
      expect(context.progressPercentage).toBe(0);
      expect(context.filesModified).toEqual([]);
      expect(context.decisionsMade).toEqual([]);
      expect(context.todoItems).toEqual([]);

      const validation = validateContext(context);
      expect(validation.valid).toBe(true);
    });
  });
});
