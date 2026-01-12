/**
 * UBS (Ultimate Bug Scanner) Service
 *
 * Wraps the UBS CLI for static analysis scanning. Provides:
 * - On-demand scans with configurable options
 * - Finding retrieval and filtering
 * - Finding dismissal tracking
 * - Scan history management
 * - Bead creation from findings
 */

import { getLogger } from "../middleware/correlation";

// ============================================================================
// Types
// ============================================================================

export type FindingType = "bug" | "security" | "performance" | "style";
export type FindingSeverity = "critical" | "high" | "medium" | "low";
export type FindingStatus = "open" | "dismissed" | "fixed";

export interface Finding {
  id: string;
  type: FindingType;
  severity: FindingSeverity;
  file: string;
  line: number;
  column: number;
  message: string;
  suggestion?: string;
  category: string;
  confidence: number;
  status: FindingStatus;
  ruleId?: string;
  dismissedBy?: string;
  dismissedAt?: Date;
  dismissReason?: string;
}

export interface ScanOptions {
  /** Files or directories to scan */
  paths?: string[];
  /** Only scan staged files */
  staged?: boolean;
  /** Only scan changed files (working tree vs HEAD) */
  diff?: boolean;
  /** Language filter (e.g., ["js", "python"]) */
  languages?: string[];
  /** Category filter */
  categories?: number[];
  /** Categories to skip */
  skipCategories?: number[];
  /** Profile: "strict" or "loose" */
  profile?: "strict" | "loose";
  /** Fail on warnings (for CI mode) */
  failOnWarning?: boolean;
  /** Paths to exclude */
  exclude?: string[];
  /** Custom rules directory */
  rulesDir?: string;
}

export interface ScanResult {
  scanId: string;
  status: "success" | "failed" | "error";
  exitCode: number;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  filesScanned: number;
  findings: Finding[];
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    byCategory: Record<string, number>;
  };
  /** Paths that were scanned */
  paths: string[];
  error?: string;
}

