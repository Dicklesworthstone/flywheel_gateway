/**
 * NotificationBadge Component
 *
 * Displays an unread notification count badge, typically used
 * on a bell icon in the navigation.
 */

import { AnimatePresence, motion } from "framer-motion";
import { Bell } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";

export interface NotificationBadgeProps {
  /** Number of unread notifications */
  count: number;
  /** Maximum count to display (shows "99+" if exceeded) */
  maxCount?: number;
  /** Whether to show the badge when count is 0 */
  showZero?: boolean;
  /** Callback when badge is clicked */
  onClick?: () => void;
  /** Custom icon element */
  icon?: ReactNode;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Whether to pulse when there are unread notifications */
  pulse?: boolean;
  /** Additional CSS class */
  className?: string;
  /** ARIA label for accessibility */
  ariaLabel?: string;
}

/**
 * Get size classes for the badge.
 */
function getSizeClasses(size: "sm" | "md" | "lg"): {
  container: string;
  icon: string;
  badge: string;
  badgeText: string;
} {
  switch (size) {
    case "sm":
      return {
        container: "p-1.5",
        icon: "w-4 h-4",
        badge: "min-w-[16px] h-4 -top-0.5 -right-0.5",
        badgeText: "text-[10px]",
      };
    case "md":
      return {
        container: "p-2",
        icon: "w-5 h-5",
        badge: "min-w-[18px] h-[18px] -top-1 -right-1",
        badgeText: "text-xs",
      };
    case "lg":
      return {
        container: "p-2.5",
        icon: "w-6 h-6",
        badge: "min-w-[20px] h-5 -top-1 -right-1",
        badgeText: "text-xs",
      };
    default:
      return {
        container: "p-2",
        icon: "w-5 h-5",
        badge: "min-w-[18px] h-[18px] -top-1 -right-1",
        badgeText: "text-xs",
      };
  }
}

/**
 * NotificationBadge component for displaying notification count.
 */
export function NotificationBadge({
  count,
  maxCount = 99,
  showZero = false,
  onClick,
  icon,
  size = "md",
  pulse = true,
  className = "",
  ariaLabel,
}: NotificationBadgeProps) {
  const [isHovered, setIsHovered] = useState(false);
  const sizeClasses = getSizeClasses(size);

  const displayCount = count > maxCount ? `${maxCount}+` : count.toString();
  const showBadge = count > 0 || showZero;

  const handleClick = useCallback(() => {
    onClick?.();
  }, [onClick]);

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`
        relative inline-flex items-center justify-center rounded-lg
        transition-colors duration-200
        text-gray-500 hover:text-gray-700 hover:bg-gray-100
        dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700
        focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
        dark:focus:ring-offset-gray-800
        ${sizeClasses.container}
        ${className}
      `}
      aria-label={
        ariaLabel ?? `Notifications${count > 0 ? ` (${count} unread)` : ""}`
      }
      aria-live="polite"
    >
      {/* Icon */}
      {icon ?? <Bell className={sizeClasses.icon} />}

      {/* Badge */}
      <AnimatePresence>
        {showBadge && (
          <motion.span
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            className={`
              absolute flex items-center justify-center px-1
              font-medium text-white bg-red-500 rounded-full
              ${sizeClasses.badge} ${sizeClasses.badgeText}
            `}
          >
            {displayCount}

            {/* Pulse animation */}
            {pulse && count > 0 && (
              <motion.span
                className="absolute inset-0 bg-red-400 rounded-full"
                initial={{ scale: 1, opacity: 0.5 }}
                animate={{ scale: 1.5, opacity: 0 }}
                transition={{
                  duration: 1.5,
                  repeat: Number.POSITIVE_INFINITY,
                  repeatType: "loop",
                }}
              />
            )}
          </motion.span>
        )}
      </AnimatePresence>

      {/* Hover tooltip */}
      <AnimatePresence>
        {isHovered && count > 0 && (
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 text-xs text-white bg-gray-900 dark:bg-gray-700 rounded-md whitespace-nowrap pointer-events-none"
          >
            {count} unread notification{count !== 1 ? "s" : ""}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

/**
 * NotificationDot component for a simpler unread indicator.
 */
export function NotificationDot({
  show,
  className = "",
}: {
  show: boolean;
  className?: string;
}) {
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0 }}
          className={`
            absolute top-0 right-0 w-2.5 h-2.5 bg-red-500 rounded-full
            border-2 border-white dark:border-gray-800
            ${className}
          `}
        />
      )}
    </AnimatePresence>
  );
}
