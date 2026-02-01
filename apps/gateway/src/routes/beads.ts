/**
 * Beads Routes - REST API endpoints for BV-backed triage and BR CRUD.
 */

import {
  BrClientError,
  type BrCreateInput,
  type BrUpdateInput,
  BvClientError,
} from "@flywheel/flywheel-clients";
import type { GatewayError } from "@flywheel/shared/errors";
import {
  createGatewayError,
  serializeGatewayError,
  toGatewayError,
} from "@flywheel/shared/errors";
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { requireAdminMiddleware } from "../middleware/auth";
import { getLogger } from "../middleware/correlation";
import {
  type BeadsService,
  createBeadsService,
} from "../services/beads.service";
import { beadLinks, beadThreadingHints, getLinkContext } from "../utils/links";
import {
  sendError,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

// ============================================================================
// Request Body Schemas
// ============================================================================

const CreateBeadSchema = z.object({
  title: z.string().optional(),
  type: z.string().optional(),
  priority: z.union([z.number(), z.string()]).optional(),
  description: z.string().optional(),
  assignee: z.string().optional(),
  owner: z.string().optional(),
  labels: z.array(z.string()).optional(),
  parent: z.string().optional(),
  deps: z.union([z.array(z.string()), z.string()]).optional(),
  estimateMinutes: z.number().optional(),
  due: z.string().optional(),
  defer: z.string().optional(),
  externalRef: z.string().optional(),
});

const UpdateBeadSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  design: z.string().optional(),
  acceptanceCriteria: z.string().optional(),
  notes: z.string().optional(),
  status: z.string().optional(),
  priority: z.union([z.number(), z.string()]).optional(),
  type: z.string().optional(),
  assignee: z.string().optional(),
  owner: z.string().optional(),
  claim: z.boolean().optional(),
  due: z.string().optional(),
  defer: z.string().optional(),
  estimateMinutes: z.number().optional(),
  addLabels: z.array(z.string()).optional(),
  removeLabels: z.array(z.string()).optional(),
  setLabels: z.array(z.string()).optional(),
  parent: z.string().optional(),
  externalRef: z.string().optional(),
});

const CloseBeadSchema = z.object({
  reason: z.string().optional(),
  force: z.boolean().optional(),
});

/**
 * Query parameter schema for GET /beads (list endpoint).
 * Documents all supported filters with validation.
 * Part of bd-2l4h: Beads API parity with br list/filter/pagination.
 */
const _ListBeadsQuerySchema = z.object({
  // Status filters (can be repeated)
  status: z.union([z.string(), z.array(z.string())]).optional(),
  // Type filters (can be repeated)
  type: z.union([z.string(), z.array(z.string())]).optional(),
  // Assignee filter
  assignee: z.string().optional(),
  // Only unassigned issues
  unassigned: z.enum(["true", "false"]).optional(),
  // ID filters (can be repeated)
  id: z.union([z.string(), z.array(z.string())]).optional(),
  // Label filters - AND logic (can be repeated)
  label: z.union([z.string(), z.array(z.string())]).optional(),
  // Label filters - OR logic (can be repeated)
  labelAny: z.union([z.string(), z.array(z.string())]).optional(),
  // Priority filters - exact match (can be repeated)
  priority: z.union([z.string(), z.array(z.string())]).optional(),
  // Priority range - minimum (0=critical, 4=backlog)
  priorityMin: z.string().optional(),
  // Priority range - maximum
  priorityMax: z.string().optional(),
  // Text search - title contains
  titleContains: z.string().optional(),
  // Text search - description contains
  descContains: z.string().optional(),
  // Text search - notes contains
  notesContains: z.string().optional(),
  // Include closed issues (default: false)
  all: z.enum(["true", "false"]).optional(),
  // Max results (0 = unlimited, default: 50)
  limit: z.string().optional(),
  // Sort by field
  sort: z.enum(["priority", "created_at", "updated_at", "title"]).optional(),
  // Reverse sort order
  reverse: z.enum(["true", "false"]).optional(),
  // Filter for deferred issues
  deferred: z.enum(["true", "false"]).optional(),
  // Filter for overdue issues
  overdue: z.enum(["true", "false"]).optional(),
});

const _beads = new Hono<{ Variables: { beadsService: BeadsService } }>();

