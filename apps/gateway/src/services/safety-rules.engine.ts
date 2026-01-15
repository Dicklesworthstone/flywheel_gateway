/**
 * Safety Rules Engine.
 *
 * Pattern matching engine for evaluating safety rules against agent operations.
 * Supports glob patterns, regex patterns, and condition-based rules.
 */

import { logger } from "./logger";

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate a unique ID with a prefix.
 */
function generateId(prefix: string, length = 12): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i]! % chars.length];
  }
  return `${prefix}_${result}`;
}

// ============================================================================
// Types
// ============================================================================

/**
 * Safety rule categories.
 */
export type SafetyCategory =
  | "filesystem"
  | "git"
  | "network"
  | "execution"
  | "resources"
  | "content";

/**
 * Severity levels for safety rules.
 */
export type SafetySeverity = "low" | "medium" | "high" | "critical";

/**
 * Actions that can be taken when a rule matches.
 */
export type SafetyAction = "allow" | "deny" | "warn" | "approve";

/**
 * Pattern types for rule conditions.
 */
export type PatternType = "glob" | "regex" | "exact" | "prefix" | "suffix";

/**
 * Rule condition for pattern matching.
 */
export interface RuleCondition {
  field: string;
  patternType: PatternType;
  pattern: string;
  negate?: boolean;
}

/**
 * A safety rule definition.
 */
export interface SafetyRule {
  id: string;
  name: string;
  description: string;
  category: SafetyCategory;
  conditions: RuleCondition[];
  conditionLogic: "and" | "or";
  action: SafetyAction;
  severity: SafetySeverity;
  message: string;
  enabled: boolean;
  alternatives?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * An operation to evaluate against safety rules.
 */
export interface SafetyOperation {
  type: SafetyCategory;
  fields: Record<string, string | string[] | undefined>;
}

/**
 * Result of evaluating a safety rule.
 */
export interface RuleEvaluationResult {
  rule: SafetyRule;
  matched: boolean;
  action: SafetyAction;
  message: string;
  alternatives?: string[];
}

/**
 * Result of evaluating all safety rules for an operation.
 */
export interface SafetyEvaluationResult {
  allowed: boolean;
  action: SafetyAction;
  matchedRules: RuleEvaluationResult[];
  reason?: string;
  requiresApproval: boolean;
  warnings: string[];
}

// ============================================================================
// Pattern Matching
// ============================================================================

/**
 * Compile a glob pattern to a regex.
 * Supports *, **, and ? wildcards.
 */
function globToRegex(pattern: string): RegExp {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape special chars
    .replace(/\*\*/g, "\0DOUBLESTAR\0") // Preserve **
    .replace(/\*/g, "[^/]*") // * matches anything except /
    .replace(/\0DOUBLESTAR\0/g, ".*") // ** matches anything
    .replace(/\?/g, "."); // ? matches single char

  return new RegExp(`^${regex}$`);
}

/**
 * Match a value against a pattern.
 */
export function matchPattern(
  value: string,
  pattern: string,
  patternType: PatternType,
): boolean {
  switch (patternType) {
    case "exact":
      return value === pattern;

    case "prefix":
      return value.startsWith(pattern);

    case "suffix":
      return value.endsWith(pattern);

    case "glob":
      try {
        const regex = globToRegex(pattern);
        return regex.test(value);
      } catch {
        logger.warn({ pattern }, "Invalid glob pattern");
        return false;
      }

    case "regex":
      try {
        // Check for ReDoS patterns (simple heuristic)
        if (isReDoSPattern(pattern)) {
          logger.warn(
            { pattern },
            "Potentially dangerous regex pattern rejected",
          );
          return false;
        }
        const regex = new RegExp(pattern);
        return regex.test(value);
      } catch {
        logger.warn({ pattern }, "Invalid regex pattern");
        return false;
      }

    default:
      return false;
  }
}

/**
 * Simple heuristic to detect potentially dangerous ReDoS patterns.
 * This is not exhaustive but catches common cases.
 */
function isReDoSPattern(pattern: string): boolean {
  // Patterns with nested quantifiers or backreferences are risky
  const riskyPatterns = [
    /\([^)]*[+*]\)[+*]/, // Nested quantifiers
    /\([^)]*\|[^)]*\)[+*]/, // Alternation with quantifier
    /\\1/, // Backreference
    /\(\?R\)/, // Recursive pattern
  ];

  return riskyPatterns.some((risky) => risky.test(pattern));
}

/**
 * Evaluate a condition against an operation.
 */
