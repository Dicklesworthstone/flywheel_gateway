/**
 * Notification Data Model
 *
 * Defines types for the comprehensive notification system with
 * multi-channel delivery, user preferences, and actionable notifications.
 */

/**
 * Notification priority levels.
 */
export type NotificationPriority = "low" | "normal" | "high" | "urgent";

/**
 * Notification categories for preference management.
 */
export type NotificationCategory =
  | "agents"
  | "coordination"
  | "tasks"
  | "costs"
  | "security"
  | "system";

/**
 * Delivery channels for notifications.
 */
export type NotificationChannel = "in_app" | "email" | "slack" | "webhook";

/**
 * Notification status for tracking delivery.
 */
export type NotificationStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "actioned"
  | "failed";

/**
 * Source of a notification.
 */
export interface NotificationSource {
  type: "agent" | "system" | "bead" | "user" | "scheduler";
  id?: string;
  name?: string;
}

/**
 * An action that can be taken on a notification.
 */
export interface NotificationAction {
  id: string;
  label: string;
  description?: string;
  style: "primary" | "secondary" | "danger" | "link";
  /** Action handler identifier */
  action: string;
  /** Optional payload for the action */
  payload?: Record<string, unknown>;
}

/**
 * A notification instance.
 */
export interface Notification {
  id: string;
  type: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  body: string;
  recipientId: string;
  source: NotificationSource;
  actions?: NotificationAction[];
  /** Optional deep link */
  link?: string;
  status: NotificationStatus;
  /** Channels this notification was sent to */
  channels: NotificationChannel[];
  /** Channel-specific delivery status */
  channelStatus?: Record<NotificationChannel, NotificationStatus>;
  createdAt: Date;
  sentAt?: Date;
  deliveredAt?: Date;
  readAt?: Date;
  actionedAt?: Date;
  /** ID of the action that was taken */
  actionId?: string;
  /** Error message if delivery failed */
  error?: string;
  /** Correlation ID for tracing */
  correlationId?: string;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Quiet hours configuration.
 */
export interface QuietHours {
  enabled: boolean;
  /** Start time in HH:MM format (24-hour) */
  start: string;
  /** End time in HH:MM format (24-hour) */
  end: string;
  /** Timezone for the times (e.g., "America/New_York") */
  timezone?: string;
  /** Whether urgent notifications bypass quiet hours */
  allowUrgent: boolean;
}

/**
 * Per-category notification preferences.
 */
export interface CategoryPreference {
  enabled: boolean;
  channels: NotificationChannel[];
  /** Minimum priority to receive notifications */
  minPriority: NotificationPriority;
}

/**
 * Digest configuration for notification summaries.
 */
export interface DigestConfig {
  enabled: boolean;
  frequency: "daily" | "weekly";
  /** Time of day to send digest in HH:MM format (24-hour) */
  timeOfDay: string;
  /** Timezone for the time (e.g., "America/New_York") */
  timezone?: string;
}

/**
 * User notification preferences.
 */
export interface NotificationPreferences {
  userId: string;
  /** Master switch for all notifications */
  enabled: boolean;
  /** Default channels when not specified per-category */
  defaultChannels: NotificationChannel[];
  quietHours?: QuietHours;
  /** Per-category preferences */
  categories: Record<NotificationCategory, CategoryPreference>;
  digest?: DigestConfig;
  /** Channel-specific configuration */
  channelConfig?: {
    email?: { address?: string };
    slack?: { webhookUrl?: string; channel?: string };
    webhook?: { url?: string; secret?: string };
  };
  updatedAt: Date;
}

/**
 * Notification filter options.
 */
export interface NotificationFilter {
  recipientId?: string;
  category?: NotificationCategory[];
  priority?: NotificationPriority[];
  status?: NotificationStatus[];
  since?: Date;
  until?: Date;
  limit?: number;
  startingAfter?: string;
  endingBefore?: string;
}

/**
 * Paginated notification response.
 */
export interface NotificationListResponse {
  notifications: Notification[];
  hasMore: boolean;
  total: number;
  unreadCount: number;
  nextCursor?: string;
  prevCursor?: string;
}

/**
 * Request to create a notification.
 */
export interface CreateNotificationRequest {
  type: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  body: string;
  recipientId: string;
  source: NotificationSource;
  actions?: NotificationAction[];
  link?: string;
  /** Override channels (ignores user preferences) */
  forceChannels?: NotificationChannel[];
  metadata?: Record<string, unknown>;
}

/**
 * Notification preferences update request.
 */
export interface PreferencesUpdateRequest {
  enabled?: boolean;
  defaultChannels?: NotificationChannel[];
  quietHours?: Partial<QuietHours>;
  categories?: Partial<Record<NotificationCategory, Partial<CategoryPreference>>>;
  digest?: Partial<DigestConfig>;
  channelConfig?: NotificationPreferences["channelConfig"];
}

/**
 * Priority order for sorting (higher = more urgent).
 */
export const PRIORITY_ORDER: Record<NotificationPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

/**
 * Default preferences for new users.
 */
export const DEFAULT_PREFERENCES: Omit<NotificationPreferences, "userId" | "updatedAt"> = {
  enabled: true,
  defaultChannels: ["in_app"],
  categories: {
    agents: { enabled: true, channels: ["in_app"], minPriority: "normal" },
    coordination: { enabled: true, channels: ["in_app"], minPriority: "normal" },
    tasks: { enabled: true, channels: ["in_app"], minPriority: "low" },
    costs: { enabled: true, channels: ["in_app", "email"], minPriority: "high" },
    security: { enabled: true, channels: ["in_app", "email"], minPriority: "low" },
    system: { enabled: true, channels: ["in_app"], minPriority: "high" },
  },
};
