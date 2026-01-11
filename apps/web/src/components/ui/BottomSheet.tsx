/**
 * Bottom Sheet component.
 *
 * Modal alternative for mobile that slides up from the bottom.
 */

import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { X } from "lucide-react";
import { type ReactNode, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { bottomSheetVariants, fadeVariants } from "../../lib/animations";

interface BottomSheetProps {
  /** Whether the bottom sheet is open */
  open: boolean;
  /** Handler to close the sheet */
  onClose: () => void;
  /** Title for the sheet */
  title?: string;
  /** Sheet content */
  children: ReactNode;
  /** Whether to show the drag handle */
  showHandle?: boolean;
  /** Whether to show close button */
  showCloseButton?: boolean;
  /** Whether clicking backdrop closes sheet */
  closeOnBackdropClick?: boolean;
  /** Whether escape key closes sheet */
  closeOnEscape?: boolean;
  /** Additional CSS class */
  className?: string;
}

/**
 * Bottom Sheet component with swipe-to-dismiss.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  showHandle = true,
  showCloseButton = true,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  className = "",
}: BottomSheetProps) {
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

  // Handle swipe to dismiss
  const handleDragEnd = (
    _: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      onClose();
    }
  };

  const sheetContent = (
    <AnimatePresence>
      {open && (
        <motion.div
          className="bottom-sheet-backdrop bottom-sheet-backdrop--open"
          variants={fadeVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={handleBackdropClick}
        >
          <motion.div
            className={`bottom-sheet ${className}`}
            variants={bottomSheetVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={handleDragEnd}
            role="dialog"
            aria-modal="true"
            aria-label={title || "Bottom sheet"}
          >
            {showHandle && (
              <div className="bottom-sheet__handle">
                <div className="bottom-sheet__handle-bar" />
              </div>
            )}

            {(title || showCloseButton) && (
              <div className="bottom-sheet__header">
                {title && <h2 className="bottom-sheet__title">{title}</h2>}
                {showCloseButton && (
                  <button
                    className="modal__close"
                    onClick={onClose}
                    aria-label="Close"
                  >
                    <X size={20} />
                  </button>
                )}
              </div>
            )}

            <div className="bottom-sheet__body">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (typeof document !== "undefined") {
    return createPortal(sheetContent, document.body);
  }

  return null;
}
