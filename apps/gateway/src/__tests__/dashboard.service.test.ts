/**
 * Dashboard Service Tests
 */

import { describe, expect, it, beforeEach } from "bun:test";
import {
  createDashboard,
  getDashboard,
  updateDashboard,
  deleteDashboard,
  listDashboards,
  duplicateDashboard,
  addWidget,
  updateWidget,
  removeWidget,
  grantPermission,
  revokePermission,
  toggleFavorite,
  clearDashboardStore,
} from "../services/dashboard.service";
import type { CreateDashboardInput, Widget, WidgetType } from "@flywheel/shared";

describe("Dashboard Service", () => {
  beforeEach(() => {
    // Clear in-memory store before each test
    clearDashboardStore();
  });

  describe("createDashboard", () => {
    it("should create a dashboard with default values", () => {
      const input: CreateDashboardInput = {
        name: "Test Dashboard",
      };

      const dashboard = createDashboard(input, "user-1");

      expect(dashboard.id).toBeDefined();
      expect(dashboard.name).toBe("Test Dashboard");
      expect(dashboard.ownerId).toBe("user-1");
      expect(dashboard.widgets).toEqual([]);
      expect(dashboard.layout.columns).toBe(12);
      expect(dashboard.sharing.visibility).toBe("private");
    });

    it("should create a dashboard with custom layout", () => {
      const input: CreateDashboardInput = {
        name: "Custom Layout Dashboard",
        layout: {
          columns: 24,
          rowHeight: 100,
        },
      };

      const dashboard = createDashboard(input, "user-1");

      expect(dashboard.layout.columns).toBe(24);
      expect(dashboard.layout.rowHeight).toBe(100);
    });

    it("should create a dashboard with initial widgets", () => {
      const widget: Widget = {
        id: "widget-1",
        type: "metric-card",
        title: "Test Widget",
        position: { x: 0, y: 0, w: 3, h: 2 },
        config: {
          dataSource: { type: "api", endpoint: "/api/test" },
        },
      };

      const input: CreateDashboardInput = {
        name: "Dashboard with Widgets",
        widgets: [widget],
      };

      const dashboard = createDashboard(input, "user-1");

      expect(dashboard.widgets).toHaveLength(1);
      expect(dashboard.widgets[0]!.title).toBe("Test Widget");
    });

    it("should create a dashboard with custom sharing settings", () => {
      const input: CreateDashboardInput = {
        name: "Public Dashboard",
        sharing: { visibility: "public" },
      };

      const dashboard = createDashboard(input, "user-1");

      expect(dashboard.sharing.visibility).toBe("public");
    });
  });

  describe("getDashboard", () => {
    it("should return dashboard by id", () => {
      const created = createDashboard({ name: "Test" }, "user-1");
      const retrieved = getDashboard(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    it("should return undefined for non-existent dashboard", () => {
      const dashboard = getDashboard("non-existent");
      expect(dashboard).toBeUndefined();
    });
  });

  describe("updateDashboard", () => {
    it("should update dashboard properties", () => {
      const created = createDashboard({ name: "Original" }, "user-1");
      const updated = updateDashboard(created.id, { name: "Updated" });

      expect(updated).toBeDefined();
      expect(updated?.name).toBe("Updated");
    });

    it("should update dashboard description", () => {
      const created = createDashboard({ name: "Test" }, "user-1");
      const updated = updateDashboard(created.id, {
        description: "New description",
      });

      expect(updated?.description).toBe("New description");
    });

    it("should return undefined for non-existent dashboard", () => {
      const updated = updateDashboard("non-existent", { name: "Updated" });
      expect(updated).toBeUndefined();
    });

    it("should update layout settings", () => {
      const created = createDashboard({ name: "Test" }, "user-1");
      const updated = updateDashboard(created.id, {
        layout: { columns: 24 },
      });

      expect(updated?.layout.columns).toBe(24);
      // Original values should be preserved
      expect(updated?.layout.rowHeight).toBe(80);
    });
  });

  describe("deleteDashboard", () => {
    it("should delete dashboard", () => {
      const created = createDashboard({ name: "To Delete" }, "user-1");
      const deleted = deleteDashboard(created.id);

      expect(deleted).toBe(true);
      expect(getDashboard(created.id)).toBeUndefined();
    });

    it("should return false for non-existent dashboard", () => {
      const deleted = deleteDashboard("non-existent");
      expect(deleted).toBe(false);
    });
  });

  describe("listDashboards", () => {
    it("should list all dashboards", () => {
      createDashboard({ name: "Dashboard 1" }, "user-1");
      createDashboard({ name: "Dashboard 2" }, "user-1");
      createDashboard({ name: "Dashboard 3" }, "user-2");

      const { items, total } = listDashboards({});

      expect(items).toHaveLength(3);
      expect(total).toBe(3);
    });

    it("should filter by owner", () => {
      createDashboard({ name: "Dashboard 1" }, "user-1");
      createDashboard({ name: "Dashboard 2" }, "user-1");
      createDashboard({ name: "Dashboard 3" }, "user-2");

      const { items, total } = listDashboards({ ownerId: "user-1" });

      expect(items).toHaveLength(2);
      expect(total).toBe(2);
    });

    it("should filter by visibility", () => {
      createDashboard({ name: "Private" }, "user-1");
      createDashboard(
        { name: "Public", sharing: { visibility: "public" } },
        "user-2",
      );

      const { items, total } = listDashboards({ visibility: "public" });
      expect(items).toHaveLength(1);
      expect(items[0]!.name).toBe("Public");
      expect(total).toBe(1);
    });
  });

  describe("duplicateDashboard", () => {
    it("should create a copy of the dashboard", () => {
      const original = createDashboard(
        {
          name: "Original",
          widgets: [
            {
              id: "w1",
              type: "metric-card",
              title: "Widget",
              position: { x: 0, y: 0, w: 3, h: 2 },
              config: { dataSource: { type: "api" } },
            },
          ],
        },
        "user-1",
      );

      const duplicate = duplicateDashboard(original.id, "user-1");

      expect(duplicate).toBeDefined();
      expect(duplicate?.id).not.toBe(original.id);
      expect(duplicate?.name).toBe("Original (Copy)");
      expect(duplicate?.widgets).toHaveLength(1);
    });

    it("should allow custom name for duplicate", () => {
      const original = createDashboard({ name: "Original" }, "user-1");
      const duplicate = duplicateDashboard(
        original.id,
        "user-1",
        "Custom Copy Name",
      );

      expect(duplicate?.name).toBe("Custom Copy Name");
    });

    it("should return undefined for non-existent dashboard", () => {
      const duplicate = duplicateDashboard("non-existent", "user-1");
      expect(duplicate).toBeUndefined();
    });
  });

  describe("Widget Operations", () => {
    it("should add a widget to dashboard", () => {
      const dashboard = createDashboard({ name: "Test" }, "user-1");
      const widget: Widget = {
        id: "new-widget",
        type: "line-chart" as WidgetType,
        title: "New Widget",
        position: { x: 0, y: 0, w: 6, h: 3 },
        config: { dataSource: { type: "api" } },
      };

      const updated = addWidget(dashboard.id, widget);

      expect(updated).toBeDefined();
      expect(updated?.widgets).toHaveLength(1);
      expect(updated?.widgets[0]!.title).toBe("New Widget");
    });

    it("should generate widget id if not provided", () => {
      const dashboard = createDashboard({ name: "Test" }, "user-1");
      const widget = {
        id: "",
        type: "metric-card" as WidgetType,
        title: "Auto ID Widget",
        position: { x: 0, y: 0, w: 3, h: 2 },
        config: { dataSource: { type: "api" as const } },
      };

      const updated = addWidget(dashboard.id, widget);

      expect(updated?.widgets[0]!.id).toBeTruthy();
      expect(updated?.widgets[0]!.id).not.toBe("");
    });

    it("should update a widget", () => {
      const dashboard = createDashboard(
        {
          name: "Test",
          widgets: [
            {
              id: "w1",
              type: "metric-card",
              title: "Original Title",
              position: { x: 0, y: 0, w: 3, h: 2 },
              config: { dataSource: { type: "api" } },
            },
          ],
        },
        "user-1",
      );

      const updated = updateWidget(dashboard.id, "w1", {
        title: "Updated Title",
      });

      expect(updated).toBeDefined();
      expect(updated?.widgets[0]!.title).toBe("Updated Title");
    });

    it("should return undefined when updating non-existent widget", () => {
      const dashboard = createDashboard({ name: "Test" }, "user-1");
      const updated = updateWidget(dashboard.id, "non-existent", {
        title: "Updated",
      });

      expect(updated).toBeUndefined();
    });

    it("should remove a widget", () => {
      const dashboard = createDashboard(
        {
          name: "Test",
          widgets: [
            {
              id: "w1",
              type: "metric-card",
              title: "To Remove",
              position: { x: 0, y: 0, w: 3, h: 2 },
              config: { dataSource: { type: "api" } },
            },
          ],
        },
        "user-1",
      );

      const updated = removeWidget(dashboard.id, "w1");

      expect(updated).toBeDefined();
      expect(updated?.widgets).toHaveLength(0);
    });
  });

  describe("Permissions", () => {
    it("should grant view permission", () => {
      const dashboard = createDashboard({ name: "Test" }, "user-1");
      const permission = grantPermission(dashboard.id, "user-2", "view");

      expect(permission).toBeDefined();
      expect(permission?.permission).toBe("view");
      expect(permission?.userId).toBe("user-2");
    });

    it("should grant edit permission", () => {
      const dashboard = createDashboard({ name: "Test" }, "user-1");
      const permission = grantPermission(dashboard.id, "user-2", "edit");

      expect(permission).toBeDefined();
      expect(permission?.permission).toBe("edit");
    });

    it("should revoke permission", () => {
      const dashboard = createDashboard({ name: "Test" }, "user-1");
      grantPermission(dashboard.id, "user-2", "view");
      const revoked = revokePermission(dashboard.id, "user-2");

      expect(revoked).toBe(true);
    });

    it("should return false when revoking non-existent permission", () => {
      const dashboard = createDashboard({ name: "Test" }, "user-1");
      const revoked = revokePermission(dashboard.id, "user-2");

      expect(revoked).toBe(false);
    });
  });

  describe("Favorites", () => {
    it("should toggle favorite status", () => {
      const dashboard = createDashboard({ name: "Test" }, "user-1");

      // Add to favorites
      let isFavorite = toggleFavorite(dashboard.id, "user-1");
      expect(isFavorite).toBe(true);

      // Remove from favorites
      isFavorite = toggleFavorite(dashboard.id, "user-1");
      expect(isFavorite).toBe(false);
    });

    it("should return false when dashboard does not exist", () => {
      const isFavorite = toggleFavorite("non-existent", "user-1");
      expect(isFavorite).toBe(false);
    });
  });
});
