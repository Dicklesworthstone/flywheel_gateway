/**
 * Modal component.
 *
 * Centered dialog with backdrop blur.
 */

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { type ReactNode, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { modalBackdropVariants, modalVariants } from "../../lib/animations";
import { useUiStore } from "../../stores/ui";

interface ModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Handler to close the modal */
  onClose: () => void;
  /** Modal title */
  title?: string;
  /** Modal content */
  children: ReactNode;
  /** Footer content (buttons, etc.) */
  footer?: ReactNode;
  /** Whether to show the close button */
  showCloseButton?: boolean;
  /** Whether clicking the backdrop closes the modal */
  closeOnBackdropClick?: boolean;
  /** Whether pressing Escape closes the modal */
  closeOnEscape?: boolean;
  /** Maximum width of the modal */
  maxWidth?: string;
  /** Additional CSS class */
  className?: string;
  /** Unique ID for modal tracking */
  id?: string;
}

/**
 * Modal component with backdrop and animations.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  showCloseButton = true,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  maxWidth = "480px",
  className = "",
  id = "modal",
}: ModalProps) {
  const { pushModal, popModal } = useUiStore();

  // Handle escape key
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeOnEscape) {
        onClose();
      }
    },
    [closeOnEscape, onClose],
  );

  // Track modal in store and handle escape
  useEffect(() => {
    if (open) {
      pushModal(id);
      document.addEventListener("keydown", handleKeyDown);
      // Prevent body scroll
      document.body.style.overflow = "hidden";
    }

    return () => {
      if (open) {
        popModal();
        document.removeEventListener("keydown", handleKeyDown);
        document.body.style.overflow = "";
      }
    };
  }, [open, id, pushModal, popModal, handleKeyDown]);

  // Handle backdrop click
  const handleBackdropClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget && closeOnBackdropClick) {
      onClose();
    }
  };

  // Render in portal
  const modalContent = (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop modal-backdrop--open"
          variants={modalBackdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={handleBackdropClick}
        >
          <motion.div
            className={`modal ${className}`}
            variants={modalVariants}
            style={{ maxWidth }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? `${id}-title` : undefined}
          >
            {(title || showCloseButton) && (
              <div className="modal__header">
                {title && (
                  <h2 className="modal__title" id={`${id}-title`}>
                    {title}
                  </h2>
                )}
                {showCloseButton && (
                  <button
                    className="modal__close"
                    onClick={onClose}
                    aria-label="Close modal"
                  >
                    <X size={20} />
                  </button>
                )}
              </div>
            )}
            <div className="modal__body">{children}</div>
            {footer && <div className="modal__footer">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // Render in portal to escape parent stacking contexts
  if (typeof document !== "undefined") {
    return createPortal(modalContent, document.body);
  }

  return null;
}

/**
 * Confirmation dialog preset.
 */
interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  loading?: boolean;
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title = "Confirm",
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  loading = false,
}: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            className={`btn ${variant === "danger" ? "btn--danger" : "btn--primary"}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading && <span className="spinner spinner--sm" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}
