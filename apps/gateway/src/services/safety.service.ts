/**
 * SLB Safety Service.
 *
 * Main orchestration layer for safety guardrails.
 * Coordinates rule evaluation, rate limiting, budget tracking,
 * and approval workflows.
 *
 * Persists configuration and violations to the database.
 * Rate limits are kept in-memory for performance.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  budgetUsage as budgetUsageTable,
  safetyConfigs,
  safetyRules,
  safetyViolations,
} from "../db/schema";
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
      const byte = randomBytes[i];
      if (byte !== undefined && byte < maxByte) {
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
// In-Memory State (Rate Limits Only)
// ============================================================================

/** Rate limit counters: key -> { count, resetAt } */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimitCounters = new Map<string, RateLimitEntry>();

/** Cleanup job handle */
let cleanupIntervalHandle: ReturnType<typeof setInterval> | null = null;

/** Cleanup interval in milliseconds (default: 5 minutes) */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** How long to keep inactive budget entries (24 hours) - handled via DB query now */
// const BUDGET_INACTIVE_TTL_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// Cleanup Job
// ============================================================================

/**
 * Clean up expired rate limit entries.
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  let rateLimitCleaned = 0;

  // Clean up expired rate limit entries
  for (const [key, entry] of rateLimitCounters) {
    if (entry.resetAt <= now) {
      rateLimitCounters.delete(key);
      rateLimitCleaned++;
    }
  }

  if (rateLimitCleaned > 0) {
    logger.debug(
      {
        rateLimitCleaned,
        rateLimitRemaining: rateLimitCounters.size,
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
} {
  return {
    rateLimitEntries: rateLimitCounters.size,
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
 * Helper to persist a full configuration to the database.
 */
async function persistConfig(config: SafetyConfig): Promise<void> {
  const categoryEnables = {
    filesystem: config.categories.filesystem.enabled,
    git: config.categories.git.enabled,
    network: config.categories.network.enabled,
    execution: config.categories.execution.enabled,
    resources: config.categories.resources.enabled,
    content: config.categories.content.enabled,
  };

  // Upsert config
  await db
    .insert(safetyConfigs)
    .values({
      id: config.id,
      workspaceId: config.workspaceId,
      name: config.name,
      description: config.description,
      enabled: config.enabled,
      categoryEnables: JSON.stringify(categoryEnables),
      rateLimits: JSON.stringify(config.rateLimits),
      budget: JSON.stringify(config.budget),
      approvalWorkflow: JSON.stringify(config.approvalWorkflow),
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    })
    .onConflictDoUpdate({
      target: safetyConfigs.id,
      set: {
        name: config.name,
        description: config.description,
        enabled: config.enabled,
        categoryEnables: JSON.stringify(categoryEnables),
        rateLimits: JSON.stringify(config.rateLimits),
        budget: JSON.stringify(config.budget),
        approvalWorkflow: JSON.stringify(config.approvalWorkflow),
        updatedAt: config.updatedAt,
      },
    });

  // Upsert rules
  // Note: This is simplified. Ideally we should diff/delete removed rules.
  // For now, we assume this function is called on creation or bulk update.
  // Individual rule ops update rules directly.
  for (const category of Object.values(config.categories)) {
    for (const rule of category.rules) {
      await db
        .insert(safetyRules)
        .values({
          id: rule.id,
          configId: config.id,
          workspaceId: config.workspaceId,
          name: rule.name,
          description: rule.description,
          category: rule.category,
          conditions: JSON.stringify(rule.conditions),
          conditionLogic: rule.conditionLogic,
          action: rule.action,
          severity: rule.severity,
          message: rule.message,
          enabled: rule.enabled,
          alternatives: rule.alternatives
            ? JSON.stringify(rule.alternatives)
            : null,
          priority: 100, // Default priority
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: safetyRules.id,
          set: {
            name: rule.name,
            description: rule.description,
            category: rule.category,
            conditions: JSON.stringify(rule.conditions),
            conditionLogic: rule.conditionLogic,
            action: rule.action,
            severity: rule.severity,
            message: rule.message,
            enabled: rule.enabled,
            alternatives: rule.alternatives
              ? JSON.stringify(rule.alternatives)
              : null,
            updatedAt: new Date(),
          },
        });
    }
  }
}

/**
 * Get safety config for a workspace.
 */
