/**
 * Notification hooks for API integration.
 *
 * Provides hooks for fetching notifications, managing preferences,
 * marking notifications as read, and executing notification actions.
 * Includes real-time WebSocket subscription support.
 */

import { useCallback, useEffect, useState } from "react";
import { useUiStore } from "../stores/ui";

// ============================================================================
// Types
// ============================================================================

export type NotificationPriority = "low" | "normal" | "high" | "urgent";

export type NotificationCategory =
  | "agents"
  | "coordination"
  | "tasks"
  | "costs"
  | "security"
  | "system";

export type NotificationChannel = "in_app" | "email" | "slack" | "webhook";

export type NotificationStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "actioned"
  | "failed";

export interface NotificationSource {
  type: "agent" | "system" | "bead" | "user" | "scheduler";
  id?: string;
  name?: string;
}

export interface NotificationAction {
  id: string;
  label: string;
  description?: string;
  style: "primary" | "secondary" | "danger" | "link";
  action: string;
  payload?: Record<string, unknown>;
}

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
  link?: string;
  status: NotificationStatus;
  channels: NotificationChannel[];
  channelStatus?: Record<NotificationChannel, NotificationStatus>;
  createdAt: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  actionedAt?: string;
  actionId?: string;
  error?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export interface QuietHours {
  enabled: boolean;
  start: string;
  end: string;
  timezone?: string;
  allowUrgent: boolean;
}

export interface CategoryPreference {
  enabled: boolean;
  channels: NotificationChannel[];
  minPriority: NotificationPriority;
}

export interface DigestConfig {
  enabled: boolean;
  frequency: "daily" | "weekly";
  timeOfDay: string;
  timezone?: string;
}

export interface NotificationPreferences {
  userId: string;
  enabled: boolean;
  defaultChannels: NotificationChannel[];
  quietHours?: QuietHours;
  categories: Record<NotificationCategory, CategoryPreference>;
  digest?: DigestConfig;
  channelConfig?: {
    email?: { address?: string };
    slack?: { webhookUrl?: string; channel?: string };
    webhook?: { url?: string; secret?: string };
  };
  updatedAt: string;
}

export interface NotificationFilter {
  recipientId?: string;
  category?: NotificationCategory[];
  priority?: NotificationPriority[];
  status?: NotificationStatus[];
  since?: string;
  until?: string;
  limit?: number;
  startingAfter?: string;
  endingBefore?: string;
}

export interface NotificationListResponse {
  data: Notification[];
  hasMore: boolean;
  total: number;
  unreadCount: number;
  nextCursor?: string;
  prevCursor?: string;
}

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
  forceChannels?: NotificationChannel[];
  metadata?: Record<string, unknown>;
}

export interface PreferencesUpdateRequest {
  enabled?: boolean;
  defaultChannels?: NotificationChannel[];
  quietHours?: Partial<QuietHours>;
  categories?: Partial<
    Record<NotificationCategory, Partial<CategoryPreference>>
  >;
  digest?: Partial<DigestConfig>;
  channelConfig?: NotificationPreferences["channelConfig"];
}

// ============================================================================
// Mock Data (used when mockMode is enabled or API unavailable)
// ============================================================================

