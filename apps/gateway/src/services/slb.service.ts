/**
 * SLB (Simultaneous Launch Button) Service
 *
 * Provides access to the slb CLI for two-person authorization of dangerous commands.
 * Commands are classified by risk tier (CRITICAL, DANGEROUS, CAUTION, SAFE) and
 * require approval from another authorized agent or human reviewer.
 *
 * CLI: https://github.com/Dicklesworthstone/slb
 */

import { getLogger } from "../middleware/correlation";

// ============================================================================
// Types
// ============================================================================

export type SlbTier = "safe" | "caution" | "dangerous" | "critical";

export type SlbRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "timeout"
  | "executed"
  | "failed";

export interface SlbVersion {
  version: string;
  commit: string;
  build_date: string;
  go_version: string;
  config_path: string;
  db_path: string;
  project_path: string;
}

export interface SlbPattern {
  pattern: string;
  source: "builtin" | "user" | "agent";
}

export interface SlbPatterns {
  safe: SlbPattern[];
  caution: SlbPattern[];
  dangerous: SlbPattern[];
  critical: SlbPattern[];
}

export interface SlbSession {
  id: string;
  agent: string;
  program: string;
  model: string;
  started_at: string;
  last_active_at: string;
  ended_at?: string;
  status: "active" | "ended" | "stale";
}

export interface SlbApproval {
  session_id: string;
  agent: string;
  approved_at: string;
  comments?: string;
  signature: string;
}

export interface SlbRequest {
  id: string;
  command: string;
  tier: SlbTier;
  status: SlbRequestStatus;
  requestor_session_id: string;
  requestor_agent?: string;
  reason?: string;
  safety?: string;
  goal?: string;
  expected_effect?: string;
  created_at: string;
  updated_at: string;
  approved_at?: string;
  rejected_at?: string;
  executed_at?: string;
  approvals?: SlbApproval[];
  required_approvals: number;
}

export interface SlbTierCheck {
  command: string;
  tier: SlbTier;
  matched_pattern?: string;
  requires_approval: boolean;
  required_approvals: number;
}

export interface SlbOutcome {
  request_id: string;
  exit_code: number;
  stdout?: string;
  stderr?: string;
  executed_at: string;
  duration_ms: number;
}

// ============================================================================
// CLI Execution Helper
// ============================================================================

