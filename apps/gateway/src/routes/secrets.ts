/**
 * Secrets & Redaction Routes (bd-d134v)
 *
 * REST endpoints for inspecting configured secrets providers, viewing secret
 * reference metadata (never secret values), rotating secret references, and
 * running the redaction pipeline with reporting.
 */

import { Hono } from "hono";
import { z } from "zod";
import { redactSensitiveDataWithReport } from "../services/audit-redaction.service";
import {
  getDefaultSecretsProvider,
  listSecretReferences,
  rotateSecretReference,
  validateSecretName,
} from "../services/secrets-provider.service";
import { sendList, sendResource, sendValidationError } from "../utils/response";
import { transformZodError } from "../utils/validation";

const secrets = new Hono();

const RotateSecretSchema = z.object({
  name: z.string().min(1),
  rotatedBy: z.string().optional(),
  reason: z.string().optional(),
});

const RedactPayloadSchema = z.object({
  payload: z.unknown(),
  budgetMs: z.number().positive().optional(),
  shadowMode: z.boolean().optional(),
});

/**
 * GET /secrets/providers - List configured secrets providers and key counts
 */
secrets.get("/providers", async (c) => {
  const composite = getDefaultSecretsProvider();
  const providers = composite.getProviders();

  const summaries = await Promise.all(
    providers.map(async (provider) => {
      const keys = await provider.list();
      return {
        name: provider.name,
        status: "available" as const,
        keyCount: keys.length,
      };
    }),
  );

  return sendList(c, summaries);
});

/**
 * GET /secrets/references - List secret references and rotation metadata (never values)
 */
secrets.get("/references", async (c) => {
  const prefix = c.req.query("prefix") ?? undefined;
  const references = await listSecretReferences(prefix);
  return sendList(c, references);
});

/**
 * POST /secrets/rotate - Rotate a secret reference and record rotation metadata
 */
secrets.post("/rotate", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = RotateSecretSchema.safeParse(body);
    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const validation = validateSecretName(parsed.data.name);
    if (!validation.valid) {
      return sendValidationError(c, [
        {
          path: "name",
          message: validation.error ?? "Invalid secret name",
        },
      ]);
    }

    const metadata = await rotateSecretReference(parsed.data.name, {
      ...(parsed.data.rotatedBy ? { rotatedBy: parsed.data.rotatedBy } : {}),
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    });

    return sendResource(c, "secret_rotation", metadata);
  } catch (err) {
    return sendValidationError(c, [
      {
        path: "body",
        message: err instanceof Error ? err.message : "Invalid request body",
      },
    ]);
  }
});

/**
 * POST /secrets/redact - Run the centralized redaction pipeline with report
 */
secrets.post("/redact", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = RedactPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const result = redactSensitiveDataWithReport(parsed.data.payload, {
      ...(parsed.data.budgetMs !== undefined
        ? { budgetMs: parsed.data.budgetMs }
        : {}),
      ...(parsed.data.shadowMode !== undefined
        ? { shadowMode: parsed.data.shadowMode }
        : {}),
    });

    return sendResource(c, "redaction_result", {
      redacted: result.data,
      report: result.report,
    });
  } catch (err) {
    return sendValidationError(c, [
      {
        path: "body",
        message: err instanceof Error ? err.message : "Invalid request body",
      },
    ]);
  }
});

export { secrets };
