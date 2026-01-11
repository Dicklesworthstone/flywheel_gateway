/**
 * Beads Routes - REST API endpoints for BV-backed triage.
 */

import { BvClientError } from "@flywheel/flywheel-clients";
import type { GatewayError } from "@flywheel/shared/errors";
import {
  createGatewayError,
  serializeGatewayError,
  toGatewayError,
} from "@flywheel/shared/errors";
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  type BeadsService,
  createBeadsService,
} from "../services/beads.service";

const beads = new Hono<{ Variables: { beadsService: BeadsService } }>();

function respondWithGatewayError(c: Context, error: GatewayError) {
  const correlationId = getCorrelationId();
  const timestamp = new Date().toISOString();
  const payload = serializeGatewayError(error);
  return c.json(
    {
      error: {
        code: payload.code,
        message: payload.message,
        correlationId,
        timestamp,
        ...(payload.details && { details: payload.details }),
      },
    },
    payload.httpStatus as ContentfulStatusCode,
  );
}

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

  if (error instanceof BvClientError) {
    const mapped = createGatewayError(
      "SYSTEM_UNAVAILABLE",
      "BV command failed",
      {
        details: { kind: error.kind, ...error.details },
        cause: error,
      },
    );
    return respondWithGatewayError(c, mapped);
  }

  log.error({ error }, "Unexpected error in beads route");
  return respondWithGatewayError(c, toGatewayError(error));
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed < 1 ? undefined : parsed;
}

function parseScore(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function createBeadsRoutes(service?: BeadsService) {
  const router = new Hono<{ Variables: { beadsService: BeadsService } }>();
  let cachedService = service;

  router.use("*", async (c, next) => {
    if (!cachedService) {
      cachedService = createBeadsService();
    }
    c.set("beadsService", cachedService);
    await next();
  });

  /**
   * GET /beads/triage - BV triage output
   */
  router.get("/triage", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");
      const triage = await serviceInstance.getTriage();
      const limit = parseLimit(c.req.query("limit"));
      const minScore = parseScore(c.req.query("minScore"));
      if (limit || minScore !== undefined) {
        const filtered = triage.triage.recommendations?.filter((rec) =>
          minScore !== undefined ? rec.score >= minScore : true,
        );
        const sliced = limit ? filtered?.slice(0, limit) : filtered;
        return c.json({
          ...triage,
          triage: {
            ...triage.triage,
            recommendations: sliced ?? [],
          },
        });
      }
      return c.json(triage);
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * GET /beads/ready - BV quick wins
   */
  router.get("/ready", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");
      const triage = await serviceInstance.getTriage();
      const limit = parseLimit(c.req.query("limit"));
      const beads = triage.triage.quick_wins ?? [];
      return c.json({ beads: limit ? beads.slice(0, limit) : beads });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * GET /beads/blocked - BV blockers to clear
   */
  router.get("/blocked", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");
      const triage = await serviceInstance.getTriage();
      const limit = parseLimit(c.req.query("limit"));
      const beads = triage.triage.blockers_to_clear ?? [];
      return c.json({ beads: limit ? beads.slice(0, limit) : beads });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * GET /beads/insights - BV graph insights
   */
  router.get("/insights", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");
      const insights = await serviceInstance.getInsights();
      return c.json(insights);
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * GET /beads/plan - BV plan output
   */
  router.get("/plan", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");
      const plan = await serviceInstance.getPlan();
      return c.json(plan);
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * POST /beads/sync - Run bd sync
   */
  router.post("/sync", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");
      const result = await serviceInstance.syncBeads();
      if (result.exitCode !== 0) {
        const mapped = createGatewayError(
          "SYSTEM_UNAVAILABLE",
          "Beads sync failed",
          {
            details: {
              exitCode: result.exitCode,
              stderr: result.stderr,
            },
          },
        );
        return respondWithGatewayError(c, mapped);
      }
      return c.json({
        status: "ok",
        exitCode: result.exitCode,
        stdout: result.stdout,
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  return router;
}

const beadsRoutes = createBeadsRoutes();

export { beadsRoutes as beads, createBeadsRoutes };
