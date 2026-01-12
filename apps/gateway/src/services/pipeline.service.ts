/**
 * Pipeline Service - Manages pipeline lifecycle and execution.
 *
 * Provides:
 * - CRUD operations for pipelines
 * - Pipeline execution engine
 * - Step executors for each step type
 * - Checkpoint and resume
 * - Retry with exponential backoff
 */

import { getLogger } from "../middleware/correlation";
import {
  type AgentTaskConfig,
  type ApprovalConfig,
  type ApprovalRecord,
  type ConditionalConfig,
  type CreatePipelineInput,
  DEFAULT_RETRY_POLICY,
  type ParallelConfig,
  type Pipeline,
  type PipelineFilter,
  type PipelineRun,
  type PipelineRunFilter,
  type PipelineStatus,
  type PipelineStep,
  type RetryPolicy,
  type ScriptConfig,
  type StepResult,
  type StepStatus,
  type UpdatePipelineInput,
} from "../models/pipeline";
import { spawnAgent, sendMessage, terminateAgent } from "./agent";

// ============================================================================
// In-Memory Storage
// ============================================================================

/** Storage for pipelines */
const pipelines = new Map<string, Pipeline>();

/** Storage for pipeline runs */
const runs = new Map<string, PipelineRun>();

/** Pending approvals: runId -> stepId -> Promise resolver */
const pendingApprovals = new Map<
  string,
  Map<string, (decision: ApprovalRecord) => void>
>();

/** Active run controllers for cancellation */
const activeRunControllers = new Map<string, AbortController>();

// ============================================================================
// ID Generation
// ============================================================================

function generatePipelineId(): string {
  const randomBytes = new Uint8Array(6);
  crypto.getRandomValues(randomBytes);
  const random = Array.from(randomBytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 8);
  return `pipe_${Date.now()}_${random}`;
}

function generateRunId(): string {
  const randomBytes = new Uint8Array(6);
  crypto.getRandomValues(randomBytes);
  const random = Array.from(randomBytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 8);
  return `run_${Date.now()}_${random}`;
}

// ============================================================================
// Context Variable Substitution
// ============================================================================

/**
 * Substitute variables in a string using the context.
 * Supports ${context.variable} syntax.
 */
function substituteVariables(
  template: string,
  context: Record<string, unknown>,
): string {
  return template.replace(/\$\{context\.([^}]+)\}/g, (_, path) => {
    const parts = path.split(".");
    let value: unknown = context;
    for (const part of parts) {
      if (typeof value !== "object" || value === null) {
        return "";
      }
      value = (value as Record<string, unknown>)[part];
    }
    return value !== undefined ? String(value) : "";
  });
}

/**
 * Evaluate a simple condition expression.
 * Supports: ==, !=, >, <, >=, <=, &&, ||
 */
function evaluateCondition(
  condition: string,
  context: Record<string, unknown>,
): boolean {
  // Substitute variables first
  const substituted = substituteVariables(condition, context);

  // Simple evaluation for common patterns
  // Note: For production, consider using a proper expression parser
  try {
    // Handle boolean literals
    if (substituted === "true") return true;
    if (substituted === "false") return false;

    // Handle comparison operators
    const comparisonMatch = substituted.match(
      /^(.+?)\s*(===?|!==?|>=?|<=?)\s*(.+)$/,
    );
    if (comparisonMatch) {
      const [, left, op, right] = comparisonMatch;
      const leftVal = left?.trim();
      const rightVal = right?.trim();

      // Parse values
      const parseValue = (v: string | undefined): unknown => {
        if (v === undefined) return undefined;
        if (v === "true") return true;
        if (v === "false") return false;
        if (v === "null") return null;
        if (/^-?\d+(\.\d+)?$/.test(v)) return parseFloat(v);
        // Remove quotes for strings
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          return v.slice(1, -1);
        }
        return v;
      };

      const l = parseValue(leftVal);
      const r = parseValue(rightVal);

      switch (op) {
        case "==":
        case "===":
          return l === r;
        case "!=":
        case "!==":
          return l !== r;
        case ">":
          return Number(l) > Number(r);
        case "<":
          return Number(l) < Number(r);
        case ">=":
          return Number(l) >= Number(r);
        case "<=":
          return Number(l) <= Number(r);
      }
    }

    // Handle truthy/falsy check
    const val = substituteVariables(`\${context.${condition}}`, context);
    return !!val && val !== "false" && val !== "0" && val !== "";
  } catch {
    return false;
  }
}

