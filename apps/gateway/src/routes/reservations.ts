/**
 * Reservations Routes - REST API endpoints for File Reservation System.
 *
 * Provides endpoints for creating, checking, releasing, renewing, and listing
 * file reservations. Used by agents to coordinate file access and prevent
 * edit conflicts.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  checkReservation,
  createReservation,
  getReservation,
  getReservationStats,
  listReservations,
  listConflicts,
  resolveConflict,
  type ReservationMode,
  releaseReservation,
  renewReservation,
} from "../services/reservation.service";

const reservations = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const CreateReservationSchema = z.object({
  projectId: z.string().min(1),
  agentId: z.string().min(1),
  patterns: z.array(z.string().min(1)).min(1).max(100),
  mode: z.enum(["exclusive", "shared"]),
  ttl: z.number().min(1).max(3600).optional(),
  reason: z.string().max(500).optional(),
  taskId: z.string().optional(),
});

const CheckReservationSchema = z.object({
  projectId: z.string().min(1),
  agentId: z.string().min(1),
  filePath: z.string().min(1),
});

const ReleaseReservationSchema = z.object({
  agentId: z.string().min(1),
});

const RenewReservationSchema = z.object({
  agentId: z.string().min(1),
  additionalTtl: z.number().min(1).max(3600).optional(),
});

const ListReservationsQuerySchema = z.object({
  projectId: z.string().min(1),
  agentId: z.string().optional(),
  filePath: z.string().optional(),
});

const ListConflictsQuerySchema = z.object({
  projectId: z.string().min(1),
  status: z.enum(["open", "resolved"]).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

const ResolveConflictSchema = z.object({
  resolvedBy: z.string().min(1).optional(),
  reason: z.string().min(1).max(200).optional(),
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

  log.error({ error }, "Unexpected error in reservations route");
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
// Create Reservation
// ============================================================================

/**
 * POST /reservations - Create a new file reservation
 *
 * Creates a reservation for the specified glob patterns. Returns conflicts
 * if the reservation cannot be granted due to overlapping exclusive reservations.
 */
reservations.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const validated = CreateReservationSchema.parse(body);

    const result = await createReservation({
      projectId: validated.projectId,
      agentId: validated.agentId,
      patterns: validated.patterns,
      mode: validated.mode as ReservationMode,
      ttl: validated.ttl,
      reason: validated.reason,
      taskId: validated.taskId,
    });

    if (!result.granted) {
      return c.json(
        {
          granted: false,
          conflicts: result.conflicts.map((conflict) => ({
            conflictId: conflict.conflictId,
            overlappingPattern: conflict.overlappingPattern,
            existingReservation: {
              id: conflict.existingReservation.id,
              requesterId: conflict.existingReservation.requesterId,
              patterns: conflict.existingReservation.patterns,
              expiresAt: conflict.existingReservation.expiresAt.toISOString(),
            },
            requestedPatterns: conflict.requestedPatterns,
            resolutions: conflict.resolutions,
          })),
          correlationId: getCorrelationId(),
        },
        409,
      );
    }

    return c.json(
      {
        granted: true,
        reservation: {
          id: result.reservation!.id,
          projectId: result.reservation!.projectId,
          agentId: result.reservation!.agentId,
          patterns: result.reservation!.patterns,
          mode: result.reservation!.mode,
          ttl: result.reservation!.ttl,
          createdAt: result.reservation!.createdAt.toISOString(),
          expiresAt: result.reservation!.expiresAt.toISOString(),
          renewCount: result.reservation!.renewCount,
          metadata: result.reservation!.metadata,
        },
        correlationId: getCorrelationId(),
      },
      201,
    );
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Check Reservation
// ============================================================================

/**
 * POST /reservations/check - Check if an agent can access a file
 *
 * Checks if the specified agent has access to the given file path based on
 * current active reservations.
 */
