#!/usr/bin/env bun

/**
 * Flywheel Gateway Operator CLI
 *
 * Provides operator-facing commands for health checks, status monitoring,
 * and quick access to documentation.
 *
 * Usage:
 *   bun scripts/flywheel.ts doctor          # Run readiness checks
 *   bun scripts/flywheel.ts status          # Show service status
 *   bun scripts/flywheel.ts open [target]   # Open dashboard/docs
 *   bun scripts/flywheel.ts --help          # Show help
 *
 * Options:
 *   --json    Output as JSON for automation
 *   --verbose Show detailed output
 *
 * Exit codes:
 *   0 - Success / All checks passed
 *   1 - Errors found / Checks failed
 *   2 - Invalid usage
 */

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

// ============================================================================
// Types
// ============================================================================

interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  details?: string;
}

interface DoctorReport {
  timestamp: string;
  checks: CheckResult[];
  summary: {
    total: number;
    passed: number;
    warnings: number;
    failed: number;
  };
  healthy: boolean;
}

interface ServiceStatus {
  name: string;
  running: boolean;
  pid?: number;
  url?: string;
  details?: string;
}

interface StatusReport {
  timestamp: string;
  services: ServiceStatus[];
  websocket: {
    available: boolean;
    url?: string;
  };
  database: {
    available: boolean;
    path?: string;
    size?: string;
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

function hasGum(): boolean {
  try {
    Bun.spawnSync(["which", "gum"]);
    return true;
  } catch {
    return false;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

function colorize(
  text: string,
  color: "green" | "yellow" | "red" | "cyan" | "gray",
): string {
  const colors: Record<string, string> = {
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    gray: "\x1b[90m",
  };
  return `${colors[color]}${text}\x1b[0m`;
}

function statusIcon(status: "pass" | "warn" | "fail"): string {
  switch (status) {
    case "pass":
      return colorize("✓", "green");
    case "warn":
      return colorize("⚠", "yellow");
    case "fail":
      return colorize("✗", "red");
  }
}

// ============================================================================
// Doctor Command
// ============================================================================

async function runDoctorChecks(): Promise<DoctorReport> {
  const checks: CheckResult[] = [];
  const cwd = process.cwd();

  // Check 1: Bun version
  try {
    const bunVersion = Bun.version;
    const major = parseInt(bunVersion.split(".")[0] ?? "0", 10);
    if (major >= 1) {
      checks.push({
        name: "Bun runtime",
        status: "pass",
        message: `Bun ${bunVersion} installed`,
      });
    } else {
      checks.push({
        name: "Bun runtime",
        status: "warn",
        message: `Bun ${bunVersion} - consider updating to 1.3+`,
      });
    }
  } catch {
    checks.push({
      name: "Bun runtime",
      status: "fail",
      message: "Bun not detected",
    });
  }

  // Check 2: Node modules
  const nodeModulesPath = join(cwd, "node_modules");
  if (existsSync(nodeModulesPath)) {
    checks.push({
      name: "Dependencies",
      status: "pass",
      message: "node_modules present",
    });
  } else {
    checks.push({
      name: "Dependencies",
      status: "fail",
      message: "node_modules missing - run 'bun install'",
    });
  }

  // Check 3: Database file
  const dbPaths = [
    join(cwd, "flywheel.db"),
    join(cwd, "apps/gateway/flywheel.db"),
    join(cwd, "data/gateway.db"),
  ];
  let dbFound = false;
  for (const dbPath of dbPaths) {
    if (existsSync(dbPath)) {
      const stats = statSync(dbPath);
      checks.push({
        name: "Database",
        status: "pass",
        message: `SQLite database found (${formatBytes(stats.size)})`,
        details: dbPath,
      });
      dbFound = true;
      break;
    }
  }
  if (!dbFound) {
    checks.push({
      name: "Database",
      status: "warn",
      message: "No database file found - will be created on first run",
    });
  }

  // Check 4: Config file
  const configPaths = [
    join(cwd, "flywheel.config.ts"),
    join(homedir(), ".config", "flywheel", "config.ts"),
  ];
  let configFound = false;
  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      checks.push({
        name: "Configuration",
        status: "pass",
        message: "Config file found",
        details: configPath,
      });
      configFound = true;
      break;
    }
  }
  if (!configFound) {
    checks.push({
      name: "Configuration",
      status: "pass",
      message: "Using default configuration",
    });
  }

  // Check 5: TypeScript config
  if (existsSync(join(cwd, "tsconfig.json"))) {
    checks.push({
      name: "TypeScript",
      status: "pass",
      message: "tsconfig.json present",
    });
  } else {
    checks.push({
      name: "TypeScript",
      status: "warn",
      message: "tsconfig.json not found",
    });
  }

  // Check 6: Gateway app
  const gatewayPath = join(cwd, "apps/gateway");
  if (existsSync(gatewayPath)) {
    checks.push({
      name: "Gateway app",
      status: "pass",
      message: "apps/gateway found",
    });
  } else {
    checks.push({
      name: "Gateway app",
      status: "fail",
      message: "apps/gateway not found",
    });
  }

  // Check 7: Web app
  const webPath = join(cwd, "apps/web");
  if (existsSync(webPath)) {
    checks.push({
      name: "Web app",
      status: "pass",
      message: "apps/web found",
    });
  } else {
    checks.push({
      name: "Web app",
      status: "fail",
      message: "apps/web not found",
    });
  }

  // Check 8: Environment variables
  const hasEnvFile = existsSync(join(cwd, ".env"));
  const hasEnvExample = existsSync(join(cwd, ".env.example"));
  if (hasEnvFile) {
    checks.push({
      name: "Environment",
      status: "pass",
      message: ".env file present",
    });
  } else if (hasEnvExample) {
    checks.push({
      name: "Environment",
      status: "warn",
      message: ".env.example exists but .env not found - copy and configure",
    });
  } else {
    checks.push({
      name: "Environment",
      status: "pass",
      message: "Using environment variables or defaults",
    });
  }

  // Check 9: Git repository
  if (existsSync(join(cwd, ".git"))) {
    checks.push({
      name: "Git repository",
      status: "pass",
      message: "Git initialized",
    });
  } else {
    checks.push({
      name: "Git repository",
      status: "warn",
      message: "Not a git repository",
    });
  }

  // Check 10: Optional tooling (gum)
  if (hasGum()) {
    checks.push({
      name: "gum CLI",
      status: "pass",
      message: "gum available for enhanced UX",
    });
  } else {
    checks.push({
      name: "gum CLI",
      status: "pass",
      message: "gum not installed (optional)",
      details: "Install with: brew install gum",
    });
  }

  // Summary
  const summary = {
    total: checks.length,
    passed: checks.filter((c) => c.status === "pass").length,
    warnings: checks.filter((c) => c.status === "warn").length,
    failed: checks.filter((c) => c.status === "fail").length,
  };

  return {
    timestamp: new Date().toISOString(),
    checks,
    summary,
    healthy: summary.failed === 0,
  };
}

function formatDoctorReport(report: DoctorReport, verbose: boolean): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(colorize("  Flywheel Gateway - Doctor", "cyan"));
  lines.push(colorize(`  ${"─".repeat(30)}`, "gray"));
  lines.push("");

  for (const check of report.checks) {
    const icon = statusIcon(check.status);
    lines.push(`  ${icon} ${check.name}: ${check.message}`);
    if (verbose && check.details) {
      lines.push(colorize(`      ${check.details}`, "gray"));
    }
  }

  lines.push("");
  lines.push(colorize(`  ${"─".repeat(30)}`, "gray"));

  const statusColor = report.healthy ? "green" : "red";
  const statusText = report.healthy ? "All checks passed" : "Issues found";
  lines.push(
    `  ${colorize(statusText, statusColor)} ` +
      colorize(`(${report.summary.passed}/${report.summary.total})`, "gray"),
  );

  if (report.summary.warnings > 0) {
    lines.push(colorize(`  ${report.summary.warnings} warning(s)`, "yellow"));
  }
  if (report.summary.failed > 0) {
    lines.push(colorize(`  ${report.summary.failed} error(s)`, "red"));
  }

  lines.push("");
  return lines.join("\n");
}

// ============================================================================
// Status Command
// ============================================================================

async function getStatus(): Promise<StatusReport> {
  const services: ServiceStatus[] = [];
  const cwd = process.cwd();

  // Check if gateway is running (try to connect to API)
  let gatewayRunning = false;
  const gatewayUrl = process.env["GATEWAY_URL"] ?? "http://localhost:3000";
  try {
    const response = await fetch(`${gatewayUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      gatewayRunning = true;
      const data = await response.json();
      services.push({
        name: "Gateway API",
        running: true,
        url: gatewayUrl,
        details: `v${data.version ?? "unknown"}, uptime: ${data.uptime ?? "unknown"}`,
      });
    } else {
      services.push({
        name: "Gateway API",
        running: false,
        url: gatewayUrl,
        details: `HTTP ${response.status}`,
      });
    }
  } catch {
    services.push({
      name: "Gateway API",
      running: false,
      url: gatewayUrl,
      details: "Not responding",
    });
  }

  // Check if web app is running
  const webUrl = process.env["WEB_URL"] ?? "http://localhost:5173";
  try {
    const response = await fetch(webUrl, { signal: AbortSignal.timeout(2000) });
    services.push({
      name: "Web Dashboard",
      running: response.ok,
      url: webUrl,
    });
  } catch {
    services.push({
      name: "Web Dashboard",
      running: false,
      url: webUrl,
      details: "Not responding",
    });
  }

  // WebSocket status
  const wsUrl = `${gatewayUrl.replace("http", "ws")}/ws`;
  const websocket = {
    available: gatewayRunning,
    url: wsUrl,
  };

  // Database status
  const dbPaths = [
    join(cwd, "flywheel.db"),
    join(cwd, "apps/gateway/flywheel.db"),
  ];
  let database: StatusReport["database"] = { available: false };
  for (const dbPath of dbPaths) {
    if (existsSync(dbPath)) {
      const stats = statSync(dbPath);
      database = {
        available: true,
        path: dbPath,
        size: formatBytes(stats.size),
      };
      break;
    }
  }

  return {
    timestamp: new Date().toISOString(),
    services,
    websocket,
    database,
  };
}

function formatStatusReport(report: StatusReport): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(colorize("  Flywheel Gateway - Status", "cyan"));
  lines.push(colorize(`  ${"─".repeat(30)}`, "gray"));
  lines.push("");

  lines.push(colorize("  Services", "cyan"));
  for (const service of report.services) {
    const icon = service.running
      ? colorize("●", "green")
      : colorize("○", "red");
    const status = service.running ? "running" : "stopped";
    lines.push(`  ${icon} ${service.name}: ${status}`);
    if (service.url) {
      lines.push(colorize(`      ${service.url}`, "gray"));
    }
    if (service.details) {
      lines.push(colorize(`      ${service.details}`, "gray"));
    }
  }

  lines.push("");
  lines.push(colorize("  WebSocket", "cyan"));
  const wsIcon = report.websocket.available
    ? colorize("●", "green")
    : colorize("○", "red");
  lines.push(
    `  ${wsIcon} ${report.websocket.available ? "Available" : "Unavailable"}`,
  );
  if (report.websocket.url) {
    lines.push(colorize(`      ${report.websocket.url}`, "gray"));
  }

  lines.push("");
  lines.push(colorize("  Database", "cyan"));
  const dbIcon = report.database.available
    ? colorize("●", "green")
    : colorize("○", "yellow");
  if (report.database.available) {
    lines.push(`  ${dbIcon} SQLite (${report.database.size})`);
    lines.push(colorize(`      ${report.database.path}`, "gray"));
  } else {
    lines.push(`  ${dbIcon} Not found (will be created)`);
  }

  lines.push("");
  return lines.join("\n");
}

// ============================================================================
// Open Command
// ============================================================================

const OPEN_TARGETS: Record<string, { url: string; description: string }> = {
  dashboard: {
    url: "http://localhost:5173",
    description: "Web dashboard",
  },
  api: {
    url: "http://localhost:3000",
    description: "Gateway API",
  },
  docs: {
    url: "http://localhost:3000/docs",
    description: "Swagger API docs",
  },
  redoc: {
    url: "http://localhost:3000/redoc",
    description: "ReDoc API docs",
  },
  repo: {
    url: "https://github.com/Dicklesworthstone/flywheel_gateway",
    description: "GitHub repository",
  },
};

async function openTarget(target: string): Promise<void> {
  const entry = OPEN_TARGETS[target];
  if (!entry) {
    console.error(`Unknown target: ${target}`);
    console.log("\nAvailable targets:");
    for (const [key, value] of Object.entries(OPEN_TARGETS)) {
      console.log(`  ${key.padEnd(12)} - ${value.description}`);
    }
    process.exit(2);
  }

  const url = entry.url;
  console.log(`Opening ${entry.description}: ${url}`);

  // Use platform-specific open command
  const platform = process.platform;
  let cmd: string[];
  if (platform === "darwin") {
    cmd = ["open", url];
  } else if (platform === "win32") {
    cmd = ["cmd", "/c", "start", url];
  } else {
    cmd = ["xdg-open", url];
  }

  try {
    Bun.spawn(cmd);
  } catch (error) {
    console.error(`Failed to open: ${error}`);
    console.log(`URL: ${url}`);
  }
}

// ============================================================================
// Update
// ============================================================================

interface UpdateResult {
  success: boolean;
  version?: string;
  error?: string;
}

async function runUpdate(options: { check: boolean }): Promise<UpdateResult> {
  const installerUrl =
    "https://raw.githubusercontent.com/Dicklesworthstone/flywheel_gateway/main/scripts/install.sh";

  if (options.check) {
    // Just check for updates, don't install
    console.log(colorize("  Checking for updates...", "cyan"));

    try {
      // Get current version
      const currentVersion = await getCurrentVersion();

      // Get latest version from GitHub
      const response = await fetch(
        "https://api.github.com/repos/Dicklesworthstone/flywheel_gateway/releases/latest",
      );
      if (!response.ok) {
        return { success: false, error: "Could not fetch latest version" };
      }
      const data = (await response.json()) as { tag_name: string };
      const latestVersion = data.tag_name;

      if (currentVersion === latestVersion) {
        console.log(
          colorize(`  ✓ Already up to date (${currentVersion})`, "green"),
        );
        return { success: true, version: currentVersion };
      }

      console.log(`  Current version: ${currentVersion}`);
      console.log(`  Latest version:  ${latestVersion}`);
      console.log("");
      console.log(
        `  Run ${colorize("flywheel update", "cyan")} to install the latest version.`,
      );
      return { success: true, version: latestVersion };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // Run the installer with --easy-mode for idempotent update
  console.log(colorize("  Flywheel Gateway - Update", "cyan"));
  console.log(colorize("  ──────────────────────────────", "gray"));
  console.log("");
  console.log("  Re-running installer to update to the latest version...");
  console.log("");

  try {
    // Download and execute the installer
    const proc = Bun.spawn(
      ["bash", "-c", `curl -fsSL "${installerUrl}" | bash -s -- --easy-mode`],
      {
        stdout: "inherit",
        stderr: "inherit",
      },
    );

    const exitCode = await proc.exited;

    if (exitCode === 0) {
      return { success: true };
    }

    return { success: false, error: `Installer exited with code ${exitCode}` };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function getCurrentVersion(): Promise<string> {
  // Try to get version from package.json
  try {
    const pkgPath = join(process.cwd(), "package.json");
    if (existsSync(pkgPath)) {
      const pkg = await Bun.file(pkgPath).json();
      if (pkg.version) {
        return `v${pkg.version}`;
      }
    }
  } catch {
    // Ignore
  }

  // Try git tag
  try {
    const result = await $`git describe --tags --abbrev=0 2>/dev/null`.text();
    if (result.trim()) {
      return result.trim();
    }
  } catch {
    // Ignore
  }

  return "unknown";
}

// ============================================================================
// Help
// ============================================================================

function showHelp(): void {
  console.log(`
${colorize("Flywheel Gateway CLI", "cyan")}

${colorize("Usage:", "yellow")}
  flywheel <command> [options]

${colorize("Commands:", "yellow")}
  doctor         Run readiness checks
  status         Show service status
  update         Update to the latest version
  open [target]  Open dashboard/docs in browser

${colorize("Options:", "yellow")}
  --json         Output as JSON for automation
  --verbose, -v  Show detailed output
  --check        Check for updates without installing (for update command)
  --help, -h     Show this help

${colorize("Open Targets:", "yellow")}
  dashboard      Web dashboard (default)
  api            Gateway API root
  docs           Swagger API documentation
  redoc          ReDoc API documentation
  repo           GitHub repository

${colorize("Examples:", "yellow")}
  flywheel doctor              # Check gateway readiness
  flywheel status --json       # Get status as JSON
  flywheel update              # Update to latest version
  flywheel update --check      # Check for updates
  flywheel open dashboard      # Open web dashboard
  flywheel open docs           # Open API docs

${colorize("Exit Codes:", "yellow")}
  0  Success / All checks passed
  1  Errors found / Checks failed
  2  Invalid usage
`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args.find((a) => !a.startsWith("-"));
  const jsonOutput = args.includes("--json") || args.includes("--robot");
  const verbose = args.includes("--verbose") || args.includes("-v");
  const help = args.includes("--help") || args.includes("-h");
  const checkOnly = args.includes("--check");

  if (help || !command) {
    showHelp();
    process.exit(command ? 0 : 2);
  }

  switch (command) {
    case "doctor": {
      const report = await runDoctorChecks();
      if (jsonOutput) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatDoctorReport(report, verbose));
      }
      process.exit(report.healthy ? 0 : 1);
      break;
    }

    case "status": {
      const report = await getStatus();
      if (jsonOutput) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatStatusReport(report));
      }
      const anyRunning = report.services.some((s) => s.running);
      process.exit(anyRunning ? 0 : 1);
      break;
    }

    case "update": {
      const result = await runUpdate({ check: checkOnly });
      if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2));
      }
      process.exit(result.success ? 0 : 1);
      break;
    }

    case "open": {
      const target =
        args.find((a) => !a.startsWith("-") && a !== "open") ?? "dashboard";
      await openTarget(target);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(2);
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
