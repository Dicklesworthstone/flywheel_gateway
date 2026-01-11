/**
 * Utilities Service - Manages developer utilities (giil, csctf).
 *
 * Provides detection, installation guidance, and execution of
 * optional developer utilities that enhance agent workflows.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { getCorrelationId } from "../middleware/correlation";
import { logger } from "./logger";

// ============================================================================
// Types
// ============================================================================

export interface DeveloperUtility {
  name: string;
  description: string;
  version: string;
  installCommand: string;
  checkCommand: string;
  installed: boolean;
  installedVersion?: string;
  lastCheckedAt?: Date;
}

export interface UtilityStatus {
  name: string;
  installed: boolean;
  version?: string;
  installCommand: string;
  description: string;
  lastCheckedAt?: string;
}

export interface DoctorResult {
  healthy: boolean;
  utilities: Array<{
    name: string;
    status: "installed" | "missing" | "outdated" | "error";
    version?: string;
    expectedVersion: string;
    message: string;
  }>;
  timestamp: string;
}

export interface GiilRequest {
  url: string;
  outputDir?: string;
  format?: "file" | "json" | "base64";
}

export interface GiilResponse {
  success: boolean;
  path?: string;
  width?: number;
  height?: number;
  captureMethod?: "download" | "cdn" | "element" | "viewport";
  error?: string;
}

export interface CsctfRequest {
  url: string;
  outputDir?: string;
  formats?: ("md" | "html")[];
  publishToGhPages?: boolean;
}

export interface CsctfResponse {
  success: boolean;
  markdownPath?: string;
  htmlPath?: string;
  title?: string;
  messageCount?: number;
  error?: string;
}

// ============================================================================
// Known Utilities Registry
// ============================================================================

const KNOWN_UTILITIES: Array<
  Omit<DeveloperUtility, "installed" | "installedVersion" | "lastCheckedAt">
> = [
  {
    name: "giil",
    description: "Download cloud photos for AI visual analysis",
    version: "3.1.0",
    installCommand:
      "curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/giil/main/install.sh | bash",
    checkCommand: "giil --version",
  },
  {
    name: "csctf",
    description: "Convert AI chat share links to Markdown/HTML",
    version: "0.4.5",
    installCommand:
      "curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/chat_shared_conversation_to_file/main/install.sh | bash",
    checkCommand: "csctf --version",
  },
];

// Cache for utility status (invalidated after 5 minutes)
const statusCache = new Map<
  string,
  { status: DeveloperUtility; checkedAt: Date }
>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Compare two semver version strings.
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
function compareSemver(a: string, b: string): number {
  const partsA = a.split(".").map((n) => parseInt(n, 10) || 0);
  const partsB = b.split(".").map((n) => parseInt(n, 10) || 0);
  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }
  return 0;
}

// Allowed base directories for output (security)
const homeDir = process.env["HOME"];
const ALLOWED_OUTPUT_BASES = [
  "/tmp",
  homeDir ? path.join(homeDir, "Downloads") : "/tmp",
  homeDir ? path.join(homeDir, ".flywheel") : "/tmp",
];

// ============================================================================
// Utility Detection
// ============================================================================

/**
 * Execute a command and return stdout/stderr with timeout.
 */
async function executeCommand(
  command: string,
  args: string[],
  options: {
    timeout?: number;
    cwd?: string;
    maxOutputSize?: number;
  } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { timeout = 30000, cwd, maxOutputSize = 1024 * 1024 } = options;

  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      shell: true,
      timeout,
      env: { ...process.env, NO_COLOR: "1" },
    });

    let stdout = "";
    let stderr = "";
    let outputTruncated = false;

    proc.stdout?.on("data", (data: Buffer) => {
      if (stdout.length < maxOutputSize) {
        stdout += data.toString();
        if (stdout.length > maxOutputSize) {
          stdout = stdout.slice(0, maxOutputSize);
          outputTruncated = true;
        }
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      if (stderr.length < maxOutputSize) {
        stderr += data.toString();
        if (stderr.length > maxOutputSize) {
          stderr = stderr.slice(0, maxOutputSize);
          outputTruncated = true;
        }
      }
    });

    proc.on("error", (err) => {
      resolve({
        stdout: "",
        stderr: err.message,
        exitCode: -1,
      });
    });

    proc.on("close", (code) => {
      if (outputTruncated) {
        stderr += "\n[Output truncated]";
      }
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? -1,
      });
    });
  });
}

