/**
 * Configuration Management Routes (bd-1t3b4, bd-2ufn8)
 *
 * Endpoints:
 * - GET /config - Get current sanitized configuration
 * - PATCH /config - Hot-reload configuration at runtime with version tracking
 * - GET /config/explain?key=... - Explain effective value, source layer, and hot-reload status (no secrets)
 * - GET /config/history - List configuration version history
 * - POST /config/rollback - Roll back configuration to a previous version
 */

import { Hono } from "hono";
import { z } from "zod";
import type { AuthContext } from "../middleware/auth";
import { requireAdminMiddleware } from "../middleware/auth";
import { redactSensitiveData } from "../services/audit-redaction.service";
import {
  explainConfigKey,
  type FlywheelConfig,
  getConfig,
  getConfigVersionHistory,
  rollbackConfigVersion,
  updateConfigRuntime,
} from "../services/config.service";
import {
  sendError,
  sendList,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const UpdateConfigBodySchema = z.object({
  patch: z.record(z.string(), z.unknown()),
  reason: z.string().optional(),
});

const RollbackBodySchema = z.object({
  version: z.number().int().min(1),
  reason: z.string().optional(),
});

const configRoutes = new Hono<{ Variables: { auth?: AuthContext } }>();
configRoutes.use("*", requireAdminMiddleware());

configRoutes.get("/", (c) => {
  const current = redactSensitiveData(getConfig());
  return sendResource(c, "config", current);
});

configRoutes.get("/explain", (c) => {
  const key = c.req.query("key")?.trim();
  if (!key) {
    return sendError(
      c,
      "INVALID_REQUEST",
      "Query parameter 'key' is required",
      400,
    );
  }

  const explanation = explainConfigKey(key);
  return sendResource(c, "config_explanation", explanation);
});

configRoutes.get("/history", (c) => {
  const history = getConfigVersionHistory().map((entry) => ({
    ...entry,
    snapshot: redactSensitiveData(entry.snapshot),
  }));
  return sendList(c, history, { total: history.length });
});

configRoutes.patch("/", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = UpdateConfigBodySchema.safeParse(body);
    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const auth = c.get("auth") as AuthContext | undefined;
    const result = updateConfigRuntime(
      parsed.data.patch as Partial<FlywheelConfig>,
      {
        changedBy: auth?.userId ?? auth?.apiKeyId ?? "admin",
        ...(parsed.data.reason !== undefined && { reason: parsed.data.reason }),
      },
    );

    return sendResource(c, "config_update", {
      ...result,
      config: redactSensitiveData(result.config),
    });
  } catch (error) {
    return sendError(
      c,
      "CONFIG_VALIDATION_FAILED",
      error instanceof Error ? error.message : "Configuration update failed",
      400,
    );
  }
});

configRoutes.post("/rollback", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = RollbackBodySchema.safeParse(body);
    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const auth = c.get("auth") as AuthContext | undefined;
    const result = rollbackConfigVersion(parsed.data.version, {
      rolledBackBy: auth?.userId ?? auth?.apiKeyId ?? "admin",
      ...(parsed.data.reason !== undefined && { reason: parsed.data.reason }),
    });

    return sendResource(c, "config_rollback", {
      ...result,
      config: redactSensitiveData(result.config),
    });
  } catch (error) {
    return sendError(
      c,
      "CONFIG_ROLLBACK_FAILED",
      error instanceof Error ? error.message : "Configuration rollback failed",
      400,
    );
  }
});

export { configRoutes };
