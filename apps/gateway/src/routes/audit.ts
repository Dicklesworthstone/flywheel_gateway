/**
 * Audit Routes
 *
 * REST API endpoints for audit log search, export, and retention policy management.
 */

import { and, count, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { auditLogs } from "../db/schema";
import { getLogger } from "../middleware/correlation";
import { redactSensitiveData } from "../services/audit-redaction.service";
import {
  type AuditExportResult,
  type AuditSearchResult,
  DEFAULT_RETENTION_POLICIES,
  type RetentionPolicy,
} from "../types/audit.types";
import {
  sendError,
  sendInternalError,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";
import type { AuthContext } from "../ws/hub";

type AuditEnv = {
  Variables: {
    auth?: AuthContext;
  };
};

const app = new Hono<AuditEnv>();

// In-memory storage for retention policies (in production, this would be in the database)
const retentionPolicies: Map<string, RetentionPolicy> = new Map();

// Initialize default retention policies
function initializeDefaultPolicies() {
  if (retentionPolicies.size === 0) {
    const now = new Date();
    for (const policy of DEFAULT_RETENTION_POLICIES) {
      const id = crypto.randomUUID();
      retentionPolicies.set(id, {
        ...policy,
        id,
        createdAt: now,
        updatedAt: now,
        createdBy: "system",
      });
    }
  }
}
initializeDefaultPolicies();

// Export job tracking with cleanup
const exportJobs: Map<string, AuditExportResult> = new Map();

/** Maximum number of export jobs to retain */
const MAX_EXPORT_JOBS = 1000;

/** Export job TTL in milliseconds (24 hours) */
const EXPORT_JOB_TTL_MS = 24 * 60 * 60 * 1000;

/** Cleanup interval in milliseconds (1 hour) */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Clean up expired export jobs from the Map.
 * Removes jobs that have passed their expiresAt time or failed jobs older than TTL.
 */
function cleanupExpiredExportJobs(): number {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [jobId, job] of exportJobs) {
    const isExpired = job.expiresAt && new Date(job.expiresAt).getTime() < now;
    const isStaleFailed =
      job.status === "failed" &&
      job.createdAt &&
      new Date(job.createdAt).getTime() + EXPORT_JOB_TTL_MS < now;
    const isStaleProcessing =
      job.status === "processing" &&
      job.createdAt &&
      new Date(job.createdAt).getTime() + EXPORT_JOB_TTL_MS < now;

    if (isExpired || isStaleFailed || isStaleProcessing) {
      exportJobs.delete(jobId);
      cleanedCount++;
    }
  }

  // If we're still over the limit, remove oldest jobs
  if (exportJobs.size > MAX_EXPORT_JOBS) {
    const sortedJobs = Array.from(exportJobs.entries()).sort((a, b) => {
      const timeA = a[1].createdAt
        ? new Date(a[1].createdAt).getTime()
        : Date.now();
      const timeB = b[1].createdAt
        ? new Date(b[1].createdAt).getTime()
        : Date.now();
      return timeA - timeB;
    });

    const toRemove = exportJobs.size - MAX_EXPORT_JOBS;
    for (let i = 0; i < toRemove; i++) {
      const job = sortedJobs[i];
      if (job) {
        exportJobs.delete(job[0]);
        cleanedCount++;
      }
    }
  }

  return cleanedCount;
}

// Start periodic cleanup (with unref to not block process exit)
const cleanupInterval = setInterval(
  cleanupExpiredExportJobs,
  CLEANUP_INTERVAL_MS,
);
cleanupInterval.unref();

/**
 * Stop the cleanup interval (for testing).
 */
export function stopExportJobCleanup(): void {
  clearInterval(cleanupInterval);
}

/**
 * Get export job count (for testing/monitoring).
 */
export function getExportJobCount(): number {
  return exportJobs.size;
}

/**
 * Force cleanup of expired export jobs (for testing/monitoring).
 */
export function forceExportJobCleanup(): number {
  return cleanupExpiredExportJobs();
}

// ============================================================================
// Validation Schemas
// ============================================================================

const searchQuerySchema = z.object({
  query: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  correlationId: z.string().optional(),
  actorId: z.string().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  status: z.enum(["success", "failure", "partial"]).optional(),
  limit: z.coerce.number().min(1).max(1000).default(50),
  offset: z.coerce.number().min(0).default(0),
  sort: z.enum(["asc", "desc"]).default("desc"),
});

const exportSchema = z.object({
  format: z.enum(["csv", "json", "json_lines"]).default("json"),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  actions: z.array(z.string()).optional(),
  resourceTypes: z.array(z.string()).optional(),
  compression: z.enum(["none", "gzip", "zip"]).default("none"),
});

const retentionPolicySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  filter: z.object({
    actions: z.array(z.string()).optional(),
    severities: z.array(z.string()).optional(),
    resourceTypes: z.array(z.string()).optional(),
  }),
  retention: z.object({
    duration: z.number().min(1).max(3650), // 1 day to 10 years
    archiveFirst: z.boolean().default(false),
    archiveLocation: z.string().optional(),
  }),
  enabled: z.boolean().default(true),
});

const analyticsSummarySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

// ============================================================================
// Routes - IMPORTANT: Specific routes must come before parameterized routes
// ============================================================================

/**
 * Get correlated audit events
 * GET /audit/correlation/:correlationId
 */
app.get("/correlation/:correlationId", async (c) => {
  const log = getLogger();
  const correlationId = c.req.param("correlationId");

  try {
    const events = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.correlationId, correlationId))
      .orderBy(auditLogs.createdAt);

    const redactedEvents = events.map((event) => ({
      ...event,
      metadata: event.metadata ? redactSensitiveData(event.metadata) : null,
    }));

    return c.json({ events: redactedEvents, correlationId });
  } catch (error) {
    log.error({ error, correlationId }, "Failed to get correlated events");
    return sendInternalError(c);
  }
});

/**
 * List retention policies
 * GET /audit/retention-policies
 */
app.get("/retention-policies", async (c) => {
  const policies = Array.from(retentionPolicies.values());
  return c.json({ policies });
});

/**
 * Get specific retention policy
 * GET /audit/retention-policies/:id
 */
app.get("/retention-policies/:id", async (c) => {
  const id = c.req.param("id");
  const policy = retentionPolicies.get(id);

  if (!policy) {
    return sendNotFound(c, "retention_policy", id);
  }

  return sendResource(c, "retention_policy", policy);
});

/**
 * Create retention policy
 * POST /audit/retention-policies
 */
app.post("/retention-policies", async (c) => {
  const log = getLogger();

  try {
    const body = await c.req.json();
    const parseResult = retentionPolicySchema.safeParse(body);

    if (!parseResult.success) {
      return sendValidationError(c, transformZodError(parseResult.error));
    }

    const validBody = parseResult.data;
    const id = crypto.randomUUID();
    const now = new Date();

    const policy = {
      id,
      name: validBody.name,
      ...(validBody.description && { description: validBody.description }),
      filter: {
        ...(validBody.filter.actions && { actions: validBody.filter.actions }),
        ...(validBody.filter.severities && {
          severities: validBody.filter.severities,
        }),
        ...(validBody.filter.resourceTypes && {
          resourceTypes: validBody.filter.resourceTypes,
        }),
      },
      retention: {
        duration: validBody.retention.duration,
        archiveFirst: validBody.retention.archiveFirst,
        ...(validBody.retention.archiveLocation && {
          archiveLocation: validBody.retention.archiveLocation,
        }),
      },
      enabled: validBody.enabled,
      createdAt: now,
      updatedAt: now,
      createdBy: "current-user",
    } as RetentionPolicy;

    retentionPolicies.set(id, policy);
    log.info(
      { policyId: id, name: validBody.name },
      "Retention policy created",
    );

    return c.json(policy, 201);
  } catch (error) {
    log.error({ error }, "Failed to create retention policy");
    return sendInternalError(c);
  }
});

/**
 * Update retention policy
 * PUT /audit/retention-policies/:id
 */