function evaluateCondition(
  condition: RuleCondition,
  operation: SafetyOperation,
): boolean {
  const fieldValue = operation.fields[condition.field];

  if (fieldValue === undefined) {
    return condition.negate ?? false;
  }

  // Handle array fields (e.g., paths, args)
  const values = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
  const matched = values.some((value) =>
    matchPattern(value, condition.pattern, condition.patternType),
  );

  return condition.negate ? !matched : matched;
}

// ============================================================================
// Rule Evaluation
// ============================================================================

/**
 * Evaluate a single rule against an operation.
 */
export function evaluateRule(
  rule: SafetyRule,
  operation: SafetyOperation,
): RuleEvaluationResult {
  if (!rule.enabled) {
    return {
      rule,
      matched: false,
      action: "allow",
      message: "",
    };
  }

  // Check category match
  if (rule.category !== operation.type) {
    return {
      rule,
      matched: false,
      action: "allow",
      message: "",
    };
  }

  // Evaluate conditions
  let matched: boolean;
  if (rule.conditionLogic === "and") {
    matched = rule.conditions.every((cond) =>
      evaluateCondition(cond, operation),
    );
  } else {
    matched = rule.conditions.some((cond) =>
      evaluateCondition(cond, operation),
    );
  }

  const result: RuleEvaluationResult = {
    rule,
    matched,
    action: matched ? rule.action : "allow",
    message: matched ? rule.message : "",
  };
  if (matched && rule.alternatives !== undefined) {
    result.alternatives = rule.alternatives;
  }
  return result;
}

/**
 * Evaluate all rules against an operation.
 * Rules are evaluated in order: deny rules first, then allow rules.
 */
export function evaluateRules(
  rules: SafetyRule[],
  operation: SafetyOperation,
): SafetyEvaluationResult {
  const matchedRules: RuleEvaluationResult[] = [];
  const warnings: string[] = [];
  let requiresApproval = false;

  // Separate rules by action for proper precedence
  const denyRules = rules.filter((r) => r.action === "deny");
  const approveRules = rules.filter((r) => r.action === "approve");
  const warnRules = rules.filter((r) => r.action === "warn");
  const allowRules = rules.filter((r) => r.action === "allow");

  // Check deny rules first
  for (const rule of denyRules) {
    const result = evaluateRule(rule, operation);
    if (result.matched) {
      matchedRules.push(result);
      return {
        allowed: false,
        action: "deny",
        matchedRules,
        reason: result.message,
        requiresApproval: false,
        warnings,
      };
    }
  }

  // Check approve rules
  for (const rule of approveRules) {
    const result = evaluateRule(rule, operation);
    if (result.matched) {
      matchedRules.push(result);
      requiresApproval = true;
    }
  }

  // Check warn rules
  for (const rule of warnRules) {
    const result = evaluateRule(rule, operation);
    if (result.matched) {
      matchedRules.push(result);
      warnings.push(result.message);
    }
  }

  // Check allow rules
  for (const rule of allowRules) {
    const result = evaluateRule(rule, operation);
    if (result.matched) {
      matchedRules.push(result);
    }
  }

  // If requires approval, return that state
  if (requiresApproval) {
    const approvalRule = matchedRules.find((r) => r.action === "approve");
    return {
      allowed: false,
      action: "approve",
      matchedRules,
      reason: approvalRule?.message ?? "This operation requires approval",
      requiresApproval: true,
      warnings,
    };
  }

  // Default: allow if no deny rules matched
  return {
    allowed: true,
    action: "allow",
    matchedRules,
    requiresApproval: false,
    warnings,
  };
}

// ============================================================================
// Default Rules
// ============================================================================

/**
 * Generate default safety rules.
 */
