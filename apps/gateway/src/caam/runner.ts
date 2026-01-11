/**
 * CAAM CLI Runner Service
 *
 * Invokes the `caam` CLI tool in workspace containers and parses JSON output.
 * This integrates the standalone CAAM CLI with Flywheel Gateway, allowing
 * the gateway to orchestrate account management across multiple workspaces.
 *
 * @see flywheel_gateway-vp0 for the integration bead
 * @see /data/projects/coding_agent_account_manager for the CAAM CLI source
 */

import { getLogger } from "../middleware/correlation";
import type {
  CaamCliCooldown,
  CaamCliProfile,
  CaamCliProfileHealth,
  CaamCliRotationResult,
  CaamCliStatus,
  ProviderId,
} from "./types";

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a caam CLI command execution.
 */
interface CaamExecResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  exitCode: number;
  stderr?: string;
}

/**
 * Full ls output from `caam ls --json`.
 */
interface CaamLsOutput {
  profiles: CaamLsProfile[];
  count: number;
}

/**
 * Profile as returned by `caam ls --json` (more detailed than CaamCliProfile).
 */
interface CaamLsProfile {
  tool: string;
  name: string;
  active: boolean;
  system: boolean;
  health: {
    status: string;
    expires_at?: string;
    error_count: number;
  };
  identity?: {
    email?: string;
    plan_type?: string;
  };
}

/**
 * Full status output from `caam status --json`.
 */
interface CaamStatusOutput {
  tools: CaamStatusTool[];
  warnings?: string[];
  recommendations?: string[];
}

interface CaamStatusTool {
  tool: string;
  logged_in: boolean;
  active_profile?: string;
  error?: string;
  health?: {
    status: string;
    reason?: string;
    expires_at?: string;
    error_count: number;
    cooldown_remaining?: string;
  };
  identity?: {
    email?: string;
    plan_type?: string;
  };
}

/**
 * Full activate output from `caam activate --json`.
 * @see coding_agent_account_manager/cmd/caam/cmd/activate.go activateOutput
 */
interface CaamActivateOutput {
  success: boolean;
  tool: string;
  profile: string;
  previous_profile?: string;
  source?: string;
  auto_backup?: string; // Path to auto-backup if created
  refreshed?: boolean; // Whether token was refreshed
  rotation?: CaamActivateRotation; // Rotation details if --auto was used
  error?: string;
}

/**
 * Rotation result details from activate --auto.
 */
interface CaamActivateRotation {
  algorithm: string; // "smart", "round_robin", "random"
  selected: string; // Selected profile name
  alternatives?: CaamRotationAlternative[];
}

interface CaamRotationAlternative {
  profile: string;
  score: number;
}

/**
 * Options for workspace execution.
 */
interface WorkspaceExecOptions {
  /** Workspace ID to execute in */
  workspaceId: string;
  /** Command arguments (after 'caam') */
  args: string[];
  /** Timeout in milliseconds */
  timeout?: number;
  /** Working directory override */
  cwd?: string;
}

// ============================================================================
// CaamRunner Interface
// ============================================================================

/**
 * Interface for CAAM CLI operations.
 * This is the main abstraction that gateway services use to interact with CAAM.
 */
export interface ICaamRunner {
  // Core profile operations
  listProfiles(
    workspaceId: string,
    provider?: ProviderId,
  ): Promise<CaamCliProfile[]>;
  getStatus(workspaceId: string, provider?: ProviderId): Promise<CaamCliStatus>;

  // Activation
  activate(
    workspaceId: string,
    provider: ProviderId,
    profile: string,
  ): Promise<CaamActivateOutput>;
  activateAuto(
    workspaceId: string,
    provider: ProviderId,
  ): Promise<CaamCliRotationResult>;

  // Cooldown management
  setCooldown(
    workspaceId: string,
    provider: ProviderId,
    profile: string,
    minutes: number,
    reason?: string,
  ): Promise<void>;
  clearCooldown(
    workspaceId: string,
    provider: ProviderId,
    profile: string,
  ): Promise<void>;
  listCooldowns(workspaceId: string): Promise<CaamCliCooldown[]>;

