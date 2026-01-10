/**
 * Metrics Routes - REST API endpoints for metrics and monitoring.
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  getMetricsSnapshot,
  createNamedSnapshot,
  listNamedSnapshots,
  getNamedSnapshot,
  compareMetrics,
  exportPrometheusFormat,
} from "../services/metrics";

const metrics = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const CreateSnapshotSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

const CompareQuerySchema = z.object({
  baseline: z.string().min(1),
  current: z.string().min(1).optional(),
});

// ============================================================================
// Error Handler Helper
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
      400
    );
  }

  log.error({ error }, "Unexpected error in metrics route");
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        correlationId,
        timestamp: new Date().toISOString(),
      },
    },
    500
  );
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /metrics - Get current metrics snapshot
 */
metrics.get("/", (c) => {
  try {
    const snapshot = getMetricsSnapshot();
    return c.json({
      ...snapshot,
      timestamp: snapshot.timestamp.toISOString(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /metrics/prometheus - Prometheus-compatible metrics endpoint
 */
metrics.get("/prometheus", (c) => {
  try {
    const metricsText = exportPrometheusFormat();
    return c.text(metricsText, 200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /metrics/snapshot - Create a named snapshot
 */
metrics.post("/snapshot", async (c) => {
  try {
    const body = await c.req.json();
    const validated = CreateSnapshotSchema.parse(body);

    const snapshot = createNamedSnapshot(validated.name, validated.description);

    return c.json(
      {
        id: snapshot.id,
        name: snapshot.name,
        description: snapshot.description,
        createdAt: snapshot.createdAt.toISOString(),
      },
      201
    );
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /metrics/snapshots - List named snapshots
 */
metrics.get("/snapshots", (c) => {
  try {
    const snapshots = listNamedSnapshots();

    return c.json({
      snapshots: snapshots.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        createdAt: s.createdAt.toISOString(),
        createdBy: s.createdBy,
      })),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /metrics/snapshots/:snapshotId - Get a specific snapshot
 */
metrics.get("/snapshots/:snapshotId", (c) => {
  try {
    const snapshotId = c.req.param("snapshotId");
    const snapshot = getNamedSnapshot(snapshotId);

    if (!snapshot) {
      return c.json(
        {
          error: {
            code: "SNAPSHOT_NOT_FOUND",
            message: `Snapshot ${snapshotId} not found`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404
      );
    }

    return c.json({
      id: snapshot.id,
      name: snapshot.name,
      description: snapshot.description,
      createdAt: snapshot.createdAt.toISOString(),
      createdBy: snapshot.createdBy,
      snapshot: {
        ...snapshot.snapshot,
        timestamp: snapshot.snapshot.timestamp.toISOString(),
      },
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /metrics/compare - Compare metrics between periods or snapshots
 */
metrics.get("/compare", (c) => {
  try {
    const baselineId = c.req.query("baseline");
    const currentId = c.req.query("current");

    if (!baselineId) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "baseline query parameter is required",
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        400
      );
    }

    const baselineSnapshot = getNamedSnapshot(baselineId);
    if (!baselineSnapshot) {
      return c.json(
        {
          error: {
            code: "SNAPSHOT_NOT_FOUND",
            message: `Baseline snapshot ${baselineId} not found`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404
      );
    }

    // Use current snapshot if no currentId provided
    let currentSnapshot;
    if (currentId) {
      currentSnapshot = getNamedSnapshot(currentId);
      if (!currentSnapshot) {
        return c.json(
          {
            error: {
              code: "SNAPSHOT_NOT_FOUND",
              message: `Current snapshot ${currentId} not found`,
              correlationId: getCorrelationId(),
              timestamp: new Date().toISOString(),
            },
          },
          404
        );
      }
    }

    const currentData = currentSnapshot?.snapshot ?? getMetricsSnapshot();
    const comparison = compareMetrics(baselineSnapshot.snapshot, currentData);

    return c.json({
      baseline: {
        snapshotId: baselineId,
        period: {
          start: comparison.baseline.period.start.toISOString(),
          end: comparison.baseline.period.end.toISOString(),
        },
      },
      current: {
        snapshotId: currentId ?? "live",
        period: {
          start: comparison.current.period.start.toISOString(),
          end: comparison.current.period.end.toISOString(),
        },
      },
      changes: comparison.changes,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

export { metrics };
