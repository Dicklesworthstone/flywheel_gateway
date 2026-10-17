/**
 * NotificationCenter Component
 *
 * Main notification hub combining badge, dropdown panel, and notification list.
 * Provides a complete notification experience with real-time updates.
 */

import { AnimatePresence, motion } from "framer-motion";
import { Settings, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Notification,
  NotificationAction,
  NotificationCategory,
} from "../../hooks/useNotifications";
import {
  useExecuteAction,
  useMarkAllAsRead,
  useMarkAsRead,
  useNotificationPreferences,
  useNotificationSubscription,
  useNotifications,
  useUpdatePreferences,
} from "../../hooks/useNotifications";
import { dropdownVariants } from "../../lib/animations";
import { NotificationBadge } from "./NotificationBadge";
import {
  NotificationList,
  type NotificationListFilter,
} from "./NotificationList";

export interface NotificationCenterProps {
  /** User ID for fetching notifications */
  userId: string;
  /** Position of the dropdown */
  position?: "bottom-left" | "bottom-right";
  /** Maximum height of the dropdown panel */
  maxHeight?: number;
  /** Whether to show preferences link */
  showPreferencesLink?: boolean;
  /** Callback when preferences is clicked */
  onPreferencesClick?: () => void;
  /** Badge size */
  badgeSize?: "sm" | "md" | "lg";
  /** Additional CSS class */
  className?: string;
}

/**
 * NotificationCenter component - main notification interface.
 */
