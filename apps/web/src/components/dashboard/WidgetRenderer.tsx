/**
 * WidgetRenderer - Maps widget types to their component implementations.
 */

import type { Widget, WidgetData } from "@flywheel/shared";
import { WidgetWrapper } from "./WidgetWrapper";
import {
  ActivityFeedWidget,
  AgentListWidget,
  BarChartWidget,
  GaugeWidget,
  HeatmapWidget,
  LineChartWidget,
  MetricCardWidget,
  PieChartWidget,
  TableWidget,
  TextWidget,
} from "./widgets";

interface WidgetRendererProps {
  widget: Widget;
  data?: WidgetData;
  isEditing?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  onRefresh?: () => void;
}

export function WidgetRenderer({
  widget,
  data,
  isEditing,
  onEdit,
  onRemove,
  onRefresh,
}: WidgetRendererProps) {
  const renderWidget = () => {
    // Create default data structure if data hasn't loaded yet
    const widgetData: WidgetData = data || {
      widgetId: widget.id,
      data: null,
      fetchedAt: new Date().toISOString(),
    };

    switch (widget.type) {
      case "metric-card":
        return <MetricCardWidget widget={widget} data={widgetData} />;

      case "line-chart":
        return <LineChartWidget widget={widget} data={widgetData} />;

      case "bar-chart":
        return <BarChartWidget widget={widget} data={widgetData} />;

      case "pie-chart":
        return <PieChartWidget widget={widget} data={widgetData} />;

      case "table":
        return <TableWidget widget={widget} data={widgetData} />;

      case "agent-list":
        return <AgentListWidget widget={widget} data={widgetData} />;

      case "activity-feed":
        return <ActivityFeedWidget widget={widget} data={widgetData} />;

      case "gauge":
        return <GaugeWidget widget={widget} data={widgetData} />;

      case "text":
        return <TextWidget widget={widget} data={widgetData} />;

      case "cost-breakdown":
        // Reuse bar chart for cost breakdown
        return <BarChartWidget widget={widget} data={widgetData} />;

      case "heatmap":
        return <HeatmapWidget widget={widget} data={widgetData} />;

      case "iframe":
        // Iframe widget renders external content
        return <IframeWidget widget={widget} data={widgetData} />;

      default:
        return (
          <div className="widget-placeholder">
            Unknown widget type: {widget.type}
          </div>
        );
    }
  };

  return (
    <WidgetWrapper
      widget={widget}
      {...(data !== undefined && { data })}
      {...(isEditing !== undefined && { isEditing })}
      {...(onEdit !== undefined && { onEdit })}
      {...(onRemove !== undefined && { onRemove })}
      {...(onRefresh !== undefined && { onRefresh })}
    >
      {renderWidget()}
    </WidgetWrapper>
  );
}

// Simple iframe widget
function IframeWidget({ widget, data }: { widget: Widget; data: WidgetData }) {
  const iframeData = data.data as { url?: string } | null;
  const url = iframeData?.url || widget.config.customOptions?.["url"];

  if (!url || typeof url !== "string") {
    return <div className="widget-placeholder">No URL configured</div>;
  }

  // Validate protocol
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return (
      <div className="widget-placeholder text-red-400">
        Invalid URL protocol. Only http:// and https:// are allowed.
      </div>
    );
  }

  return (
    <iframe
      src={url}
      title={widget.title}
      style={{
        width: "100%",
        height: "100%",
        border: "none",
        borderRadius: "4px",
      }}
      sandbox="allow-scripts allow-same-origin"
    />
  );
}
