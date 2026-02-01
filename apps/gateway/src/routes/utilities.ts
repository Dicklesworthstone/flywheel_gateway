/**
 * Utilities Routes - REST API endpoints for developer utilities management.
 *
 * Provides endpoints to list, check, install, and run developer utilities
 * like giil (image download) and csctf (chat conversion).
 */

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

    // Destructure to avoid duplicate 'success' property
    const { success: _success, ...restResult } = result;
    return sendResource(c, "giil_result", restResult);
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

    // Destructure to avoid duplicate 'success' property
    const { success: _success, ...restResult } = result;
    return sendResource(c, "csctf_result", restResult);
  } catch (error) {
    return handleError(error, c);
  }
});

export { utilities };
