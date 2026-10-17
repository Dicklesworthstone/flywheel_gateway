import { describe, expect, test } from "bun:test";
import {
  evaluateRule,
  evaluateRules,
  getDefaultRules,
  getRuleStats,
  globToRegex,
  isReDoSPattern,
  matchPattern,
  type SafetyOperation,
  type SafetyRule,
  validateRule,
} from "../services/safety-rules.engine";

describe("Safety Rules Engine", () => {
  describe("Pattern Matching", () => {
    describe("globToRegex", () => {
      test("converts simple wildcards", () => {
        const regex = globToRegex("*.ts");
        expect(regex.test("file.ts")).toBe(true);
        expect(regex.test("file.js")).toBe(false);
        expect(regex.test("dir/file.ts")).toBe(false);
      });

      test("converts double wildcards", () => {
        const regex = globToRegex("**/*.ts");
        // **/*.ts expects at least one directory level
        expect(regex.test("dir/file.ts")).toBe(true);
        expect(regex.test("deep/nested/file.ts")).toBe(true);
        expect(regex.test("file.js")).toBe(false);
        expect(regex.test("dir/file.js")).toBe(false);

        // For matching root files too, use *.ts pattern
        const rootRegex = globToRegex("*.ts");
        expect(rootRegex.test("file.ts")).toBe(true);
        expect(rootRegex.test("file.js")).toBe(false);
      });

      test("converts question mark wildcards", () => {
        const regex = globToRegex("file?.ts");
        expect(regex.test("file1.ts")).toBe(true);
        expect(regex.test("fileA.ts")).toBe(true);
        expect(regex.test("file.ts")).toBe(false);
        expect(regex.test("file12.ts")).toBe(false);
      });

      test("escapes special regex characters", () => {
        const regex = globToRegex("file.test.ts");
        expect(regex.test("file.test.ts")).toBe(true);
        expect(regex.test("file_test_ts")).toBe(false);
      });
    });

    describe("matchPattern", () => {
      test("matches exact patterns", () => {
        expect(matchPattern("hello", "hello", "exact")).toBe(true);
        expect(matchPattern("hello", "world", "exact")).toBe(false);
      });

      test("matches prefix patterns", () => {
        expect(matchPattern("/data/projects", "/data", "prefix")).toBe(true);
        expect(matchPattern("/data/projects", "/other", "prefix")).toBe(false);
      });

      test("matches suffix patterns", () => {
        expect(matchPattern("file.ts", ".ts", "suffix")).toBe(true);
        expect(matchPattern("file.js", ".ts", "suffix")).toBe(false);
      });

      test("matches glob patterns", () => {
        expect(matchPattern("src/file.ts", "**/*.ts", "glob")).toBe(true);
        expect(matchPattern("file.js", "**/*.ts", "glob")).toBe(false);
      });

      test("matches regex patterns", () => {
        expect(matchPattern("error_123", "error_\\d+", "regex")).toBe(true);
        expect(matchPattern("error_abc", "error_\\d+", "regex")).toBe(false);
      });

      test("handles invalid regex gracefully", () => {
        expect(matchPattern("test", "[invalid", "regex")).toBe(false);
      });
    });

    describe("isReDoSPattern", () => {
      test("detects nested quantifiers", () => {
        expect(isReDoSPattern("(a+)+")).toBe(true);
        expect(isReDoSPattern("(a*)*")).toBe(true);
      });

      test("detects alternation with quantifier", () => {
        expect(isReDoSPattern("(a|b)*")).toBe(true);
      });

      test("detects backreferences", () => {
        expect(isReDoSPattern("(.)\\1+")).toBe(true);
      });

      test("allows safe patterns", () => {
        expect(isReDoSPattern("\\d+")).toBe(false);
        expect(isReDoSPattern("[a-z]+")).toBe(false);
        expect(isReDoSPattern("^test$")).toBe(false);
      });
    });
  });

  describe("Rule Evaluation", () => {
    const denyRule: SafetyRule = {
      id: "rule-1",
      name: "Block dangerous path",
      description: "Block access to /etc/passwd",
      category: "filesystem",
      conditions: [
        { field: "path", patternType: "glob", pattern: "**/etc/passwd" },
      ],
      conditionLogic: "and",
      action: "deny",
      severity: "critical",
      message: "Access to /etc/passwd is blocked",
      enabled: true,
    };

    const warnRule: SafetyRule = {
      id: "rule-2",
      name: "Warn on node_modules",
      description: "Warn when modifying node_modules",
      category: "filesystem",
      conditions: [
        { field: "path", patternType: "glob", pattern: "**/node_modules/**" },
      ],
      conditionLogic: "and",
      action: "warn",
      severity: "low",
      message: "Modifying node_modules directly is discouraged",
      enabled: true,
    };

    const approveRule: SafetyRule = {
      id: "rule-3",
      name: "Approve force push",
      description: "Force push requires approval",
      category: "git",
      conditions: [
        { field: "command", patternType: "regex", pattern: "push.*--force" },
      ],
      conditionLogic: "and",
      action: "approve",
      severity: "high",
      message: "Force push requires approval",
      enabled: true,
    };

    describe("evaluateRule", () => {
      test("matches deny rule", () => {
        const operation: SafetyOperation = {
          type: "filesystem",
          fields: { path: "/etc/passwd" },
        };

        const result = evaluateRule(denyRule, operation);

        expect(result.matched).toBe(true);
        expect(result.action).toBe("deny");
        expect(result.message).toBe("Access to /etc/passwd is blocked");
      });

      test("does not match wrong category", () => {
        const operation: SafetyOperation = {
          type: "git",
          fields: { path: "/etc/passwd" },
        };

        const result = evaluateRule(denyRule, operation);

        expect(result.matched).toBe(false);
      });

      test("does not match when disabled", () => {
        const disabledRule = { ...denyRule, enabled: false };
        const operation: SafetyOperation = {
          type: "filesystem",
          fields: { path: "/etc/passwd" },
        };

        const result = evaluateRule(disabledRule, operation);

        expect(result.matched).toBe(false);
      });

      test("evaluates AND conditions", () => {
        const rule: SafetyRule = {
          id: "rule-and",
          name: "Multi-condition rule",
          description: "Test AND logic",
          category: "filesystem",
          conditions: [
            { field: "operation", patternType: "exact", pattern: "delete" },
            { field: "path", patternType: "glob", pattern: "**/important/**" },
          ],
          conditionLogic: "and",
          action: "deny",
          severity: "high",
          message: "Cannot delete important files",
          enabled: true,
        };

        // Both conditions match
        let result = evaluateRule(rule, {
          type: "filesystem",
          fields: { operation: "delete", path: "/data/important/file.txt" },
        });
        expect(result.matched).toBe(true);

        // Only one condition matches
        result = evaluateRule(rule, {
          type: "filesystem",
          fields: { operation: "read", path: "/data/important/file.txt" },
        });
        expect(result.matched).toBe(false);
      });

      test("evaluates OR conditions", () => {
        const rule: SafetyRule = {
          id: "rule-or",
          name: "Multi-condition OR rule",
          description: "Test OR logic",
          category: "filesystem",
          conditions: [
            { field: "path", patternType: "suffix", pattern: ".env" },
            { field: "path", patternType: "suffix", pattern: ".pem" },
          ],
          conditionLogic: "or",
          action: "deny",
          severity: "high",
          message: "Cannot access secret files",
          enabled: true,
        };

        // First condition matches
        let result = evaluateRule(rule, {
          type: "filesystem",
          fields: { path: "/app/.env" },
        });
        expect(result.matched).toBe(true);

        // Second condition matches
        result = evaluateRule(rule, {
          type: "filesystem",
          fields: { path: "/keys/server.pem" },
        });
        expect(result.matched).toBe(true);

        // Neither matches
        result = evaluateRule(rule, {
          type: "filesystem",
          fields: { path: "/app/config.json" },
        });
        expect(result.matched).toBe(false);
      });

      test("handles negated conditions", () => {
        const rule: SafetyRule = {
          id: "rule-negate",
          name: "Allow specific path",
          description: "Only allow workspace paths",
          category: "filesystem",
          conditions: [
            {
              field: "path",
              patternType: "prefix",
              pattern: "/workspace",
              negate: true,
            },
          ],
          conditionLogic: "and",
          action: "deny",
          severity: "medium",
          message: "Must use workspace path",
          enabled: true,
        };

        // Path outside workspace
        let result = evaluateRule(rule, {
          type: "filesystem",
          fields: { path: "/etc/passwd" },
        });
        expect(result.matched).toBe(true);

        // Path inside workspace
        result = evaluateRule(rule, {
          type: "filesystem",
          fields: { path: "/workspace/project/file.ts" },
        });
        expect(result.matched).toBe(false);
      });
    });

    describe("evaluateRules", () => {
      test("deny rules take precedence", () => {
        const rules = [warnRule, denyRule];
        const operation: SafetyOperation = {
          type: "filesystem",
          fields: { path: "/etc/passwd" },
        };

        const result = evaluateRules(rules, operation);

        expect(result.allowed).toBe(false);
        expect(result.action).toBe("deny");
      });

      test("collects warnings when allowed", () => {
        const rules = [warnRule];
        const operation: SafetyOperation = {
          type: "filesystem",
          fields: { path: "/app/node_modules/package/index.js" },
        };

        const result = evaluateRules(rules, operation);

        expect(result.allowed).toBe(true);
        expect(result.warnings.length).toBe(1);
        expect(result.warnings[0]).toContain("node_modules");
      });

      test("returns requiresApproval for approve rules", () => {
        const rules = [approveRule];
        const operation: SafetyOperation = {
          type: "git",
          fields: { command: "git push --force origin main" },
        };

        const result = evaluateRules(rules, operation);

        expect(result.allowed).toBe(false);
        expect(result.requiresApproval).toBe(true);
        expect(result.action).toBe("approve");
      });

      test("allows operations with no matching rules", () => {
        const rules = [denyRule, warnRule, approveRule];
        const operation: SafetyOperation = {
          type: "filesystem",
          fields: { path: "/app/src/index.ts" },
        };

        const result = evaluateRules(rules, operation);

        expect(result.allowed).toBe(true);
        expect(result.action).toBe("allow");
        expect(result.requiresApproval).toBe(false);
      });
    });
  });

  describe("Default Rules", () => {
    test("returns a non-empty array of rules", () => {
      const rules = getDefaultRules();

      expect(rules.length).toBeGreaterThan(0);
    });

    test("all default rules have required fields", () => {
      const rules = getDefaultRules();

      for (const rule of rules) {
        expect(rule.id).toBeDefined();
        expect(rule.name).toBeDefined();
        expect(rule.category).toBeDefined();
        expect(rule.action).toBeDefined();
        expect(rule.severity).toBeDefined();
        expect(rule.message).toBeDefined();
        expect(rule.conditions.length).toBeGreaterThan(0);
      }
    });

    test("includes filesystem rules", () => {
      const rules = getDefaultRules();
      const fsRules = rules.filter((r) => r.category === "filesystem");

      expect(fsRules.length).toBeGreaterThan(0);
    });

    test("includes git rules", () => {
      const rules = getDefaultRules();
      const gitRules = rules.filter((r) => r.category === "git");

      expect(gitRules.length).toBeGreaterThan(0);
    });

    test("includes execution rules", () => {
      const rules = getDefaultRules();
      const execRules = rules.filter((r) => r.category === "execution");

      expect(execRules.length).toBeGreaterThan(0);
    });
  });

  describe("Rule Validation", () => {
    test("validates valid rule", () => {
      const rule: Partial<SafetyRule> = {
        name: "Test Rule",
        category: "filesystem",
        action: "deny",
        severity: "high",
        message: "Test message",
        conditions: [{ field: "path", patternType: "glob", pattern: "*.ts" }],
      };

      const errors = validateRule(rule);

      expect(errors.length).toBe(0);
    });

    test("requires name", () => {
      const rule: Partial<SafetyRule> = {
        category: "filesystem",
        action: "deny",
        severity: "high",
        message: "Test message",
        conditions: [],
      };

      const errors = validateRule(rule);

      expect(errors.some((e) => e.field === "name")).toBe(true);
    });

    test("requires conditions", () => {
      const rule: Partial<SafetyRule> = {
        name: "Test",
        category: "filesystem",
        action: "deny",
        severity: "high",
        message: "Test message",
        conditions: [],
      };

      const errors = validateRule(rule);

      expect(errors.some((e) => e.field === "conditions")).toBe(true);
    });

    test("validates regex patterns", () => {
      const rule: Partial<SafetyRule> = {
        name: "Test",
        category: "filesystem",
        action: "deny",
        severity: "high",
        message: "Test message",
        conditions: [
          { field: "path", patternType: "regex", pattern: "[invalid" },
        ],
      };

      const errors = validateRule(rule);

      expect(errors.some((e) => e.field.includes("pattern"))).toBe(true);
    });

    test("detects ReDoS patterns", () => {
      const rule: Partial<SafetyRule> = {
        name: "Test",
        category: "filesystem",
        action: "deny",
        severity: "high",
        message: "Test message",
        conditions: [{ field: "path", patternType: "regex", pattern: "(a+)+" }],
      };

      const errors = validateRule(rule);

      expect(errors.some((e) => e.message.includes("ReDoS"))).toBe(true);
    });
  });

  describe("Rule Statistics", () => {
    test("calculates correct statistics", () => {
      const rules: SafetyRule[] = [
        {
          id: "1",
          name: "Rule 1",
          description: "",
          category: "filesystem",
          conditions: [],
          conditionLogic: "and",
          action: "deny",
          severity: "high",
          message: "",
          enabled: true,
        },
        {
          id: "2",
          name: "Rule 2",
          description: "",
          category: "git",
          conditions: [],
          conditionLogic: "and",
          action: "warn",
          severity: "low",
          message: "",
          enabled: false,
        },
        {
          id: "3",
          name: "Rule 3",
          description: "",
          category: "filesystem",
          conditions: [],
          conditionLogic: "and",
          action: "approve",
          severity: "medium",
          message: "",
          enabled: true,
        },
      ];

      const stats = getRuleStats(rules);

      expect(stats.totalRules).toBe(3);
      expect(stats.enabledRules).toBe(2);
      expect(stats.disabledRules).toBe(1);
      expect(stats.byCategory.filesystem).toBe(2);
      expect(stats.byCategory.git).toBe(1);
      expect(stats.bySeverity.high).toBe(1);
      expect(stats.bySeverity.low).toBe(1);
      expect(stats.bySeverity.medium).toBe(1);
      expect(stats.byAction.deny).toBe(1);
      expect(stats.byAction.warn).toBe(1);
      expect(stats.byAction.approve).toBe(1);
    });
  });
});