// ============================================================================
// Retry Logic
// ============================================================================

/**
 * Sleep for a given duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate delay for retry with exponential backoff.
 */
function calculateRetryDelay(
  attemptNumber: number,
  policy: RetryPolicy,
): number {
  const multiplier = policy.multiplier ?? 2;
  const delay = policy.initialDelay * Math.pow(multiplier, attemptNumber);
  // Add jitter (10% random variation)
  const jitter = delay * 0.1 * Math.random();
  return Math.min(delay + jitter, policy.maxDelay);
}

/**
 * Execute a function with retry logic.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  isRetryable: (error: unknown) => boolean,
  signal?: AbortSignal,
): Promise<{ result: T; retryCount: number }> {
  let lastError: unknown;
  let retryCount = 0;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new Error("Execution cancelled");
    }

    try {
      const result = await fn();
      return { result, retryCount };
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt < policy.maxRetries && isRetryable(error)) {
        retryCount++;
        const delay = calculateRetryDelay(attempt, policy);
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }

  throw lastError;
}

// ============================================================================
// Step Executors
// ============================================================================

/**
 * Execute an agent_task step.
 */
async function executeAgentTask(
  config: AgentTaskConfig,
  context: Record<string, unknown>,
  _signal?: AbortSignal,
): Promise<unknown> {
  const log = getLogger();
  const prompt = substituteVariables(config.prompt, context);
  const workingDirectory =
    config.workingDirectory ?? (context["workingDirectory"] as string) ?? "/tmp";

  log.info(
    { workingDirectory, promptLength: prompt.length },
    "[PIPELINE] Executing agent_task step",
  );

  // Spawn agent
  const spawnConfig: Parameters<typeof spawnAgent>[0] = { workingDirectory };
  if (config.systemPrompt) spawnConfig.systemPrompt = config.systemPrompt;
  if (config.timeout) spawnConfig.timeout = config.timeout;
  if (config.maxTokens) spawnConfig.maxTokens = config.maxTokens;
  const spawnResult = await spawnAgent(spawnConfig);

  const agentId = spawnResult.agentId;

  try {
    // Send the prompt
    const messageResult = await sendMessage(agentId, "user", prompt);

    // If not waiting for completion, return immediately
    if (config.waitForCompletion === false) {
      return {
        agentId,
        messageId: messageResult.messageId,
        status: "submitted",
      };
    }

    // Wait for agent to complete (simplified - in production would poll or use events)
    // For now, return the message result
    return {
      agentId,
      messageId: messageResult.messageId,
      status: "completed",
    };
  } finally {
    // Terminate the agent
    try {
      await terminateAgent(agentId, true);
    } catch (err) {
      log.warn({ err, agentId }, "[PIPELINE] Failed to terminate agent");
    }
  }
}

/**
 * Execute a conditional step.
 */
async function executeConditional(
  config: ConditionalConfig,
  context: Record<string, unknown>,
  executeSteps: (stepIds: string[]) => Promise<void>,
): Promise<{ branch: "then" | "else"; executedSteps: string[] }> {
  const log = getLogger();
  const result = evaluateCondition(config.condition, context);

  log.info(
    { condition: config.condition, result },
    "[PIPELINE] Evaluated conditional",
  );

  if (result) {
    await executeSteps(config.thenSteps);
    return { branch: "then", executedSteps: config.thenSteps };
  } else if (config.elseSteps) {
    await executeSteps(config.elseSteps);
    return { branch: "else", executedSteps: config.elseSteps };
  }

  return { branch: "else", executedSteps: [] };
}

/**
 * Execute a parallel step.
 */
