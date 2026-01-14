/**
 * Dashboards Routes - REST API endpoints for custom dashboard management.
 *
 * Provides endpoints for:
 * - Creating and managing dashboards
 * - Widget operations
 * - Permission management
 * - Favorites
 * - Public/embedded dashboard access
 */

import type {
  CreateDashboardInput,
  DashboardPermission,
  DashboardSharing,
  UpdateDashboardInput,
  Widget,
} from "@flywheel/shared";
import { Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import {
  addFavorite,
  addWidget,
  canUserAccess,
  canUserEdit,
  createDashboard,
  deleteDashboard,
  duplicateDashboard,
  fetchWidgetData,
  getDashboard,
  getDashboardBySlug,
  getDashboardStats,
  grantPermission,
  listDashboards,
  listFavorites,
  listPermissions,
  removeFavorite,
  removeWidget,
  revokePermission,
  updateDashboard,
  updateSharing,
  updateWidget,
} from "../services/dashboard.service";
import {
  sendError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const dashboards = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const LayoutSchema = z.object({
  columns: z.number().int().min(1).max(24).optional(),
  rowHeight: z.number().int().min(20).max(200).optional(),
  margin: z
    .tuple([z.number().int().min(0), z.number().int().min(0)])
    .optional(),
  containerPadding: z
    .tuple([z.number().int().min(0), z.number().int().min(0)])
    .optional(),
});

const PositionSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  minW: z.number().int().min(1).optional(),
  minH: z.number().int().min(1).optional(),
  maxW: z.number().int().min(1).optional(),
  maxH: z.number().int().min(1).optional(),
});

const DataSourceSchema = z.object({
  type: z.enum(["api", "query", "static"]),
  endpoint: z.string().optional(),
  query: z.string().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  timeRange: z
    .object({
      preset: z.enum(["15m", "1h", "6h", "24h", "7d", "30d", "custom"]),
      start: z.string().optional(),
      end: z.string().optional(),
    })
    .optional(),
});

const DisplaySchema = z
  .object({
    colorScheme: z.string().optional(),
    showLegend: z.boolean().optional(),
    showGrid: z.boolean().optional(),
    showLabels: z.boolean().optional(),
    labelPosition: z.enum(["top", "bottom", "left", "right"]).optional(),
    animationEnabled: z.boolean().optional(),
  })
  .optional();

const ThresholdSchema = z
  .object({
    warning: z.number().optional(),
    critical: z.number().optional(),
    warningColor: z.string().optional(),
    criticalColor: z.string().optional(),
  })
  .optional();

const WidgetConfigSchema = z.object({
  dataSource: DataSourceSchema,
  display: DisplaySchema,
  thresholds: ThresholdSchema,
  customOptions: z.record(z.string(), z.unknown()).optional(),
});

const WidgetSchema = z.object({
  id: z.string().optional(),
  type: z.enum([
    "metric-card",
    "line-chart",
    "bar-chart",
    "pie-chart",
    "table",
    "agent-list",
    "activity-feed",
    "cost-breakdown",
    "heatmap",
    "gauge",
    "text",
    "iframe",
  ]),
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  position: PositionSchema,
  config: WidgetConfigSchema,
  refreshInterval: z.number().int().min(0).optional(),
});

// Partial schema for widget updates - all fields optional
const WidgetUpdateSchema = z.object({
  id: z.string().optional(),
  type: z
    .enum([
      "metric-card",
      "line-chart",
      "bar-chart",
      "pie-chart",
      "table",
      "agent-list",
      "activity-feed",
      "cost-breakdown",
      "heatmap",
      "gauge",
      "text",
      "iframe",
    ])
    .optional(),
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  position: PositionSchema.partial().optional(),
  config: WidgetConfigSchema.partial().optional(),
  refreshInterval: z.number().int().min(0).optional(),
});

const SharingSchema = z.object({
  visibility: z.enum(["private", "team", "public"]).optional(),
  teamId: z.string().optional(),
  viewers: z.array(z.string()).optional(),
  editors: z.array(z.string()).optional(),
  publicSlug: z.string().optional(),
  requireAuth: z.boolean().optional(),
  embedEnabled: z.boolean().optional(),
});

const CreateDashboardSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  workspaceId: z.string().optional(),
  layout: LayoutSchema.optional(),
  widgets: z.array(WidgetSchema).optional(),
  sharing: SharingSchema.optional(),
  refreshInterval: z.number().int().min(0).optional(),
});

const UpdateDashboardSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  layout: LayoutSchema.optional(),
  widgets: z.array(WidgetSchema).optional(),
  sharing: SharingSchema.optional(),
  refreshInterval: z.number().int().min(0).optional(),
});

// ============================================================================
// Dashboard CRUD Endpoints
// ============================================================================

/**
 * List dashboards
 * GET /dashboards
 */
dashboards.get("/", async (c) => {
  const log = getLogger();
  const userId = c.req.query("userId") ?? "default";
  const workspaceId = c.req.query("workspaceId");
  const visibility = c.req.query("visibility");
  const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);
  const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);

  try {
    const { items, total } = listDashboards({
      userId,
      limit,
      offset,
      ...(workspaceId && { workspaceId }),
      ...(visibility && { visibility }),
    });

    return sendList(c, items, {
      total,
      hasMore: offset + items.length < total,
    });
  } catch (error) {
    log.error({ error }, "Failed to list dashboards");
    return sendError(c, "INTERNAL_ERROR", "Failed to list dashboards", 500);
  }
});

/**
 * List user's favorite dashboards
 * GET /dashboards/favorites
 * NOTE: Must be defined before /:id to avoid being caught by the param route
 */
dashboards.get("/favorites", async (c) => {
  const log = getLogger();
  const userId = c.req.query("userId") ?? "default";

  try {
    const favorites = listFavorites(userId);

    return sendList(c, favorites, {
      total: favorites.length,
    });
  } catch (error) {
    log.error({ error }, "Failed to list favorites");
    return sendError(c, "INTERNAL_ERROR", "Failed to list favorites", 500);
  }
});

/**
 * Get dashboard statistics
 * GET /dashboards/stats
 * NOTE: Must be defined before /:id to avoid being caught by the param route
 */
dashboards.get("/stats", async (c) => {
  const log = getLogger();

  try {
    const stats = getDashboardStats();
    return sendResource(c, "stats", stats);
  } catch (error) {
    log.error({ error }, "Failed to get dashboard stats");
    return sendError(c, "INTERNAL_ERROR", "Failed to get dashboard stats", 500);
  }
});

/**
 * Get a public dashboard by slug
 * GET /dashboards/public/:slug
 * NOTE: Must be defined before /:id to avoid being caught by the param route
 */
dashboards.get("/public/:slug", async (c) => {
  const log = getLogger();
  const slug = c.req.param("slug");

  try {
    const dashboard = getDashboardBySlug(slug);

    if (!dashboard) {
      return sendNotFound(c, "Dashboard", slug);
    }

    if (dashboard.sharing.visibility !== "public") {
      return sendError(c, "FORBIDDEN", "This dashboard is not public", 403);
    }

    return sendResource(c, "dashboard", dashboard);
  } catch (error) {
    log.error({ error, slug }, "Failed to get public dashboard");
    return sendError(
      c,
      "INTERNAL_ERROR",
      "Failed to get public dashboard",
      500,
    );
  }
});

/**
 * Get a dashboard by ID
 * GET /dashboards/:id
 */
dashboards.get("/:id", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");
  const userId = c.req.query("userId") ?? "default";

  try {
    const dashboard = getDashboard(id);

    if (!dashboard) {
      return sendNotFound(c, "Dashboard", id);
    }

    if (!canUserAccess(dashboard, userId)) {
      return sendError(
        c,
        "FORBIDDEN",
        "You do not have access to this dashboard",
        403,
      );
    }

    return sendResource(c, "dashboard", dashboard);
  } catch (error) {
    log.error({ error, dashboardId: id }, "Failed to get dashboard");
    return sendError(c, "INTERNAL_ERROR", "Failed to get dashboard", 500);
  }
});

/**
 * Create a new dashboard
 * POST /dashboards
 */
dashboards.post("/", async (c) => {
  const log = getLogger();
  const userId = c.req.query("userId") ?? "default";

  try {
    const body = await c.req.json();
    const parsed = CreateDashboardSchema.safeParse(body);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const dashboard = createDashboard(
      parsed.data as CreateDashboardInput,
      userId,
    );

    log.info({ dashboardId: dashboard.id }, "Dashboard created");
    return sendResource(c, "dashboard", dashboard, 201);
  } catch (error) {
    log.error({ error }, "Failed to create dashboard");
    return sendError(c, "INTERNAL_ERROR", "Failed to create dashboard", 500);
  }
});

/**
 * Update a dashboard
 * PUT /dashboards/:id
 */
