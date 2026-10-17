import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle, Info, X, XCircle } from "lucide-react";
import { useEffect, useId, useState } from "react";

type ToastType = "info" | "success" | "warning" | "error";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  correlationId?: string;
  duration?: number;
}

const toastStore = {
  toasts: [] as Toast[],
  listeners: new Set<() => void>(),
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  },
  emit() {
    for (const listener of this.listeners) {
      listener();
    }
  },
  add(toast: Omit<Toast, "id">) {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.toasts = [...this.toasts, { ...toast, id }];
    this.emit();
    return id;
  },
  remove(id: string) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.emit();
  },
};

export const toast = {
  info: (
    message: string,
    options?: { correlationId?: string; duration?: number },
  ) => toastStore.add({ type: "info", message, ...options }),
  success: (
    message: string,
    options?: { correlationId?: string; duration?: number },
  ) => toastStore.add({ type: "success", message, ...options }),
  warning: (
    message: string,
    options?: { correlationId?: string; duration?: number },
  ) => toastStore.add({ type: "warning", message, ...options }),
  error: (
    message: string,
    options?: { correlationId?: string; duration?: number },
  ) => toastStore.add({ type: "error", message, ...options }),
  dismiss: (id: string) => toastStore.remove(id),
};

const icons: Record<ToastType, typeof Info> = {
  info: Info,
  success: CheckCircle,
  warning: AlertCircle,
  error: XCircle,
};

const tones: Record<ToastType, string> = {
  info: "toast--info",
  success: "toast--success",
  warning: "toast--warning",
  error: "toast--error",
};

function ToastItem({
  toast: t,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  const Icon = icons[t.type];

  useEffect(() => {
    const duration = t.duration ?? 5000;
    if (duration > 0) {
      const timer = setTimeout(onDismiss, duration);
      return () => clearTimeout(timer);
    }
  }, [t.duration, onDismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.95 }}
      className={`toast ${tones[t.type]}`}
    >
      <Icon size={18} className="toast__icon" />
      <div className="toast__content">
        <p className="toast__message">{t.message}</p>
        {t.correlationId ? (
          <p className="toast__reference">Ref: {t.correlationId}</p>
        ) : null}
      </div>
      <button type="button" className="toast__close" onClick={onDismiss}>
        <X size={14} />
      </button>
    </motion.div>
  );
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const regionId = useId();

  useEffect(() => {
    setToasts([...toastStore.toasts]);
    return toastStore.subscribe(() => {
      setToasts([...toastStore.toasts]);
    });
  }, []);

  return (
    <section
      className="toaster"
      aria-label="Notifications"
      aria-live="polite"
      id={regionId}
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <ToastItem
            key={t.id}
            toast={t}
            onDismiss={() => toastStore.remove(t.id)}
          />
        ))}
      </AnimatePresence>
    </section>
  );
}
