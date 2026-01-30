/**
 * Notifications Routes - REST API endpoints for notification management.
 *
 * Provides endpoints for:
 * - Listing and filtering notifications
 * - Marking notifications as read
 * - Executing notification actions
 * - Managing notification preferences
 * - Sending test notifications
 */

import { type Context, Hono } from "hono";
import type { AuthContext } from "../ws/hub";
import { z } from "zod";
import { getLogger } from "../middleware/correlation";
import type {
  CreateNotificationRequest,
  Notification,
  NotificationCategory,
  NotificationFilter,
  NotificationPriority,
  NotificationStatus,
  PreferencesUpdateRequest,
} from "../models/notification";
import {
  createNotification,
  executeAction,
  getNotification,
  getNotifications,
  getPreferences,
  markAllAsRead,
  markAsRead,
  sendTestNotification,
  updatePreferences,
} from "../services/notification.service";
import {
  sendError,
  sendInternalError,
  sendList,
  sendNotFound,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";

const notifications = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const ActionSchema = z.object({
  actionId: z.string().min(1, "Action ID is required"),
});

const PreferencesUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  defaultChannels: z
    .array(z.enum(["in_app", "email", "slack", "webhook"]))
    .optional(),
  quietHours: z
    .object({
      enabled: z.boolean().optional(),
      start: z
        .string()
        .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Must be HH:MM format")
        .optional(),
      end: z
        .string()
        .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Must be HH:MM format")
        .optional(),
      timezone: z.string().optional(),
      allowUrgent: z.boolean().optional(),
    })
    .optional(),
  categories: z
    .record(
      z.enum([
        "agents",
        "coordination",
        "tasks",
        "costs",
        "security",
        "system",
      ]),
      z.object({
        enabled: z.boolean().optional(),
        channels: z
          .array(z.enum(["in_app", "email", "slack", "webhook"]))
          .optional(),
        minPriority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      }),
    )
    .optional(),
  digest: z
    .object({
      enabled: z.boolean().optional(),
      frequency: z.enum(["daily", "weekly"]).optional(),
      timeOfDay: z
        .string()
        .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Must be HH:MM format")
        .optional(),
      timezone: z.string().optional(),
    })
    .optional(),
  channelConfig: z
    .object({
      email: z.object({ address: z.string().email().optional() }).optional(),
      slack: z
        .object({
          webhookUrl: z.string().url().optional(),
          channel: z.string().optional(),
        })
        .optional(),
      webhook: z
        .object({
          url: z.string().url().optional(),
          secret: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

const TestNotificationSchema = z.object({
  channel: z.enum(["in_app", "email", "slack", "webhook"]).optional(),
});

const CreateNotificationSchema = z.object({
  type: z.string().min(1),
  category: z.enum([
    "agents",
    "coordination",
    "tasks",
    "costs",
    "security",
    "system",
  ]),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  recipientId: z.string().min(1),
  source: z.object({
    type: z.enum(["agent", "system", "bead", "user", "scheduler"]),
    id: z.string().optional(),
    name: z.string().optional(),
  }),
  actions: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        description: z.string().optional(),
        style: z.enum(["primary", "secondary", "danger", "link"]),
        action: z.string().min(1),
        payload: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
  link: z.string().url().optional(),
  forceChannels: z
    .array(z.enum(["in_app", "email", "slack", "webhook"]))
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ============================================================================
// Helper Functions
// ============================================================================

function handleError(error: unknown, c: Context) {
  const log = getLogger();

  if (error instanceof z.ZodError) {
    return sendValidationError(c, transformZodError(error));
  }

  log.error({ error }, "Unexpected error in notifications route");
  return sendInternalError(c);
}

function parseArrayQuery<T extends string>(
  value: string | undefined,
): T[] | undefined {
  return value ? (value.split(",") as T[]) : undefined;
}

function parseDateQuery(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function safeParseInt(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function serializeNotification(notification: Notification) {
  return {
    ...notification,
    createdAt: notification.createdAt.toISOString(),
    ...(notification.sentAt && {
      sentAt: notification.sentAt.toISOString(),
    }),
    ...(notification.deliveredAt && {
      deliveredAt: notification.deliveredAt.toISOString(),
    }),
    ...(notification.readAt && {
      readAt: notification.readAt.toISOString(),
    }),
    ...(notification.actionedAt && {
      actionedAt: notification.actionedAt.toISOString(),
    }),
  };
}

function resolveUserId(
  c: Context,
  paramName: "user_id" | "recipient_id",
): string | Response {
  const auth = c.get("auth") as AuthContext | undefined;
  const requested = c.req.query(paramName);

  if (!auth) {
    if (!requested) {
      return sendError(c, "INVALID_REQUEST", `${paramName} is required`, 400);
    }
    return requested;
  }

  if (auth.isAdmin) {
    if (requested) return requested;
    if (auth.userId) return auth.userId;
    return sendError(c, "INVALID_REQUEST", `${paramName} is required`, 400);
  }

  if (!auth.userId) {
    return sendError(
      c,
      "AUTH_INSUFFICIENT_SCOPE",
      "User identity required",
      403,
    );
  }

  if (requested && requested !== auth.userId) {
    return sendError(
      c,
      "AUTH_INSUFFICIENT_SCOPE",
      "Cannot access another user's data",
      403,
    );
  }

  return auth.userId;
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /notifications - List notifications for a user
 *
 * Query parameters:
 * - recipient_id: User ID (required)
 * - category: Filter by category (comma-separated)
 * - priority: Filter by priority (comma-separated)
 * - status: Filter by status (comma-separated)
 * - since: Filter by created date (ISO 8601)
 * - until: Filter by created date (ISO 8601)
 * - limit: Max results (default: 50)
 * - starting_after: Cursor for pagination
 * - ending_before: Cursor for pagination
 */
notifications.get("/", (c) => {
  try {
    const recipientId = resolveUserId(c, "recipient_id");
    if (recipientId instanceof Response) return recipientId;

    // Build filter
    const filter: NotificationFilter = {
      recipientId,
      limit: safeParseInt(c.req.query("limit"), 50),
    };

    const categoryParam = parseArrayQuery<NotificationCategory>(
      c.req.query("category"),
    );
    if (categoryParam) filter.category = categoryParam;

    const priorityParam = parseArrayQuery<NotificationPriority>(
      c.req.query("priority"),
    );
    if (priorityParam) filter.priority = priorityParam;

    const statusParam = parseArrayQuery<NotificationStatus>(
      c.req.query("status"),
    );
    if (statusParam) filter.status = statusParam;

    const sinceParam = parseDateQuery(c.req.query("since"));
    if (sinceParam) filter.since = sinceParam;

    const untilParam = parseDateQuery(c.req.query("until"));
    if (untilParam) filter.until = untilParam;

    const startingAfterParam = c.req.query("starting_after");
    if (startingAfterParam) filter.startingAfter = startingAfterParam;

    const endingBeforeParam = c.req.query("ending_before");
    if (endingBeforeParam) filter.endingBefore = endingBeforeParam;

    const result = getNotifications(filter);

    const serializedNotifications = result.notifications.map(
      serializeNotification,
    );

    const listOptions: Parameters<typeof sendList>[2] = {
      hasMore: result.hasMore,
      total: result.total,
    };
    if (result.nextCursor) listOptions.nextCursor = result.nextCursor;
    if (result.prevCursor) listOptions.prevCursor = result.prevCursor;

    // Add unread count to response metadata
    return sendList(c, serializedNotifications, {
      ...listOptions,
      unreadCount: result.unreadCount,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /notifications/preferences - Get user preferences
 */
notifications.get("/preferences", (c) => {
  try {
    const userId = resolveUserId(c, "user_id");
    if (userId instanceof Response) return userId;

    const prefs = getPreferences(userId);

    return sendResource(c, "notification_preferences", {
      ...prefs,
      updatedAt: prefs.updatedAt.toISOString(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * PUT /notifications/preferences - Update user preferences
 */
notifications.put("/preferences", async (c) => {
  try {
    const userId = resolveUserId(c, "user_id");
    if (userId instanceof Response) return userId;

    const body = await c.req.json();
    const parsed = PreferencesUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const prefs = updatePreferences(
      userId,
      parsed.data as PreferencesUpdateRequest,
    );

    return sendResource(c, "notification_preferences", {
      ...prefs,
      updatedAt: prefs.updatedAt.toISOString(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /notifications/:id - Get a specific notification
 */
notifications.get("/:id", (c) => {
  try {
    const id = c.req.param("id");
    const recipientId = resolveUserId(c, "recipient_id");
    if (recipientId instanceof Response) return recipientId;

    const notification = getNotification(recipientId, id);
    if (!notification) {
      return sendNotFound(c, "notification", id);
    }

    return sendResource(c, "notification", serializeNotification(notification));
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /notifications/:id/read - Mark a notification as read
 */
notifications.post("/:id/read", (c) => {
  try {
    const id = c.req.param("id");
    const recipientId = resolveUserId(c, "recipient_id");
    if (recipientId instanceof Response) return recipientId;

    const notification = markAsRead(recipientId, id);
    if (!notification) {
      return sendNotFound(c, "notification", id);
    }

    return sendResource(c, "notification", serializeNotification(notification));
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /notifications/read-all - Mark all notifications as read
 */
notifications.post("/read-all", (c) => {
  try {
    const recipientId = resolveUserId(c, "recipient_id");
    if (recipientId instanceof Response) return recipientId;

    const count = markAllAsRead(recipientId);

    return sendResource(c, "read_result", {
      markedCount: count,
      recipientId,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /notifications/:id/action - Execute an action on a notification
 */
notifications.post("/:id/action", async (c) => {
  try {
    const id = c.req.param("id");
    const recipientId = resolveUserId(c, "recipient_id");
    if (recipientId instanceof Response) return recipientId;

    const body = await c.req.json();
    const parsed = ActionSchema.safeParse(body);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const result = executeAction(recipientId, id, parsed.data.actionId);
    if (!result) {
      return sendNotFound(c, "notification or action", id);
    }

    return sendResource(c, "action_result", {
      notification: serializeNotification(result.notification),
      executedAction: result.action,
    });
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /notifications/test - Send a test notification
 */
notifications.post("/test", async (c) => {
  try {
    const recipientId = resolveUserId(c, "recipient_id");
    if (recipientId instanceof Response) return recipientId;

    const body = await c.req.json().catch(() => ({}));
    const parsed = TestNotificationSchema.safeParse(body);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const notification = await sendTestNotification(
      recipientId,
      parsed.data.channel,
    );

    return sendResource(
      c,
      "notification",
      serializeNotification(notification),
      201,
    );
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * POST /notifications - Create a notification (internal/admin use)
 */
notifications.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = CreateNotificationSchema.safeParse(body);

    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }

    const notification = await createNotification(
      parsed.data as CreateNotificationRequest,
    );

    return sendResource(
      c,
      "notification",
      serializeNotification(notification),
      201,
    );
  } catch (error) {
    return handleError(error, c);
  }
});

export { notifications };
