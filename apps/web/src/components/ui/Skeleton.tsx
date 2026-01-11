/**
 * Skeleton and Spinner loading components.
 *
 * Provides visual feedback during data loading.
 */

import type { CSSProperties } from "react";

interface SkeletonProps {
  /** Width of the skeleton */
  width?: string | number;
  /** Height of the skeleton */
  height?: string | number;
  /** Border radius */
  borderRadius?: string | number;
  /** Preset variant */
  variant?: "text" | "text-sm" | "avatar" | "button" | "circle";
  /** Additional CSS class */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
}

/**
 * Skeleton placeholder component.
 */
export function Skeleton({
  width,
  height,
  borderRadius,
  variant,
  className = "",
  style,
}: SkeletonProps) {
  const variantClass = variant ? `skeleton--${variant}` : "";

  const computedStyle: CSSProperties = {
    width,
    height,
    borderRadius,
    ...style,
  };

  return (
    <div
      className={`skeleton ${variantClass} ${className}`}
      style={computedStyle}
      aria-hidden="true"
    />
  );
}

/**
 * Skeleton text line.
 */
export function SkeletonText({
  lines = 1,
  lastLineWidth = "60%",
  className = "",
}: {
  lines?: number;
  lastLineWidth?: string;
  className?: string;
}) {
  return (
    <div className={`skeleton-text ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          style={{
            width: i === lines - 1 ? lastLineWidth : "100%",
            marginBottom: i < lines - 1 ? 8 : 0,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Skeleton card.
 */
export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`card ${className}`}>
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <Skeleton variant="avatar" />
        <div style={{ flex: 1 }}>
          <Skeleton variant="text" style={{ width: "40%", marginBottom: 8 }} />
          <Skeleton variant="text-sm" />
        </div>
      </div>
      <SkeletonText lines={3} />
    </div>
  );
}

// ============================================
// SPINNER
// ============================================

type SpinnerSize = "sm" | "md" | "lg";

interface SpinnerProps {
  /** Size of the spinner */
  size?: SpinnerSize;
  /** Additional CSS class */
  className?: string;
  /** Label for accessibility */
  label?: string;
}

/**
 * Spinner loading indicator.
 */
export function Spinner({
  size = "md",
  className = "",
  label = "Loading...",
}: SpinnerProps) {
  const sizeClass =
    size === "sm" ? "spinner--sm" : size === "lg" ? "spinner--lg" : "";

  return (
    <span
      className={`spinner ${sizeClass} ${className}`}
      role="status"
      aria-label={label}
    />
  );
}

/**
 * Full-page loading state.
 */
export function LoadingOverlay({
  message = "Loading...",
}: {
  message?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 48,
        gap: 16,
      }}
    >
      <Spinner size="lg" />
      <p style={{ color: "var(--ink-muted)" }}>{message}</p>
    </div>
  );
}
