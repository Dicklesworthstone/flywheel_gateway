/**
 * Dashboard Service Tests
 */

import { beforeEach, describe, expect, it } from "bun:test";
import type {
  CreateDashboardInput,
  Widget,
  WidgetType,
} from "@flywheel/shared";
import {
  addWidget,
  clearDashboardStore,
  createDashboard,
  deleteDashboard,
  duplicateDashboard,
  getDashboard,
  grantPermission,
  listDashboards,
  removeWidget,
  revokePermission,
  toggleFavorite,
  updateDashboard,
  updateSharing,
  updateWidget,
} from "../services/dashboard.service";

describe("Dashboard Service", () => {
  beforeEach(async () => {
    await clearDashboardStore();
  });

  describe("createDashboard", () => {
    it("should create a dashboard with default values", async () => {
      const input: CreateDashboardInput = {
        name: "Test Dashboard",
      };

      const dashboard = await createDashboard(input, "user-1");

      expect(dashboard.id).toBeDefined();
      expect(dashboard.name).toBe("Test Dashboard");
      expect(dashboard.ownerId).toBe("user-1");
      expect(dashboard.widgets).toEqual([]);
      expect(dashboard.layout.columns).toBe(12);
      expect(dashboard.sharing.visibility).toBe("private");
    });

    it("should create a dashboard with custom layout", async () => {
      const input: CreateDashboardInput = {
        name: "Custom Layout Dashboard",
        layout: {
          columns: 24,
          rowHeight: 100,
        },
      };

      const dashboard = await createDashboard(input, "user-1");

      expect(dashboard.layout.columns).toBe(24);
      expect(dashboard.layout.rowHeight).toBe(100);
    });

    it("should create a dashboard with initial widgets", async () => {
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

      const dashboard = await createDashboard(input, "user-1");

      expect(dashboard.widgets).toHaveLength(1);
      expect(dashboard.widgets[0]?.title).toBe("Test Widget");
    });

    it("should create a dashboard with custom sharing settings", async () => {
      const input: CreateDashboardInput = {
        name: "Public Dashboard",
        sharing: { visibility: "public" },
      };

      const dashboard = await createDashboard(input, "user-1");

      expect(dashboard.sharing.visibility).toBe("public");
    });

    it("should persist sharing viewers/editors", async () => {
      const input: CreateDashboardInput = {
        name: "Shared Dashboard",
        sharing: {
          visibility: "team",
          viewers: ["user-2", "user-3"],
          editors: ["user-4"],
        },
      };

      const dashboard = await createDashboard(input, "user-1");

      expect(dashboard.sharing.visibility).toBe("team");
      expect([...dashboard.sharing.viewers].sort()).toEqual(
        ["user-2", "user-3"].sort(),
      );
      expect([...dashboard.sharing.editors].sort()).toEqual(["user-4"]);
    });
  });

  describe("getDashboard", () => {
    it("should return dashboard by id", async () => {
      const created = await createDashboard({ name: "Test" }, "user-1");
      const retrieved = await getDashboard(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    it("should return undefined for non-existent dashboard", async () => {
      const dashboard = await getDashboard("non-existent");
      expect(dashboard).toBeUndefined();
    });
  });

  describe("updateDashboard", () => {
    it("should update dashboard properties", async () => {
      const created = await createDashboard({ name: "Original" }, "user-1");
      const updated = await updateDashboard(created.id, { name: "Updated" });

      expect(updated).toBeDefined();
      expect(updated?.name).toBe("Updated");
    });

    it("should update dashboard description", async () => {
      const created = await createDashboard({ name: "Test" }, "user-1");
      const updated = await updateDashboard(created.id, {
        description: "New description",
      });

      expect(updated?.description).toBe("New description");
    });

    it("should return undefined for non-existent dashboard", async () => {
      const updated = await updateDashboard("non-existent", {
        name: "Updated",
      });
      expect(updated).toBeUndefined();
    });

    it("should update layout settings", async () => {
      const created = await createDashboard({ name: "Test" }, "user-1");
      const updated = await updateDashboard(created.id, {
        layout: { columns: 24 },
      });

      expect(updated?.layout.columns).toBe(24);
      // Original values should be preserved
      expect(updated?.layout.rowHeight).toBe(80);
    });
  });

  describe("updateSharing", () => {
    it("should update viewers without removing editors", async () => {
      const created = await createDashboard(
        {
          name: "Test",
          sharing: { viewers: ["user-2"], editors: ["user-3"] },
        },
        "user-1",
      );

      const updated = await updateSharing(created.id, {
        viewers: ["user-4"],
      });

      expect(updated).toBeDefined();
      expect([...updated!.sharing.viewers].sort()).toEqual(["user-4"]);
      expect([...updated!.sharing.editors].sort()).toEqual(["user-3"]);
    });

    it("should replace viewers and editors when both provided", async () => {
      const created = await createDashboard(
        {
          name: "Test",
          sharing: { viewers: ["user-2"], editors: ["user-3"] },
        },
        "user-1",
      );

      const updated = await updateSharing(created.id, {
        viewers: ["user-5"],
        editors: ["user-6"],
      });

      expect(updated).toBeDefined();
      expect([...updated!.sharing.viewers].sort()).toEqual(["user-5"]);
      expect([...updated!.sharing.editors].sort()).toEqual(["user-6"]);
    });
  });

  describe("deleteDashboard", () => {
    it("should delete dashboard", async () => {
      const created = await createDashboard({ name: "To Delete" }, "user-1");
      const deleted = await deleteDashboard(created.id);

      expect(deleted).toBe(true);
      expect(await getDashboard(created.id)).toBeUndefined();
    });

    it("should return false for non-existent dashboard", async () => {
      const deleted = await deleteDashboard("non-existent");
      expect(deleted).toBe(false);
    });
  });

  describe("listDashboards", () => {
    it("should list all dashboards", async () => {
      await createDashboard({ name: "Dashboard 1" }, "user-1");
      await createDashboard({ name: "Dashboard 2" }, "user-1");
      await createDashboard({ name: "Dashboard 3" }, "user-2");

      const { items, total } = await listDashboards({});

      expect(items).toHaveLength(3);
      expect(total).toBe(3);
    });

    it("should filter by owner", async () => {
      await createDashboard({ name: "Dashboard 1" }, "user-1");
      await createDashboard({ name: "Dashboard 2" }, "user-1");
      await createDashboard({ name: "Dashboard 3" }, "user-2");

      const { items, total } = await listDashboards({ ownerId: "user-1" });

      expect(items).toHaveLength(2);
      expect(total).toBe(2);
    });

    it("should filter by visibility", async () => {
      await createDashboard({ name: "Private" }, "user-1");
      await createDashboard(
        { name: "Public", sharing: { visibility: "public" } },
        "user-2",
      );

      const { items, total } = await listDashboards({ visibility: "public" });
      expect(items).toHaveLength(1);
      expect(items[0]?.name).toBe("Public");
      expect(total).toBe(1);
    });
  });

  describe("duplicateDashboard", () => {
    it("should create a copy of the dashboard", async () => {
      const original = await createDashboard(
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

      const duplicate = await duplicateDashboard(original.id, "user-1");

      expect(duplicate).toBeDefined();
      expect(duplicate?.id).not.toBe(original.id);
      expect(duplicate?.name).toBe("Original (Copy)");
      expect(duplicate?.widgets).toHaveLength(1);
    });

    it("should allow custom name for duplicate", async () => {
      const original = await createDashboard({ name: "Original" }, "user-1");
      const duplicate = await duplicateDashboard(
        original.id,
        "user-1",
        "Custom Copy Name",
      );

      expect(duplicate?.name).toBe("Custom Copy Name");
    });

    it("should return undefined for non-existent dashboard", async () => {
      const duplicate = await duplicateDashboard("non-existent", "user-1");
      expect(duplicate).toBeUndefined();
    });
  });

  describe("Widget Operations", () => {
    it("should add a widget to dashboard", async () => {
      const dashboard = await createDashboard({ name: "Test" }, "user-1");
      const widget: Widget = {
        id: "new-widget",
        type: "line-chart" as WidgetType,
        title: "New Widget",
        position: { x: 0, y: 0, w: 6, h: 3 },
        config: { dataSource: { type: "api" } },
      };

      const updated = await addWidget(dashboard.id, widget);

      expect(updated).toBeDefined();
      expect(updated?.widgets).toHaveLength(1);
      expect(updated?.widgets[0]?.title).toBe("New Widget");
    });

    it("should generate widget id if not provided", async () => {
      const dashboard = await createDashboard({ name: "Test" }, "user-1");
      const widget = {
        id: "",
        type: "metric-card" as WidgetType,
        title: "Auto ID Widget",
        position: { x: 0, y: 0, w: 3, h: 2 },
        config: { dataSource: { type: "api" as const } },
      };

      const updated = await addWidget(dashboard.id, widget);

      expect(updated?.widgets[0]?.id).toBeTruthy();
      expect(updated?.widgets[0]?.id).not.toBe("");
    });

    it("should update a widget", async () => {
      const dashboard = await createDashboard(
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

      const updated = await updateWidget(dashboard.id, "w1", {
        title: "Updated Title",
      });

      expect(updated).toBeDefined();
      expect(updated?.widgets[0]?.title).toBe("Updated Title");
    });

    it("should return undefined when updating non-existent widget", async () => {
      const dashboard = await createDashboard({ name: "Test" }, "user-1");
      const updated = await updateWidget(dashboard.id, "non-existent", {
        title: "Updated",
      });

      expect(updated).toBeUndefined();
    });

    it("should remove a widget", async () => {
      const dashboard = await createDashboard(
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

      const updated = await removeWidget(dashboard.id, "w1");

      expect(updated).toBeDefined();
      expect(updated?.widgets).toHaveLength(0);
    });
  });

  describe("Permissions", () => {
    it("should grant view permission", async () => {
      const dashboard = await createDashboard({ name: "Test" }, "user-1");
      const permission = await grantPermission(dashboard.id, "user-2", "view");

      expect(permission).toBeDefined();
      expect(permission?.permission).toBe("view");
      expect(permission?.userId).toBe("user-2");
    });

    it("should grant edit permission", async () => {
      const dashboard = await createDashboard({ name: "Test" }, "user-1");
      const permission = await grantPermission(dashboard.id, "user-2", "edit");

      expect(permission).toBeDefined();
      expect(permission?.permission).toBe("edit");
    });

    it("should revoke permission", async () => {
      const dashboard = await createDashboard({ name: "Test" }, "user-1");
      await grantPermission(dashboard.id, "user-2", "view");
      const revoked = await revokePermission(dashboard.id, "user-2");

      expect(revoked).toBe(true);
    });

    it("should return false when revoking non-existent permission", async () => {
      const dashboard = await createDashboard({ name: "Test" }, "user-1");
      const revoked = await revokePermission(dashboard.id, "user-2");

      expect(revoked).toBe(false);
    });
  });

  describe("Favorites", () => {
    it("should toggle favorite status", async () => {
      const dashboard = await createDashboard({ name: "Test" }, "user-1");

      // Add to favorites
      let isFavorite = await toggleFavorite(dashboard.id, "user-1");
      expect(isFavorite).toBe(true);

      // Remove from favorites
      isFavorite = await toggleFavorite(dashboard.id, "user-1");
      expect(isFavorite).toBe(false);
    });

    it("should return false when dashboard does not exist", async () => {
      const isFavorite = await toggleFavorite("non-existent", "user-1");
      expect(isFavorite).toBe(false);
    });
  });
});
