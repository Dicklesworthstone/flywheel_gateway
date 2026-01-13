/**
 * WidgetConfigPanel - Panel for editing widget configuration.
 */

import { useState } from "react";
import type {
  Widget,
  WidgetType,
  DataSourceConfig,
  DisplayConfig,
  ThresholdConfig,
  RefreshInterval,
} from "@flywheel/shared";
import "./WidgetConfigPanel.css";

interface WidgetConfigPanelProps {
  widget: Widget;
  onSave: (updates: Partial<Widget>) => void;
  onCancel: () => void;
}

const REFRESH_OPTIONS: { value: RefreshInterval; label: string }[] = [
  { value: 0, label: "Manual" },
  { value: 15, label: "15 seconds" },
  { value: 30, label: "30 seconds" },
  { value: 60, label: "1 minute" },
  { value: 300, label: "5 minutes" },
  { value: 900, label: "15 minutes" },
];

const DATA_SOURCE_PRESETS: Record<string, { endpoint: string; label: string }[]> = {
  "metric-card": [
    { endpoint: "/api/analytics/summary", label: "Analytics Summary" },
    { endpoint: "/api/cost-analytics/summary", label: "Cost Summary" },
    { endpoint: "/api/agents/stats", label: "Agent Stats" },
  ],
  "line-chart": [
    { endpoint: "/api/analytics/timeseries", label: "Analytics Time Series" },
    { endpoint: "/api/cost-analytics/trends/daily", label: "Cost Trends" },
  ],
  "bar-chart": [
    { endpoint: "/api/analytics/breakdown", label: "Analytics Breakdown" },
    { endpoint: "/api/cost-analytics/breakdown/model", label: "Cost by Model" },
  ],
  "pie-chart": [
    { endpoint: "/api/cost-analytics/breakdown/model", label: "Cost by Model" },
    { endpoint: "/api/analytics/distribution", label: "Distribution" },
  ],
  table: [
    { endpoint: "/api/agents", label: "Agents List" },
    { endpoint: "/api/sessions", label: "Sessions List" },
  ],
  "agent-list": [{ endpoint: "/api/agents", label: "Agents" }],
  "activity-feed": [
    { endpoint: "/api/audit/events", label: "Audit Events" },
    { endpoint: "/api/notifications", label: "Notifications" },
  ],
  gauge: [
    { endpoint: "/api/cost-analytics/budget-statuses", label: "Budget Status" },
  ],
  "cost-breakdown": [
    { endpoint: "/api/cost-analytics/breakdown/model", label: "By Model" },
    { endpoint: "/api/cost-analytics/breakdown/agent", label: "By Agent" },
  ],
  text: [],
  heatmap: [],
  iframe: [],
};

