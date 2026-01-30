/**
 * HeatmapWidget - Grid visualization with color intensity representing values.
 *
 * Data shape expected:
 * {
 *   rows: Array<{
 *     label: string,
 *     cells: Array<{
 *       value: number,
 *       label?: string,
 *     }>,
 *   }>,
 *   columnLabels?: string[],
 *   colorScale?: { min: string, max: string },
 *   showValues?: boolean,
 * }
 */

import type { Widget, WidgetData } from "@flywheel/shared";
import { useEffect, useRef } from "react";
import "./ChartWidget.css";

interface HeatmapCell {
  value: number;
  label?: string;
}

interface HeatmapRow {
  label: string;
  cells: HeatmapCell[];
}

interface HeatmapData {
  rows: HeatmapRow[];
  columnLabels?: string[];
  colorScale?: { min: string; max: string };
  showValues?: boolean;
}

interface HeatmapWidgetProps {
  widget: Widget;
  data: WidgetData;
}

const DEFAULT_COLOR_SCALE = {
  min: "#1e293b", // slate-800
  max: "#6366f1", // indigo-500
};

export function HeatmapWidget({ widget: _widget, data }: HeatmapWidgetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const heatmapData = data.data as HeatmapData | null;

  useEffect(() => {
    if (
      !heatmapData?.rows?.length ||
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

    // Calculate dimensions
    const rows = heatmapData.rows;
    const numRows = rows.length;
    const numCols = Math.max(...rows.map((r) => r.cells.length));
    const showColumnLabels = !!heatmapData.columnLabels?.length;

    const padding = {
      top: showColumnLabels ? 40 : 20,
      right: 20,
      bottom: 20,
      left: 80,
    };

    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const cellWidth = chartWidth / numCols;
    const cellHeight = chartHeight / numRows;
    const cellGap = 2;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Find min/max values for color scaling
    let minValue = Infinity;
    let maxValue = -Infinity;
    for (const row of rows) {
      for (const cell of row.cells) {
        minValue = Math.min(minValue, cell.value);
        maxValue = Math.max(maxValue, cell.value);
      }
    }

    // Handle edge case where all values are the same
    if (minValue === maxValue) {
      maxValue = minValue + 1;
    }

    const colorScale = heatmapData.colorScale ?? DEFAULT_COLOR_SCALE;
    const minColor = parseColor(colorScale.min);
    const maxColor = parseColor(colorScale.max);

    // Draw column labels
    if (showColumnLabels && heatmapData.columnLabels) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      ctx.font = "11px system-ui";
      ctx.textAlign = "center";

      heatmapData.columnLabels.slice(0, numCols).forEach((label, i) => {
        const x = padding.left + cellWidth * i + cellWidth / 2;
        ctx.fillText(truncateLabel(label, 8), x, padding.top - 8);
      });
    }

    // Draw rows
    rows.forEach((row, rowIndex) => {
      const y = padding.top + cellHeight * rowIndex;

      // Row label
      ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
      ctx.font = "12px system-ui";
      ctx.textAlign = "right";
      ctx.fillText(
        truncateLabel(row.label, 10),
        padding.left - 8,
        y + cellHeight / 2 + 4,
      );

      // Cells
      row.cells.forEach((cell, colIndex) => {
        const x = padding.left + cellWidth * colIndex;

        // Calculate color based on value
        const ratio = (cell.value - minValue) / (maxValue - minValue);
        const color = interpolateColor(minColor, maxColor, ratio);

        // Draw cell
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(
          x + cellGap / 2,
          y + cellGap / 2,
          cellWidth - cellGap,
          cellHeight - cellGap,
          3,
        );
        ctx.fill();

        // Draw value if showValues is enabled and cell is large enough
        if (heatmapData.showValues && cellWidth > 30 && cellHeight > 20) {
          ctx.fillStyle =
            ratio > 0.5
              ? "rgba(255, 255, 255, 0.9)"
              : "rgba(255, 255, 255, 0.7)";
          ctx.font = "10px system-ui";
          ctx.textAlign = "center";
          ctx.fillText(
            formatValue(cell.value),
            x + cellWidth / 2,
            y + cellHeight / 2 + 4,
          );
        }
      });
    });

    // Draw legend
    const legendWidth = 100;
    const legendHeight = 12;
    const legendX = width - padding.right - legendWidth;
    const legendY = height - 16;

    // Gradient bar
    const gradient = ctx.createLinearGradient(
      legendX,
      legendY,
      legendX + legendWidth,
      legendY,
    );
    gradient.addColorStop(0, colorScale.min);
    gradient.addColorStop(1, colorScale.max);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(legendX, legendY, legendWidth, legendHeight, 2);
    ctx.fill();

    // Legend labels
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = "10px system-ui";
    ctx.textAlign = "left";
    ctx.fillText(formatValue(minValue), legendX, legendY - 4);
    ctx.textAlign = "right";
    ctx.fillText(formatValue(maxValue), legendX + legendWidth, legendY - 4);
  }, [heatmapData]);

  if (!heatmapData?.rows?.length) {
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

function parseColor(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 0, 0];
  return [
    Number.parseInt(result[1] ?? "00", 16),
    Number.parseInt(result[2] ?? "00", 16),
    Number.parseInt(result[3] ?? "00", 16),
  ];
}

function interpolateColor(
  min: [number, number, number],
  max: [number, number, number],
  ratio: number,
): string {
  const r = Math.round(min[0] + (max[0] - min[0]) * ratio);
  const g = Math.round(min[1] + (max[1] - min[1]) * ratio);
  const b = Math.round(min[2] + (max[2] - min[2]) * ratio);
  return `rgb(${r}, ${g}, ${b})`;
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
    ? `${label.substring(0, maxLength - 1)}…`
    : label;
}