async function executeParallel(
  config: ParallelConfig,
  executeSteps: (stepIds: string[]) => Promise<void>,
  signal?: AbortSignal,
): Promise<{ completedSteps: string[]; failedSteps: string[] }> {
  const log = getLogger();
  const completedSteps: string[] = [];
  const failedSteps: string[] = [];

  log.info(
    { steps: config.steps, maxConcurrency: config.maxConcurrency },
    "[PIPELINE] Executing parallel steps",
  );

  // If maxConcurrency is set, use a semaphore pattern
  const maxConcurrency = config.maxConcurrency ?? config.steps.length;
  let running = 0;
  let index = 0;
  const stepPromises: Promise<void>[] = [];

  const executeNext = async (): Promise<void> => {
    while (index < config.steps.length) {
      if (signal?.aborted) return;

      if (running >= maxConcurrency) {
        await sleep(100);
        continue;
      }

      const stepId = config.steps[index];
      if (!stepId) continue;
      index++;
      running++;

      const promise = (async () => {
        try {
          await executeSteps([stepId]);
          completedSteps.push(stepId);
        } catch (error) {
          failedSteps.push(stepId);
          if (config.failFast) {
            throw error;
          }
        } finally {
          running--;
        }
      })();

      stepPromises.push(promise);
    }
  };

  try {
    await Promise.all([
      executeNext(),
      ...Array.from({ length: maxConcurrency - 1 }, () => executeNext()),
    ]);
    await Promise.all(stepPromises);
  } catch (error) {
    if (config.failFast) {
      throw error;
    }
  }

  return { completedSteps, failedSteps };
}

/**
 * Execute an approval step.
 */
async function executeApproval(
  stepId: string,
  runId: string,
  config: ApprovalConfig,
  signal?: AbortSignal,
): Promise<{ approved: boolean; approvals: ApprovalRecord[] }> {
  const log = getLogger();
  const approvals: ApprovalRecord[] = [];

  log.info(
    { stepId, runId, approvers: config.approvers },
    "[PIPELINE] Waiting for approval",
  );

  // Create approval promise
  return new Promise((resolve, reject) => {
    // Set up timeout if configured
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (config.timeout) {
      timeoutId = setTimeout(() => {
        // Clean up pending approval
        const runApprovals = pendingApprovals.get(runId);
        runApprovals?.delete(stepId);

        switch (config.onTimeout) {
          case "approve":
            resolve({ approved: true, approvals });
            break;
          case "reject":
            resolve({ approved: false, approvals });
            break;
          case "fail":
          default:
            reject(new Error("Approval timeout"));
        }
      }, config.timeout);
    }

    // Register approval handler
    if (!pendingApprovals.has(runId)) {
      pendingApprovals.set(runId, new Map());
    }
    const runApprovals = pendingApprovals.get(runId)!;

    const handler = (record: ApprovalRecord) => {
      approvals.push(record);

      // Check if we have enough approvals
      const approvedCount = approvals.filter(
        (a) => a.decision === "approved",
      ).length;
      const rejectedCount = approvals.filter(
        (a) => a.decision === "rejected",
      ).length;
      const minApprovals = config.minApprovals ?? 1;

      if (approvedCount >= minApprovals) {
        if (timeoutId) clearTimeout(timeoutId);
        runApprovals.delete(stepId);
        resolve({ approved: true, approvals });
      } else if (rejectedCount > 0) {
        if (timeoutId) clearTimeout(timeoutId);
        runApprovals.delete(stepId);
        resolve({ approved: false, approvals });
      }
    };

    runApprovals.set(stepId, handler);

    // Handle cancellation
    signal?.addEventListener("abort", () => {
      if (timeoutId) clearTimeout(timeoutId);
      runApprovals.delete(stepId);
      reject(new Error("Execution cancelled"));
    });
  });
}

/**
 * Execute a script step.
 */
