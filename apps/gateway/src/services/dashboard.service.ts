/**
 * Dashboard Service - Manages custom dashboards and widgets.
 *
 * Provides:
 * - CRUD operations for dashboards
 * - Widget data fetching
 * - Permission management
 * - Favorites management
 *
 * Persists data to SQLite via Drizzle ORM.
 */

import type {
  CreateDashboardInput,
  Dashboard,
  DashboardLayout,
  DashboardPermission,
  DashboardPermissionEntry,
  DashboardSharing,
  DashboardSummary,
  DashboardVisibility,
  RefreshInterval,
  UpdateDashboardInput,
  Widget,
  WidgetData,
} from "@flywheel/shared";
import { and, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "../db";
import {
  dashboardFavorites,
  dashboardPermissions,
  dashboards,
} from "../db/schema";
import { getLogger } from "../middleware/correlation";

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_LAYOUT_CONFIG: DashboardLayout = {
  columns: 12,
  rowHeight: 80,
  margin: [16, 16],
  containerPadding: [16, 16],
};

const DEFAULT_SHARING_CONFIG: DashboardSharing = {
  visibility: "private",
  viewers: [],
  editors: [],
  requireAuth: true,
  embedEnabled: false,
};

const ALLOWED_REFRESH_INTERVALS = new Set<RefreshInterval>([
  0, 15, 30, 60, 300, 900,
]);

function getWidgetCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function coerceRefreshInterval(value: number): RefreshInterval {
  return ALLOWED_REFRESH_INTERVALS.has(value as RefreshInterval)
    ? (value as RefreshInterval)
    : 60;
}

// ============================================================================
// ID Generation
// ============================================================================

function generateDashboardId(): string {
  return `dash_${ulid()}`;
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function generateEmbedToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ============================================================================
// Helper: Serialization
// ============================================================================

/**
 * Convert DB row to Dashboard object.
 */
function splitPermissions(permissions: DashboardPermissionEntry[]): {
  viewers: string[];
  editors: string[];
} {
  const viewers = new Set<string>();
  const editors = new Set<string>();

  for (const permission of permissions) {
    if (permission.permission === "edit") {
      editors.add(permission.userId);
    } else if (permission.permission === "view") {
      viewers.add(permission.userId);
    }
  }

  return { viewers: [...viewers], editors: [...editors] };
}

function normalizeUserList(list?: string[]): string[] | undefined {
  if (!list) return undefined;
  const unique = new Set<string>();
  for (const raw of list) {
    const value = raw.trim();
    if (value.length > 0) unique.add(value);
  }
  return [...unique];
}

async function syncDashboardPermissions(options: {
  dashboardId: string;
  viewers?: string[];
  editors?: string[];
  grantedBy?: string;
}): Promise<void> {
  const { dashboardId, viewers, editors, grantedBy } = options;

  if (viewers === undefined && editors === undefined) return;

  const normalizedViewers = normalizeUserList(viewers);
  const normalizedEditors = normalizeUserList(editors);
  const existing = await db
    .select()
    .from(dashboardPermissions)
    .where(eq(dashboardPermissions.dashboardId, dashboardId));
  const existingByUser = new Map(
    existing.map((row) => [row.userId, row.permission]),
  );
  const now = new Date();

  const upsertBatch = async (
    userIds: string[] | undefined,
    permission: DashboardPermission,
  ) => {
    if (!userIds || userIds.length === 0) return;
    await db
      .insert(dashboardPermissions)
      .values(
        userIds.map((userId) => ({
          id: `perm_${ulid()}`,
          dashboardId,
          userId,
          permission,
          grantedBy,
          grantedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [dashboardPermissions.dashboardId, dashboardPermissions.userId],
        set: { permission, grantedBy, grantedAt: now },
      });
  };

  const deletePermission = async (userId: string) => {
    await db
      .delete(dashboardPermissions)
      .where(
        and(
          eq(dashboardPermissions.dashboardId, dashboardId),
          eq(dashboardPermissions.userId, userId),
        ),
      );
  };

  if (normalizedViewers && normalizedEditors) {
    const desired = new Map<string, DashboardPermission>();
    for (const userId of normalizedViewers) {
      desired.set(userId, "view");
    }
    for (const userId of normalizedEditors) {
      desired.set(userId, "edit");
    }

    for (const row of existing) {
      if (!desired.has(row.userId)) {
        await deletePermission(row.userId);
      }
    }

    const desiredViewers: string[] = [];
    const desiredEditors: string[] = [];
    for (const [userId, permission] of desired) {
      if (permission === "edit") {
        desiredEditors.push(userId);
      } else {
        desiredViewers.push(userId);
      }
    }

    await upsertBatch(desiredViewers, "view");
    await upsertBatch(desiredEditors, "edit");
    return;
  }

  if (normalizedViewers) {
    const viewersSet = new Set(normalizedViewers);
    for (const row of existing) {
      if (row.permission === "view" && !viewersSet.has(row.userId)) {
        await deletePermission(row.userId);
      }
    }

    const viewerUpserts = normalizedViewers.filter(
      (userId) => existingByUser.get(userId) !== "edit",
    );
    await upsertBatch(viewerUpserts, "view");
  }

  if (normalizedEditors) {
    const editorsSet = new Set(normalizedEditors);
    for (const row of existing) {
      if (row.permission === "edit" && !editorsSet.has(row.userId)) {
        await deletePermission(row.userId);
      }
    }

    await upsertBatch(normalizedEditors, "edit");
  }
}

function rowToDashboard(
  row: typeof dashboards.$inferSelect,
  permissions: DashboardPermissionEntry[] = [],
): Dashboard {
  const { viewers, editors } = splitPermissions(permissions);
  const sharing: DashboardSharing = {
    visibility: row.visibility as "private" | "team" | "public",
    viewers,
    editors,
    requireAuth: row.requireAuth ?? true,
    embedEnabled: row.embedEnabled ?? false,
    ...(row.teamId != null ? { teamId: row.teamId } : {}),
    ...(row.publicSlug != null ? { publicSlug: row.publicSlug } : {}),
    ...(row.embedToken != null ? { embedToken: row.embedToken } : {}),
  };

  return {
    id: row.id,
    name: row.name,
    ...(row.description != null ? { description: row.description } : {}),
    ownerId: row.ownerId,
    workspaceId: row.workspaceId,
    layout: row.layout as DashboardLayout,
    widgets: row.widgets as Widget[],
    // Reconstruct sharing object
    sharing,
    refreshInterval: coerceRefreshInterval(row.refreshInterval),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ============================================================================
// Dashboard CRUD
// ============================================================================

/**
 * Create a new dashboard.
 */
export async function createDashboard(
  input: CreateDashboardInput,
  ownerId: string,
): Promise<Dashboard> {
  const log = getLogger();
  const id = generateDashboardId();
  const now = new Date();

  const sharing = {
    ...DEFAULT_SHARING_CONFIG,
    ...input.sharing,
  };

  const newDashboard: typeof dashboards.$inferInsert = {
    id,
    name: input.name,
    description: input.description,
    ownerId,
    workspaceId: input.workspaceId ?? "default",
    layout: {
      ...DEFAULT_LAYOUT_CONFIG,
      ...input.layout,
    },
    widgets: input.widgets ?? [],
    // Flatten sharing config to columns
    visibility: sharing.visibility,
    teamId: sharing.teamId,
    publicSlug: sharing.publicSlug,
    requireAuth: sharing.requireAuth,
    embedEnabled: sharing.embedEnabled,
    embedToken: sharing.embedToken,
    refreshInterval: input.refreshInterval ?? 60,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(dashboards).values(newDashboard);

  if (
    input.sharing?.viewers !== undefined ||
    input.sharing?.editors !== undefined
  ) {
    await syncDashboardPermissions({
      dashboardId: id,
      viewers: sharing.viewers,
      editors: sharing.editors,
      grantedBy: ownerId,
    });
  }

  log.info({ dashboardId: id, name: input.name }, "Dashboard created");

  const created = await getDashboard(id);
  return (
    created ?? rowToDashboard(newDashboard as typeof dashboards.$inferSelect)
  );
}

/**
 * Get a dashboard by ID.
 */
export async function getDashboard(id: string): Promise<Dashboard | undefined> {
  const row = await db
    .select()
    .from(dashboards)
    .where(eq(dashboards.id, id))
    .get();
  if (!row) return undefined;
  const permissions = await listPermissions(row.id);
  return rowToDashboard(row, permissions);
}

/**
 * Get a dashboard by public slug.
 */
export async function getDashboardBySlug(
  slug: string,
): Promise<Dashboard | undefined> {
  const row = await db
    .select()
    .from(dashboards)
    .where(eq(dashboards.publicSlug, slug))
    .get();
  if (!row) return undefined;
  const permissions = await listPermissions(row.id);
  return rowToDashboard(row, permissions);
}

/**
 * Update an existing dashboard.
 */
export async function updateDashboard(
  id: string,
  input: UpdateDashboardInput,
): Promise<Dashboard | undefined> {
  const log = getLogger();
  const existing = await getDashboard(id);

  if (!existing) {
    return undefined;
  }

  const updates: Partial<typeof dashboards.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.layout !== undefined)
    updates.layout = { ...existing.layout, ...input.layout };
  if (input.widgets !== undefined) updates.widgets = input.widgets;
  if (input.refreshInterval !== undefined)
    updates.refreshInterval = input.refreshInterval;

  if (input.sharing) {
    if (input.sharing.visibility !== undefined)
      updates.visibility = input.sharing.visibility;
    if (input.sharing.teamId !== undefined)
      updates.teamId = input.sharing.teamId;
    if (input.sharing.publicSlug !== undefined)
      updates.publicSlug = input.sharing.publicSlug;
    if (input.sharing.requireAuth !== undefined)
      updates.requireAuth = input.sharing.requireAuth;
    if (input.sharing.embedEnabled !== undefined)
      updates.embedEnabled = input.sharing.embedEnabled;
    if (input.sharing.embedToken !== undefined)
      updates.embedToken = input.sharing.embedToken;
  }

  await db.update(dashboards).set(updates).where(eq(dashboards.id, id));

  const sharingUpdates = input.sharing;
  if (
    sharingUpdates &&
    (sharingUpdates.viewers !== undefined ||
      sharingUpdates.editors !== undefined)
  ) {
    await syncDashboardPermissions({
      dashboardId: id,
      ...(sharingUpdates.viewers !== undefined
        ? { viewers: sharingUpdates.viewers }
        : {}),
      ...(sharingUpdates.editors !== undefined
        ? { editors: sharingUpdates.editors }
        : {}),
    });
  }

  log.info({ dashboardId: id }, "Dashboard updated");

  return getDashboard(id);
}

/**
 * Delete a dashboard.
 */
export async function deleteDashboard(id: string): Promise<boolean> {
  const log = getLogger();
  const result = await db
    .delete(dashboards)
    .where(eq(dashboards.id, id))
    .returning({ id: dashboards.id });

  if (result.length > 0) {
    log.info({ dashboardId: id }, "Dashboard deleted");
    return true;
  }
  return false;
}

/**
 * Duplicate a dashboard.
 */
export async function duplicateDashboard(
  id: string,
  ownerId: string,
  newName?: string,
): Promise<Dashboard | undefined> {
  const original = await getDashboard(id);

  if (!original) {
    return undefined;
  }

  const createInput: CreateDashboardInput = {
    name: newName ?? `${original.name} (Copy)`,
    workspaceId: original.workspaceId,
    layout: original.layout,
    widgets: original.widgets.map((w) => ({
      ...w,
      id: `widget_${ulid()}`,
    })),
    sharing: {
      ...DEFAULT_SHARING_CONFIG,
    },
    refreshInterval: original.refreshInterval,
    ...(original.description !== undefined
      ? { description: original.description }
      : {}),
  };

  return createDashboard(createInput, ownerId);
}

// ============================================================================
// List and Search
// ============================================================================

interface ListDashboardsOptions {
  workspaceId?: string;
  ownerId?: string;
  visibility?: DashboardVisibility;
  userId?: string; // For filtering accessible dashboards
  limit?: number;
  offset?: number;
}

interface ListDashboardsResult {
  items: DashboardSummary[];
  total: number;
}

/**
 * List dashboards with filtering.
 */
export async function listDashboards(
  options: ListDashboardsOptions = {},
): Promise<ListDashboardsResult> {
  const {
    workspaceId,
    ownerId,
    visibility,
    userId,
    limit = 50,
    offset = 0,
  } = options;

  const conditions = [];

  if (workspaceId) {
    conditions.push(eq(dashboards.workspaceId, workspaceId));
  }
  if (ownerId) {
    conditions.push(eq(dashboards.ownerId, ownerId));
  }
  if (visibility) {
    conditions.push(eq(dashboards.visibility, visibility));
  }

  // TODO: Handle userId permission filtering in SQL or post-filter
  // For now, we fetch base list and filter if needed, but SQL filtering is better.
  // Implementing full RBAC in one SQL query requires joining permissions table.

  let query = db.select().from(dashboards).orderBy(desc(dashboards.updatedAt));

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  const allRows = await query; // Get all matching base criteria first

  // Post-filter for user access if userId is provided
  let accessibleRows = allRows;
  if (userId) {
    // Get all permissions for this user
    const userPermissions = await db
      .select()
      .from(dashboardPermissions)
      .where(eq(dashboardPermissions.userId, userId));
    const permittedIds = new Set(userPermissions.map((p) => p.dashboardId));

    accessibleRows = allRows.filter((row) => {
      // Owner
      if (row.ownerId === userId) return true;
      // Public
      if (row.visibility === "public") return true;
      // Explicit permission
      if (permittedIds.has(row.id)) return true;
      return false;
    });
  }

  const total = accessibleRows.length;
  const paginated = accessibleRows.slice(offset, offset + limit);

  // Get favorites for user
  const userFavorites = new Set<string>();
  if (userId) {
    const favs = await db
      .select()
      .from(dashboardFavorites)
      .where(eq(dashboardFavorites.userId, userId));
    for (const f of favs) {
      userFavorites.add(f.dashboardId);
    }
  }

  const items: DashboardSummary[] = paginated.map((d) => ({
    id: d.id,
    name: d.name,
    ...(d.description != null ? { description: d.description } : {}),
    ownerId: d.ownerId,
    visibility: d.visibility as DashboardVisibility,
    widgetCount: getWidgetCount(d.widgets),
    isFavorite: userFavorites.has(d.id),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  }));

  return { items, total };
}

// ============================================================================
// Permission Management
// ============================================================================

/**
 * Check if a user can access a dashboard.
 */
export async function canUserAccess(
  dashboard: Dashboard,
  userId: string,
): Promise<boolean> {
  if (dashboard.ownerId === userId) return true;
  if (dashboard.sharing.visibility === "public") return true;

  const permissions = await listPermissions(dashboard.id);
  return permissions.some((p) => p.userId === userId);
}

/**
 * Check if a user can edit a dashboard.
 */
export async function canUserEdit(
  dashboard: Dashboard,
  userId: string,
): Promise<boolean> {
  if (dashboard.ownerId === userId) return true;

  const permissions = await listPermissions(dashboard.id);
  return permissions.some(
    (p) => p.userId === userId && p.permission === "edit",
  );
}

/**
 * Grant permission to a user.
 */
export async function grantPermission(
  dashboardId: string,
  userId: string,
  permission: DashboardPermission,
  grantedBy?: string,
): Promise<DashboardPermissionEntry | undefined> {
  const dashboard = await getDashboard(dashboardId);
  if (!dashboard) return undefined;

  const now = new Date();

  await db
    .insert(dashboardPermissions)
    .values({
      id: `perm_${ulid()}`,
      dashboardId,
      userId,
      permission,
      grantedBy,
      grantedAt: now,
    })
    .onConflictDoUpdate({
      target: [dashboardPermissions.dashboardId, dashboardPermissions.userId],
      set: {
        permission,
        grantedBy,
        grantedAt: now,
      },
    });

  return {
    dashboardId,
    userId,
    permission,
    grantedAt: now.toISOString(),
  };
}

/**
 * Revoke permission from a user.
 */
export async function revokePermission(
  dashboardId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(dashboardPermissions)
    .where(
      and(
        eq(dashboardPermissions.dashboardId, dashboardId),
        eq(dashboardPermissions.userId, userId),
      ),
    )
    .returning();

  return result.length > 0;
}

/**
 * List permissions for a dashboard.
 */
export async function listPermissions(
  dashboardId: string,
): Promise<DashboardPermissionEntry[]> {
  const rows = await db
    .select()
    .from(dashboardPermissions)
    .where(eq(dashboardPermissions.dashboardId, dashboardId));

  return rows.map((row) => ({
    dashboardId: row.dashboardId,
    userId: row.userId,
    permission: row.permission as DashboardPermission,
    grantedAt: row.grantedAt.toISOString(),
  }));
}

// ============================================================================
// Favorites
// ============================================================================

/**
 * Add a dashboard to user's favorites.
 */
export async function addFavorite(
  userId: string,
  dashboardId: string,
): Promise<boolean> {
  const dashboard = await getDashboard(dashboardId);
  if (!dashboard) return false;

  await db
    .insert(dashboardFavorites)
    .values({
      id: `fav_${ulid()}`,
      userId,
      dashboardId,
      createdAt: new Date(),
    })
    .onConflictDoNothing();

  return true;
}

/**
 * Remove a dashboard from user's favorites.
 */
export async function removeFavorite(
  userId: string,
  dashboardId: string,
): Promise<boolean> {
  const result = await db
    .delete(dashboardFavorites)
    .where(
      and(
        eq(dashboardFavorites.userId, userId),
        eq(dashboardFavorites.dashboardId, dashboardId),
      ),
    )
    .returning();

  return result.length > 0;
}

/**
 * List user's favorite dashboards.
 */
export async function listFavorites(
  userId: string,
): Promise<DashboardSummary[]> {
  const rows = await db
    .select({
      dashboard: dashboards,
    })
    .from(dashboardFavorites)
    .innerJoin(dashboards, eq(dashboardFavorites.dashboardId, dashboards.id))
    .where(eq(dashboardFavorites.userId, userId));

  return rows.map(({ dashboard }) => ({
    id: dashboard.id,
    name: dashboard.name,
    ...(dashboard.description != null
      ? { description: dashboard.description }
      : {}),
    ownerId: dashboard.ownerId,
    visibility: dashboard.visibility as DashboardVisibility,
    widgetCount: getWidgetCount(dashboard.widgets),
    isFavorite: true,
    createdAt: dashboard.createdAt.toISOString(),
    updatedAt: dashboard.updatedAt.toISOString(),
  }));
}

// ============================================================================
// Widget Management
// ============================================================================

/**
 * Add a widget to a dashboard.
 */
export async function addWidget(
  dashboardId: string,
  widget: Widget,
): Promise<Dashboard | undefined> {
  const dashboard = await getDashboard(dashboardId);
  if (!dashboard) return undefined;

  const resolvedWidgetId =
    typeof widget.id === "string" && widget.id.trim().length > 0
      ? widget.id
      : `widget_${ulid()}`;

  const widgetWithId: Widget = {
    ...widget,
    id: resolvedWidgetId,
  };

  const newWidgets = [...dashboard.widgets, widgetWithId];

  await db
    .update(dashboards)
    .set({
      widgets: newWidgets,
      updatedAt: new Date(),
    })
    .where(eq(dashboards.id, dashboardId));

  return getDashboard(dashboardId);
}

/**
 * Update a widget in a dashboard.
 */
export async function updateWidget(
  dashboardId: string,
  widgetId: string,
  widgetUpdate: Partial<Widget>,
): Promise<Dashboard | undefined> {
  const dashboard = await getDashboard(dashboardId);
  if (!dashboard) return undefined;

  const widgetIndex = dashboard.widgets.findIndex((w) => w.id === widgetId);
  if (widgetIndex === -1) return undefined;

  const widgets = [...dashboard.widgets];
  const existingWidget = widgets[widgetIndex]!;
  const updatedWidget: Widget = {
    id: widgetUpdate.id ?? existingWidget.id,
    type: widgetUpdate.type ?? existingWidget.type,
    title: widgetUpdate.title ?? existingWidget.title,
    position: widgetUpdate.position ?? existingWidget.position,
    config: widgetUpdate.config ?? existingWidget.config,
  };

  if (widgetUpdate.description !== undefined) {
    if (widgetUpdate.description) {
      updatedWidget.description = widgetUpdate.description;
    }
  } else if (existingWidget.description) {
    updatedWidget.description = existingWidget.description;
  }

  if (widgetUpdate.refreshInterval !== undefined) {
    updatedWidget.refreshInterval = widgetUpdate.refreshInterval;
  } else if (existingWidget.refreshInterval !== undefined) {
    updatedWidget.refreshInterval = existingWidget.refreshInterval;
  }
  widgets[widgetIndex] = updatedWidget;

  await db
    .update(dashboards)
    .set({
      widgets,
      updatedAt: new Date(),
    })
    .where(eq(dashboards.id, dashboardId));

  return getDashboard(dashboardId);
}

/**
 * Remove a widget from a dashboard.
 */
export async function removeWidget(
  dashboardId: string,
  widgetId: string,
): Promise<Dashboard | undefined> {
  const dashboard = await getDashboard(dashboardId);
  if (!dashboard) return undefined;

  const newWidgets = dashboard.widgets.filter((w) => w.id !== widgetId);

  await db
    .update(dashboards)
    .set({
      widgets: newWidgets,
      updatedAt: new Date(),
    })
    .where(eq(dashboards.id, dashboardId));

  return getDashboard(dashboardId);
}

// ============================================================================
// Sharing
// ============================================================================

/**
 * Update sharing settings for a dashboard.
 */
export async function updateSharing(
  dashboardId: string,
  sharing: Partial<DashboardSharing>,
): Promise<Dashboard | undefined> {
  const dashboard = await getDashboard(dashboardId);
  if (!dashboard) return undefined;

  const updates: Partial<typeof dashboards.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (sharing.visibility !== undefined) updates.visibility = sharing.visibility;
  if (sharing.teamId !== undefined) updates.teamId = sharing.teamId;

  if (
    sharing.visibility === "public" &&
    !dashboard.sharing.publicSlug &&
    !sharing.publicSlug
  ) {
    updates.publicSlug = `${generateSlug(dashboard.name)}-${ulid().slice(-6).toLowerCase()}`;
  } else if (sharing.publicSlug !== undefined) {
    updates.publicSlug = sharing.publicSlug;
  }

  if (sharing.requireAuth !== undefined)
    updates.requireAuth = sharing.requireAuth;

  if (sharing.embedEnabled !== undefined)
    updates.embedEnabled = sharing.embedEnabled;
  if (
    sharing.embedEnabled &&
    !dashboard.sharing.embedToken &&
    !sharing.embedToken
  ) {
    updates.embedToken = generateEmbedToken();
  } else if (sharing.embedToken !== undefined) {
    updates.embedToken = sharing.embedToken;
  }

  await db
    .update(dashboards)
    .set(updates)
    .where(eq(dashboards.id, dashboardId));

  if (sharing.viewers !== undefined || sharing.editors !== undefined) {
    await syncDashboardPermissions({
      dashboardId,
      ...(sharing.viewers !== undefined ? { viewers: sharing.viewers } : {}),
      ...(sharing.editors !== undefined ? { editors: sharing.editors } : {}),
      grantedBy: dashboard.ownerId,
    });
  }

  return getDashboard(dashboardId);
}

// ============================================================================
// Widget Data Fetching
// ============================================================================

/**
 * Fetch data for a widget.
 */
export async function fetchWidgetData(
  dashboardId: string,
  widgetId: string,
): Promise<WidgetData> {
  const dashboard = await getDashboard(dashboardId);

  if (!dashboard) {
    return {
      widgetId,
      data: null,
      fetchedAt: new Date().toISOString(),
      error: "Dashboard not found",
    };
  }

  const widget = dashboard.widgets.find((w) => w.id === widgetId);

  if (!widget) {
    return {
      widgetId,
      data: null,
      fetchedAt: new Date().toISOString(),
      error: "Widget not found",
    };
  }

  const mockData = getMockDataForWidget(widget);

  return {
    widgetId,
    data: mockData,
    fetchedAt: new Date().toISOString(),
  };
}

function getMockDataForWidget(widget: Widget): unknown {
  // ... (Same mock data logic as before)
  switch (widget.type) {
    case "metric-card":
      return {
        value: Math.floor(Math.random() * 1000),
        previousValue: Math.floor(Math.random() * 1000),
        trend: Math.random() > 0.5 ? "up" : "down",
        trendPercent: Math.floor(Math.random() * 30),
      };

    case "line-chart":
      return {
        labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        datasets: [
          {
            label: "Usage",
            data: Array.from({ length: 7 }, () =>
              Math.floor(Math.random() * 100),
            ),
          },
        ],
      };

    case "bar-chart":
      return {
        labels: ["Agent A", "Agent B", "Agent C", "Agent D"],
        datasets: [
          {
            label: "Requests",
            data: Array.from({ length: 4 }, () =>
              Math.floor(Math.random() * 500),
            ),
          },
        ],
      };

    case "pie-chart":
      return {
        labels: ["Claude", "Codex", "Gemini", "Other"],
        data: [45, 30, 20, 5],
      };

    case "table":
      return {
        columns: ["Name", "Status", "Requests", "Latency"],
        rows: [
          ["Agent Alpha", "Running", "1,234", "45ms"],
          ["Agent Beta", "Idle", "567", "32ms"],
          ["Agent Gamma", "Error", "89", "N/A"],
        ],
      };

    case "agent-list":
      return {
        agents: [
          { id: "1", name: "Agent Alpha", status: "running", sessions: 5 },
          { id: "2", name: "Agent Beta", status: "idle", sessions: 0 },
          { id: "3", name: "Agent Gamma", status: "error", sessions: 0 },
        ],
      };

    case "activity-feed":
      return {
        events: [
          {
            id: "1",
            type: "session_start",
            message: "Agent Alpha started session",
            timestamp: new Date().toISOString(),
          },
          {
            id: "2",
            type: "task_complete",
            message: "Task completed successfully",
            timestamp: new Date().toISOString(),
          },
          {
            id: "3",
            type: "error",
            message: "Rate limit exceeded",
            timestamp: new Date().toISOString(),
          },
        ],
      };

    case "gauge":
      return {
        value: Math.floor(Math.random() * 100),
        min: 0,
        max: 100,
        thresholds: [
          { value: 70, color: "yellow" },
          { value: 90, color: "red" },
        ],
      };

    default:
      return null;
  }
}

// ============================================================================
// Stats
// ============================================================================

/**
 * Get dashboard statistics.
 */
export async function getDashboardStats(): Promise<{
  totalDashboards: number;
  byVisibility: Record<string, number>;
  totalWidgets: number;
  averageWidgetsPerDashboard: number;
}> {
  const allDashboards = await db.select().from(dashboards);

  const byVisibility: Record<DashboardVisibility, number> = {
    private: 0,
    team: 0,
    public: 0,
  };

  let totalWidgets = 0;

  for (const dashboard of allDashboards) {
    const visibility = dashboard.visibility as DashboardVisibility;
    byVisibility[visibility] = (byVisibility[visibility] ?? 0) + 1;
    totalWidgets += getWidgetCount(dashboard.widgets);
  }

  return {
    totalDashboards: allDashboards.length,
    byVisibility,
    totalWidgets,
    averageWidgetsPerDashboard:
      allDashboards.length > 0 ? totalWidgets / allDashboards.length : 0,
  };
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Toggle favorite status for a dashboard.
 */
export async function toggleFavorite(
  dashboardId: string,
  userId: string,
): Promise<boolean> {
  const existing = await db
    .select()
    .from(dashboardFavorites)
    .where(
      and(
        eq(dashboardFavorites.userId, userId),
        eq(dashboardFavorites.dashboardId, dashboardId),
      ),
    )
    .get();

  if (existing) {
    await removeFavorite(userId, dashboardId);
    return false;
  } else {
    const added = await addFavorite(userId, dashboardId);
    return added;
  }
}

/**
 * Clear all stores (for testing only).
 */
export async function clearDashboardStore(): Promise<void> {
  await db.delete(dashboardFavorites);
  await db.delete(dashboardPermissions);
  await db.delete(dashboards);
}