reservations.post("/check", async (c) => {
  try {
    const body = await c.req.json();
    const validated = CheckReservationSchema.parse(body);

    const result = await checkReservation({
      projectId: validated.projectId,
      agentId: validated.agentId,
      filePath: validated.filePath,
    });

    return c.json({
      allowed: result.allowed,
      heldBy: result.heldBy,
      expiresAt: result.expiresAt?.toISOString(),
      mode: result.mode,
      reservationId: result.reservationId,
      correlationId: getCorrelationId(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Statistics (must be before /:id to avoid matching "stats" as an ID)
// ============================================================================

/**
 * GET /reservations/stats - Get reservation statistics
 */
reservations.get("/stats", async (c) => {
  try {
    const stats = getReservationStats();
    return c.json({
      stats,
      correlationId: getCorrelationId(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Conflict Listing
// ============================================================================

/**
 * GET /reservations/conflicts - List conflicts for a project
 */
reservations.get("/conflicts", async (c) => {
  try {
    const query = ListConflictsQuerySchema.parse({
      projectId: c.req.query("projectId"),
      status: c.req.query("status"),
      limit: c.req.query("limit"),
    });

    const results = await listConflicts({
      projectId: query.projectId,
      status: query.status,
      limit: query.limit,
    });

    return c.json({
      conflicts: results.map((conflict) => ({
        conflictId: conflict.conflictId,
        projectId: conflict.projectId,
        type: conflict.type,
        status: conflict.status,
        detectedAt: conflict.detectedAt.toISOString(),
        resolvedAt: conflict.resolvedAt?.toISOString(),
        requesterId: conflict.requesterId,
        existingReservationId: conflict.existingReservationId,
        overlappingPattern: conflict.overlappingPattern,
        resolutionReason: conflict.resolutionReason,
        resolvedBy: conflict.resolvedBy,
        conflict: {
          conflictId: conflict.conflict.conflictId,
          overlappingPattern: conflict.conflict.overlappingPattern,
          existingReservation: {
            id: conflict.conflict.existingReservation.id,
            requesterId: conflict.conflict.existingReservation.requesterId,
            patterns: conflict.conflict.existingReservation.patterns,
            expiresAt:
              conflict.conflict.existingReservation.expiresAt.toISOString(),
          },
          requestedPatterns: conflict.conflict.requestedPatterns,
          resolutions: conflict.conflict.resolutions,
          detectedAt: conflict.conflict.detectedAt.toISOString(),
        },
      })),
      count: results.length,
      correlationId: getCorrelationId(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Resolve Conflict
// ============================================================================

/**
 * POST /reservations/conflicts/:id/resolve - Resolve a conflict
 */
reservations.post("/conflicts/:id/resolve", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const validated = ResolveConflictSchema.parse(body);

    const result = await resolveConflict({
      conflictId: id,
      resolvedBy: validated.resolvedBy,
      reason: validated.reason,
    });

    if (!result.resolved) {
      return c.json(
        {
          error: {
            code: "CONFLICT_NOT_FOUND",
            message: result.error ?? "Conflict not found",
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404,
      );
    }

    return c.json({
      resolved: true,
      conflictId: id,
      resolvedAt: result.conflict?.resolvedAt?.toISOString(),
      correlationId: getCorrelationId(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// List Reservations
// ============================================================================

/**
 * GET /reservations - List reservations with optional filters
 *
 * Lists all active reservations for a project. Can filter by agent ID
 * or by a specific file path.
 */
reservations.get("/", async (c) => {
  try {
    const query = ListReservationsQuerySchema.parse({
      projectId: c.req.query("projectId"),
      agentId: c.req.query("agentId"),
      filePath: c.req.query("filePath"),
    });

    const results = await listReservations({
      projectId: query.projectId,
      agentId: query.agentId,
      filePath: query.filePath,
    });

    return c.json({
      reservations: results.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        agentId: r.agentId,
        patterns: r.patterns,
        mode: r.mode,
        ttl: r.ttl,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        renewCount: r.renewCount,
        metadata: r.metadata,
      })),
      count: results.length,
      correlationId: getCorrelationId(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Get Single Reservation
// ============================================================================

/**
 * GET /reservations/:id - Get a specific reservation
 */
reservations.get("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const reservation = await getReservation(id);

    if (!reservation) {
      return c.json(
        {
          error: {
            code: "RESERVATION_NOT_FOUND",
            message: `Reservation ${id} not found or expired`,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        404,
      );
    }

    return c.json({
      reservation: {
        id: reservation.id,
        projectId: reservation.projectId,
        agentId: reservation.agentId,
        patterns: reservation.patterns,
        mode: reservation.mode,
        ttl: reservation.ttl,
        createdAt: reservation.createdAt.toISOString(),
        expiresAt: reservation.expiresAt.toISOString(),
        renewCount: reservation.renewCount,
        metadata: reservation.metadata,
      },
      correlationId: getCorrelationId(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Release Reservation
// ============================================================================

/**
 * DELETE /reservations/:id - Release a reservation
 *
 * Releases the specified reservation. The agent ID must match the reservation
 * holder.
 */
reservations.delete("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const validated = ReleaseReservationSchema.parse(body);

    const result = await releaseReservation({
      reservationId: id,
      agentId: validated.agentId,
    });

    if (!result.released) {
      const status = result.error === "Reservation not found" ? 404 : 403;
      return c.json(
        {
          error: {
            code: status === 404 ? "RESERVATION_NOT_FOUND" : "FORBIDDEN",
            message: result.error,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        status,
      );
    }

    return c.json({
      released: true,
      reservationId: id,
      correlationId: getCorrelationId(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

// ============================================================================
// Renew Reservation
// ============================================================================

/**
 * POST /reservations/:id/renew - Renew a reservation
 *
 * Extends the TTL of an existing reservation. The agent ID must match the
 * reservation holder. Maximum 10 renewals allowed per reservation.
 */
reservations.post("/:id/renew", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const validated = RenewReservationSchema.parse(body);

    const result = await renewReservation({
      reservationId: id,
      agentId: validated.agentId,
      additionalTtl: validated.additionalTtl,
    });

    if (!result.renewed) {
      const errorCode =
        result.error === "Reservation not found"
          ? "RESERVATION_NOT_FOUND"
          : result.error?.includes("Maximum renewals")
            ? "RENEWAL_LIMIT_EXCEEDED"
            : "FORBIDDEN";
      const status =
        result.error === "Reservation not found"
          ? 404
          : result.error?.includes("Maximum renewals")
            ? 400
            : 403;

      return c.json(
        {
          error: {
            code: errorCode,
            message: result.error,
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        status,
      );
    }

    return c.json({
      renewed: true,
      reservationId: id,
      newExpiresAt: result.newExpiresAt?.toISOString(),
      correlationId: getCorrelationId(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

export { reservations };
