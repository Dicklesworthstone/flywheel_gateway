/**
 * Scanner Routes - REST API for UBS (Ultimate Bug Scanner) integration.
 *
 * Provides endpoints for:
 * - Running scans on files or projects
 * - Retrieving and filtering findings
 * - Dismissing findings
 * - Viewing scan history
 * - Creating beads from findings
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { requireAdminMiddleware } from "../middleware/auth";
import { getLogger } from "../middleware/correlation";
import {
  type FindingFilter,
  getUBSService,
  type ScanOptions,
} from "../services/ubs.service";
import {
  sendCreated,
  sendError,
  sendInternalError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const scanner = new Hono();
scanner.use("*", requireAdminMiddleware());

// ============================================================================
// Validation Schemas
// ============================================================================

const RunScanSchema = z.object({
  paths: z.array(z.string().min(1)).optional(),
  staged: z.boolean().optional(),
  diff: z.boolean().optional(),
  languages: z.array(z.string()).optional(),
  categories: z.array(z.number().int()).optional(),
  skipCategories: z.array(z.number().int()).optional(),
  profile: z.enum(["strict", "loose"]).optional(),
  failOnWarning: z.boolean().optional(),
  exclude: z.array(z.string()).optional(),
  rulesDir: z.string().optional(),
});

const DismissFindingSchema = z.object({
  dismissedBy: z.string().min(1),
  reason: z.string().min(1).max(500),
});

const FindingsQuerySchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]).optional(),
  type: z.enum(["bug", "security", "performance", "style"]).optional(),
  status: z.enum(["open", "dismissed", "fixed"]).optional(),
  file: z.string().optional(),
  category: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const CreateBeadSchema = z.object({
  agentId: z.string().min(1).optional(),
  priority: z.number().int().min(0).max(4).optional(),
});

// ============================================================================
// Error Handler
// ============================================================================

function handleError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof z.ZodError) {
    return sendValidationError(c, transformZodError(error));
  }

  log.error({ error }, "Unexpected error in scanner route");
  return sendInternalError(c);
}

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /scanner/run - Run a scan
 *
 * Starts a new UBS scan with the specified options. Returns the scan result
 * including all findings.
 */
