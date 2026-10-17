/**
 * useMobileGestures Hook
 *
 * Provides touch gesture detection for mobile interactions.
 */

import { type TouchEvent, useCallback, useRef, useState } from "react";

export interface GestureConfig {
  /** Callback when swiped left */
  onSwipeLeft?: () => void;
  /** Callback when swiped right */
  onSwipeRight?: () => void;
  /** Callback when swiped up */
  onSwipeUp?: () => void;
  /** Callback when swiped down */
  onSwipeDown?: () => void;
  /** Callback for pull-to-refresh */
  onPullToRefresh?: () => Promise<void>;
  /** Minimum distance to trigger swipe (default: 50px) */
  swipeThreshold?: number;
  /** Distance to trigger pull-to-refresh (default: 80px) */
  pullThreshold?: number;
  /** Velocity threshold for swipe detection (px/ms, default: 0.3) */
  velocityThreshold?: number;
  /** Whether to prevent default on horizontal swipes */
  preventDefaultOnHorizontal?: boolean;
  /** Whether gestures are enabled */
  enabled?: boolean;
}

export interface GestureState {
  /** Whether currently swiping */
  isSwiping: boolean;
  /** Whether pull-to-refresh is active */
  isPulling: boolean;
  /** Whether currently refreshing */
  isRefreshing: boolean;
  /** Current swipe direction */
  swipeDirection: SwipeDirection | null;
  /** Pull-to-refresh progress (0-1) */
  pullProgress: number;
  /** Current swipe offset in pixels */
  swipeOffset: { x: number; y: number };
}

export type SwipeDirection = "left" | "right" | "up" | "down";

interface TouchPoint {
  x: number;
  y: number;
  time: number;
}

const DEFAULT_CONFIG: Required<GestureConfig> = {
  onSwipeLeft: () => {},
  onSwipeRight: () => {},
  onSwipeUp: () => {},
  onSwipeDown: () => {},
  onPullToRefresh: async () => {},
  swipeThreshold: 50,
  pullThreshold: 80,
  velocityThreshold: 0.3,
  preventDefaultOnHorizontal: false,
  enabled: true,
};

