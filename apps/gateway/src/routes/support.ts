/**
 * Support Bundle and Diagnostics Export Routes (bd-1efrp, bd-163rq, bd-pwca9)
 *
 * Endpoints:
 * - POST /support/bundles/preview - Manifest preview + size estimates
 * - POST /support/bundles - Generate sanitized support bundle
 * - GET /support/bundles/:id/status - Poll status & retention remaining
 * - GET /support/bundles/:id/download - Download sanitized bundle JSON
 * - POST /support/bundles/:id/replay - Run sanitized repro harness on bundle
 */

import { Hono } from "hono";
import { z } from "zod";
import type { AuthContext } from "../middleware/auth";
import { requireAdminMiddleware } from "../middleware/auth";
import {
  createSupportBundle,
  downloadSupportBundle,
  getSupportBundleStatus,
  previewSupportBundle,
  replaySupportBundle,
  type SupportBundleSource,
} from "../services/support-bundle.service";
import {
  sendCreated,
  sendError,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const SupportSourceEnum = z.enum([
  "build",
  "config",
  "health",
  "ws",
  "logs",
  "events",
  "jobs",
]);

const BundleOptionsSchema = z.object({
  includeSources: z.array(SupportSourceEnum).optional(),
  logLimit: z.number().int().min(1).max(2000).optional(),
  eventLimit: z.number().int().min(1).max(2000).optional(),
  retentionMinutes: z.number().int().min(1).max(10080).optional(),
  seedLogs: z.array(z.record(z.string(), z.unknown())).optional(),
  seedEvents: z.array(z.record(z.string(), z.unknown())).optional(),
  seedJobs: z.array(z.record(z.string(), z.unknown())).optional(),
  seedConfigOverride: z.record(z.string(), z.unknown()).optional(),
});

const support = new Hono<{ Variables: { auth?: AuthContext } }>();
support.use("*", requireAdminMiddleware());

support.post("/bundles/preview", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const parsed = BundleOptionsSchema.safeParse(body);
    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const preview = previewSupportBundle({
      ...parsed.data,
      includeSources: parsed.data.includeSources as
        | SupportBundleSource[]
        | undefined,
    });
    return sendResource(c, "support_bundle_preview", preview);
  } catch (error) {
    return sendError(
      c,
      "SUPPORT_BUNDLE_PREVIEW_FAILED",
      error instanceof Error ? error.message : "Failed to preview bundle",
      500,
    );
  }
});

support.post("/bundles", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const parsed = BundleOptionsSchema.safeParse(body);
    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const auth = c.get("auth") as AuthContext | undefined;
    const status = createSupportBundle({
      ...parsed.data,
      includeSources: parsed.data.includeSources as
        | SupportBundleSource[]
        | undefined,
      createdBy: auth?.userId ?? auth?.apiKeyId ?? "admin",
    });

    return sendCreated(
      c,
      "support_bundle",
      status,
      `/support/bundles/${status.id}/status`,
    );
  } catch (error) {
    return sendError(
      c,
      "SUPPORT_BUNDLE_CREATE_FAILED",
      error instanceof Error ? error.message : "Failed to create bundle",
      500,
    );
  }
});

support.get("/bundles/:id/status", (c) => {
  const id = c.req.param("id");
  const status = getSupportBundleStatus(id);
  if (!status) {
    return sendNotFound(c, "support_bundle", id);
  }
  return sendResource(c, "support_bundle_status", status);
});

support.get("/bundles/:id/download", (c) => {
  const id = c.req.param("id");
  const artifact = downloadSupportBundle(id);
  if (!artifact) {
    return sendNotFound(c, "support_bundle", id);
  }
  c.header(
    "Content-Disposition",
    `attachment; filename="flywheel-support-bundle-${id}.json"`,
  );
  return sendResource(c, "support_bundle_artifact", artifact);
});

support.post("/bundles/:id/replay", (c) => {
  const id = c.req.param("id");
  const artifact = downloadSupportBundle(id);
  if (!artifact) {
    return sendNotFound(c, "support_bundle", id);
  }

  try {
    const replay = replaySupportBundle(artifact);
    return sendResource(c, "support_bundle_replay", replay);
  } catch (error) {
    return sendError(
      c,
      "SUPPORT_BUNDLE_REPLAY_FAILED",
      error instanceof Error ? error.message : "Failed to replay bundle",
      400,
    );
  }
});

export { support };