scanner.post("/run", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const validated = RunScanSchema.parse(body);
    const log = getLogger();

    log.info({ options: validated }, "Starting scanner run");

    const service = getUBSService();

    // Build scan options conditionally
    const options: ScanOptions = {};
    if (validated.paths !== undefined) options.paths = validated.paths;
    if (validated.staged !== undefined) options.staged = validated.staged;
    if (validated.diff !== undefined) options.diff = validated.diff;
    if (validated.languages !== undefined)
      options.languages = validated.languages;
    if (validated.categories !== undefined)
      options.categories = validated.categories;
    if (validated.skipCategories !== undefined)
      options.skipCategories = validated.skipCategories;
    if (validated.profile !== undefined) options.profile = validated.profile;
    if (validated.failOnWarning !== undefined)
      options.failOnWarning = validated.failOnWarning;
    if (validated.exclude !== undefined) options.exclude = validated.exclude;
    if (validated.rulesDir !== undefined) options.rulesDir = validated.rulesDir;

    const result = await service.runScan(
      Object.keys(options).length > 0 ? options : undefined,
    );

    return sendCreated(
      c,
      "scan",
      {
        scanId: result.scanId,
        status: result.status,
        exitCode: result.exitCode,
        startedAt: result.startedAt.toISOString(),
        completedAt: result.completedAt.toISOString(),
        durationMs: result.durationMs,
        filesScanned: result.filesScanned,
        findingsCount: result.findings.length,
        summary: result.summary,
        findings: result.findings.map((f) => ({
          id: f.id,
          type: f.type,
          severity: f.severity,
          file: f.file,
          line: f.line,
          column: f.column,
          message: f.message,
          suggestion: f.suggestion,
          category: f.category,
          confidence: f.confidence,
          status: f.status,
          ruleId: f.ruleId,
        })),
        error: result.error,
      },
      `/scanner/scans/${result.scanId}`,
    );
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /scanner/findings - Get findings with optional filters
 */
scanner.get("/findings", async (c) => {
  try {
    const query = FindingsQuerySchema.parse({
      severity: c.req.query("severity"),
      type: c.req.query("type"),
      status: c.req.query("status"),
      file: c.req.query("file"),
      category: c.req.query("category"),
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    });

    const service = getUBSService();

    // Build filter conditionally
    const filter: FindingFilter = {};
    if (query.severity !== undefined) filter.severity = query.severity;
    if (query.type !== undefined) filter.type = query.type;
    if (query.status !== undefined) filter.status = query.status;
    if (query.file !== undefined) filter.file = query.file;
    if (query.category !== undefined) filter.category = query.category;
    if (query.limit !== undefined) filter.limit = query.limit;
    if (query.offset !== undefined) filter.offset = query.offset;

    // Request one extra item to determine if there are more results
    const requestedLimit = query.limit ?? 100;
    const filterWithExtra: FindingFilter = {
      ...filter,
      limit: requestedLimit + 1,
    };

    const findings = service.getFindings(
      Object.keys(filter).length > 0
        ? filterWithExtra
        : { limit: requestedLimit + 1 },
    );

    // Check if we got more than requested (indicates more results exist)
    const hasMore = findings.length > requestedLimit;
    const resultFindings = hasMore
      ? findings.slice(0, requestedLimit)
      : findings;

    return sendList(
      c,
      resultFindings.map((f) => ({
        id: f.id,
        type: f.type,
        severity: f.severity,
        file: f.file,
        line: f.line,
        column: f.column,
        message: f.message,
        suggestion: f.suggestion,
        category: f.category,
        confidence: f.confidence,
        status: f.status,
        ruleId: f.ruleId,
        dismissedBy: f.dismissedBy,
        dismissedAt: f.dismissedAt?.toISOString(),
        dismissReason: f.dismissReason,
      })),
      {
        hasMore,
      },
    );
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /scanner/findings/:id - Get a specific finding
 */
scanner.get("/findings/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const service = getUBSService();
    const finding = service.getFinding(id);

    if (!finding) {
      return sendNotFound(c, "finding", id);
    }

    return sendResource(c, "finding", {
      id: finding.id,
      type: finding.type,
      severity: finding.severity,
      file: finding.file,
      line: finding.line,
      column: finding.column,
      message: finding.message,
      suggestion: finding.suggestion,
      category: finding.category,
      confidence: finding.confidence,
      status: finding.status,
      ruleId: finding.ruleId,
      dismissedBy: finding.dismissedBy,
      dismissedAt: finding.dismissedAt?.toISOString(),
      dismissReason: finding.dismissReason,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /scanner/findings/:id/dismiss - Dismiss a finding
 */
scanner.post("/findings/:id/dismiss", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const validated = DismissFindingSchema.parse(body);

    const service = getUBSService();
    const success = service.dismissFinding(
      id,
      validated.dismissedBy,
      validated.reason,
    );

    if (!success) {
      return sendNotFound(c, "finding", id);
    }

    const finding = service.getFinding(id);
    if (!finding) {
      // Should not happen since dismissFinding succeeded, but handle gracefully
      return sendNotFound(c, "finding", id);
    }

    return sendResource(c, "finding", {
      id: finding.id,
      status: finding.status,
      dismissedBy: finding.dismissedBy,
      dismissedAt: finding.dismissedAt?.toISOString(),
      dismissReason: finding.dismissReason,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /scanner/findings/:id/create-bead - Create a bead from a finding
 *
 * Creates a new bead (issue) in the beads system from the finding.
 */
scanner.post("/findings/:id/create-bead", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const validated = CreateBeadSchema.parse(body);

    const service = getUBSService();
    const finding = service.getFinding(id);

    if (!finding) {
      return sendNotFound(c, "finding", id);
    }

    // Map severity to priority
    const priorityMap = { critical: 0, high: 1, medium: 2, low: 3 };
    const priority = validated.priority ?? priorityMap[finding.severity];

    // Create bead using br CLI
    const typeMap = {
      bug: "bug",
      security: "bug",
      performance: "task",
      style: "task",
    };
    const beadType = typeMap[finding.type];

    const title = `[UBS] ${finding.category}: ${finding.message.slice(0, 80)}`;
    const description = [
      `## UBS Finding`,
      ``,
      `**File:** \`${finding.file}:${finding.line}:${finding.column}\``,
      `**Category:** ${finding.category}`,
      `**Severity:** ${finding.severity}`,
      `**Confidence:** ${(finding.confidence * 100).toFixed(0)}%`,
      ``,
      `### Message`,
      finding.message,
      finding.suggestion ? `\n### Suggestion\n${finding.suggestion}` : "",
      ``,
      `---`,
      `*Auto-generated from UBS finding \`${finding.id}\`*`,
    ].join("\n");

    const args = [
      "br",
      "create",
      title,
      "-t",
      beadType,
      "-p",
      String(priority),
      "-d",
      description,
      "--json",
    ];

    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    if (proc.exitCode !== 0) {
      const log = getLogger();
      log.error(
        { stderr, exitCode: proc.exitCode },
        "Failed to create bead from finding",
      );
      return sendError(
        c,
        "BEAD_CREATION_FAILED",
        stderr || "Failed to create bead",
        500,
      );
    }

    // Parse bead ID from output
    let beadId: string | undefined;
    try {
      const result = JSON.parse(stdout);
      beadId = result.id || result.issue_id;
    } catch {
      // Try to extract from text output
      const match = stdout.match(/Created issue: (flywheel_\w+-\w+)/);
      beadId = match?.[1];
    }

    return sendCreated(
      c,
      "bead",
      {
        beadId,
        findingId: finding.id,
        title,
        type: beadType,
        priority,
      },
      beadId ? `/beads/${beadId}` : "/beads",
    );
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /scanner/history - Get scan history
 */
scanner.get("/history", async (c) => {
  try {
    const limitParam = c.req.query("limit");
    const parsedLimit = limitParam ? parseInt(limitParam, 10) : 50;
    const limit = Number.isNaN(parsedLimit) ? 50 : Math.min(parsedLimit, 100);

    const service = getUBSService();
    const history = service.getScanHistory(limit);

    return sendList(
      c,
      history.map((entry) => ({
        scanId: entry.scanId,
        startedAt: entry.startedAt.toISOString(),
        completedAt: entry.completedAt.toISOString(),
        durationMs: entry.durationMs,
        exitCode: entry.exitCode,
        filesScanned: entry.filesScanned,
        totalFindings: entry.totalFindings,
        criticalFindings: entry.criticalFindings,
      })),
    );
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /scanner/scans/:id - Get a specific scan result
 */
scanner.get("/scans/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const service = getUBSService();
    const scan = service.getScan(id);

    if (!scan) {
      return sendNotFound(c, "scan", id);
    }

    return sendResource(c, "scan", {
      scanId: scan.scanId,
      status: scan.status,
      exitCode: scan.exitCode,
      startedAt: scan.startedAt.toISOString(),
      completedAt: scan.completedAt.toISOString(),
      durationMs: scan.durationMs,
      filesScanned: scan.filesScanned,
      findingsCount: scan.findings.length,
      summary: scan.summary,
      findings: scan.findings.map((f) => ({
        id: f.id,
        type: f.type,
        severity: f.severity,
        file: f.file,
        line: f.line,
        column: f.column,
        message: f.message,
        suggestion: f.suggestion,
        category: f.category,
        status: f.status,
      })),
      error: scan.error,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /scanner/stats - Get scanner statistics
 */
scanner.get("/stats", async (c) => {
  try {
    const service = getUBSService();
    const stats = service.getStats();
    return sendResource(c, "scanner_stats", stats);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /scanner/health - Check scanner health
 */
scanner.get("/health", async (c) => {
  try {
    const service = getUBSService();
    const health = await service.checkHealth();
    return sendResource(c, "scanner_health", health);
  } catch (error) {
    return handleError(error, c);
  }
});

export { scanner };