/**
 * Check if a utility is installed and get its version.
 */
async function checkUtility(
  utility: Omit<
    DeveloperUtility,
    "installed" | "installedVersion" | "lastCheckedAt"
  >,
): Promise<DeveloperUtility> {
  const cached = statusCache.get(utility.name);
  if (cached && Date.now() - cached.checkedAt.getTime() < CACHE_TTL_MS) {
    return cached.status;
  }

  const result = await executeCommand(utility.checkCommand, [], {
    timeout: 5000,
  });
  const now = new Date();

  let installed = false;
  let installedVersion: string | undefined;

  if (result.exitCode === 0) {
    installed = true;
    // Try to extract version from output
    const versionMatch = result.stdout.match(/(\d+\.\d+\.\d+)/);
    installedVersion = versionMatch?.[1];
  }

  // Build status conditionally (for exactOptionalPropertyTypes)
  const status: DeveloperUtility = {
    ...utility,
    installed,
    lastCheckedAt: now,
  };
  if (installedVersion !== undefined) status.installedVersion = installedVersion;

  statusCache.set(utility.name, { status, checkedAt: now });

  return status;
}

/**
 * Get status of all known utilities.
 */
export async function listUtilities(): Promise<UtilityStatus[]> {
  const results = await Promise.all(KNOWN_UTILITIES.map(checkUtility));

  return results.map((u) => {
    // Build status conditionally (for exactOptionalPropertyTypes)
    const status: UtilityStatus = {
      name: u.name,
      installed: u.installed,
      installCommand: u.installCommand,
      description: u.description,
    };
    if (u.installedVersion !== undefined) status.version = u.installedVersion;
    if (u.lastCheckedAt) status.lastCheckedAt = u.lastCheckedAt.toISOString();
    return status;
  });
}

/**
 * Get status of a specific utility.
 */
export async function getUtilityStatus(
  name: string,
): Promise<UtilityStatus | null> {
  const utility = KNOWN_UTILITIES.find((u) => u.name === name);
  if (!utility) {
    return null;
  }

  const checked = await checkUtility(utility);

  // Build status conditionally (for exactOptionalPropertyTypes)
  const status: UtilityStatus = {
    name: checked.name,
    installed: checked.installed,
    installCommand: checked.installCommand,
    description: checked.description,
  };
  if (checked.installedVersion !== undefined) status.version = checked.installedVersion;
  if (checked.lastCheckedAt) status.lastCheckedAt = checked.lastCheckedAt.toISOString();

  return status;
}

/**
 * Run doctor check on all utilities.
 */