const mockNotifications: Notification[] = [
  {
    id: "notif_001",
    type: "agent.error",
    category: "agents",
    priority: "high",
    title: "Agent ax7 encountered an error",
    body: "The agent failed to complete the task due to a rate limit. The operation will be retried automatically.",
    recipientId: "user_001",
    source: { type: "agent", id: "ax7", name: "Code Assistant" },
    actions: [
      {
        id: "retry",
        label: "Retry Now",
        style: "primary",
        action: "retry_agent",
      },
      {
        id: "dismiss",
        label: "Dismiss",
        style: "secondary",
        action: "dismiss",
      },
    ],
    link: "/agents/ax7",
    status: "delivered",
    channels: ["in_app"],
    createdAt: new Date(Date.now() - 300000).toISOString(),
    sentAt: new Date(Date.now() - 299000).toISOString(),
    deliveredAt: new Date(Date.now() - 298000).toISOString(),
  },
  {
    id: "notif_002",
    type: "cost.budget_warning",
    category: "costs",
    priority: "urgent",
    title: "Budget threshold reached (80%)",
    body: "Your team has used 80% of the monthly AI budget ($4,000 of $5,000). At the current rate, you will exceed the budget in 6 days.",
    recipientId: "user_001",
    source: { type: "system", name: "Cost Monitor" },
    actions: [
      {
        id: "view",
        label: "View Analytics",
        style: "primary",
        action: "navigate",
        payload: { url: "/analytics/costs" },
      },
      {
        id: "adjust",
        label: "Adjust Budget",
        style: "secondary",
        action: "navigate",
        payload: { url: "/settings/billing" },
      },
    ],
    status: "sent",
    channels: ["in_app", "email"],
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    sentAt: new Date(Date.now() - 3599000).toISOString(),
  },
  {
    id: "notif_003",
    type: "conflict.needs_review",
    category: "coordination",
    priority: "normal",
    title: "Merge conflict detected",
    body: "Agents ax7 and bp2 have conflicting changes to src/utils/helpers.ts. Manual review is recommended.",
    recipientId: "user_001",
    source: { type: "system", name: "Conflict Detector" },
    actions: [
      {
        id: "review",
        label: "Review Conflict",
        style: "primary",
        action: "navigate",
        payload: { url: "/conflicts/cf-123" },
      },
      {
        id: "auto",
        label: "Auto-resolve",
        style: "secondary",
        action: "auto_resolve_conflict",
      },
    ],
    link: "/conflicts/cf-123",
    status: "read",
    channels: ["in_app"],
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    readAt: new Date(Date.now() - 6000000).toISOString(),
  },
  {
    id: "notif_004",
    type: "bead.completed",
    category: "tasks",
    priority: "low",
    title: "Bead completed: Fix login bug",
    body: "The bead 'Fix login bug' (flywheel_gateway-abc) has been completed by agent ax7.",
    recipientId: "user_001",
    source: { type: "bead", id: "flywheel_gateway-abc", name: "Fix login bug" },
    link: "/beads/flywheel_gateway-abc",
    status: "read",
    channels: ["in_app"],
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    readAt: new Date(Date.now() - 80000000).toISOString(),
  },
  {
    id: "notif_005",
    type: "security.dcg_block",
    category: "security",
    priority: "high",
    title: "Destructive command blocked",
    body: "DCG blocked 'git reset --hard HEAD~5' from agent bp2. The command would have discarded 5 commits permanently.",
    recipientId: "user_001",
    source: { type: "system", name: "DCG" },
    actions: [
      {
        id: "review",
        label: "Review Block",
        style: "primary",
        action: "navigate",
        payload: { url: "/dcg" },
      },
      {
        id: "allow",
        label: "Allow Once",
        style: "danger",
        action: "dcg_allow_once",
      },
    ],
    link: "/dcg",
    status: "sent",
    channels: ["in_app", "slack"],
    createdAt: new Date(Date.now() - 1800000).toISOString(),
    sentAt: new Date(Date.now() - 1799000).toISOString(),
  },
];

const mockPreferences: NotificationPreferences = {
  userId: "user_001",
  enabled: true,
  defaultChannels: ["in_app"],
  quietHours: {
    enabled: true,
    start: "22:00",
    end: "08:00",
    timezone: "America/New_York",
    allowUrgent: true,
  },
  categories: {
    agents: { enabled: true, channels: ["in_app"], minPriority: "normal" },
    coordination: {
      enabled: true,
      channels: ["in_app"],
      minPriority: "normal",
    },
    tasks: { enabled: true, channels: ["in_app"], minPriority: "low" },
    costs: {
      enabled: true,
      channels: ["in_app", "email"],
      minPriority: "high",
    },
    security: {
      enabled: true,
      channels: ["in_app", "email", "slack"],
      minPriority: "low",
    },
    system: { enabled: true, channels: ["in_app"], minPriority: "high" },
  },
  digest: {
    enabled: true,
    frequency: "daily",
    timeOfDay: "09:00",
    timezone: "America/New_York",
  },
  channelConfig: {
    email: { address: "user@example.com" },
    slack: { webhookUrl: "https://hooks.slack.com/...", channel: "#alerts" },
  },
  updatedAt: new Date().toISOString(),
};

