/**
 * Responsive Breakpoints
 *
 * Defines consistent breakpoints for responsive design across the application.
 */

export const BREAKPOINTS = {
  /** Extra small phones (320px) */
  xs: 320,
  /** Large phones (480px) */
  sm: 480,
  /** Tablets portrait (768px) */
  md: 768,
  /** Tablets landscape / small laptops (1024px) */
  lg: 1024,
  /** Desktops (1280px) */
  xl: 1280,
  /** Large screens (1536px) */
  xxl: 1536,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/**
 * Media query strings for use in CSS-in-JS or media query matching
 */
export const mediaQueries = {
  /** Phones only (< 768px) */
  mobile: `(max-width: ${BREAKPOINTS.md - 1}px)`,
  /** Tablets only (768px - 1023px) */
  tablet: `(min-width: ${BREAKPOINTS.md}px) and (max-width: ${BREAKPOINTS.lg - 1}px)`,
  /** Desktop and above (>= 1024px) */
  desktop: `(min-width: ${BREAKPOINTS.lg}px)`,
  /** Small phones only (< 480px) */
  smallPhone: `(max-width: ${BREAKPOINTS.sm - 1}px)`,
  /** Touch devices */
  touch: "(hover: none) and (pointer: coarse)",
  /** Precise pointer devices (mouse) */
  mouse: "(hover: hover) and (pointer: fine)",
  /** Reduced motion preference */
  reducedMotion: "(prefers-reduced-motion: reduce)",
  /** Dark mode preference */
  darkMode: "(prefers-color-scheme: dark)",
  /** Light mode preference */
  lightMode: "(prefers-color-scheme: light)",
  /** Portrait orientation */
  portrait: "(orientation: portrait)",
  /** Landscape orientation */
  landscape: "(orientation: landscape)",
} as const;

/**
 * Minimum and maximum width queries for each breakpoint
 */
export const breakpointQueries = {
  xs: {
    min: `(min-width: ${BREAKPOINTS.xs}px)`,
    max: `(max-width: ${BREAKPOINTS.sm - 1}px)`,
  },
  sm: {
    min: `(min-width: ${BREAKPOINTS.sm}px)`,
    max: `(max-width: ${BREAKPOINTS.md - 1}px)`,
  },
  md: {
    min: `(min-width: ${BREAKPOINTS.md}px)`,
    max: `(max-width: ${BREAKPOINTS.lg - 1}px)`,
  },
  lg: {
    min: `(min-width: ${BREAKPOINTS.lg}px)`,
    max: `(max-width: ${BREAKPOINTS.xl - 1}px)`,
  },
  xl: {
    min: `(min-width: ${BREAKPOINTS.xl}px)`,
    max: `(max-width: ${BREAKPOINTS.xxl - 1}px)`,
  },
  xxl: {
    min: `(min-width: ${BREAKPOINTS.xxl}px)`,
    max: undefined,
  },
} as const;

/**
 * Tailwind-style responsive prefixes
 * Use these with CSS classes: `sm:hidden md:block`
 */
export const responsivePrefixes = [
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "xxl",
] as const;

/**
 * Check if a breakpoint value is considered mobile
 */
export function isMobileBreakpoint(breakpoint: Breakpoint): boolean {
  return BREAKPOINTS[breakpoint] < BREAKPOINTS.md;
}

/**
 * Check if a breakpoint value is considered tablet
 */
export function isTabletBreakpoint(breakpoint: Breakpoint): boolean {
  const value = BREAKPOINTS[breakpoint];
  return value >= BREAKPOINTS.md && value < BREAKPOINTS.lg;
}

/**
 * Check if a breakpoint value is considered desktop
 */
export function isDesktopBreakpoint(breakpoint: Breakpoint): boolean {
  return BREAKPOINTS[breakpoint] >= BREAKPOINTS.lg;
}

/**
 * Get the current breakpoint based on window width
 */
export function getCurrentBreakpoint(width: number): Breakpoint {
  if (width < BREAKPOINTS.sm) return "xs";
  if (width < BREAKPOINTS.md) return "sm";
  if (width < BREAKPOINTS.lg) return "md";
  if (width < BREAKPOINTS.xl) return "lg";
  if (width < BREAKPOINTS.xxl) return "xl";
  return "xxl";
}

/**
 * Touch target size constants (Apple HIG recommendations)
 */
export const TOUCH_TARGETS = {
  /** Minimum touch target size */
  min: 44,
  /** Recommended touch target size */
  recommended: 48,
  /** Minimum spacing between touch targets */
  spacing: 8,
} as const;

/**
 * Safe area CSS variables
 */
export const SAFE_AREA_VARS = {
  top: "env(safe-area-inset-top)",
  right: "env(safe-area-inset-right)",
  bottom: "env(safe-area-inset-bottom)",
  left: "env(safe-area-inset-left)",
} as const;