export async function runDoctor(): Promise<DoctorResult> {
  const results = await Promise.all(KNOWN_UTILITIES.map(checkUtility));

  const utilities = results.map((u) => {
    let status: "installed" | "missing" | "outdated" | "error";
    let message: string;

    if (!u.installed) {
      status = "missing";
      message = `Not installed. Run: ${u.installCommand}`;
    } else if (
      u.installedVersion &&
      compareSemver(u.installedVersion, u.version) < 0
    ) {
      status = "outdated";
      message = `Version ${u.installedVersion} installed, ${u.version} available`;
    } else {
      status = "installed";
      message = `Version ${u.installedVersion ?? "unknown"} installed`;
    }

    // Build result conditionally (for exactOptionalPropertyTypes)
    const result: {
      name: string;
      status: "installed" | "missing" | "outdated" | "error";
      version?: string;
      expectedVersion: string;
      message: string;
    } = {
      name: u.name,
      status,
      expectedVersion: u.version,
      message,
    };
    if (u.installedVersion !== undefined) result.version = u.installedVersion;
    return result;
  });

  const healthy = utilities.every((u) => u.status === "installed");

  return {
    healthy,
    utilities,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Output Directory Validation
// ============================================================================

/**
 * Validate that an output directory is safe to use.
 */
function validateOutputDir(outputDir: string): {
  valid: boolean;
  error?: string;
  resolvedPath?: string;
} {
  // Resolve to absolute path
  const resolved = path.resolve(outputDir);

  // Check for path traversal
  if (resolved.includes("..")) {
    return { valid: false, error: "Path traversal not allowed" };
  }

  // Check against allowed bases
  const isAllowed = ALLOWED_OUTPUT_BASES.some((base) => {
    // Ensure base doesn't have trailing separator for consistent comparison
    const cleanBase = base.endsWith(path.sep) ? base.slice(0, -1) : base;
    return resolved === cleanBase || resolved.startsWith(cleanBase + path.sep);
  });
  if (!isAllowed) {
    return {
      valid: false,
      error: `Output directory must be within: ${ALLOWED_OUTPUT_BASES.join(", ")}`,
    };
  }

  return { valid: true, resolvedPath: resolved };
}

// ============================================================================
// giil Integration
// ============================================================================

/**
 * Run giil to download an image from a cloud share link.
 */
export async function runGiil(request: GiilRequest): Promise<GiilResponse> {
  const correlationId = getCorrelationId();
  const log = logger.child({ correlationId, utility: "giil" });

  // Check if giil is installed
  const status = await getUtilityStatus("giil");
  if (!status?.installed) {
    return {
      success: false,
      error: `giil is not installed. Run: ${KNOWN_UTILITIES.find((u) => u.name === "giil")?.installCommand}`,
    };
  }

  // Validate output directory
  const outputDir = request.outputDir ?? "/tmp/flywheel-giil";
  const validation = validateOutputDir(outputDir);
  if (!validation.valid) {
    const errResponse: GiilResponse = { success: false };
    if (validation.error) errResponse.error = validation.error;
    return errResponse;
  }

  // Build command arguments
  const args = [request.url, "-o", validation.resolvedPath!];

  if (request.format === "json") {
    args.push("--json");
  } else if (request.format === "base64") {
    args.push("--base64");
  }

  // Log sanitized request (hash URL for privacy)
  const urlHash = Buffer.from(request.url).toString("base64").slice(0, 8);
  log.info({ urlHash, outputDir: validation.resolvedPath }, "Running giil");

  // Execute giil
  const result = await executeCommand("giil", args, { timeout: 60000 });

  if (result.exitCode !== 0) {
    log.warn(
      { exitCode: result.exitCode, stderr: result.stderr.slice(0, 200) },
      "giil failed",
    );
    return {
      success: false,
      error: result.stderr || `giil exited with code ${result.exitCode}`,
    };
  }

  // Try to parse JSON output if requested
  if (request.format === "json") {
    try {
      const parsed = JSON.parse(result.stdout);
      const jsonResponse: GiilResponse = { success: true };
      if (parsed.path) jsonResponse.path = parsed.path;
      if (typeof parsed.width === "number") jsonResponse.width = parsed.width;
      if (typeof parsed.height === "number") jsonResponse.height = parsed.height;
      if (parsed.captureMethod) jsonResponse.captureMethod = parsed.captureMethod;
      return jsonResponse;
    } catch {
      const fallbackResponse: GiilResponse = { success: true };
      if (validation.resolvedPath) fallbackResponse.path = validation.resolvedPath;
      return fallbackResponse;
    }
  }

  const successResponse: GiilResponse = { success: true };
  if (validation.resolvedPath) successResponse.path = validation.resolvedPath;
  return successResponse;
}

// ============================================================================
// csctf Integration
// ============================================================================

/**
 * Run csctf to convert an AI chat share link to Markdown/HTML.
 */
export async function runCsctf(request: CsctfRequest): Promise<CsctfResponse> {
  const correlationId = getCorrelationId();
  const log = logger.child({ correlationId, utility: "csctf" });

  // Check if csctf is installed
  const status = await getUtilityStatus("csctf");
  if (!status?.installed) {
    return {
      success: false,
      error: `csctf is not installed. Run: ${KNOWN_UTILITIES.find((u) => u.name === "csctf")?.installCommand}`,
    };
  }

  // Validate output directory
  const outputDir = request.outputDir ?? "/tmp/flywheel-csctf";
  const validation = validateOutputDir(outputDir);
  if (!validation.valid) {
    const errResponse: CsctfResponse = { success: false };
    if (validation.error) errResponse.error = validation.error;
    return errResponse;
  }

  // Build command arguments
  const args = [request.url, "-o", validation.resolvedPath!];

  const formats = request.formats ?? ["md"];
  if (formats.includes("md")) {
    args.push("--md");
  }
  if (formats.includes("html")) {
    args.push("--html");
  }

  if (request.publishToGhPages) {
    args.push("--publish");
  }

  // Log sanitized request
  const urlHash = Buffer.from(request.url).toString("base64").slice(0, 8);
  log.info(
    { urlHash, outputDir: validation.resolvedPath, formats },
    "Running csctf",
  );

  // Execute csctf
  const result = await executeCommand("csctf", args, { timeout: 120000 });

  if (result.exitCode !== 0) {
    log.warn(
      { exitCode: result.exitCode, stderr: result.stderr.slice(0, 200) },
      "csctf failed",
    );
    return {
      success: false,
      error: result.stderr || `csctf exited with code ${result.exitCode}`,
    };
  }

  // Try to parse output for paths
  const mdMatch = result.stdout.match(/Markdown: (.+\.md)/);
  const htmlMatch = result.stdout.match(/HTML: (.+\.html)/);
  const titleMatch = result.stdout.match(/Title: (.+)/);
  const countMatch = result.stdout.match(/(\d+) messages?/);

  // Build response conditionally (for exactOptionalPropertyTypes)
  const response: CsctfResponse = { success: true };
  if (mdMatch?.[1]) response.markdownPath = mdMatch[1];
  if (htmlMatch?.[1]) response.htmlPath = htmlMatch[1];
  if (titleMatch?.[1]) response.title = titleMatch[1];
  if (countMatch?.[1]) response.messageCount = parseInt(countMatch[1], 10);

  return response;
}

// ============================================================================
// Installation
// ============================================================================

export interface InstallResult {
  success: boolean;
  utility: string;
  output: string;
  error?: string;
}

/**
 * Attempt to install a utility.
 * Returns the install command output for transparency.
 */
export async function installUtility(name: string): Promise<InstallResult> {
  const correlationId = getCorrelationId();
  const log = logger.child({ correlationId, utility: name });

  const utility = KNOWN_UTILITIES.find((u) => u.name === name);
  if (!utility) {
    return {
      success: false,
      utility: name,
      output: "",
      error: `Unknown utility: ${name}`,
    };
  }

  log.info({ installCommand: utility.installCommand }, "Installing utility");

  // Execute install command with extended timeout
  const result = await executeCommand("bash", ["-c", utility.installCommand], {
    timeout: 300000, // 5 minutes for installation
    maxOutputSize: 100 * 1024, // 100KB output limit
  });

  // Invalidate cache
  statusCache.delete(name);

  if (result.exitCode !== 0) {
    log.error({ exitCode: result.exitCode }, "Installation failed");
    return {
      success: false,
      utility: name,
      output: result.stdout + "\n" + result.stderr,
      error: `Installation failed with exit code ${result.exitCode}`,
    };
  }

  // Verify installation
  const status = await getUtilityStatus(name);
  if (!status?.installed) {
    return {
      success: false,
      utility: name,
      output: result.stdout + "\n" + result.stderr,
      error: "Installation completed but utility not found in PATH",
    };
  }

  log.info({ installedVersion: status.version }, "Installation successful");

  return {
    success: true,
    utility: name,
    output: result.stdout,
  };
}

/**
 * Update a utility to the latest version.
 */
export async function updateUtility(name: string): Promise<InstallResult> {
  // For these utilities, update is the same as install
  return installUtility(name);
}