// ============================================================================
// API Helpers
// ============================================================================

const API_BASE = "/api/v1";

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message || `Request failed: ${res.status}`);
  }

  return res.json();
}

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Hook for fetching notifications with filtering and pagination.
 */
export function useNotifications(filter: NotificationFilter = {}) {
  const mockMode = useUiStore((state) => state.mockMode);
  const [data, setData] = useState<NotificationListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (mockMode) {
      // Simulate API delay
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Apply filters to mock data
      let filtered = [...mockNotifications];

      if (filter.category?.length) {
        filtered = filtered.filter((n) =>
          filter.category?.includes(n.category),
        );
      }
      if (filter.priority?.length) {
        filtered = filtered.filter((n) =>
          filter.priority?.includes(n.priority),
        );
      }
      if (filter.status?.length) {
        filtered = filtered.filter((n) => filter.status?.includes(n.status));
      }

      const unreadCount = filtered.filter(
        (n) => n.status !== "read" && n.status !== "actioned",
      ).length;

      setData({
        data: filtered,
        hasMore: false,
        total: filtered.length,
        unreadCount,
      });
      setLoading(false);
      return;
    }

    try {
      // Build query string
      const params = new URLSearchParams();
      if (filter.recipientId) params.set("recipient_id", filter.recipientId);
      if (filter.category?.length)
        params.set("category", filter.category.join(","));
      if (filter.priority?.length)
        params.set("priority", filter.priority.join(","));
      if (filter.status?.length) params.set("status", filter.status.join(","));
      if (filter.since) params.set("since", filter.since);
      if (filter.until) params.set("until", filter.until);
      if (filter.limit) params.set("limit", filter.limit.toString());
      if (filter.startingAfter)
        params.set("starting_after", filter.startingAfter);
      if (filter.endingBefore) params.set("ending_before", filter.endingBefore);

      const result = await fetchApi<NotificationListResponse>(
        `/notifications?${params.toString()}`,
      );
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setLoading(false);
    }
  }, [mockMode, filter]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

/**
 * Hook for fetching unread notification count.
 */
export function useUnreadCount(recipientId: string) {
  const mockMode = useUiStore((state) => state.mockMode);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (mockMode) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const unread = mockNotifications.filter(
        (n) => n.status !== "read" && n.status !== "actioned",
      ).length;
      setCount(unread);
      setLoading(false);
      return;
    }

    try {
      const result = await fetchApi<NotificationListResponse>(
        `/notifications?recipient_id=${recipientId}&limit=1`,
      );
      setCount(result.unreadCount ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setLoading(false);
    }
  }, [mockMode, recipientId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { count, loading, error, refetch };
}

/**
 * Hook for fetching notification preferences.
 */
