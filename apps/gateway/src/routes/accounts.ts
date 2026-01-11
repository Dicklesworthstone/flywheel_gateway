/**
 * Account Routes - REST API endpoints for CAAM account management.
 *
 * Manages BYOA (Bring Your Own Account) profiles for AI providers.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  activateProfile,
  createProfile,
  deleteProfile,
  getByoaStatus,
  getPool,
  getProfile,
  listProfiles,
  markVerified,
  setCooldown,
  updateProfile,
} from "../caam/account.service";
import { handleRateLimit, peekNextProfile, rotate } from "../caam/rotation";
import type { ProviderId } from "../caam/types";
import { getLogger } from "../middleware/correlation";
import {
  sendError,
  sendInternalError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const accounts = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const ProviderSchema = z.enum(["claude", "codex", "gemini"]);
const AuthModeSchema = z.enum([
  "oauth_browser",
  "device_code",
  "api_key",
  "vertex_adc",
]);
const ProfileStatusSchema = z.enum([
  "unlinked",
  "linked",
  "verified",
  "expired",
  "cooldown",
  "error",
]);

const CreateProfileSchema = z.object({
  workspaceId: z.string().min(1),
  provider: ProviderSchema,
  name: z.string().min(1).max(100),
  authMode: AuthModeSchema,
  labels: z.array(z.string()).optional(),
});

const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  labels: z.array(z.string()).optional(),
});

const CooldownSchema = z.object({
  minutes: z.number().min(1).max(1440).default(15),
  reason: z.string().max(500).optional(),
});

const StartLoginSchema = z.object({
  workspaceId: z.string().min(1),
  mode: AuthModeSchema.optional(),
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

  log.error({ error }, "Unexpected error in accounts route");
  return sendInternalError(c);
}

// ============================================================================
// BYOA Status Routes
// ============================================================================

/**
 * GET /accounts/byoa-status - Get workspace BYOA readiness
 */
