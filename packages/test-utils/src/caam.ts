/**
 * CAAM Test Utilities
 *
 * Mock executor and harness for testing CAAM CLI integration.
 */

/**
 * Mock profile as returned by caam ls --json.
 */
export interface MockCaamProfile {
  tool: string;
  name: string;
  active: boolean;
  system?: boolean;
  health: {
    status: "healthy" | "warning" | "critical";
    expires_at?: string;
    error_count?: number;
  };
  identity?: {
    email?: string;
    plan_type?: string;
  };
}

/**
 * Mock cooldown entry.
 */
export interface MockCaamCooldown {
  provider: string;
  profile: string;
  hit_at: string;
  cooldown_until: string;
  remaining_minutes: number;
  notes?: string;
}

/**
 * Mock status tool entry.
 */
export interface MockCaamStatusTool {
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
 * Configuration for MockCaamExecutor.
 */
export interface MockCaamConfig {
  profiles?: MockCaamProfile[];
  cooldowns?: MockCaamCooldown[];
  statusTools?: MockCaamStatusTool[];
  version?: string;
  /** Map of command patterns to error responses */
  failureScenarios?: Map<string, { error: string; exitCode: number }>;
}

/**
 * Recorded call for assertion.
 */
export interface CaamCall {
  args: string[];
  timestamp: Date;
  result: { stdout: string; stderr: string; exitCode: number };
}

/**
 * Mock executor for testing CAAM CLI integration.
 * Simulates caam CLI responses without actually executing the binary.
 */
export class MockCaamExecutor {
  private config: MockCaamConfig;
  private callHistory: CaamCall[] = [];

  constructor(config: MockCaamConfig = {}) {
    this.config = {
      profiles: config.profiles ?? [],
      cooldowns: config.cooldowns ?? [],
      statusTools: config.statusTools ?? [],
      version: config.version ?? "1.0.0-mock",
      failureScenarios: config.failureScenarios ?? new Map(),
    };
  }

  /**
   * Execute a mocked caam command.
   */
  async exec(options: {
    workspaceId: string;
    args: string[];
    timeout?: number;
    cwd?: string;
  }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const { args } = options;
    const command = args[0];

    // Check for failure scenarios
    const argsKey = args.join(" ");
    for (const [pattern, failure] of this.config.failureScenarios ?? []) {
      if (argsKey.includes(pattern)) {
        const result = {
          stdout: "",
          stderr: failure.error,
          exitCode: failure.exitCode,
        };
        this.recordCall(args, result);
        return result;
      }
    }

    let result: { stdout: string; stderr: string; exitCode: number };

    switch (command) {
      case "version":
        result = { stdout: this.config.version!, stderr: "", exitCode: 0 };
        break;

      case "ls":
        result = this.handleLs(args);
        break;

      case "status":
        result = this.handleStatus(args);
        break;

      case "activate":
        result = this.handleActivate(args);
        break;

      case "cooldown":
        result = this.handleCooldown(args);
        break;

      case "backup":
        result = this.handleBackup(args);
        break;

      case "clear":
        result = this.handleClear(args);
        break;

      default:
        result = {
          stdout: "",
          stderr: `Unknown command: ${command}`,
          exitCode: 1,
        };
    }

    this.recordCall(args, result);
    return result;
  }

  private handleLs(args: string[]): {
    stdout: string;
    stderr: string;
    exitCode: number;
  } {
    const hasJson = args.includes("--json");
    const provider = args.find((a) => !a.startsWith("-") && a !== "ls");

    let profiles = this.config.profiles ?? [];
    if (provider) {
      profiles = profiles.filter((p) => p.tool === provider);
    }

    if (hasJson) {
      const output = { profiles, count: profiles.length };
      return { stdout: JSON.stringify(output), stderr: "", exitCode: 0 };
    }

    // Non-JSON output (simple text)
    const lines = profiles.map(
      (p) => `${p.tool}/${p.name} ${p.active ? "(active)" : ""}`,
    );
    return { stdout: lines.join("\n"), stderr: "", exitCode: 0 };
  }

  private handleStatus(args: string[]): {
    stdout: string;
    stderr: string;
    exitCode: number;
  } {
    const hasJson = args.includes("--json");
    const provider = args.find((a) => !a.startsWith("-") && a !== "status");

    let tools = this.config.statusTools ?? [];
    if (provider) {
      tools = tools.filter((t) => t.tool === provider);
    }

    if (hasJson) {
      const output = { tools, warnings: [], recommendations: [] };
      return { stdout: JSON.stringify(output), stderr: "", exitCode: 0 };
    }

    return { stdout: "Status OK", stderr: "", exitCode: 0 };
  }