export interface FindingFilter {
  severity?: FindingSeverity;
  type?: FindingType;
  status?: FindingStatus;
  file?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

export interface ScanHistoryEntry {
  scanId: string;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  exitCode: number;
  filesScanned: number;
  totalFindings: number;
  criticalFindings: number;
  paths: string[];
}

// ============================================================================
// Internal Storage (in-memory for now, could be persisted to SQLite)
// ============================================================================

interface ScanStore {
  scans: Map<string, ScanResult>;
  findings: Map<string, Finding>;
  dismissals: Map<string, { by: string; at: Date; reason: string }>;
}

const store: ScanStore = {
  scans: new Map(),
  findings: new Map(),
  dismissals: new Map(),
};

// ============================================================================
// UBS CLI Interface
// ============================================================================

interface UBSJsonOutput {
  findings: Array<{
    file: string;
    line: number;
    column?: number;
    message: string;
    category: string;
    severity: string;
    suggestion?: string;
    rule_id?: string;
    confidence?: number;
  }>;
  summary: {
    files_scanned: number;
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    by_category?: Record<string, number>;
  };
  exit_code: number;
}

function mapSeverity(severity: string): FindingSeverity {
  const lower = severity.toLowerCase();
  if (lower === "critical" || lower === "error") return "critical";
  if (lower === "high" || lower === "warning") return "high";
  if (lower === "medium") return "medium";
  return "low";
}

function mapType(category: string): FindingType {
  const lower = category.toLowerCase();
  if (lower.includes("security") || lower.includes("xss") || lower.includes("injection")) {
    return "security";
  }
  if (lower.includes("performance") || lower.includes("memory")) {
    return "performance";
  }
  if (lower.includes("style") || lower.includes("format")) {
    return "style";
  }
  return "bug";
}

function generateId(prefix: string): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomPart = Array.from(
    { length: 12 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
  return `${prefix}_${randomPart}`;
}

// ============================================================================
// Service Implementation
// ============================================================================

export interface UBSService {
  /** Run a scan with the given options */
  runScan(options?: ScanOptions): Promise<ScanResult>;

  /** Get findings with optional filtering */
  getFindings(filter?: FindingFilter): Finding[];

  /** Get a specific finding by ID */
  getFinding(id: string): Finding | undefined;

  /** Dismiss a finding */
  dismissFinding(id: string, dismissedBy: string, reason: string): boolean;

  /** Get scan history */
  getScanHistory(limit?: number): ScanHistoryEntry[];

  /** Get a specific scan result */
  getScan(scanId: string): ScanResult | undefined;

  /** Get scanner statistics */
  getStats(): {
    totalScans: number;
    totalFindings: number;
    openFindings: number;
    dismissedFindings: number;
  };

  /** Check if UBS is available */
  checkHealth(): Promise<{ available: boolean; version?: string; error?: string }>;
}

export function createUBSService(projectRoot?: string): UBSService {
  const cwd = projectRoot || process.cwd();

  return {
    async runScan(options?: ScanOptions): Promise<ScanResult> {
      const log = getLogger();
      const scanId = generateId("scan");
      const startedAt = new Date();

      // Build command arguments
      const args = ["ubs"];

      // Track what paths were scanned
      let scanPaths: string[];

      // Add paths or default to current directory
      if (options?.paths && options.paths.length > 0) {
        args.push(...options.paths);
        scanPaths = options.paths;
      } else if (options?.staged) {
        args.push("--staged");
        scanPaths = ["--staged"];
      } else if (options?.diff) {
        args.push("--diff");
        scanPaths = ["--diff"];
      } else {
        args.push(".");
        scanPaths = ["."];
      }

      // Always use JSON output for parsing
      args.push("--format=json");

      // Add optional flags
      if (options?.failOnWarning) {
        args.push("--fail-on-warning");
      }
      if (options?.profile) {
        args.push(`--profile=${options.profile}`);
      }
      if (options?.languages && options.languages.length > 0) {
        args.push(`--only=${options.languages.join(",")}`);
      }
      if (options?.skipCategories && options.skipCategories.length > 0) {
        args.push(`--skip=${options.skipCategories.join(",")}`);
      }
      if (options?.exclude && options.exclude.length > 0) {
        args.push(`--exclude=${options.exclude.join(",")}`);
      }
      if (options?.rulesDir) {
        args.push(`--rules=${options.rulesDir}`);
      }

      log.info({ scanId, args: args.slice(1), cwd }, "Starting UBS scan");

      try {
        const proc = Bun.spawn(args, {
          cwd,
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, NO_COLOR: "1" },
        });

        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        await proc.exited;

        const completedAt = new Date();
        const durationMs = completedAt.getTime() - startedAt.getTime();
        const exitCode = proc.exitCode ?? -1;

        // Parse JSON output
        let ubsOutput: UBSJsonOutput;
        try {
          ubsOutput = JSON.parse(stdout);
        } catch {
          // If JSON parsing fails, UBS might have errored
          log.error({ scanId, stderr, stdout }, "Failed to parse UBS output");
          const errorResult: ScanResult = {
            scanId,
            status: "error",
            exitCode,
            startedAt,
            completedAt,
            durationMs,
            filesScanned: 0,
            findings: [],
            summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, byCategory: {} },
            paths: scanPaths,
            error: stderr || "Failed to parse UBS output",
          };
          store.scans.set(scanId, errorResult);
          return errorResult;
        }

        // Convert findings
        const findings: Finding[] = ubsOutput.findings.map((f) => {
          const finding: Finding = {
            id: generateId("fnd"),
            type: mapType(f.category),
            severity: mapSeverity(f.severity),
            file: f.file,
            line: f.line,
            column: f.column ?? 1,
            message: f.message,
            category: f.category,
            confidence: f.confidence ?? 1.0,
            status: "open",
          };
          if (f.suggestion) finding.suggestion = f.suggestion;
          if (f.rule_id) finding.ruleId = f.rule_id;

          // Check if previously dismissed
          const dismissal = store.dismissals.get(`${f.file}:${f.line}:${f.message}`);
          if (dismissal) {
            finding.status = "dismissed";
            finding.dismissedBy = dismissal.by;
            finding.dismissedAt = dismissal.at;
            finding.dismissReason = dismissal.reason;
          }

          // Store finding
          store.findings.set(finding.id, finding);
          return finding;
        });

        const result: ScanResult = {
          scanId,
          status: exitCode === 0 ? "success" : exitCode === 2 ? "error" : "failed",
          exitCode,
          startedAt,
          completedAt,
          durationMs,
          filesScanned: ubsOutput.summary.files_scanned,
          findings,
          summary: {
            total: ubsOutput.summary.total,
            critical: ubsOutput.summary.critical,
            high: ubsOutput.summary.high,
            medium: ubsOutput.summary.medium,
            low: ubsOutput.summary.low,
            byCategory: ubsOutput.summary.by_category ?? {},
          },
          paths: scanPaths,
        };

        store.scans.set(scanId, result);

        log.info(
          {
            scanId,
            durationMs,
            filesScanned: result.filesScanned,
            findings: result.summary.total,
            critical: result.summary.critical,
            high: result.summary.high,
          },
          "UBS scan completed"
        );

        return result;
      } catch (error) {
        const completedAt = new Date();
        const errorResult: ScanResult = {
          scanId,
          status: "error",
          exitCode: -1,
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          filesScanned: 0,
          findings: [],
          summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, byCategory: {} },
          paths: scanPaths,
          error: error instanceof Error ? error.message : String(error),
        };
        store.scans.set(scanId, errorResult);
        log.error({ scanId, error }, "UBS scan failed");
        return errorResult;
      }
    },