export async function getConfig(workspaceId: string): Promise<SafetyConfig> {
  // Fetch from DB
  const configRow = await db.query.safetyConfigs.findFirst({
    where: eq(safetyConfigs.workspaceId, workspaceId),
  });

  if (!configRow) {
    const defaultConfig = createDefaultConfig(workspaceId);
    await persistConfig(defaultConfig);
    return defaultConfig;
  }

  // Fetch rules
  const ruleRows = await db.query.safetyRules.findMany({
    where: eq(safetyRules.configId, configRow.id),
  });

  // Reconstruct config object
  const categoryEnables = JSON.parse(configRow.categoryEnables);
  const categories: SafetyConfig["categories"] = {
    filesystem: { enabled: categoryEnables.filesystem ?? true, rules: [] },
    git: { enabled: categoryEnables.git ?? true, rules: [] },
    network: { enabled: categoryEnables.network ?? true, rules: [] },
    execution: { enabled: categoryEnables.execution ?? true, rules: [] },
    resources: { enabled: categoryEnables.resources ?? true, rules: [] },
    content: { enabled: categoryEnables.content ?? true, rules: [] },
  };

  for (const row of ruleRows) {
    const rule: SafetyRule = {
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      category: row.category as SafetyCategory,
      conditions: JSON.parse(row.conditions),
      conditionLogic: row.conditionLogic as "and" | "or",
      action: row.action as SafetyAction,
      severity: row.severity as SafetySeverity,
      message: row.message,
      enabled: row.enabled,
      ...(row.alternatives
        ? { alternatives: JSON.parse(row.alternatives) as string[] }
        : {}),
    };
    categories[rule.category].rules.push(rule);
  }

  return {
    id: configRow.id,
    workspaceId: configRow.workspaceId,
    name: configRow.name,
    ...(configRow.description !== null && configRow.description !== undefined
      ? { description: configRow.description }
      : {}),
    enabled: configRow.enabled,
    categories,
    rateLimits: JSON.parse(configRow.rateLimits),
    budget: JSON.parse(configRow.budget),
    approvalWorkflow: JSON.parse(configRow.approvalWorkflow),
    createdAt: configRow.createdAt,
    updatedAt: configRow.updatedAt,
  };
}

/**
 * Update safety config for a workspace.
 */