async function executeScript(
  config: ScriptConfig,
  context: Record<string, unknown>,
  _signal?: AbortSignal,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const log = getLogger();
  const script = substituteVariables(
    config.isPath ? config.script : config.script,
    context,
  );

  log.info(
    { isPath: config.isPath, workingDirectory: config.workingDirectory },
    "[PIPELINE] Executing script step",
  );

  // Build environment
  const env: Record<string, string> = {
    ...process.env,
    ...(config.env ?? {}),
  } as Record<string, string>;

  // Add context variables to environment
  for (const [key, value] of Object.entries(context)) {
    if (typeof value === "string" || typeof value === "number") {
      env[`PIPELINE_${key.toUpperCase()}`] = String(value);
    }
  }

  const shell = config.shell ?? "/bin/bash";
  const cwd = config.workingDirectory ?? "/tmp";

  // Use Bun's subprocess
  const proc = Bun.spawn([shell, "-c", script], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Handle timeout
  const timeoutMs = config.timeout ?? 300000; // 5 minute default
  const timeoutPromise = sleep(timeoutMs).then(() => {
    proc.kill();
    throw new Error(`Script timeout after ${timeoutMs}ms`);
  });

  const resultPromise = (async () => {
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    return { exitCode, stdout, stderr };
  })();

  const result = await Promise.race([resultPromise, timeoutPromise]);
  return result as { exitCode: number; stdout: string; stderr: string };
}

// ============================================================================
// Pipeline Execution Engine
// ============================================================================

/**
 * Execute a single step.
 */
async function executeStep(
  step: PipelineStep,
  run: PipelineRun,
  pipeline: Pipeline,
  executeStepsById: (stepIds: string[]) => Promise<void>,
  signal?: AbortSignal,
): Promise<StepResult> {
  const log = getLogger();
  const startTime = Date.now();

  log.info(
    { pipelineId: pipeline.id, runId: run.id, stepId: step.id, stepName: step.name },
    "[PIPELINE] Starting step execution",
  );

  // Check condition
  if (step.condition) {
    const shouldExecute = evaluateCondition(step.condition, run.context);
    if (!shouldExecute) {
      log.info(
        { stepId: step.id, condition: step.condition },
        "[PIPELINE] Step skipped due to condition",
      );
      return {
        success: true,
        output: { skipped: true, reason: "condition not met" },
        durationMs: Date.now() - startTime,
        retryCount: 0,
      };
    }
  }

  // Get retry policy
  const retryPolicy = step.retryPolicy ?? pipeline.retryPolicy ?? DEFAULT_RETRY_POLICY;

  // Determine if error is retryable
  const isRetryable = (error: unknown): boolean => {
    if (retryPolicy.retryableErrors?.length) {
      const errorCode =
        error instanceof Error ? (error as Error & { code?: string }).code : undefined;
      return retryPolicy.retryableErrors.includes(errorCode ?? "UNKNOWN");
    }
    // Default: retry on transient errors
    return !(error instanceof Error && error.message.includes("cancelled"));
  };

  try {
    const { result: output, retryCount } = await withRetry(
      async () => {
        switch (step.type) {
          case "agent_task": {
            const config = step.config as { type: "agent_task"; config: AgentTaskConfig };
            return executeAgentTask(config.config, run.context, signal);
          }
          case "conditional": {
            const config = step.config as { type: "conditional"; config: ConditionalConfig };
            return executeConditional(config.config, run.context, executeStepsById);
          }
          case "parallel": {
            const config = step.config as { type: "parallel"; config: ParallelConfig };
            return executeParallel(config.config, executeStepsById, signal);
          }
          case "approval": {
            const config = step.config as { type: "approval"; config: ApprovalConfig };
            return executeApproval(step.id, run.id, config.config, signal);
          }
          case "script": {
            const config = step.config as { type: "script"; config: ScriptConfig };
            const result = await executeScript(config.config, run.context, signal);
            if (result.exitCode !== 0) {
              throw new Error(`Script failed with exit code ${result.exitCode}: ${result.stderr}`);
            }
            return result;
          }
          default:
            throw new Error(`Unknown step type: ${step.type}`);
        }
      },
      retryPolicy,
      isRetryable,
      signal,
    );

    log.info(
      { pipelineId: pipeline.id, runId: run.id, stepId: step.id, status: "completed", retryCount },
      "[PIPELINE] Step completed successfully",
    );

    return {
      success: true,
      output,
      durationMs: Date.now() - startTime,
      retryCount,
    };
  } catch (error) {
    log.error(
      { error, pipelineId: pipeline.id, runId: run.id, stepId: step.id },
      "[PIPELINE] Step failed",
    );

    return {
      success: false,
      error: {
        code: error instanceof Error ? (error as Error & { code?: string }).code ?? "STEP_FAILED" : "STEP_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
      durationMs: Date.now() - startTime,
      retryCount: retryPolicy.maxRetries,
    };
  }
}

/**
 * Execute a pipeline run.
 */
async function executePipeline(
  pipeline: Pipeline,
  run: PipelineRun,
  signal: AbortSignal,
): Promise<void> {
  const log = getLogger();

  log.info(
    { pipelineId: pipeline.id, runId: run.id },
    "[PIPELINE] Starting pipeline execution",
  );

  // Build step lookup
  const stepMap = new Map(pipeline.steps.map((s) => [s.id, s]));

  // Helper to execute steps by ID
  const executeStepsById = async (stepIds: string[]): Promise<void> => {
    for (const stepId of stepIds) {
      if (signal.aborted) {
        throw new Error("Execution cancelled");
      }

      const step = stepMap.get(stepId);
      if (!step) {
        throw new Error(`Step ${stepId} not found`);
      }

      // Skip if already executed
      if (run.executedStepIds.includes(stepId)) {
        continue;
      }

      // Check dependencies
      if (step.dependsOn?.length) {
        const unmetDeps = step.dependsOn.filter(
          (depId) => !run.executedStepIds.includes(depId),
        );
        if (unmetDeps.length > 0) {
          throw new Error(
            `Step ${stepId} has unmet dependencies: ${unmetDeps.join(", ")}`,
          );
        }
      }

      // Update step status
      step.status = "running";
      step.startedAt = new Date();

      // Execute the step
      const result = await executeStep(step, run, pipeline, executeStepsById, signal);

      // Update step with result
      step.status = result.success ? "completed" : "failed";
      step.completedAt = new Date();
      step.result = result;

      // Update context with step output
      if (result.output !== undefined) {
        run.context[`step_${stepId}_output`] = result.output;
      }

      // Mark step as executed
      run.executedStepIds.push(stepId);

      // Handle failure
      if (!result.success && !step.continueOnFailure) {
        throw new Error(`Step ${stepId} failed: ${result.error?.message}`);
      }
    }
  };

  try {
    // Execute all steps in order (respecting dependencies)
    const stepIds = pipeline.steps.map((s) => s.id);
    await executeStepsById(stepIds);

    // Mark run as completed
    run.status = "completed";
    run.completedAt = new Date();
    run.durationMs = run.completedAt.getTime() - run.startedAt.getTime();

    // Update pipeline stats
    pipeline.stats.totalRuns++;
    pipeline.stats.successfulRuns++;
    pipeline.stats.averageDurationMs =
      (pipeline.stats.averageDurationMs * (pipeline.stats.totalRuns - 1) +
        run.durationMs) /
      pipeline.stats.totalRuns;
    pipeline.lastRunAt = new Date();

    log.info(
      { pipelineId: pipeline.id, runId: run.id, durationMs: run.durationMs },
      "[PIPELINE] Pipeline completed successfully",
    );
  } catch (error) {
    // Mark run as failed
    run.status = signal.aborted ? "cancelled" : "failed";
    run.completedAt = new Date();
    run.durationMs = run.completedAt.getTime() - run.startedAt.getTime();
    run.error = {
      code: signal.aborted ? "CANCELLED" : "EXECUTION_FAILED",
      message: error instanceof Error ? error.message : String(error),
    };

    // Update pipeline stats
    pipeline.stats.totalRuns++;
    pipeline.stats.failedRuns++;
    pipeline.lastRunAt = new Date();

    log.error(
      { error, pipelineId: pipeline.id, runId: run.id },
      "[PIPELINE] Pipeline failed",
    );

    throw error;
  } finally {
    // Clean up
    activeRunControllers.delete(run.id);
    pendingApprovals.delete(run.id);
  }
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new pipeline.
 */
export function createPipeline(input: CreatePipelineInput): Pipeline {
  const log = getLogger();
  const id = generatePipelineId();

  const pipeline: Pipeline = {
    id,
    name: input.name,
    description: input.description,
    version: 1,
    enabled: true,
    trigger: {
      type: input.trigger.type,
      config: input.trigger.config,
      enabled: input.trigger.enabled ?? true,
    },
    steps: input.steps.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      type: s.type,
      config: s.config,
      status: "pending" as StepStatus,
      dependsOn: s.dependsOn,
      retryPolicy: s.retryPolicy,
      condition: s.condition,
      continueOnFailure: s.continueOnFailure,
      timeout: s.timeout,
    })),
    contextDefaults: input.contextDefaults,
    retryPolicy: input.retryPolicy,
    tags: input.tags,
    ownerId: input.ownerId,
    createdAt: new Date(),
    updatedAt: new Date(),
    stats: {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      averageDurationMs: 0,
    },
  };

  pipelines.set(id, pipeline);

  log.info({ pipelineId: id, name: input.name }, "[PIPELINE] Created pipeline");

  return pipeline;
}

