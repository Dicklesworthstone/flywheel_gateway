/**
 * Reservations Routes - REST API endpoints for File Reservation System.
 *
 * Provides endpoints for creating, checking, releasing, renewing, and listing
 * file reservations. Used by agents to coordinate file access and prevent
 * edit conflicts.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import {
  type CreateReservationParams,
  checkReservation,
  createReservation,
  getReservation,
  getReservationStats,
  type ListConflictsParams,
  type ListReservationsParams,
  listConflicts,
  listReservations,
  type RenewReservationParams,
  type ReservationMode,
  type ResolveConflictParams,
  releaseReservation,
  renewReservation,
  resolveConflict,
} from "../services/reservation.service";
import {
  conflictLinks,
  getLinkContext,
  reservationLinks,
} from "../utils/links";
import {
  sendConflict,
  sendCreated,
  sendError,
  sendForbidden,
  sendInternalError,
  sendList,
  sendNoContent,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

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
  limit: z.coerce.number().int().min(1).max(100).optional(),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const ListConflictsQuerySchema = z.object({
  projectId: z.string().min(1),
  status: z.enum(["open", "resolved"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
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

  if (error instanceof z.ZodError) {
    return sendValidationError(c, transformZodError(error));
  }

  log.error({ error }, "Unexpected error in reservations route");
  return sendInternalError(c);
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

    // Build params conditionally (for exactOptionalPropertyTypes)
    const params: CreateReservationParams = {
      projectId: validated.projectId,
      agentId: validated.agentId,
      patterns: validated.patterns,
      mode: validated.mode as ReservationMode,
    };
    if (validated.ttl !== undefined) params.ttl = validated.ttl;
    if (validated.reason !== undefined) params.reason = validated.reason;
    if (validated.taskId !== undefined) params.taskId = validated.taskId;

    const result = await createReservation(params);

    if (!result.granted) {
      return sendConflict(
        c,
        "RESERVATION_CONFLICT",
        "Reservation cannot be granted due to conflicting exclusive reservations",
        {
          details: {
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
          },
        },
      );
    }

    const reservation = result.reservation!;
    const ctx = getLinkContext(c);
    return sendCreated(
      c,
      "reservation",
      {
        granted: true,
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
        links: reservationLinks({ id: reservation.id }, ctx),
      },
      `/reservations/${reservation.id}`,
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

    return sendResource(c, "reservation_check", {
      allowed: result.allowed,
      heldBy: result.heldBy,
      expiresAt: result.expiresAt?.toISOString(),
      mode: result.mode,
      reservationId: result.reservationId,
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
    return sendResource(c, "reservation_stats", stats);
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
      starting_after: c.req.query("starting_after"),
      ending_before: c.req.query("ending_before"),
    });

    // Build params conditionally (for exactOptionalPropertyTypes)
    const conflictParams: ListConflictsParams = {
      projectId: query.projectId,
    };
    if (query.status !== undefined) conflictParams.status = query.status;
    if (query.limit !== undefined) conflictParams.limit = query.limit;
    if (query.starting_after !== undefined)
      conflictParams.startingAfter = query.starting_after;
    if (query.ending_before !== undefined)
      conflictParams.endingBefore = query.ending_before;

    const result = await listConflicts(conflictParams);
    const ctx = getLinkContext(c);

    const conflicts = result.conflicts.map((conflict) => ({
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
      links: conflictLinks({ id: conflict.conflictId }, ctx),
    }));

    // Build pagination meta conditionally (for exactOptionalPropertyTypes)
    const conflictsMeta: {
      hasMore: boolean;
      nextCursor?: string;
      prevCursor?: string;
    } = {
      hasMore: result.hasMore,
    };
    if (result.nextCursor) conflictsMeta.nextCursor = result.nextCursor;
    if (result.prevCursor) conflictsMeta.prevCursor = result.prevCursor;

    return sendList(c, conflicts, conflictsMeta);
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

    // Build params conditionally (for exactOptionalPropertyTypes)
    const resolveParams: ResolveConflictParams = {
      conflictId: id,
    };
    if (validated.resolvedBy !== undefined)
      resolveParams.resolvedBy = validated.resolvedBy;
    if (validated.reason !== undefined) resolveParams.reason = validated.reason;

    const result = await resolveConflict(resolveParams);

    if (!result.resolved) {
      return sendNotFound(c, "conflict", id);
    }

    const ctx = getLinkContext(c);
    return sendResource(
      c,
      "conflict_resolution",
      {
        resolved: true,
        conflictId: id,
        resolvedAt: result.conflict?.resolvedAt?.toISOString(),
      },
      200,
      { links: { self: `${ctx.baseUrl}/reservations/conflicts/${id}` } },
    );
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
      limit: c.req.query("limit"),
      starting_after: c.req.query("starting_after"),
      ending_before: c.req.query("ending_before"),
    });

    // Build params conditionally (for exactOptionalPropertyTypes)
    const listParams: ListReservationsParams = {
      projectId: query.projectId,
    };
    if (query.agentId !== undefined) listParams.agentId = query.agentId;
    if (query.filePath !== undefined) listParams.filePath = query.filePath;
    if (query.limit !== undefined) listParams.limit = query.limit;
    if (query.starting_after !== undefined)
      listParams.startingAfter = query.starting_after;
    if (query.ending_before !== undefined)
      listParams.endingBefore = query.ending_before;

    const result = await listReservations(listParams);
    const ctx = getLinkContext(c);

    const reservations_data = result.reservations.map((r) => ({
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
      links: { self: `${ctx.baseUrl}/reservations/${r.id}` },
    }));

    // Build pagination meta conditionally (for exactOptionalPropertyTypes)
    const listMeta: {
      hasMore: boolean;
      nextCursor?: string;
      prevCursor?: string;
    } = {
      hasMore: result.hasMore,
    };
    if (result.nextCursor) listMeta.nextCursor = result.nextCursor;
    if (result.prevCursor) listMeta.prevCursor = result.prevCursor;

    return sendList(c, reservations_data, listMeta);
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
      return sendNotFound(c, "reservation", id);
    }

    const ctx = getLinkContext(c);
    return sendResource(
      c,
      "reservation",
      {
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
      200,
      { links: reservationLinks({ id: reservation.id }, ctx) },
    );
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
 *
 * Agent ID can be provided via:
 * - X-Agent-Id header (preferred)
 * - Request body (deprecated, for backwards compatibility)
 */