  private handleActivate(args: string[]): {
    stdout: string;
    stderr: string;
    exitCode: number;
  } {
    const hasJson = args.includes("--json");
    const hasAuto = args.includes("--auto");
    const provider = args.find(
      (a) => !a.startsWith("-") && a !== "activate" && a !== "--json",
    );
    const profile = args.find(
      (a, i) => !a.startsWith("-") && a !== "activate" && a !== provider,
    );

    const output = {
      success: true,
      tool: provider ?? "unknown",
      profile: hasAuto
        ? this.config.profiles?.[0]?.name ?? "default"
        : (profile ?? "default"),
      source: hasAuto ? "smart rotation" : "manual",
    };

    if (hasJson) {
      return { stdout: JSON.stringify(output), stderr: "", exitCode: 0 };
    }
    return { stdout: `Activated ${profile}`, stderr: "", exitCode: 0 };
  }

  private handleCooldown(args: string[]): {
    stdout: string;
    stderr: string;
    exitCode: number;
  } {
    const subcommand = args[1]; // set, clear, or list
    const hasJson = args.includes("--json");

    if (subcommand === "list") {
      const cooldowns = this.config.cooldowns ?? [];
      if (hasJson) {
        return {
          stdout: JSON.stringify({ cooldowns }),
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "No active cooldowns", stderr: "", exitCode: 0 };
    }

    if (subcommand === "set" || subcommand === "clear") {
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    return { stdout: "", stderr: "Unknown cooldown subcommand", exitCode: 1 };
  }

  private handleBackup(args: string[]): {
    stdout: string;
    stderr: string;
    exitCode: number;
  } {
    const hasJson = args.includes("--json");
    if (hasJson) {
      return { stdout: JSON.stringify({ success: true }), stderr: "", exitCode: 0 };
    }
    return { stdout: "Backup created", stderr: "", exitCode: 0 };
  }

  private handleClear(args: string[]): {
    stdout: string;
    stderr: string;
    exitCode: number;
  } {
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  private recordCall(
    args: string[],
    result: { stdout: string; stderr: string; exitCode: number },
  ): void {
    this.callHistory.push({
      args,
      timestamp: new Date(),
      result,
    });
  }

  // ============================================================================
  // Configuration Methods
  // ============================================================================

  /**
   * Update mock profiles.
   */
  setProfiles(profiles: MockCaamProfile[]): void {
    this.config.profiles = profiles;
  }

  /**
   * Update mock cooldowns.
   */
  setCooldowns(cooldowns: MockCaamCooldown[]): void {
    this.config.cooldowns = cooldowns;
  }

  /**
   * Update mock status tools.
   */
  setStatusTools(tools: MockCaamStatusTool[]): void {
    this.config.statusTools = tools;
  }

  /**
   * Inject a failure scenario.
   */
  injectFailure(pattern: string, error: string, exitCode = 1): void {
    this.config.failureScenarios =
      this.config.failureScenarios ?? new Map();
    this.config.failureScenarios.set(pattern, { error, exitCode });
  }

  /**
   * Clear all failure scenarios.
   */
  clearFailures(): void {
    this.config.failureScenarios = new Map();
  }

  /**
   * Get call history for assertions.
   */
  getCallHistory(): CaamCall[] {
    return [...this.callHistory];
  }

  /**
   * Clear call history.
   */
  clearCallHistory(): void {
    this.callHistory = [];
  }

  /**
   * Reset all state.
   */
  reset(): void {
    this.config = {
      profiles: [],
      cooldowns: [],
      statusTools: [],
      version: "1.0.0-mock",
      failureScenarios: new Map(),
    };
    this.callHistory = [];
  }
}

/**
 * Create a mock executor with default healthy state.
 */
export function createMockCaamExecutor(
  config?: Partial<MockCaamConfig>,
): MockCaamExecutor {
  return new MockCaamExecutor({
    profiles: config?.profiles ?? [
      {
        tool: "claude",
        name: "default",
        active: true,
        health: { status: "healthy" },
      },
    ],
    statusTools: config?.statusTools ?? [
      {
        tool: "claude",
        logged_in: true,
        active_profile: "default",
        health: { status: "healthy", error_count: 0 },
      },
    ],
    cooldowns: config?.cooldowns ?? [],
    version: config?.version ?? "1.0.0-mock",
    failureScenarios: config?.failureScenarios,
  });
}
