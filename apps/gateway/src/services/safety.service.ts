/**
 * SLB Safety Service.
 *
 * Main orchestration layer for safety guardrails.
 * Coordinates rule evaluation, rate limiting, budget tracking,
 * and approval workflows.
 */

import { logger } from "./logger";
import {
  evaluateRules,
  getDefaultRules,
  getRuleStats,
  type SafetyAction,
  type SafetyCategory,
  type SafetyOperation,
  type SafetyRule,
  type SafetySeverity,
  validateRule,
} from "./safety-rules.engine";

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate a unique ID with a prefix.
 */
function generateId(prefix: string, length = 12): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const charLen = chars.length;
  const maxByte = 256 - (256 % charLen);
  let result = "";

  while (result.length < length) {
    const bufSize = Math.ceil((length - result.length) * 1.2);
    const randomBytes = new Uint8Array(bufSize);
    crypto.getRandomValues(randomBytes);

    for (let i = 0; i < bufSize && result.length < length; i++) {
      const byte = randomBytes[i]!;
      if (byte < maxByte) {
        result += chars[byte % charLen];
      }
    }
  }
  return `${prefix}_${result}`;
}

// ============================================================================
// Types
// ============================================================================

/**
 * Rate limit configuration for safety.
 */
export interface SafetyRateLimitConfig {
  scope: "agent" | "workspace" | "session";
  limits: {
    tokensPerMinute: number;
    requestsPerMinute: number;
    fileWritesPerMinute: number;
    networkRequestsPerMinute: number;
    commandsPerMinute: number;
  };
  burstAllowance: number;
  cooldownSeconds: number;
}

/**
 * Budget configuration for cost control.
 */
export interface SafetyBudgetConfig {
  scope: "agent" | "workspace" | "session";
  limits: {
    totalTokens: number;
    totalDollars: number;
    perRequestDollars: number;
  };
  alertThresholds: number[];
  action: "warn" | "pause" | "terminate";
}

/**
 * Approval workflow configuration.
 */
export interface ApprovalWorkflowConfig {
  enabled: boolean;
  approvers: string[];
  timeoutMinutes: number;
  defaultAction: "deny" | "allow";
}

/**
 * Full safety configuration.
 */