reservations.delete("/:id", async (c) => {
  const log = getLogger();

  try {
    const id = c.req.param("id");

    // Try header first (preferred method)
    let agentId = c.req.header("X-Agent-Id");

    // Fall back to body for backwards compatibility
    if (!agentId) {
      try {
        const body = await c.req.json();
        const validated = ReleaseReservationSchema.parse(body);
        agentId = validated.agentId;

        // Log deprecation warning
        log.warn(
          { reservationId: id },
          "DEPRECATED: agentId in DELETE body, use X-Agent-Id header instead",
        );
      } catch {
        // No body or invalid body, that's fine if header is provided
        log.debug(
          { reservationId: id },
          "DELETE body parsing skipped, using header",
        );
      }
    }

    if (!agentId) {
      return sendError(
        c,
        "MISSING_AGENT_ID",
        "X-Agent-Id header is required",
        400,
        {
          hint: "Provide the agent ID via X-Agent-Id header for authorization",
          example: { header: "X-Agent-Id: agent-123" },
        },
      );
    }

    const result = await releaseReservation({
      reservationId: id,
      agentId,
    });

    if (!result.released) {
      if (result.error === "Reservation not found") {
        return sendNotFound(c, "reservation", id);
      }
      return sendForbidden(c, result.error);
    }

    return sendNoContent(c);
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

    // Build params conditionally (for exactOptionalPropertyTypes)
    const renewParams: RenewReservationParams = {
      reservationId: id,
      agentId: validated.agentId,
    };
    if (validated.additionalTtl !== undefined)
      renewParams.additionalTtl = validated.additionalTtl;

    const result = await renewReservation(renewParams);

    if (!result.renewed) {
      if (result.error === "Reservation not found") {
        return sendNotFound(c, "reservation", id);
      }
      if (result.error?.includes("Maximum renewals")) {
        return sendError(c, "RENEWAL_LIMIT_EXCEEDED", result.error, 400);
      }
      return sendForbidden(c, result.error);
    }

    const ctx = getLinkContext(c);
    return sendResource(
      c,
      "renewal_result",
      {
        renewed: true,
        reservationId: id,
        newExpiresAt: result.newExpiresAt?.toISOString(),
      },
      200,
      { links: reservationLinks({ id }, ctx) },
    );
  } catch (error) {
    return handleError(error, c);
  }
});

export { reservations };