dashboards.put("/:id", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");
  const userId = c.req.query("userId") ?? "default";

  try {
    const existingDashboard = getDashboard(id);

    if (!existingDashboard) {
      return sendNotFound(c, "Dashboard", id);
    }

    if (!canUserEdit(existingDashboard, userId)) {
      return sendError(
        c,
        "FORBIDDEN",
        "You do not have edit access to this dashboard",
        403,
      );
    }

    const body = await c.req.json();
    const parsed = UpdateDashboardSchema.safeParse(body);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const dashboard = updateDashboard(id, parsed.data as UpdateDashboardInput);

    if (!dashboard) {
      return sendNotFound(c, "Dashboard", id);
    }

    log.info({ dashboardId: id }, "Dashboard updated");
    return sendResource(c, "dashboard", dashboard);
  } catch (error) {
    log.error({ error, dashboardId: id }, "Failed to update dashboard");
    return sendError(c, "INTERNAL_ERROR", "Failed to update dashboard", 500);
  }
});

/**
 * Delete a dashboard
 * DELETE /dashboards/:id
 */
dashboards.delete("/:id", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");
  const userId = c.req.query("userId") ?? "default";

  try {
    const dashboard = getDashboard(id);

    if (!dashboard) {
      return sendNotFound(c, "Dashboard", id);
    }

    if (dashboard.ownerId !== userId) {
      return sendError(
        c,
        "FORBIDDEN",
        "Only the owner can delete this dashboard",
        403,
      );
    }

    const deleted = deleteDashboard(id);

    if (!deleted) {
      return sendNotFound(c, "Dashboard", id);
    }

    log.info({ dashboardId: id }, "Dashboard deleted");
    return c.json({ success: true });
  } catch (error) {
    log.error({ error, dashboardId: id }, "Failed to delete dashboard");
    return sendError(c, "INTERNAL_ERROR", "Failed to delete dashboard", 500);
  }
});

/**
 * Duplicate a dashboard
 * POST /dashboards/:id/duplicate
 */
dashboards.post("/:id/duplicate", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");
  const userId = c.req.query("userId") ?? "default";

  try {
    const existingDashboard = getDashboard(id);

    if (!existingDashboard) {
      return sendNotFound(c, "Dashboard", id);
    }

    if (!canUserAccess(existingDashboard, userId)) {
      return sendError(
        c,
        "FORBIDDEN",
        "You do not have access to this dashboard",
        403,
      );
    }

    const body = await c.req.json().catch(() => ({}));
    const newName = body.name as string | undefined;

    const dashboard = duplicateDashboard(id, userId, newName);

    if (!dashboard) {
      return sendNotFound(c, "Dashboard", id);
    }

    log.info({ originalId: id, newId: dashboard.id }, "Dashboard duplicated");
    return sendResource(c, "dashboard", dashboard, 201);
  } catch (error) {
    log.error({ error, dashboardId: id }, "Failed to duplicate dashboard");
    return sendError(c, "INTERNAL_ERROR", "Failed to duplicate dashboard", 500);
  }
});

// ============================================================================
// Widget Endpoints
// ============================================================================

/**
 * Add a widget to a dashboard
 * POST /dashboards/:id/widgets
 */
dashboards.post("/:id/widgets", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");
  const userId = c.req.query("userId") ?? "default";

  try {
    const dashboard = getDashboard(id);

    if (!dashboard) {
      return sendNotFound(c, "Dashboard", id);
    }

    if (!canUserEdit(dashboard, userId)) {
      return sendError(
        c,
        "FORBIDDEN",
        "You do not have edit access to this dashboard",
        403,
      );
    }

    const body = await c.req.json();
    const parsed = WidgetSchema.safeParse(body);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const updated = addWidget(id, parsed.data as Widget);

    if (!updated) {
      return sendNotFound(c, "Dashboard", id);
    }

    log.info({ dashboardId: id }, "Widget added to dashboard");
    return sendResource(c, "dashboard", updated);
  } catch (error) {
    log.error({ error, dashboardId: id }, "Failed to add widget");
    return sendError(c, "INTERNAL_ERROR", "Failed to add widget", 500);
  }
});

/**
 * Update a widget in a dashboard
 * PUT /dashboards/:id/widgets/:widgetId
 */
