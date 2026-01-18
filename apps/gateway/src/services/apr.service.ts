/**
 * Automated Plan Reviser (apr) Service
 *
 * Provides access to the apr CLI for iterative AI-powered specification
 * refinement. apr automates plan revision cycles using GPT Pro Extended
 * Reasoning via Oracle.
 *
 * CLI: https://github.com/Dicklesworthstone/automated_plan_reviser
 */

import { getLogger } from "../middleware/correlation";

// ============================================================================
// Types
// ============================================================================

export interface AprResponse<T = unknown> {
  ok: boolean;
  code: string;
  data: T;
  hint?: string;
  meta: {
    v: string;
    ts: string;
  };
}

export interface AprStatus {
  configured: boolean;
  default_workflow: string;
  workflow_count: number;
  workflows: string[];
  oracle_available: boolean;
  oracle_method: string;
  config_dir: string;
  apr_home: string;
}

export interface AprWorkflow {
  name: string;
  description: string;
  path: string;
  rounds: number;
  last_run?: string;
}

export interface AprRound {
  round: number;
  workflow: string;
  status: "pending" | "running" | "completed" | "failed";
  created_at?: string;
  completed_at?: string;
  content?: string;
  metrics?: AprMetrics;
}

export interface AprMetrics {
  word_count: number;
  section_count: number;
  code_block_count: number;
  convergence_score?: number;
}

export interface AprDiff {
  round_a: number;
  round_b: number;
  workflow: string;
  additions: number;
  deletions: number;
  changes: string[];
}

export interface AprIntegration {
  round: number;
  workflow: string;
  prompt: string;
  include_impl: boolean;
}

export interface AprHistory {
  workflow: string;
  rounds: AprRound[];
  total: number;
}

// ============================================================================
// CLI Execution Helper
// ============================================================================

async function executeAprCommand(
  args: string[],
  options: { timeout?: number; maxOutputSize?: number } = {},
): Promise<AprResponse> {
  const { timeout = 60000, maxOutputSize = 5 * 1024 * 1024 } = options;
  const log = getLogger();

  try {
    // Always use robot mode for JSON output
    const fullArgs = ["robot", ...args];

    const proc = Bun.spawn(["apr", ...fullArgs], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });

    // Set up timeout with cleanup
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        proc.kill();
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);
    });

    // Wait for command or timeout
    const resultPromise = (async () => {
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;

      // Truncate if needed
      const output =
        stdout.length > maxOutputSize ? stdout.slice(0, maxOutputSize) : stdout;

      // Parse JSON response
      try {
        return JSON.parse(output.trim()) as AprResponse;
      } catch {
        // If parsing fails, create an error response
        log.error(
          { stdout: output.slice(0, 200), stderr },
          "Failed to parse apr output",
        );
        return {
          ok: false,
          code: "parse_error",
          data: { stdout: output, stderr },
          hint: "Failed to parse apr output as JSON",
          meta: { v: "unknown", ts: new Date().toISOString() },
        } as AprResponse;
      }
    })();

    try {
      return await Promise.race([resultPromise, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  } catch (error) {
    return {
      ok: false,
      code: "execution_error",
      data: { error: error instanceof Error ? error.message : "Unknown error" },
      hint: "Failed to execute apr command",
      meta: { v: "unknown", ts: new Date().toISOString() },
    };
  }
}

// ============================================================================
// Detection
// ============================================================================

export async function isAprAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["apr", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    // Check for version pattern in output
    return exitCode === 0 || stdout.includes("v1.");
  } catch {
    return false;
  }
}

