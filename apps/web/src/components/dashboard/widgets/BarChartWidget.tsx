/**
 * BarChartWidget - Categorical comparison visualization.
 *
 * Data shape expected:
 * {
 *   items: Array<{
 *     label: string,
 *     value: number,
 *     color?: string,
 *   }>,
 *   horizontal?: boolean,
 * }
 */

import type { Widget, WidgetData } from "@flywheel/shared";
import { useEffect, useRef } from "react";
import "./ChartWidget.css";

interface BarItem {
  label: string;
  value: number;
  color?: string;
}

interface BarChartData {
  items: BarItem[];
  horizontal?: boolean;
}

interface BarChartWidgetProps {
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

export function BarChartWidget({ widget: _widget, data }: BarChartWidgetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartData = data.data as BarChartData | null;

  useEffect(() => {
    if (
      !chartData?.items?.length ||
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
    const isHorizontal = chartData.horizontal;
    const padding = isHorizontal
      ? { top: 20, right: 20, bottom: 20, left: 100 }
      : { top: 20, right: 20, bottom: 60, left: 50 };

    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    const items = chartData.items;
    const maxValue = Math.max(...items.map((item) => item.value));
    const barGap = 8;
    const barSize = isHorizontal
      ? (chartHeight - barGap * (items.length - 1)) / items.length
      : (chartWidth - barGap * (items.length - 1)) / items.length;

    // Draw grid lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;

    if (isHorizontal) {
      // Vertical grid lines
      for (let i = 0; i <= 4; i++) {
        const x = padding.left + (chartWidth / 4) * i;
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, height - padding.bottom);
        ctx.stroke();

        // X-axis labels
        const value = (maxValue / 4) * i;
        ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
        ctx.font = "11px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(formatValue(value), x, height - padding.bottom + 14);
      }
    } else {
      // Horizontal grid lines
      for (let i = 0; i <= 4; i++) {
        const y = padding.top + (chartHeight / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        // Y-axis labels
        const value = maxValue - (maxValue / 4) * i;
        ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
        ctx.font = "11px system-ui";
        ctx.textAlign = "right";
        ctx.fillText(formatValue(value), padding.left - 8, y + 4);
      }
    }

    // Draw bars
    items.forEach((item, i) => {
      const color =
        item.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length] ?? "#6366f1";
      const valueRatio = item.value / maxValue;

      if (isHorizontal) {
        const y = padding.top + (barSize + barGap) * i;
        const barWidth = chartWidth * valueRatio;

        // Bar
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(padding.left, y, barWidth, barSize, [0, 4, 4, 0]);
        ctx.fill();

        // Label
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.font = "12px system-ui";
        ctx.textAlign = "right";
        ctx.fillText(
          truncateLabel(item.label, 12),
          padding.left - 8,
          y + barSize / 2 + 4,
        );

        // Value
        if (barWidth > 40) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
          ctx.textAlign = "right";
          ctx.fillText(
            formatValue(item.value),
            padding.left + barWidth - 8,
            y + barSize / 2 + 4,
          );
        }
      } else {
        const x = padding.left + (barSize + barGap) * i;
        const barHeight = chartHeight * valueRatio;

        // Bar
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(
          x,
          padding.top + chartHeight - barHeight,
          barSize,
          barHeight,
          [4, 4, 0, 0],
        );
        ctx.fill();

        // Label
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.font = "11px system-ui";
        ctx.textAlign = "center";
        ctx.save();
        ctx.translate(x + barSize / 2, height - padding.bottom + 12);
        if (items.length > 6) {
          ctx.rotate(-Math.PI / 4);
          ctx.textAlign = "right";
        }
        ctx.fillText(truncateLabel(item.label, 10), 0, 0);
        ctx.restore();
      }
    });
  }, [chartData]);

  if (!chartData?.items?.length) {
    return (
      <div className="chart-widget chart-widget--empty">No data available</div>
    );
  }

  return (
    <div className="chart-widget">
      <div className="chart-widget__canvas-container" ref={containerRef}>
        <canvas ref={canvasRef} />
      </div>
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

function truncateLabel(label: string, maxLength: number): string {
  return label.length > maxLength
    ? `${label.substring(0, maxLength - 1)}...`
    : label;
}