accounts.get("/byoa-status", async (c) => {
  try {
    const workspaceId = c.req.query("workspaceId") ?? "default";
    const status = await getByoaStatus(workspaceId);
    return sendResource(c, "byoa_status", status);
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Profile Routes
// ============================================================================

/**
 * GET /accounts/profiles - List profiles
 */
accounts.get("/profiles", async (c) => {
  try {
    const workspaceId = c.req.query("workspaceId");
    const providerParam = c.req.query("provider");
    const statusParam = c.req.query("status");
    const limitParam = c.req.query("limit");

    // Build options object conditionally (for exactOptionalPropertyTypes)
    const options: Parameters<typeof listProfiles>[0] = {};
    if (workspaceId) options.workspaceId = workspaceId;
    // Validate provider parameter - only include if valid
    if (providerParam) {
      const providerResult = ProviderSchema.safeParse(providerParam);
      if (providerResult.success) {
        options.provider = providerResult.data;
      }
      // Invalid provider values are silently ignored (filtered out)
    }
    if (statusParam) {
      // Validate each status value, filtering out any invalid ones
      const validStatuses = statusParam
        .split(",")
        .map((s) => ProfileStatusSchema.safeParse(s.trim()))
        .filter((r) => r.success)
        .map((r) => r.data!);
      if (validStatuses.length > 0) {
        options.status = validStatuses;
      }
    }
    if (limitParam) {
      const parsedLimit = parseInt(limitParam, 10);
      if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
        options.limit = parsedLimit;
      }
    }

    const result = await listProfiles(options);

    return sendList(c, result.profiles, {
      hasMore: result.pagination?.hasMore ?? false,
      total: result.pagination?.total,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /accounts/profiles - Create a profile
 */
accounts.post("/profiles", async (c) => {
  try {
    const body = await c.req.json();
    const validated = CreateProfileSchema.parse(body);

    // Build options object conditionally (for exactOptionalPropertyTypes)
    const options: Parameters<typeof createProfile>[0] = {
      workspaceId: validated.workspaceId,
      provider: validated.provider,
      name: validated.name,
      authMode: validated.authMode,
    };
    if (validated.labels) options.labels = validated.labels;

    const profile = await createProfile(options);
    return sendResource(c, "profile", profile, 201);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /accounts/profiles/:id - Get profile details
 */
accounts.get("/profiles/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const profile = await getProfile(id);

    if (!profile) {
      return sendNotFound(c, "profile", id);
    }

    return sendResource(c, "profile", profile);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * PATCH /accounts/profiles/:id - Update a profile
 */
accounts.patch("/profiles/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const validated = UpdateProfileSchema.parse(body);

    // Build options object conditionally (for exactOptionalPropertyTypes)
    const options: Parameters<typeof updateProfile>[1] = {};
    if (validated.name !== undefined) options.name = validated.name;
    if (validated.labels !== undefined) options.labels = validated.labels;

    const profile = await updateProfile(id, options);

    if (!profile) {
      return sendNotFound(c, "profile", id);
    }

    return sendResource(c, "profile", profile);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * DELETE /accounts/profiles/:id - Delete a profile
 */
accounts.delete("/profiles/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const deleted = await deleteProfile(id);

    if (!deleted) {
      return sendNotFound(c, "profile", id);
    }

    return sendResource(c, "profile_deletion", { deleted: true, id });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /accounts/profiles/:id/activate - Activate a profile
 */
accounts.post("/profiles/:id/activate", async (c) => {
  try {
    const id = c.req.param("id");
    const profile = await activateProfile(id);

    if (!profile) {
      return sendNotFound(c, "profile", id);
    }

    return sendResource(c, "profile_activation", { profile, activated: true });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /accounts/profiles/:id/cooldown - Set profile cooldown
 */
accounts.post("/profiles/:id/cooldown", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const validated = CooldownSchema.parse(body);
    const profile = await setCooldown(id, validated.minutes, validated.reason);

    if (!profile) {
      return sendNotFound(c, "profile", id);
    }

    return sendResource(c, "profile_cooldown", { profile, cooldownSet: true });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Login Flow Routes
// ============================================================================

/**
 * POST /accounts/providers/:provider/login/start - Start login flow
 */
accounts.post("/providers/:provider/login/start", async (c) => {
  try {
    const provider = ProviderSchema.parse(c.req.param("provider"));
    const body = await c.req.json();
    const validated = StartLoginSchema.parse(body);

    // Create profile if needed
    const profile = await createProfile({
      workspaceId: validated.workspaceId,
      provider,
      name: `${provider}-${Date.now()}`,
      authMode: validated.mode ?? "device_code",
    });

    // Return login challenge (in real implementation, this would trigger OAuth/device code)
    // For now, return a stub response
    const challenge = {
      provider,
      profileId: profile.id,
      mode: validated.mode ?? "device_code",
      instructions: `To authenticate with ${provider}:
1. Go to the ${provider} website
2. Sign in with your account
3. Authorize Flywheel Gateway
4. Call the /login/complete endpoint when done`,
      expiresInSeconds: 600,
    };

    return sendResource(c, "login_challenge", { challenge, profile }, 201);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /accounts/providers/:provider/login/complete - Complete login flow
 */
accounts.post("/providers/:provider/login/complete", async (c) => {
  try {
    const provider = ProviderSchema.parse(c.req.param("provider"));
    const body = await c.req.json();
    const { profileId } = z.object({ profileId: z.string() }).parse(body);

    // Verify the profile exists and belongs to the correct provider
    const existingProfile = await getProfile(profileId);
    if (!existingProfile) {
      return sendNotFound(c, "profile", profileId);
    }

    // Validate provider matches
    if (existingProfile.provider !== provider) {
      return sendError(
        c,
        "INVALID_REQUEST",
        `Profile ${profileId} belongs to provider '${existingProfile.provider}', not '${provider}'`,
        400,
      );
    }

    // In real implementation, this would verify the OAuth callback/device code
    // For now, mark the profile as verified
    const profile = await markVerified(profileId);

    return sendResource(c, "login_complete", { profile, status: "linked" });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Pool Routes
// ============================================================================

/**
 * GET /accounts/pools/:provider - Get pool status
 */
accounts.get("/pools/:provider", async (c) => {
  try {
    const provider = ProviderSchema.parse(c.req.param("provider"));
    const workspaceId = c.req.query("workspaceId") ?? "default";

    const pool = await getPool(workspaceId, provider);
    if (!pool) {
      return sendNotFound(c, "pool", provider);
    }

    const nextProfile = await peekNextProfile(workspaceId, provider);

    return sendResource(c, "pool", {
      pool,
      nextProfile: nextProfile
        ? { id: nextProfile.id, name: nextProfile.name }
        : null,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /accounts/pools/:provider/rotate - Force rotation
 */
accounts.post("/pools/:provider/rotate", async (c) => {
  try {
    const provider = ProviderSchema.parse(c.req.param("provider"));
    const workspaceId = c.req.query("workspaceId") ?? "default";
    const reason = c.req.query("reason");

    const result = await rotate(
      workspaceId,
      provider,
      reason ?? "Manual rotation",
    );

    if (!result.success) {
      return sendError(
        c,
        "ROTATION_FAILED",
        result.reason ?? "Rotation failed",
        400,
      );
    }

    return sendResource(c, "rotation_result", result);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /accounts/pools/:provider/rate-limit - Handle rate limit
 */
accounts.post("/pools/:provider/rate-limit", async (c) => {
  try {
    const provider = ProviderSchema.parse(c.req.param("provider"));
    const workspaceId = c.req.query("workspaceId") ?? "default";
    const body = await c.req.json().catch(() => ({}));
    const errorMessage = (body as { errorMessage?: string }).errorMessage;

    const result = await handleRateLimit(workspaceId, provider, errorMessage);

    if (!result.success) {
      return sendError(
        c,
        "ROTATION_FAILED",
        result.reason ?? "Rate limit handling failed",
        503,
        {
          hint: "All accounts may be exhausted. Wait for cooldown or add more accounts.",
        },
      );
    }

    return sendResource(c, "rate_limit_result", result);
  } catch (error) {
    return handleError(error, c);
  }
});

export { accounts };
