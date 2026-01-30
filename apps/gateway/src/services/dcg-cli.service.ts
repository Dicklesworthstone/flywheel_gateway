/**
 * DCG CLI Service - Deep integration with DCG CLI commands.
 *
 * Provides:
 * - Command explanation (dcg explain)
 * - Pre-execution testing (dcg test)
 * - Script scanning (dcg scan)
 * - Pack management (dcg list-packs, dcg pack-info)
 */

import { getCorrelationId, getLogger } from "../middleware/correlation";
import { createToolLogger } from "../utils/cli-logging";
import { logger } from "./logger";

// Create a scoped logger for dcg operations
const dcgLogger = createToolLogger("dcg");

// ============================================================================
// Types
// ============================================================================

export type DCGContextClassification = "executed" | "data" | "ambiguous";

export interface DCGMatchedRule {
  pack: string;
  ruleId: string;
  pattern: string;
  severity: string;
  reason: string;
}

export interface DCGExplainResult {
  command: string;
  wouldBlock: boolean;
  matchedRules: DCGMatchedRule[];
  contextClassification: DCGContextClassification;
  safeAlternatives?: string[];
  documentation?: string;
}

export interface DCGTestResult {
  command: string;
  blocked: boolean;
  matchedRule?: {
    pack: string;
    ruleId: string;
    reason: string;
    severity: string;
  };
  allowlisted: boolean;
  allowlistReason?: string;
}

export interface DCGScanFinding {
  line: number;
  column: number;
  command: string;
  ruleId: string;
  severity: string;
  reason: string;
  suggestion?: string;
}

export interface DCGScanResult {
  file: string;
  lineCount: number;
  findings: DCGScanFinding[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
}

export interface DCGPackRule {
  id: string;
  pattern: string;
  severity: string;
  description: string;
}

export interface DCGPackInfo {
  id: string;
  name: string;
  description: string;
  ruleCount: number;
  enabled: boolean;
  rules: DCGPackRule[];
}

// ============================================================================
// Error Classes
// ============================================================================

export class DCGNotAvailableError extends Error {
  constructor() {
    super("DCG CLI is not available");
    this.name = "DCGNotAvailableError";
  }
}

export class DCGCommandError extends Error {
  public exitCode: number;
  public stderr: string;

