/**
 * useSafeArea Hook
 *
 * Provides safe area inset detection for notch and home indicator handling.
 */

import { useEffect, useState } from "react";

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const DEFAULT_INSETS: SafeAreaInsets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

/**
 * Hook for getting safe area insets
 */
export function useSafeArea(): SafeAreaInsets {
  const [insets, setInsets] = useState<SafeAreaInsets>(DEFAULT_INSETS);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !CSS.supports("padding", "env(safe-area-inset-top)")
    ) {
      return;
    }

    // Create a hidden element to measure safe area insets
    const measureElement = document.createElement("div");
    measureElement.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      visibility: hidden;
      padding-top: env(safe-area-inset-top);
      padding-right: env(safe-area-inset-right);
      padding-bottom: env(safe-area-inset-bottom);
      padding-left: env(safe-area-inset-left);
    `;
    document.body.appendChild(measureElement);

    const updateInsets = () => {
      const computed = window.getComputedStyle(measureElement);
      setInsets({
        top: parseInt(computed.paddingTop, 10) || 0,
        right: parseInt(computed.paddingRight, 10) || 0,
        bottom: parseInt(computed.paddingBottom, 10) || 0,
        left: parseInt(computed.paddingLeft, 10) || 0,
      });
    };

    updateInsets();

    // Update on orientation change
    window.addEventListener("orientationchange", updateInsets);
    window.addEventListener("resize", updateInsets);

    return () => {
      document.body.removeChild(measureElement);
      window.removeEventListener("orientationchange", updateInsets);
      window.removeEventListener("resize", updateInsets);
    };
  }, []);

  return insets;
}

/**
 * Hook for checking if device has a notch
 */
export function useHasNotch(): boolean {
  const { top } = useSafeArea();
  return top > 20; // Standard notch is typically > 20px
}

/**
 * Hook for checking if device has a home indicator
 */
export function useHasHomeIndicator(): boolean {
  const { bottom } = useSafeArea();
  return bottom > 0;
}

/**
 * CSS styles for safe area padding
 */
export const safeAreaStyles = {
  /**
   * Padding that respects safe areas on all sides
   */
  all: {
    paddingTop: "env(safe-area-inset-top)",
    paddingRight: "env(safe-area-inset-right)",
    paddingBottom: "env(safe-area-inset-bottom)",
    paddingLeft: "env(safe-area-inset-left)",
  } as const,

  /**
   * Padding for top safe area only (notch)
   */
  top: {
    paddingTop: "env(safe-area-inset-top)",
  } as const,

  /**
   * Padding for bottom safe area only (home indicator)
   */
  bottom: {
    paddingBottom: "env(safe-area-inset-bottom)",
  } as const,

  /**
   * Padding for horizontal safe areas (landscape notch)
   */
  horizontal: {
    paddingRight: "env(safe-area-inset-right)",
    paddingLeft: "env(safe-area-inset-left)",
  } as const,
};

/**
 * CSS class names for safe area handling
 * Use with Tailwind or custom CSS
 */
export const safeAreaClasses = {
  /** Apply safe area to all sides */
  all: "safe-area-all",
  /** Apply safe area to top only */
  top: "safe-area-top",
  /** Apply safe area to bottom only */
  bottom: "safe-area-bottom",
  /** Apply safe area to horizontal sides */
  horizontal: "safe-area-horizontal",
} as const;

/**
 * CSS to add to your stylesheet for safe area classes
 */
export const safeAreaCSS = `
.safe-area-all {
  padding-top: env(safe-area-inset-top);
  padding-right: env(safe-area-inset-right);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
}

.safe-area-top {
  padding-top: env(safe-area-inset-top);
}

.safe-area-bottom {
  padding-bottom: env(safe-area-inset-bottom);
}

.safe-area-horizontal {
  padding-right: env(safe-area-inset-right);
  padding-left: env(safe-area-inset-left);
}

/* Bottom nav should sit above home indicator */
.safe-area-bottom-nav {
  padding-bottom: max(16px, env(safe-area-inset-bottom));
}
`;

export default useSafeArea;
