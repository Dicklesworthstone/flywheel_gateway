/**
 * Notification Service
 *
 * Comprehensive notification system with multi-channel delivery,
 * user preferences, quiet hours, and actionable notifications.
 */

import {
  createCursor,
  DEFAULT_PAGINATION,
  decodeCursor,
} from "@flywheel/shared/api/pagination";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  type CreateNotificationRequest,
  DEFAULT_PREFERENCES,
  type Notification,
  type NotificationAction,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationFilter,
  type NotificationListResponse,
  type NotificationPreferences,
  PRIORITY_ORDER,
  type PreferencesUpdateRequest,
} from "../models/notification";
import type { Channel } from "../ws/channels";
import { getHub } from "../ws/hub";
import type { MessageType } from "../ws/messages";
import { logger } from "./logger";

// ============================================================================
// Storage (in-memory for now, would be database in production)
// ============================================================================

/** User notifications by recipient ID */
const notificationsByUser = new Map<string, Notification[]>();

/** User preferences by user ID */
const preferencesByUser = new Map<string, NotificationPreferences>();

/** Maximum notifications per user */
const MAX_NOTIFICATIONS_PER_USER = 500;

/** Notification event listeners */
type NotificationListener = (notification: Notification) => void;
const listeners: NotificationListener[] = [];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a unique notification ID.
 */
function generateNotificationId(): string {
  const randomBytes = new Uint8Array(6);
  crypto.getRandomValues(randomBytes);
  const random = Array.from(randomBytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 8);
  return `notif_${Date.now()}_${random}`;
}

/**
 * Parse HH:MM time string to minutes since midnight.
 */
function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/**
 * Get current time as minutes since midnight.
 */
function getCurrentMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Check if current time is within quiet hours.
 */
function isInQuietHours(prefs: NotificationPreferences): boolean {
  if (!prefs.quietHours?.enabled) return false;

  const start = parseTimeToMinutes(prefs.quietHours.start);
  const end = parseTimeToMinutes(prefs.quietHours.end);
  const current = getCurrentMinutes();

  // Handle overnight quiet hours (e.g., 22:00 - 08:00)
  if (start > end) {
    return current >= start || current < end;
  }
  return current >= start && current < end;
}

/**
 * Determine which channels to use for a notification.
 */
function resolveChannels(
  request: CreateNotificationRequest,
  prefs: NotificationPreferences,
): NotificationChannel[] {
  // If channels are forced, use those
  if (request.forceChannels?.length) {
    return request.forceChannels;
  }

  // If notifications are disabled, return empty
  if (!prefs.enabled) {
    return [];
  }

  // Get category preferences
  const categoryPref = prefs.categories[request.category];
  if (!categoryPref?.enabled) {
    return [];
  }

  // Check minimum priority
  const requestPriorityValue = PRIORITY_ORDER[request.priority];
  const minPriorityValue = PRIORITY_ORDER[categoryPref.minPriority];
  if (requestPriorityValue < minPriorityValue) {
    return [];
  }

  // Check quiet hours (allow urgent to bypass if configured)
  if (isInQuietHours(prefs)) {
    if (request.priority !== "urgent" || !prefs.quietHours?.allowUrgent) {
      // During quiet hours, only allow in_app (silent)
      return categoryPref.channels.filter((c) => c === "in_app");
    }
  }

  // Use category-specific channels, or fall back to defaults
  return categoryPref.channels.length > 0
    ? categoryPref.channels
    : prefs.defaultChannels;
}

function serializeNotification(
  notification: Notification,
): Record<string, unknown> {
  return {
    ...notification,
    createdAt: notification.createdAt.toISOString(),
    ...(notification.sentAt && { sentAt: notification.sentAt.toISOString() }),
    ...(notification.deliveredAt && {
      deliveredAt: notification.deliveredAt.toISOString(),
    }),
    ...(notification.readAt && { readAt: notification.readAt.toISOString() }),
    ...(notification.actionedAt && {
      actionedAt: notification.actionedAt.toISOString(),
    }),
  };
}

function publishNotificationEvent(notification: Notification): void {
  const hub = getHub();
  const channel: Channel = {
    type: "user:notifications",
    userId: notification.recipientId,
  };
  hub.publish(
    channel,
    "notification.created" as MessageType,
    serializeNotification(notification),
    { userId: notification.recipientId },
  );
}

// ============================================================================
// Channel Delivery (stubs for external channels)
// ============================================================================

/**
 * Send notification via email channel.
 */
