/**
 * Smart Retry with Backoff Profiles Routes (bd-m4fk1)
 *
 * Endpoints:
 * - GET /retry-profiles - List built-in and custom retry profiles
 * - POST /retry-profiles - Create a custom retry profile
 * - POST /retry-profiles/:id/simulate - Simulate delay sequence for a profile
 * - GET /retry-profiles/metrics - Get retry execution metrics
 */

import { Hono } from "hono";
import { z } from "zod";
import { requireAdminMiddleware } from "../middleware/auth";
import {
  CreateRetryProfileSchema,
  createRetryProfile,
  getRetryMetrics,
  listRetryProfiles,
  simulateRetryDelays,
} from "../services/smart-retry.service";
import {
  sendCreated,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const retryProfiles = new Hono();
retryProfiles.use("*", requireAdminMiddleware());

const SimulateBodySchema = z.object({
  attempts: z.number().int().min(1).max(20).optional(),
});

retryProfiles.get("/", (c) => {
  const profiles = listRetryProfiles();
  return sendList(c, profiles, { total: profiles.length });
});

retryProfiles.get("/metrics", (c) => {
  return sendResource(c, "retry_metrics", getRetryMetrics());
});

retryProfiles.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CreateRetryProfileSchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const created = createRetryProfile(parsed.data);
  return sendCreated(
    c,
    "retry_profile",
    created,
    `/retry-profiles/${created.id}`,
  );
});

retryProfiles.post("/:id/simulate", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = SimulateBodySchema.safeParse(body);
  if (!parsed.success) {
    return sendValidationError(c, transformZodError(parsed.error));
  }

  const sim = simulateRetryDelays(id, parsed.data.attempts);
  if (!sim) return sendNotFound(c, "retry_profile", id);
  return sendResource(c, "retry_simulation", sim);
});

export { retryProfiles };
