/**
 * Handoff Context Service - Context packaging and validation.
 *
 * Handles:
 * - Building context from agent state
 * - Validating context completeness
 * - Sanitizing sensitive data
 * - Calculating context size
 * - Serialization/deserialization
 */

import type {
  Decision,
  EnvironmentSnapshot,
  FileModification,
  HandoffContext,
  HandoffTodoItem,
  Hypothesis,
  TaskPhase,
  UncommittedChange,
} from "@flywheel/shared/types";
import { logger } from "./logger";

// ============================================================================
// Constants
// ============================================================================

/** Maximum context size in bytes (1MB) */
const MAX_CONTEXT_SIZE_BYTES = 1_048_576;

/** Maximum conversation summary length */
const MAX_SUMMARY_LENGTH = 10_000;

/** Maximum number of decisions to include */
const MAX_DECISIONS = 100;

/** Sensitive env var patterns to redact */
const SENSITIVE_ENV_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /token/i,
  /credential/i,
  /auth/i,
  /private/i,
];

// ============================================================================
// Types
// ============================================================================

/**
 * Parameters for building context from agent state.
 */
export interface BuildContextParams {
  agentId: string;
  beadId?: string;
  taskDescription: string;
  currentPhase?: TaskPhase;
  progressPercentage?: number;
  startedAt?: Date;
  conversationHistory?: Array<{
    role: string;
    content: string;
    timestamp?: Date;
  }>;
  workingDirectory?: string;
  gitBranch?: string;
  gitCommit?: string;
  uncommittedFiles?: string[];
  envVars?: Record<string, string>;
  filesModified?: FileModification[];
  filesCreated?: string[];
  filesDeleted?: string[];
  uncommittedChanges?: UncommittedChange[];
  decisionsMade?: Decision[];
  todoItems?: HandoffTodoItem[];
  workingMemory?: Record<string, unknown>;
  hypotheses?: Hypothesis[];
  keyPoints?: string[];
  userRequirements?: string[];
  constraints?: string[];
}

/**
 * Result of context validation.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sizeBytes: number;
}

/**
 * Result of building context.
 */
export interface BuildContextResult {
  context: HandoffContext;
  validation: ValidationResult;
}

// ============================================================================
// Context Building
// ============================================================================

/**
 * Build handoff context from agent state.
 */
export function buildContext(params: BuildContextParams): BuildContextResult {
  const log = logger.child({
    service: "handoff-context",
    agentId: params.agentId,
    beadId: params.beadId,
  });

  // Build conversation summary
  const conversationSummary = summarizeConversation(
    params.conversationHistory ?? [],
  );

  // Sanitize environment variables
  const sanitizedEnvVars = sanitizeEnvVars(params.envVars ?? {});

  // Build environment snapshot
  const environmentSnapshot: EnvironmentSnapshot = {
    workingDirectory: params.workingDirectory ?? process.cwd(),
    gitBranch: params.gitBranch ?? "main",
    gitCommit: params.gitCommit ?? "",
    uncommittedFiles: params.uncommittedFiles ?? [],
    envVars: sanitizedEnvVars,
  };

  // Trim decisions if too many
  let decisions = params.decisionsMade ?? [];
  if (decisions.length > MAX_DECISIONS) {
    log.debug(
      { original: decisions.length, trimmed: MAX_DECISIONS },
      "Trimmed decisions list",
    );
    decisions = decisions.slice(-MAX_DECISIONS);
  }

  const context: HandoffContext = {
    beadId: params.beadId,
    taskDescription: params.taskDescription,
    currentPhase: params.currentPhase ?? "planning",
    progressPercentage: params.progressPercentage ?? 0,
    startedAt: params.startedAt ?? new Date(),

    filesModified: params.filesModified ?? [],
    filesCreated: params.filesCreated ?? [],
    filesDeleted: params.filesDeleted ?? [],
    uncommittedChanges: params.uncommittedChanges ?? [],

    decisionsMade: decisions,

    conversationSummary,
    keyPoints: params.keyPoints ?? [],
    userRequirements: params.userRequirements ?? [],
    constraints: params.constraints ?? [],

    workingMemory: sanitizeWorkingMemory(params.workingMemory ?? {}),
    hypotheses: params.hypotheses ?? [],
    todoItems: params.todoItems ?? [],

    environmentSnapshot,
  };

  // Validate the built context
  const validation = validateContext(context);

  log.info(
    {
      sizeBytes: validation.sizeBytes,
      valid: validation.valid,
      warnings: validation.warnings.length,
    },
    "Context built",
  );

  return { context, validation };
}

