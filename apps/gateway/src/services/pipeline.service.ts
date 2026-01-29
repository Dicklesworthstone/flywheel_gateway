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
  type LoopConfig,
  type ParallelConfig,
  type Pipeline,
  type PipelineFilter,
  type PipelineRun,
  type PipelineRunFilter,
  type PipelineStep,
  type RetryPolicy,
  type ScriptConfig,
  type StepResult,
  type StepStatus,
  type SubPipelineConfig,
  type TransformConfig,
  type UpdatePipelineInput,
  type WaitConfig,
  type WebhookConfig,
} from "../models/pipeline";
import { sendMessage, spawnAgent, terminateAgent } from "./agent";

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
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
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
  const delay = policy.initialDelay * multiplier ** attemptNumber;
  // Add jitter (10% random variation)
  const jitter = delay * 0.1 * Math.random();
  return Math.min(delay + jitter, policy.maxDelay);
}

/**
 * Error wrapper that preserves retry count for error handling.
 */
class RetryError extends Error {
  public readonly originalCause: unknown;
  public readonly retryCount: number;

  constructor(cause: unknown, retryCount: number) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "RetryError";
    this.originalCause = cause;
    this.retryCount = retryCount;
  }
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
      throw new RetryError(new Error("Execution cancelled"), retryCount);
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
        // Wrap error with retry count for proper reporting
        throw new RetryError(error, retryCount);
      }
    }
  }

  throw new RetryError(lastError, retryCount);
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
    config.workingDirectory ??
    (context["workingDirectory"] as string) ??
    "/tmp";

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

  // Send the prompt
  const messageResult = await sendMessage(agentId, "user", prompt);

  // If not waiting for completion, return immediately (agent stays alive for caller)
  if (config.waitForCompletion === false) {
    return {
      agentId,
      messageId: messageResult.messageId,
      status: "submitted",
    };
  }

  // Wait for agent to complete (simplified - in production would poll or use events)
  // For now, return the message result and terminate the agent
  try {
    return {
      agentId,
      messageId: messageResult.messageId,
      status: "completed",
    };
  } finally {
    // Terminate the agent only when we waited for completion
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

      const currentIndex = index;
      index++;
      const stepId = config.steps[currentIndex];
      if (!stepId) continue;
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

    // Handle cancellation (use once: true to avoid memory leak)
    signal?.addEventListener(
      "abort",
      () => {
        if (timeoutId) clearTimeout(timeoutId);
        runApprovals.delete(stepId);
        reject(new Error("Execution cancelled"));
      },
      { once: true },
    );
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

  // SECURITY: Do not substitute variables in inline scripts to prevent command injection.
  // Users should use environment variables (e.g., $PIPELINE_VAR) instead.
  // We only substitute for file paths to resolve locations.
  const script = config.isPath
    ? substituteVariables(config.script, context)
    : config.script;

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

  // Handle timeout with proper cleanup
  const timeoutMs = config.timeout ?? 300000; // 5 minute default
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      proc.kill();
      reject(new Error(`Script timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const resultPromise = (async () => {
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    return { exitCode, stdout, stderr };
  })();

  try {
    const result = await Promise.race([resultPromise, timeoutPromise]);
    return result;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Execute a loop step.
 */
async function executeLoop(
  config: LoopConfig,
  context: Record<string, unknown>,
  executeSteps: (stepIds: string[]) => Promise<void>,
  signal?: AbortSignal,
): Promise<{ iterations: number; results: unknown[] }> {
  const log = getLogger();
  const results: unknown[] = [];
  let iteration = 0;

  log.info(
    { mode: config.mode, maxIterations: config.maxIterations },
    "[PIPELINE] Starting loop step",
  );

  // Track loop nesting depth - allows nested loops and enables step re-execution
  // inside loops (normally steps are skipped if already in executedStepIds)
  const previousLoopDepth = (context["__loopDepth"] as number) ?? 0;
  context["__loopDepth"] = previousLoopDepth + 1;

  // Get iterator based on mode
  const getIterator = (): IterableIterator<unknown> | undefined => {
    switch (config.mode) {
      case "for_each": {
        const collectionPath = substituteVariables(
          config.collection ?? "",
          context,
        );
        const collection = getValueByPath(context, collectionPath);
        if (Array.isArray(collection)) {
          return collection[Symbol.iterator]();
        }
        return undefined;
      }
      case "times": {
        const count = config.count ?? 0;
        return Array.from({ length: count }, (_, i) => i)[Symbol.iterator]();
      }
      case "while":
      case "until": {
        // These modes use condition checking, not a fixed iterator
        return undefined;
      }
      default:
        return undefined;
    }
  };

  const shouldContinue = (): boolean => {
    if (signal?.aborted) return false;
    if (iteration >= config.maxIterations) return false;

    switch (config.mode) {
      case "while":
        return evaluateCondition(config.condition ?? "false", context);
      case "until":
        return !evaluateCondition(config.condition ?? "true", context);
      default:
        return true;
    }
  };

  // Execute iterations
  const iterator = getIterator();

  // For parallel execution, we need to isolate loop variables per iteration
  // to avoid race conditions where parallel iterations overwrite each other's variables
  const executeIteration = async (
    item: unknown,
    index: number,
    isolated = false,
  ): Promise<unknown> => {
    // Set loop variables - for parallel execution, use unique keys per iteration
    const itemKey = isolated
      ? `${config.itemVariable}_${index}`
      : config.itemVariable;
    const indexKey = isolated
      ? `${config.indexVariable}_${index}`
      : config.indexVariable;

    context[itemKey] = item;
    context[indexKey] = index;

    // Also set the standard keys for step access (last write wins in parallel, but steps
    // can use the indexed keys for isolation)
    if (isolated) {
      context[config.itemVariable] = item;
      context[config.indexVariable] = index;
    }

    await executeSteps(config.steps);

    // Capture result (if output variable set, take last step result)
    // Note: Step outputs are stored as `step_${stepId}_output` in context
    const lastStepId = config.steps[config.steps.length - 1];
    let result: unknown;
    if (lastStepId) {
      const stepResultKey = `step_${lastStepId}_output`;
      result = context[stepResultKey];
    }

    // Clean up isolated keys
    if (isolated) {
      delete context[itemKey];
      delete context[indexKey];
    }

    return result;
  };

  try {
    if (config.mode === "for_each" || config.mode === "times") {
      if (!iterator) {
        throw new Error(`Loop mode ${config.mode} requires a valid collection`);
      }

      if (config.parallel && config.parallelLimit && config.parallelLimit > 1) {
        log.warn(
          "[PIPELINE] Parallel loop execution is currently disabled due to context isolation constraints. Executing sequentially.",
        );
      }

      // Sequential execution
      for (const item of iterator) {
        if (signal?.aborted) break;
        if (iteration >= config.maxIterations) break;

        const result = await executeIteration(item, iteration);
        if (result !== undefined) {
          results.push(result);
        }
        iteration++;
      }
    } else {
      // while/until modes
      while (shouldContinue()) {
        const result = await executeIteration(iteration, iteration);
        if (result !== undefined) {
          results.push(result);
        }
        iteration++;
      }
    }

    // Store results in output variable
    context[config.outputVariable] = results;
  } finally {
    // Always restore loop depth, even on error (enables proper nesting)
    context["__loopDepth"] = previousLoopDepth;
  }

  log.info(
    { iterations: iteration, resultsCount: results.length },
    "[PIPELINE] Loop step completed",
  );

  return { iterations: iteration, results };
}

/**
 * Execute a wait step.
 */
async function executeWait(
  config: WaitConfig,
  context: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ waitedMs: number; reason: string }> {
  const log = getLogger();
  const startTime = Date.now();

  log.info(
    { mode: config.mode, timeout: config.timeout },
    "[PIPELINE] Starting wait step",
  );

  switch (config.mode) {
    case "duration": {
      const duration = config.duration ?? 0;
      const actualWait = Math.min(duration, config.timeout);

      await Promise.race([
        sleep(actualWait),
        new Promise<never>((_, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new Error("Cancelled")),
            { once: true },
          );
        }),
      ]).catch((err) => {
        if (err.message !== "Cancelled") throw err;
      });

      return { waitedMs: Date.now() - startTime, reason: "duration_elapsed" };
    }

    case "until": {
      const untilValue = substituteVariables(config.until ?? "", context);
      const targetTime = new Date(untilValue).getTime();
      const now = Date.now();
      const waitTime = Math.min(Math.max(0, targetTime - now), config.timeout);

      await Promise.race([
        sleep(waitTime),
        new Promise<never>((_, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new Error("Cancelled")),
            { once: true },
          );
        }),
      ]).catch((err) => {
        if (err.message !== "Cancelled") throw err;
      });

      return {
        waitedMs: Date.now() - startTime,
        reason: "target_time_reached",
      };
    }

    case "webhook": {
      // For webhook mode, we'd normally wait for an external callback
      // This is a placeholder - in production, you'd register a callback handler
      log.warn(
        "[PIPELINE] Webhook wait mode not fully implemented - timing out",
      );

      await Promise.race([
        sleep(config.timeout),
        new Promise<never>((_, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new Error("Cancelled")),
            { once: true },
          );
        }),
      ]).catch((err) => {
        if (err.message !== "Cancelled") throw err;
      });

      return { waitedMs: Date.now() - startTime, reason: "webhook_timeout" };
    }

    default:
      throw new Error(`Unknown wait mode: ${config.mode}`);
  }
}

/**
 * Execute a transform step.
 */
async function executeTransform(
  config: TransformConfig,
  context: Record<string, unknown>,
): Promise<{ transformedValues: number }> {
  const log = getLogger();
  let transformedCount = 0;

  log.info(
    { operationsCount: config.operations.length },
    "[PIPELINE] Starting transform step",
  );

  // Validate expressions used in map/filter/reduce to block dangerous globals
  const BLOCKED_EXPR_PATTERN =
    /\b(process|require|import|eval|Function|globalThis|Bun|Deno|__dirname|__filename|fetch|XMLHttpRequest)\b/;

  for (const operation of config.operations) {
    switch (operation.op) {
      case "set": {
        setValueByPath(context, operation.path, operation.value);
        transformedCount++;
        break;
      }

      case "delete": {
        deleteValueByPath(context, operation.path);
        transformedCount++;
        break;
      }

      case "merge": {
        const sourceValue = getValueByPath(context, operation.source);
        const targetValue = getValueByPath(context, operation.target);
        if (
          typeof sourceValue === "object" &&
          typeof targetValue === "object"
        ) {
          setValueByPath(context, operation.target, {
            ...(targetValue as object),
            ...(sourceValue as object),
          });
          transformedCount++;
        }
        break;
      }

      case "map": {
        const sourceArray = getValueByPath(context, operation.source);
        if (Array.isArray(sourceArray)) {
          if (BLOCKED_EXPR_PATTERN.test(operation.expression)) {
            throw new Error(
              `Transform map expression contains blocked keyword: ${operation.expression}`,
            );
          }
          const mapped = sourceArray.map((item, index) => {
            try {
              const fn = new Function(
                "$item",
                "$index",
                `return ${operation.expression}`,
              );
              return fn(item, index);
            } catch {
              return item;
            }
          });
          setValueByPath(context, operation.target, mapped);
          transformedCount++;
        }
        break;
      }

      case "filter": {
        const filterSource = getValueByPath(context, operation.source);
        if (Array.isArray(filterSource)) {
          if (BLOCKED_EXPR_PATTERN.test(operation.condition)) {
            throw new Error(
              `Transform filter condition contains blocked keyword: ${operation.condition}`,
            );
          }
          const filtered = filterSource.filter((item, index) => {
            try {
              const fn = new Function(
                "$item",
                "$index",
                `return ${operation.condition}`,
              );
              return fn(item, index);
            } catch {
              return true;
            }
          });
          setValueByPath(context, operation.target, filtered);
          transformedCount++;
        }
        break;
      }

      case "reduce": {
        const reduceSource = getValueByPath(context, operation.source);
        if (Array.isArray(reduceSource)) {
          if (BLOCKED_EXPR_PATTERN.test(operation.expression)) {
            throw new Error(
              `Transform reduce expression contains blocked keyword: ${operation.expression}`,
            );
          }
          const reduced = reduceSource.reduce((acc, item, index) => {
            try {
              const fn = new Function(
                "$acc",
                "$item",
                "$index",
                `return ${operation.expression}`,
              );
              return fn(acc, item, index);
            } catch {
              return acc;
            }
          }, operation.initial);
          setValueByPath(context, operation.target, reduced);
          transformedCount++;
        }
        break;
      }

      case "extract": {
        // Simple JSONPath-like extraction
        const extractSource = getValueByPath(context, operation.source);
        const extracted = getValueByPath(
          { root: extractSource } as Record<string, unknown>,
          `root${operation.query.replace(/^\$/, "")}`,
        );
        setValueByPath(context, operation.target, extracted);
        transformedCount++;
        break;
      }
    }
  }

  // Store final context snapshot in output variable
  if (config.outputVariable) {
    setValueByPath(context, config.outputVariable, { ...context });
  }

  log.info({ transformedCount }, "[PIPELINE] Transform step completed");

  return { transformedValues: transformedCount };
}

/**
 * Execute a webhook step.
 */
async function executeWebhook(
  config: WebhookConfig,
  context: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const log = getLogger();
  const url = substituteVariables(config.url, context);
  const timeout = config.timeout ?? 30000;

  log.info({ method: config.method, url }, "[PIPELINE] Starting webhook step");

  // Build headers
  const headers: Record<string, string> = {};
  if (config.headers) {
    for (const [key, value] of Object.entries(config.headers)) {
      headers[key] = substituteVariables(value, context);
    }
  }

  // Add authentication
  if (config.auth) {
    switch (config.auth.type) {
      case "basic": {
        const username = substituteVariables(
          config.auth.username ?? "",
          context,
        );
        const password = substituteVariables(
          config.auth.password ?? "",
          context,
        );
        headers["Authorization"] = `Basic ${btoa(`${username}:${password}`)}`;
        break;
      }
      case "bearer": {
        const token = substituteVariables(config.auth.token ?? "", context);
        headers["Authorization"] = `Bearer ${token}`;
        break;
      }
      case "api_key": {
        const headerName = config.auth.headerName ?? "X-API-Key";
        const apiKey = substituteVariables(config.auth.apiKey ?? "", context);
        headers[headerName] = apiKey;
        break;
      }
    }
  }

  // Build request body
  let body: string | undefined;
  if (config.body && config.method !== "GET") {
    if (typeof config.body === "string") {
      body = substituteVariables(config.body, context);
    } else {
      body = JSON.stringify(config.body);
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
    }
  }

  // Make the request
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Combine signals
  const abortHandler = () => controller.abort();
  signal?.addEventListener("abort", abortHandler, { once: true });

  try {
    const response = await fetch(url, {
      method: config.method,
      headers,
      body: body ?? null, // Convert undefined to null for fetch compatibility
      signal: controller.signal,
    });

    // Validate status
    const validStatuses = config.validateStatus ?? [200, 201, 202, 203, 204];
    if (!validStatuses.includes(response.status)) {
      throw new Error(`Webhook returned status ${response.status}`);
    }

    // Parse response
    const contentType = response.headers.get("content-type") ?? "";
    let responseData: unknown;

    if (contentType.includes("application/json")) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    // Extract fields if configured
    // Convert headers to plain object (Headers.entries() available in modern runtimes)
    const headersObj: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headersObj[key] = value;
    });
    const result: Record<string, unknown> = {
      status: response.status,
      headers: headersObj,
      data: responseData,
    };

    if (config.extractFields) {
      for (const [targetKey, jsonPath] of Object.entries(
        config.extractFields,
      )) {
        result[targetKey] = getValueByPath(
          { data: responseData } as Record<string, unknown>,
          jsonPath.replace(/^\$\.?data\.?/, "data."),
        );
      }
    }

    // Store in output variable
    context[config.outputVariable] = result;

    log.info({ status: response.status }, "[PIPELINE] Webhook step completed");

    return result;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortHandler);
  }
}

/**
 * Execute a sub-pipeline step.
 */
async function executeSubPipeline(
  config: SubPipelineConfig,
  context: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const log = getLogger();

  log.info(
    { pipelineId: config.pipelineId, version: config.version },
    "[PIPELINE] Starting sub-pipeline step",
  );

  // Get the sub-pipeline
  const subPipeline = getPipeline(config.pipelineId);
  if (!subPipeline) {
    throw new Error(`Sub-pipeline not found: ${config.pipelineId}`);
  }

  // Check version if specified
  if (config.version && subPipeline.version !== config.version) {
    throw new Error(
      `Sub-pipeline version mismatch: expected ${config.version}, got ${subPipeline.version}`,
    );
  }

  // Substitute variables in inputs
  const inputs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config.inputs)) {
    if (typeof value === "string") {
      inputs[key] = substituteVariables(value, context);
    } else {
      inputs[key] = value;
    }
  }

  // Run the sub-pipeline
  const run = await runPipeline(config.pipelineId, {
    params: inputs,
    triggeredBy: { type: "api" },
  });

  if (config.waitForCompletion === false) {
    // Return immediately without waiting
    const result = {
      runId: run.id,
      pipelineId: config.pipelineId,
      status: run.status,
    };
    context[config.outputVariable] = result;
    return result;
  }

  // Wait for completion with timeout
  const timeout = config.timeout ?? 300000; // 5 minute default
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (signal?.aborted) {
      throw new Error("Sub-pipeline execution cancelled");
    }

    const currentRun = getRun(run.id);
    if (!currentRun) {
      throw new Error(`Sub-pipeline run not found: ${run.id}`);
    }

    if (
      currentRun.status === "completed" ||
      currentRun.status === "failed" ||
      currentRun.status === "cancelled"
    ) {
      const result = {
        runId: currentRun.id,
        pipelineId: config.pipelineId,
        status: currentRun.status,
        context: currentRun.context,
      };
      context[config.outputVariable] = result;

      if (currentRun.status === "failed") {
        throw new Error(`Sub-pipeline failed: ${currentRun.error?.message}`);
      }

      log.info(
        { runId: currentRun.id, status: currentRun.status },
        "[PIPELINE] Sub-pipeline step completed",
      );

      return result;
    }

    await sleep(1000); // Poll every second
  }

  throw new Error(`Sub-pipeline timeout after ${timeout}ms`);
}

// ============================================================================
// Helper functions for path-based context manipulation
// ============================================================================

/**
 * Get a value from context by dot-notation path.
 */
function getValueByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Set a value in context by dot-notation path.
 */
function setValueByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!part) continue;
    if (!(part in current) || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const lastPart = parts[parts.length - 1];
  if (lastPart) {
    current[lastPart] = value;
  }
}

/**
 * Delete a value from context by dot-notation path.
 */
function deleteValueByPath(obj: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!part) continue;
    if (!(part in current) || typeof current[part] !== "object") {
      return; // Path doesn't exist
    }
    current = current[part] as Record<string, unknown>;
  }

  const lastPart = parts[parts.length - 1];
  if (lastPart && lastPart in current) {
    delete current[lastPart];
  }
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
    {
      pipelineId: pipeline.id,
      runId: run.id,
      stepId: step.id,
      stepName: step.name,
    },
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
  const retryPolicy =
    step.retryPolicy ?? pipeline.retryPolicy ?? DEFAULT_RETRY_POLICY;

  // Determine if error is retryable
  const isRetryable = (error: unknown): boolean => {
    if (retryPolicy.retryableErrors?.length) {
      const errorCode =
        error instanceof Error
          ? (error as Error & { code?: string }).code
          : undefined;
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
            const config = step.config as {
              type: "agent_task";
              config: AgentTaskConfig;
            };
            return executeAgentTask(config.config, run.context, signal);
          }
          case "conditional": {
            const config = step.config as {
              type: "conditional";
              config: ConditionalConfig;
            };
            return executeConditional(
              config.config,
              run.context,
              executeStepsById,
            );
          }
          case "parallel": {
            const config = step.config as {
              type: "parallel";
              config: ParallelConfig;
            };
            return executeParallel(config.config, executeStepsById, signal);
          }
          case "approval": {
            const config = step.config as {
              type: "approval";
              config: ApprovalConfig;
            };
            return executeApproval(step.id, run.id, config.config, signal);
          }
          case "script": {
            const config = step.config as {
              type: "script";
              config: ScriptConfig;
            };
            const result = await executeScript(
              config.config,
              run.context,
              signal,
            );
            if (result.exitCode !== 0) {
              throw new Error(
                `Script failed with exit code ${result.exitCode}: ${result.stderr}`,
              );
            }
            return result;
          }
          case "loop": {
            const config = step.config as { type: "loop"; config: LoopConfig };
            return executeLoop(
              config.config,
              run.context,
              executeStepsById,
              signal,
            );
          }
          case "wait": {
            const config = step.config as { type: "wait"; config: WaitConfig };
            return executeWait(config.config, run.context, signal);
          }
          case "transform": {
            const config = step.config as {
              type: "transform";
              config: TransformConfig;
            };
            return executeTransform(config.config, run.context);
          }
          case "webhook": {
            const config = step.config as {
              type: "webhook";
              config: WebhookConfig;
            };
            return executeWebhook(config.config, run.context, signal);
          }
          case "sub_pipeline": {
            const config = step.config as {
              type: "sub_pipeline";
              config: SubPipelineConfig;
            };
            return executeSubPipeline(config.config, run.context, signal);
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
      {
        pipelineId: pipeline.id,
        runId: run.id,
        stepId: step.id,
        status: "completed",
        retryCount,
      },
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

    // Extract retry count and original error from RetryError
    const actualRetryCount = error instanceof RetryError ? error.retryCount : 0;
    const originalError =
      error instanceof RetryError ? error.originalCause : error;

    return {
      success: false,
      error: {
        code:
          originalError instanceof Error
            ? ((originalError as Error & { code?: string }).code ??
              "STEP_FAILED")
            : "STEP_FAILED",
        message:
          originalError instanceof Error
            ? originalError.message
            : String(originalError),
      },
      durationMs: Date.now() - startTime,
      retryCount: actualRetryCount,
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

  // Build step lookup from the run's copy of steps
  const stepMap = new Map(run.steps.map((s) => [s.id, s]));

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

      // Skip if already executed - BUT not when inside a loop
      // The __loopDepth context variable tracks loop nesting depth
      const loopDepth = (run.context["__loopDepth"] as number) ?? 0;
      if (loopDepth === 0 && run.executedStepIds.includes(stepId)) {
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
      const result = await executeStep(
        step,
        run,
        pipeline,
        executeStepsById,
        signal,
      );

      // Update step with result
      step.status = result.success ? "completed" : "failed";
      step.completedAt = new Date();
      step.result = result;

      // Update context with step output
      if (result.output !== undefined) {
        run.context[`step_${stepId}_output`] = result.output;
      }

      // Mark step as executed (avoid duplicates from loop iterations)
      if (!run.executedStepIds.includes(stepId)) {
        run.executedStepIds.push(stepId);
      }

      // Handle failure
      if (!result.success && !step.continueOnFailure) {
        throw new Error(`Step ${stepId} failed: ${result.error?.message}`);
      }
    }
  };

  try {
    // Execute all steps in order (respecting dependencies)
    const stepIds = run.steps.map((s) => s.id);
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
    // Don't update status if paused (pauseRun sets status before aborting)
    if (run.status !== "paused") {
      run.status = signal.aborted ? "cancelled" : "failed";
      run.completedAt = new Date();
      run.durationMs = run.completedAt.getTime() - run.startedAt.getTime();
      run.error = {
        code: signal.aborted ? "CANCELLED" : "EXECUTION_FAILED",
        message: error instanceof Error ? error.message : String(error),
      };

      // Update pipeline stats only for actual failures/cancellations
      pipeline.stats.totalRuns++;
      pipeline.stats.failedRuns++;
      pipeline.lastRunAt = new Date();

      log.error(
        { error, pipelineId: pipeline.id, runId: run.id },
        "[PIPELINE] Pipeline failed",
      );
    } else {
      log.info(
        { pipelineId: pipeline.id, runId: run.id },
        "[PIPELINE] Pipeline paused",
      );
    }

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
      filter.tags?.some((tag) => p.tags?.includes(tag)),
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
  const nextCursor = hasMore
    ? paginatedResult[paginatedResult.length - 1]?.id
    : undefined;

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
    triggeredBy?: {
      type: "user" | "schedule" | "webhook" | "bead_event" | "api";
      id?: string;
    };
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

  // Create run record with a deep copy of steps to isolate state
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
    steps: pipeline.steps.map((s) => ({
      ...s,
      status: "pending", // Reset status for the run
      result: undefined,
      startedAt: undefined,
      completedAt: undefined,
      // Deep copy nested objects if necessary (retryPolicy, etc. are usually immutable config)
    })),
  };

  runs.set(runId, run);
  activeRunControllers.set(runId, abortController);

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

  // Set status first, then abort (executePipeline checks status before overwriting)
  run.status = "paused";

  // Abort the current execution - resume will restart from checkpoint
  const controller = activeRunControllers.get(runId);
  if (controller) {
    controller.abort();
  }

  const log = getLogger();
  log.info({ runId }, "[PIPELINE] Run paused");

  return run;
}

/**
 * Resume a paused pipeline run.
 */
export async function resumeRun(
  runId: string,
): Promise<PipelineRun | undefined> {
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
    result = result.filter((r) => filter.status?.includes(r.status));
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
  const nextCursor = hasMore
    ? paginatedResult[paginatedResult.length - 1]?.id
    : undefined;

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
