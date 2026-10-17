/**
 * Pull to Refresh Component
 *
 * Provides pull-to-refresh functionality for mobile lists.
 */

import { RefreshCw } from "lucide-react";
import { memo, type ReactNode } from "react";
import { useMobileGestures } from "../../hooks/useMobileGestures";

export interface PullToRefreshProps {
  /** Children to render inside the pull-to-refresh container */
  children: ReactNode;
  /** Callback when refresh is triggered */
  onRefresh: () => Promise<void>;
  /** Whether pull-to-refresh is enabled (default: true) */
  enabled?: boolean;
  /** Pull threshold in pixels (default: 80) */
  threshold?: number;
  /** Custom refresh indicator */
  indicator?: ReactNode;
  /** Additional CSS class */
  className?: string;
}

/**
 * Pull-to-refresh container component
 */
export const PullToRefresh = memo(function PullToRefresh({
  children,
  onRefresh,
  enabled = true,
  threshold = 80,
  indicator,
  className = "",
}: PullToRefreshProps) {
  const { handlers, state } = useMobileGestures({
    onPullToRefresh: onRefresh,
    pullThreshold: threshold,
    enabled,
  });

  const { isPulling, isRefreshing, pullProgress } = state;

  // Calculate indicator position and rotation
  const indicatorTranslateY = isPulling ? pullProgress * threshold : 0;
  const indicatorRotation = isPulling
    ? pullProgress * 180
    : isRefreshing
      ? 360
      : 0;
  const indicatorOpacity = isPulling
    ? Math.min(1, pullProgress * 1.5)
    : isRefreshing
      ? 1
      : 0;

  return (
    <div className={`relative overflow-hidden ${className}`} {...handlers}>
      {/* Pull indicator */}
      <div
        className="absolute left-1/2 -translate-x-1/2 z-10 transition-opacity duration-200"
        style={{
          transform: `translateX(-50%) translateY(${indicatorTranslateY - 40}px)`,
          opacity: indicatorOpacity,
        }}
        aria-hidden={!isPulling && !isRefreshing}
      >
        {indicator || (
          <div className="w-10 h-10 bg-gray-800 rounded-full flex items-center justify-center shadow-lg">
            <RefreshCw
              className={`w-5 h-5 text-blue-400 transition-transform duration-200 ${
                isRefreshing ? "animate-spin" : ""
              }`}
              style={{
                transform: `rotate(${indicatorRotation}deg)`,
              }}
            />
          </div>
        )}
      </div>

      {/* Content container */}
      <div
        className="transition-transform duration-200"
        style={{
          transform: isPulling
            ? `translateY(${pullProgress * 50}px)`
            : "translateY(0)",
        }}
      >
        {children}
      </div>

      {/* Refresh status text */}
      {(isPulling || isRefreshing) && (
        <div
          className="absolute top-2 left-1/2 -translate-x-1/2 text-xs text-gray-400 transition-opacity duration-200"
          style={{
            opacity: indicatorOpacity,
          }}
        >
          {isRefreshing
            ? "Refreshing..."
            : pullProgress >= 1
              ? "Release to refresh"
              : "Pull to refresh"}
        </div>
      )}
    </div>
  );
});

/**
 * Simple pull indicator component
 */
export function PullIndicator({
  progress,
  isRefreshing,
}: {
  progress: number;
  isRefreshing: boolean;
}) {
  return (
    <div className="w-10 h-10 bg-gray-800 rounded-full flex items-center justify-center shadow-lg">
      <RefreshCw
        className={`w-5 h-5 text-blue-400 transition-transform ${
          isRefreshing ? "animate-spin" : ""
        }`}
        style={{
          transform: `rotate(${progress * 180}deg)`,
        }}
      />
    </div>
  );
}

/**
 * Hook for using pull-to-refresh in custom layouts
 */
export function usePullToRefresh(
  onRefresh: () => Promise<void>,
  enabled = true,
) {
  const { handlers, state } = useMobileGestures({
    onPullToRefresh: onRefresh,
    enabled,
  });

  return {
    handlers,
    isPulling: state.isPulling,
    isRefreshing: state.isRefreshing,
    progress: state.pullProgress,
  };
}

export default PullToRefresh;
