/**
 * Utility for determining if mock data fallback is allowed.
 *
 * Mock fallback is only allowed in development mode or when explicitly
 * enabled via the mockMode setting. In production, API errors should
 * be shown to users rather than hidden behind fake data.
 */

import { useUiStore } from "../stores/ui";

/**
 * Check if mock data fallback should be used.
 *
 * Returns true only when:
 * - Environment is development (NODE_ENV === "development"), OR
 * - Mock mode is explicitly enabled in the UI store
 *
 * In production builds, this returns false unless mockMode is explicitly set,
 * ensuring users see real errors instead of fake data.
 */
export function useAllowMockFallback(): boolean {
  const mockMode = useUiStore((state) => state.mockMode);

  // In development, always allow mock fallback
  const isDevelopment = import.meta.env.DEV;

  // Explicitly disabling mock mode should disable fallback even in dev
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem("fw-mock-mode");
    if (stored === "false") {
      return false;
    }
  }

  return mockMode || isDevelopment;
}

/**
 * Non-hook version for use outside React components.
 * Checks localStorage directly for mock mode setting.
 */
export function getAllowMockFallback(): boolean {
  const isDevelopment = import.meta.env.DEV === true;

  if (typeof window === "undefined") {
    return isDevelopment;
  }

  const stored = window.localStorage.getItem("fw-mock-mode");
  if (stored === "false") {
    return false;
  }
  const mockMode = stored === "true";

  return mockMode || isDevelopment;
}