export async function getAprVersion(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["apr", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    // Extract version from banner or output
    const versionMatch = stdout.match(/v?(\d+\.\d+\.\d+)/);
    return versionMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

// ============================================================================
// Status Functions
// ============================================================================

/**
 * Get apr system status.
 */
export async function getStatus(): Promise<AprStatus> {
  const response = await executeAprCommand(["status"]);

  if (!response.ok) {
    throw new Error(response.hint ?? `apr status failed: ${response.code}`);
  }

  return response.data as AprStatus;
}

/**
 * List all configured workflows.
 */
export async function listWorkflows(): Promise<AprWorkflow[]> {
  const response = await executeAprCommand(["workflows"]);

  if (!response.ok) {
    throw new Error(response.hint ?? `apr workflows failed: ${response.code}`);
  }

  const data = response.data as { workflows?: AprWorkflow[] };
  return data.workflows ?? [];
}

// ============================================================================
// Round Functions
// ============================================================================

/**
 * Get round content and details.
 */
export async function getRound(
  round: number,
  options: { workflow?: string; includeImpl?: boolean } = {},
): Promise<AprRound> {
  const args = ["show", String(round)];

  if (options.workflow) {
    args.push("-w", options.workflow);
  }

  if (options.includeImpl) {
    args.push("-i");
  }

  const response = await executeAprCommand(args);

  if (!response.ok) {
    throw new Error(response.hint ?? `apr show failed: ${response.code}`);
  }

  return response.data as AprRound;
}

/**
 * Validate before running a revision round.
 */
export async function validateRound(
  round: number,
  options: { workflow?: string } = {},
): Promise<{ valid: boolean; issues?: string[] }> {
  const args = ["validate", String(round)];

  if (options.workflow) {
    args.push("-w", options.workflow);
  }

  const response = await executeAprCommand(args);

  if (!response.ok) {
    const data = response.data as { issues?: string[] };
    return {
      valid: false,
      issues: data.issues ?? [response.hint ?? response.code],
    };
  }

  return { valid: true };
}

/**
 * Run a revision round.
 * Note: This can be a long-running operation.
 */
export async function runRound(
  round: number,
  options: { workflow?: string; timeout?: number } = {},
): Promise<AprRound> {
  const args = ["run", String(round)];

  if (options.workflow) {
    args.push("-w", options.workflow);
  }

  // Extended timeout for revision runs (default 10 minutes)
  const response = await executeAprCommand(args, {
    timeout: options.timeout ?? 600000,
  });

  if (!response.ok) {
    throw new Error(response.hint ?? `apr run failed: ${response.code}`);
  }

  return response.data as AprRound;
}

/**
 * Get revision history for a workflow.
 */
export async function getHistory(
  options: { workflow?: string } = {},
): Promise<AprHistory> {
  const args = ["history"];

  if (options.workflow) {
    args.push("-w", options.workflow);
  }

  const response = await executeAprCommand(args);

  if (!response.ok) {
    throw new Error(response.hint ?? `apr history failed: ${response.code}`);
  }

  return response.data as AprHistory;
}

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Compare two revision rounds.
 */
export async function diffRounds(
  roundA: number,
  roundB?: number,
  options: { workflow?: string } = {},
): Promise<AprDiff> {
  const args = ["diff", String(roundA)];

  if (roundB !== undefined) {
    args.push(String(roundB));
  }

  if (options.workflow) {
    args.push("-w", options.workflow);
  }

  const response = await executeAprCommand(args);

  if (!response.ok) {
    throw new Error(response.hint ?? `apr diff failed: ${response.code}`);
  }

  return response.data as AprDiff;
}

/**
 * Get Claude Code integration prompt.
 */
export async function getIntegrationPrompt(
  round: number,
  options: { workflow?: string; includeImpl?: boolean } = {},
): Promise<AprIntegration> {
  const args = ["integrate", String(round)];

  if (options.workflow) {
    args.push("-w", options.workflow);
  }

  if (options.includeImpl) {
    args.push("-i");
  }

  const response = await executeAprCommand(args);

  if (!response.ok) {
    throw new Error(response.hint ?? `apr integrate failed: ${response.code}`);
  }

  return response.data as AprIntegration;
}

/**
 * Get analytics and convergence metrics.
 */
export async function getStats(
  options: { workflow?: string } = {},
): Promise<AprMetrics & { convergence_trend?: number[] }> {
  const args = ["stats"];

  if (options.workflow) {
    args.push("-w", options.workflow);
  }

  const response = await executeAprCommand(args);

  if (!response.ok) {
    throw new Error(response.hint ?? `apr stats failed: ${response.code}`);
  }

  return response.data as AprMetrics & { convergence_trend?: number[] };
}

// ============================================================================
// Service Interface
// ============================================================================

export interface AprService {
  /** Check if apr CLI is available */
  isAvailable(): Promise<boolean>;

  /** Get apr CLI version */
  getVersion(): Promise<string | null>;

  /** Get system status */
  getStatus(): Promise<AprStatus>;

  /** List all workflows */
  listWorkflows(): Promise<AprWorkflow[]>;

  /** Get round details */
  getRound(
    round: number,
    options?: { workflow?: string; includeImpl?: boolean },
  ): Promise<AprRound>;

  /** Validate before running */
  validateRound(
    round: number,
    options?: { workflow?: string },
  ): Promise<{ valid: boolean; issues?: string[] }>;

  /** Run a revision round */
  runRound(
    round: number,
    options?: { workflow?: string; timeout?: number },
  ): Promise<AprRound>;

  /** Get revision history */
  getHistory(options?: { workflow?: string }): Promise<AprHistory>;

  /** Compare rounds */
  diffRounds(
    roundA: number,
    roundB?: number,
    options?: { workflow?: string },
  ): Promise<AprDiff>;

  /** Get integration prompt */
  getIntegrationPrompt(
    round: number,
    options?: { workflow?: string; includeImpl?: boolean },
  ): Promise<AprIntegration>;

  /** Get stats and metrics */
  getStats(options?: {
    workflow?: string;
  }): Promise<AprMetrics & { convergence_trend?: number[] }>;
}

export function createAprService(): AprService {
  return {
    isAvailable: isAprAvailable,
    getVersion: getAprVersion,
    getStatus,
    listWorkflows,
    getRound,
    validateRound,
    runRound,
    getHistory,
    diffRounds,
    getIntegrationPrompt,
    getStats,
  };
}

// ============================================================================
// Singleton
// ============================================================================

let serviceInstance: AprService | null = null;

export function getAprService(): AprService {
  if (!serviceInstance) {
    serviceInstance = createAprService();
  }
  return serviceInstance;
}
