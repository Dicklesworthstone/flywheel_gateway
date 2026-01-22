/**
 * Safety Posture hooks for API integration.
 *
 * Provides hooks for fetching safety posture status including DCG, SLB, UBS
 * installation status and ACFS checksum age for tool integrity verification.
 */

import { useCallback, useEffect, useState } from "react";
import { useUiStore } from "../stores/ui";

// ============================================================================
// Types
// ============================================================================

export interface ToolStatus {
  installed: boolean;
  version: string | null;
  healthy: boolean;
  latencyMs: number;
}

export interface ChecksumStatus {
  toolId: string;
  hasChecksums: boolean;
  checksumCount: number;
  registryGeneratedAt: string | null;
  ageMs: number | null;
  stale: boolean;
}

export interface SafetyPostureResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  tools: {
    dcg: ToolStatus;
    slb: ToolStatus;
    ubs: ToolStatus;
  };
  checksums: {
    registryGeneratedAt: string | null;
    registryAgeMs: number | null;
    toolsWithChecksums: number;
    staleThresholdMs: number;
    isStale: boolean;
    tools: ChecksumStatus[];
  };
  summary: {
    allToolsInstalled: boolean;
    allToolsHealthy: boolean;
    checksumsAvailable: boolean;
    checksumsStale: boolean;
    overallHealthy: boolean;
    issues: string[];
    recommendations: string[];
  };
}

// ============================================================================
// Mock Data (used when mockMode is enabled or API unavailable)
// ============================================================================

const mockSafetyPosture: SafetyPostureResponse = {
  status: "degraded",
  timestamp: new Date().toISOString(),
  tools: {
    dcg: {
      installed: true,
      version: "0.9.2",
      healthy: true,
      latencyMs: 12,
    },
    slb: {
      installed: true,
      version: "1.2.0",
      healthy: true,
      latencyMs: 8,
    },
    ubs: {
      installed: false,
      version: null,
      healthy: false,
      latencyMs: 5,
    },
  },
  checksums: {
    registryGeneratedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    registryAgeMs: 3 * 24 * 60 * 60 * 1000,
    toolsWithChecksums: 2,
    staleThresholdMs: 7 * 24 * 60 * 60 * 1000,
    isStale: false,
    tools: [
      {
        toolId: "safety.dcg",
        hasChecksums: true,
        checksumCount: 5,
        registryGeneratedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        ageMs: 3 * 24 * 60 * 60 * 1000,
        stale: false,
      },
      {
        toolId: "safety.slb",
        hasChecksums: true,
        checksumCount: 3,
        registryGeneratedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        ageMs: 3 * 24 * 60 * 60 * 1000,
        stale: false,
      },
      {
        toolId: "safety.ubs",
        hasChecksums: false,
        checksumCount: 0,
        registryGeneratedAt: null,
        ageMs: null,
        stale: false,
      },
    ],
  },
  summary: {
    allToolsInstalled: false,
    allToolsHealthy: false,
    checksumsAvailable: true,
    checksumsStale: false,
    overallHealthy: false,
    issues: ["UBS (Ultimate Bug Scanner) is not installed"],
    recommendations: ["Install UBS for static analysis scanning: cargo install ubs"],
  },
};

// ============================================================================
// API Client
// ============================================================================

const API_BASE = "/api/safety";

async function fetchAPI<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  const json = await response.json();
  return json.data ?? json;
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UseQueryResult<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook to fetch safety posture status.
 */
export function useSafetyPosture(): UseQueryResult<SafetyPostureResponse> {
  const mockMode = useUiStore((state) => state.mockMode);
  const [data, setData] = useState<SafetyPostureResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    if (mockMode) {
      // Simulate network delay
      await new Promise((r) => setTimeout(r, 300));
      setData(mockSafetyPosture);
      setIsLoading(false);
      return;
    }

    try {
      const result = await fetchAPI<SafetyPostureResponse>("/posture");
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Unknown error"));
      // Fall back to mock data on error
      setData(mockSafetyPosture);
    } finally {
      setIsLoading(false);
    }
  }, [mockMode]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, isLoading, error, refetch: fetch };
}

/**
 * Get the display color for a status.
 */
export function getStatusColor(status: "healthy" | "degraded" | "unhealthy"): string {
  switch (status) {
    case "healthy":
      return "var(--color-green-500)";
    case "degraded":
      return "var(--color-amber-500)";
    case "unhealthy":
      return "var(--color-red-500)";
  }
}

/**
 * Get the display label for a status.
 */
export function getStatusLabel(status: "healthy" | "degraded" | "unhealthy"): string {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "degraded":
      return "Degraded";
    case "unhealthy":
      return "Unhealthy";
  }
}

/**
 * Get the tone for StatusPill based on status.
 */
export function getStatusTone(
  status: "healthy" | "degraded" | "unhealthy"
): "positive" | "warning" | "negative" {
  switch (status) {
    case "healthy":
      return "positive";
    case "degraded":
      return "warning";
    case "unhealthy":
      return "negative";
  }
}

/**
 * Format milliseconds as a human-readable age string.
 */
export function formatAge(ms: number | null): string {
  if (ms === null) return "Unknown";

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  if (hours > 0) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  if (minutes > 0) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  return "Just now";
}
