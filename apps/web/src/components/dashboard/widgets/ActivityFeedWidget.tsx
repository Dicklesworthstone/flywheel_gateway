/**
 * ActivityFeedWidget - Recent events stream visualization.
 *
 * Data shape expected:
 * {
 *   events: Array<{
 *     id: string,
 *     type: string,
 *     title: string,
 *     description?: string,
 *     timestamp: string,
 *     severity?: 'info' | 'warning' | 'error' | 'success',
 *     metadata?: Record<string, unknown>,
 *   }>
 * }
 */

import type { Widget, WidgetData } from "@flywheel/shared";
import type { JSX } from "react";
import "./ActivityFeedWidget.css";

interface Event {
  id: string;
  type: string;
  title: string;
  description?: string;
  timestamp: string;
  severity?: "info" | "warning" | "error" | "success";
  metadata?: Record<string, unknown>;
}

interface ActivityFeedData {
  events: Event[];
}

interface ActivityFeedWidgetProps {
  widget: Widget;
  data: WidgetData;
}

const SEVERITY_ICONS: Record<string, JSX.Element> = {
  info: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" opacity="0.2" />
      <path
        d="M12 16v-4M12 8h.01"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  ),
  warning: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2L2 22h20L12 2z" opacity="0.2" />
      <path
        d="M12 9v4M12 17h.01"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  ),
  error: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" opacity="0.2" />
      <path
        d="M15 9l-6 6M9 9l6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  ),
  success: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" opacity="0.2" />
      <path
        d="M9 12l2 2 4-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

export function ActivityFeedWidget({
  widget: _widget,
  data,
}: ActivityFeedWidgetProps) {
  const feedData = data.data as ActivityFeedData | null;

  if (!feedData?.events?.length) {
    return (
      <div className="activity-feed-widget activity-feed-widget--empty">
        No recent activity
      </div>
    );
  }

  return (
    <div className="activity-feed-widget">
      <ul className="activity-feed-widget__list">
        {feedData.events.map((event) => {
          const severity = event.severity || "info";

          return (
            <li
              key={event.id}
              className={`activity-feed-widget__item activity-feed-widget__item--${severity}`}
            >
              <div className="activity-feed-widget__icon">
                {SEVERITY_ICONS[severity] || SEVERITY_ICONS["info"]}
              </div>

              <div className="activity-feed-widget__content">
                <div className="activity-feed-widget__header">
                  <span className="activity-feed-widget__type">
                    {event.type}
                  </span>
                  <span className="activity-feed-widget__time">
                    {formatTimeAgo(event.timestamp)}
                  </span>
                </div>

                <div className="activity-feed-widget__title">{event.title}</div>

                {event.description && (
                  <div className="activity-feed-widget__description">
                    {event.description}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString();
}
