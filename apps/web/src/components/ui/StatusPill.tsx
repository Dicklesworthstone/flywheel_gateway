import type { ReactNode } from "react";

export type Tone = "positive" | "warning" | "danger" | "critical" | "muted" | "info";

interface StatusPillProps {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}

export function StatusPill({
  tone = "muted",
  title,
  children,
}: StatusPillProps) {
  return (
    <span className={`status-pill status-pill--${tone}`} title={title}>
      {children}
    </span>
  );
}