export function getDefaultRules(): SafetyRule[] {
  return [
    // Filesystem rules
    {
      id: generateId("rule"),
      name: "Block etc/passwd access",
      description: "Prevent access to system password file",
      category: "filesystem",
      conditions: [
        { field: "path", patternType: "glob", pattern: "**/etc/passwd" },
      ],
      conditionLogic: "and",
      action: "deny",
      severity: "critical",
      message: "Access to /etc/passwd is blocked for security reasons",
      enabled: true,
    },
    {
      id: generateId("rule"),
      name: "Block root directory deletion",
      description: "Prevent recursive deletion from root",
      category: "filesystem",
      conditions: [
        { field: "operation", patternType: "exact", pattern: "delete" },
        { field: "path", patternType: "exact", pattern: "/" },
        { field: "recursive", patternType: "exact", pattern: "true" },
      ],
      conditionLogic: "and",
      action: "deny",
      severity: "critical",
      message: "Recursive deletion from root is blocked",
      enabled: true,
    },
    {
      id: generateId("rule"),
      name: "Block node_modules write",
      description: "Prevent direct writes to node_modules",
      category: "filesystem",
      conditions: [
        {
          field: "operation",
          patternType: "regex",
          pattern: "^(write|delete)$",
        },
        { field: "path", patternType: "glob", pattern: "**/node_modules/**" },
      ],
      conditionLogic: "and",
      action: "warn",
      severity: "low",
      message:
        "Direct modification of node_modules is discouraged. Use package manager instead.",
      enabled: true,
      alternatives: ["npm install", "bun add", "pnpm add"],
    },
    {
      id: generateId("rule"),
      name: "Block secret file access",
      description: "Prevent access to common secret files",
      category: "filesystem",
      conditions: [
        {
          field: "path",
          patternType: "regex",
          pattern: "\\.(env|pem|key|secret|credentials)$",
        },
      ],
      conditionLogic: "and",
      action: "approve",
      severity: "high",
      message: "Access to secret files requires approval",
      enabled: true,
    },

    // Git rules
    {
      id: generateId("rule"),
      name: "Block force push",
      description: "Prevent force pushing to remote",
      category: "git",
      conditions: [
        { field: "command", patternType: "regex", pattern: "push.*--force" },
      ],
      conditionLogic: "and",
      action: "approve",
      severity: "high",
      message: "Force push requires approval. This can destroy remote history.",
      enabled: true,
      alternatives: ["git push --force-with-lease"],
    },
    {
      id: generateId("rule"),
      name: "Block hard reset",
      description: "Prevent hard reset which loses uncommitted changes",
      category: "git",
      conditions: [
        { field: "command", patternType: "regex", pattern: "reset.*--hard" },
      ],
      conditionLogic: "and",
      action: "approve",
      severity: "high",
      message:
        "Hard reset can lose uncommitted changes. This requires approval.",
      enabled: true,
      alternatives: ["git stash", "git reset --soft"],
    },
    {
      id: generateId("rule"),
      name: "Block git clean -f",
      description: "Prevent cleaning untracked files",
      category: "git",
      conditions: [
        { field: "command", patternType: "glob", pattern: "clean*-f*" },
      ],
      conditionLogic: "and",
      action: "approve",
      severity: "medium",
      message:
        "git clean -f permanently deletes untracked files. This requires approval.",
      enabled: true,
    },

    // Execution rules
    {
      id: generateId("rule"),
      name: "Block curl to shell",
      description: "Prevent piping remote content to shell",
      category: "execution",
      conditions: [
        {
          field: "command",
          patternType: "regex",
          pattern: "curl.*\\|.*(sh|bash|zsh)",
        },
      ],
      conditionLogic: "and",
      action: "deny",
      severity: "critical",
      message:
        "Piping curl output to shell is blocked. Download and inspect first.",
      enabled: true,
    },
    {
      id: generateId("rule"),
      name: "Block rm -rf /",
      description: "Prevent recursive deletion from root",
      category: "execution",
      conditions: [
        {
          field: "command",
          patternType: "regex",
          pattern: "rm\\s+(-rf|-r\\s+-f|-f\\s+-r)\\s+/($|\\s)",
        },
      ],
      conditionLogic: "and",
      action: "deny",
      severity: "critical",
      message: "Recursive deletion from root is blocked",
      enabled: true,
    },
    {
      id: generateId("rule"),
      name: "Warn on sudo",
      description: "Warn when using sudo",
      category: "execution",
      conditions: [
        { field: "command", patternType: "prefix", pattern: "sudo " },
      ],
      conditionLogic: "and",
      action: "warn",
      severity: "medium",
      message: "Using sudo. Ensure this is intentional.",
      enabled: true,
    },

    // Network rules
    {
      id: generateId("rule"),
      name: "Block internal network access",
      description: "Prevent access to internal network ranges",
      category: "network",
      conditions: [
        {
          field: "url",
          patternType: "regex",
          pattern:
            "^https?://(10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|192\\.168\\.)",
        },
      ],
      conditionLogic: "and",
      action: "deny",
      severity: "high",
      message: "Access to internal network addresses is blocked",
      enabled: true,
    },
    {
      id: generateId("rule"),
      name: "Block metadata endpoint",
      description: "Prevent access to cloud metadata endpoints",
      category: "network",
      conditions: [
        {
          field: "url",
          patternType: "regex",
          pattern: "169\\.254\\.169\\.254",
        },
      ],
      conditionLogic: "and",
      action: "deny",
      severity: "critical",
      message: "Access to cloud metadata endpoint is blocked",
      enabled: true,
    },

    // Content rules
    {
      id: generateId("rule"),
      name: "Block AWS credentials in content",
      description: "Prevent AWS credentials in generated content",
      category: "content",
      conditions: [
        {
          field: "content",
          patternType: "regex",
          pattern: "AKIA[0-9A-Z]{16}",
        },
      ],
      conditionLogic: "and",
      action: "deny",
      severity: "critical",
      message: "AWS credentials detected in content. This is blocked.",
      enabled: true,
    },
    {
      id: generateId("rule"),
      name: "Block private keys in content",
      description: "Prevent private keys in generated content",
      category: "content",
      conditions: [
        {
          field: "content",
          patternType: "regex",
          pattern: "-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----",
        },
      ],
      conditionLogic: "and",
      action: "deny",
      severity: "critical",
      message: "Private key detected in content. This is blocked.",
      enabled: true,
    },
  ];
}