/**
 * Strip undefined values from an object.
 * Required for exactOptionalPropertyTypes compliance when passing
 * Zod-parsed objects to functions expecting optional (but not undefined) properties.
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const result = {} as T;
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}

function respondWithGatewayError(c: Context, error: GatewayError) {
  const timestamp = new Date().toISOString();
  const payload = serializeGatewayError(error);
  return sendError(
    c,
    payload.code,
    payload.message,
    payload.httpStatus as ContentfulStatusCode,
    {
      ...(payload.details && { details: payload.details }),
      timestamp,
    },
  );
}

function handleError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof z.ZodError) {
    return sendValidationError(c, transformZodError(error));
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

  if (error instanceof BrClientError) {
    const mapped = createGatewayError(
      "SYSTEM_UNAVAILABLE",
      "BR command failed",
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

  router.use("*", requireAdminMiddleware());

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
        return sendResource(c, "triage", {
          ...triage,
          triage: {
            ...triage.triage,
            recommendations: sliced ?? [],
          },
        });
      }
      return sendResource(c, "triage", triage);
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * GET /beads/triage/quick-wins - BV quick wins (canonical)
   *
   * Returns tasks that are easy to complete and unblock other work.
   * This is the canonical endpoint; /beads/ready is an alias for compatibility.
   */
  router.get("/triage/quick-wins", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");
      const triage = await serviceInstance.getTriage();
      const limit = parseLimit(c.req.query("limit"));
      const beads = triage.triage.quick_wins ?? [];
      return sendResource(c, "quick_wins", {
        beads: limit ? beads.slice(0, limit) : beads,
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * GET /beads/ready - BV quick wins (alias)
   *
   * @deprecated Use /beads/triage/quick-wins instead for clarity.
   * This endpoint returns BV triage quick wins, not BR ready issues.
   * For BR ready (unblocked) issues, use /beads/list/ready.
   */
  router.get("/ready", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");
      const triage = await serviceInstance.getTriage();
      const limit = parseLimit(c.req.query("limit"));
      const beads = triage.triage.quick_wins ?? [];
      return sendResource(c, "quick_wins", {
        beads: limit ? beads.slice(0, limit) : beads,
        _deprecated: {
          message: "Use /beads/triage/quick-wins instead",
          canonical: "/beads/triage/quick-wins",
        },
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * GET /beads/triage/blockers - BV blockers to clear (canonical)
   *
   * Returns high-impact tasks that are blocking multiple dependents.
   * This is the canonical endpoint; /beads/blocked is an alias for compatibility.
   */
  router.get("/triage/blockers", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");
      const triage = await serviceInstance.getTriage();
      const limit = parseLimit(c.req.query("limit"));
      const beads = triage.triage.blockers_to_clear ?? [];
      return sendResource(c, "blockers", {
        beads: limit ? beads.slice(0, limit) : beads,
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * GET /beads/blocked - BV blockers to clear (alias)
   *
   * @deprecated Use /beads/triage/blockers instead for clarity.
   */
  router.get("/blocked", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");
      const triage = await serviceInstance.getTriage();
      const limit = parseLimit(c.req.query("limit"));
      const beads = triage.triage.blockers_to_clear ?? [];
      return sendResource(c, "blockers", {
        beads: limit ? beads.slice(0, limit) : beads,
        _deprecated: {
          message: "Use /beads/triage/blockers instead",
          canonical: "/beads/triage/blockers",
        },
      });
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
      return sendResource(c, "insights", insights);
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
      return sendResource(c, "plan", plan);
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * GET /beads/graph - BV graph visualization
   * Query params:
   *   format: json | dot | mermaid (default: json)
   *   rootId: optional root issue ID for subgraph
   *   depth: optional max depth (0 = unlimited)
   */
  router.get("/graph", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");
      const format = c.req.query("format") as
        | "json"
        | "dot"
        | "mermaid"
        | undefined;
      const rootId = c.req.query("rootId");
      const depthStr = c.req.query("depth");
      const depth = depthStr ? Number.parseInt(depthStr, 10) : undefined;

      // Build options object conditionally to satisfy exactOptionalPropertyTypes
      const options: Parameters<typeof serviceInstance.getGraph>[0] = {
        format: format ?? "json",
      };
      if (rootId !== undefined) {
        options.rootId = rootId;
      }
      if (depth !== undefined && !Number.isNaN(depth)) {
        options.depth = depth;
      }

      const graph = await serviceInstance.getGraph(options);

      return sendResource(c, "graph", graph);
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * POST /beads/sync - Run br sync --flush-only
   */
  router.post("/sync", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");
      const result = await serviceInstance.sync({ mode: "flush-only" });
      return sendResource(c, "sync_result", {
        status: "ok",
        ...result,
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * GET /beads/sync/status - Get br sync status
   */
  router.get("/sync/status", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");
      const status = await serviceInstance.syncStatus();
      return sendResource(c, "sync_status", status);
    } catch (error) {
      return handleError(error, c);
    }
  });

  // ==========================================================================
  // BR CRUD Endpoints
  // ==========================================================================

  /**
   * GET /beads - List beads with optional filtering
   *
   * Full parity with `br list` command (bd-2l4h).
   *
   * Query params:
   *   status: filter by status (can be repeated, AND logic)
   *   type: filter by type (can be repeated, AND logic)
   *   assignee: filter by assignee
   *   unassigned: only show unassigned (boolean)
   *   id: filter by specific IDs (can be repeated)
   *   label: filter by label (can be repeated, AND logic)
   *   labelAny: filter by label (can be repeated, OR logic)
   *   priority: filter by exact priority (can be repeated)
   *   priorityMin: filter by minimum priority (0=critical, 4=backlog)
   *   priorityMax: filter by maximum priority
   *   titleContains: title contains substring
   *   descContains: description contains substring
   *   notesContains: notes contains substring
   *   all: include closed issues (default: false, excludes closed)
   *   limit: max results (default: 50, 0 = unlimited)
   *   sort: sort by (priority|created_at|updated_at|title)
   *   reverse: reverse sort order (boolean)
   *   deferred: filter for deferred issues (boolean)
   *   overdue: filter for overdue issues (boolean)
   */
  router.get("/", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");
      const log = getLogger();

      // Parse query parameters with detailed logging for invalid values
      const statuses = c.req.queries("status");
      const types = c.req.queries("type");
      const assignee = c.req.query("assignee");
      const unassigned = c.req.query("unassigned") === "true";
      const ids = c.req.queries("id");
      const labels = c.req.queries("label");
      const labelsAny = c.req.queries("labelAny");
      const priorityStrs = c.req.queries("priority");
      const priorityMinStr = c.req.query("priorityMin");
      const priorityMaxStr = c.req.query("priorityMax");
      const titleContains = c.req.query("titleContains");
      const descContains = c.req.query("descContains");
      const notesContains = c.req.query("notesContains");
      const all = c.req.query("all") === "true";
      const limit = parseLimit(c.req.query("limit"));
      const sort = c.req.query("sort") as
        | "priority"
        | "created_at"
        | "updated_at"
        | "title"
        | undefined;
      const reverse = c.req.query("reverse") === "true";
      const deferred = c.req.query("deferred") === "true";
      const overdue = c.req.query("overdue") === "true";

      // Validate sort parameter
      if (
        sort &&
        !["priority", "created_at", "updated_at", "title"].includes(sort)
      ) {
        log.warn({ sort }, "Invalid sort parameter, ignoring");
      }

      // Parse priority values with validation
      const priorities: number[] = [];
      if (priorityStrs && priorityStrs.length > 0) {
        for (const pStr of priorityStrs) {
          const p = Number.parseInt(pStr, 10);
          if (Number.isNaN(p) || p < 0 || p > 4) {
            log.warn({ priority: pStr }, "Invalid priority value, ignoring");
          } else {
            priorities.push(p);
          }
        }
      }

      // Parse priority range with validation
      let priorityMin: number | undefined;
      let priorityMax: number | undefined;
      if (priorityMinStr) {
        const pm = Number.parseInt(priorityMinStr, 10);
        if (Number.isNaN(pm) || pm < 0 || pm > 4) {
          log.warn(
            { priorityMin: priorityMinStr },
            "Invalid priorityMin value, ignoring",
          );
        } else {
          priorityMin = pm;
        }
      }
      if (priorityMaxStr) {
        const pm = Number.parseInt(priorityMaxStr, 10);
        if (Number.isNaN(pm) || pm < 0 || pm > 4) {
          log.warn(
            { priorityMax: priorityMaxStr },
            "Invalid priorityMax value, ignoring",
          );
        } else {
          priorityMax = pm;
        }
      }

      // Build options object conditionally
      const options: Parameters<typeof serviceInstance.list>[0] = {};
      if (statuses && statuses.length > 0) options.statuses = statuses;
      if (types && types.length > 0) options.types = types;
      if (assignee) options.assignee = assignee;
      if (unassigned) options.unassigned = true;
      if (ids && ids.length > 0) options.ids = ids;
      if (labels && labels.length > 0) options.labels = labels;
      if (labelsAny && labelsAny.length > 0) options.labelsAny = labelsAny;
      if (priorities.length > 0) options.priorities = priorities;
      if (priorityMin !== undefined) options.priorityMin = priorityMin;
      if (priorityMax !== undefined) options.priorityMax = priorityMax;
      if (titleContains) options.titleContains = titleContains;
      if (descContains) options.descContains = descContains;
      if (notesContains) options.notesContains = notesContains;
      if (all) options.all = true;
      if (limit !== undefined) options.limit = limit;
      if (
        sort &&
        ["priority", "created_at", "updated_at", "title"].includes(sort)
      ) {
        options.sort = sort;
      }
      if (reverse) options.reverse = true;
      if (deferred) options.deferred = true;
      if (overdue) options.overdue = true;

      log.debug({ options }, "Listing beads with filters");
      const beads = await serviceInstance.list(options);

      // Add links and threading hints to each bead
      const ctx = getLinkContext(c);
      const beadsWithLinks = beads.map((bead) => ({
        ...bead,
        links: beadLinks({ id: bead.id }, ctx),
        threading: beadThreadingHints({ id: bead.id }),
      }));

      return sendResource(c, "beads", {
        beads: beadsWithLinks,
        count: beadsWithLinks.length,
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * GET /beads/list/ready - Get ready (unblocked) beads
   * Query params:
   *   limit: max results
   *   assignee: filter by assignee
   *   unassigned: only show unassigned
   *   label: filter by label (can be repeated)
   *   sort: sort by (hybrid|priority|oldest)
   */
  router.get("/list/ready", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");

      const assignee = c.req.query("assignee");
      const unassigned = c.req.query("unassigned") === "true";
      const labels = c.req.queries("label");
      const limit = parseLimit(c.req.query("limit"));
      const sort = c.req.query("sort") as
        | "hybrid"
        | "priority"
        | "oldest"
        | undefined;

      const options: Parameters<typeof serviceInstance.ready>[0] = {};
      if (assignee) options.assignee = assignee;
      if (unassigned) options.unassigned = true;
      if (labels && labels.length > 0) options.labels = labels;
      if (limit !== undefined) options.limit = limit;
      if (sort) options.sort = sort;

      const beads = await serviceInstance.ready(options);

      // Add links and threading hints to each bead
      const ctx = getLinkContext(c);
      const beadsWithLinks = beads.map((bead) => ({
        ...bead,
        links: beadLinks({ id: bead.id }, ctx),
        threading: beadThreadingHints({ id: bead.id }),
      }));

      return sendResource(c, "beads", {
        beads: beadsWithLinks,
        count: beadsWithLinks.length,
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * GET /beads/:id - Show a specific bead
   *
   * Response includes:
   * - links: HATEOAS links for CRUD and mail thread coordination
   * - threading: Hints for using the bead ID as Agent Mail thread_id
   */
  router.get("/:id", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");
      const id = c.req.param("id");

      // Avoid matching other routes
      if (
        id === "triage" ||
        id === "ready" ||
        id === "blocked" ||
        id === "insights" ||
        id === "plan" ||
        id === "graph" ||
        id === "sync" ||
        id === "list"
      ) {
        return c.notFound();
      }

      const beads = await serviceInstance.show(id);
      if (beads.length === 0) {
        const mapped = createGatewayError(
          "BEAD_NOT_FOUND",
          `Bead not found: ${id}`,
        );
        return respondWithGatewayError(c, mapped);
      }

      const ctx = getLinkContext(c);
      // bead is guaranteed to exist since we checked beads.length above
      const bead = beads[0]!;
      return sendResource(c, "bead", {
        ...bead,
        links: beadLinks({ id: bead.id }, ctx),
        threading: beadThreadingHints({ id: bead.id }),
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * POST /beads - Create a new bead
   *
   * Response includes:
   * - links: HATEOAS links for CRUD and mail thread coordination
   * - threading: Hints for using the bead ID as Agent Mail thread_id
   */
  router.post("/", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");
      const body = await c.req.json();
      const parsed = CreateBeadSchema.parse(body);

      // Strip undefined values and cast to satisfy exactOptionalPropertyTypes
      const bead = await serviceInstance.create(
        stripUndefined(parsed) as BrCreateInput,
      );

      const ctx = getLinkContext(c);
      return sendResource(
        c,
        "bead",
        {
          ...bead,
          links: beadLinks({ id: bead.id }, ctx),
          threading: beadThreadingHints({ id: bead.id }),
        },
        201,
      );
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * PATCH /beads/:id - Update a bead
   *
   * Response includes:
   * - links: HATEOAS links for CRUD and mail thread coordination
   * - threading: Hints for using the bead ID as Agent Mail thread_id
   */
  router.patch("/:id", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");
      const id = c.req.param("id");
      const body = await c.req.json();
      const parsed = UpdateBeadSchema.parse(body);

      // Strip undefined values and cast to satisfy exactOptionalPropertyTypes
      const beads = await serviceInstance.update(
        id,
        stripUndefined(parsed) as BrUpdateInput,
      );
      if (beads.length === 0) {
        const mapped = createGatewayError(
          "BEAD_NOT_FOUND",
          `Bead not found: ${id}`,
        );
        return respondWithGatewayError(c, mapped);
      }

      const ctx = getLinkContext(c);
      // bead is guaranteed to exist since we checked beads.length above
      const bead = beads[0]!;
      return sendResource(c, "bead", {
        ...bead,
        links: beadLinks({ id: bead.id }, ctx),
        threading: beadThreadingHints({ id: bead.id }),
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * DELETE /beads/:id - Close a bead
   *
   * Response includes:
   * - links: HATEOAS links for CRUD and mail thread coordination
   * - threading: Hints for using the bead ID as Agent Mail thread_id
   */
  router.delete("/:id", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");
      const id = c.req.param("id");
      const reason = c.req.query("reason");
      const force = c.req.query("force") === "true";

      const options: Parameters<typeof serviceInstance.close>[1] = {};
      if (reason) options.reason = reason;
      if (force) options.force = true;

      const beads = await serviceInstance.close(id, options);
      if (beads.length === 0) {
        const mapped = createGatewayError(
          "BEAD_NOT_FOUND",
          `Bead not found: ${id}`,
        );
        return respondWithGatewayError(c, mapped);
      }

      const ctx = getLinkContext(c);
      // bead is guaranteed to exist since we checked beads.length above
      const bead = beads[0]!;
      return sendResource(c, "bead", {
        ...bead,
        links: beadLinks({ id: bead.id }, ctx),
        threading: beadThreadingHints({ id: bead.id }),
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * POST /beads/:id/close - Close a bead (alternative to DELETE)
   *
   * Response includes:
   * - links: HATEOAS links for CRUD and mail thread coordination
   * - threading: Hints for using the bead ID as Agent Mail thread_id
   */
  router.post("/:id/close", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");
      const id = c.req.param("id");
      const body = await c.req.json().catch(() => ({}));
      const parsed = CloseBeadSchema.parse(body);

      const options: Parameters<typeof serviceInstance.close>[1] = {};
      if (parsed.reason) options.reason = parsed.reason;
      if (parsed.force) options.force = true;

      const beads = await serviceInstance.close(id, options);
      if (beads.length === 0) {
        const mapped = createGatewayError(
          "BEAD_NOT_FOUND",
          `Bead not found: ${id}`,
        );
        return respondWithGatewayError(c, mapped);
      }

      const ctx = getLinkContext(c);
      // bead is guaranteed to exist since we checked beads.length above
      const bead = beads[0]!;
      return sendResource(c, "bead", {
        ...bead,
        links: beadLinks({ id: bead.id }, ctx),
        threading: beadThreadingHints({ id: bead.id }),
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * POST /beads/:id/claim - Claim a bead (set status to in_progress)
   *
   * Response includes:
   * - links: HATEOAS links for CRUD and mail thread coordination
   * - threading: Hints for using the bead ID as Agent Mail thread_id
   */
  router.post("/:id/claim", async (c) => {
    try {
      const serviceInstance = c.get("beadsService");
      const id = c.req.param("id");

      const beads = await serviceInstance.update(id, { claim: true });
      if (beads.length === 0) {
        const mapped = createGatewayError(
          "BEAD_NOT_FOUND",
          `Bead not found: ${id}`,
        );
        return respondWithGatewayError(c, mapped);
      }

      const ctx = getLinkContext(c);
      // bead is guaranteed to exist since we checked beads.length above
      const bead = beads[0]!;
      return sendResource(c, "bead", {
        ...bead,
        links: beadLinks({ id: bead.id }, ctx),
        threading: beadThreadingHints({ id: bead.id }),
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  return router;
}

const beadsRoutes = createBeadsRoutes();

export { beadsRoutes as beads, createBeadsRoutes };