app.put("/retention-policies/:id", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");

  const policy = retentionPolicies.get(id);
  if (!policy) {
    return sendNotFound(c, "retention_policy", id);
  }

  try {
    const body = await c.req.json();
    const parseResult = retentionPolicySchema.partial().safeParse(body);

    if (!parseResult.success) {
      return sendValidationError(c, transformZodError(parseResult.error));
    }

    const validBody = parseResult.data;

    const updatedPolicy = {
      ...policy,
      ...(validBody.name !== undefined && { name: validBody.name }),
      ...(validBody.description !== undefined && {
        description: validBody.description,
      }),
      ...(validBody.filter !== undefined && {
        filter: {
          ...(validBody.filter.actions && {
            actions: validBody.filter.actions,
          }),
          ...(validBody.filter.severities && {
            severities: validBody.filter.severities,
          }),
          ...(validBody.filter.resourceTypes && {
            resourceTypes: validBody.filter.resourceTypes,
          }),
        },
      }),
      ...(validBody.retention !== undefined && {
        retention: {
          duration: validBody.retention.duration,
          archiveFirst: validBody.retention.archiveFirst,
          ...(validBody.retention.archiveLocation && {
            archiveLocation: validBody.retention.archiveLocation,
          }),
        },
      }),
      ...(validBody.enabled !== undefined && { enabled: validBody.enabled }),
      id,
      createdAt: policy.createdAt,
      createdBy: policy.createdBy,
      updatedAt: new Date(),
    } as RetentionPolicy;

    retentionPolicies.set(id, updatedPolicy);
    log.info({ policyId: id }, "Retention policy updated");

    return sendResource(c, "retention_policy", updatedPolicy);
  } catch (error) {
    log.error({ error, id }, "Failed to update retention policy");
    return sendInternalError(c);
  }
});

/**
 * Delete retention policy
 * DELETE /audit/retention-policies/:id
 */
app.delete("/retention-policies/:id", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");

  const policy = retentionPolicies.get(id);
  if (!policy) {
    return sendNotFound(c, "retention_policy", id);
  }

  if (policy.name === "Default Policy") {
    return sendError(
      c,
      "CANNOT_DELETE_DEFAULT",
      "Cannot delete the default retention policy",
      400,
    );
  }

  retentionPolicies.delete(id);
  log.info({ policyId: id, name: policy.name }, "Retention policy deleted");

  return c.json({ success: true, message: "Retention policy deleted" });
});

/**
 * Create export job
 * POST /audit/export
 */
app.post("/export", async (c) => {
  const log = getLogger();

  try {
    const body = await c.req.json();
    const parseResult = exportSchema.safeParse(body);

    if (!parseResult.success) {
      return sendValidationError(c, transformZodError(parseResult.error));
    }

    const validBody = parseResult.data;
    const jobId = crypto.randomUUID();

    // Get the user ID from auth context for authorization checks
    const auth = c.get("auth") as AuthContext | undefined;
    const createdBy = auth?.userId;

    const exportJob: AuditExportResult = {
      jobId,
      filename: `audit-export-${jobId.slice(0, 8)}.${validBody.format}`,
      recordCount: 0,
      fileSize: 0,
      status: "processing",
      ...(createdBy ? { createdBy } : {}),
      createdAt: new Date(),
    };

    exportJobs.set(jobId, exportJob);

    const conditions: ReturnType<typeof eq>[] = [
      gte(auditLogs.createdAt, new Date(validBody.startDate)),
      lte(auditLogs.createdAt, new Date(validBody.endDate)),
    ];

    if (validBody.actions && validBody.actions.length > 0) {
      conditions.push(inArray(auditLogs.action, validBody.actions));
    }

    if (validBody.resourceTypes && validBody.resourceTypes.length > 0) {
      conditions.push(inArray(auditLogs.resourceType, validBody.resourceTypes));
    }

    // Execute query asynchronously
    (async () => {
      try {
        const events = await db
          .select()
          .from(auditLogs)
          .where(and(...conditions))
          .orderBy(auditLogs.createdAt);

        const redactedEvents = events.map((event) => ({
          ...event,
          metadata: event.metadata ? redactSensitiveData(event.metadata) : null,
        }));

        const job = exportJobs.get(jobId);
        if (job) {
          job.status = "completed";
          job.recordCount = redactedEvents.length;
          job.fileSize = JSON.stringify(redactedEvents).length;
          job.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          job.downloadUrl = `/api/audit/export/${jobId}/download`;
          exportJobs.set(jobId, job);
        }

        log.info(
          { jobId, recordCount: redactedEvents.length },
          "Audit export completed",
        );
      } catch (error) {
        log.error({ error, jobId }, "Audit export failed");
        const job = exportJobs.get(jobId);
        if (job) {
          job.status = "failed";
          job.error = error instanceof Error ? error.message : "Unknown error";
          exportJobs.set(jobId, job);
        }
      }
    })();

    return c.json({
      jobId,
      status: "processing",
      message: "Export job created successfully",
    });
  } catch (error) {
    log.error({ error }, "Failed to create export job");
    return sendInternalError(c);
  }
});