// ============================================================================
// Rule Validation
// ============================================================================

/**
 * Validation error for a safety rule.
 */
export interface RuleValidationError {
  field: string;
  message: string;
}

/**
 * Validate a safety rule.
 */
export function validateRule(rule: Partial<SafetyRule>): RuleValidationError[] {
  const errors: RuleValidationError[] = [];

  if (!rule.name || rule.name.trim().length === 0) {
    errors.push({ field: "name", message: "Name is required" });
  }

  if (!rule.category) {
    errors.push({ field: "category", message: "Category is required" });
  }

  if (!rule.action) {
    errors.push({ field: "action", message: "Action is required" });
  }

  if (!rule.severity) {
    errors.push({ field: "severity", message: "Severity is required" });
  }

  if (!rule.message || rule.message.trim().length === 0) {
    errors.push({ field: "message", message: "Message is required" });
  }

  if (!rule.conditions || rule.conditions.length === 0) {
    errors.push({
      field: "conditions",
      message: "At least one condition is required",
    });
  } else {
    for (let i = 0; i < rule.conditions.length; i++) {
      const cond = rule.conditions[i];
      if (!cond) continue;

      if (!cond.field) {
        errors.push({
          field: `conditions[${i}].field`,
          message: "Field is required",
        });
      }
      if (!cond.pattern) {
        errors.push({
          field: `conditions[${i}].pattern`,
          message: "Pattern is required",
        });
      }
      if (!cond.patternType) {
        errors.push({
          field: `conditions[${i}].patternType`,
          message: "Pattern type is required",
        });
      }

      // Validate regex patterns
      if (cond.patternType === "regex" && cond.pattern) {
        try {
          new RegExp(cond.pattern);
        } catch {
          errors.push({
            field: `conditions[${i}].pattern`,
            message: "Invalid regex pattern",
          });
        }
        if (isReDoSPattern(cond.pattern)) {
          errors.push({
            field: `conditions[${i}].pattern`,
            message: "Pattern may be vulnerable to ReDoS attacks",
          });
        }
      }
    }
  }

  return errors;
}

// ============================================================================
// Rule Statistics
// ============================================================================

/**
 * Statistics for safety rules.
 */
export interface RuleStats {
  totalRules: number;
  enabledRules: number;
  disabledRules: number;
  byCategory: Record<SafetyCategory, number>;
  bySeverity: Record<SafetySeverity, number>;
  byAction: Record<SafetyAction, number>;
}

/**
 * Get statistics for a set of rules.
 */
export function getRuleStats(rules: SafetyRule[]): RuleStats {
  const stats: RuleStats = {
    totalRules: rules.length,
    enabledRules: 0,
    disabledRules: 0,
    byCategory: {
      filesystem: 0,
      git: 0,
      network: 0,
      execution: 0,
      resources: 0,
      content: 0,
    },
    bySeverity: {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    },
    byAction: {
      allow: 0,
      deny: 0,
      warn: 0,
      approve: 0,
    },
  };

  for (const rule of rules) {
    if (rule.enabled) {
      stats.enabledRules++;
    } else {
      stats.disabledRules++;
    }
    stats.byCategory[rule.category]++;
    stats.bySeverity[rule.severity]++;
    stats.byAction[rule.action]++;
  }

  return stats;
}

// ============================================================================
// Exports for Testing
// ============================================================================

export { globToRegex, isReDoSPattern };
