/**
 * Memory Routes - REST API endpoints for CM (Cass-Memory) Procedural Memory.
 *
 * Provides endpoints for:
 * - Getting context (rules + history) for tasks
 * - Listing playbook rules
 * - Getting memory stats
 * - Running diagnostics
 * - Recording session outcomes
 */

import { CMClientError } from "@flywheel/flywheel-clients";
import type { GatewayError } from "@flywheel/shared/errors";
import {
  createGatewayError,
  serializeGatewayError,
  toGatewayError,
} from "@flywheel/shared/errors";
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { requireAdminMiddleware } from "../middleware/auth";
import { getLogger } from "../middleware/correlation";
import {
  getCMStatus,
  getPlaybookStats,
  getQuickstart,
  getTaskContext,
  isCMAvailable,
  listPlaybookRules,
  recordOutcome,
  runDiagnostics,
} from "../services/cm.service";
import {
  sendError,
  sendList,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const memory = new Hono();
memory.use("*", requireAdminMiddleware());

// ============================================================================
// Error Handling
// ============================================================================

function respondWithGatewayError(c: Context, error: GatewayError) {
  const timestamp = new Date().toISOString();
  const payload = serializeGatewayError(error);
  return sendError(
    c,
    payload.code,
    payload.message,
    payload.httpStatus as ContentfulStatusCode,
    {
      ...(payload.details && { details: payload.details }),
      timestamp,
    },
  );
}

function handleError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof z.ZodError) {
    return sendValidationError(c, transformZodError(error));
  }

  if (error instanceof CMClientError) {
    let gatewayError: GatewayError;

    const errorOptions: { details?: Record<string, unknown>; cause: Error } = {
      cause: error,
    };
    if (error.details) {
      errorOptions.details = error.details;
    }

    switch (error.kind) {
      case "unavailable":
        gatewayError = createGatewayError(
          "SYSTEM_UNAVAILABLE",
          "CM is not available",
          errorOptions,
        );
        break;
      case "timeout":
        gatewayError = createGatewayError(
          "AGENT_TIMEOUT",
          "CM request timed out",
          errorOptions,
        );
        break;
      case "command_failed":
        gatewayError = createGatewayError(
          "SYSTEM_INTERNAL_ERROR",
          "CM command failed",
          errorOptions,
        );
        break;
      case "parse_error":
      case "validation_error":
        gatewayError = createGatewayError(
          "SYSTEM_INTERNAL_ERROR",
          `CM ${error.kind.replace("_", " ")}`,
          errorOptions,
        );
        break;
      default:
        gatewayError = toGatewayError(error);
    }

    return respondWithGatewayError(c, gatewayError);
  }

  log.error({ error }, "Unexpected error in memory route");
  return respondWithGatewayError(c, toGatewayError(error));
}

// ============================================================================
// Validation Schemas
// ============================================================================

/**
 * Schema for boolean query parameters (string input from URL).
 * Note: z.coerce.boolean() uses Boolean() which treats any non-empty string as true,
 * so "false" would incorrectly become true. This transform handles "true"/"false" strings.
 */
const booleanQueryParam = z
  .string()
  .optional()
  .transform((val) => {
    if (val === "true" || val === "1") return true;
    if (val === "false" || val === "0") return false;
    return undefined;
  });

/**
 * Schema for boolean fields in POST body (accepts both boolean and string).
 * JSON bodies can have native boolean values, so we need to handle both cases.
 */
const booleanBodyParam = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((val) => {
    if (val === undefined) return undefined;
    if (typeof val === "boolean") return val;
    if (val === "true" || val === "1") return true;
    if (val === "false" || val === "0") return false;
    return undefined;
  });

const ContextQuerySchema = z.object({
  task: z.string().min(1, "Task description is required"),
  workspace: z.string().optional(),
  top: z.coerce.number().int().positive().max(50).optional(),
  history: z.coerce.number().int().positive().max(20).optional(),
  days: z.coerce.number().int().positive().max(365).optional(),
  session: z.string().optional(),
  logContext: booleanBodyParam,
});

