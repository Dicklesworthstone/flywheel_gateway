/**
 * Tooltip component.
 *
 * Displays contextual information on hover/focus.
 */

import { AnimatePresence, motion } from "framer-motion";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { tooltipVariants } from "../../lib/animations";

export type TooltipPosition = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  /** Content to display in the tooltip */
  content: ReactNode;
  /** Trigger element */
  children: ReactNode;
  /** Position of the tooltip */
  position?: TooltipPosition;
  /** Delay before showing (ms) */
  delay?: number;
  /** Whether tooltip is disabled */
  disabled?: boolean;
  /** Additional CSS class */
  className?: string;
}

/**
 * Tooltip component with hover/focus support.
 */
export function Tooltip({
  content,
  children,
  position = "top",
  delay = 200,
  disabled = false,
  className = "",
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTooltip = useCallback(() => {
    if (disabled) return;
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  }, [delay, disabled]);

  const hideTooltip = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
  }, []);

  if (disabled) {
    return <>{children}</>;
  }

  return (
    <div
      className={`tooltip tooltip--${position} ${className}`}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            className="tooltip__content"
            variants={tooltipVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="tooltip"
          >
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