async function sendEmailNotification(
  notification: Notification,
  prefs: NotificationPreferences,
): Promise<boolean> {
  const log = getLogger();
  const email = prefs.channelConfig?.email?.address;

  if (!email) {
    log.debug(
      { notificationId: notification.id },
      "[NOTIFY] Email channel: no email configured",
    );
    return false;
  }

  // TODO: Integrate with Resend or other email provider
  log.warn(
    { notificationId: notification.id, email, title: notification.title },
    "[NOTIFY] Email channel: SIMULATION - would send email (provider not configured)",
  );
  return true;
}

/**
 * Build Slack message payload with Block Kit formatting.
 */
function buildSlackPayload(notification: Notification): {
  text: string;
  blocks: Array<Record<string, unknown>>;
} {
  const priorityEmoji: Record<string, string> = {
    urgent: "🚨",
    high: "🔴",
    medium: "🟡",
    low: "🟢",
  };

  const emoji = priorityEmoji[notification.priority] ?? "📢";
  const fallbackText = `${emoji} ${notification.title}: ${notification.body}`;

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${emoji} ${notification.title}`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: notification.body,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*Category:* ${notification.category} | *Priority:* ${notification.priority} | *Source:* ${notification.source.name}`,
        },
      ],
    },
  ];

  // Add action buttons if present
  if (notification.actions?.length) {
    blocks.push({
      type: "actions",
      elements: notification.actions.slice(0, 5).map((action) => ({
        type: "button",
        text: {
          type: "plain_text",
          text: action.label,
          emoji: true,
        },
        action_id: action.id,
        ...(action.style === "danger" ? { style: "danger" } : {}),
        ...(action.style === "primary" ? { style: "primary" } : {}),
      })),
    });
  }

  // Add link if present
  if (notification.link) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `<${notification.link}|View details →>`,
      },
    });
  }

  return { text: fallbackText, blocks };
}

/**
 * Send notification via Slack channel.
 */
async function sendSlackNotification(
  notification: Notification,
  prefs: NotificationPreferences,
): Promise<boolean> {
  const log = getLogger();
  const webhookUrl = prefs.channelConfig?.slack?.webhookUrl;

  if (!webhookUrl) {
    log.debug(
      { notificationId: notification.id },
      "[NOTIFY] Slack channel: no webhook configured",
    );
    return false;
  }

  try {
    const payload = buildSlackPayload(notification);

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error(
        {
          notificationId: notification.id,
          status: response.status,
          error: errorText,
        },
        "[NOTIFY] Slack webhook request failed",
      );
      return false;
    }

    log.info(
      { notificationId: notification.id, title: notification.title },
      "[NOTIFY] Slack notification sent successfully",
    );
    return true;
  } catch (error) {
    log.error(
      { notificationId: notification.id, error: String(error) },
      "[NOTIFY] Slack webhook request error",
    );
    return false;
  }
}

/**
 * Compute HMAC-SHA256 signature for webhook payload.
 */
async function computeHmacSignature(
  payload: string,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Send notification via webhook channel.
 */
async function sendWebhookNotification(
  notification: Notification,
  prefs: NotificationPreferences,
): Promise<boolean> {
  const log = getLogger();
  const webhookConfig = prefs.channelConfig?.webhook;
  const webhookUrl = webhookConfig?.url;

  if (!webhookUrl) {
    log.debug(
      { notificationId: notification.id },
      "[NOTIFY] Webhook channel: no URL configured",
    );
    return false;
  }

  try {
    const payload = {
      id: notification.id,
      type: notification.type,
      category: notification.category,
      priority: notification.priority,
      title: notification.title,
      body: notification.body,
      recipientId: notification.recipientId,
      source: notification.source,
      link: notification.link,
      actions: notification.actions,
      metadata: notification.metadata,
      createdAt: notification.createdAt.toISOString(),
      correlationId: notification.correlationId,
    };

    const payloadJson = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Flywheel-Notification-Id": notification.id,
      "X-Flywheel-Event": "notification.created",
    };

    // Add HMAC signature if secret is configured
    if (webhookConfig.secret) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signaturePayload = `${timestamp}.${payloadJson}`;
      const signature = await computeHmacSignature(
        signaturePayload,
        webhookConfig.secret,
      );
      headers["X-Flywheel-Timestamp"] = timestamp;
      headers["X-Flywheel-Signature"] = `sha256=${signature}`;
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: payloadJson,
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error(
        {
          notificationId: notification.id,
          url: webhookUrl,
          status: response.status,
          error: errorText,
        },
        "[NOTIFY] Webhook request failed",
      );
      return false;
    }

    log.info(
      { notificationId: notification.id, url: webhookUrl },
      "[NOTIFY] Webhook notification sent successfully",
    );
    return true;
  } catch (error) {
    log.error(
      {
        notificationId: notification.id,
        url: webhookUrl,
        error: String(error),
      },
      "[NOTIFY] Webhook request error",
    );
    return false;
  }
}