export function WidgetConfigPanel({
  widget,
  onSave,
  onCancel,
}: WidgetConfigPanelProps) {
  const [title, setTitle] = useState(widget.title);
  const [description, setDescription] = useState(widget.description || "");
  const [refreshInterval, setRefreshInterval] = useState<RefreshInterval>(
    widget.refreshInterval || 0,
  );
  const [dataSource, setDataSource] = useState<DataSourceConfig>(
    widget.config.dataSource,
  );
  const [display, setDisplay] = useState<DisplayConfig>(
    widget.config.display || {},
  );
  const [thresholds, setThresholds] = useState<ThresholdConfig>(
    widget.config.thresholds || {},
  );
  const [textContent, setTextContent] = useState<string>(
    (widget.config.customOptions?.content as string) || "",
  );
  const [iframeUrl, setIframeUrl] = useState<string>(
    (widget.config.customOptions?.url as string) || "",
  );

  const presets = DATA_SOURCE_PRESETS[widget.type] || [];

  const handleSave = () => {
    const customOptions: Record<string, unknown> = {
      ...widget.config.customOptions,
    };

    // Include text content for text widgets
    if (widget.type === "text" && textContent) {
      customOptions.content = textContent;
    }

    // Include iframe URL for iframe widgets
    if (widget.type === "iframe" && iframeUrl) {
      customOptions.url = iframeUrl;
    }

    onSave({
      title,
      description: description || undefined,
      refreshInterval,
      config: {
        dataSource,
        display,
        thresholds,
        customOptions: Object.keys(customOptions).length > 0 ? customOptions : undefined,
      },
    });
  };

  const handlePresetSelect = (endpoint: string) => {
    setDataSource({
      ...dataSource,
      type: "api",
      endpoint,
    });
  };

  return (
    <div className="widget-config-panel">
      <div className="widget-config-panel__header">
        <h2>Configure Widget</h2>
        <button
          type="button"
          className="widget-config-panel__close"
          onClick={onCancel}
          aria-label="Cancel"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="widget-config-panel__content">
        {/* Basic Settings */}
        <section className="widget-config-panel__section">
          <h3>Basic</h3>

          <div className="widget-config-panel__field">
            <label htmlFor="widget-title">Title</label>
            <input
              id="widget-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Widget title"
            />
          </div>

          <div className="widget-config-panel__field">
            <label htmlFor="widget-description">Description (optional)</label>
            <textarea
              id="widget-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description"
              rows={2}
            />
          </div>

          <div className="widget-config-panel__field">
            <label htmlFor="widget-refresh">Auto Refresh</label>
            <select
              id="widget-refresh"
              value={refreshInterval}
              onChange={(e) =>
                setRefreshInterval(Number(e.target.value) as RefreshInterval)
              }
            >
              {REFRESH_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Data Source */}
        <section className="widget-config-panel__section">
          <h3>Data Source</h3>

          {presets.length > 0 && (
            <div className="widget-config-panel__presets">
              {presets.map((preset) => (
                <button
                  key={preset.endpoint}
                  type="button"
                  className={`widget-config-panel__preset ${
                    dataSource.endpoint === preset.endpoint
                      ? "widget-config-panel__preset--active"
                      : ""
                  }`}
                  onClick={() => handlePresetSelect(preset.endpoint)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          <div className="widget-config-panel__field">
            <label htmlFor="data-endpoint">API Endpoint</label>
            <input
              id="data-endpoint"
              type="text"
              value={dataSource.endpoint || ""}
              onChange={(e) =>
                setDataSource({ ...dataSource, endpoint: e.target.value })
              }
              placeholder="/api/..."
            />
          </div>
        </section>

        {/* Display Options */}
        <section className="widget-config-panel__section">
          <h3>Display</h3>

          <div className="widget-config-panel__checkbox">
            <input
              id="display-legend"
              type="checkbox"
              checked={display.showLegend !== false}
              onChange={(e) =>
                setDisplay({ ...display, showLegend: e.target.checked })
              }
            />
            <label htmlFor="display-legend">Show Legend</label>
          </div>

          <div className="widget-config-panel__checkbox">
            <input
              id="display-labels"
              type="checkbox"
              checked={display.showLabels !== false}
              onChange={(e) =>
                setDisplay({ ...display, showLabels: e.target.checked })
              }
            />
            <label htmlFor="display-labels">Show Labels</label>
          </div>

          <div className="widget-config-panel__checkbox">
            <input
              id="display-animation"
              type="checkbox"
              checked={display.animationEnabled !== false}
              onChange={(e) =>
                setDisplay({ ...display, animationEnabled: e.target.checked })
              }
            />
            <label htmlFor="display-animation">Enable Animations</label>
          </div>
        </section>

        {/* Thresholds (for metric widgets) */}
        {(widget.type === "metric-card" || widget.type === "gauge") && (
          <section className="widget-config-panel__section">
            <h3>Thresholds</h3>

            <div className="widget-config-panel__field">
              <label htmlFor="threshold-warning">Warning Level</label>
              <input
                id="threshold-warning"
                type="number"
                value={thresholds.warning || ""}
                onChange={(e) =>
                  setThresholds({
                    ...thresholds,
                    warning: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
                placeholder="e.g., 80"
              />
            </div>

            <div className="widget-config-panel__field">
              <label htmlFor="threshold-critical">Critical Level</label>
              <input
                id="threshold-critical"
                type="number"
                value={thresholds.critical || ""}
                onChange={(e) =>
                  setThresholds({
                    ...thresholds,
                    critical: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
                placeholder="e.g., 95"
              />
            </div>
          </section>
        )}

        {/* Text widget content */}
        {widget.type === "text" && (
          <section className="widget-config-panel__section">
            <h3>Content</h3>
            <div className="widget-config-panel__field">
              <label htmlFor="text-content">Markdown Content</label>
              <textarea
                id="text-content"
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                placeholder="# Heading\n\nYour markdown content..."
                rows={8}
              />
            </div>
          </section>
        )}

        {/* Iframe widget URL */}
        {widget.type === "iframe" && (
          <section className="widget-config-panel__section">
            <h3>Embed</h3>
            <div className="widget-config-panel__field">
              <label htmlFor="iframe-url">URL</label>
              <input
                id="iframe-url"
                type="url"
                value={iframeUrl}
                onChange={(e) => setIframeUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
          </section>
        )}
      </div>

      <div className="widget-config-panel__footer">
        <button
          type="button"
          className="widget-config-panel__btn widget-config-panel__btn--secondary"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="widget-config-panel__btn widget-config-panel__btn--primary"
          onClick={handleSave}
        >
          Save Changes
        </button>
      </div>
    </div>
  );
}
