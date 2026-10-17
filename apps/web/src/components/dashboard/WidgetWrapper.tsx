/**
 * WidgetWrapper - Base container for all dashboard widgets.
 *
 * Provides:
 * - Header with title and actions
 * - Loading/error states
 * - Drag handle for grid layout
 * - Edit mode controls
 */

import type { Widget, WidgetData } from "@flywheel/shared";
import type { ReactNode } from "react";
import "./WidgetWrapper.css";

interface WidgetWrapperProps {
  widget: Widget;
  data?: WidgetData;
  isEditing?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  onRefresh?: () => void;
  children: ReactNode;
}

export function WidgetWrapper({
  widget,
  data,
  isEditing = false,
  onEdit,
  onRemove,
  onRefresh,
  children,
}: WidgetWrapperProps) {
  const isLoading = !data;
  const hasError = data?.error;

  return (
    <div
      className={`widget-wrapper widget-wrapper--${widget.type} ${isEditing ? "widget-wrapper--editing" : ""}`}
    >
      <div className="widget-wrapper__header">
        <div className="widget-wrapper__drag-handle" title="Drag to reposition">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="4" cy="4" r="1.5" />
            <circle cx="12" cy="4" r="1.5" />
            <circle cx="4" cy="8" r="1.5" />
            <circle cx="12" cy="8" r="1.5" />
            <circle cx="4" cy="12" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
          </svg>
        </div>

        <h3 className="widget-wrapper__title">{widget.title}</h3>

        <div className="widget-wrapper__actions">
          {onRefresh && (
            <button
              type="button"
              className="widget-wrapper__action"
              onClick={onRefresh}
              title="Refresh data"
              disabled={isLoading}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
            </button>
          )}

          {isEditing && onEdit && (
            <button
              type="button"
              className="widget-wrapper__action"
              onClick={onEdit}
              title="Configure widget"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
              </svg>
            </button>
          )}

          {isEditing && onRemove && (
            <button
              type="button"
              className="widget-wrapper__action widget-wrapper__action--danger"
              onClick={onRemove}
              title="Remove widget"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="widget-wrapper__content">
        {isLoading ? (
          <div className="widget-wrapper__loading">
            <div className="widget-wrapper__spinner" />
            <span>Loading...</span>
          </div>
        ) : hasError ? (
          <div className="widget-wrapper__error">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <span>{data.error}</span>
            {onRefresh && (
              <button type="button" onClick={onRefresh}>
                Retry
              </button>
            )}
          </div>
        ) : (
          children
        )}
      </div>

      {widget.description && (
        <div className="widget-wrapper__footer">
          <span className="widget-wrapper__description">
            {widget.description}
          </span>
        </div>
      )}
    </div>
  );
}