export function useNotificationPreferences(userId: string) {
  const mockMode = useUiStore((state) => state.mockMode);
  const [data, setData] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (mockMode) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      setData(mockPreferences);
      setLoading(false);
      return;
    }

    try {
      const result = await fetchApi<{ data: NotificationPreferences }>(
        `/notifications/preferences?user_id=${userId}`,
      );
      setData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setLoading(false);
    }
  }, [mockMode, userId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook for marking a notification as read.
 */
export function useMarkAsRead() {
  const mockMode = useUiStore((state) => state.mockMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const markAsRead = useCallback(
    async (recipientId: string, notificationId: string) => {
      setLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        // Update mock data
        const notif = mockNotifications.find((n) => n.id === notificationId);
        if (notif) {
          notif.status = "read";
          notif.readAt = new Date().toISOString();
        }
        setLoading(false);
        return notif;
      }

      try {
        const result = await fetchApi<{ data: Notification }>(
          `/notifications/${notificationId}/read?recipient_id=${recipientId}`,
          { method: "POST" },
        );
        return result.data;
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Unknown error");
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [mockMode],
  );

  return { markAsRead, loading, error };
}

/**
 * Hook for marking all notifications as read.
 */
export function useMarkAllAsRead() {
  const mockMode = useUiStore((state) => state.mockMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const markAllAsRead = useCallback(
    async (recipientId: string) => {
      setLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const now = new Date().toISOString();
        let count = 0;
        for (const notif of mockNotifications) {
          if (notif.status !== "read" && notif.status !== "actioned") {
            notif.status = "read";
            notif.readAt = now;
            count++;
          }
        }
        setLoading(false);
        return { markedCount: count };
      }

      try {
        const result = await fetchApi<{ data: { markedCount: number } }>(
          `/notifications/read-all?recipient_id=${recipientId}`,
          { method: "POST" },
        );
        return result.data;
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Unknown error");
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [mockMode],
  );

  return { markAllAsRead, loading, error };
}

/**
 * Hook for executing a notification action.
 */
export function useExecuteAction() {
  const mockMode = useUiStore((state) => state.mockMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const executeAction = useCallback(
    async (recipientId: string, notificationId: string, actionId: string) => {
      setLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const notif = mockNotifications.find((n) => n.id === notificationId);
        const action = notif?.actions?.find((a) => a.id === actionId);
        if (notif && action) {
          notif.status = "actioned";
          notif.actionedAt = new Date().toISOString();
          notif.actionId = actionId;
        }
        setLoading(false);
        return { notification: notif, executedAction: action };
      }

      try {
        const result = await fetchApi<{
          data: {
            notification: Notification;
            executedAction: NotificationAction;
          };
        }>(
          `/notifications/${notificationId}/action?recipient_id=${recipientId}`,
          {
            method: "POST",
            body: JSON.stringify({ actionId }),
          },
        );
        return result.data;
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Unknown error");
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [mockMode],
  );

  return { executeAction, loading, error };
}

/**
 * Hook for updating notification preferences.
 */
export function useUpdatePreferences() {
  const mockMode = useUiStore((state) => state.mockMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const updatePreferences = useCallback(
    async (userId: string, update: PreferencesUpdateRequest) => {
      setLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        // Apply updates to mock preferences
        if (update.enabled !== undefined) {
          mockPreferences.enabled = update.enabled;
        }
        if (update.defaultChannels) {
          mockPreferences.defaultChannels = update.defaultChannels;
        }
        if (update.quietHours) {
          mockPreferences.quietHours = {
            ...mockPreferences.quietHours!,
            ...update.quietHours,
          };
        }
        if (update.categories) {
          for (const [cat, prefs] of Object.entries(update.categories)) {
            if (prefs) {
              mockPreferences.categories[cat as NotificationCategory] = {
                ...mockPreferences.categories[cat as NotificationCategory],
                ...prefs,
              };
            }
          }
        }
        if (update.digest) {
          mockPreferences.digest = {
            ...mockPreferences.digest!,
            ...update.digest,
          };
        }
        if (update.channelConfig) {
          mockPreferences.channelConfig = {
            ...mockPreferences.channelConfig,
            ...update.channelConfig,
          };
        }
        mockPreferences.updatedAt = new Date().toISOString();
        setLoading(false);
        return mockPreferences;
      }

      try {
        const result = await fetchApi<{ data: NotificationPreferences }>(
          `/notifications/preferences?user_id=${userId}`,
          {
            method: "PUT",
            body: JSON.stringify(update),
          },
        );
        return result.data;
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Unknown error");
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [mockMode],
  );

  return { updatePreferences, loading, error };
}

/**
 * Hook for sending a test notification.
 */
export function useSendTestNotification() {
  const mockMode = useUiStore((state) => state.mockMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const sendTest = useCallback(
    async (recipientId: string, channel?: NotificationChannel) => {
      setLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const testNotif: Notification = {
          id: `notif_test_${Date.now()}`,
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
          status: "sent",
          channels: channel ? [channel] : ["in_app"],
          createdAt: new Date().toISOString(),
          sentAt: new Date().toISOString(),
        };
        mockNotifications.unshift(testNotif);
        setLoading(false);
        return testNotif;
      }

      try {
        const result = await fetchApi<{ data: Notification }>(
          `/notifications/test?recipient_id=${recipientId}`,
          {
            method: "POST",
            body: JSON.stringify({ channel }),
          },
        );
        return result.data;
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Unknown error");
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [mockMode],
  );

  return { sendTest, loading, error };
}

/**
 * Hook for creating a notification (admin use).
 */
export function useCreateNotification() {
  const mockMode = useUiStore((state) => state.mockMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const createNotification = useCallback(
    async (request: CreateNotificationRequest) => {
      setLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const newNotif: Notification = {
          id: `notif_${Date.now()}`,
          ...request,
          status: "sent",
          channels: request.forceChannels ?? ["in_app"],
          createdAt: new Date().toISOString(),
          sentAt: new Date().toISOString(),
        };
        mockNotifications.unshift(newNotif);
        setLoading(false);
        return newNotif;
      }

      try {
        const result = await fetchApi<{ data: Notification }>(
          "/notifications",
          {
            method: "POST",
            body: JSON.stringify(request),
          },
        );
        return result.data;
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Unknown error");
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [mockMode],
  );

  return { createNotification, loading, error };
}

// ============================================================================
// WebSocket Subscription Hook
// ============================================================================

/**
 * Hook for subscribing to real-time notification updates via WebSocket.
 */
export function useNotificationSubscription(
  recipientId: string,
  onNotification?: (notification: Notification) => void,
) {
  const [connected, setConnected] = useState(false);
  const [lastNotification, setLastNotification] = useState<Notification | null>(
    null,
  );
  const mockMode = useUiStore((state) => state.mockMode);

  useEffect(() => {
    if (mockMode) {
      // In mock mode, simulate occasional notifications
      setConnected(true);
      const interval = setInterval(() => {
        // 10% chance of a mock notification every 30 seconds
        if (Math.random() < 0.1) {
          const mockNotif: Notification = {
            id: `notif_realtime_${Date.now()}`,
            type: "system.info",
            category: "system",
            priority: "low",
            title: "System Update",
            body: "This is a simulated real-time notification for demo purposes.",
            recipientId,
            source: { type: "system", name: "Demo" },
            status: "sent",
            channels: ["in_app"],
            createdAt: new Date().toISOString(),
            sentAt: new Date().toISOString(),
          };
          setLastNotification(mockNotif);
          onNotification?.(mockNotif);
        }
      }, 30000);

      return () => {
        clearInterval(interval);
        setConnected(false);
      };
    }

    // Production WebSocket connection
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = new URL(`${protocol}//${window.location.host}/ws`);
    const gatewayToken = import.meta.env["VITE_GATEWAY_TOKEN"]?.trim();
    if (gatewayToken) wsUrl.searchParams.set("token", gatewayToken);

    try {
      const ws = new WebSocket(wsUrl.toString());

      ws.onopen = () => {
        setConnected(true);
        // Subscribe to notification channel
        ws.send(
          JSON.stringify({
            type: "subscribe",
            channel: `user:notifications:${recipientId}`,
          }),
        );
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "message" && message.message) {
            const hubMessage = message.message;
            if (hubMessage.type === "notification.created") {
              const notification = hubMessage.payload as Notification;
              setLastNotification(notification);
              onNotification?.(notification);
            }

            if (message.ackRequired && hubMessage.id) {
              ws.send(
                JSON.stringify({
                  type: "ack",
                  messageIds: [hubMessage.id],
                }),
              );
            }
          }
        } catch {
          // Ignore invalid messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
      };

      ws.onerror = () => {
        setConnected(false);
      };

      return () => {
        ws.close();
      };
    } catch {
      setConnected(false);
    }
  }, [mockMode, recipientId, onNotification]);

  return { connected, lastNotification };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the display color for a notification priority.
 */
export function getPriorityColor(priority: NotificationPriority): string {
  switch (priority) {
    case "urgent":
      return "text-red-500";
    case "high":
      return "text-orange-500";
    case "normal":
      return "text-blue-500";
    case "low":
      return "text-gray-500";
    default:
      return "text-gray-500";
  }
}

/**
 * Get the display icon for a notification category.
 */
export function getCategoryIcon(category: NotificationCategory): string {
  switch (category) {
    case "agents":
      return "bot";
    case "coordination":
      return "git-merge";
    case "tasks":
      return "check-square";
    case "costs":
      return "dollar-sign";
    case "security":
      return "shield";
    case "system":
      return "settings";
    default:
      return "bell";
  }
}

/**
 * Format a notification timestamp relative to now.
 */
export function formatNotificationTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}