export function NotificationCenter({
  userId,
  position = "bottom-right",
  maxHeight = 480,
  showPreferencesLink = true,
  onPreferencesClick,
  badgeSize = "md",
  className = "",
}: NotificationCenterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationListFilter>({});
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch notifications
  const {
    data: notificationData,
    loading,
    refetch,
  } = useNotifications({
    recipientId: userId,
    limit: 20,
    ...filter,
  });

  // Mutations
  const { markAsRead } = useMarkAsRead();
  const { markAllAsRead } = useMarkAllAsRead();
  const { executeAction } = useExecuteAction();

  // Real-time subscription
  const { connected } = useNotificationSubscription(
    userId,
    useCallback(
      (_notification: Notification) => {
        // Refetch when new notification arrives
        refetch();
      },
      [refetch],
    ),
  );

  // Extract data
  const notifications = useMemo(
    () => notificationData?.data ?? [],
    [notificationData],
  );
  const unreadCount = useMemo(
    () => notificationData?.unreadCount ?? 0,
    [notificationData],
  );
  const total = useMemo(() => notificationData?.total ?? 0, [notificationData]);
  const hasMore = useMemo(
    () => notificationData?.hasMore ?? false,
    [notificationData],
  );

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  // Handlers
  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleMarkAsRead = useCallback(
    async (id: string) => {
      try {
        await markAsRead(userId, id);
        refetch();
      } catch (err) {
        console.error("Failed to mark as read:", err);
      }
    },
    [userId, markAsRead, refetch],
  );

  const handleMarkAllAsRead = useCallback(async () => {
    try {
      await markAllAsRead(userId);
      refetch();
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    }
  }, [userId, markAllAsRead, refetch]);

  const handleAction = useCallback(
    async (notificationId: string, action: NotificationAction) => {
      try {
        await executeAction(userId, notificationId, action.id);

        // Handle navigation actions
        if (
          action.action === "navigate" &&
          action.payload?.["url"] &&
          typeof action.payload["url"] === "string"
        ) {
          window.location.href = action.payload["url"];
        }

        refetch();
      } catch (err) {
        console.error("Failed to execute action:", err);
      }
    },
    [userId, executeAction, refetch],
  );

  const handleDismiss = useCallback(
    async (id: string) => {
      // Mark as read when dismissed
      await handleMarkAsRead(id);
    },
    [handleMarkAsRead],
  );

  const handleFilterChange = useCallback(
    (newFilter: NotificationListFilter) => {
      setFilter(newFilter);
    },
    [],
  );

  const handleLoadMore = useCallback(() => {
    // Pagination is handled by cursor in the hook
    // For now, we could increase limit or use cursor pagination
  }, []);

  // Position classes
  const positionClasses = useMemo(() => {
    switch (position) {
      case "bottom-left":
        return "top-full left-0 mt-2";
      default:
        return "top-full right-0 mt-2";
    }
  }, [position]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Badge trigger */}
      <NotificationBadge
        count={unreadCount}
        onClick={handleToggle}
        size={badgeSize}
        pulse={!isOpen}
        ariaLabel={`Notifications${isOpen ? " (panel open)" : ""}`}
      />

      {/* Dropdown panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            variants={dropdownVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={`
              absolute z-50 ${positionClasses}
              w-96 max-w-[calc(100vw-2rem)]
              bg-white dark:bg-gray-800
              rounded-xl shadow-xl
              border border-gray-200 dark:border-gray-700
              overflow-hidden
            `}
            style={{ maxHeight: maxHeight + 60 }} // Account for header/footer
          >
            {/* Real-time indicator */}
            {connected && (
              <div className="absolute top-2 right-12 flex items-center gap-1">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-[10px] text-gray-400">Live</span>
              </div>
            )}

            {/* Close button */}
            <button
              type="button"
              onClick={handleClose}
              className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-700 rounded-md"
              aria-label="Close notifications"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Notification list */}
            <NotificationList
              notifications={notifications}
              loading={loading}
              hasMore={hasMore}
              total={total}
              unreadCount={unreadCount}
              onMarkAsRead={handleMarkAsRead}
              onMarkAllAsRead={handleMarkAllAsRead}
              onAction={handleAction}
              onDismiss={handleDismiss}
              onRefresh={refetch}
              onFilterChange={handleFilterChange}
              onLoadMore={handleLoadMore}
              maxHeight={`${maxHeight}px`}
              showFilters={true}
              groupByDate={true}
              emptyMessage="You're all caught up!"
            />

            {/* Footer with preferences link */}
            {showPreferencesLink && (
              <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-2">
                <button
                  type="button"
                  onClick={onPreferencesClick}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <Settings className="w-4 h-4" />
                  Notification preferences
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * NotificationPreferencesPanel - for managing notification settings.
 */
export interface NotificationPreferencesPanelProps {
  userId: string;
  onClose?: () => void;
}

export function NotificationPreferencesPanel({
  userId,
  onClose,
}: NotificationPreferencesPanelProps) {
  const {
    data: preferences,
    loading,
    refetch,
  } = useNotificationPreferences(userId);
  const { updatePreferences, loading: updating } = useUpdatePreferences();

  const [localPrefs, setLocalPrefs] = useState(preferences);

  // Sync with fetched preferences
  useEffect(() => {
    if (preferences) {
      setLocalPrefs(preferences);
    }
  }, [preferences]);

  const handleToggleEnabled = useCallback(async () => {
    if (!localPrefs) return;
    const newEnabled = !localPrefs.enabled;
    setLocalPrefs({ ...localPrefs, enabled: newEnabled });
    await updatePreferences(userId, { enabled: newEnabled });
    refetch();
  }, [localPrefs, userId, updatePreferences, refetch]);

  const handleToggleCategory = useCallback(
    async (category: NotificationCategory) => {
      if (!localPrefs) return;
      const current = localPrefs.categories[category];
      const updated = {
        categories: {
          [category]: { enabled: !current.enabled },
        },
      };
      setLocalPrefs({
        ...localPrefs,
        categories: {
          ...localPrefs.categories,
          [category]: { ...current, enabled: !current.enabled },
        },
      });
      await updatePreferences(userId, updated);
      refetch();
    },
    [localPrefs, userId, updatePreferences, refetch],
  );

  const handleToggleQuietHours = useCallback(async () => {
    if (!localPrefs) return;
    const enabled = !localPrefs.quietHours?.enabled;
    const defaultQuietHours = {
      enabled: false,
      start: "22:00",
      end: "08:00",
      allowUrgent: true,
    };
    setLocalPrefs({
      ...localPrefs,
      quietHours: { ...(localPrefs.quietHours ?? defaultQuietHours), enabled },
    });
    await updatePreferences(userId, { quietHours: { enabled } });
    refetch();
  }, [localPrefs, userId, updatePreferences, refetch]);

  if (loading || !localPrefs) {
    return (
      <div className="p-6 text-center text-gray-500">
        Loading preferences...
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Notification Preferences
        </h3>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Master toggle */}
      <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <div>
          <p className="font-medium text-gray-900 dark:text-white">
            Enable notifications
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Receive notifications for important events
          </p>
        </div>
        <button
          type="button"
          onClick={handleToggleEnabled}
          disabled={updating}
          className={`
            relative inline-flex h-6 w-11 items-center rounded-full
            transition-colors duration-200
            ${localPrefs.enabled ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-600"}
          `}
        >
          <span
            className={`
              inline-block h-4 w-4 transform rounded-full bg-white shadow
              transition-transform duration-200
              ${localPrefs.enabled ? "translate-x-6" : "translate-x-1"}
            `}
          />
        </button>
      </div>

      {/* Category toggles */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          Notification Categories
        </h4>
        <div className="space-y-2">
          {(Object.keys(localPrefs.categories) as NotificationCategory[]).map(
            (category) => (
              <div
                key={category}
                className="flex items-center justify-between py-2"
              >
                <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">
                  {category}
                </span>
                <button
                  type="button"
                  onClick={() => handleToggleCategory(category)}
                  disabled={updating || !localPrefs.enabled}
                  className={`
                    relative inline-flex h-5 w-9 items-center rounded-full
                    transition-colors duration-200
                    ${!localPrefs.enabled ? "opacity-50 cursor-not-allowed" : ""}
                    ${localPrefs.categories[category].enabled ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-600"}
                  `}
                >
                  <span
                    className={`
                      inline-block h-3 w-3 transform rounded-full bg-white shadow
                      transition-transform duration-200
                      ${localPrefs.categories[category].enabled ? "translate-x-5" : "translate-x-1"}
                    `}
                  />
                </button>
              </div>
            ),
          )}
        </div>
      </div>

      {/* Quiet hours */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          Quiet Hours
        </h4>
        <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {localPrefs.quietHours?.start ?? "22:00"} -{" "}
              {localPrefs.quietHours?.end ?? "08:00"}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Only urgent notifications during quiet hours
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggleQuietHours}
            disabled={updating || !localPrefs.enabled}
            className={`
              relative inline-flex h-5 w-9 items-center rounded-full
              transition-colors duration-200
              ${!localPrefs.enabled ? "opacity-50 cursor-not-allowed" : ""}
              ${localPrefs.quietHours?.enabled ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-600"}
            `}
          >
            <span
              className={`
                inline-block h-3 w-3 transform rounded-full bg-white shadow
                transition-transform duration-200
                ${localPrefs.quietHours?.enabled ? "translate-x-5" : "translate-x-1"}
              `}
            />
          </button>
        </div>
      </div>

      {/* Channel config hint */}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Configure email, Slack, and webhook integrations in your account
        settings.
      </p>
    </div>
  );
}
