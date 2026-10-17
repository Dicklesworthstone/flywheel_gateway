/**
 * DashboardGrid - Responsive grid layout for dashboard widgets.
 *
 * Uses CSS Grid with drag-and-drop support for repositioning.
 * Widgets can span multiple columns and rows based on their position config.
 */

import type { Dashboard, WidgetData, WidgetPosition } from "@flywheel/shared";
import { useCallback, useState } from "react";
import { WidgetRenderer } from "./WidgetRenderer";
import "./DashboardGrid.css";

interface DashboardGridProps {
  dashboard: Dashboard;
  widgetData: Map<string, WidgetData>;
  isEditing?: boolean;
  onWidgetEdit?: (widgetId: string) => void;
  onWidgetRemove?: (widgetId: string) => void;
  onWidgetRefresh?: (widgetId: string) => void;
  onLayoutChange?: (
    layouts: Array<{ widgetId: string; position: WidgetPosition }>,
  ) => void;
}

export function DashboardGrid({
  dashboard,
  widgetData,
  isEditing = false,
  onWidgetEdit,
  onWidgetRemove,
  onWidgetRefresh,
  onLayoutChange,
}: DashboardGridProps) {
  const [draggedWidget, setDraggedWidget] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ x: number; y: number } | null>(
    null,
  );

  const { widgets, layout } = dashboard;
  const columns = layout.columns || 12;
  const rowHeight = layout.rowHeight || 80;
  const [marginX, marginY] = layout.margin || [16, 16];

  // Calculate grid rows needed
  const maxRow = widgets.reduce((max, widget) => {
    const bottom = widget.position.y + widget.position.h;
    return Math.max(max, bottom);
  }, 1);

  // Handle drag start
  const handleDragStart = useCallback(
    (e: React.DragEvent, widgetId: string) => {
      if (!isEditing) return;

      setDraggedWidget(widgetId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", widgetId);

      // Set drag image
      const elem = e.currentTarget as HTMLElement;
      const rect = elem.getBoundingClientRect();
      e.dataTransfer.setDragImage(elem, rect.width / 2, 20);
    },
    [isEditing],
  );

  // Handle drag over grid cell
  const handleDragOver = useCallback(
    (e: React.DragEvent, x: number, y: number) => {
      if (!isEditing || !draggedWidget) return;

      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropTarget({ x, y });
    },
    [isEditing, draggedWidget],
  );

  // Handle drop
  const handleDrop = useCallback(
    (e: React.DragEvent, targetX: number, targetY: number) => {
      e.preventDefault();

      if (!draggedWidget || !onLayoutChange) {
        setDraggedWidget(null);
        setDropTarget(null);
        return;
      }

      const widget = widgets.find((w) => w.id === draggedWidget);
      if (!widget) {
        setDraggedWidget(null);
        setDropTarget(null);
        return;
      }

      // Ensure widget stays within grid bounds
      const newX = Math.max(0, Math.min(targetX, columns - widget.position.w));
      const newY = Math.max(0, targetY);

      // Check for collisions and adjust if needed
      const newPosition: WidgetPosition = {
        ...widget.position,
        x: newX,
        y: newY,
      };

      onLayoutChange([{ widgetId: draggedWidget, position: newPosition }]);

      setDraggedWidget(null);
      setDropTarget(null);
    },
    [draggedWidget, widgets, columns, onLayoutChange],
  );

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    setDraggedWidget(null);
    setDropTarget(null);
  }, []);

  return (
    <div
      className={`dashboard-grid ${isEditing ? "dashboard-grid--editing" : ""}`}
      style={
        {
          "--grid-columns": columns,
          "--grid-row-height": `${rowHeight}px`,
          "--grid-gap-x": `${marginX}px`,
          "--grid-gap-y": `${marginY}px`,
          "--grid-rows": maxRow + (isEditing ? 2 : 0),
        } as React.CSSProperties
      }
    >
      {/* Render grid cells for drag targets when editing */}
      {isEditing && draggedWidget && (
        <div className="dashboard-grid__drop-zones">
          {Array.from({ length: columns * (maxRow + 2) }).map((_, i) => {
            const x = i % columns;
            const y = Math.floor(i / columns);
            const isTarget = dropTarget?.x === x && dropTarget?.y === y;

            return (
              <section
                key={`cell-${x}-${y}`}
                className={`dashboard-grid__drop-zone ${isTarget ? "dashboard-grid__drop-zone--active" : ""}`}
                style={{
                  gridColumn: x + 1,
                  gridRow: y + 1,
                }}
                aria-label={`Drop zone at column ${x + 1}, row ${y + 1}`}
                onDragOver={(e) => handleDragOver(e, x, y)}
                onDrop={(e) => handleDrop(e, x, y)}
              />
            );
          })}
        </div>
      )}

      {/* Render widgets */}
      {widgets.map((widget) => {
        const { x, y, w, h } = widget.position;
        const isDragging = draggedWidget === widget.id;

        return (
          <article
            key={widget.id}
            className={`dashboard-grid__item ${isDragging ? "dashboard-grid__item--dragging" : ""}`}
            style={{
              gridColumn: `${x + 1} / span ${w}`,
              gridRow: `${y + 1} / span ${h}`,
            }}
            aria-label={`Widget: ${widget.title || widget.type}`}
            draggable={isEditing}
            onDragStart={(e) => handleDragStart(e, widget.id)}
            onDragEnd={handleDragEnd}
          >
            <WidgetRenderer
              widget={widget}
              {...(widgetData.get(widget.id) !== undefined
                ? { data: widgetData.get(widget.id)! }
                : {})}
              isEditing={isEditing}
              {...(onWidgetEdit
                ? { onEdit: () => onWidgetEdit(widget.id) }
                : {})}
              {...(onWidgetRemove
                ? { onRemove: () => onWidgetRemove(widget.id) }
                : {})}
              {...(onWidgetRefresh
                ? { onRefresh: () => onWidgetRefresh(widget.id) }
                : {})}
            />
          </article>
        );
      })}

      {/* Empty state */}
      {widgets.length === 0 && (
        <div className="dashboard-grid__empty">
          <div className="dashboard-grid__empty-content">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            <h3>No widgets yet</h3>
            <p>
              {isEditing
                ? 'Click "Add Widget" to start building your dashboard'
                : "This dashboard has no widgets"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