dashboards.put("/:id/widgets/:widgetId", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");
  const widgetId = c.req.param("widgetId");
  const userId = c.req.query("userId") ?? "default";

  try {
    const dashboard = getDashboard(id);

    if (!dashboard) {
      return sendNotFound(c, "Dashboard", id);
    }

    if (!canUserEdit(dashboard, userId)) {
      return sendError(
        c,
        "FORBIDDEN",
        "You do not have edit access to this dashboard",
        403,
      );
    }

    const body = await c.req.json();
    const parsed = WidgetUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const updated = updateWidget(id, widgetId, parsed.data as Partial<Widget>);

    if (!updated) {
      return sendNotFound(c, "Widget", widgetId);
    }

    log.info({ dashboardId: id, widgetId }, "Widget updated");
    return sendResource(c, "dashboard", updated);
  } catch (error) {
    log.error({ error, dashboardId: id, widgetId }, "Failed to update widget");
    return sendError(c, "INTERNAL_ERROR", "Failed to update widget", 500);
  }
});

/**
 * Remove a widget from a dashboard
 * DELETE /dashboards/:id/widgets/:widgetId
 */
dashboards.delete("/:id/widgets/:widgetId", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");
  const widgetId = c.req.param("widgetId");
  const userId = c.req.query("userId") ?? "default";

  try {
    const dashboard = getDashboard(id);

    if (!dashboard) {
      return sendNotFound(c, "Dashboard", id);
    }

    if (!canUserEdit(dashboard, userId)) {
      return sendError(
        c,
        "FORBIDDEN",
        "You do not have edit access to this dashboard",
        403,
      );
    }

    const updated = removeWidget(id, widgetId);

    if (!updated) {
      return sendNotFound(c, "Widget", widgetId);
    }

    log.info({ dashboardId: id, widgetId }, "Widget removed");
    return sendResource(c, "dashboard", updated);
  } catch (error) {
    log.error({ error, dashboardId: id, widgetId }, "Failed to remove widget");
    return sendError(c, "INTERNAL_ERROR", "Failed to remove widget", 500);
  }
});

/**
 * Fetch data for a widget
 * GET /dashboards/:id/widgets/:widgetId/data
 */
dashboards.get("/:id/widgets/:widgetId/data", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");
  const widgetId = c.req.param("widgetId");
  const userId = c.req.query("userId") ?? "default";

  try {
    const dashboard = getDashboard(id);

    if (!dashboard) {
      return sendNotFound(c, "Dashboard", id);
    }

    if (!canUserAccess(dashboard, userId)) {
      return sendError(
        c,
        "FORBIDDEN",
        "You do not have access to this dashboard",
        403,
      );
    }

    const data = await fetchWidgetData(id, widgetId);

    return sendResource(c, "widgetData", data);
  } catch (error) {
    log.error(
      { error, dashboardId: id, widgetId },
      "Failed to fetch widget data",
    );
    return sendError(c, "INTERNAL_ERROR", "Failed to fetch widget data", 500);
  }
});

// ============================================================================
// Sharing Endpoints
// ============================================================================

/**
 * Update sharing settings
 * PUT /dashboards/:id/sharing
 */
dashboards.put("/:id/sharing", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");
  const userId = c.req.query("userId") ?? "default";

  try {
    const dashboard = getDashboard(id);

    if (!dashboard) {
      return sendNotFound(c, "Dashboard", id);
    }

    if (dashboard.ownerId !== userId) {
      return sendError(
        c,
        "FORBIDDEN",
        "Only the owner can update sharing settings",
        403,
      );
    }

    const body = await c.req.json();
    const parsed = SharingSchema.safeParse(body);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const updated = updateSharing(id, parsed.data as Partial<DashboardSharing>);

    if (!updated) {
      return sendNotFound(c, "Dashboard", id);
    }

    log.info({ dashboardId: id }, "Sharing settings updated");
    return sendResource(c, "dashboard", updated);
  } catch (error) {
    log.error({ error, dashboardId: id }, "Failed to update sharing");
    return sendError(c, "INTERNAL_ERROR", "Failed to update sharing", 500);
  }
});

/**
 * List permissions for a dashboard
 * GET /dashboards/:id/permissions
 */
dashboards.get("/:id/permissions", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");
  const userId = c.req.query("userId") ?? "default";

  try {
    const dashboard = getDashboard(id);

    if (!dashboard) {
      return sendNotFound(c, "Dashboard", id);
    }

    if (dashboard.ownerId !== userId) {
      return sendError(
        c,
        "FORBIDDEN",
        "Only the owner can view permissions",
        403,
      );
    }

    const permissions = listPermissions(id);

    return sendList(c, permissions, {
      total: permissions.length,
    });
  } catch (error) {
    log.error({ error, dashboardId: id }, "Failed to list permissions");
    return sendError(c, "INTERNAL_ERROR", "Failed to list permissions", 500);
  }
});