/**
 * Get export job status
 * GET /audit/export/:jobId
 */
app.get("/export/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  const job = exportJobs.get(jobId);

  if (!job) {
    return sendNotFound(c, "export_job", jobId);
  }

  // Verify the requester is the creator or an admin
  const auth = c.get("auth") as AuthContext | undefined;
  if (job.createdBy && !auth?.isAdmin && auth?.userId !== job.createdBy) {
    return sendNotFound(c, "export_job", jobId); // Return 404 to prevent enumeration
  }

  return sendResource(c, "export_job", job);
});

/**
 * Download export file
 * GET /audit/export/:jobId/download
 */
app.get("/export/:jobId/download", async (c) => {
  const log = getLogger();
  const jobId = c.req.param("jobId");
  const job = exportJobs.get(jobId);

  if (!job) {
    return sendNotFound(c, "export_job", jobId);
  }

  // Verify the requester is the creator or an admin
  const auth = c.get("auth") as AuthContext | undefined;
  if (job.createdBy && !auth?.isAdmin && auth?.userId !== job.createdBy) {
    return sendError(
      c,
      "AUTH_INSUFFICIENT_SCOPE",
      "You are not authorized to download this export",
      403,
    );
  }

  if (job.status !== "completed") {
    return sendError(
      c,
      "EXPORT_NOT_READY",
      `Export job status: ${job.status}`,
      400,
    );
  }

  try {
    const events = await db
      .select()
      .from(auditLogs)
      .orderBy(auditLogs.createdAt)
      .limit(job.recordCount);

    const redactedEvents = events.map((event) => ({
      ...event,
      metadata: event.metadata ? redactSensitiveData(event.metadata) : null,
    }));

    c.header("Content-Type", "application/json");
    c.header("Content-Disposition", `attachment; filename="${job.filename}"`);

    return c.json(redactedEvents);
  } catch (error) {
    log.error({ error, jobId }, "Failed to download export");
    return sendInternalError(c);
  }
});

/**
 * Get audit analytics summary
 * GET /audit/analytics/summary
 */
