/**
 * GaugeWidget - Progress/capacity visualization.
 *
 * Data shape expected:
 * {
 *   value: number,
 *   min?: number,
 *   max?: number,
 *   label?: string,
 *   unit?: string,
 *   segments?: Array<{ from: number, to: number, color: string }>,
 * }
 */

import type { Widget, WidgetData } from "@flywheel/shared";
import { useEffect, useRef } from "react";
import "./GaugeWidget.css";

interface Segment {
  from: number;
  to: number;
  color: string;
}

interface GaugeData {
  value: number;
  min?: number;
  max?: number;
  label?: string;
  unit?: string;
  segments?: Segment[];
}

interface GaugeWidgetProps {
  widget: Widget;
  data: WidgetData;
}

const DEFAULT_SEGMENTS: Segment[] = [
  { from: 0, to: 60, color: "#10b981" },
  { from: 60, to: 80, color: "#f59e0b" },
  { from: 80, to: 100, color: "#ef4444" },
];

export function GaugeWidget({ widget: _widget, data }: GaugeWidgetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gaugeData = data.data as GaugeData | null;

  useEffect(() => {
    if (
      gaugeData === null ||
      gaugeData === undefined ||
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
    const size = Math.min(rect.width, rect.height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size / 2 - 20;
    const lineWidth = 16;

    const min = gaugeData.min ?? 0;
    const max = gaugeData.max ?? 100;
    const value = Math.min(Math.max(gaugeData.value, min), max);
    const percentage = ((value - min) / (max - min)) * 100;

    // Arc angles (bottom half is empty)
    const startAngle = 0.75 * Math.PI;
    const endAngle = 2.25 * Math.PI;
    const totalAngle = endAngle - startAngle;

    // Clear canvas
    ctx.clearRect(0, 0, size, size);

    // Draw background arc
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineCap = "round";
    ctx.stroke();

    // Draw segments
    const segments = gaugeData.segments || DEFAULT_SEGMENTS;
    segments.forEach((segment) => {
      const segmentStart = startAngle + (segment.from / 100) * totalAngle;
      const segmentEnd = startAngle + (segment.to / 100) * totalAngle;

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, segmentStart, segmentEnd);
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = `${segment.color}40`; // 25% opacity
      ctx.lineCap = "butt";
      ctx.stroke();
    });

    // Draw value arc
    const valueAngle = startAngle + (percentage / 100) * totalAngle;

    // Find the color for current value
    let valueColor = "#6366f1";
    for (const segment of segments) {
      if (percentage >= segment.from && percentage <= segment.to) {
        valueColor = segment.color;
        break;
      }
    }

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, valueAngle);
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = valueColor;
    ctx.lineCap = "round";
    ctx.stroke();

    // Draw needle
    const needleLength = radius - lineWidth;
    const needleAngle = valueAngle;
    const needleX = centerX + Math.cos(needleAngle) * needleLength;
    const needleY = centerY + Math.sin(needleAngle) * needleLength;

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(needleX, needleY);
    ctx.lineWidth = 3;
    ctx.strokeStyle = valueColor;
    ctx.lineCap = "round";
    ctx.stroke();

    // Draw center dot
    ctx.beginPath();
    ctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
    ctx.fillStyle = valueColor;
    ctx.fill();

    // Draw min/max labels
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = "11px system-ui";
    ctx.textAlign = "center";

    const minLabelX = centerX + Math.cos(startAngle) * (radius + 24);
    const minLabelY = centerY + Math.sin(startAngle) * (radius + 24);
    ctx.fillText(String(min), minLabelX, minLabelY);

    const maxLabelX = centerX + Math.cos(endAngle) * (radius + 24);
    const maxLabelY = centerY + Math.sin(endAngle) * (radius + 24);
    ctx.fillText(String(max), maxLabelX, maxLabelY);
  }, [gaugeData]);

  if (gaugeData === null || gaugeData === undefined) {
    return (
      <div className="gauge-widget gauge-widget--empty">No data available</div>
    );
  }

  const { value, label, unit } = gaugeData;

  return (
    <div className="gauge-widget">
      <div className="gauge-widget__canvas-container" ref={containerRef}>
        <canvas ref={canvasRef} />
      </div>

      <div className="gauge-widget__value-container">
        <div className="gauge-widget__value">
          {typeof value === "number" ? value.toLocaleString() : value}
          {unit && <span className="gauge-widget__unit">{unit}</span>}
        </div>
        {label && <div className="gauge-widget__label">{label}</div>}
      </div>
    </div>
  );
}
