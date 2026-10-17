/**
 * WidgetGallery - Panel showing available widget types for drag-and-drop.
 */

import type { WidgetDefinition, WidgetType } from "@flywheel/shared";
import type { JSX } from "react";
import "./WidgetGallery.css";

interface WidgetGalleryProps {
  onAddWidget: (type: WidgetType) => void;
  onClose: () => void;
}

const WIDGET_DEFINITIONS: WidgetDefinition[] = [
  {
    type: "metric-card",
    name: "Metric Card",
    description: "Single KPI with trend indicator",
    icon: "M",
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
  },
  {
    type: "line-chart",
    name: "Line Chart",
    description: "Time series visualization",
    icon: "L",
    defaultSize: { w: 6, h: 3 },
    minSize: { w: 4, h: 2 },
  },
  {
    type: "bar-chart",
    name: "Bar Chart",
    description: "Categorical comparison",
    icon: "B",
    defaultSize: { w: 6, h: 3 },
    minSize: { w: 4, h: 2 },
  },
  {
    type: "pie-chart",
    name: "Pie Chart",
    description: "Distribution breakdown",
    icon: "P",
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 3, h: 3 },
  },
  {
    type: "table",
    name: "Data Table",
    description: "Tabular data with sorting",
    icon: "T",
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
  },
  {
    type: "agent-list",
    name: "Agent List",
    description: "Agent status overview",
    icon: "A",
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
  },
  {
    type: "activity-feed",
    name: "Activity Feed",
    description: "Recent events stream",
    icon: "F",
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
  },
  {
    type: "gauge",
    name: "Gauge",
    description: "Progress or capacity indicator",
    icon: "G",
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
  },
  {
    type: "cost-breakdown",
    name: "Cost Breakdown",
    description: "Cost distribution by dimension",
    icon: "$",
    defaultSize: { w: 6, h: 3 },
    minSize: { w: 4, h: 2 },
  },
  {
    type: "text",
    name: "Text / Markdown",
    description: "Static text or notes",
    icon: "Tx",
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 2, h: 1 },
  },
];

const ICON_MAP: Record<string, JSX.Element> = {
  M: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M8 12h8M8 16h5" />
    </svg>
  ),
  L: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 4 4 6-6" />
    </svg>
  ),
  B: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="4" y="14" width="4" height="6" />
      <rect x="10" y="10" width="4" height="10" />
      <rect x="16" y="6" width="4" height="14" />
    </svg>
  ),
  P: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v9l6.5 3.5" />
    </svg>
  ),
  T: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 3v18" />
    </svg>
  ),
  A: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M6 20v-2a4 4 0 014-4h4a4 4 0 014 4v2" />
    </svg>
  ),
  F: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 8h10M7 12h8M7 16h6" />
    </svg>
  ),
  G: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  ),
  $: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
    </svg>
  ),
  Tx: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M4 7V4h16v3M9 20h6M12 4v16" />
    </svg>
  ),
};

export function WidgetGallery({ onAddWidget, onClose }: WidgetGalleryProps) {
  return (
    <div className="widget-gallery">
      <div className="widget-gallery__header">
        <h2>Add Widget</h2>
        <button
          type="button"
          className="widget-gallery__close"
          onClick={onClose}
          aria-label="Close"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="widget-gallery__grid">
        {WIDGET_DEFINITIONS.map((def) => (
          <button
            key={def.type}
            type="button"
            className="widget-gallery__item"
            onClick={() => onAddWidget(def.type)}
          >
            <div className="widget-gallery__icon">
              {ICON_MAP[def.icon] || <span>{def.icon}</span>}
            </div>
            <div className="widget-gallery__info">
              <span className="widget-gallery__name">{def.name}</span>
              <span className="widget-gallery__description">
                {def.description}
              </span>
            </div>
            <div className="widget-gallery__size">
              {def.defaultSize.w}x{def.defaultSize.h}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export { WIDGET_DEFINITIONS };
