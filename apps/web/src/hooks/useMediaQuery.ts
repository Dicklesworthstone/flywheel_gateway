/**
 * useMediaQuery Hook
 *
 * Provides responsive breakpoint detection for React components.
 */

import { useEffect, useMemo, useState } from "react";
import {
  BREAKPOINTS,
  type Breakpoint,
  getCurrentBreakpoint,
  mediaQueries,
} from "../styles/breakpoints";

interface MediaQueryState {
  /** Current breakpoint name */
  breakpoint: Breakpoint;
  /** Window width in pixels */
  width: number;
  /** Window height in pixels */
  height: number;
  /** Is mobile viewport (< 768px) */
  isMobile: boolean;
  /** Is tablet viewport (768px - 1023px) */
  isTablet: boolean;
  /** Is desktop viewport (>= 1024px) */
  isDesktop: boolean;
  /** Is touch device */
  isTouch: boolean;
  /** Is portrait orientation */
  isPortrait: boolean;
  /** Is landscape orientation */
  isLandscape: boolean;
  /** User prefers reduced motion */
  prefersReducedMotion: boolean;
  /** User prefers dark mode */
  prefersDarkMode: boolean;
}

/**
 * Default server-side rendering values
 */
const SSR_DEFAULTS: MediaQueryState = {
  breakpoint: "lg",
  width: 1024,
  height: 768,
  isMobile: false,
  isTablet: false,
  isDesktop: true,
  isTouch: false,
  isPortrait: false,
  isLandscape: true,
  prefersReducedMotion: false,
  prefersDarkMode: false,
};

/**
 * Hook for tracking media query states
 */
export function useMediaQuery(): MediaQueryState {
  const [state, setState] = useState<MediaQueryState>(() => {
    // SSR-safe initialization
    if (typeof window === "undefined") {
      return SSR_DEFAULTS;
    }
    return getMediaQueryState();
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Update state immediately on mount
    setState(getMediaQueryState());

    // Handle resize
    const handleResize = () => {
      setState(getMediaQueryState());
    };

    // Handle media query changes
    const touchQuery = window.matchMedia(mediaQueries.touch);
    const motionQuery = window.matchMedia(mediaQueries.reducedMotion);
    const darkQuery = window.matchMedia(mediaQueries.darkMode);
    const portraitQuery = window.matchMedia(mediaQueries.portrait);

    const handleMediaChange = () => {
      setState(getMediaQueryState());
    };

    // Add listeners
    window.addEventListener("resize", handleResize);
    touchQuery.addEventListener("change", handleMediaChange);
    motionQuery.addEventListener("change", handleMediaChange);
    darkQuery.addEventListener("change", handleMediaChange);
    portraitQuery.addEventListener("change", handleMediaChange);

    return () => {
      window.removeEventListener("resize", handleResize);
      touchQuery.removeEventListener("change", handleMediaChange);
      motionQuery.removeEventListener("change", handleMediaChange);
      darkQuery.removeEventListener("change", handleMediaChange);
      portraitQuery.removeEventListener("change", handleMediaChange);
    };
  }, []);

  return state;
}

/**
 * Get current media query state from window
 */
function getMediaQueryState(): MediaQueryState {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const breakpoint = getCurrentBreakpoint(width);

  return {
    breakpoint,
    width,
    height,
    isMobile: width < BREAKPOINTS.md,
    isTablet: width >= BREAKPOINTS.md && width < BREAKPOINTS.lg,
    isDesktop: width >= BREAKPOINTS.lg,
    isTouch: window.matchMedia(mediaQueries.touch).matches,
    isPortrait: window.matchMedia(mediaQueries.portrait).matches,
    isLandscape: window.matchMedia(mediaQueries.landscape).matches,
    prefersReducedMotion: window.matchMedia(mediaQueries.reducedMotion).matches,
    prefersDarkMode: window.matchMedia(mediaQueries.darkMode).matches,
  };
}

/**
 * Hook for matching a specific media query
 */
export function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia(query);
    setMatches(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

/**
 * Hook for checking if at or above a breakpoint
 */
export function useBreakpointUp(breakpoint: Breakpoint): boolean {
  const { width } = useMediaQuery();
  return width >= BREAKPOINTS[breakpoint];
}

/**
 * Hook for checking if at or below a breakpoint
 */
export function useBreakpointDown(breakpoint: Breakpoint): boolean {
  const { width } = useMediaQuery();
  return width < BREAKPOINTS[breakpoint];
}

/**
 * Hook for checking if between two breakpoints
 */
export function useBreakpointBetween(
  lower: Breakpoint,
  upper: Breakpoint,
): boolean {
  const { width } = useMediaQuery();
  return width >= BREAKPOINTS[lower] && width < BREAKPOINTS[upper];
}

/**
 * Hook for responsive value selection
 */
export function useResponsiveValue<T>(
  values: Partial<Record<Breakpoint, T>>,
  defaultValue: T,
): T {
  const { breakpoint } = useMediaQuery();

  return useMemo(() => {
    // Check from current breakpoint down to find a value
    const breakpoints: Breakpoint[] = ["xxl", "xl", "lg", "md", "sm", "xs"];
    const currentIndex = breakpoints.indexOf(breakpoint);

    for (let i = currentIndex; i < breakpoints.length; i++) {
      const bp = breakpoints[i];
      if (bp !== undefined && values[bp] !== undefined) {
        return values[bp];
      }
    }

    return defaultValue;
  }, [breakpoint, values, defaultValue]);
}

/**
 * Hook for device-specific rendering
 */
export function useDeviceType(): "mobile" | "tablet" | "desktop" {
  const { isMobile, isTablet } = useMediaQuery();

  if (isMobile) return "mobile";
  if (isTablet) return "tablet";
  return "desktop";
}

export default useMediaQuery;
