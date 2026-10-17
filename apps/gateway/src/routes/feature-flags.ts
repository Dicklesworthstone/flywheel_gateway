/**
 * Feature Flag System Routes (bd-1kij1)
 *
 * Endpoints:
 * - GET /feature-flags - List feature flags
 * - POST /feature-flags - Create/upsert feature flag
 * - POST /feature-flags/:key/kill-switch - Toggle emergency kill switch
 * - POST /feature-flags/:key/evaluate - Evaluate flag for user/workspace/cohort
 * - GET /feature-flags/:key/metrics - Get evaluation metrics for flag
 */

import { Hono } from "hono";
import { z } from "zod";
import { requireAdminMiddleware } from "../middleware/auth";
import {
  evaluateFeatureFlag,
  getFeatureFlagMetrics,
  listFeatureFlags,
  setFeatureFlagKillSwitch,
  UpsertFeatureFlagSchema,
  upsertFeatureFlag,
} from "../services/feature-flag.service";
import {
  sendCreated,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const featureFlags = new Hono();
featureFlags.use("*", requireAdminMiddleware());

const KillSwitchBodySchema = z.object({
  killSwitch: z.boolean(),
});

const EvaluateFlagBodySchema = z.object({
  userId: z.string().optional(),
  workspaceId: z.string().optional(),
  cohorts: z.array(z.string()).optional(),
});

featureFlags.get("/", (c) => {
  const flags = listFeatureFlags();
  return sendList(c, flags, { total: flags.length });
});

featureFlags.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = UpsertFeatureFlagSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const flag = upsertFeatureFlag(parsed.data);
  return sendCreated(c, "feature_flag", flag, `/feature-flags/${flag.key}`);
});

featureFlags.post("/:key/kill-switch", async (c) => {
  const key = c.req.param("key");
  const body = await c.req.json().catch(() => null);
  const parsed = KillSwitchBodySchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const updated = setFeatureFlagKillSwitch(key, parsed.data.killSwitch);
  if (!updated) return sendNotFound(c, "feature_flag", key);
  return sendResource(c, "feature_flag", updated);
});

featureFlags.post("/:key/evaluate", async (c) => {
  const key = c.req.param("key");
  const body = await c.req.json().catch(() => ({}));
  const parsed = EvaluateFlagBodySchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const result = evaluateFeatureFlag(key, parsed.data);
  return sendResource(c, "feature_flag_evaluation", result);
});

featureFlags.get("/:key/metrics", (c) => {
  const key = c.req.param("key");
  return sendResource(c, "feature_flag_metrics", getFeatureFlagMetrics(key));
});

export { featureFlags };
