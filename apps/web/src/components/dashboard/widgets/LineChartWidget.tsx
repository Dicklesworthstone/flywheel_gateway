/**
 * LineChartWidget - Time series visualization.
 *
 * Data shape expected:
 * {
 *   series: Array<{
 *     name: string,
 *     color?: string,
 *     data: Array<{ x: string | number, y: number }>
 *   }>,
 *   xAxisLabel?: string,
 *   yAxisLabel?: string,
 * }
 */

import type { Widget, WidgetData } from "@flywheel/shared";
import { useEffect, useRef } from "react";
import "./ChartWidget.css";

interface DataPoint {
  x: string | number;
  y: number;
}

interface Series {
  name: string;
  color?: string;
  data: DataPoint[];
}

interface ChartData {
  series: Series[];
  xAxisLabel?: string;
  yAxisLabel?: string;
}

interface LineChartWidgetProps {
  widget: Widget;
  data: WidgetData;
}

const DEFAULT_COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
];

export function LineChartWidget({ widget, data }: LineChartWidgetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartData = data.data as ChartData | null;

  useEffect(() => {
    if (
      !chartData?.series?.length ||
      !canvasRef.current ||
      !containerRef.current
    )
      return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const padding = { top: 20, right: 20, bottom: 40, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Get all data points for scaling
    const allPoints = chartData.series.flatMap((s) => s.data);
    if (allPoints.length === 0) return;

    const yValues = allPoints.map((p) => p.y);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    const yRange = maxY - minY || 1;

    // Draw grid
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;

    // Horizontal grid lines
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();

      // Y-axis labels
      const value = maxY - (yRange / 4) * i;
      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      ctx.font = "11px system-ui";
      ctx.textAlign = "right";
      ctx.fillText(formatValue(value), padding.left - 8, y + 4);
    }

    // Draw each series
    chartData.series.forEach((series, seriesIndex) => {
      const color =
        series.color ??
        DEFAULT_COLORS[seriesIndex % DEFAULT_COLORS.length] ??
        "#6366f1";
      const points = series.data;

      if (points.length === 0) return;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();

      points.forEach((point, i) => {
        const x = padding.left + (chartWidth / (points.length - 1 || 1)) * i;
        const y =
          padding.top + chartHeight - ((point.y - minY) / yRange) * chartHeight;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();

      // Draw area fill
      ctx.fillStyle = color.replace(")", ", 0.1)").replace("rgb", "rgba");
      ctx.beginPath();
      points.forEach((point, i) => {
        const x = padding.left + (chartWidth / (points.length - 1 || 1)) * i;
        const y =
          padding.top + chartHeight - ((point.y - minY) / yRange) * chartHeight;

        if (i === 0) {
          ctx.moveTo(x, padding.top + chartHeight);
          ctx.lineTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
      ctx.closePath();
      ctx.fill();

      // Draw data points
      points.forEach((point, i) => {
        const x = padding.left + (chartWidth / (points.length - 1 || 1)) * i;
        const y =
          padding.top + chartHeight - ((point.y - minY) / yRange) * chartHeight;

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    });

    // X-axis labels
    const firstSeries = chartData.series[0];
    if (firstSeries && firstSeries.data.length > 0) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      ctx.font = "11px system-ui";
      ctx.textAlign = "center";

      const labelCount = Math.min(firstSeries.data.length, 6);
      const step = Math.floor(firstSeries.data.length / labelCount);

      for (let i = 0; i < firstSeries.data.length; i += step) {
        const point = firstSeries.data[i];
        if (!point) continue;
        const x =
          padding.left + (chartWidth / (firstSeries.data.length - 1 || 1)) * i;
        const label = formatXLabel(point.x);
        ctx.fillText(label, x, height - padding.bottom + 20);
      }
    }

    // Axis labels
    if (chartData.yAxisLabel) {
      ctx.save();
      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      ctx.font = "12px system-ui";
      ctx.translate(12, height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.fillText(chartData.yAxisLabel, 0, 0);
      ctx.restore();
    }
  }, [chartData]);

  if (!chartData?.series?.length) {
    return (
      <div className="chart-widget chart-widget--empty">No data available</div>
    );
  }

  const showLegend = widget.config.display?.showLegend !== false;

  return (
    <div className="chart-widget">
      <div className="chart-widget__canvas-container" ref={containerRef}>
        <canvas ref={canvasRef} />
      </div>

      {showLegend && chartData.series.length > 1 && (
        <div className="chart-widget__legend">
          {chartData.series.map((series, i) => (
            <div key={series.name} className="chart-widget__legend-item">
              <span
                className="chart-widget__legend-color"
                style={{
                  backgroundColor:
                    series.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
                }}
              />
              <span className="chart-widget__legend-label">{series.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatValue(value: number): string {
  if (Math.abs(value) >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toFixed(value % 1 === 0 ? 0 : 1);
}

function formatXLabel(value: string | number): string {
  if (typeof value === "string") {
    // Try to parse as date
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    }
    return value.length > 10 ? `${value.substring(0, 10)}...` : value;
  }
  return String(value);
}
