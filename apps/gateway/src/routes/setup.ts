/**
 * Setup Routes - REST API endpoints for setup wizard and readiness checks.
 *
 * Provides endpoints to detect installed tools, check readiness,
 * and install missing components with progress tracking via WebSocket.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import {
  type DetectedType,
  getAgentDetectionService,
} from "../services/agent-detection.service";
import {
  getAllToolInfo,
  getReadinessStatus,
  getToolInfo,
  type InstallMode,
  installTool,
} from "../services/setup.service";
import {
  clearToolRegistryCache,
  getToolRegistryMetadata,
  loadToolRegistry,
} from "../services/tool-registry.service";
import {
  sendError,
  sendInternalError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const setup = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const InstallRequestSchema = z.object({
  tool: z.enum([
    "claude",
    "codex",
    "gemini",
    "aider",
    "gh-copilot",
    "dcg",
    "ubs",
    "cass",
    "cm",
    "br",
    "bv",
    "ru",
  ]) as z.ZodType<DetectedType>,
  mode: z
    .enum(["interactive", "easy"])
    .default("easy") as z.ZodType<InstallMode>,
  verify: z.boolean().default(true),
});

// ============================================================================
// Error Handler
// ============================================================================

function handleError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof z.ZodError) {
    return sendValidationError(c, transformZodError(error));
  }

  if (error instanceof SyntaxError && error.message.includes("JSON")) {
    return sendError(c, "INVALID_REQUEST", "Invalid JSON in request body", 400);
  }

  log.error({ error }, "Unexpected error in setup route");
  return sendInternalError(c);
}

// ============================================================================
// Readiness Routes
// ============================================================================

/**
 * GET /setup/readiness - Get comprehensive readiness status
 *
 * Returns detected agents and toolchain status with recommendations.
 * Results are cached for performance (60s TTL by default).
 *
 * Query params:
 * - bypass_cache: Set to "true" to force fresh detection
 */
