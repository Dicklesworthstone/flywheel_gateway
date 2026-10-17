/**
 * NotificationList Component
 *
 * Displays a scrollable list of notifications with filtering,
 * grouping, and pagination support.
 */

import { AnimatePresence, motion } from "framer-motion";
import { Bell, CheckCheck, Filter, Loader2, RefreshCcw } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type {
  Notification,
  NotificationAction,
  NotificationCategory,
  NotificationPriority,
} from "../../hooks/useNotifications";
import { NotificationItem } from "./NotificationItem";

export interface NotificationListProps {
  /** Array of notifications to display */
  notifications: Notification[];
  /** Whether the list is loading */
  loading?: boolean;
  /** Whether more notifications are being loaded */
  loadingMore?: boolean;
  /** Whether there are more notifications to load */
  hasMore?: boolean;
  /** Total notification count */
  total?: number;
  /** Unread notification count */
  unreadCount?: number;
  /** Callback when a notification is marked as read */
  onMarkAsRead?: (id: string) => void;
  /** Callback to mark all as read */
  onMarkAllAsRead?: () => void;
  /** Callback when an action is executed */
  onAction?: (notificationId: string, action: NotificationAction) => void;
  /** Callback when a notification is dismissed */
  onDismiss?: (id: string) => void;
  /** Callback to load more notifications */
  onLoadMore?: () => void;
  /** Callback to refresh notifications */
  onRefresh?: () => void;
  /** Callback when filter changes */
  onFilterChange?: (filter: NotificationListFilter) => void;
  /** Initial filter */
  initialFilter?: NotificationListFilter;
  /** Whether to show filter controls */
  showFilters?: boolean;
  /** Whether to group notifications by date */
  groupByDate?: boolean;
  /** Maximum height of the list */
  maxHeight?: string | number;
  /** Empty state message */
  emptyMessage?: string;
  /** Compact mode for smaller display */
  compact?: boolean;
}

export interface NotificationListFilter {
  categories?: NotificationCategory[];
  priorities?: NotificationPriority[];
  unreadOnly?: boolean;
}

const CATEGORY_OPTIONS: { value: NotificationCategory; label: string }[] = [
  { value: "agents", label: "Agents" },
  { value: "coordination", label: "Coordination" },
  { value: "tasks", label: "Tasks" },
  { value: "costs", label: "Costs" },
  { value: "security", label: "Security" },
  { value: "system", label: "System" },
];

const PRIORITY_OPTIONS: { value: NotificationPriority; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

/**
 * Group notifications by date (Today, Yesterday, This Week, Older).
 */
function groupNotificationsByDate(
  notifications: Notification[],
): Map<string, Notification[]> {
  const groups = new Map<string, Notification[]>();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);

  for (const notification of notifications) {
    const date = new Date(notification.createdAt);
    let group: string;

    if (date >= today) {
      group = "Today";
    } else if (date >= yesterday) {
      group = "Yesterday";
    } else if (date >= weekAgo) {
      group = "This Week";
    } else {
      group = "Older";
    }

    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group)?.push(notification);
  }

  return groups;
}

/**
 * NotificationList component for displaying notifications.
 */