export interface SafetyConfig {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  enabled: boolean;
  categories: {
    [K in SafetyCategory]: {
      enabled: boolean;
      rules: SafetyRule[];
    };
  };
  rateLimits: SafetyRateLimitConfig;
  budget: SafetyBudgetConfig;
  approvalWorkflow: ApprovalWorkflowConfig;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Safety violation record.
 */
export interface SafetyViolation {
  id: string;
  timestamp: Date;
  agentId: string;
  sessionId: string;
  workspaceId: string;
  rule: SafetyRule;
  operation: {
    type: SafetyCategory;
    details: Record<string, unknown>;
  };
  action: "blocked" | "warned" | "pending_approval";
  context: {
    taskDescription?: string;
    recentHistory: string[];
  };
  correlationId?: string;
}

/**
 * Pre-flight check request.
 */
export interface PreFlightCheckRequest {
  agentId: string;
  sessionId: string;
  workspaceId: string;
  operation: SafetyOperation;
  context?: {
    taskDescription?: string;
    recentHistory?: string[];
  };
  correlationId?: string;
}

/**
 * Pre-flight check result.
 */
export interface PreFlightCheckResult {
  allowed: boolean;
  action: SafetyAction;
  reason?: string;
  violations: SafetyViolation[];
  warnings: string[];
  requiresApproval: boolean;
  approvalId?: string;
  rateLimited: boolean;
  rateLimitInfo?: {
    limitType: string;
    remaining: number;
    resetAt: Date;
  };
  budgetExceeded: boolean;
  budgetInfo?: {
    used: number;
    limit: number;
    percentage: number;
  };
  evaluationTimeMs: number;
}

// ============================================================================
// In-Memory State (will be replaced with DB in production)
// ============================================================================

/** Safety configurations by workspace */
const configs = new Map<string, SafetyConfig>();

/** Violations log */
const violations: SafetyViolation[] = [];
const MAX_VIOLATIONS = 10000;

/** Rate limit counters: key -> { count, resetAt } */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimitCounters = new Map<string, RateLimitEntry>();

/** Budget usage: key -> { tokens, dollars } */
interface BudgetUsage {
  tokens: number;
  dollars: number;
  lastReset: Date;
}
const budgetUsage = new Map<string, BudgetUsage>();

/** Cleanup job handle */
let cleanupIntervalHandle: ReturnType<typeof setInterval> | null = null;

/** Cleanup interval in milliseconds (default: 5 minutes) */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** How long to keep inactive budget entries (24 hours) */
const BUDGET_INACTIVE_TTL_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// Cleanup Job
// ============================================================================

/**
 * Clean up expired rate limit entries and stale budget entries.
 * This prevents unbounded memory growth from accumulated entries.
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  let rateLimitCleaned = 0;
  let budgetCleaned = 0;

  // Clean up expired rate limit entries
  for (const [key, entry] of rateLimitCounters) {
    if (entry.resetAt <= now) {
      rateLimitCounters.delete(key);
      rateLimitCleaned++;
    }
  }

  // Clean up stale budget entries (inactive for BUDGET_INACTIVE_TTL_MS)
  const inactiveThreshold = new Date(now - BUDGET_INACTIVE_TTL_MS);
  for (const [key, usage] of budgetUsage) {
    if (usage.lastReset < inactiveThreshold) {
      budgetUsage.delete(key);
      budgetCleaned++;
    }
  }

  if (rateLimitCleaned > 0 || budgetCleaned > 0) {
    logger.debug(
      {
        rateLimitCleaned,
        budgetCleaned,
        rateLimitRemaining: rateLimitCounters.size,
        budgetRemaining: budgetUsage.size,
      },
      "Safety service cleanup completed",
    );
  }
}

/**
 * Start the background cleanup job.
 * Safe to call multiple times - will not create duplicate intervals.
 */
export function startCleanupJob(): void {
  if (cleanupIntervalHandle !== null) {
    return; // Already running
  }
  cleanupIntervalHandle = setInterval(
    cleanupExpiredEntries,
    CLEANUP_INTERVAL_MS,
  );
  // Ensure the interval doesn't prevent process exit
  if (cleanupIntervalHandle.unref) {
    cleanupIntervalHandle.unref();
  }
  logger.info("Safety service cleanup job started");
}

/**
 * Stop the background cleanup job.
 */
export function stopCleanupJob(): void {
  if (cleanupIntervalHandle !== null) {
    clearInterval(cleanupIntervalHandle);
    cleanupIntervalHandle = null;
    logger.info("Safety service cleanup job stopped");
  }
}

/**
 * Get current memory usage stats for monitoring.
 */
export function getMemoryStats(): {
  rateLimitEntries: number;
  budgetEntries: number;
  configEntries: number;
  violationsCount: number;
} {
  return {
    rateLimitEntries: rateLimitCounters.size,
    budgetEntries: budgetUsage.size,
    configEntries: configs.size,
    violationsCount: violations.length,
  };
}

// ============================================================================
// Configuration Management
// ============================================================================

/**
 * Get default rate limits.
 */
function getDefaultRateLimits(): SafetyRateLimitConfig {
  return {
    scope: "agent",
    limits: {
      tokensPerMinute: 100000,
      requestsPerMinute: 100,
      fileWritesPerMinute: 50,
      networkRequestsPerMinute: 30,
      commandsPerMinute: 60,
    },
    burstAllowance: 0.2,
    cooldownSeconds: 60,
  };
}

/**
 * Get default budget config.
 */
function getDefaultBudgetConfig(): SafetyBudgetConfig {
  return {
    scope: "session",
    limits: {
      totalTokens: 1000000,
      totalDollars: 10,
      perRequestDollars: 0.5,
    },
    alertThresholds: [0.5, 0.8, 0.95],
    action: "warn",
  };
}

/**
 * Get default approval workflow config.
 */
function getDefaultApprovalConfig(): ApprovalWorkflowConfig {
  return {
    enabled: true,
    approvers: [],
    timeoutMinutes: 30,
    defaultAction: "deny",
  };
}

/**
 * Create a default safety configuration.
 */
export function createDefaultConfig(workspaceId: string): SafetyConfig {
  const defaultRules = getDefaultRules();

  // Group rules by category
  const categories: SafetyConfig["categories"] = {
    filesystem: { enabled: true, rules: [] },
    git: { enabled: true, rules: [] },
    network: { enabled: true, rules: [] },
    execution: { enabled: true, rules: [] },
    resources: { enabled: true, rules: [] },
    content: { enabled: true, rules: [] },
  };

  for (const rule of defaultRules) {
    categories[rule.category].rules.push(rule);
  }

  return {
    id: generateId("sconf"),
    workspaceId,
    name: "Default Safety Config",
    description: "Default safety guardrails configuration",
    enabled: true,
    categories,
    rateLimits: getDefaultRateLimits(),
    budget: getDefaultBudgetConfig(),
    approvalWorkflow: getDefaultApprovalConfig(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Get safety config for a workspace.
 */
export async function getConfig(workspaceId: string): Promise<SafetyConfig> {
  let config = configs.get(workspaceId);
  if (!config) {
    config = createDefaultConfig(workspaceId);
    configs.set(workspaceId, config);
  }
  return config;
}

/**
 * Update safety config for a workspace.
 */
export async function updateConfig(
  workspaceId: string,
  updates: Partial<Omit<SafetyConfig, "id" | "workspaceId" | "createdAt">>,
): Promise<SafetyConfig> {
  const config = await getConfig(workspaceId);

  Object.assign(config, updates, { updatedAt: new Date() });

  configs.set(workspaceId, config);

  logger.info(
    {
      workspaceId,
      configId: config.id,
    },
    "Safety config updated",
  );

  return config;
}

/**
 * Add a rule to a workspace's config.
 */
export async function addRule(
  workspaceId: string,
  rule: Omit<SafetyRule, "id">,
): Promise<SafetyRule> {
  const errors = validateRule(rule);
  if (errors.length > 0) {
    throw new Error(`Invalid rule: ${errors.map((e) => e.message).join(", ")}`);
  }

  const config = await getConfig(workspaceId);
  const newRule: SafetyRule = {
    ...rule,
    id: generateId("rule"),
  };

  config.categories[rule.category].rules.push(newRule);
  config.updatedAt = new Date();
  configs.set(workspaceId, config);

  logger.info(
    {
      workspaceId,
      ruleId: newRule.id,
      ruleName: newRule.name,
      category: newRule.category,
    },
    "Safety rule added",
  );

  return newRule;
}

/**
 * Remove a rule from a workspace's config.
 */
export async function removeRule(
  workspaceId: string,
  ruleId: string,
): Promise<boolean> {
  const config = await getConfig(workspaceId);

  for (const category of Object.values(config.categories)) {
    const index = category.rules.findIndex((r) => r.id === ruleId);
    if (index !== -1) {
      category.rules.splice(index, 1);
      config.updatedAt = new Date();
      configs.set(workspaceId, config);

      logger.info({ workspaceId, ruleId }, "Safety rule removed");
      return true;
    }
  }

  return false;
}

/**
 * Toggle a rule's enabled state.
 */
export async function toggleRule(
  workspaceId: string,
  ruleId: string,
  enabled: boolean,
): Promise<SafetyRule | undefined> {
  const config = await getConfig(workspaceId);

  for (const category of Object.values(config.categories)) {
    const rule = category.rules.find((r) => r.id === ruleId);
    if (rule) {
      rule.enabled = enabled;
      config.updatedAt = new Date();
      configs.set(workspaceId, config);

      logger.info({ workspaceId, ruleId, enabled }, "Safety rule toggled");
      return rule;
    }
  }

  return undefined;
}

// ============================================================================
// Pre-Flight Check
// ============================================================================

/**
 * Perform a pre-flight safety check for an operation.
 */
export async function preFlightCheck(
  request: PreFlightCheckRequest,
): Promise<PreFlightCheckResult> {
  const startTime = Date.now();
  const config = await getConfig(request.workspaceId);

  const result: PreFlightCheckResult = {
    allowed: true,
    action: "allow",
    violations: [],
    warnings: [],
    requiresApproval: false,
    rateLimited: false,
    budgetExceeded: false,
    evaluationTimeMs: 0,
  };

  // Skip if safety is disabled
  if (!config.enabled) {
    result.evaluationTimeMs = Date.now() - startTime;
    return result;
  }

  // Check rate limits
  const rateLimitResult = checkRateLimits(request, config);
  if (rateLimitResult.limited) {
    result.allowed = false;
    result.action = "deny";
    result.rateLimited = true;
    if (rateLimitResult.info) {
      result.rateLimitInfo = rateLimitResult.info;
    }
    result.reason = `Rate limit exceeded: ${rateLimitResult.info?.limitType}`;
    result.evaluationTimeMs = Date.now() - startTime;

    logger.info(
      {
        correlationId: request.correlationId,
        agentId: request.agentId,
        limitType: rateLimitResult.info?.limitType,
      },
      "Pre-flight check: rate limited",
    );

    return result;
  }

  // Check budget
  const budgetResult = checkBudget(request, config);
  if (budgetResult.exceeded) {
    result.budgetExceeded = true;
    if (budgetResult.info) {
      result.budgetInfo = budgetResult.info;
    }

    if (config.budget.action === "terminate") {
      result.allowed = false;
      result.action = "deny";
      result.reason = "Budget limit exceeded";
      result.evaluationTimeMs = Date.now() - startTime;

      logger.warn(
        {
          correlationId: request.correlationId,
          agentId: request.agentId,
          usage: budgetResult.info,
        },
        "Pre-flight check: budget exceeded",
      );

      return result;
    } else if (config.budget.action === "pause") {
      result.allowed = false;
      result.action = "approve";
      result.requiresApproval = true;
      result.reason = "Budget threshold reached, approval required to continue";
    } else {
      result.warnings.push(
        `Budget at ${budgetResult.info?.percentage.toFixed(0)}%`,
      );
    }
  }

  // Collect all enabled rules
  const enabledRules: SafetyRule[] = [];
  for (const [category, catConfig] of Object.entries(config.categories)) {
    if (catConfig.enabled && category === request.operation.type) {
      enabledRules.push(...catConfig.rules.filter((r) => r.enabled));
    }
  }

  // Evaluate rules
  const evalResult = evaluateRules(enabledRules, request.operation);

  // Record violations
  for (const matchedRule of evalResult.matchedRules) {
    if (matchedRule.action !== "allow" && matchedRule.matched) {
      const violation: SafetyViolation = {
        id: generateId("svio"),
        timestamp: new Date(),
        agentId: request.agentId,
        sessionId: request.sessionId,
        workspaceId: request.workspaceId,
        rule: matchedRule.rule,
        operation: {
          type: request.operation.type,
          details: request.operation.fields as Record<string, unknown>,
        },
        action:
          matchedRule.action === "deny"
            ? "blocked"
            : matchedRule.action === "approve"
              ? "pending_approval"
              : "warned",
        context: {
          ...(request.context?.taskDescription && {
            taskDescription: request.context.taskDescription,
          }),
          recentHistory: request.context?.recentHistory ?? [],
        },
        ...(request.correlationId && { correlationId: request.correlationId }),
      };

      violations.push(violation);
      result.violations.push(violation);

      // Trim violations if too many
      while (violations.length > MAX_VIOLATIONS) {
        violations.shift();
      }
    }
  }

  // Set result based on evaluation
  result.allowed = evalResult.allowed;
  result.action = evalResult.action;
  if (evalResult.reason) {
    result.reason = evalResult.reason;
  }
  result.requiresApproval = evalResult.requiresApproval;
  result.warnings.push(...evalResult.warnings);

  result.evaluationTimeMs = Date.now() - startTime;

  // Log decision
  logger.info(
    {
      correlationId: request.correlationId,
      agentId: request.agentId,
      operation: request.operation.type,
      allowed: result.allowed,
      action: result.action,
      violationCount: result.violations.length,
      evaluationTimeMs: result.evaluationTimeMs,
    },
    "Pre-flight check completed",
  );

  return result;
}

// ============================================================================
// Rate Limiting
// ============================================================================

function getRateLimitKey(
  request: PreFlightCheckRequest,
  config: SafetyRateLimitConfig,
  limitType: string,
): string {
  switch (config.scope) {
    case "agent":
      return `rate:${request.agentId}:${limitType}`;
    case "workspace":
      return `rate:${request.workspaceId}:${limitType}`;
    case "session":
      return `rate:${request.sessionId}:${limitType}`;
    default:
      throw new Error(`Invalid rate limit scope: ${config.scope}`);
  }
}

function checkRateLimits(
  request: PreFlightCheckRequest,
  config: SafetyConfig,
): {
  limited: boolean;
  info?: { limitType: string; remaining: number; resetAt: Date };
} {
  const now = Date.now();
  const windowMs = 60000; // 1 minute window

  // Map operation types to limit types
  const limitMap: Record<
    SafetyCategory,
    keyof SafetyRateLimitConfig["limits"]
  > = {
    filesystem: "fileWritesPerMinute",
    git: "commandsPerMinute",
    network: "networkRequestsPerMinute",
    execution: "commandsPerMinute",
    resources: "requestsPerMinute",
    content: "requestsPerMinute",
  };

  const limitType = limitMap[request.operation.type] ?? "requestsPerMinute";
  const limit = config.rateLimits.limits[limitType];
  const effectiveLimit = Math.floor(
    limit * (1 + config.rateLimits.burstAllowance),
  );

  const key = getRateLimitKey(request, config.rateLimits, limitType);
  let entry = rateLimitCounters.get(key);

  // Reset if window expired
  if (!entry || entry.resetAt <= now) {
    entry = {
      count: 0,
      resetAt: now + windowMs,
    };
  }

  entry.count++;
  rateLimitCounters.set(key, entry);

  if (entry.count > effectiveLimit) {
    return {
      limited: true,
      info: {
        limitType,
        remaining: 0,
        resetAt: new Date(entry.resetAt),
      },
    };
  }

  return {
    limited: false,
    info: {
      limitType,
      remaining: effectiveLimit - entry.count,
      resetAt: new Date(entry.resetAt),
    },
  };
}

// ============================================================================
// Budget Tracking
// ============================================================================

function getBudgetKey(
  request: PreFlightCheckRequest,
  config: SafetyBudgetConfig,
): string {
  switch (config.scope) {
    case "agent":
      return `budget:${request.agentId}`;
    case "workspace":
      return `budget:${request.workspaceId}`;
    case "session":
      return `budget:${request.sessionId}`;
    default:
      throw new Error(`Invalid budget scope: ${config.scope}`);
  }
}

function checkBudget(
  request: PreFlightCheckRequest,
  config: SafetyConfig,
): {
  exceeded: boolean;
  info?: { used: number; limit: number; percentage: number };
} {
  const key = getBudgetKey(request, config.budget);
  let usage = budgetUsage.get(key);

  if (!usage) {
    usage = { tokens: 0, dollars: 0, lastReset: new Date() };
    budgetUsage.set(key, usage);
  }

  // Guard against division by zero - if no budget limit, percentage is 0 (never exceeded)
  const percentage =
    config.budget.limits.totalDollars > 0
      ? (usage.dollars / config.budget.limits.totalDollars) * 100
      : 0;
  // Handle empty alertThresholds array - default to 100% (never exceeded)
  const maxThreshold =
    config.budget.alertThresholds.length > 0
      ? Math.max(...config.budget.alertThresholds) * 100
      : 100;

  return {
    exceeded: percentage >= maxThreshold,
    info: {
      used: usage.dollars,
      limit: config.budget.limits.totalDollars,
      percentage,
    },
  };
}

/**
 * Record token/cost usage.
 */
export async function recordUsage(
  workspaceId: string,
  agentId: string,
  sessionId: string,
  tokens: number,
  dollars: number,
): Promise<void> {
  const config = await getConfig(workspaceId);
  const key = getBudgetKey(
    {
      workspaceId,
      agentId,
      sessionId,
      operation: { type: "resources", fields: {} },
    },
    config.budget,
  );

  let usage = budgetUsage.get(key);
  if (!usage) {
    usage = { tokens: 0, dollars: 0, lastReset: new Date() };
  }

  usage.tokens += tokens;
  usage.dollars += dollars;
  // Update lastReset to track when this entry was last active (for cleanup)
  usage.lastReset = new Date();
  budgetUsage.set(key, usage);

  // Check for threshold alerts
  // Guard against division by zero - if no budget limit, skip threshold alerts
  if (config.budget.limits.totalDollars <= 0) {
    return;
  }
  const percentage = (usage.dollars / config.budget.limits.totalDollars) * 100;
  for (const threshold of config.budget.alertThresholds) {
    const thresholdPct = threshold * 100;
    const prevPercentage =
      ((usage.dollars - dollars) / config.budget.limits.totalDollars) * 100;

    if (percentage >= thresholdPct && prevPercentage < thresholdPct) {
      logger.warn(
        {
          workspaceId,
          agentId,
          sessionId,
          threshold: thresholdPct,
          used: usage.dollars,
          limit: config.budget.limits.totalDollars,
        },
        "Budget threshold reached",
      );
    }
  }
}

// ============================================================================
// Violations
// ============================================================================

/**
 * Get violations for a workspace.
 */
export async function getViolations(
  workspaceId: string,
  options?: {
    agentId?: string;
    sessionId?: string;
    severity?: SafetySeverity;
    action?: "blocked" | "warned" | "pending_approval";
    since?: Date;
    limit?: number;
  },
): Promise<SafetyViolation[]> {
  let filtered = violations.filter((v) => v.workspaceId === workspaceId);

  if (options?.agentId) {
    filtered = filtered.filter((v) => v.agentId === options.agentId);
  }
  if (options?.sessionId) {
    filtered = filtered.filter((v) => v.sessionId === options.sessionId);
  }
  if (options?.severity) {
    filtered = filtered.filter((v) => v.rule.severity === options.severity);
  }
  if (options?.action) {
    filtered = filtered.filter((v) => v.action === options.action);
  }
  if (options?.since) {
    const since = options.since;
    filtered = filtered.filter((v) => v.timestamp >= since);
  }

  // Sort by timestamp descending
  filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  if (options?.limit) {
    filtered = filtered.slice(0, options.limit);
  }

  return filtered;
}

/**
 * Get violation statistics.
 */
export async function getViolationStats(workspaceId: string): Promise<{
  total: number;
  blocked: number;
  warned: number;
  pendingApproval: number;
  bySeverity: Record<SafetySeverity, number>;
  byCategory: Record<SafetyCategory, number>;
  last24Hours: number;
}> {
  const wsViolations = violations.filter((v) => v.workspaceId === workspaceId);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const stats = {
    total: wsViolations.length,
    blocked: 0,
    warned: 0,
    pendingApproval: 0,
    bySeverity: {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    } as Record<SafetySeverity, number>,
    byCategory: {
      filesystem: 0,
      git: 0,
      network: 0,
      execution: 0,
      resources: 0,
      content: 0,
    } as Record<SafetyCategory, number>,
    last24Hours: 0,
  };

  for (const v of wsViolations) {
    if (v.action === "blocked") stats.blocked++;
    else if (v.action === "warned") stats.warned++;
    else if (v.action === "pending_approval") stats.pendingApproval++;

    stats.bySeverity[v.rule.severity]++;
    stats.byCategory[v.operation.type]++;

    if (v.timestamp >= oneDayAgo) {
      stats.last24Hours++;
    }
  }

  return stats;
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get safety statistics for a workspace.
 */
export async function getSafetyStats(workspaceId: string): Promise<{
  config: {
    enabled: boolean;
    categoriesEnabled: SafetyCategory[];
    totalRules: number;
    enabledRules: number;
  };
  rules: ReturnType<typeof getRuleStats>;
  violations: Awaited<ReturnType<typeof getViolationStats>>;
}> {
  const config = await getConfig(workspaceId);

  const allRules: SafetyRule[] = [];
  const enabledCategories: SafetyCategory[] = [];

  for (const [category, catConfig] of Object.entries(config.categories)) {
    if (catConfig.enabled) {
      enabledCategories.push(category as SafetyCategory);
    }
    allRules.push(...catConfig.rules);
  }

  return {
    config: {
      enabled: config.enabled,
      categoriesEnabled: enabledCategories,
      totalRules: allRules.length,
      enabledRules: allRules.filter((r) => r.enabled).length,
    },
    rules: getRuleStats(allRules),
    violations: await getViolationStats(workspaceId),
  };
}

// ============================================================================
// Emergency Controls
// ============================================================================

/**
 * Emergency kill switch - immediately disable all agent operations.
 */
export async function emergencyStop(
  workspaceId: string,
  reason: string,
  initiatedBy: string,
): Promise<void> {
  const config = await getConfig(workspaceId);

  // Disable all safety (which blocks everything by default)
  config.enabled = true;

  // Add deny-all rule
  const denyAllRule: SafetyRule = {
    id: generateId("rule"),
    name: "Emergency Stop",
    description: `Emergency stop initiated by ${initiatedBy}: ${reason}`,
    category: "execution",
    conditions: [{ field: "command", patternType: "glob", pattern: "*" }],
    conditionLogic: "and",
    action: "deny",
    severity: "critical",
    message: `Emergency stop active: ${reason}`,
    enabled: true,
  };

  config.categories.execution.rules.unshift(denyAllRule);
  config.categories.filesystem.rules.unshift({
    ...denyAllRule,
    id: generateId("rule"),
    category: "filesystem",
  });
  config.categories.git.rules.unshift({
    ...denyAllRule,
    id: generateId("rule"),
    category: "git",
  });
  config.categories.network.rules.unshift({
    ...denyAllRule,
    id: generateId("rule"),
    category: "network",
  });

  config.updatedAt = new Date();
  configs.set(workspaceId, config);

  logger.warn(
    {
      workspaceId,
      reason,
      initiatedBy,
    },
    "Emergency stop activated",
  );
}

/**
 * Clear emergency stop state.
 */
export async function clearEmergencyStop(
  workspaceId: string,
  clearedBy: string,
): Promise<void> {
  const config = await getConfig(workspaceId);

  // Remove emergency stop rules
  for (const category of Object.values(config.categories)) {
    category.rules = category.rules.filter((r) => r.name !== "Emergency Stop");
  }

  config.updatedAt = new Date();
  configs.set(workspaceId, config);

  logger.info(
    {
      workspaceId,
      clearedBy,
    },
    "Emergency stop cleared",
  );
}

// ============================================================================
// Testing Helpers
// ============================================================================

/**
 * Clear all safety data (for testing).
 */
export function _clearAllSafetyData(): void {
  stopCleanupJob();
  configs.clear();
  violations.length = 0;
  rateLimitCounters.clear();
  budgetUsage.clear();
}

/**
 * Get raw violations array (for testing).
 */
export function _getViolations(): SafetyViolation[] {
  return violations;
}