setup.get("/readiness", async (c) => {
  try {
    const bypassCache = c.req.query("bypass_cache") === "true";
    const status = await getReadinessStatus(bypassCache);

    return sendResource(c, "readiness_status", status);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /setup/tools - List all known tools with info
 */
setup.get("/tools", async (c) => {
  try {
    const tools = await getAllToolInfo();
    return sendList(c, tools);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /setup/tools/:name - Get info about a specific tool
 */
setup.get("/tools/:name", async (c) => {
  try {
    const name = c.req.param("name") as DetectedType;
    const info = await getToolInfo(name);

    if (!info) {
      return sendNotFound(c, "tool", name);
    }

    // Also get current detection status
    const service = getAgentDetectionService();
    const detection = await service.detect(name);

    return sendResource(c, "tool_info", {
      ...info,
      status: detection,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Installation Routes
// ============================================================================

/**
 * POST /setup/install - Install a tool
 *
 * Installs the specified tool with progress events sent via WebSocket.
 * Installation is idempotent - if tool is already installed, returns success.
 *
 * Body:
 * - tool: The tool name to install
 * - mode: "interactive" or "easy" (default: "easy")
 * - verify: Whether to verify installation after (default: true)
 *
 * WebSocket events (channel: session-{sessionId}):
 * - setup:install:progress - Progress updates during installation
 */
setup.post("/install", async (c) => {
  const log = getLogger();

  try {
    const body = await c.req.json();
    const validated = InstallRequestSchema.parse(body);

    // Get session ID from header for WebSocket progress events
    const sessionId = c.req.header("X-Session-Id");

    log.info(
      {
        tool: validated.tool,
        mode: validated.mode,
        verify: validated.verify,
        sessionId,
      },
      "Processing install request",
    );

    // Check if tool has install command
    const toolInfo = await getToolInfo(validated.tool);
    if (!toolInfo?.installCommand) {
      return sendError(
        c,
        "NO_INSTALL_AVAILABLE",
        `No automated installation available for ${validated.tool}. Visit ${toolInfo?.docsUrl || "documentation"} for manual installation instructions.`,
        400,
      );
    }

    const result = await installTool(validated, sessionId);

    if (result.success) {
      return sendResource(c, "install_result", result);
    }

    return sendError(c, "INSTALL_FAILED", result.error || "Unknown error", 500);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /setup/install/batch - Install multiple tools
 *
 * Installs multiple tools sequentially with progress events.
 *
 * Body:
 * - tools: Array of tool names to install
 * - mode: "interactive" or "easy" (default: "easy")
 * - verify: Whether to verify each installation (default: true)
 * - stopOnError: Whether to stop on first error (default: false)
 */
setup.post("/install/batch", async (c) => {
  const log = getLogger();

  try {
    const body = await c.req.json();

    const BatchInstallSchema = z.object({
      tools: z.array(
        z.enum([
          "claude",
          "codex",
          "gemini",
          "aider",
          "gh-copilot",
          "dcg",
          "ubs",
          "cass",
          "cm",
          "br",
          "bv",
          "ru",
        ]),
      ) as z.ZodType<DetectedType[]>,
      mode: z.enum(["interactive", "easy"]).default("easy"),
      verify: z.boolean().default(true),
      stopOnError: z.boolean().default(false),
    });

    const validated = BatchInstallSchema.parse(body);
    const sessionId = c.req.header("X-Session-Id");

    log.info(
      {
        tools: validated.tools,
        mode: validated.mode,
        verify: validated.verify,
        stopOnError: validated.stopOnError,
        sessionId,
      },
      "Processing batch install request",
    );

    const results = [];
    let hasErrors = false;

    for (const tool of validated.tools) {
      const toolInfo = await getToolInfo(tool);
      if (!toolInfo?.installCommand) {
        results.push({
          tool,
          success: false,
          error: "No automated installation available",
          durationMs: 0,
        });
        hasErrors = true;
        if (validated.stopOnError) break;
        continue;
      }

      const result = await installTool(
        {
          tool,
          mode: validated.mode,
          verify: validated.verify,
        },
        sessionId,
      );

      results.push(result);

      if (!result.success) {
        hasErrors = true;
        if (validated.stopOnError) break;
      }
    }

    return sendResource(c, "batch_install_result", {
      success: !hasErrors,
      results,
      summary: {
        total: validated.tools.length,
        succeeded: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
      },
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /setup/verify - Verify installation of a tool
 *
 * Forces a fresh detection of the specified tool.
 */
setup.post("/verify/:name", async (c) => {
  try {
    const name = c.req.param("name") as DetectedType;

    const service = getAgentDetectionService();
    service.clearCache();

    const detection = await service.detect(name);

    if (!detection) {
      return sendNotFound(c, "tool", name);
    }

    return sendResource(c, "verification_result", {
      tool: name,
      available: detection.available,
      version: detection.version,
      path: detection.path,
      authenticated: detection.authenticated,
      authError: detection.authError,
      detectedAt: detection.detectedAt.toISOString(),
      durationMs: detection.durationMs,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * DELETE /setup/cache - Clear detection cache
 *
 * Forces next readiness check to perform fresh detection.
 */
setup.delete("/cache", async (c) => {
  try {
    const service = getAgentDetectionService();
    service.clearCache();

    return sendResource(c, "cache_cleared", {
      message: "Detection cache cleared",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * DELETE /setup/registry/cache - Clear tool registry cache
 */
setup.delete("/registry/cache", async (c) => {
  try {
    clearToolRegistryCache();
    return sendResource(c, "registry_cache_cleared", {
      message: "Tool registry cache cleared",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /setup/registry/refresh - Force reload tool registry manifest
 */
setup.post("/registry/refresh", async (c) => {
  try {
    const registry = await loadToolRegistry({ bypassCache: true });
    const meta = getToolRegistryMetadata();
    return sendResource(c, "registry_refresh", {
      manifest: {
        schemaVersion: registry.schemaVersion,
        source: registry.source ?? null,
        generatedAt: registry.generatedAt ?? null,
        manifestPath: meta?.manifestPath ?? null,
        manifestHash: meta?.manifestHash ?? null,
      },
      toolCount: registry.tools.length,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /setup/registry - Get full tool registry (parsed modules)
 *
 * Returns the complete tool registry including all parsed tool definitions.
 * This endpoint exposes the manifest-driven tool inventory for clients
 * that need the full module list rather than just metadata.
 *
 * Query params:
 * - bypass_cache: Set to "true" to force fresh manifest load
 */
setup.get("/registry", async (c) => {
  try {
    const bypassCache = c.req.query("bypass_cache") === "true";
    const registry = await loadToolRegistry({ bypassCache });
    const meta = getToolRegistryMetadata();

    return sendResource(c, "tool_registry", {
      schemaVersion: registry.schemaVersion,
      source: registry.source ?? null,
      generatedAt: registry.generatedAt ?? null,
      tools: registry.tools,
      metadata: {
        manifestPath: meta?.manifestPath ?? null,
        manifestHash: meta?.manifestHash ?? null,
        registrySource: meta?.registrySource ?? null,
        loadedAt: meta?.loadedAt ?? null,
        errorCategory: meta?.errorCategory ?? null,
        userMessage: meta?.userMessage ?? null,
      },
    });
  } catch (error) {
    return handleError(error, c);
  }
});

export { setup };
