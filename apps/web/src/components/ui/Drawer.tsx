/**
 * Drawer component.
 *
 * Slide-in side panel for mobile navigation.
 */

import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { X } from "lucide-react";
import { type ReactNode, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  drawerLeftVariants,
  drawerRightVariants,
  fadeVariants,
} from "../../lib/animations";

type DrawerPosition = "left" | "right";

interface DrawerProps {
  /** Whether the drawer is open */
  open: boolean;
  /** Handler to close the drawer */
  onClose: () => void;
  /** Position of the drawer */
  position?: DrawerPosition;
  /** Title for the drawer header */
  title?: string;
  /** Drawer content */
  children: ReactNode;
  /** Whether to show close button */
  showCloseButton?: boolean;
  /** Whether clicking backdrop closes drawer */
  closeOnBackdropClick?: boolean;
  /** Whether escape key closes drawer */
  closeOnEscape?: boolean;
  /** Additional CSS class */
  className?: string;
}

/**
 * Drawer component with swipe-to-close support.
 */
export function Drawer({
  open,
  onClose,
  position = "left",
  title,
  children,
  showCloseButton = true,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  className = "",
}: DrawerProps) {
  // Handle escape key
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeOnEscape) {
        onClose();
      }
    },
    [closeOnEscape, onClose],
  );

  // Handle body scroll lock
  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, handleKeyDown]);

  // Handle backdrop click
  const handleBackdropClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget && closeOnBackdropClick) {
      onClose();
    }
  };

  // Handle swipe to close
  const handleDragEnd = (
    _: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    const threshold = 100;
    if (position === "left" && info.offset.x < -threshold) {
      onClose();
    } else if (position === "right" && info.offset.x > threshold) {
      onClose();
    }
  };

  const variants =
    position === "left" ? drawerLeftVariants : drawerRightVariants;

  const drawerContent = (
    <AnimatePresence>
      {open && (
        <motion.div
          className="drawer-backdrop drawer-backdrop--open"
          variants={fadeVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={handleBackdropClick}
        >
          <motion.aside
            className={`drawer drawer--${position} ${className}`}
            variants={variants}
            initial="hidden"
            animate="visible"
            exit="exit"
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
            role="dialog"
            aria-modal="true"
            aria-label={title || "Navigation drawer"}
          >
            {(title || showCloseButton) && (
              <div className="drawer__header">
                {title && <h2 className="modal__title">{title}</h2>}
                {showCloseButton && (
                  <button
                    className="drawer__close"
                    onClick={onClose}
                    aria-label="Close drawer"
                  >
                    <X size={20} />
                  </button>
                )}
              </div>
            )}
            <div className="drawer__body">{children}</div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (typeof document !== "undefined") {
    return createPortal(drawerContent, document.body);
  }

  return null;
}
