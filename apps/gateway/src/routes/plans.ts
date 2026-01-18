/**
 * Plans Routes - REST API endpoints for Automated Plan Reviser (apr) integration.
 *
 * Provides endpoints for iterative AI-powered specification refinement
 * using GPT Pro Extended Reasoning via Oracle.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import { getAprService } from "../services/apr.service";
import {
  sendError,
  sendInternalError,
  sendList,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const plans = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const WorkflowQuerySchema = z.object({
  workflow: z.string().optional(),
});

const RoundParamSchema = z.object({
  round: z.coerce.number().int().min(0),
});

const RoundOptionsSchema = z.object({
  workflow: z.string().optional(),
  includeImpl: z.coerce.boolean().optional(),
});

const RunOptionsSchema = z.object({
  workflow: z.string().optional(),
  timeout: z.coerce.number().int().min(60000).max(1800000).optional(),
});

const DiffQuerySchema = z.object({
  workflow: z.string().optional(),
  roundB: z.coerce.number().int().min(0).optional(),
});

// ============================================================================
// Error Handler
// ============================================================================

function handleError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof z.ZodError) {
    return sendValidationError(c, transformZodError(error));
  }

  if (error instanceof Error) {
    // Check for apr not installed error
    if (
      error.message.includes("not installed") ||
      error.message.includes("ENOENT")
    ) {
      return sendError(
        c,
        "APR_NOT_INSTALLED",
        "apr CLI is not installed. Run: curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/automated_plan_reviser/main/install.sh | bash",
        503,
        {
          hint: "Install apr CLI to use the plans API",
          severity: "recoverable",
        },
      );
    }

    log.error({ error: error.message }, "Error in plans route");
    return sendError(c, "APR_ERROR", error.message, 500);
  }

  log.error({ error }, "Unexpected error in plans route");
  return sendInternalError(c);
}

// ============================================================================
// Status Route
// ============================================================================

/**
 * GET /plans/status - Check apr availability and system status
 */
plans.get("/status", async (c) => {
  try {
    const apr = getAprService();
    const [available, version] = await Promise.all([
      apr.isAvailable(),
      apr.getVersion(),
    ]);

    if (!available) {
      return sendResource(c, "apr_status", {
        available: false,
        version: null,
        installCommand:
          "curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/automated_plan_reviser/main/install.sh | bash",
      });
    }

    // Get full status if available
    try {
      const status = await apr.getStatus();
      return sendResource(c, "apr_status", {
        available: true,
        version,
        ...status,
      });
    } catch {
      // Partial status if full status fails
      return sendResource(c, "apr_status", {
        available: true,
        version,
      });
    }
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Workflow Routes
// ============================================================================

/**
 * GET /plans/workflows - List all configured workflows
 */
plans.get("/workflows", async (c) => {
  try {
    const apr = getAprService();
    const workflows = await apr.listWorkflows();

    return sendList(c, workflows, {
      total: workflows.length,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// History & Stats Routes
// ============================================================================

/**
 * GET /plans/history - Get revision history for a workflow
 */
plans.get("/history", async (c) => {
  try {
    const query = c.req.query();
    const validated = WorkflowQuerySchema.parse(query);
    const apr = getAprService();

    const options: { workflow?: string } = {};
    if (validated.workflow !== undefined) options.workflow = validated.workflow;

    const history = await apr.getHistory(options);

    return sendResource(c, "apr_history", history);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /plans/stats - Get analytics and convergence metrics
 */
plans.get("/stats", async (c) => {
  try {
    const query = c.req.query();
    const validated = WorkflowQuerySchema.parse(query);
    const apr = getAprService();

    const options: { workflow?: string } = {};
    if (validated.workflow !== undefined) options.workflow = validated.workflow;

    const stats = await apr.getStats(options);

    return sendResource(c, "apr_stats", stats);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Round Routes
// ============================================================================

/**
 * GET /plans/rounds/:round - Get round content and details
 */
plans.get("/rounds/:round", async (c) => {
  try {
    const roundNum = RoundParamSchema.parse({ round: c.req.param("round") });
    const query = c.req.query();
    const validated = RoundOptionsSchema.parse(query);
    const apr = getAprService();

    const options: { workflow?: string; includeImpl?: boolean } = {};
    if (validated.workflow !== undefined) options.workflow = validated.workflow;
    if (validated.includeImpl !== undefined)
      options.includeImpl = validated.includeImpl;

    const round = await apr.getRound(roundNum.round, options);

    return sendResource(c, "apr_round", round);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /plans/rounds/:round/validate - Validate before running a revision
 */
plans.get("/rounds/:round/validate", async (c) => {
  try {
    const roundNum = RoundParamSchema.parse({ round: c.req.param("round") });
    const query = c.req.query();
    const validated = WorkflowQuerySchema.parse(query);
    const apr = getAprService();

    const options: { workflow?: string } = {};
    if (validated.workflow !== undefined) options.workflow = validated.workflow;

    const result = await apr.validateRound(roundNum.round, options);

    return sendResource(c, "apr_validation", result);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /plans/rounds/:round/run - Run a revision round
 * Note: This can be a long-running operation (up to 10 minutes by default)
 */
plans.post("/rounds/:round/run", async (c) => {
  try {
    const roundNum = RoundParamSchema.parse({ round: c.req.param("round") });
    const query = c.req.query();
    const validated = RunOptionsSchema.parse(query);
    const apr = getAprService();

    const options: { workflow?: string; timeout?: number } = {};
    if (validated.workflow !== undefined) options.workflow = validated.workflow;
    if (validated.timeout !== undefined) options.timeout = validated.timeout;

    const round = await apr.runRound(roundNum.round, options);

    return sendResource(c, "apr_round", round, 201);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /plans/rounds/:round/integrate - Get Claude Code integration prompt
 */
plans.get("/rounds/:round/integrate", async (c) => {
  try {
    const roundNum = RoundParamSchema.parse({ round: c.req.param("round") });
    const query = c.req.query();
    const validated = RoundOptionsSchema.parse(query);
    const apr = getAprService();

    const options: { workflow?: string; includeImpl?: boolean } = {};
    if (validated.workflow !== undefined) options.workflow = validated.workflow;
    if (validated.includeImpl !== undefined)
      options.includeImpl = validated.includeImpl;

    const integration = await apr.getIntegrationPrompt(roundNum.round, options);

    return sendResource(c, "apr_integration", integration);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Diff Route
// ============================================================================

/**
 * GET /plans/diff/:roundA - Compare two revision rounds
 * Query params: roundB (optional, defaults to roundA-1), workflow
 */
plans.get("/diff/:roundA", async (c) => {
  try {
    const roundA = RoundParamSchema.parse({ round: c.req.param("roundA") });
    const query = c.req.query();
    const validated = DiffQuerySchema.parse(query);
    const apr = getAprService();

    const options: { workflow?: string } = {};
    if (validated.workflow !== undefined) options.workflow = validated.workflow;

    const diff = await apr.diffRounds(roundA.round, validated.roundB, options);

    return sendResource(c, "apr_diff", diff);
  } catch (error) {
    return handleError(error, c);
  }
});

export { plans };
