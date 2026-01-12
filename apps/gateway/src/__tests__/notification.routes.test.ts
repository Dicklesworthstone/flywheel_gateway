/**
 * Notification Routes Tests
 *
 * Tests for the notification system REST API endpoints and service.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { notifications } from "../routes/notifications";
import {
  clearNotifications,
  clearPreferences,
  createNotification,
  getPreferences,
  updatePreferences,
} from "../services/notification.service";

// ============================================================================
// Test Setup
// ============================================================================

const app = new Hono();
app.route("/notifications", notifications);

beforeEach(() => {
  clearNotifications();
  clearPreferences();
});

afterEach(() => {
  clearNotifications();
  clearPreferences();
});

// ============================================================================
// Service Tests
// ============================================================================

describe("Notification Service", () => {
  describe("createNotification", () => {
    test("creates notification with all required fields", async () => {
      const notification = await createNotification({
        type: "agent.completed",
        category: "agents",
        priority: "normal",
        title: "Agent Completed",
        body: "Your agent session has completed successfully.",
        recipientId: "user_123",
        source: { type: "agent", id: "agent_456", name: "test-agent" },
      });

      expect(notification.id).toMatch(/^notif_\d+_[a-z0-9]+$/);
      expect(notification.type).toBe("agent.completed");
      expect(notification.category).toBe("agents");
      expect(notification.priority).toBe("normal");
      expect(notification.title).toBe("Agent Completed");
      expect(notification.body).toBe("Your agent session has completed successfully.");
      expect(notification.recipientId).toBe("user_123");
      expect(notification.source.type).toBe("agent");
      expect(notification.channels).toContain("in_app");
      expect(notification.createdAt).toBeInstanceOf(Date);
    });

    test("creates notification with actions", async () => {
      const notification = await createNotification({
        type: "approval.required",
        category: "tasks",
        priority: "high",
        title: "Approval Required",
        body: "An action requires your approval.",
        recipientId: "user_123",
        source: { type: "system" },
        actions: [
          { id: "approve", label: "Approve", style: "primary", action: "approve" },
          { id: "reject", label: "Reject", style: "danger", action: "reject" },
        ],
      });

      expect(notification.actions).toHaveLength(2);
      expect(notification.actions?.[0]?.id).toBe("approve");
      expect(notification.actions?.[1]?.id).toBe("reject");
    });

    test("creates notification with forced channels", async () => {
      const notification = await createNotification({
        type: "urgent",
        category: "security",
        priority: "urgent",
        title: "Security Alert",
        body: "Suspicious activity detected.",
        recipientId: "user_123",
        source: { type: "system" },
        forceChannels: ["in_app", "email"],
      });

      expect(notification.channels).toEqual(["in_app", "email"]);
    });
  });

  describe("getPreferences", () => {
    test("returns default preferences for new user", () => {
      const prefs = getPreferences("new_user");

      expect(prefs.userId).toBe("new_user");
      expect(prefs.enabled).toBe(true);
      expect(prefs.defaultChannels).toEqual(["in_app"]);
      expect(prefs.categories.agents.enabled).toBe(true);
      expect(prefs.categories.agents.channels).toEqual(["in_app"]);
    });
  });

  describe("updatePreferences", () => {
    test("updates notification preferences", () => {
      const prefs = updatePreferences("user_123", {
        enabled: false,
        defaultChannels: ["in_app", "email"],
      });

      expect(prefs.enabled).toBe(false);
      expect(prefs.defaultChannels).toEqual(["in_app", "email"]);
    });

    test("updates quiet hours", () => {
      const prefs = updatePreferences("user_123", {
        quietHours: {
          enabled: true,
          start: "22:00",
          end: "08:00",
          allowUrgent: true,
        },
      });

      expect(prefs.quietHours?.enabled).toBe(true);
      expect(prefs.quietHours?.start).toBe("22:00");
      expect(prefs.quietHours?.end).toBe("08:00");
      expect(prefs.quietHours?.allowUrgent).toBe(true);
    });

    test("updates category preferences", () => {
      const prefs = updatePreferences("user_123", {
        categories: {
          costs: {
            enabled: true,
            channels: ["in_app", "email", "slack"],
            minPriority: "low",
          },
        },
      });

      expect(prefs.categories.costs.channels).toEqual(["in_app", "email", "slack"]);
      expect(prefs.categories.costs.minPriority).toBe("low");
    });
  });
});

// ============================================================================
// Route Tests
// ============================================================================

describe("Notification Routes", () => {
  describe("GET /notifications", () => {
    test("returns notifications for user", async () => {
      // Create some notifications first
      await createNotification({
        type: "test",
        category: "agents",
        priority: "normal",
        title: "Test 1",
        body: "Body 1",
        recipientId: "user_123",
        source: { type: "system" },
      });
      await createNotification({
        type: "test",
        category: "tasks",
        priority: "high",
        title: "Test 2",
        body: "Body 2",
        recipientId: "user_123",
        source: { type: "system" },
      });

      const res = await app.request("/notifications?recipient_id=user_123");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(2);
      expect(body.total).toBe(2);
      // unreadCount is passed through but may not be in base wrapList
      // Check hasMore instead
      expect(body.hasMore).toBe(false);
    });

    test("requires recipient_id", async () => {
      const res = await app.request("/notifications");

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_REQUEST");
    });

    test("filters by category", async () => {
      await createNotification({
        type: "test",
        category: "agents",
        priority: "normal",
        title: "Agent",
        body: "Body",
        recipientId: "user_123",
        source: { type: "system" },
      });
      await createNotification({
        type: "test",
        category: "tasks",
        priority: "normal",
        title: "Task",
        body: "Body",
        recipientId: "user_123",
        source: { type: "system" },
      });

      const res = await app.request(
        "/notifications?recipient_id=user_123&category=agents",
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].category).toBe("agents");
    });
  });

  describe("GET /notifications/:id", () => {
    test("returns notification by id", async () => {
      const notification = await createNotification({
        type: "test",
        category: "agents",
        priority: "normal",
        title: "Test",
        body: "Body",
        recipientId: "user_123",
        source: { type: "system" },
      });

      const res = await app.request(
        `/notifications/${notification.id}?recipient_id=user_123`,
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(notification.id);
      expect(body.data.title).toBe("Test");
    });

    test("returns 404 for unknown notification", async () => {
      const res = await app.request(
        "/notifications/notif_unknown?recipient_id=user_123",
      );

      expect(res.status).toBe(404);
    });
  });

  describe("POST /notifications/:id/read", () => {
    test("marks notification as read", async () => {
      const notification = await createNotification({
        type: "test",
        category: "agents",
        priority: "normal",
        title: "Test",
        body: "Body",
        recipientId: "user_123",
        source: { type: "system" },
      });

      const res = await app.request(
        `/notifications/${notification.id}/read?recipient_id=user_123`,
        { method: "POST" },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.status).toBe("read");
      expect(body.data.readAt).toBeDefined();
    });
  });

  describe("POST /notifications/read-all", () => {
    test("marks all notifications as read", async () => {
      await createNotification({
        type: "test",
        category: "agents",
        priority: "normal",
        title: "Test 1",
        body: "Body",
        recipientId: "user_123",
        source: { type: "system" },
      });
      await createNotification({
        type: "test",
        category: "agents",
        priority: "normal",
        title: "Test 2",
        body: "Body",
        recipientId: "user_123",
        source: { type: "system" },
      });

      const res = await app.request(
        "/notifications/read-all?recipient_id=user_123",
        { method: "POST" },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.markedCount).toBe(2);
    });
  });

  describe("POST /notifications/:id/action", () => {
    test("executes action on notification", async () => {
      const notification = await createNotification({
        type: "approval",
        category: "tasks",
        priority: "high",
        title: "Approval",
        body: "Needs approval",
        recipientId: "user_123",
        source: { type: "system" },
        actions: [
          { id: "approve", label: "Approve", style: "primary", action: "approve" },
        ],
      });

      const res = await app.request(
        `/notifications/${notification.id}/action?recipient_id=user_123`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actionId: "approve" }),
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.notification.status).toBe("actioned");
      expect(body.data.executedAction.id).toBe("approve");
    });
  });

  describe("GET /notifications/preferences", () => {
    test("returns user preferences", async () => {
      const res = await app.request("/notifications/preferences?user_id=user_123");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.userId).toBe("user_123");
      expect(body.data.enabled).toBe(true);
    });
  });

  describe("PUT /notifications/preferences", () => {
    test("updates user preferences", async () => {
      const res = await app.request("/notifications/preferences?user_id=user_123", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: false,
          quietHours: {
            enabled: true,
            start: "23:00",
            end: "07:00",
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.enabled).toBe(false);
      expect(body.data.quietHours.enabled).toBe(true);
      expect(body.data.quietHours.start).toBe("23:00");
    });

    test("validates time format", async () => {
      const res = await app.request("/notifications/preferences?user_id=user_123", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quietHours: {
            start: "invalid",
          },
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("POST /notifications/test", () => {
    test("sends test notification", async () => {
      const res = await app.request("/notifications/test?recipient_id=user_123", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.type).toBe("test");
      expect(body.data.title).toBe("Test Notification");
    });
  });

  describe("POST /notifications", () => {
    test("creates notification via API", async () => {
      const res = await app.request("/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "custom",
          category: "system",
          priority: "normal",
          title: "Custom Notification",
          body: "This is a custom notification created via API.",
          recipientId: "user_123",
          source: { type: "system", name: "api" },
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.title).toBe("Custom Notification");
      expect(body.data.recipientId).toBe("user_123");
    });

    test("validates request body", async () => {
      const res = await app.request("/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "test",
          // Missing required fields
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_FAILED");
    });
  });
});
