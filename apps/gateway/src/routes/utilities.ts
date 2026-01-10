/**
 * Utilities Routes - REST API endpoints for developer utilities management.
 *
 * Provides endpoints to list, check, install, and run developer utilities
 * like giil (image download) and csctf (chat conversion).
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  getUtilityStatus,
  installUtility,
  listUtilities,
  runCsctf,
  runDoctor,
  runGiil,
  updateUtility,
} from "../services/utilities.service";

const utilities = new Hono();

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

// ============================================================================
// Error Handler
// ============================================================================

function handleError(error: unknown, c: Context) {
  const log = getLogger();
  const correlationId = getCorrelationId();

  if (error instanceof z.ZodError) {
    return c.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Validation failed",
          correlationId,
          timestamp: new Date().toISOString(),
          details: error.issues,
        },
      },
      400,
    );
  }

  if (error instanceof SyntaxError && error.message.includes("JSON")) {
    return c.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid JSON in request body",
          correlationId,
          timestamp: new Date().toISOString(),
        },
      },
      400,
    );
  }

  log.error({ error }, "Unexpected error in utilities route");
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        correlationId,
        timestamp: new Date().toISOString(),
      },
    },
    500,
  );
}

// ============================================================================
// List and Status Routes
// ============================================================================

/**
 * GET /utilities - List all utilities with install status
 */
utilities.get("/", async (c) => {
  try {
    const result = await listUtilities();
    return c.json({
      utilities: result,
      correlationId: getCorrelationId(),
    });
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
    return c.json({
      ...result,
      correlationId: getCorrelationId(),
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
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: `Unknown utility: ${name}`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
            hint: "Available utilities: giil, csctf",
          },
        },
        404,
      );
    }

    return c.json({
      utility: status,
      correlationId: getCorrelationId(),
    });
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
      return c.json(
        {
          error: {
            code: "INSTALL_FAILED",
            message: result.error,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
            output: result.output,
          },
        },
        500,
      );
    }

    return c.json({
      success: true,
      utility: result.utility,
      message: "Installation successful",
      output: result.output,
      correlationId: getCorrelationId(),
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
      return c.json(
        {
          error: {
            code: "UPDATE_FAILED",
            message: result.error,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
            output: result.output,
          },
        },
        500,
      );
    }

    return c.json({
      success: true,
      utility: result.utility,
      message: "Update successful",
      output: result.output,
      correlationId: getCorrelationId(),
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

    log.info({ format: validated.format }, "Running giil");
    const result = await runGiil(validated);

    if (!result.success) {
      return c.json(
        {
          error: {
            code: "GIIL_FAILED",
            message: result.error,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        500,
      );
    }

    return c.json({
      success: true,
      ...result,
      correlationId: getCorrelationId(),
    });
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

    log.info({ formats: validated.formats }, "Running csctf");
    const result = await runCsctf(validated);

    if (!result.success) {
      return c.json(
        {
          error: {
            code: "CSCTF_FAILED",
            message: result.error,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        500,
      );
    }

    return c.json({
      success: true,
      ...result,
      correlationId: getCorrelationId(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

export { utilities };
