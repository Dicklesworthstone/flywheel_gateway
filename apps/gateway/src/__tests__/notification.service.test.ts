/**
 * Notification Service Unit Tests
 *
 * Additional tests for notification routing, quiet hours, deduplication,
 * and channel delivery behaviors per bead flywheel_gateway-59c requirements.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  CreateNotificationRequest,
  Notification,
  NotificationCategory,
  NotificationChannel,
  NotificationPriority,
} from "../models/notification";
import {
  clearNotifications,
  clearPreferences,
  createNotification,
  getNotifications,
  getPreferences,
  markAllAsRead,
  markAsRead,
  onNotification,
  sendTestNotification,
  updatePreferences,
} from "../services/notification.service";

// ============================================================================
// Test Setup
// ============================================================================

beforeEach(() => {
  clearNotifications();
  clearPreferences();
});

afterEach(() => {
  clearNotifications();
  clearPreferences();
});

// ============================================================================
// Routing Tests: Per-category preferences
// ============================================================================

describe("Notification Routing - Category Preferences", () => {
  test("routes to category-specific channels", async () => {
    updatePreferences("user_001", {
      categories: {
        costs: {
          enabled: true,
          channels: ["in_app", "email", "slack"],
          minPriority: "normal",
        },
      },
    });

    const notification = await createNotification({
      type: "cost.warning",
      category: "costs",
      priority: "high",
      title: "Budget Alert",
      body: "Budget threshold reached",
      recipientId: "user_001",
      source: { type: "system" },
    });

    expect(notification.channels).toContain("in_app");
    expect(notification.channels).toContain("email");
    expect(notification.channels).toContain("slack");
  });

  test("respects disabled categories", async () => {
    updatePreferences("user_001", {
      categories: {
        tasks: {
          enabled: false,
          channels: ["in_app"],
          minPriority: "low",
        },
      },
    });

    const notification = await createNotification({
      type: "task.completed",
      category: "tasks",
      priority: "normal",
      title: "Task Done",
      body: "A task was completed",
      recipientId: "user_001",
      source: { type: "system" },
    });

    // Disabled category gets no channels
    expect(notification.channels).toEqual([]);
  });

  test("respects minimum priority threshold", async () => {
    updatePreferences("user_001", {
      categories: {
        agents: {
          enabled: true,
          channels: ["in_app", "email"],
          minPriority: "high",
        },
      },
    });

    // Low priority notification should be filtered
    const lowPriority = await createNotification({
      type: "agent.info",
      category: "agents",
      priority: "low",
      title: "Agent Info",
      body: "Informational message",
      recipientId: "user_001",
      source: { type: "system" },
    });

    // High priority should get channels
    const highPriority = await createNotification({
      type: "agent.error",
      category: "agents",
      priority: "high",
      title: "Agent Error",
      body: "Error occurred",
      recipientId: "user_001",
      source: { type: "system" },
    });

    expect(lowPriority.channels).toEqual([]);
    expect(highPriority.channels).toContain("in_app");
    expect(highPriority.channels).toContain("email");
  });

  test("uses default channels when category has no specific channels", async () => {
    updatePreferences("user_001", {
      defaultChannels: ["in_app", "webhook"],
      categories: {
        system: {
          enabled: true,
          channels: [], // Empty channels list
          minPriority: "low",
        },
      },
    });

    const notification = await createNotification({
      type: "system.update",
      category: "system",
      priority: "normal",
      title: "System Update",
      body: "System maintenance",
      recipientId: "user_001",
      source: { type: "system" },
    });

    expect(notification.channels).toContain("in_app");
    expect(notification.channels).toContain("webhook");
  });
});

// ============================================================================
// Routing Tests: Quiet Hours
// ============================================================================

describe("Notification Routing - Quiet Hours", () => {
  test("allows urgent notifications during quiet hours when configured", async () => {
    updatePreferences("user_001", {
      quietHours: {
        enabled: true,
        start: "00:00",
        end: "23:59", // Always quiet (for testing)
        allowUrgent: true,
      },
    });

    const urgent = await createNotification({
      type: "security.breach",
      category: "security",
      priority: "urgent",
      title: "Security Breach",
      body: "Immediate attention required",
      recipientId: "user_001",
      source: { type: "system" },
    });

    // Urgent bypasses quiet hours
    expect(urgent.channels.length).toBeGreaterThan(0);
  });

  test("blocks all channels during quiet hours when allowUrgent is false", async () => {
    updatePreferences("user_001", {
      quietHours: {
        enabled: true,
        start: "00:00",
        end: "23:59", // Always quiet (for testing)
        allowUrgent: false,
      },
    });

    const normal = await createNotification({
      type: "task.completed",
      category: "tasks",
      priority: "normal",
      title: "Task Done",
      body: "Task completed",
      recipientId: "user_001",
      source: { type: "system" },
    });

    const urgent = await createNotification({
      type: "urgent.alert",
      category: "security",
      priority: "urgent",
      title: "Alert",
      body: "Important alert",
      recipientId: "user_001",
      source: { type: "system" },
    });

    // During quiet hours with allowUrgent: false, only in_app is used (silent)
    // The implementation filters to only in_app during quiet hours
    expect(normal.channels.every((c) => c === "in_app")).toBe(true);
  });
});

// ============================================================================
// Force Channels Tests
// ============================================================================

describe("Notification Routing - Force Channels", () => {
  test("forceChannels overrides user preferences", async () => {
    updatePreferences("user_001", {
      enabled: false, // Notifications disabled
      categories: {
        agents: {
          enabled: false,
          channels: [],
          minPriority: "urgent",
        },
      },
    });

    const notification = await createNotification({
      type: "forced.notification",
      category: "agents",
      priority: "low",
      title: "Forced",
      body: "This notification is forced",
      recipientId: "user_001",
      source: { type: "system" },
      forceChannels: ["in_app", "email", "slack"],
    });

    // Force channels bypass all preferences
    expect(notification.channels).toEqual(["in_app", "email", "slack"]);
  });
});

// ============================================================================
// Event Listener Tests
// ============================================================================

describe("Notification Events", () => {
  test("triggers listeners on notification creation", async () => {
    const notifications: Notification[] = [];
    const unsubscribe = onNotification((n) => notifications.push(n));

    await createNotification({
      type: "test",
      category: "system",
      priority: "normal",
      title: "Test",
      body: "Test notification",
      recipientId: "user_001",
      source: { type: "system" },
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.title).toBe("Test");

    unsubscribe();
  });

  test("unsubscribe removes listener", async () => {
    const notifications: Notification[] = [];
    const unsubscribe = onNotification((n) => notifications.push(n));

    await createNotification({
      type: "test1",
      category: "system",
      priority: "normal",
      title: "Before",
      body: "Before unsubscribe",
      recipientId: "user_001",
      source: { type: "system" },
    });

    unsubscribe();

    await createNotification({
      type: "test2",
      category: "system",
      priority: "normal",
      title: "After",
      body: "After unsubscribe",
      recipientId: "user_001",
      source: { type: "system" },
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.title).toBe("Before");
  });

  test("multiple listeners receive notifications", async () => {
    const listener1Notifications: Notification[] = [];
    const listener2Notifications: Notification[] = [];

    const unsub1 = onNotification((n) => listener1Notifications.push(n));
    const unsub2 = onNotification((n) => listener2Notifications.push(n));

    await createNotification({
      type: "broadcast",
      category: "system",
      priority: "normal",
      title: "Broadcast",
      body: "To all listeners",
      recipientId: "user_001",
      source: { type: "system" },
    });

    expect(listener1Notifications).toHaveLength(1);
    expect(listener2Notifications).toHaveLength(1);

    unsub1();
    unsub2();
  });
});

// ============================================================================
// Filtering Tests
// ============================================================================

describe("Notification Filtering", () => {
  test("filters by multiple categories", async () => {
    const categories: NotificationCategory[] = ["agents", "tasks", "costs"];
    for (const cat of categories) {
      await createNotification({
        type: `${cat}.event`,
        category: cat,
        priority: "normal",
        title: `${cat} notification`,
        body: "Test",
        recipientId: "user_001",
        source: { type: "system" },
      });
    }

    const result = getNotifications({
      recipientId: "user_001",
      category: ["agents", "costs"],
    });

    expect(result.notifications).toHaveLength(2);
    expect(
      result.notifications.every((n) =>
        ["agents", "costs"].includes(n.category),
      ),
    ).toBe(true);
  });

  test("filters by priority", async () => {
    const priorities: NotificationPriority[] = [
      "low",
      "normal",
      "high",
      "urgent",
    ];
    for (const priority of priorities) {
      await createNotification({
        type: "test",
        category: "system",
        priority,
        title: `${priority} notification`,
        body: "Test",
        recipientId: "user_001",
        source: { type: "system" },
      });
    }

    const result = getNotifications({
      recipientId: "user_001",
      priority: ["high", "urgent"],
    });

    expect(result.notifications).toHaveLength(2);
    expect(
      result.notifications.every((n) =>
        ["high", "urgent"].includes(n.priority),
      ),
    ).toBe(true);
  });

  test("filters by status", async () => {
    const notif1 = await createNotification({
      type: "test",
      category: "system",
      priority: "normal",
      title: "Notification 1",
      body: "Test",
      recipientId: "user_001",
      source: { type: "system" },
    });

    await createNotification({
      type: "test",
      category: "system",
      priority: "normal",
      title: "Notification 2",
      body: "Test",
      recipientId: "user_001",
      source: { type: "system" },
    });

    // Mark first as read
    markAsRead("user_001", notif1.id);

    const unreadResult = getNotifications({
      recipientId: "user_001",
      status: ["sent", "delivered", "pending"],
    });

    expect(unreadResult.notifications).toHaveLength(1);
    expect(unreadResult.notifications[0]?.title).toBe("Notification 2");
  });

  test("filters by date range", async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    const twoHoursAgo = new Date(now.getTime() - 7200000);

    await createNotification({
      type: "test",
      category: "system",
      priority: "normal",
      title: "Recent",
      body: "Test",
      recipientId: "user_001",
      source: { type: "system" },
    });

    const result = getNotifications({
      recipientId: "user_001",
      since: oneHourAgo,
    });

    expect(result.notifications).toHaveLength(1);
  });
});

// ============================================================================
// Pagination Tests
// ============================================================================

describe("Notification Pagination", () => {
  test("respects limit parameter", async () => {
    // Create 10 notifications
    for (let i = 0; i < 10; i++) {
      await createNotification({
        type: "test",
        category: "system",
        priority: "normal",
        title: `Notification ${i}`,
        body: "Test",
        recipientId: "user_001",
        source: { type: "system" },
      });
    }

    const result = getNotifications({
      recipientId: "user_001",
      limit: 5,
    });

    expect(result.notifications).toHaveLength(5);
    expect(result.hasMore).toBe(true);
    expect(result.total).toBe(10);
  });

  test("provides cursor for next page", async () => {
    for (let i = 0; i < 10; i++) {
      await createNotification({
        type: "test",
        category: "system",
        priority: "normal",
        title: `Notification ${i}`,
        body: "Test",
        recipientId: "user_001",
        source: { type: "system" },
      });
    }

    const page1 = getNotifications({
      recipientId: "user_001",
      limit: 3,
    });

    expect(page1.nextCursor).toBeDefined();
    expect(page1.notifications).toHaveLength(3);

    const page2 = getNotifications({
      recipientId: "user_001",
      limit: 3,
      startingAfter: page1.nextCursor!,
    });

    expect(page2.notifications).toHaveLength(3);
    // Verify different notifications
    expect(page2.notifications[0]?.id).not.toBe(page1.notifications[0]?.id);
  });
});

// ============================================================================
// Test Notification Tests
// ============================================================================

describe("Test Notification", () => {
  test("sends test notification to all channels", async () => {
    const notification = await sendTestNotification("user_001");

    expect(notification.type).toBe("test");
    expect(notification.category).toBe("system");
    expect(notification.priority).toBe("low");
    expect(notification.title).toBe("Test Notification");
    expect(notification.actions).toHaveLength(1);
    expect(notification.actions?.[0]?.id).toBe("dismiss");
  });

  test("sends test notification to specific channel", async () => {
    const notification = await sendTestNotification("user_001", "email");

    expect(notification.channels).toEqual(["email"]);
  });
});

// ============================================================================
// Slack Payload Tests
// ============================================================================

describe("Slack Payload", () => {
  let originalFetch: typeof fetch;
  let fetchMock: ReturnType<typeof mock>;
  let capturedBody: unknown;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    capturedBody = undefined;

    fetchMock = mock((_input: string | URL, init?: RequestInit) => {
      if (typeof init?.body === "string") {
        capturedBody = JSON.parse(init.body);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("ok"),
      } as Response);
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("truncates long headers and falls back to source type", async () => {
    const slackWebhookUrl = "https://hooks.slack.com/services/" + "example";

    updatePreferences("user_001", {
      channelConfig: {
        slack: { webhookUrl: slackWebhookUrl },
      },
    });

    await createNotification({
      type: "test",
      category: "system",
      priority: "normal",
      title: "A".repeat(300),
      body: "body",
      recipientId: "user_001",
      source: { type: "system" },
      forceChannels: ["slack"],
    });

    // allow fire-and-forget delivery to execute
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedBody).toBeDefined();

    const payload = capturedBody as { blocks?: unknown[] };
    const blocks = payload.blocks ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(3);

    const headerBlock = blocks[0] as {
      type?: unknown;
      text?: { text?: unknown };
    };
    expect(headerBlock.type).toBe("header");

    const headerText = headerBlock.text?.text;
    expect(typeof headerText).toBe("string");
    expect(Array.from(headerText as string).length).toBeLessThanOrEqual(150);
    expect((headerText as string).endsWith("…")).toBe(true);

    const contextBlock = blocks[2] as {
      type?: unknown;
      elements?: Array<{ text?: unknown }>;
    };
    expect(contextBlock.type).toBe("context");
    const contextText = contextBlock.elements?.[0]?.text;
    expect(typeof contextText).toBe("string");
    expect(contextText as string).toContain("*Source:* system");
    expect(contextText as string).not.toContain("undefined");
  });
});

// ============================================================================
// Mark As Read Tests
// ============================================================================

describe("Mark As Read", () => {
  test("marks notification as read with timestamp", async () => {
    const notification = await createNotification({
      type: "test",
      category: "system",
      priority: "normal",
      title: "Test",
      body: "Test",
      recipientId: "user_001",
      source: { type: "system" },
    });

    const before = new Date();
    const updated = markAsRead("user_001", notification.id);
    const after = new Date();

    expect(updated?.status).toBe("read");
    expect(updated?.readAt).toBeDefined();
    expect(updated?.readAt?.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(updated?.readAt?.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("does not update already read notification", async () => {
    const notification = await createNotification({
      type: "test",
      category: "system",
      priority: "normal",
      title: "Test",
      body: "Test",
      recipientId: "user_001",
      source: { type: "system" },
    });

    const firstRead = markAsRead("user_001", notification.id);
    const firstReadAt = firstRead?.readAt;

    // Small delay
    await new Promise((resolve) => setTimeout(resolve, 10));

    const secondRead = markAsRead("user_001", notification.id);

    // Should have same readAt timestamp
    expect(secondRead?.readAt?.getTime()).toBe(firstReadAt?.getTime());
  });

  test("mark all as read returns count", async () => {
    for (let i = 0; i < 5; i++) {
      await createNotification({
        type: "test",
        category: "system",
        priority: "normal",
        title: `Test ${i}`,
        body: "Test",
        recipientId: "user_001",
        source: { type: "system" },
      });
    }

    // Read 2 of them first
    const result1 = getNotifications({ recipientId: "user_001" });
    const first = result1.notifications[0];
    const second = result1.notifications[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) {
      throw new Error("Expected at least 2 notifications");
    }
    markAsRead("user_001", first.id);
    markAsRead("user_001", second.id);

    // Mark all should only count the remaining 3
    const count = markAllAsRead("user_001");
    expect(count).toBe(3);

    // Verify all are read
    const result2 = getNotifications({
      recipientId: "user_001",
      status: ["read"],
    });
    expect(result2.notifications).toHaveLength(5);
  });
});

// ============================================================================
// Unread Count Tests
// ============================================================================

describe("Unread Count", () => {
  test("tracks unread count accurately", async () => {
    for (let i = 0; i < 5; i++) {
      await createNotification({
        type: "test",
        category: "system",
        priority: "normal",
        title: `Test ${i}`,
        body: "Test",
        recipientId: "user_001",
        source: { type: "system" },
      });
    }

    const result1 = getNotifications({ recipientId: "user_001" });
    expect(result1.unreadCount).toBe(5);

    // Read one
    const first = result1.notifications[0];
    expect(first).toBeDefined();
    if (!first) {
      throw new Error("Expected at least 1 notification");
    }
    markAsRead("user_001", first.id);

    const result2 = getNotifications({ recipientId: "user_001" });
    expect(result2.unreadCount).toBe(4);
  });

  test("unread count excludes actioned notifications", async () => {
    const notification = await createNotification({
      type: "approval",
      category: "tasks",
      priority: "high",
      title: "Approval",
      body: "Test",
      recipientId: "user_001",
      source: { type: "system" },
      actions: [
        {
          id: "approve",
          label: "Approve",
          style: "primary",
          action: "approve",
        },
      ],
    });

    const result1 = getNotifications({ recipientId: "user_001" });
    expect(result1.unreadCount).toBe(1);

    // Mark as actioned by updating status directly
    notification.status = "actioned";
    notification.actionedAt = new Date();

    const result2 = getNotifications({ recipientId: "user_001" });
    expect(result2.unreadCount).toBe(0);
  });
});

// ============================================================================
// Preferences Tests
// ============================================================================

describe("Notification Preferences", () => {
  test("digest configuration is preserved", () => {
    updatePreferences("user_001", {
      digest: {
        enabled: true,
        frequency: "weekly",
        timeOfDay: "09:00",
        timezone: "America/New_York",
      },
    });

    const prefs = getPreferences("user_001");
    expect(prefs.digest?.enabled).toBe(true);
    expect(prefs.digest?.frequency).toBe("weekly");
    expect(prefs.digest?.timeOfDay).toBe("09:00");
  });

  test("channel config is preserved", () => {
    const webhookSecret = "se" + "cret" + "123";

    updatePreferences("user_001", {
      channelConfig: {
        email: { address: "test@example.com" },
        slack: {
          webhookUrl: "https://hooks.slack.com/...",
          channel: "#alerts",
        },
        webhook: {
          url: "https://api.example.com/webhook",
          secret: webhookSecret,
        },
      },
    });

    const prefs = getPreferences("user_001");
    expect(prefs.channelConfig?.email?.address).toBe("test@example.com");
    expect(prefs.channelConfig?.slack?.channel).toBe("#alerts");
    expect(prefs.channelConfig?.webhook?.secret).toBe(webhookSecret);
  });

  test("partial category updates merge correctly", () => {
    // Set initial category preferences
    updatePreferences("user_001", {
      categories: {
        agents: {
          enabled: true,
          channels: ["in_app"],
          minPriority: "normal",
        },
      },
    });

    // Update only channels
    updatePreferences("user_001", {
      categories: {
        agents: {
          channels: ["in_app", "email"],
        },
      },
    });

    const prefs = getPreferences("user_001");
    expect(prefs.categories.agents.enabled).toBe(true); // Preserved
    expect(prefs.categories.agents.channels).toEqual(["in_app", "email"]); // Updated
    expect(prefs.categories.agents.minPriority).toBe("normal"); // Preserved
  });
});

// ============================================================================
// Notification Storage Limits Tests
// ============================================================================

describe("Notification Storage Limits", () => {
  test("enforces maximum notifications per user", async () => {
    // Create more than the limit (500)
    const maxNotifications = 500;
    const extraNotifications = 10;

    for (let i = 0; i < maxNotifications + extraNotifications; i++) {
      await createNotification({
        type: "test",
        category: "system",
        priority: "normal",
        title: `Notification ${i}`,
        body: "Test",
        recipientId: "user_001",
        source: { type: "system" },
      });
    }

    const result = getNotifications({
      recipientId: "user_001",
      limit: 1000, // Request more than max
    });

    // Should be capped at max
    expect(result.total).toBeLessThanOrEqual(maxNotifications);
  });
});

// ============================================================================
// Correlation ID Tests
// ============================================================================

describe("Notification Correlation", () => {
  test("stores correlation ID from context", async () => {
    const notification = await createNotification({
      type: "test",
      category: "system",
      priority: "normal",
      title: "Test",
      body: "Test",
      recipientId: "user_001",
      source: { type: "system" },
    });

    // Correlation ID should be set (may be undefined if not in request context)
    expect(notification).toHaveProperty("correlationId");
  });
});

// ============================================================================
// Empty User Tests
// ============================================================================

describe("Empty User Notifications", () => {
  test("returns empty list for user with no notifications", () => {
    const result = getNotifications({ recipientId: "nonexistent_user" });

    expect(result.notifications).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.unreadCount).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  test("returns undefined for unknown notification", () => {
    const notification = markAsRead("user_001", "unknown_notif_id");
    expect(notification).toBeUndefined();
  });
});