  constructor(command: string, exitCode: number, stderr: string) {
    super(
      `DCG command '${command}' failed with exit code ${exitCode}: ${stderr}`,
    );
    this.name = "DCGCommandError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export class DCGPackNotFoundError extends Error {
  public packId: string;

  constructor(packId: string) {
    super(`Pack not found: ${packId}`);
    this.name = "DCGPackNotFoundError";
    this.packId = packId;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a random ID for temp files.
 */
function generateTempId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = new Uint8Array(6);
  crypto.getRandomValues(randomBytes);
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(randomBytes[i]! % chars.length);
  }
  return result;
}

/**
 * Safely parse JSON output from DCG CLI.
 */
function parseJSONOutput<T>(output: string, fallback: T): T {
  try {
    return JSON.parse(output) as T;
  } catch {
    logger.warn(
      { output: output.slice(0, 200) },
      "Failed to parse DCG JSON output",
    );
    return fallback;
  }
}

// ============================================================================
// CLI Commands
// ============================================================================

/**
 * Explain a command - what it does and why it might be blocked.
 */
export async function explainCommand(
  command: string,
): Promise<DCGExplainResult> {
  const log = getLogger();
  const startTime = performance.now();
  const args = ["explain", "--json", command];

  try {
    const proc = Bun.spawn(["dcg", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    const latencyMs = Math.round(performance.now() - startTime);

    // Non-zero exit is OK for explain - it might just mean the command would be blocked
    // Only error if stderr has content and no stdout
    if (!stdout && stderr) {
      throw new DCGCommandError("explain", exitCode ?? -1, stderr);
    }

    const result = parseJSONOutput<DCGExplainResult>(stdout, {
      command,
      wouldBlock: false,
      matchedRules: [],
      contextClassification: "ambiguous",
    });

    dcgLogger.result("dcg explain", latencyMs, "dcg explain completed", {
      command: command.substring(0, 50),
      wouldBlock: result.wouldBlock,
      matchedRuleCount: result.matchedRules.length,
    });

    return result;
  } catch (error) {
    if (error instanceof DCGCommandError) {
      throw error;
    }
    // DCG not available - return a safe default
    log.warn({ error }, "DCG explain failed, returning default");
    return {
      command,
      wouldBlock: false,
      matchedRules: [],
      contextClassification: "ambiguous",
    };
  }
}

/**
 * Test if a command would be blocked.
 */
export async function testCommand(command: string): Promise<DCGTestResult> {
  const log = getLogger();
  const startTime = performance.now();
  const args = ["test", "--json", command];

  try {
    const proc = Bun.spawn(["dcg", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    const latencyMs = Math.round(performance.now() - startTime);

    // Exit code 0 = not blocked, non-zero = would be blocked
    const result = parseJSONOutput<DCGTestResult>(stdout, {
      command,
      blocked: exitCode !== 0,
      allowlisted: false,
    });

    dcgLogger.result("dcg test", latencyMs, "dcg test completed", {
      command: command.substring(0, 50),
      blocked: result.blocked,
      matchedRule: result.matchedRule?.ruleId,
    });

    return result;
  } catch (error) {
    // DCG not available - return safe default (not blocked)
    log.warn({ error }, "DCG test failed, allowing command");
    return {
      command,
      blocked: false,
      allowlisted: false,
    };
  }
}

/**
 * Scan a file for potentially dangerous commands.
 */
export async function scanFile(filePath: string): Promise<DCGScanResult> {
  const log = getLogger();
  const startTime = performance.now();
  const args = ["scan", "--json", filePath];

  try {
    const proc = Bun.spawn(["dcg", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    const latencyMs = Math.round(performance.now() - startTime);

    // Non-zero exit with no stdout is an error
    if (exitCode !== 0 && !stdout) {
      throw new DCGCommandError("scan", exitCode ?? -1, stderr);
    }

    const result = parseJSONOutput<DCGScanResult>(stdout, {
      file: filePath,
      lineCount: 0,
      findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    });

    dcgLogger.result("dcg scan", latencyMs, "dcg scan completed", {
      filePath,
      findingCount: result.findings.length,
      summary: result.summary,
    });

    return result;
  } catch (error) {
    if (error instanceof DCGCommandError) {
      throw error;
    }
    // DCG not available - return empty result
    log.warn({ error, filePath }, "DCG scan failed, returning empty result");
    return {
      file: filePath,
      lineCount: 0,
      findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    };
  }
}

/**
 * Scan inline content for potentially dangerous commands.
 */
export async function scanContent(
  content: string,
  filename?: string,
): Promise<DCGScanResult> {
  const correlationId = getCorrelationId();
  const log = getLogger();

  // Write content to temp file
  const tempPath = `/tmp/dcg-scan-${Date.now()}-${generateTempId()}`;

  try {
    await Bun.write(tempPath, content);
    const result = await scanFile(tempPath);
    result.file = filename || "<inline>";
    return result;
  } finally {
    // Cleanup temp file
    try {
      const file = Bun.file(tempPath);
      if (await file.exists()) {
        await Bun.write(tempPath, ""); // Clear content
        // Note: Bun doesn't have native unlink, using fs
        const { unlink } = await import("node:fs/promises");
        await unlink(tempPath).catch(() => {
          log.debug({ correlationId, tempPath }, "Failed to cleanup temp file");
        });
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * List all available DCG packs.
 */
export async function listPacks(): Promise<DCGPackInfo[]> {
  const log = getLogger();
  const startTime = performance.now();
  const args = ["list-packs", "--json"];

  try {
    const proc = Bun.spawn(["dcg", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    const latencyMs = Math.round(performance.now() - startTime);

    if (exitCode !== 0) {
      throw new DCGCommandError("list-packs", exitCode ?? -1, stderr);
    }

    const packs = parseJSONOutput<DCGPackInfo[]>(stdout, []);

    dcgLogger.result("dcg list-packs", latencyMs, "dcg list-packs completed", {
      packCount: packs.length,
    });

    return packs;
  } catch (error) {
    if (error instanceof DCGCommandError) {
      throw error;
    }
    // DCG not available - return empty list
    log.warn({ error }, "DCG list-packs failed, returning empty list");
    return [];
  }
}

/**
 * Get detailed information about a specific pack.
 */
export async function getPackInfo(packId: string): Promise<DCGPackInfo> {
  const log = getLogger();
  const startTime = performance.now();
  const args = ["pack-info", "--json", packId];

  try {
    const proc = Bun.spawn(["dcg", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    const latencyMs = Math.round(performance.now() - startTime);

    if (exitCode !== 0) {
      // Check if pack not found
      if (stderr.toLowerCase().includes("not found") || exitCode === 1) {
        throw new DCGPackNotFoundError(packId);
      }
      throw new DCGCommandError("pack-info", exitCode ?? -1, stderr);
    }

    const pack = parseJSONOutput<DCGPackInfo | null>(stdout, null);
    if (!pack) {
      throw new DCGPackNotFoundError(packId);
    }

    dcgLogger.result("dcg pack-info", latencyMs, "dcg pack-info completed", {
      packId,
      ruleCount: pack.rules.length,
    });

    return pack;
  } catch (error) {
    if (
      error instanceof DCGPackNotFoundError ||
      error instanceof DCGCommandError
    ) {
      throw error;
    }
    // DCG not available
    log.warn({ error, packId }, "DCG pack-info failed");
    throw new DCGNotAvailableError();
  }
}

// ============================================================================
// Pack Cache
// ============================================================================

let packsCache: DCGPackInfo[] | null = null;
let packsCacheTime = 0;
const PACKS_CACHE_TTL = 60000; // 1 minute

/**
 * Get packs with caching.
 */
export async function getPacksCached(): Promise<DCGPackInfo[]> {
  if (packsCache && Date.now() - packsCacheTime < PACKS_CACHE_TTL) {
    return packsCache;
  }
  packsCache = await listPacks();
  packsCacheTime = Date.now();
  return packsCache;
}

/**
 * Invalidate the packs cache.
 */
export function invalidatePacksCache(): void {
  packsCache = null;
  packsCacheTime = 0;
}

// ============================================================================
// Agent Integration Helpers
// ============================================================================

export interface PreValidationResult {
  allowed: boolean;
  warning?: string;
  matchedRule?: {
    pack: string;
    ruleId: string;
    severity: string;
    reason: string;
  };
}

/**
 * Pre-validate a command before agent execution.
 */
export async function preValidateCommand(
  agentId: string,
  command: string,
): Promise<PreValidationResult> {
  const correlationId = getCorrelationId();
  const log = getLogger();

  log.debug(
    { correlationId, agentId, command: command.substring(0, 50) },
    "Pre-validating command",
  );

  const testResult = await testCommand(command);

  if (testResult.blocked && testResult.matchedRule) {
    log.warn(
      {
        correlationId,
        agentId,
        command: command.substring(0, 50),
        ruleId: testResult.matchedRule.ruleId,
      },
      "Command pre-validation failed",
    );

    return {
      allowed: false,
      warning: `Command blocked by DCG: ${testResult.matchedRule.reason}`,
      matchedRule: testResult.matchedRule,
    };
  }

  return { allowed: true };
}

export interface ScriptValidationResult {
  safe: boolean;
  findings: DCGScanFinding[];
  summary: DCGScanResult["summary"];
}

/**
 * Validate an agent-generated script before execution.
 */
export async function validateAgentScript(
  agentId: string,
  scriptContent: string,
  scriptName: string,
): Promise<ScriptValidationResult> {
  const correlationId = getCorrelationId();
  const log = getLogger();

  log.info({ correlationId, agentId, scriptName }, "Validating agent script");

  const scanResult = await scanContent(scriptContent, scriptName);

  const safe =
    scanResult.summary.critical === 0 && scanResult.summary.high === 0;

  if (!safe) {
    log.warn(
      {
        correlationId,
        agentId,
        scriptName,
        summary: scanResult.summary,
        criticalFindings: scanResult.findings.filter(
          (f) => f.severity === "critical",
        ),
      },
      "Agent script contains dangerous commands",
    );
  }

  return {
    safe,
    findings: scanResult.findings,
    summary: scanResult.summary,
  };
}