export function NotificationList({
  notifications,
  loading = false,
  loadingMore = false,
  hasMore = false,
  total,
  unreadCount = 0,
  onMarkAsRead,
  onMarkAllAsRead,
  onAction,
  onDismiss,
  onLoadMore,
  onRefresh,
  onFilterChange,
  initialFilter,
  showFilters = true,
  groupByDate = true,
  maxHeight = "400px",
  emptyMessage = "No notifications",
  compact = false,
}: NotificationListProps) {
  const [filter, setFilter] = useState<NotificationListFilter>(
    initialFilter ?? {},
  );
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  // Apply local filter
  const filteredNotifications = useMemo(() => {
    let filtered = [...notifications];

    if (filter.categories?.length) {
      filtered = filtered.filter((n) =>
        filter.categories?.includes(n.category),
      );
    }
    if (filter.priorities?.length) {
      filtered = filtered.filter((n) =>
        filter.priorities?.includes(n.priority),
      );
    }
    if (filter.unreadOnly) {
      filtered = filtered.filter(
        (n) => n.status !== "read" && n.status !== "actioned",
      );
    }

    return filtered;
  }, [notifications, filter]);

  // Group notifications
  const groupedNotifications = useMemo(() => {
    if (!groupByDate) {
      return new Map([["All", filteredNotifications]]);
    }
    return groupNotificationsByDate(filteredNotifications);
  }, [filteredNotifications, groupByDate]);

  // Handle filter change
  const handleFilterChange = useCallback(
    (newFilter: Partial<NotificationListFilter>) => {
      const updated = { ...filter, ...newFilter };
      setFilter(updated);
      onFilterChange?.(updated);
    },
    [filter, onFilterChange],
  );

  // Toggle category filter
  const toggleCategory = useCallback(
    (category: NotificationCategory) => {
      const categories = filter.categories ?? [];
      const newCategories = categories.includes(category)
        ? categories.filter((c) => c !== category)
        : [...categories, category];
      handleFilterChange({ categories: newCategories });
    },
    [filter.categories, handleFilterChange],
  );

  // Toggle priority filter
  const togglePriority = useCallback(
    (priority: NotificationPriority) => {
      const priorities = filter.priorities ?? [];
      const newPriorities = priorities.includes(priority)
        ? priorities.filter((p) => p !== priority)
        : [...priorities, priority];
      handleFilterChange({ priorities: newPriorities });
    },
    [filter.priorities, handleFilterChange],
  );

  // Handle scroll to bottom for infinite loading
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      const isNearBottom =
        target.scrollHeight - target.scrollTop - target.clientHeight < 100;
      if (isNearBottom && hasMore && !loadingMore && onLoadMore) {
        onLoadMore();
      }
    },
    [hasMore, loadingMore, onLoadMore],
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filter.categories?.length) count += filter.categories.length;
    if (filter.priorities?.length) count += filter.priorities.length;
    if (filter.unreadOnly) count += 1;
    return count;
  }, [filter]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            Notifications
          </h3>
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium text-white bg-blue-600 rounded-full">
              {unreadCount}
            </span>
          )}
          {total !== undefined && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              ({total} total)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Refresh button */}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCcw
                className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
              />
            </button>
          )}

          {/* Filter button */}
          {showFilters && (
            <button
              type="button"
              onClick={() => setShowFilterPanel(!showFilterPanel)}
              className={`relative p-1.5 rounded-md transition-colors ${
                showFilterPanel || activeFilterCount > 0
                  ? "text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700"
              }`}
              title="Filter notifications"
            >
              <Filter className="w-4 h-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 text-xs text-white bg-blue-600 rounded-full flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
          )}

          {/* Mark all as read */}
          {onMarkAllAsRead && unreadCount > 0 && (
            <button
              type="button"
              onClick={onMarkAllAsRead}
              className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700"
              title="Mark all as read"
            >
              <CheckCheck className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Filter panel */}
      <AnimatePresence>
        {showFilterPanel && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-gray-200 dark:border-gray-700"
          >
            <div className="p-3 space-y-3 bg-gray-50 dark:bg-gray-800/50">
              {/* Category filters */}
              <div>
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Categories
                </span>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {CATEGORY_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      onClick={() => toggleCategory(option.value)}
                      className={`px-2 py-1 text-xs rounded-md transition-colors ${
                        filter.categories?.includes(option.value)
                          ? "bg-blue-600 text-white"
                          : "bg-white text-gray-700 border border-gray-200 hover:border-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Priority filters */}
              <div>
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Priority
                </span>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {PRIORITY_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      onClick={() => togglePriority(option.value)}
                      className={`px-2 py-1 text-xs rounded-md transition-colors ${
                        filter.priorities?.includes(option.value)
                          ? "bg-blue-600 text-white"
                          : "bg-white text-gray-700 border border-gray-200 hover:border-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Unread only toggle */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="unreadOnly"
                  checked={filter.unreadOnly ?? false}
                  onChange={(e) =>
                    handleFilterChange({ unreadOnly: e.target.checked })
                  }
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label
                  htmlFor="unreadOnly"
                  className="text-sm text-gray-700 dark:text-gray-300"
                >
                  Unread only
                </label>
              </div>

              {/* Clear filters */}
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={() => setFilter({})}
                  className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  Clear all filters
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Notification list */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ maxHeight }}
        onScroll={handleScroll}
      >
        {loading && notifications.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Bell className="w-12 h-12 text-gray-300 dark:text-gray-600" />
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              {emptyMessage}
            </p>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={() => setFilter({})}
                className="mt-2 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="p-4 space-y-6">
            <AnimatePresence mode="popLayout">
              {Array.from(groupedNotifications.entries()).map(
                ([group, items]) => (
                  <div key={group}>
                    {groupByDate && (
                      <h4 className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        {group}
                      </h4>
                    )}
                    <div className="space-y-2">
                      {items.map((notification) => (
                        <NotificationItem
                          key={notification.id}
                          notification={notification}
                          {...(onMarkAsRead && { onMarkAsRead })}
                          {...(onAction && { onAction })}
                          {...(onDismiss && { onDismiss })}
                          compact={compact}
                        />
                      ))}
                    </div>
                  </div>
                ),
              )}
            </AnimatePresence>

            {/* Load more indicator */}
            {loadingMore && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
              </div>
            )}

            {/* Load more button */}
            {hasMore && !loadingMore && onLoadMore && (
              <button
                type="button"
                onClick={onLoadMore}
                className="w-full py-2 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                Load more
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