  // Auth file management
  backup(
    workspaceId: string,
    provider: ProviderId,
    name: string,
  ): Promise<void>;
  clear(workspaceId: string, provider: ProviderId): Promise<void>;

  // Health & diagnostics
  isAvailable(workspaceId: string): Promise<boolean>;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * CaamRunner implementation that executes caam commands in workspace containers.
 *
 * For now, this uses a stub/mock executor. In production, this would:
 * 1. Use Docker exec for containerized workspaces
 * 2. Use tmux send-keys for terminal-based workspaces
 * 3. Use SSH for remote workspaces
 */
export class CaamRunner implements ICaamRunner {
  private executor: WorkspaceExecutor;

  constructor(executor?: WorkspaceExecutor) {
    this.executor = executor ?? new LocalExecutor();
  }

  /**
   * List profiles from caam vault.
   */
  async listProfiles(
    workspaceId: string,
    provider?: ProviderId,
  ): Promise<CaamCliProfile[]> {
    const log = getLogger();
    const args = ["ls", "--json"];
    if (provider) {
      args.push(provider);
    }

    const result = await this.exec<CaamLsOutput>(workspaceId, args);

    if (!result.success || !result.data) {
      log.warn(
        { workspaceId, provider, error: result.error },
        "caam ls failed",
      );
      return [];
    }

    // Map to simplified profile format
    // Note: `logged_in` is derived from health status since `caam ls` doesn't expose
    // a direct logged_in field. Critical health indicates expired/invalid tokens.
    return result.data.profiles.map((p): CaamCliProfile => {
      const profile: CaamCliProfile = {
        provider: p.tool,
        name: p.name,
        active: p.active,
        logged_in: p.health.status !== "critical",
      };
      if (p.identity?.email) profile.account_id = p.identity.email;
      if (p.health.expires_at) profile.expires_at = p.health.expires_at;
      if (p.health.status === "critical") profile.error = "critical health";
      return profile;
    });
  }

  /**
   * Get status for a provider.
   */
  async getStatus(
    workspaceId: string,
    provider?: ProviderId,
  ): Promise<CaamCliStatus> {
    const log = getLogger();
    const args = ["status", "--json"];
    if (provider) {
      args.push(provider);
    }

    const result = await this.exec<CaamStatusOutput>(workspaceId, args);

    if (!result.success || !result.data) {
      log.warn(
        { workspaceId, provider, error: result.error },
        "caam status failed",
      );
      const status: CaamCliStatus = {
        provider: provider ?? "unknown",
        profile: "",
        logged_in: false,
      };
      if (result.error) status.error = result.error;
      return status;
    }

    // Find the matching tool status
    const toolStatus = provider
      ? result.data.tools.find((t) => t.tool === provider)
      : result.data.tools[0];

    if (!toolStatus) {
      const status: CaamCliStatus = {
        provider: provider ?? "unknown",
        profile: "",
        logged_in: false,
        error: "No status found",
      };
      return status;
    }

    const status: CaamCliStatus = {
      provider: toolStatus.tool,
      profile: toolStatus.active_profile ?? "",
      logged_in: toolStatus.logged_in,
    };

    if (toolStatus.identity?.email)
      status.account_id = toolStatus.identity.email;
    if (toolStatus.health?.expires_at)
      status.expires_at = toolStatus.health.expires_at;
    if (toolStatus.error) status.error = toolStatus.error;

    if (toolStatus.health) {
      const health: CaamCliProfileHealth = {
        error_count_1h: toolStatus.health.error_count,
        penalty: 0, // Not exposed in status output
      };
      if (toolStatus.health.expires_at)
        health.token_expires_at = toolStatus.health.expires_at;
      if (toolStatus.identity?.plan_type)
        health.plan_type = toolStatus.identity.plan_type;
      status.health = health;
    }

    return status;
  }

