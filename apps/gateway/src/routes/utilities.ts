/**
 * Utilities Routes - REST API endpoints for developer utilities management.
 *
 * Provides endpoints to list, check, install, and run developer utilities
 * like giil (image download) and csctf (chat conversion).
 */

import {
  createAprClient,
  createBunAprCommandRunner,
  createBunJfpCommandRunner,
  createJfpClient,
  detectOutputFormat,
  isToonFormat,
  normalizeOutput,
  parseToon,
} from "@flywheel/flywheel-clients";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdminMiddleware } from "../middleware/auth";
import { getLogger } from "../middleware/correlation";
import {
  getUtilityStatus,
  installUtility,
  listUtilities,
  runCsctf,
  runDoctor,
  runGiil,
  updateUtility,
} from "../services/utilities.service";
import { createRouteErrorHandler } from "../utils/error-handler";
import {
  sendError,
  sendList,
  sendNotFound,
  sendResource,
} from "../utils/response";

const utilities = new Hono();
utilities.use("*", requireAdminMiddleware());

const jfpClient = createJfpClient({ runner: createBunJfpCommandRunner() });
const aprClient = createAprClient({ runner: createBunAprCommandRunner() });

// ============================================================================
// Validation Schemas
// ============================================================================

const GiilRequestSchema = z.object({
  url: z.string().url(),
  outputDir: z.string().optional(),
  format: z.enum(["file", "json", "base64"]).optional(),
});

const CsctfRequestSchema = z.object({
  url: z.string().url(),
  outputDir: z.string().optional(),
  formats: z.array(z.enum(["md", "html"])).optional(),
  publishToGhPages: z.boolean().optional(),
});

const ToonParseRequestSchema = z.object({
  input: z.string().min(1),
  expectedFormat: z.enum(["json", "jsonl", "toon", "csv", "sarif"]).optional(),
});

// Use shared error handler
const handleError = createRouteErrorHandler("utilities");

// ============================================================================
// List and Status Routes
// ============================================================================

/**
 * GET /utilities - List all utilities with install status
 */