interface SlbCommandResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function executeSlbCommand<T = unknown>(
  args: string[],
  options: { timeout?: number; maxOutputSize?: number; project?: string } = {},
): Promise<SlbCommandResult<T>> {
  const { timeout = 30000, maxOutputSize = 5 * 1024 * 1024, project } = options;
  const log = getLogger();

  try {
    // Always use JSON output
    const fullArgs = ["--json", ...args];

    // Add project path if specified
    if (project) {
      fullArgs.unshift("-C", project);
    }

    const proc = Bun.spawn(["slb", ...fullArgs], {
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
      const exitCode = await proc.exited;

      // Truncate if needed
      const output =
        stdout.length > maxOutputSize ? stdout.slice(0, maxOutputSize) : stdout;

      if (exitCode !== 0) {
        log.warn(
          { args, exitCode, stderr: stderr.slice(0, 200) },
          "slb command failed",
        );
        return {
          ok: false,
          error: stderr || `Command failed with exit code ${exitCode}`,
        };
      }

      // Parse JSON response
      try {
        const data = output.trim() ? JSON.parse(output.trim()) : null;
        return { ok: true, data: data as T };
      } catch {
        log.error(
          { stdout: output.slice(0, 200), stderr },
          "Failed to parse slb output",
        );
        return {
          ok: false,
          error: "Failed to parse slb output as JSON",
        };
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
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================================
// Detection
// ============================================================================

export async function isSlbAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["slb", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

export async function getSlbVersion(): Promise<SlbVersion | null> {
  const result = await executeSlbCommand<SlbVersion>(["version"]);
  return result.ok ? (result.data ?? null) : null;
}

// ============================================================================
// Session Functions
// ============================================================================

export interface SlbSessionStartOptions {
  agent: string;
  program: string;
  model: string;
  project?: string;
}

/**
 * Start a new slb session for an agent.
 */
export async function startSession(
  options: SlbSessionStartOptions,
): Promise<{ session: SlbSession; key: string }> {
  const args = [
    "session",
    "start",
    "-a",
    options.agent,
    "-p",
    options.program,
    "-m",
    options.model,
  ];

  const result = await executeSlbCommand<{ session: SlbSession; key: string }>(
    args,
    { project: options.project },
  );

  if (!result.ok || !result.data) {
    throw new Error(result.error ?? "Failed to start session");
  }

  return result.data;
}

/**
 * Resume an existing session or start a new one.
 */
export async function resumeSession(
  options: SlbSessionStartOptions,
): Promise<{ session: SlbSession; key: string }> {
  const args = [
    "session",
    "resume",
    "-a",
    options.agent,
    "-p",
    options.program,
    "-m",
    options.model,
  ];

  const result = await executeSlbCommand<{ session: SlbSession; key: string }>(
    args,
    { project: options.project },
  );

  if (!result.ok || !result.data) {
    throw new Error(result.error ?? "Failed to resume session");
  }

  return result.data;
}

/**
 * End a session.
 */
export async function endSession(
  sessionId: string,
  options: { project?: string } = {},
): Promise<void> {
  const args = ["session", "end", "-s", sessionId];

  const result = await executeSlbCommand(args, { project: options.project });

  if (!result.ok) {
    throw new Error(result.error ?? "Failed to end session");
  }
}

/**
 * Update session heartbeat.
 */
export async function heartbeatSession(
  sessionId: string,
  options: { project?: string } = {},
): Promise<void> {
  const args = ["session", "heartbeat", "-s", sessionId];

  const result = await executeSlbCommand(args, { project: options.project });

  if (!result.ok) {
    throw new Error(result.error ?? "Failed to update heartbeat");
  }
}

/**
 * List active sessions.
 */
export async function listSessions(
  options: { project?: string } = {},
): Promise<SlbSession[]> {
  const result = await executeSlbCommand<SlbSession[]>(["session", "list"], {
    project: options.project,
  });

  return result.ok ? (result.data ?? []) : [];
}

// ============================================================================
// Request Functions
// ============================================================================

export interface SlbRequestOptions {
  sessionId: string;
  reason?: string;
  safety?: string;
  goal?: string;
  expectedEffect?: string;
  project?: string;
}

/**
 * Check which tier a command matches.
 */
export async function checkCommand(
  command: string,
  options: { project?: string } = {},
): Promise<SlbTierCheck> {
  const result = await executeSlbCommand<SlbTierCheck>(["check", command], {
    project: options.project,
  });

  if (!result.ok || !result.data) {
    throw new Error(result.error ?? "Failed to check command");
  }

  return result.data;
}

/**
 * Create a new approval request.
 */
export async function createRequest(
  command: string,
  options: SlbRequestOptions,
): Promise<SlbRequest> {
  const args = ["request", command, "-s", options.sessionId];

  if (options.reason) {
    args.push("--reason", options.reason);
  }
  if (options.safety) {
    args.push("--safety", options.safety);
  }
  if (options.goal) {
    args.push("--goal", options.goal);
  }
  if (options.expectedEffect) {
    args.push("--expected-effect", options.expectedEffect);
  }

  const result = await executeSlbCommand<SlbRequest>(args, {
    project: options.project,
  });

  if (!result.ok || !result.data) {
    throw new Error(result.error ?? "Failed to create request");
  }

  return result.data;
}

/**
 * Get request status.
 */
export async function getRequest(
  requestId: string,
  options: { project?: string } = {},
): Promise<SlbRequest | null> {
  const result = await executeSlbCommand<SlbRequest>(["status", requestId], {
    project: options.project,
  });

  if (!result.ok) {
    if (result.error?.includes("not found")) {
      return null;
    }
    throw new Error(result.error ?? "Failed to get request");
  }

  return result.data ?? null;
}

/**
 * List pending requests.
 */
export async function listPendingRequests(
  options: {
    project?: string;
    reviewPool?: boolean;
    allProjects?: boolean;
  } = {},
): Promise<SlbRequest[]> {
  const args = ["pending"];

  if (options.reviewPool) {
    args.push("--review-pool");
  }
  if (options.allProjects) {
    args.push("--all-projects");
  }

  const result = await executeSlbCommand<SlbRequest[]>(args, {
    project: options.project,
  });

  return result.ok ? (result.data ?? []) : [];
}

/**
 * Get request history.
 */
export async function getHistory(
  options: {
    project?: string;
    query?: string;
    status?: SlbRequestStatus;
    tier?: SlbTier;
    agent?: string;
    since?: string;
    limit?: number;
  } = {},
): Promise<SlbRequest[]> {
  const args = ["history"];

  if (options.query) {
    args.push("-q", options.query);
  }
  if (options.status) {
    args.push("--status", options.status);
  }
  if (options.tier) {
    args.push("--tier", options.tier);
  }
  if (options.agent) {
    args.push("--agent", options.agent);
  }
  if (options.since) {
    args.push("--since", options.since);
  }
  if (options.limit !== undefined) {
    args.push("--limit", String(options.limit));
  }

  const result = await executeSlbCommand<SlbRequest[]>(args, {
    project: options.project,
  });

  return result.ok ? (result.data ?? []) : [];
}

// ============================================================================
// Approval Functions
// ============================================================================

export interface SlbApprovalOptions {
  sessionId: string;
  sessionKey: string;
  comments?: string;
  reasonResponse?: string;
  safetyResponse?: string;
  goalResponse?: string;
  effectResponse?: string;
  project?: string;
  targetProject?: string;
}

/**
 * Approve a request.
 */
export async function approveRequest(
  requestId: string,
  options: SlbApprovalOptions,
): Promise<SlbRequest> {
  const args = [
    "approve",
    requestId,
    "-s",
    options.sessionId,
    "-k",
    options.sessionKey,
  ];

  if (options.comments) {
    args.push("-m", options.comments);
  }
  if (options.reasonResponse) {
    args.push("--reason-response", options.reasonResponse);
  }
  if (options.safetyResponse) {
    args.push("--safety-response", options.safetyResponse);
  }
  if (options.goalResponse) {
    args.push("--goal-response", options.goalResponse);
  }
  if (options.effectResponse) {
    args.push("--effect-response", options.effectResponse);
  }
  if (options.targetProject) {
    args.push("--target-project", options.targetProject);
  }

  const result = await executeSlbCommand<SlbRequest>(args, {
    project: options.project,
  });

  if (!result.ok || !result.data) {
    throw new Error(result.error ?? "Failed to approve request");
  }

  return result.data;
}

/**
 * Reject a request.
 */
export async function rejectRequest(
  requestId: string,
  options: {
    sessionId: string;
    sessionKey: string;
    reason?: string;
    project?: string;
  },
): Promise<SlbRequest> {
  const args = [
    "reject",
    requestId,
    "-s",
    options.sessionId,
    "-k",
    options.sessionKey,
  ];

  if (options.reason) {
    args.push("-m", options.reason);
  }

  const result = await executeSlbCommand<SlbRequest>(args, {
    project: options.project,
  });

  if (!result.ok || !result.data) {
    throw new Error(result.error ?? "Failed to reject request");
  }

  return result.data;
}

/**
 * Cancel a request.
 */
export async function cancelRequest(
  requestId: string,
  options: {
    sessionId: string;
    project?: string;
  },
): Promise<void> {
  const args = ["cancel", requestId, "-s", options.sessionId];

  const result = await executeSlbCommand(args, { project: options.project });

  if (!result.ok) {
    throw new Error(result.error ?? "Failed to cancel request");
  }
}

// ============================================================================
// Execution Functions
// ============================================================================

/**
 * Execute an approved request.
 */
export async function executeRequest(
  requestId: string,
  options: {
    sessionId: string;
    project?: string;
    timeout?: number;
  },
): Promise<SlbOutcome> {
  const args = ["execute", requestId, "-s", options.sessionId];

  const result = await executeSlbCommand<SlbOutcome>(args, {
    project: options.project,
    timeout: options.timeout ?? 300000, // 5 minutes default for execution
  });

  if (!result.ok || !result.data) {
    throw new Error(result.error ?? "Failed to execute request");
  }

  return result.data;
}

// ============================================================================
// Pattern Functions
// ============================================================================

/**
 * List all patterns grouped by tier.
 */
export async function listPatterns(
  options: { project?: string } = {},
): Promise<SlbPatterns> {
  const result = await executeSlbCommand<SlbPatterns>(["patterns", "list"], {
    project: options.project,
  });

  if (!result.ok || !result.data) {
    throw new Error(result.error ?? "Failed to list patterns");
  }

  return result.data;
}

/**
 * Add a pattern to a tier.
 */
export async function addPattern(
  pattern: string,
  tier: SlbTier,
  options: {
    reason?: string;
    project?: string;
  } = {},
): Promise<void> {
  const args = ["patterns", "add", pattern, "-t", tier];

  if (options.reason) {
    args.push("-r", options.reason);
  }

  const result = await executeSlbCommand(args, { project: options.project });

  if (!result.ok) {
    throw new Error(result.error ?? "Failed to add pattern");
  }
}

/**
 * Suggest a pattern for human review.
 */
export async function suggestPattern(
  pattern: string,
  tier: SlbTier,
  options: {
    reason?: string;
    project?: string;
  } = {},
): Promise<void> {
  const args = ["patterns", "suggest", pattern, "-t", tier];

  if (options.reason) {
    args.push("-r", options.reason);
  }

  const result = await executeSlbCommand(args, { project: options.project });

  if (!result.ok) {
    throw new Error(result.error ?? "Failed to suggest pattern");
  }
}

// ============================================================================
// Service Interface
// ============================================================================

export interface SlbService {
  /** Check if slb CLI is available */
  isAvailable(): Promise<boolean>;

  /** Get slb version info */
  getVersion(): Promise<SlbVersion | null>;

  /** Start a new session */
  startSession(
    options: SlbSessionStartOptions,
  ): Promise<{ session: SlbSession; key: string }>;

  /** Resume or start a session */
  resumeSession(
    options: SlbSessionStartOptions,
  ): Promise<{ session: SlbSession; key: string }>;

  /** End a session */
  endSession(sessionId: string, options?: { project?: string }): Promise<void>;

  /** Update session heartbeat */
  heartbeatSession(
    sessionId: string,
    options?: { project?: string },
  ): Promise<void>;

  /** List active sessions */
  listSessions(options?: { project?: string }): Promise<SlbSession[]>;

  /** Check which tier a command matches */
  checkCommand(
    command: string,
    options?: { project?: string },
  ): Promise<SlbTierCheck>;

  /** Create an approval request */
  createRequest(
    command: string,
    options: SlbRequestOptions,
  ): Promise<SlbRequest>;

  /** Get request by ID */
  getRequest(
    requestId: string,
    options?: { project?: string },
  ): Promise<SlbRequest | null>;

  /** List pending requests */
  listPendingRequests(options?: {
    project?: string;
    reviewPool?: boolean;
    allProjects?: boolean;
  }): Promise<SlbRequest[]>;

  /** Get request history */
  getHistory(options?: {
    project?: string;
    query?: string;
    status?: SlbRequestStatus;
    tier?: SlbTier;
    agent?: string;
    since?: string;
    limit?: number;
  }): Promise<SlbRequest[]>;

  /** Approve a request */
  approveRequest(
    requestId: string,
    options: SlbApprovalOptions,
  ): Promise<SlbRequest>;

  /** Reject a request */
  rejectRequest(
    requestId: string,
    options: {
      sessionId: string;
      sessionKey: string;
      reason?: string;
      project?: string;
    },
  ): Promise<SlbRequest>;

  /** Cancel a request */
  cancelRequest(
    requestId: string,
    options: { sessionId: string; project?: string },
  ): Promise<void>;

  /** Execute an approved request */
  executeRequest(
    requestId: string,
    options: { sessionId: string; project?: string; timeout?: number },
  ): Promise<SlbOutcome>;

  /** List patterns */
  listPatterns(options?: { project?: string }): Promise<SlbPatterns>;

  /** Add a pattern */
  addPattern(
    pattern: string,
    tier: SlbTier,
    options?: { reason?: string; project?: string },
  ): Promise<void>;

  /** Suggest a pattern for human review */
  suggestPattern(
    pattern: string,
    tier: SlbTier,
    options?: { reason?: string; project?: string },
  ): Promise<void>;
}

export function createSlbService(): SlbService {
  return {
    isAvailable: isSlbAvailable,
    getVersion: getSlbVersion,
    startSession,
    resumeSession,
    endSession,
    heartbeatSession,
    listSessions,
    checkCommand,
    createRequest,
    getRequest,
    listPendingRequests,
    getHistory,
    approveRequest,
    rejectRequest,
    cancelRequest,
    executeRequest,
    listPatterns,
    addPattern,
    suggestPattern,
  };
}

// ============================================================================
// Singleton
// ============================================================================

let serviceInstance: SlbService | null = null;

export function getSlbService(): SlbService {
  if (!serviceInstance) {
    serviceInstance = createSlbService();
  }
  return serviceInstance;
}