/**
 * Deliver notification to specified channels.
 */
async function deliverToChannels(
  notification: Notification,
  channels: NotificationChannel[],
  prefs: NotificationPreferences,
): Promise<void> {
  const log = getLogger();
  const channelStatus: Record<NotificationChannel, "sent" | "failed"> =
    {} as Record<NotificationChannel, "sent" | "failed">;

  for (const channel of channels) {
    try {
      let success = false;

      switch (channel) {
        case "in_app":
          // In-app is already stored, mark as sent
          success = true;
          break;
        case "email":
          success = await sendEmailNotification(notification, prefs);
          break;
        case "slack":
          success = await sendSlackNotification(notification, prefs);
          break;
        case "webhook":
          success = await sendWebhookNotification(notification, prefs);
          break;
      }

      channelStatus[channel] = success ? "sent" : "failed";
    } catch (error) {
      log.error(
        { error, channel, notificationId: notification.id },
        "[NOTIFY] Channel delivery failed",
      );
      channelStatus[channel] = "failed";
    }
  }

  // Update notification with channel status
  notification.channelStatus = channelStatus as Record<
    NotificationChannel,
    "pending" | "sent" | "delivered" | "read" | "actioned" | "failed"
  >;
  notification.sentAt = new Date();

  // Update overall status
  const allFailed = Object.values(channelStatus).every((s) => s === "failed");
  notification.status = allFailed ? "failed" : "sent";
}

// ============================================================================
// Core Service Functions
// ============================================================================

/**
 * Create and send a notification.
 */
export async function createNotification(
  request: CreateNotificationRequest,
): Promise<Notification> {
  const log = getLogger();
  const correlationId = getCorrelationId();

  // Get or create user preferences
  const prefs = getPreferences(request.recipientId);

  // Resolve which channels to use
  const channels = resolveChannels(request, prefs);

  // Create notification object
  const notification: Notification = {
    id: generateNotificationId(),
    type: request.type,
    category: request.category,
    priority: request.priority,
    title: request.title,
    body: request.body,
    recipientId: request.recipientId,
    source: request.source,
    status: "pending",
    channels,
    createdAt: new Date(),
    correlationId,
  };

  // Add optional fields
  if (request.actions) notification.actions = request.actions;
  if (request.link) notification.link = request.link;
  if (request.metadata) notification.metadata = request.metadata;

  // Store notification
  let userNotifications = notificationsByUser.get(request.recipientId);
  if (!userNotifications) {
    userNotifications = [];
    notificationsByUser.set(request.recipientId, userNotifications);
  }

  // Add to beginning (most recent first)
  userNotifications.unshift(notification);

  // Trim if over limit
  if (userNotifications.length > MAX_NOTIFICATIONS_PER_USER) {
    userNotifications.pop();
  }

  publishNotificationEvent(notification);

  log.info(
    {
      type: "notification:created",
      notificationId: notification.id,
      recipientId: request.recipientId,
      category: request.category,
      priority: request.priority,
      channels,
      correlationId,
    },
    `[NOTIFY] Created notification: ${request.title}`,
  );

  // Deliver to channels (async, don't block)
  if (channels.length > 0) {
    deliverToChannels(notification, channels, prefs).catch((error) => {
      log.error(
        { error, notificationId: notification.id },
        "[NOTIFY] Delivery failed",
      );
    });
  } else {
    notification.status = "sent"; // No channels, but recorded
  }

  // Notify listeners
  for (const listener of listeners) {
    try {
      listener(notification);
    } catch (error) {
      logger.error(
        { error, notificationId: notification.id },
        "[NOTIFY] Listener threw error",
      );
    }
  }

  return notification;
}

/**
 * Get notifications for a user.
 */
