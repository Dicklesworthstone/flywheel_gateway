/**
 * Account Routes - REST API endpoints for CAAM account management.
 *
 * Manages BYOA (Bring Your Own Account) profiles for AI providers.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getCorrelationId, getLogger } from "../middleware/correlation";
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

const accounts = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const ProviderSchema = z.enum(["claude", "codex", "gemini"]);
const AuthModeSchema = z.enum(["oauth_browser", "device_code", "api_key"]);

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

  log.error({ error }, "Unexpected error in accounts route");
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
// BYOA Status Routes
// ============================================================================

/**
 * GET /accounts/byoa-status - Get workspace BYOA readiness
 */
accounts.get("/byoa-status", async (c) => {
  try {
    const workspaceId = c.req.query("workspaceId") ?? "default";
    const status = await getByoaStatus(workspaceId);
    return c.json(status);
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
    const provider = c.req.query("provider") as ProviderId | undefined;
    const statusParam = c.req.query("status");
    const limitParam = c.req.query("limit");

    const result = await listProfiles({
      ...(workspaceId && { workspaceId }),
      ...(provider && { provider }),
      ...(statusParam && { status: statusParam.split(",") as any }),
      limit: limitParam ? parseInt(limitParam, 10) : undefined,
    });

    return c.json(result);
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
    const profile = await createProfile(validated);
    return c.json({ profile }, 201);
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
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: `Profile ${id} not found`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404,
      );
    }

    return c.json({ profile });
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
    const profile = await updateProfile(id, validated);

    if (!profile) {
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: `Profile ${id} not found`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404,
      );
    }

    return c.json({ profile });
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
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: `Profile ${id} not found`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404,
      );
    }

    return c.json({ deleted: true });
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
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: `Profile ${id} not found`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404,
      );
    }

    return c.json({ profile, activated: true });
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
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: `Profile ${id} not found`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404,
      );
    }

    return c.json({ profile, cooldownSet: true });
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

    return c.json({ challenge, profile }, 201);
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

    // In real implementation, this would verify the OAuth callback/device code
    // For now, mark the profile as verified
    const profile = await markVerified(profileId);

    if (!profile) {
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: `Profile ${profileId} not found`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404,
      );
    }

    return c.json({ profile, status: "linked" });
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
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: `Pool for ${provider} not found`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404,
      );
    }

    const nextProfile = await peekNextProfile(workspaceId, provider);

    return c.json({
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

    const result = await rotate(workspaceId, provider, reason ?? "Manual rotation");

    if (!result.success) {
      return c.json(
        {
          error: {
            code: "ROTATION_FAILED",
            message: result.reason,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        400,
      );
    }

    return c.json({ result });
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
      return c.json(
        {
          error: {
            code: "ROTATION_FAILED",
            message: result.reason,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
            hint: "All accounts may be exhausted. Wait for cooldown or add more accounts.",
          },
        },
        503,
      );
    }

    return c.json({ result });
  } catch (error) {
    return handleError(error, c);
  }
});

export { accounts };