/**
 * Grant permission to a user
 * POST /dashboards/:id/permissions
 */
dashboards.post("/:id/permissions", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");
  const userId = c.req.query("userId") ?? "default";

  try {
    const dashboard = getDashboard(id);

    if (!dashboard) {
      return sendNotFound(c, "Dashboard", id);
    }

    if (dashboard.ownerId !== userId) {
      return sendError(
        c,
        "FORBIDDEN",
        "Only the owner can grant permissions",
        403,
      );
    }

    const body = await c.req.json();
    const { targetUserId, permission } = body as {
      targetUserId: string;
      permission: DashboardPermission;
    };

    if (!targetUserId || !permission) {
      return sendValidationError(c, [
        { path: "body", message: "targetUserId and permission are required" },
      ]);
    }

    if (permission !== "view" && permission !== "edit") {
      return sendValidationError(c, [
        { path: "permission", message: "permission must be 'view' or 'edit'" },
      ]);
    }

    const entry = grantPermission(id, targetUserId, permission, userId);

    if (!entry) {
      return sendNotFound(c, "Dashboard", id);
    }

    log.info(
      { dashboardId: id, targetUserId, permission },
      "Permission granted",
    );
    return sendResource(c, "permission", entry, 201);
  } catch (error) {
    log.error({ error, dashboardId: id }, "Failed to grant permission");
    return sendError(c, "INTERNAL_ERROR", "Failed to grant permission", 500);
  }
});

/**
 * Revoke permission from a user
 * DELETE /dashboards/:id/permissions/:targetUserId
 */
dashboards.delete("/:id/permissions/:targetUserId", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");
  const targetUserId = c.req.param("targetUserId");
  const userId = c.req.query("userId") ?? "default";

  try {
    const dashboard = getDashboard(id);

    if (!dashboard) {
      return sendNotFound(c, "Dashboard", id);
    }

    if (dashboard.ownerId !== userId) {
      return sendError(
        c,
        "FORBIDDEN",
        "Only the owner can revoke permissions",
        403,
      );
    }

    const revoked = revokePermission(id, targetUserId);

    if (!revoked) {
      return sendNotFound(c, "Permission", targetUserId);
    }

    log.info({ dashboardId: id, targetUserId }, "Permission revoked");
    return c.json({ success: true });
  } catch (error) {
    log.error(
      { error, dashboardId: id, targetUserId },
      "Failed to revoke permission",
    );
    return sendError(c, "INTERNAL_ERROR", "Failed to revoke permission", 500);
  }
});

// ============================================================================
// Favorites Endpoints
// ============================================================================

/**
 * Add dashboard to favorites
 * POST /dashboards/:id/favorite
 */
dashboards.post("/:id/favorite", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");
  const userId = c.req.query("userId") ?? "default";

  try {
    const dashboard = getDashboard(id);

    if (!dashboard) {
      return sendNotFound(c, "Dashboard", id);
    }

    if (!canUserAccess(dashboard, userId)) {
      return sendError(
        c,
        "FORBIDDEN",
        "You do not have access to this dashboard",
        403,
      );
    }

    const added = addFavorite(userId, id);

    if (!added) {
      return sendNotFound(c, "Dashboard", id);
    }

    log.info({ dashboardId: id, userId }, "Dashboard added to favorites");
    return c.json({ success: true });
  } catch (error) {
    log.error({ error, dashboardId: id }, "Failed to add favorite");
    return sendError(c, "INTERNAL_ERROR", "Failed to add favorite", 500);
  }
});

/**
 * Remove dashboard from favorites
 * DELETE /dashboards/:id/favorite
 */
dashboards.delete("/:id/favorite", async (c) => {
  const log = getLogger();
  const id = c.req.param("id");
  const userId = c.req.query("userId") ?? "default";

  try {
    const removed = removeFavorite(userId, id);

    if (!removed) {
      return sendNotFound(c, "Favorite", id);
    }

    log.info({ dashboardId: id, userId }, "Dashboard removed from favorites");
    return c.json({ success: true });
  } catch (error) {
    log.error({ error, dashboardId: id }, "Failed to remove favorite");
    return sendError(c, "INTERNAL_ERROR", "Failed to remove favorite", 500);
  }
});

export { dashboards };