utilities.get("/", async (c) => {
  try {
    const result = await listUtilities();
    return sendList(c, result);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /utilities/doctor - Check health of all utilities
 */
utilities.get("/doctor", async (c) => {
  try {
    const result = await runDoctor();
    return sendResource(c, "doctor_result", result);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /utilities/jfp/status - Check JFP CLI status
 */
utilities.get("/jfp/status", async (c) => {
  try {
    const status = await jfpClient.status();
    return sendResource(c, "jfp_status", status);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /utilities/jfp/prompts - List, search, or suggest JFP prompts
 */
utilities.get("/jfp/prompts", async (c) => {
  try {
    const q = c.req.query("q");
    const task = c.req.query("task");
    const category = c.req.query("category");
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 20;

    const available = await jfpClient.isAvailable();
    if (!available) {
      return sendResource(c, "jfp_prompts", {
        available: false,
        prompts: [],
        total: 0,
        message: "jfp CLI is not installed",
      });
    }

    if (task) {
      const suggestOpts: { limit?: number } = {};
      if (!Number.isNaN(limit)) suggestOpts.limit = limit;
      const result = await jfpClient.suggest(task, suggestOpts);
      return sendResource(c, "jfp_prompts", {
        available: true,
        prompts: result.suggestions,
        total: result.suggestions.length,
        task: result.task,
      });
    }

    if (q) {
      const searchOpts: { limit?: number; category?: string } = {};
      if (!Number.isNaN(limit)) searchOpts.limit = limit;
      if (category) searchOpts.category = category;
      const result = await jfpClient.search(q, searchOpts);
      return sendResource(c, "jfp_prompts", {
        available: true,
        prompts: result.prompts,
        total: result.total,
        query: result.query,
      });
    }

    const listOpts: { limit?: number } = {};
    if (!Number.isNaN(limit)) listOpts.limit = limit;
    const result = await jfpClient.list(listOpts);
    return sendResource(c, "jfp_prompts", {
      available: true,
      prompts: result.prompts,
      total: result.total,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /utilities/apr/status - Check APR CLI status and workflows
 */
utilities.get("/apr/status", async (c) => {
  try {
    const available = await aprClient.isAvailable();
    if (!available) {
      return sendResource(c, "apr_status", {
        available: false,
        configured: false,
        workflows: [],
        message: "apr CLI is not installed",
      });
    }
    const [status, workflows] = await Promise.all([
      aprClient.getStatus().catch(() => ({
        configured: false,
        default_workflow: "default",
        workflow_count: 0,
        workflows: [] as string[],
        oracle_available: false,
        oracle_method: "none",
        config_dir: "",
        apr_home: "",
      })),
      aprClient.listWorkflows().catch(() => []),
    ]);
    return sendResource(c, "apr_status", {
      available: true,
      ...status,
      workflowDetails: workflows,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /utilities/toon/parse - Detect, parse, and normalize TOON/JSON/JSONL/CSV/SARIF output
 */
utilities.post("/toon/parse", async (c) => {
  try {
    const body = await c.req.json();
    const validated = ToonParseRequestSchema.parse(body);

    const detectedFormat = detectOutputFormat(validated.input);
    const toonDetected = isToonFormat(validated.input);
    const toonParsed = toonDetected ? parseToon(validated.input) : undefined;
    const normalized = normalizeOutput(
      validated.input,
      validated.expectedFormat,
    );

    return sendResource(c, "toon_parse_result", {
      detectedFormat,
      isToon: toonDetected,
      sourceFormat: normalized.sourceFormat,
      envelopeCompliant: normalized.envelopeCompliant,
      data: normalized.data,
      toon: toonParsed,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /utilities/:name - Get status of a specific utility
 */
utilities.get("/:name", async (c) => {
  try {
    const name = c.req.param("name");
    const status = await getUtilityStatus(name);

    if (!status) {
      return sendNotFound(c, "utility", name);
    }

    return sendResource(c, "utility", status);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Installation Routes
// ============================================================================

/**
 * POST /utilities/:name/install - Install a utility
 */
utilities.post("/:name/install", async (c) => {
  try {
    const name = c.req.param("name");
    const log = getLogger();

    log.info({ utility: name }, "Installing utility");
    const result = await installUtility(name);

    if (!result.success) {
      return sendError(
        c,
        "INSTALL_FAILED",
        result.error ?? "Installation failed",
        500,
      );
    }

    return sendResource(c, "installation_result", {
      success: true,
      utility: result.utility,
      message: "Installation successful",
      output: result.output,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /utilities/:name/update - Update a utility
 */
utilities.post("/:name/update", async (c) => {
  try {
    const name = c.req.param("name");
    const log = getLogger();

    log.info({ utility: name }, "Updating utility");
    const result = await updateUtility(name);

    if (!result.success) {
      return sendError(
        c,
        "UPDATE_FAILED",
        result.error ?? "Update failed",
        500,
      );
    }

    return sendResource(c, "update_result", {
      success: true,
      utility: result.utility,
      message: "Update successful",
      output: result.output,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Utility Execution Routes
// ============================================================================

/**
 * POST /utilities/giil/run - Run giil to download an image
 */
utilities.post("/giil/run", async (c) => {
  try {
    const body = await c.req.json();
    const validated = GiilRequestSchema.parse(body);
    const log = getLogger();

    // Build request conditionally (for exactOptionalPropertyTypes)
    const giilRequest: Parameters<typeof runGiil>[0] = {
      url: validated.url,
    };
    if (validated.outputDir !== undefined)
      giilRequest.outputDir = validated.outputDir;
    if (validated.format !== undefined) giilRequest.format = validated.format;

    log.info({ format: validated.format }, "Running giil");
    const result = await runGiil(giilRequest);

    if (!result.success) {
      return sendError(
        c,
        "GIIL_FAILED",
        result.error ?? "GIIL execution failed",
        500,
      );
    }

    return sendResource(c, "giil_result", result);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /utilities/csctf/run - Run csctf to convert chat
 */
utilities.post("/csctf/run", async (c) => {
  try {
    const body = await c.req.json();
    const validated = CsctfRequestSchema.parse(body);
    const log = getLogger();

    // Build request conditionally (for exactOptionalPropertyTypes)
    const csctfRequest: Parameters<typeof runCsctf>[0] = {
      url: validated.url,
    };
    if (validated.outputDir !== undefined)
      csctfRequest.outputDir = validated.outputDir;
    if (validated.formats !== undefined)
      csctfRequest.formats = validated.formats;
    if (validated.publishToGhPages !== undefined)
      csctfRequest.publishToGhPages = validated.publishToGhPages;

    log.info({ formats: validated.formats }, "Running csctf");
    const result = await runCsctf(csctfRequest);

    if (!result.success) {
      return sendError(
        c,
        "CSCTF_FAILED",
        result.error ?? "CSCTF execution failed",
        500,
      );
    }

    return sendResource(c, "csctf_result", result);
  } catch (error) {
    return handleError(error, c);
  }
});

export { utilities };