export function useMobileGestures(config: GestureConfig = {}) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  const [state, setState] = useState<GestureState>({
    isSwiping: false,
    isPulling: false,
    isRefreshing: false,
    swipeDirection: null,
    pullProgress: 0,
    swipeOffset: { x: 0, y: 0 },
  });

  const touchStartRef = useRef<TouchPoint | null>(null);
  const touchCurrentRef = useRef<TouchPoint | null>(null);
  const isScrollingRef = useRef(false);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!mergedConfig.enabled) return;

      const touch = e.touches[0];
      if (!touch) return;
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
      touchCurrentRef.current = touchStartRef.current;
      isScrollingRef.current = false;

      setState((prev) => ({
        ...prev,
        isSwiping: true,
        swipeOffset: { x: 0, y: 0 },
      }));
    },
    [mergedConfig.enabled],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!mergedConfig.enabled || !touchStartRef.current) return;

      const touch = e.touches[0];
      if (!touch) return;
      const start = touchStartRef.current;
      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

      touchCurrentRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };

      // Determine if scrolling or swiping
      if (!isScrollingRef.current && (absDeltaX > 10 || absDeltaY > 10)) {
        // If horizontal movement is dominant, it's a swipe
        isScrollingRef.current = absDeltaY > absDeltaX;
      }

      // Determine swipe direction
      let direction: SwipeDirection | null = null;
      if (absDeltaX > absDeltaY) {
        direction = deltaX > 0 ? "right" : "left";
      } else {
        direction = deltaY > 0 ? "down" : "up";
      }

      // Handle pull-to-refresh
      const isPulling =
        direction === "down" &&
        deltaY > 0 &&
        window.scrollY === 0 &&
        mergedConfig.onPullToRefresh !== DEFAULT_CONFIG.onPullToRefresh;

      const pullProgress = isPulling
        ? Math.min(1, deltaY / mergedConfig.pullThreshold)
        : 0;

      // Prevent default on horizontal swipes if configured
      if (
        mergedConfig.preventDefaultOnHorizontal &&
        !isScrollingRef.current &&
        (direction === "left" || direction === "right")
      ) {
        e.preventDefault();
      }

      setState((prev) => ({
        ...prev,
        swipeDirection: direction,
        swipeOffset: { x: deltaX, y: deltaY },
        isPulling,
        pullProgress,
      }));
    },
    [
      mergedConfig.enabled,
      mergedConfig.pullThreshold,
      mergedConfig.preventDefaultOnHorizontal,
      mergedConfig.onPullToRefresh,
    ],
  );

  const handleTouchEnd = useCallback(
    async (_e: TouchEvent) => {
      if (
        !mergedConfig.enabled ||
        !touchStartRef.current ||
        !touchCurrentRef.current
      ) {
        return;
      }

      const start = touchStartRef.current;
      const end = touchCurrentRef.current;
      const deltaX = end.x - start.x;
      const deltaY = end.y - start.y;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);
      const duration = end.time - start.time;
      const velocity = Math.sqrt(deltaX * deltaX + deltaY * deltaY) / duration;

      // Check if swipe was fast enough and far enough
      const isValidSwipe =
        velocity >= mergedConfig.velocityThreshold &&
        (absDeltaX >= mergedConfig.swipeThreshold ||
          absDeltaY >= mergedConfig.swipeThreshold);

      if (isValidSwipe && !isScrollingRef.current) {
        // Determine primary direction
        if (absDeltaX > absDeltaY) {
          // Horizontal swipe
          if (deltaX > 0) {
            mergedConfig.onSwipeRight?.();
          } else {
            mergedConfig.onSwipeLeft?.();
          }
        } else {
          // Vertical swipe
          if (deltaY > 0) {
            mergedConfig.onSwipeDown?.();
          } else {
            mergedConfig.onSwipeUp?.();
          }
        }
      }

      // Handle pull-to-refresh completion
      if (
        state.isPulling &&
        state.pullProgress >= 1 &&
        mergedConfig.onPullToRefresh !== DEFAULT_CONFIG.onPullToRefresh
      ) {
        setState((prev) => ({
          ...prev,
          isRefreshing: true,
        }));

        try {
          await mergedConfig.onPullToRefresh?.();
        } finally {
          setState((prev) => ({
            ...prev,
            isRefreshing: false,
          }));
        }
      }

      // Reset state
      touchStartRef.current = null;
      touchCurrentRef.current = null;
      isScrollingRef.current = false;

      setState((prev) => ({
        ...prev,
        isSwiping: false,
        isPulling: false,
        swipeDirection: null,
        pullProgress: 0,
        swipeOffset: { x: 0, y: 0 },
      }));
    },
    [
      mergedConfig.enabled,
      mergedConfig.swipeThreshold,
      mergedConfig.velocityThreshold,
      mergedConfig.onSwipeLeft,
      mergedConfig.onSwipeRight,
      mergedConfig.onSwipeUp,
      mergedConfig.onSwipeDown,
      mergedConfig.onPullToRefresh,
      state.isPulling,
      state.pullProgress,
    ],
  );

  const handleTouchCancel = useCallback(() => {
    touchStartRef.current = null;
    touchCurrentRef.current = null;
    isScrollingRef.current = false;

    setState({
      isSwiping: false,
      isPulling: false,
      isRefreshing: false,
      swipeDirection: null,
      pullProgress: 0,
      swipeOffset: { x: 0, y: 0 },
    });
  }, []);

  return {
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: handleTouchCancel,
    },
    state,
  };
}

/**
 * Hook for swipe-to-dismiss functionality
 */
export function useSwipeToDismiss(
  onDismiss: () => void,
  options: { direction?: "left" | "right" | "both"; threshold?: number } = {},
) {
  const { direction = "right", threshold = 100 } = options;

  const [offset, setOffset] = useState(0);
  const [isDismissing, setIsDismissing] = useState(false);

  const { handlers, state } = useMobileGestures({
    ...(direction === "left" || direction === "both"
      ? { onSwipeLeft: onDismiss }
      : {}),
    ...(direction === "right" || direction === "both"
      ? { onSwipeRight: onDismiss }
      : {}),
    swipeThreshold: threshold,
    preventDefaultOnHorizontal: true,
  });

  // Update offset during swipe
  const enhancedHandlers = {
    ...handlers,
    onTouchMove: (e: TouchEvent) => {
      handlers.onTouchMove(e);
      if (state.isSwiping) {
        const relevantOffset = state.swipeOffset.x;
        if (
          (direction === "right" && relevantOffset > 0) ||
          (direction === "left" && relevantOffset < 0) ||
          direction === "both"
        ) {
          setOffset(relevantOffset);
        }
      }
    },
    onTouchEnd: (e: TouchEvent) => {
      handlers.onTouchEnd(e);
      if (Math.abs(offset) >= threshold) {
        setIsDismissing(true);
      }
      setOffset(0);
    },
  };

  return {
    handlers: enhancedHandlers,
    offset,
    isDismissing,
    progress: Math.min(1, Math.abs(offset) / threshold),
  };
}

export default useMobileGestures;
