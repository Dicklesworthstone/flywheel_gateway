/**
 * NotificationItem Component
 *
 * Displays a single notification with priority indicator, actions,
 * and status management.
 */

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Bell,
  Bot,
  CheckSquare,
  DollarSign,
  ExternalLink,
  GitMerge,
  Settings,
  Shield,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type {
  Notification,
  NotificationAction,
  NotificationCategory,
  NotificationPriority,
} from "../../hooks/useNotifications";
import { formatNotificationTime } from "../../hooks/useNotifications";

export interface NotificationItemProps {
  /** The notification to display */
  notification: Notification;
  /** Callback when notification is marked as read */
  onMarkAsRead?: (id: string) => void;
  /** Callback when an action is executed */
  onAction?: (notificationId: string, action: NotificationAction) => void;
  /** Callback when notification is dismissed */
  onDismiss?: (id: string) => void;
  /** Whether to show compact view */
  compact?: boolean;
}

/**
 * Get icon for notification category.
 */
function getCategoryIcon(category: NotificationCategory) {
  switch (category) {
    case "agents":
      return Bot;
    case "coordination":
      return GitMerge;
    case "tasks":
      return CheckSquare;
    case "costs":
      return DollarSign;
    case "security":
      return Shield;
    case "system":
      return Settings;
    default:
      return Bell;
  }
}

/**
 * Get color classes for notification priority.
 */
function getPriorityClasses(priority: NotificationPriority): {
  bg: string;
  text: string;
  border: string;
  dot: string;
} {
  switch (priority) {
    case "urgent":
      return {
        bg: "bg-red-50 dark:bg-red-950",
        text: "text-red-700 dark:text-red-300",
        border: "border-red-200 dark:border-red-800",
        dot: "bg-red-500",
      };
    case "high":
      return {
        bg: "bg-orange-50 dark:bg-orange-950",
        text: "text-orange-700 dark:text-orange-300",
        border: "border-orange-200 dark:border-orange-800",
        dot: "bg-orange-500",
      };
    case "normal":
      return {
        bg: "bg-blue-50 dark:bg-blue-950",
        text: "text-blue-700 dark:text-blue-300",
        border: "border-blue-200 dark:border-blue-800",
        dot: "bg-blue-500",
      };
    case "low":
      return {
        bg: "bg-gray-50 dark:bg-gray-900",
        text: "text-gray-600 dark:text-gray-400",
        border: "border-gray-200 dark:border-gray-700",
        dot: "bg-gray-400",
      };
    default:
      return {
        bg: "bg-gray-50 dark:bg-gray-900",
        text: "text-gray-600 dark:text-gray-400",
        border: "border-gray-200 dark:border-gray-700",
        dot: "bg-gray-400",
      };
  }
}

/**
 * Get button style classes for action button.
 */
function getActionButtonClasses(style: NotificationAction["style"]): string {
  switch (style) {
    case "primary":
      return "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600";
    case "secondary":
      return "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600";
    case "danger":
      return "bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600";
    case "link":
      return "text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline";
    default:
      return "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600";
  }
}

/**
 * NotificationItem component displaying a single notification.
 */
export function NotificationItem({
  notification,
  onMarkAsRead,
  onAction,
  onDismiss,
  compact = false,
}: NotificationItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const isUnread =
    notification.status !== "read" && notification.status !== "actioned";
  const priorityClasses = useMemo(
    () => getPriorityClasses(notification.priority),
    [notification.priority],
  );
  const CategoryIcon = useMemo(
    () => getCategoryIcon(notification.category),
    [notification.category],
  );
  const timeAgo = useMemo(
    () => formatNotificationTime(notification.createdAt),
    [notification.createdAt],
  );

  const handleClick = useCallback(() => {
    if (isUnread && onMarkAsRead) {
      onMarkAsRead(notification.id);
    }
    if (!compact) {
      setIsExpanded((prev) => !prev);
    }
  }, [isUnread, onMarkAsRead, notification.id, compact]);

  const handleAction = useCallback(
    (action: NotificationAction, e: React.MouseEvent) => {
      e.stopPropagation();
      onAction?.(notification.id, action);
    },
    [notification.id, onAction],
  );

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDismiss?.(notification.id);
    },
    [notification.id, onDismiss],
  );

  const handleLinkClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -100 }}
      className={`
        relative rounded-lg border transition-all duration-200 cursor-pointer
        ${priorityClasses.border}
        ${isUnread ? priorityClasses.bg : "bg-white dark:bg-gray-800"}
        ${isHovered ? "shadow-md" : "shadow-sm"}
        ${compact ? "p-3" : "p-4"}
      `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
    >
      {/* Unread indicator dot */}
      {isUnread && (
        <span
          className={`absolute top-3 left-3 w-2 h-2 rounded-full ${priorityClasses.dot}`}
          aria-hidden="true"
        />
      )}

      <div className={`flex items-start gap-3 ${isUnread ? "ml-4" : ""}`}>
        {/* Category icon */}
        <div className={`flex-shrink-0 p-2 rounded-lg ${priorityClasses.bg}`}>
          <CategoryIcon className={`w-5 h-5 ${priorityClasses.text}`} />
        </div>

        {/* Content */}
        <div className="flex-grow min-w-0">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-grow min-w-0">
              <h4
                className={`text-sm font-medium truncate ${
                  isUnread
                    ? "text-gray-900 dark:text-white"
                    : "text-gray-600 dark:text-gray-400"
                }`}
              >
                {notification.title}
              </h4>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {timeAgo}
                </span>
                {notification.priority === "urgent" && (
                  <span className="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                    <AlertTriangle className="w-3 h-3" />
                    Urgent
                  </span>
                )}
              </div>
            </div>

            {/* Dismiss button */}
            <AnimatePresence>
              {(isHovered || compact) && (
                <motion.button
                  type="button"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onClick={handleDismiss}
                  className="flex-shrink-0 p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                  aria-label="Dismiss"
                >
                  <X className="w-4 h-4" />
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {/* Body */}
          {!compact && (
            <p
              className={`mt-2 text-sm text-gray-600 dark:text-gray-300 ${
                isExpanded ? "" : "line-clamp-2"
              }`}
            >
              {notification.body}
            </p>
          )}

          {/* Link */}
          {notification.link && !compact && (
            <a
              href={notification.link}
              onClick={handleLinkClick}
              className="inline-flex items-center gap-1 mt-2 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              View details
              <ExternalLink className="w-3 h-3" />
            </a>
          )}

          {/* Actions */}
          {notification.actions &&
            notification.actions.length > 0 &&
            !compact && (
              <div className="flex flex-wrap gap-2 mt-3">
                {notification.actions.map((action) => (
                  <button
                    type="button"
                    key={action.id}
                    onClick={(e) => handleAction(action, e)}
                    className={`
                    px-3 py-1.5 text-xs font-medium rounded-md transition-colors
                    ${getActionButtonClasses(action.style)}
                    ${action.style === "link" ? "" : "shadow-sm"}
                  `}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}

          {/* Source */}
          {!compact && notification.source && (
            <div className="mt-2 text-xs text-gray-400 dark:text-gray-500">
              From: {notification.source.name || notification.source.type}
              {notification.source.id && ` (${notification.source.id})`}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