/**
 * Summarize conversation history.
 */
function summarizeConversation(
  history: Array<{ role: string; content: string; timestamp?: Date }>,
): string {
  if (history.length === 0) {
    return "";
  }

  // Build a summary from the conversation
  const parts: string[] = [];

  // Get user messages for context
  const userMessages = history.filter((m) => m.role === "user");
  if (userMessages.length > 0) {
    parts.push("User requests:");
    // Take first and last few user messages
    const first = userMessages.slice(0, 2);
    const last = userMessages.slice(-2);
    const samples = [...new Set([...first, ...last])];
    for (const msg of samples) {
      const preview = msg.content.slice(0, 200);
      parts.push(`  - ${preview}${msg.content.length > 200 ? "..." : ""}`);
    }
  }

  // Get assistant messages for responses
  const assistantMessages = history.filter((m) => m.role === "assistant");
  if (assistantMessages.length > 0) {
    parts.push("\nKey responses:");
    // Take last few assistant messages
    const recent = assistantMessages.slice(-3);
    for (const msg of recent) {
      const preview = msg.content.slice(0, 300);
      parts.push(`  - ${preview}${msg.content.length > 300 ? "..." : ""}`);
    }
  }

  let summary = parts.join("\n");

  // Truncate if too long
  if (summary.length > MAX_SUMMARY_LENGTH) {
    summary = `${summary.slice(0, MAX_SUMMARY_LENGTH)}\n\n[Summary truncated]`;
  }

  return summary;
}

/**
 * Sanitize environment variables by redacting sensitive values.
 */