export function getNotifications(
  filter: NotificationFilter,
): NotificationListResponse {
  const recipientId = filter.recipientId;
  if (!recipientId) {
    return {
      notifications: [],
      hasMore: false,
      total: 0,
      unreadCount: 0,
    };
  }

  let notifications = notificationsByUser.get(recipientId) ?? [];

  // Apply filters
  if (filter.category?.length) {
    notifications = notifications.filter((n) =>
      filter.category?.includes(n.category),
    );
  }
  if (filter.priority?.length) {
    notifications = notifications.filter((n) =>
      filter.priority?.includes(n.priority),
    );
  }
  if (filter.status?.length) {
    notifications = notifications.filter((n) =>
      filter.status?.includes(n.status),
    );
  }
  if (filter.since) {
    notifications = notifications.filter((n) => n.createdAt >= filter.since!);
  }
  if (filter.until) {
    notifications = notifications.filter((n) => n.createdAt <= filter.until!);
  }

  // Count unread
  const unreadCount = notifications.filter(
    (n) => n.status !== "read" && n.status !== "actioned",
  ).length;

  const total = notifications.length;
  const limit = filter.limit ?? DEFAULT_PAGINATION.limit;
  let startIndex = 0;

  // Handle cursor-based pagination
  if (filter.startingAfter) {
    const decoded = decodeCursor(filter.startingAfter);
    if (decoded) {
      const cursorIndex = notifications.findIndex((n) => n.id === decoded.id);
      if (cursorIndex >= 0) {
        startIndex = cursorIndex + 1;
      }
    }
  } else if (filter.endingBefore) {
    const decoded = decodeCursor(filter.endingBefore);
    if (decoded) {
      const cursorIndex = notifications.findIndex((n) => n.id === decoded.id);
      if (cursorIndex >= 0) {
        startIndex = Math.max(0, cursorIndex - limit);
      }
    }
  }

  // Get page items
  const pageItems = notifications.slice(startIndex, startIndex + limit + 1);
  const hasMore = pageItems.length > limit;
  const resultItems = hasMore ? pageItems.slice(0, limit) : pageItems;

  const result: NotificationListResponse = {
    notifications: resultItems,
    hasMore,
    total,
    unreadCount,
  };

  // Add cursors if there are results
  if (resultItems.length > 0) {
    const lastItem = resultItems[resultItems.length - 1]!;
    const firstItem = resultItems[0]!;

    if (hasMore) {
      result.nextCursor = createCursor(lastItem.id);
    }
    if (startIndex > 0) {
      result.prevCursor = createCursor(firstItem.id);
    }
  }

  return result;
}

/**
 * Get a notification by ID.
 */
export function getNotification(
  recipientId: string,
  notificationId: string,
): Notification | undefined {
  const notifications = notificationsByUser.get(recipientId);
  return notifications?.find((n) => n.id === notificationId);
}

/**
 * Mark a notification as read.
 */
export function markAsRead(
  recipientId: string,
  notificationId: string,
): Notification | undefined {
  const notification = getNotification(recipientId, notificationId);
  if (!notification) return undefined;

  if (notification.status !== "read" && notification.status !== "actioned") {
    notification.status = "read";
    notification.readAt = new Date();

    const log = getLogger();
    log.debug({ notificationId, recipientId }, "[NOTIFY] Marked as read");
  }

  return notification;
}

/**
 * Mark all notifications as read for a user.
 */
export function markAllAsRead(recipientId: string): number {
  const notifications = notificationsByUser.get(recipientId);
  if (!notifications) return 0;

  let count = 0;
  const now = new Date();

  for (const notification of notifications) {
    if (notification.status !== "read" && notification.status !== "actioned") {
      notification.status = "read";
      notification.readAt = now;
      count++;
    }
  }

  const log = getLogger();
  log.info({ recipientId, count }, "[NOTIFY] Marked all as read");

  return count;
}

/**
 * Execute an action on a notification.
 */
export function executeAction(
  recipientId: string,
  notificationId: string,
  actionId: string,
): { notification: Notification; action: NotificationAction } | undefined {
  const notification = getNotification(recipientId, notificationId);
  if (!notification) return undefined;

  const action = notification.actions?.find((a) => a.id === actionId);
  if (!action) return undefined;

  notification.status = "actioned";
  notification.actionedAt = new Date();
  notification.actionId = actionId;

  const log = getLogger();
  log.info(
    { notificationId, recipientId, actionId, action: action.action },
    "[NOTIFY] Action executed",
  );

  return { notification, action };
}

// ============================================================================
// Preferences Management
// ============================================================================