const PlaybookListQuerySchema = z.object({
  category: z.string().optional(),
  scope: z.string().optional(),
  state: z.enum(["active", "deprecated", "pending"]).optional(),
  kind: z.enum(["rule", "anti-pattern", "procedure"]).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const OutcomeBodySchema = z.object({
  status: z.enum(["success", "failure", "partial"]),
  ruleIds: z.array(z.string().min(1)).min(1),
  session: z.string().optional(),
});

const DoctorQuerySchema = z.object({
  fix: booleanQueryParam,
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /memory/health - CM health status
 *
 * Returns the health status of the CM service.
 */
memory.get("/health", async (c) => {
  try {
    const status = await getCMStatus();
    const httpStatus = status.healthy ? 200 : 503;

    return sendResource(
      c,
      "memory_health",
      {
        available: status.available,
        healthy: status.healthy,
        version: status.version,
        overallStatus: status.overallStatus,
        ...(status.error && { error: status.error }),
        timestamp: new Date().toISOString(),
      },
      httpStatus,
    );
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /memory/available - Quick availability check
 *
 * Fast check to see if CM is available (<50ms).
 */
memory.get("/available", async (c) => {
  try {
    const available = await isCMAvailable();
    return sendResource(c, "memory_available", { available });
  } catch {
    return sendResource(c, "memory_available", { available: false });
  }
});

/**
 * POST /memory/context - Get context for a task
 *
 * Body:
 * - task: Task description (required)
 * - workspace: Filter by workspace
 * - top: Number of rules to include
 * - history: Number of history snippets
 * - days: Lookback days for history
 * - session: Session ID for logging
 * - logContext: Log context usage for feedback
 */
memory.post("/context", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = ContextQuerySchema.safeParse(body);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const { task, ...options } = parsed.data;

    // Build context options, only including defined values
    const contextOptions: Parameters<typeof getTaskContext>[1] = {};
    if (options.workspace !== undefined)
      contextOptions.workspace = options.workspace;
    if (options.top !== undefined) contextOptions.top = options.top;
    if (options.history !== undefined) contextOptions.history = options.history;
    if (options.days !== undefined) contextOptions.days = options.days;
    if (options.session !== undefined) contextOptions.session = options.session;
    if (options.logContext !== undefined)
      contextOptions.logContext = options.logContext;

    const result = await getTaskContext(task, contextOptions);

    return sendResource(c, "memory_context", {
      success: result.success,
      task: result.task,
      relevantBullets: result.relevantBullets,
      antiPatterns: result.antiPatterns,
      historySnippets: result.historySnippets.map((h) => ({
        sourcePath: h.source_path,
        lineNumber: h.line_number,
        agent: h.agent,
        workspace: h.workspace,
        title: h.title,
        snippet: h.snippet,
        score: h.score,
        createdAt: h.created_at,
        origin: h.origin,
      })),
      deprecatedWarnings: result.deprecatedWarnings,
      suggestedCassQueries: result.suggestedCassQueries,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /memory/quickstart - Get CM quickstart/self-documentation
 *
 * Returns documentation about how to use the memory system.
 */
memory.get("/quickstart", async (c) => {
  try {
    const result = await getQuickstart();

    return sendResource(c, "memory_quickstart", {
      success: result.success,
      summary: result.summary,
      oneCommand: result.oneCommand,
      expectations: result.expectations,
      whatItReturns: result.whatItReturns,
      doNotDo: result.doNotDo,
      protocol: result.protocol,
      examples: result.examples,
      operatorNote: result.operatorNote,
      soloUser: result.soloUser,
      inlineFeedbackFormat: result.inlineFeedbackFormat,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /memory/stats - Get playbook statistics
 *
 * Returns metrics about the playbook rules.
 */
memory.get("/stats", async (c) => {
  try {
    const result = await getPlaybookStats();

    return sendResource(c, "memory_stats", {
      success: result.success,
      total: result.total,
      byScope: result.byScope,
      byState: result.byState,
      byKind: result.byKind,
      scoreDistribution: result.scoreDistribution,
      topPerformers: result.topPerformers,
      mostHelpful: result.mostHelpful,
      atRiskCount: result.atRiskCount,
      staleCount: result.staleCount,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /memory/rules - List playbook rules
 *
 * Query parameters:
 * - category: Filter by category
 * - scope: Filter by scope
 * - state: Filter by state (active, deprecated, pending)
 * - kind: Filter by kind (rule, anti-pattern, procedure)
 * - limit: Max results (default: 100)
 */
memory.get("/rules", async (c) => {
  try {
    const query = c.req.query();
    const parsed = PlaybookListQuerySchema.safeParse(query);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    // Build list options, only including defined values
    const listOptions: Parameters<typeof listPlaybookRules>[0] = {};
    if (parsed.data.category !== undefined)
      listOptions.category = parsed.data.category;
    if (parsed.data.scope !== undefined) listOptions.scope = parsed.data.scope;
    if (parsed.data.state !== undefined) listOptions.state = parsed.data.state;
    if (parsed.data.kind !== undefined) listOptions.kind = parsed.data.kind;
    if (parsed.data.limit !== undefined) listOptions.limit = parsed.data.limit;

    const result = await listPlaybookRules(listOptions);

    return sendList(
      c,
      result.bullets.map((b) => ({
        id: b.id,
        text: b.text,
        category: b.category,
        scope: b.scope,
        state: b.state,
        kind: b.kind,
        confidence: b.confidence,
        sourceCount: b.sourceCount,
        lastApplied: b.lastApplied,
        helpfulCount: b.helpfulCount,
        harmfulCount: b.harmfulCount,
        score: b.score,
      })),
    );
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /memory/doctor - Run health diagnostics
 *
 * Query parameters:
 * - fix: Apply automatic fixes (default: false)
 */
memory.get("/doctor", async (c) => {
  try {
    const query = c.req.query();
    const parsed = DoctorQuerySchema.safeParse(query);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    // Build doctor options
    const doctorOptions: Parameters<typeof runDiagnostics>[0] = {};
    if (parsed.data.fix !== undefined) doctorOptions.fix = parsed.data.fix;

    const result = await runDiagnostics(doctorOptions);

    return sendResource(c, "memory_doctor", {
      success: result.success,
      version: result.version,
      generatedAt: result.generatedAt,
      overallStatus: result.overallStatus,
      checks: result.checks.map((check) => ({
        category: check.category,
        item: check.item,
        status: check.status,
        message: check.message,
        details: check.details,
        fix: check.fix,
      })),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /memory/outcome - Record session outcome
 *
 * Body:
 * - status: "success" | "failure" | "partial"
 * - ruleIds: Array of rule IDs that were shown
 * - session: Optional session ID
 */
memory.post("/outcome", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = OutcomeBodySchema.safeParse(body);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const { status, ruleIds, session } = parsed.data;

    // Build outcome options
    const outcomeOptions: Parameters<typeof recordOutcome>[2] = {};
    if (session !== undefined) outcomeOptions.session = session;

    const result = await recordOutcome(status, ruleIds, outcomeOptions);

    return sendResource(c, "memory_outcome", {
      success: result.success,
      message: result.message,
      recorded: result.recorded,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

export { memory };
