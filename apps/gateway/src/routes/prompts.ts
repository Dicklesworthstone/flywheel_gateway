/**
 * Prompts Routes - REST API endpoints for JeffreysPrompts (jfp) integration.
 *
 * Provides endpoints to browse, search, and retrieve AI prompts from the
 * jfp CLI prompt library.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import { getJfpService } from "../services/jfp.service";
import {
  sendError,
  sendInternalError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const prompts = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const SearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  category: z.string().optional(),
});

const SuggestQuerySchema = z.object({
  task: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

const LimitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
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
    // Check for jfp not installed error
    if (
      error.message.includes("not installed") ||
      error.message.includes("ENOENT")
    ) {
      return sendError(
        c,
        "JFP_NOT_INSTALLED",
        "jfp CLI is not installed. Run: curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/jeffreysprompts/main/install.sh | bash",
        503,
        {
          hint: "Install jfp CLI to use the prompts API",
          severity: "recoverable",
        },
      );
    }

    log.error({ error: error.message }, "Error in prompts route");
    return sendError(c, "JFP_ERROR", "Prompt command execution failed", 500);
  }

  log.error({ error }, "Unexpected error in prompts route");
  return sendInternalError(c);
}

// ============================================================================
// Status Route
// ============================================================================

/**
 * GET /prompts/status - Check jfp availability and version
 */
prompts.get("/status", async (c) => {
  try {
    const jfp = getJfpService();
    const [available, version] = await Promise.all([
      jfp.isAvailable(),
      jfp.getVersion(),
    ]);

    return sendResource(c, "jfp_status", {
      available,
      version,
      installCommand:
        "curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/jeffreysprompts/main/install.sh | bash",
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// List Routes
// ============================================================================

/**
 * GET /prompts - List all prompts
 */
prompts.get("/", async (c) => {
  try {
    const jfp = getJfpService();
    const bypassCache = c.req.query("refresh") === "true";
    const result = await jfp.list(bypassCache);

    return sendList(c, result.prompts, {
      total: result.total,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /prompts/categories - List all categories
 */
prompts.get("/categories", async (c) => {
  try {
    const jfp = getJfpService();
    const bypassCache = c.req.query("refresh") === "true";
    const categories = await jfp.listCategories(bypassCache);

    return sendList(c, categories, {
      total: categories.length,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /prompts/featured - Get featured prompts
 */
prompts.get("/featured", async (c) => {
  try {
    const query = c.req.query();
    const validated = LimitQuerySchema.parse(query);
    const jfp = getJfpService();

    // Build options conditionally (for exactOptionalPropertyTypes)
    const options: { limit?: number } = {};
    if (validated.limit !== undefined) options.limit = validated.limit;

    const featured = await jfp.getFeatured(options);

    return sendList(c, featured, {
      total: featured.length,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /prompts/random - Get a random prompt
 */
prompts.get("/random", async (c) => {
  try {
    const jfp = getJfpService();
    const prompt = await jfp.getRandom();

    if (!prompt) {
      return sendError(c, "NO_PROMPTS", "No prompts available", 404);
    }

    return sendResource(c, "prompt", prompt);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Search Routes
// ============================================================================

/**
 * GET /prompts/search - Search prompts
 */
prompts.get("/search", async (c) => {
  try {
    const query = c.req.query();
    const validated = SearchQuerySchema.parse(query);
    const jfp = getJfpService();

    // Build options conditionally (for exactOptionalPropertyTypes)
    const options: { limit?: number; category?: string } = {};
    if (validated.limit !== undefined) options.limit = validated.limit;
    if (validated.category !== undefined) options.category = validated.category;

    const result = await jfp.search(validated.q, options);

    return sendList(c, result.prompts, {
      total: result.total,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /prompts/suggest - Suggest prompts for a task
 */
prompts.get("/suggest", async (c) => {
  try {
    const query = c.req.query();
    const validated = SuggestQuerySchema.parse(query);
    const jfp = getJfpService();

    // Build options conditionally (for exactOptionalPropertyTypes)
    const options: { limit?: number } = {};
    if (validated.limit !== undefined) options.limit = validated.limit;

    const result = await jfp.suggest(validated.task, options);

    return sendResource(c, "suggestions", {
      task: result.task,
      prompts: result.suggestions,
      count: result.suggestions.length,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Category Route
// ============================================================================

/**
 * GET /prompts/category/:name - Get prompts by category
 */
prompts.get("/category/:name", async (c) => {
  try {
    const categoryName = c.req.param("name");
    const query = c.req.query();
    const validated = LimitQuerySchema.parse(query);
    const jfp = getJfpService();

    // Build options conditionally (for exactOptionalPropertyTypes)
    const options: { limit?: number } = {};
    if (validated.limit !== undefined) options.limit = validated.limit;

    const categoryPrompts = await jfp.getByCategory(categoryName, options);

    if (categoryPrompts.length === 0) {
      // Check if category exists
      const categories = await jfp.listCategories();
      const exists = categories.some(
        (cat) => cat.name.toLowerCase() === categoryName.toLowerCase(),
      );

      if (!exists) {
        return sendNotFound(c, "category", categoryName);
      }
    }

    return sendList(c, categoryPrompts, {
      total: categoryPrompts.length,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Single Prompt Route
// ============================================================================

/**
 * GET /prompts/:id - Get a specific prompt
 */
prompts.get("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const jfp = getJfpService();

    const prompt = await jfp.get(id);

    if (!prompt) {
      return sendNotFound(c, "prompt", id);
    }

    return sendResource(c, "prompt", prompt);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Cache Control
// ============================================================================

/**
 * POST /prompts/cache/clear - Clear the prompt cache
 */
prompts.post("/cache/clear", async (c) => {
  try {
    const jfp = getJfpService();
    jfp.clearCache();

    return sendResource(c, "cache_cleared", {
      success: true,
      message: "Prompt cache cleared",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

export { prompts };