export async function updateConfig(
  workspaceId: string,
  updates: Partial<Omit<SafetyConfig, "id" | "workspaceId" | "createdAt">>,
): Promise<SafetyConfig> {
  const config = await getConfig(workspaceId);

  // Apply updates to the in-memory object
  Object.assign(config, updates, { updatedAt: new Date() });

  // Persist updated fields to DB
  const categoryEnables = {
    filesystem: config.categories.filesystem.enabled,
    git: config.categories.git.enabled,
    network: config.categories.network.enabled,
    execution: config.categories.execution.enabled,
    resources: config.categories.resources.enabled,
    content: config.categories.content.enabled,
  };

  await db
    .update(safetyConfigs)
    .set({
      name: config.name,
      description: config.description,
      enabled: config.enabled,
      categoryEnables: JSON.stringify(categoryEnables),
      rateLimits: JSON.stringify(config.rateLimits),
      budget: JSON.stringify(config.budget),
      approvalWorkflow: JSON.stringify(config.approvalWorkflow),
      updatedAt: config.updatedAt,
    })
    .where(eq(safetyConfigs.id, config.id));

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

  await db.insert(safetyRules).values({
    id: newRule.id,
    configId: config.id,
    workspaceId: config.workspaceId,
    name: newRule.name,
    description: newRule.description,
    category: newRule.category,
    conditions: JSON.stringify(newRule.conditions),
    conditionLogic: newRule.conditionLogic,
    action: newRule.action,
    severity: newRule.severity,
    message: newRule.message,
    enabled: newRule.enabled,
    alternatives: newRule.alternatives
      ? JSON.stringify(newRule.alternatives)
      : null,
    priority: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

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
  const result = await db
    .delete(safetyRules)
    .where(
      and(eq(safetyRules.id, ruleId), eq(safetyRules.workspaceId, workspaceId)),
    )
    .returning({ id: safetyRules.id });

  if (result.length > 0) {
    // Update config timestamp
    const config = await getConfig(workspaceId);
    await db
      .update(safetyConfigs)
      .set({ updatedAt: new Date() })
      .where(eq(safetyConfigs.id, config.id));

    logger.info({ workspaceId, ruleId }, "Safety rule removed");
    return true;
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
  const result = await db
    .update(safetyRules)
    .set({
      enabled,
      updatedAt: new Date(),
    })
    .where(
      and(eq(safetyRules.id, ruleId), eq(safetyRules.workspaceId, workspaceId)),
    )
    .returning();

  if (result.length > 0) {
    const row = result[0]!;
    // Update config timestamp
    const config = await getConfig(workspaceId);
    await db
      .update(safetyConfigs)
      .set({ updatedAt: new Date() })
      .where(eq(safetyConfigs.id, config.id));

    logger.info({ workspaceId, ruleId, enabled }, "Safety rule toggled");

    return {
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      category: row.category as SafetyCategory,
      conditions: JSON.parse(row.conditions),
      conditionLogic: row.conditionLogic as "and" | "or",
      action: row.action as SafetyAction,
      severity: row.severity as SafetySeverity,
      message: row.message,
      enabled: row.enabled,
      ...(row.alternatives
        ? { alternatives: JSON.parse(row.alternatives) as string[] }
        : {}),
    };
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
  const budgetResult = await checkBudget(request, config);
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

      result.violations.push(violation);

      // Persist violation to DB
      await db.insert(safetyViolations).values({
        id: violation.id,
        workspaceId: violation.workspaceId,
        agentId: violation.agentId,
        sessionId: violation.sessionId,
        ruleId: violation.rule.id,
        ruleName: violation.rule.name,
        ruleCategory: violation.rule.category,
        ruleSeverity: violation.rule.severity,
        operationType: violation.operation.type,
        operationDetails: JSON.stringify(violation.operation.details),
        actionTaken: violation.action,
        taskDescription: violation.context.taskDescription,
        recentHistory: JSON.stringify(violation.context.recentHistory),
        correlationId: violation.correlationId,
        timestamp: violation.timestamp,
      });
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
): { scope: string; scopeId: string } {
  switch (config.scope) {
    case "agent":
      return { scope: "agent", scopeId: request.agentId };
    case "workspace":
      return { scope: "workspace", scopeId: request.workspaceId };
    case "session":
      return { scope: "session", scopeId: request.sessionId };
    default:
      throw new Error(`Invalid budget scope: ${config.scope}`);
  }
}

async function checkBudget(
  request: PreFlightCheckRequest,
  config: SafetyConfig,
): Promise<{
  exceeded: boolean;
  info?: { used: number; limit: number; percentage: number };
}> {
  const { scope, scopeId } = getBudgetKey(request, config.budget);

  // Get usage for the current period (assuming infinite/cumulative for now as period isn't defined in request)
  // In a real implementation, we'd determine the period based on config (e.g. daily, monthly).
  // For simplicity here, we'll check the total usage in the budgetUsage table for this scope.
  // Note: The schema has periodStart/periodEnd. We'll query for the 'active' one.

  const usageRow = await db.query.budgetUsage.findFirst({
    where: and(
      eq(budgetUsageTable.workspaceId, request.workspaceId),
      eq(budgetUsageTable.scope, scope),
      eq(budgetUsageTable.scopeId, scopeId),
    ),
    orderBy: desc(budgetUsageTable.periodStart), // Get most recent
  });

  const usedDollars = usageRow?.dollarsUsed ?? 0;

  // Guard against division by zero - if no budget limit, percentage is 0 (never exceeded)
  const percentage =
    config.budget.limits.totalDollars > 0
      ? (usedDollars / config.budget.limits.totalDollars) * 100
      : 0;
  // Handle empty alertThresholds array - default to 100% (never exceeded)
  const maxThreshold =
    config.budget.alertThresholds.length > 0
      ? Math.max(...config.budget.alertThresholds) * 100
      : 100;

  return {
    exceeded: percentage >= maxThreshold,
    info: {
      used: usedDollars,
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
  const { scope, scopeId } = getBudgetKey(
    {
      workspaceId,
      agentId,
      sessionId,
      operation: { type: "resources", fields: {} },
    },
    config.budget,
  );

  // Simple daily period for now
  const now = new Date();
  const periodStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );

  // Generate ID based on scope/period to upsert
  const id = `budg_${scope}_${scopeId}_${periodStart.getTime()}`;

  // Upsert usage
  // We need to fetch first to add to existing, or rely on sql increment (drizzle support depends on driver)
  // SQLite supports upsert with conflict targets.

  await db
    .insert(budgetUsageTable)
    .values({
      id,
      workspaceId,
      scope,
      scopeId,
      tokensUsed: tokens,
      dollarsUsed: dollars,
      periodStart,
      lastUpdatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        budgetUsageTable.scope,
        budgetUsageTable.scopeId,
        budgetUsageTable.periodStart,
      ],
      set: {
        tokensUsed: sql`${budgetUsageTable.tokensUsed} + ${tokens}`,
        dollarsUsed: sql`${budgetUsageTable.dollarsUsed} + ${dollars}`,
        lastUpdatedAt: new Date(),
      },
    });

  // Check for threshold alerts (read back updated value)
  if (config.budget.limits.totalDollars <= 0) {
    return;
  }

  const updatedUsage = await db.query.budgetUsage.findFirst({
    where: eq(budgetUsageTable.id, id),
  });

  if (!updatedUsage) return;

  const currentDollars = updatedUsage.dollarsUsed;
  const percentage = (currentDollars / config.budget.limits.totalDollars) * 100;

  for (const threshold of config.budget.alertThresholds) {
    const thresholdPct = threshold * 100;
    const prevPercentage =
      ((currentDollars - dollars) / config.budget.limits.totalDollars) * 100;

    if (percentage >= thresholdPct && prevPercentage < thresholdPct) {
      logger.warn(
        {
          workspaceId,
          agentId,
          sessionId,
          threshold: thresholdPct,
          used: currentDollars,
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
  const conditions = [eq(safetyViolations.workspaceId, workspaceId)];

  if (options?.agentId) {
    conditions.push(eq(safetyViolations.agentId, options.agentId));
  }
  if (options?.sessionId) {
    conditions.push(eq(safetyViolations.sessionId, options.sessionId));
  }
  if (options?.severity) {
    conditions.push(eq(safetyViolations.ruleSeverity, options.severity));
  }
  if (options?.action) {
    conditions.push(eq(safetyViolations.actionTaken, options.action));
  }
  if (options?.since) {
    // SQLite stores dates as numbers usually with Drizzle timestamp mode
    // but here safetyViolations.timestamp is configured as integer/timestamp
    conditions.push(sql`${safetyViolations.timestamp} >= ${options.since}`);
  }

  const rows = await db
    .select()
    .from(safetyViolations)
    .where(and(...conditions))
    .orderBy(desc(safetyViolations.timestamp))
    .limit(options?.limit ?? 50);

  return rows.map((row) => {
    const context: SafetyViolation["context"] = {
      recentHistory: row.recentHistory
        ? (JSON.parse(row.recentHistory as string) as string[])
        : [],
      ...(row.taskDescription !== null && row.taskDescription !== undefined
        ? { taskDescription: row.taskDescription }
        : {}),
    };

    const action: SafetyViolation["action"] =
      row.actionTaken === "blocked" ||
      row.actionTaken === "warned" ||
      row.actionTaken === "pending_approval"
        ? row.actionTaken
        : "blocked";

    return {
      id: row.id,
      timestamp: row.timestamp,
      agentId: row.agentId ?? "unknown",
      sessionId: row.sessionId ?? "unknown",
      workspaceId: row.workspaceId,
      rule: {
        id: row.ruleId ?? "unknown",
        name: row.ruleName,
        description: "",
        category: row.ruleCategory as SafetyCategory,
        severity: row.ruleSeverity as SafetySeverity,
        action: "deny",
        conditions: [],
        conditionLogic: "and",
        message: "",
        enabled: true,
      },
      operation: {
        type: row.operationType as SafetyCategory,
        details: (row.operationDetails ?? {}) as Record<string, unknown>,
      },
      action,
      context,
      ...(row.correlationId !== null && row.correlationId !== undefined
        ? { correlationId: row.correlationId }
        : {}),
    };
  });
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
  const violations = await getViolations(workspaceId, { limit: 10000 }); // Reasonable limit for stats
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const stats = {
    total: violations.length,
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

  for (const v of violations) {
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
  const denyAllRule: Omit<SafetyRule, "id"> = {
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

  // We add this rule to the DB directly
  await addRule(workspaceId, denyAllRule);
  await addRule(workspaceId, { ...denyAllRule, category: "filesystem" });
  await addRule(workspaceId, { ...denyAllRule, category: "git" });
  await addRule(workspaceId, { ...denyAllRule, category: "network" });

  await updateConfig(workspaceId, { enabled: true });

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
  // Find and remove emergency stop rules
  const stopRules = await db.query.safetyRules.findMany({
    where: and(
      eq(safetyRules.workspaceId, workspaceId),
      eq(safetyRules.name, "Emergency Stop"),
    ),
  });

  for (const rule of stopRules) {
    await removeRule(workspaceId, rule.id);
  }

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
export async function _clearAllSafetyData(): Promise<void> {
  stopCleanupJob();
  await db.delete(safetyViolations);
  await db.delete(safetyRules);
  await db.delete(safetyConfigs);
  await db.delete(budgetUsageTable);
  rateLimitCounters.clear();
}

/**
 * Get raw violations array (for testing).
 */
export async function _getViolations(): Promise<SafetyViolation[]> {
  // We can't return the raw array anymore, so we return from DB
  // This might break tests expecting synchronous access, but that's necessary.
  return getViolations("default", { limit: 1000 });
}