app.get("/analytics/summary", async (c) => {
  const log = getLogger();

  try {
    const queryParams = {
      startDate: c.req.query("startDate"),
      endDate: c.req.query("endDate"),
    };

    const parseResult = analyticsSummarySchema.safeParse(queryParams);
    if (!parseResult.success) {
      return sendValidationError(c, transformZodError(parseResult.error));
    }

    const query = parseResult.data;
    const conditions: ReturnType<typeof eq>[] = [];

    if (query.startDate) {
      conditions.push(gte(auditLogs.createdAt, new Date(query.startDate)));
    }

    if (query.endDate) {
      conditions.push(lte(auditLogs.createdAt, new Date(query.endDate)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, byActionResult, byOutcomeResult, byResourceTypeResult] =
      await Promise.all([
        db.select({ count: count() }).from(auditLogs).where(whereClause),
        db
          .select({ action: auditLogs.action, count: count() })
          .from(auditLogs)
          .where(whereClause)
          .groupBy(auditLogs.action),
        db
          .select({ outcome: auditLogs.outcome, count: count() })
          .from(auditLogs)
          .where(whereClause)
          .groupBy(auditLogs.outcome),
        db
          .select({ resourceType: auditLogs.resourceType, count: count() })
          .from(auditLogs)
          .where(whereClause)
          .groupBy(auditLogs.resourceType),
      ]);

    return c.json({
      total: totalResult[0]?.count ?? 0,
      byAction: Object.fromEntries(
        byActionResult.map((r) => [r.action, r.count]),
      ),
      byOutcome: Object.fromEntries(
        byOutcomeResult.map((r) => [r.outcome, r.count]),
      ),
      byResourceType: Object.fromEntries(
        byResourceTypeResult.map((r) => [r.resourceType, r.count]),
      ),
      timeRange: { start: query.startDate, end: query.endDate },
    });
  } catch (error) {
    log.error({ error }, "Failed to get audit analytics summary");
    return sendInternalError(c);
  }
});

/**
 * Search audit events
 * GET /audit
 */
app.get("/", async (c) => {
  const log = getLogger();

  try {
    const queryParams = {
      query: c.req.query("query"),
      startDate: c.req.query("startDate"),
      endDate: c.req.query("endDate"),
      correlationId: c.req.query("correlationId"),
      actorId: c.req.query("actorId"),
      action: c.req.query("action"),
      resourceType: c.req.query("resourceType"),
      resourceId: c.req.query("resourceId"),
      status: c.req.query("status"),
      limit: c.req.query("limit") || "50",
      offset: c.req.query("offset") || "0",
      sort: c.req.query("sort") || "desc",
    };

    const parseResult = searchQuerySchema.safeParse(queryParams);
    if (!parseResult.success) {
      return sendValidationError(c, transformZodError(parseResult.error));
    }

    const query = parseResult.data;
    const conditions: ReturnType<typeof eq>[] = [];

    if (query.startDate)
      conditions.push(gte(auditLogs.createdAt, new Date(query.startDate)));
    if (query.endDate)
      conditions.push(lte(auditLogs.createdAt, new Date(query.endDate)));
    if (query.correlationId)
      conditions.push(eq(auditLogs.correlationId, query.correlationId));
    if (query.actorId) conditions.push(eq(auditLogs.accountId, query.actorId));
    if (query.action) conditions.push(eq(auditLogs.action, query.action));
    if (query.resourceType)
      conditions.push(eq(auditLogs.resourceType, query.resourceType));
    if (query.resourceId)
      conditions.push(eq(auditLogs.resource, query.resourceId));
    if (query.status) conditions.push(eq(auditLogs.outcome, query.status));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [events, totalResult] = await Promise.all([
      db
        .select()
        .from(auditLogs)
        .where(whereClause)
        .orderBy(
          query.sort === "desc"
            ? desc(auditLogs.createdAt)
            : auditLogs.createdAt,
        )
        .limit(query.limit)
        .offset(query.offset),
      db.select({ count: count() }).from(auditLogs).where(whereClause),
    ]);

    const total = totalResult[0]?.count ?? 0;

    const redactedEvents = events.map((event) => ({
      ...event,
      metadata: event.metadata ? redactSensitiveData(event.metadata) : null,
    }));

    const hasMore = query.offset + events.length < total;
    const result: AuditSearchResult = {
      events: redactedEvents as unknown as AuditSearchResult["events"],
      total,
      hasMore,
      ...(hasMore && { nextCursor: String(query.offset + query.limit) }),
    };

    return c.json(result);
  } catch (error) {
    log.error({ error }, "Failed to search audit logs");
    return sendInternalError(c);
  }
});

/**
 * Get specific audit event by ID
 * GET /audit/:id
 */
app.get("/:id", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");

  try {
    const [event] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.id, id))
      .limit(1);

    if (!event) {
      return sendNotFound(c, "audit_event", id);
    }

    const redactedEvent = {
      ...event,
      metadata: event.metadata ? redactSensitiveData(event.metadata) : null,
    };

    return sendResource(c, "audit_event", redactedEvent);
  } catch (error) {
    log.error({ error, id }, "Failed to get audit event");
    return sendInternalError(c);
  }
});

export default app;
