/**
 * Tooltip component.
 *
 * Displays contextual information on hover/focus.
 */

import { AnimatePresence, motion } from "framer-motion";
import {
  cloneElement,
  type FocusEvent,
  type HTMLAttributes,
  isValidElement,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
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
  const tooltipId = useId();

  const clearShowTimeout = useCallback(() => {
    if (!timeoutRef.current) return;
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const showTooltip = useCallback(() => {
    if (disabled) return;
    clearShowTimeout();
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  }, [clearShowTimeout, delay, disabled]);

  const hideTooltip = useCallback(() => {
    clearShowTimeout();
    setIsVisible(false);
  }, [clearShowTimeout]);

  useEffect(() => {
    if (!disabled) return;
    clearShowTimeout();
    setIsVisible(false);
  }, [clearShowTimeout, disabled]);

  useEffect(() => {
    return () => {
      clearShowTimeout();
    };
  }, [clearShowTimeout]);

  if (disabled) {
    return <>{children}</>;
  }

  const childElement = isValidElement(children) ? (
    children
  ) : (
    <span>{children}</span>
  );
  const childProps = childElement.props as HTMLAttributes<HTMLElement>;
  const describedBy =
    [childProps["aria-describedby"], isVisible ? tooltipId : undefined]
      .filter(Boolean)
      .join(" ") || undefined;

  const trigger = cloneElement(childElement, {
    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
      childProps.onMouseEnter?.(event);
      showTooltip();
    },
    onMouseLeave: (event: MouseEvent<HTMLElement>) => {
      childProps.onMouseLeave?.(event);
      hideTooltip();
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      childProps.onFocus?.(event);
      showTooltip();
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      childProps.onBlur?.(event);
      hideTooltip();
    },
    "aria-describedby": describedBy,
  });

  return (
    <div className={`tooltip tooltip--${position} ${className}`}>
      {trigger}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            className="tooltip__content"
            variants={tooltipVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="tooltip"
            id={tooltipId}
          >
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