/**
 * Get a pipeline by ID.
 */
export function getPipeline(id: string): Pipeline | undefined {
  return pipelines.get(id);
}

/**
 * Update a pipeline.
 */
export function updatePipeline(
  id: string,
  input: UpdatePipelineInput,
): Pipeline | undefined {
  const pipeline = pipelines.get(id);
  if (!pipeline) {
    return undefined;
  }

  // Update fields
  if (input.name !== undefined) pipeline.name = input.name;
  if (input.description !== undefined) pipeline.description = input.description;
  if (input.enabled !== undefined) pipeline.enabled = input.enabled;
  if (input.contextDefaults !== undefined)
    pipeline.contextDefaults = input.contextDefaults;
  if (input.retryPolicy !== undefined) pipeline.retryPolicy = input.retryPolicy;
  if (input.tags !== undefined) pipeline.tags = input.tags;

  // Update trigger
  if (input.trigger) {
    if (input.trigger.type !== undefined)
      pipeline.trigger.type = input.trigger.type;
    if (input.trigger.config !== undefined)
      pipeline.trigger.config = input.trigger.config;
    if (input.trigger.enabled !== undefined)
      pipeline.trigger.enabled = input.trigger.enabled;
  }

  // Update steps (replace all)
  if (input.steps) {
    pipeline.steps = input.steps.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      type: s.type,
      config: s.config,
      status: "pending" as StepStatus,
      dependsOn: s.dependsOn,
      retryPolicy: s.retryPolicy,
      condition: s.condition,
      continueOnFailure: s.continueOnFailure,
      timeout: s.timeout,
    }));
  }

  pipeline.version++;
  pipeline.updatedAt = new Date();

  const log = getLogger();
  log.info({ pipelineId: id }, "[PIPELINE] Updated pipeline");

  return pipeline;
}

