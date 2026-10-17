/**
 * Banner component to indicate mock data is being displayed.
 *
 * Shows a warning banner when the UI is displaying mock/fallback data
 * instead of real API data. This ensures users are aware they're seeing
 * fake data rather than the actual system state.
 */

import { AlertTriangle } from "lucide-react";

interface MockDataBannerProps {
  /** Optional message to display instead of the default */
  message?: string;
  /** Optional additional CSS class */
  className?: string;
}

export function MockDataBanner({
  message = "Showing mock data - API unavailable",
  className = "",
}: MockDataBannerProps) {
  return (
    <div
      className={`mock-data-banner ${className}`}
      role="alert"
      aria-live="polite"
    >
      <AlertTriangle size={16} className="mock-data-banner__icon" />
      <span className="mock-data-banner__text">{message}</span>
    </div>
  );
}
