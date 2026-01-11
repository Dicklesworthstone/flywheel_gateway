/**
 * Metrics Routes - REST API endpoints for metrics and monitoring.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import type { NamedSnapshot } from "../models/metrics";
import {
  compareMetrics,
  createNamedSnapshot,
  exportPrometheusFormat,
  getMetricsSnapshot,
  getNamedSnapshot,
  listNamedSnapshots,
} from "../services/metrics";
import {
  sendCreated,
  sendError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
  sendInternalError,
} from "../utils/response";

const metrics = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const CreateSnapshotSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

// ============================================================================
// Error Handler Helper
// ============================================================================

function handleError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof z.ZodError) {
    const validationErrors = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));
    return sendValidationError(c, validationErrors);
  }

  log.error({ error }, "Unexpected error in metrics route");
  return sendInternalError(c);
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
    return sendResource(c, "metrics", {
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

    const snapshotData = {
      id: snapshot.id,
      name: snapshot.name,
      description: snapshot.description,
      createdAt: snapshot.createdAt.toISOString(),
    };

    return sendCreated(c, "snapshot", snapshotData, `/metrics/snapshots/${snapshot.id}`);
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

    const items = snapshots.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      createdAt: s.createdAt.toISOString(),
      createdBy: s.createdBy,
    }));

    return sendList(c, items, { total: items.length });
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
      return sendNotFound(c, "snapshot", snapshotId);
    }

    const snapshotData = {
      id: snapshot.id,
      name: snapshot.name,
      description: snapshot.description,
      createdAt: snapshot.createdAt.toISOString(),
      createdBy: snapshot.createdBy,
      snapshot: {
        ...snapshot.snapshot,
        timestamp: snapshot.snapshot.timestamp.toISOString(),
      },
    };

    return sendResource(c, "snapshot", snapshotData);
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
      return sendError(c, "INVALID_REQUEST", "baseline query parameter is required", 400);
    }

    const baselineSnapshot = getNamedSnapshot(baselineId);
    if (!baselineSnapshot) {
      return sendNotFound(c, "snapshot", baselineId);
    }

    // Use current snapshot if no currentId provided
    let currentSnapshot: NamedSnapshot | undefined;
    if (currentId) {
      currentSnapshot = getNamedSnapshot(currentId);
    } else {
      currentSnapshot = {
        id: "current",
        name: "Current",
        createdAt: new Date(),
        snapshot: getMetricsSnapshot(),
      };
    }

    const currentData = currentSnapshot?.snapshot ?? getMetricsSnapshot();
    const comparison = compareMetrics(baselineSnapshot.snapshot, currentData);

    const comparisonData = {
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
    };

    return sendResource(c, "comparison", comparisonData);
  } catch (error) {
    return handleError(error, c);
  }
});

export { metrics };
