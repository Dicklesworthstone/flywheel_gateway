/**
 * PieChartWidget - Distribution visualization.
 *
 * Data shape expected:
 * {
 *   items: Array<{
 *     label: string,
 *     value: number,
 *     color?: string,
 *   }>,
 *   donut?: boolean,
 *   centerLabel?: string,
 * }
 */

import type { Widget, WidgetData } from "@flywheel/shared";
import { useEffect, useRef } from "react";
import "./ChartWidget.css";

interface PieItem {
  label: string;
  value: number;
  color?: string;
}

interface PieChartData {
  items: PieItem[];
  donut?: boolean;
  centerLabel?: string;
}

interface PieChartWidgetProps {
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
  "#14b8a6",
  "#f97316",
];

export function PieChartWidget({ widget, data }: PieChartWidgetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartData = data.data as PieChartData | null;

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
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 20;
    const isDonut = chartData.donut !== false;
    const innerRadius = isDonut ? radius * 0.6 : 0;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Calculate total
    const total = chartData.items.reduce((sum, item) => sum + item.value, 0);
    if (total === 0) return;

    // Draw slices
    let currentAngle = -Math.PI / 2; // Start from top

    chartData.items.forEach((item, i) => {
      const sliceAngle = (item.value / total) * Math.PI * 2;
      const defaultColor = DEFAULT_COLORS[i % DEFAULT_COLORS.length] as string;
      const color = item.color ?? defaultColor;

      // Draw slice
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(
        centerX,
        centerY,
        radius,
        currentAngle,
        currentAngle + sliceAngle,
      );
      ctx.closePath();
      ctx.fill();

      // Draw slice border
      ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw label line and text if slice is large enough
      if (sliceAngle > 0.15) {
        const midAngle = currentAngle + sliceAngle / 2;
        const labelRadius = radius * 1.15;
        const labelX = centerX + Math.cos(midAngle) * labelRadius;
        const labelY = centerY + Math.sin(midAngle) * labelRadius;

        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.font = "11px system-ui";
        ctx.textAlign =
          midAngle > -Math.PI / 2 && midAngle < Math.PI / 2 ? "left" : "right";
        ctx.fillText(
          `${item.label} (${((item.value / total) * 100).toFixed(1)}%)`,
          labelX,
          labelY,
        );
      }

      currentAngle += sliceAngle;
    });

    // Draw donut hole
    if (isDonut) {
      ctx.fillStyle =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--color-bg-secondary")
          .trim() || "#1a1a2e";
      ctx.beginPath();
      ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
      ctx.fill();

      // Center label
      if (chartData.centerLabel) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.font = "bold 14px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(chartData.centerLabel, centerX, centerY);
      }
    }
  }, [chartData]);

  if (!chartData?.items?.length) {
    return (
      <div className="chart-widget chart-widget--empty">No data available</div>
    );
  }

  const showLegend = widget.config.display?.showLegend !== false;
  const total = chartData.items.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="chart-widget chart-widget--pie">
      <div className="chart-widget__canvas-container" ref={containerRef}>
        <canvas ref={canvasRef} />
      </div>

      {showLegend && (
        <div className="chart-widget__legend chart-widget__legend--vertical">
          {chartData.items.map((item, i) => (
            <div key={item.label} className="chart-widget__legend-item">
              <span
                className="chart-widget__legend-color"
                style={{
                  backgroundColor:
                    item.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
                }}
              />
              <span className="chart-widget__legend-label">{item.label}</span>
              <span className="chart-widget__legend-value">
                {((item.value / total) * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