/**
 * Delete a pipeline.
 */
export function deletePipeline(id: string): boolean {
  const log = getLogger();
  const deleted = pipelines.delete(id);
  if (deleted) {
    log.info({ pipelineId: id }, "[PIPELINE] Deleted pipeline");
  }
  return deleted;
}

/**
 * List pipelines with filtering.
 */
export function listPipelines(filter: PipelineFilter = {}): {
  pipelines: Pipeline[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
} {
  let result = Array.from(pipelines.values());

  // Apply filters
  if (filter.enabled !== undefined) {
    result = result.filter((p) => p.enabled === filter.enabled);
  }

  if (filter.ownerId) {
    result = result.filter((p) => p.ownerId === filter.ownerId);
  }

  if (filter.tags?.length) {
    result = result.filter((p) =>
      filter.tags!.some((tag) => p.tags?.includes(tag)),
    );
  }

  if (filter.search) {
    const search = filter.search.toLowerCase();
    result = result.filter(
      (p) =>
        p.name.toLowerCase().includes(search) ||
        p.description?.toLowerCase().includes(search),
    );
  }

  // Sort by createdAt descending
  result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const total = result.length;

  // Apply cursor pagination
  let startIndex = 0;
  if (filter.cursor) {
    const cursorIndex = result.findIndex((p) => p.id === filter.cursor);
    if (cursorIndex !== -1) {
      startIndex = cursorIndex + 1;
    }
  }

  const limit = filter.limit ?? 50;
  const paginatedResult = result.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < total;
  const nextCursor = hasMore ? paginatedResult[paginatedResult.length - 1]?.id : undefined;

  return {
    pipelines: paginatedResult,
    total,
    hasMore,
    ...(nextCursor && { nextCursor }),
  };
}

// ============================================================================
// Run Operations
// ============================================================================

/**
 * Start a pipeline run.
 */
export async function runPipeline(
  id: string,
  options: {
    triggeredBy?: { type: "user" | "schedule" | "webhook" | "bead_event" | "api"; id?: string };
    params?: Record<string, unknown>;
  } = {},
): Promise<PipelineRun> {
  const log = getLogger();
  const pipeline = pipelines.get(id);

  if (!pipeline) {
    throw new Error(`Pipeline ${id} not found`);
  }

  if (!pipeline.enabled) {
    throw new Error(`Pipeline ${id} is disabled`);
  }

  const runId = generateRunId();
  const abortController = new AbortController();

  // Create run record
  const run: PipelineRun = {
    id: runId,
    pipelineId: id,
    status: "running",
    currentStepIndex: 0,
    executedStepIds: [],
    context: {
      ...(pipeline.contextDefaults ?? {}),
      ...(options.params ?? {}),
    },
    triggerParams: options.params,
    triggeredBy: options.triggeredBy ?? { type: "api" },
    startedAt: new Date(),
  };

  runs.set(runId, run);
  activeRunControllers.set(runId, abortController);

  // Reset step statuses
  for (const step of pipeline.steps) {
    step.status = "pending";
    step.result = undefined;
    step.startedAt = undefined;
    step.completedAt = undefined;
  }

  log.info(
    { pipelineId: id, runId, triggeredBy: run.triggeredBy },
    "[PIPELINE] Starting run",
  );

  // Execute pipeline in background
  executePipeline(pipeline, run, abortController.signal).catch(() => {
    // Error already logged in executePipeline
  });

  return run;
}

/**
 * Pause a pipeline run.
 */
export function pauseRun(runId: string): PipelineRun | undefined {
  const run = runs.get(runId);
  if (!run || run.status !== "running") {
    return undefined;
  }

  run.status = "paused";

  const log = getLogger();
  log.info({ runId }, "[PIPELINE] Run paused");

  return run;
}

/**
 * Resume a paused pipeline run.
 */
export async function resumeRun(runId: string): Promise<PipelineRun | undefined> {
  const log = getLogger();
  const run = runs.get(runId);

  if (!run || run.status !== "paused") {
    return undefined;
  }

  const pipeline = pipelines.get(run.pipelineId);
  if (!pipeline) {
    return undefined;
  }

  run.status = "running";
  const abortController = new AbortController();
  activeRunControllers.set(runId, abortController);

  log.info({ runId, pipelineId: run.pipelineId }, "[PIPELINE] Resuming run");

  // Resume execution
  executePipeline(pipeline, run, abortController.signal).catch(() => {
    // Error already logged
  });

  return run;
}

/**
 * Cancel a pipeline run.
 */
export function cancelRun(runId: string): PipelineRun | undefined {
  const log = getLogger();
  const run = runs.get(runId);

  if (!run || (run.status !== "running" && run.status !== "paused")) {
    return undefined;
  }

  // Abort the run
  const controller = activeRunControllers.get(runId);
  if (controller) {
    controller.abort();
  }

  run.status = "cancelled";
  run.completedAt = new Date();
  run.durationMs = run.completedAt.getTime() - run.startedAt.getTime();

  log.info({ runId }, "[PIPELINE] Run cancelled");

  return run;
}

/**
 * Get a pipeline run by ID.
 */
export function getRun(runId: string): PipelineRun | undefined {
  return runs.get(runId);
}

/**
 * List runs for a pipeline.
 */
export function listRuns(
  pipelineId: string,
  filter: PipelineRunFilter = {},
): {
  runs: PipelineRun[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
} {
  let result = Array.from(runs.values()).filter(
    (r) => r.pipelineId === pipelineId,
  );

  // Apply filters
  if (filter.status?.length) {
    result = result.filter((r) => filter.status!.includes(r.status));
  }

  if (filter.since) {
    result = result.filter((r) => r.startedAt >= filter.since!);
  }

  if (filter.until) {
    result = result.filter((r) => r.startedAt <= filter.until!);
  }

  // Sort by startedAt descending
  result.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  const total = result.length;

  // Apply cursor pagination
  let startIndex = 0;
  if (filter.cursor) {
    const cursorIndex = result.findIndex((r) => r.id === filter.cursor);
    if (cursorIndex !== -1) {
      startIndex = cursorIndex + 1;
    }
  }

  const limit = filter.limit ?? 50;
  const paginatedResult = result.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < total;
  const nextCursor = hasMore ? paginatedResult[paginatedResult.length - 1]?.id : undefined;

  return {
    runs: paginatedResult,
    total,
    hasMore,
    ...(nextCursor && { nextCursor }),
  };
}

/**
 * Submit an approval decision.
 */
export function submitApproval(
  runId: string,
  stepId: string,
  decision: ApprovalRecord,
): boolean {
  const runApprovals = pendingApprovals.get(runId);
  if (!runApprovals) {
    return false;
  }

  const handler = runApprovals.get(stepId);
  if (!handler) {
    return false;
  }

  handler(decision);
  return true;
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Clear all pipelines and runs (for testing).
 */
export function clearAll(): void {
  pipelines.clear();
  runs.clear();
  pendingApprovals.clear();
  for (const controller of activeRunControllers.values()) {
    controller.abort();
  }
  activeRunControllers.clear();
}