  /**
   * Activate a specific profile.
   */
  async activate(
    workspaceId: string,
    provider: ProviderId,
    profile: string,
  ): Promise<CaamActivateOutput> {
    const log = getLogger();
    const args = ["activate", provider, profile, "--json"];

    const result = await this.exec<CaamActivateOutput>(workspaceId, args);

    if (!result.success) {
      log.error(
        { workspaceId, provider, profile, error: result.error },
        "caam activate failed",
      );
      return {
        success: false,
        tool: provider,
        profile,
        error: result.error ?? "Activation failed",
      };
    }

    return (
      result.data ?? {
        success: true,
        tool: provider,
        profile,
      }
    );
  }

  /**
   * Activate using smart rotation (--auto flag).
   */
  async activateAuto(
    workspaceId: string,
    provider: ProviderId,
  ): Promise<CaamCliRotationResult> {
    const log = getLogger();
    const args = ["activate", provider, "--auto", "--json"];

    const result = await this.exec<CaamActivateOutput>(workspaceId, args);

    if (!result.success || !result.data) {
      log.error(
        { workspaceId, provider, error: result.error },
        "caam activate --auto failed",
      );
      return {
        success: false,
        provider,
        new_profile: "",
        reason: result.error ?? "Auto-activation failed",
      };
    }

    const rotationResult: CaamCliRotationResult = {
      success: result.data.success,
      provider: result.data.tool,
      new_profile: result.data.profile,
      reason: result.data.source ?? "smart rotation",
    };
    if (result.data.previous_profile) {
      rotationResult.previous_profile = result.data.previous_profile;
    }
    return rotationResult;
  }

  /**
   * Set a profile into cooldown.
   */
  async setCooldown(
    workspaceId: string,
    provider: ProviderId,
    profile: string,
    minutes: number,
    reason?: string,
  ): Promise<void> {
    const log = getLogger();
    const args = ["cooldown", "set", provider, profile, String(minutes)];
    if (reason) {
      args.push("--reason", reason);
    }

    const result = await this.exec(workspaceId, args);

    if (!result.success) {
      log.error(
        { workspaceId, provider, profile, minutes, error: result.error },
        "caam cooldown set failed",
      );
      throw new Error(`Failed to set cooldown: ${result.error}`);
    }

    log.info({ workspaceId, provider, profile, minutes }, "Set cooldown");
  }

  /**
   * Clear cooldown for a profile.
   */
  async clearCooldown(
    workspaceId: string,
    provider: ProviderId,
    profile: string,
  ): Promise<void> {
    const log = getLogger();
    const args = ["cooldown", "clear", provider, profile];

    const result = await this.exec(workspaceId, args);

    if (!result.success) {
      log.error(
        { workspaceId, provider, profile, error: result.error },
        "caam cooldown clear failed",
      );
      throw new Error(`Failed to clear cooldown: ${result.error}`);
    }

    log.info({ workspaceId, provider, profile }, "Cleared cooldown");
  }

  /**
   * List all active cooldowns.
   */
  async listCooldowns(workspaceId: string): Promise<CaamCliCooldown[]> {
    const log = getLogger();
    const args = ["cooldown", "list", "--json"];

    // CLI may return either { cooldowns: [...] } or [...] directly
    const result = await this.exec<
      { cooldowns: CaamCliCooldown[] } | CaamCliCooldown[]
    >(workspaceId, args);

    if (!result.success || !result.data) {
      log.warn(
        { workspaceId, error: result.error },
        "caam cooldown list failed",
      );
      return [];
    }

    // Handle both array and wrapped object formats
    if (Array.isArray(result.data)) {
      return result.data;
    }
    return result.data.cooldowns ?? [];
  }

  /**
   * Backup current auth files to vault.
   */
  async backup(
    workspaceId: string,
    provider: ProviderId,
    name: string,
  ): Promise<void> {
    const log = getLogger();
    const args = ["backup", provider, name, "--json"];

    const result = await this.exec<{ success: boolean; error?: string }>(
      workspaceId,
      args,
    );

    if (!result.success || !result.data?.success) {
      log.error(
        { workspaceId, provider, name, error: result.error },
        "caam backup failed",
      );
      throw new Error(
        `Failed to backup: ${result.error ?? result.data?.error}`,
      );
    }

    log.info({ workspaceId, provider, name }, "Backed up auth files");
  }