function createDefaultPreferences(userId: string): NotificationPreferences {
  const categories = Object.fromEntries(
    Object.entries(DEFAULT_PREFERENCES.categories).map(([category, pref]) => [
      category,
      { ...pref, channels: [...pref.channels] },
    ]),
  ) as NotificationPreferences["categories"];

  const prefs: NotificationPreferences = {
    userId,
    enabled: DEFAULT_PREFERENCES.enabled,
    defaultChannels: [...DEFAULT_PREFERENCES.defaultChannels],
    categories,
    updatedAt: new Date(),
  };

  if (DEFAULT_PREFERENCES.quietHours) {
    prefs.quietHours = { ...DEFAULT_PREFERENCES.quietHours };
  }
  if (DEFAULT_PREFERENCES.digest) {
    prefs.digest = { ...DEFAULT_PREFERENCES.digest };
  }
  if (DEFAULT_PREFERENCES.channelConfig) {
    prefs.channelConfig = {
      ...DEFAULT_PREFERENCES.channelConfig,
      ...(DEFAULT_PREFERENCES.channelConfig.email
        ? { email: { ...DEFAULT_PREFERENCES.channelConfig.email } }
        : {}),
      ...(DEFAULT_PREFERENCES.channelConfig.slack
        ? { slack: { ...DEFAULT_PREFERENCES.channelConfig.slack } }
        : {}),
      ...(DEFAULT_PREFERENCES.channelConfig.webhook
        ? { webhook: { ...DEFAULT_PREFERENCES.channelConfig.webhook } }
        : {}),
    };
  }

  return prefs;
}

/**
 * Get user preferences, creating defaults if needed.
 */
export function getPreferences(userId: string): NotificationPreferences {
  let prefs = preferencesByUser.get(userId);
  if (!prefs) {
    prefs = createDefaultPreferences(userId);
    preferencesByUser.set(userId, prefs);
  }
  return prefs;
}

/**
 * Update user preferences.
 */
export function updatePreferences(
  userId: string,
  update: PreferencesUpdateRequest,
): NotificationPreferences {
  const prefs = getPreferences(userId);

  // Apply updates
  if (update.enabled !== undefined) {
    prefs.enabled = update.enabled;
  }
  if (update.defaultChannels) {
    prefs.defaultChannels = update.defaultChannels;
  }
  if (update.quietHours) {
    prefs.quietHours = {
      ...prefs.quietHours,
      enabled: prefs.quietHours?.enabled ?? false,
      start: prefs.quietHours?.start ?? "22:00",
      end: prefs.quietHours?.end ?? "08:00",
      allowUrgent: prefs.quietHours?.allowUrgent ?? true,
      ...update.quietHours,
    };
  }
  if (update.categories) {
    for (const [category, categoryUpdate] of Object.entries(
      update.categories,
    )) {
      const cat = category as NotificationCategory;
      if (prefs.categories[cat] && categoryUpdate) {
        prefs.categories[cat] = {
          ...prefs.categories[cat],
          ...categoryUpdate,
        };
      }
    }
  }
  if (update.digest) {
    prefs.digest = {
      ...prefs.digest,
      enabled: prefs.digest?.enabled ?? false,
      frequency: prefs.digest?.frequency ?? "daily",
      timeOfDay: prefs.digest?.timeOfDay ?? "09:00",
      ...update.digest,
    };
  }
  if (update.channelConfig) {
    prefs.channelConfig = {
      ...prefs.channelConfig,
      ...update.channelConfig,
    };
  }

  prefs.updatedAt = new Date();

  const log = getLogger();
  log.info({ userId, update }, "[NOTIFY] Preferences updated");

  return prefs;
}

// ============================================================================
// Event Listeners
// ============================================================================

/**
 * Register a notification listener.
 */
export function onNotification(listener: NotificationListener): () => void {
  listeners.push(listener);
  return () => {
    const index = listeners.indexOf(listener);
    if (index >= 0) {
      listeners.splice(index, 1);
    }
  };
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Clear all notifications (for testing).
 */
export function clearNotifications(): void {
  notificationsByUser.clear();
}

/**
 * Clear all preferences (for testing).
 */
export function clearPreferences(): void {
  preferencesByUser.clear();
}

/**
 * Send a test notification.
 */
export async function sendTestNotification(
  recipientId: string,
  channel?: NotificationChannel,
): Promise<Notification> {
  const request: CreateNotificationRequest = {
    type: "test",
    category: "system",
    priority: "low",
    title: "Test Notification",
    body: "This is a test notification to verify your notification settings are working correctly.",
    recipientId,
    source: { type: "system", name: "notification-test" },
    actions: [
      {
        id: "dismiss",
        label: "Dismiss",
        style: "secondary",
        action: "dismiss",
      },
    ],
  };
  if (channel !== undefined) {
    request.forceChannels = [channel];
  }
  return createNotification(request);
}