function sanitizeEnvVars(
  envVars: Record<string, string>,
): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(envVars)) {
    const isSensitive = SENSITIVE_ENV_PATTERNS.some((pattern) =>
      pattern.test(key),
    );

    if (isSensitive) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Sanitize working memory by removing any sensitive-looking keys.
 */
function sanitizeWorkingMemory(
  memory: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(memory)) {
    const isSensitive = SENSITIVE_ENV_PATTERNS.some((pattern) =>
      pattern.test(key),
    );

    if (isSensitive) {
      sanitized[key] = "[REDACTED]";
    } else if (Array.isArray(value)) {
      // Handle arrays: recursively sanitize each element that's an object
      sanitized[key] = value.map((item) =>
        typeof item === "object" && item !== null
          ? sanitizeWorkingMemory(item as Record<string, unknown>)
          : item,
      );
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeWorkingMemory(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate handoff context for completeness and size.
 */
export function validateContext(context: HandoffContext): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Calculate size
  const serialized = JSON.stringify(context);
  const sizeBytes = new TextEncoder().encode(serialized).length;

  // Check size limit
  if (sizeBytes > MAX_CONTEXT_SIZE_BYTES) {
    errors.push(
      `Context size (${sizeBytes} bytes) exceeds maximum (${MAX_CONTEXT_SIZE_BYTES} bytes)`,
    );
  }

  // Required fields
  if (!context.taskDescription || context.taskDescription.trim() === "") {
    errors.push("Task description is required");
  }

  // Warnings for missing optional but useful fields
  if (
    !context.conversationSummary ||
    context.conversationSummary.trim() === ""
  ) {
    warnings.push("No conversation summary provided");
  }

  if (context.decisionsMade.length === 0) {
    warnings.push("No decisions recorded");
  }

  if (context.todoItems.length === 0) {
    warnings.push("No todo items recorded");
  }

  if (!context.environmentSnapshot.gitCommit) {
    warnings.push("No git commit recorded");
  }

  // Check for incomplete progress
  if (
    context.progressPercentage > 0 &&
    context.progressPercentage < 100 &&
    context.todoItems.filter((t) => t.status === "pending").length === 0
  ) {
    warnings.push("Progress > 0% but no pending todos");
  }

  // Check file modifications have required fields
  for (const file of context.filesModified) {
    if (!file.path) {
      errors.push("File modification missing path");
    }
    if (!file.changeDescription) {
      warnings.push(`File ${file.path} missing change description`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sizeBytes,
  };
}

/**
 * Calculate context size in bytes.
 */
export function calculateContextSize(context: HandoffContext): number {
  const serialized = JSON.stringify(context);
  return new TextEncoder().encode(serialized).length;
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serialize context to JSON string.
 */
export function serializeContext(context: HandoffContext): string {
  return JSON.stringify(context, (_key, value) => {
    // Handle Date serialization
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  });
}

/**
 * Deserialize context from JSON string.
 */
export function deserializeContext(json: string): HandoffContext {
  const parsed = JSON.parse(json);

  // Restore Date objects
  if (parsed.startedAt) {
    parsed.startedAt = new Date(parsed.startedAt);
  }

  for (const decision of parsed.decisionsMade ?? []) {
    if (decision.timestamp) {
      decision.timestamp = new Date(decision.timestamp);
    }
  }

  return parsed as HandoffContext;
}

// ============================================================================
// Context Extraction Helpers
// ============================================================================

/**
 * Extract file modifications from git diff output.
 */
export function extractFileModifications(gitDiff: string): FileModification[] {
  const modifications: FileModification[] = [];
  const filePattern = /^diff --git a\/(.+) b\/(.+)$/gm;

  let match: RegExpExecArray | null = filePattern.exec(gitDiff);
  while (match !== null) {
    const path = match[2] ?? match[1] ?? "";
    modifications.push({
      path,
      originalHash: "",
      currentHash: "",
      changeDescription: `Modified: ${path}`,
    });
    match = filePattern.exec(gitDiff);
  }

  return modifications;
}

/**
 * Extract uncommitted changes from git status output.
 */
export function extractUncommittedChanges(
  gitStatus: string,
): UncommittedChange[] {
  const changes: UncommittedChange[] = [];
  const lines = gitStatus.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("?? ")) {
      // Untracked file: ?? filename
      const path = trimmed.slice(3).trim();
      changes.push({
        path,
        diff: "",
        reason: "New file",
      });
    } else if (trimmed.startsWith("M ") || trimmed.startsWith("A ")) {
      // Modified or Added: M filename or A filename
      const path = trimmed.slice(2).trim();
      changes.push({
        path,
        diff: "",
        reason: "Modified",
      });
    }
  }

  return changes;
}

/**
 * Create a minimal context for quick handoffs.
 */
export function createMinimalContext(
  taskDescription: string,
  summary: string,
): HandoffContext {
  return {
    taskDescription,
    currentPhase: "planning",
    progressPercentage: 0,
    startedAt: new Date(),

    filesModified: [],
    filesCreated: [],
    filesDeleted: [],
    uncommittedChanges: [],

    decisionsMade: [],

    conversationSummary: summary,
    keyPoints: [],
    userRequirements: [],
    constraints: [],

    workingMemory: {},
    hypotheses: [],
    todoItems: [],

    environmentSnapshot: {
      workingDirectory: process.cwd(),
      gitBranch: "main",
      gitCommit: "",
      uncommittedFiles: [],
      envVars: {},
    },
  };
}