    getFindings(filter?: FindingFilter): Finding[] {
      let findings = Array.from(store.findings.values());

      if (filter?.severity) {
        findings = findings.filter((f) => f.severity === filter.severity);
      }
      if (filter?.type) {
        findings = findings.filter((f) => f.type === filter.type);
      }
      if (filter?.status) {
        findings = findings.filter((f) => f.status === filter.status);
      }
      if (filter?.file) {
        findings = findings.filter((f) => f.file.includes(filter.file!));
      }
      if (filter?.category) {
        findings = findings.filter((f) => f.category === filter.category);
      }

      // Sort by severity (critical first) then by file
      findings.sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
        if (sevDiff !== 0) return sevDiff;
        return a.file.localeCompare(b.file);
      });

      // Apply pagination
      const offset = filter?.offset ?? 0;
      const limit = filter?.limit ?? 100;
      return findings.slice(offset, offset + limit);
    },

    getFinding(id: string): Finding | undefined {
      return store.findings.get(id);
    },

    dismissFinding(id: string, dismissedBy: string, reason: string): boolean {
      const finding = store.findings.get(id);
      if (!finding) return false;

      finding.status = "dismissed";
      finding.dismissedBy = dismissedBy;
      finding.dismissedAt = new Date();
      finding.dismissReason = reason;

      // Track dismissal by location for future scans
      const key = `${finding.file}:${finding.line}:${finding.message}`;
      store.dismissals.set(key, {
        by: dismissedBy,
        at: finding.dismissedAt,
        reason,
      });

      const log = getLogger();
      log.info({ findingId: id, dismissedBy, reason }, "Finding dismissed");

      return true;
    },

    getScanHistory(limit = 50): ScanHistoryEntry[] {
      const scans = Array.from(store.scans.values())
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
        .slice(0, limit);

      return scans.map((scan) => ({
        scanId: scan.scanId,
        startedAt: scan.startedAt,
        completedAt: scan.completedAt,
        durationMs: scan.durationMs,
        exitCode: scan.exitCode,
        filesScanned: scan.filesScanned,
        totalFindings: scan.summary.total,
        criticalFindings: scan.summary.critical,
        paths: scan.paths,
      }));
    },

    getScan(scanId: string): ScanResult | undefined {
      return store.scans.get(scanId);
    },

    getStats(): {
      totalScans: number;
      totalFindings: number;
      openFindings: number;
      dismissedFindings: number;
    } {
      const findings = Array.from(store.findings.values());
      return {
        totalScans: store.scans.size,
        totalFindings: findings.length,
        openFindings: findings.filter((f) => f.status === "open").length,
        dismissedFindings: findings.filter((f) => f.status === "dismissed").length,
      };
    },

    async checkHealth(): Promise<{ available: boolean; version?: string; error?: string }> {
      try {
        const proc = Bun.spawn(["ubs", "--version"], {
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, NO_COLOR: "1" },
        });

        const stdout = await new Response(proc.stdout).text();
        await proc.exited;

        if (proc.exitCode === 0) {
          return { available: true, version: stdout.trim() };
        }
        return { available: false, error: "UBS command returned non-zero exit code" };
      } catch (error) {
        return {
          available: false,
          error: error instanceof Error ? error.message : "UBS not found",
        };
      }
    },
  };
}

// ============================================================================
// Singleton instance
// ============================================================================

let ubsServiceInstance: UBSService | null = null;

export function getUBSService(): UBSService {
  if (!ubsServiceInstance) {
    ubsServiceInstance = createUBSService();
  }
  return ubsServiceInstance;
}

export function setUBSService(service: UBSService): void {
  ubsServiceInstance = service;
}

// ============================================================================
// Test helpers
// ============================================================================

export function _resetUBSStore(): void {
  store.scans.clear();
  store.findings.clear();
  store.dismissals.clear();
}
