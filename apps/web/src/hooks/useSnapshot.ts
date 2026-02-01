"use no memo";

/**
 * System Snapshot hooks for API integration.
 *
 * Provides hooks for fetching the unified system snapshot which includes:
 * - NTM (Named Tmux Manager) session and agent state
 * - Agent Mail messaging and coordination state
 * - br/bv issue tracking and triage state
 * - Tool health status (DCG, SLB, UBS)
 */

import type { SystemSnapshot } from "@flywheel/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "../components/ui/Toaster";
import { useUiStore } from "../stores/ui";
import { useAllowMockFallback } from "./useMockFallback";

// ============================================================================
// Mock Data (used when mockMode is enabled or API unavailable)
// ============================================================================

const mockSnapshot: SystemSnapshot = {
  meta: {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    generationDurationMs: 42,
    gatewayVersion: "0.1.0",
  },
  summary: {
    status: "degraded",
    ntm: "healthy",
    agentMail: "unhealthy",
    beads: "healthy",
    tools: "degraded",
    healthyCount: 2,
    degradedCount: 1,
    unhealthyCount: 1,
    unknownCount: 0,
    issues: [
      "Agent Mail server is not running",
      "UBS (Ultimate Bug Scanner) is not installed",
    ],
  },
  ntm: {
    capturedAt: new Date().toISOString(),
    available: true,
    version: "0.3.0",
    sessions: [
      {
        name: "flywheel",
        attached: true,
        windows: 3,
        panes: 5,
        agents: [
          {
            pane: "%1",
            type: "claude",
            variant: "opus",
            state: "working",
            lastOutputAgeSec: 15,
            currentBead: "bd-i8h2",
            isActive: true,
          },
          {
            pane: "%2",
            type: "codex",
            state: "idle",
            lastOutputAgeSec: 120,
            isActive: false,
          },
          {
            pane: "%3",
            type: "gemini",
            variant: "pro",
            state: "working",
            lastOutputAgeSec: 5,
            currentBead: "bd-abc1",
            isActive: true,
          },
        ],
      },
    ],
    summary: {
      totalSessions: 1,
      totalAgents: 3,
      attachedCount: 1,
      byAgentType: {
        claude: 1,
        codex: 1,
        gemini: 1,
        cursor: 0,
        windsurf: 0,
        aider: 0,
      },
    },
    alerts: [],
  },
  agentMail: {
    capturedAt: new Date().toISOString(),
    available: false,
    status: "unhealthy",
    agents: [],
    reservations: [],
    messages: {
      total: 0,
      unread: 0,
      byPriority: {
        low: 0,
        normal: 0,
        high: 0,
        urgent: 0,
      },
    },
  },
  beads: {
    capturedAt: new Date().toISOString(),
    brAvailable: true,
    bvAvailable: true,
    statusCounts: {
      open: 12,
      inProgress: 3,
      blocked: 2,
      closed: 45,
      total: 62,
    },
    typeCounts: {
      bug: 5,
      feature: 8,
      task: 4,
      epic: 2,
      chore: 3,
    },
    priorityCounts: {
      p0: 1,
      p1: 4,
      p2: 8,
      p3: 3,
      p4: 1,
    },
    actionableCount: 8,
    topRecommendations: [
      {
        id: "bd-i8h2",
        title: "Web UI: snapshot summary panel",
        score: 0.95,
        unblocks: 2,
      },
      {
        id: "bd-abc1",
        title: "Add WebSocket support for real-time updates",
        score: 0.88,
        unblocks: 1,
      },
    ],
    quickWins: [
      {
        id: "bd-xyz9",
        title: "Fix typo in error message",
        score: 0.75,
      },
    ],
    blockersToClean: [
      {
        id: "bd-block1",
        title: "Database migration required",
        score: 0.92,
        unblocks: 5,
      },
    ],
  },
  tools: {
    capturedAt: new Date().toISOString(),
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
    status: "degraded",
    registryGeneratedAt: new Date(
      Date.now() - 3 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    registryAgeMs: 3 * 24 * 60 * 60 * 1000,
    toolsWithChecksums: 2,
    checksumsStale: false,
    checksumStatuses: [],
    issues: ["UBS (Ultimate Bug Scanner) is not installed"],
    recommendations: [
      "Install UBS for static analysis scanning: cargo install ubs",
    ],
  },
};

function refreshMockSnapshotTimestamps(
  snapshot: SystemSnapshot,
): SystemSnapshot {
  const now = new Date().toISOString();
  return {
    ...snapshot,
    meta: {
      ...snapshot.meta,
      generatedAt: now,
    },
    ntm: {
      ...snapshot.ntm,
      capturedAt: now,
    },
    agentMail: {
      ...snapshot.agentMail,
      capturedAt: now,
    },
    beads: {
      ...snapshot.beads,
      capturedAt: now,
    },
    tools: {
      ...snapshot.tools,
      capturedAt: now,
    },
  };
}

// ============================================================================
// API Client
// ============================================================================

const API_BASE = "/api/system";

async function fetchAPI<T>(endpoint: string, bypassCache = false): Promise<T> {
  const url = new URL(`${API_BASE}${endpoint}`, window.location.origin);
  if (bypassCache) {
    url.searchParams.set("bypass_cache", "true");
  }

  const response = await fetch(url.toString(), {
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
// Query Hook
// ============================================================================

interface UseQueryResult<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  /** True when displaying mock/fallback data instead of real API data */
  usingMockData: boolean;
  refetch: (bypassCache?: boolean) => void;
}

/**
 * Hook to fetch the unified system snapshot.
 *
 * @param options.pollingInterval - Optional interval in ms to auto-refresh (default: no polling)
 */
export function useSnapshot(options?: {
  pollingInterval?: number;
}): UseQueryResult<SystemSnapshot> {
  const mockMode = useUiStore((state) => state.mockMode);
  const allowMockFallback = useAllowMockFallback();
  const toastStateRef = useRef<"none" | "mock" | "error">("none");
  const [data, setData] = useState<SystemSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [usingMockData, setUsingMockData] = useState(false);

  const fetchSnapshot = useCallback(
    async (bypassCache = false) => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        // Simulate network delay
        await new Promise((r) => setTimeout(r, 300));
        setData(refreshMockSnapshotTimestamps(mockSnapshot));
        setUsingMockData(true);
        setIsLoading(false);
        return;
      }

      try {
        const result = await fetchAPI<SystemSnapshot>("/snapshot", bypassCache);
        setData(result);
        setUsingMockData(false);
        toastStateRef.current = "none";
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);

        if (allowMockFallback) {
          // Development mode: fall back to mock data but indicate it
          setData(refreshMockSnapshotTimestamps(mockSnapshot));
          setUsingMockData(true);
          if (toastStateRef.current !== "mock") {
            toast.warning("Using mock data - API unavailable");
            toastStateRef.current = "mock";
          }
        } else {
          // Production: show error, no mock data
          setData(null);
          setUsingMockData(false);
          if (toastStateRef.current !== "error") {
            toast.error(`Failed to load snapshot: ${err.message}`);
            toastStateRef.current = "error";
          }
        }
      } finally {
        setIsLoading(false);
      }
    },
    [mockMode, allowMockFallback],
  );

  useEffect(() => {
    fetchSnapshot();
  }, [fetchSnapshot]);

  // Optional polling
  useEffect(() => {
    if (!options?.pollingInterval) return;

    const interval = setInterval(() => {
      fetchSnapshot();
    }, options.pollingInterval);

    return () => clearInterval(interval);
  }, [fetchSnapshot, options?.pollingInterval]);

  return { data, isLoading, error, usingMockData, refetch: fetchSnapshot };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the display tone for StatusPill based on health status.
 */
const healthToneByStatus = {
  healthy: "positive",
  degraded: "warning",
  unhealthy: "danger",
  unknown: "muted",
} as const satisfies Record<
  "healthy" | "degraded" | "unhealthy" | "unknown",
  "positive" | "warning" | "danger" | "muted"
>;

export function getHealthTone(
  status: "healthy" | "degraded" | "unhealthy" | "unknown",
): "positive" | "warning" | "danger" | "muted" {
  return healthToneByStatus[status];
}

/**
 * Get agent type display color.
 */
export function getAgentTypeColor(type: string): string {
  const colors: Record<string, string> = {
    claude: "var(--color-purple-500)",
    codex: "var(--color-green-500)",
    gemini: "var(--color-blue-500)",
    cursor: "var(--color-amber-500)",
    windsurf: "var(--color-cyan-500)",
    aider: "var(--color-pink-500)",
  };
  return colors[type] || "var(--color-gray-500)";
}

/**
 * Format seconds as a human-readable age string.
 */
export function formatSecondsAgo(seconds: number | undefined): string {
  if (seconds === undefined) return "Unknown";

  if (seconds < 60) {
    return seconds < 5 ? "just now" : `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/**
 * Get agent state display info.
 */
const agentStateInfoByState = {
  working: { label: "Working", color: "var(--color-green-500)" },
  idle: { label: "Idle", color: "var(--color-gray-400)" },
  error: { label: "Error", color: "var(--color-red-500)" },
  waiting: { label: "Waiting", color: "var(--color-amber-500)" },
} as const satisfies Record<
  "working" | "idle" | "error" | "waiting",
  { label: string; color: string }
>;

export function getAgentStateInfo(state: string): {
  label: string;
  color: string;
} {
  return (
    agentStateInfoByState[state as keyof typeof agentStateInfoByState] ?? {
      label: state,
      color: "var(--color-gray-400)",
    }
  );
}