  /**
   * Clear auth files for a provider.
   */
  async clear(workspaceId: string, provider: ProviderId): Promise<void> {
    const log = getLogger();
    const args = ["clear", provider, "--force"];

    const result = await this.exec(workspaceId, args);

    if (!result.success) {
      log.error(
        { workspaceId, provider, error: result.error },
        "caam clear failed",
      );
      throw new Error(`Failed to clear: ${result.error}`);
    }

    log.info({ workspaceId, provider }, "Cleared auth files");
  }

  /**
   * Check if caam is available in the workspace.
   */
  async isAvailable(workspaceId: string): Promise<boolean> {
    const result = await this.exec(workspaceId, ["version"]);
    return result.success && result.exitCode === 0;
  }

  /**
   * Execute a caam command and parse JSON output.
   */
  private async exec<T = unknown>(
    workspaceId: string,
    args: string[],
  ): Promise<CaamExecResult<T>> {
    const log = getLogger();

    try {
      const rawResult = await this.executor.exec({
        workspaceId,
        args,
        timeout: 30000,
      });

      if (rawResult.exitCode !== 0) {
        return {
          success: false,
          error: rawResult.stderr || rawResult.stdout || "Command failed",
          exitCode: rawResult.exitCode,
          stderr: rawResult.stderr,
        };
      }

      // Try to parse JSON output
      try {
        const data = JSON.parse(rawResult.stdout) as T;
        return {
          success: true,
          data,
          exitCode: 0,
        };
      } catch {
        // Not JSON output, return raw stdout
        return {
          success: true,
          exitCode: 0,
        };
      }
    } catch (err) {
      log.error({ workspaceId, args, error: err }, "caam exec failed");
      return {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
        exitCode: -1,
      };
    }
  }
}

// ============================================================================
// Workspace Executors
// ============================================================================

/**
 * Interface for workspace command execution.
 */
export interface WorkspaceExecutor {
  exec(options: WorkspaceExecOptions): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
}

/**
 * Local executor for development/testing.
 * Executes caam commands on the local machine.
 */
export class LocalExecutor implements WorkspaceExecutor {
  async exec(options: WorkspaceExecOptions): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    const { args, timeout = 30000, cwd } = options;

    // Use Bun's subprocess API
    const proc = Bun.spawn(["caam", ...args], {
      cwd: cwd ?? process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Command timed out")), timeout);
    });

    try {
      const exitCode = await Promise.race([proc.exited, timeoutPromise]);

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      return {
        stdout,
        stderr,
        exitCode,
      };
    } catch (err) {
      proc.kill();
      throw err;
    }
  }
}

/**
 * Docker executor for containerized workspaces.
 * Executes caam commands inside a Docker container.
 */
export class DockerExecutor implements WorkspaceExecutor {
  async exec(options: WorkspaceExecOptions): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    const { workspaceId, args, timeout = 30000 } = options;

    // Container name derived from workspace ID
    const containerName = `flywheel-workspace-${workspaceId}`;

    const proc = Bun.spawn(["docker", "exec", containerName, "caam", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Command timed out")), timeout);
    });

    try {
      const exitCode = await Promise.race([proc.exited, timeoutPromise]);

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      return {
        stdout,
        stderr,
        exitCode,
      };
    } catch (err) {
      proc.kill();
      throw err;
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a CaamRunner for the given environment.
 */
export function createCaamRunner(
  mode: "local" | "docker" = "local",
): CaamRunner {
  const executor =
    mode === "docker" ? new DockerExecutor() : new LocalExecutor();
  return new CaamRunner(executor);
}

// Default singleton instance
let _defaultRunner: CaamRunner | null = null;

/**
 * Get the default CaamRunner instance.
 */
export function getCaamRunner(): CaamRunner {
  if (!_defaultRunner) {
    _defaultRunner = createCaamRunner("local");
  }
  return _defaultRunner;
}
