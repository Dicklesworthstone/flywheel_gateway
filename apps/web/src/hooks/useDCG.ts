/**
 * DCG (Destructive Command Guard) hooks for API integration.
 *
 * Provides hooks for fetching DCG status, stats, blocks, pending exceptions,
 * configuration, and allowlist data. Also includes mutation hooks for
 * approve/deny/test operations.
 */

import { useCallback, useEffect, useState } from "react";
import { useUiStore } from "../stores/ui";

// ============================================================================
// Types
// ============================================================================

export interface DCGStatus {
  available: boolean;
  version: string | null;
  message: string;
}

export interface DCGOverviewStats {
  blocksLast24h: number;
  totalBlocks: number;
  falsePositiveRate: number;
  pendingExceptionsCount: number;
  trendVsYesterday?: number;
}

export interface DCGStats {
  overview: DCGOverviewStats;
  bySeverity: Record<string, number>;
  byPack: Record<string, number>;
  timeSeries?: Array<{ date: string; count: number }>;
}

export interface DCGBlock {
  id: string;
  command: string;
  severity: "critical" | "high" | "medium" | "low";
  pack: string;
  agentId?: string;
  blockedAt: string;
  falsePositive: boolean;
  explanation?: string;
}

export interface DCGPendingException {
  shortCode: string;
  command: string;
  commandHash: string;
  agentId: string;
  status: "pending" | "approved" | "denied" | "expired" | "executed";
  createdAt: string;
  expiresAt: string;
  approvedBy?: string;
  deniedBy?: string;
  denyReason?: string;
}

export interface DCGPack {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  ruleCount: number;
  severity: string;
}

export interface DCGAllowlistEntry {
  ruleId: string;
  pattern: string;
  reason: string;
  addedBy: string;
  addedAt: string;
  expiresAt?: string;
}

export interface DCGTestResult {
  blocked: boolean;
  severity?: string;
  pack?: string;
  rule?: string;
  explanation?: string;
}

export interface DCGExplainResult {
  command: string;
  analysis: string;
  wouldBlock: boolean;
  matchingRules: Array<{
    pack: string;
    rule: string;
    severity: string;
    reason: string;
  }>;
}

// ============================================================================
// Mock Data (used when mockMode is enabled or API unavailable)
// ============================================================================

const mockDCGStatus: DCGStatus = {
  available: true,
  version: "0.9.2",
  message: "DCG 0.9.2 is available",
};

const mockDCGStats: DCGStats = {
  overview: {
    blocksLast24h: 12,
    totalBlocks: 847,
    falsePositiveRate: 0.023,
    pendingExceptionsCount: 3,
    trendVsYesterday: -15,
  },
  bySeverity: {
    critical: 23,
    high: 156,
    medium: 412,
    low: 256,
  },
  byPack: {
    "git-dangerous": 234,
    "filesystem-destructive": 189,
    "cloud-ops": 145,
    "database-admin": 156,
    "container-ops": 123,
  },
};

const mockDCGBlocks: DCGBlock[] = [
  {
    id: "block-001",
    command: "git reset --hard HEAD~5",
    severity: "critical",
    pack: "git-dangerous",
    agentId: "agent-ax7",
    blockedAt: new Date(Date.now() - 300000).toISOString(),
    falsePositive: false,
    explanation: "Hard reset discards commits permanently",
  },
  {
    id: "block-002",
    command: "rm -rf /var/log/*",
    severity: "high",
    pack: "filesystem-destructive",
    agentId: "agent-bp2",
    blockedAt: new Date(Date.now() - 900000).toISOString(),
    falsePositive: false,
    explanation: "Recursive deletion of system logs",
  },
  {
    id: "block-003",
    command: "DROP TABLE users;",
    severity: "critical",
    pack: "database-admin",
    agentId: "agent-ax7",
    blockedAt: new Date(Date.now() - 1800000).toISOString(),
    falsePositive: false,
    explanation: "Dropping table causes permanent data loss",
  },
  {
    id: "block-004",
    command: "docker system prune -af",
    severity: "medium",
    pack: "container-ops",
    agentId: "agent-km9",
    blockedAt: new Date(Date.now() - 3600000).toISOString(),
    falsePositive: true,
    explanation: "Prune removes unused containers and images",
  },
  {
    id: "block-005",
    command: "git push --force origin main",
    severity: "high",
    pack: "git-dangerous",
    blockedAt: new Date(Date.now() - 7200000).toISOString(),
    falsePositive: false,
    explanation: "Force push rewrites remote history",
  },
];

const mockDCGPending: DCGPendingException[] = [
  {
    shortCode: "ABC123",
    command: "git reset --hard HEAD~1",
    commandHash: "a1b2c3d4e5f6",
    agentId: "agent-ax7",
    status: "pending",
    createdAt: new Date(Date.now() - 120000).toISOString(),
    expiresAt: new Date(Date.now() + 180000).toISOString(),
  },
  {
    shortCode: "DEF456",
    command: "rm -rf ./build",
    commandHash: "f6e5d4c3b2a1",
    agentId: "agent-bp2",
    status: "pending",
    createdAt: new Date(Date.now() - 60000).toISOString(),
    expiresAt: new Date(Date.now() + 240000).toISOString(),
  },
  {
    shortCode: "GHI789",
    command: "DROP INDEX idx_users_email;",
    commandHash: "123456789abc",
    agentId: "agent-ax7",
    status: "pending",
    createdAt: new Date(Date.now() - 30000).toISOString(),
    expiresAt: new Date(Date.now() + 270000).toISOString(),
  },
];

const mockDCGPacks: DCGPack[] = [
  {
    id: "git-dangerous",
    name: "Git Dangerous Operations",
    description: "Blocks destructive git commands like force push, hard reset",
    enabled: true,
    ruleCount: 12,
    severity: "critical",
  },
  {
    id: "filesystem-destructive",
    name: "Filesystem Destructive",
    description: "Blocks rm -rf and other dangerous file operations",
    enabled: true,
    ruleCount: 8,
    severity: "high",
  },
  {
    id: "database-admin",
    name: "Database Admin Operations",
    description: "Blocks DROP, TRUNCATE, DELETE without WHERE",
    enabled: true,
    ruleCount: 15,
    severity: "critical",
  },
  {
    id: "container-ops",
    name: "Container Operations",
    description: "Blocks dangerous docker/kubectl commands",
    enabled: true,
    ruleCount: 10,
    severity: "medium",
  },
  {
    id: "cloud-ops",
    name: "Cloud Operations",
    description: "Blocks destructive AWS/GCP/Azure commands",
    enabled: false,
    ruleCount: 20,
    severity: "high",
  },
];

const mockDCGAllowlist: DCGAllowlistEntry[] = [
  {
    ruleId: "allow-001",
    pattern: "rm -rf ./node_modules",
    reason: "Safe cleanup of dependencies",
    addedBy: "admin",
    addedAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    ruleId: "allow-002",
    pattern: "git reset --hard HEAD",
    reason: "Allowed for development workflow",
    addedBy: "admin",
    addedAt: new Date(Date.now() - 172800000).toISOString(),
    expiresAt: new Date(Date.now() + 604800000).toISOString(),
  },
];

// ============================================================================
// API Client
// ============================================================================

const API_BASE = "/api/dcg";

async function fetchAPI<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
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

function useQuery<T>(
  endpoint: string,
  mockData: T,
  deps: unknown[] = [],
): UseQueryResult<T> {
  const mockMode = useUiStore((state) => state.mockMode);
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    if (mockMode) {
      // Simulate network delay
      await new Promise((r) => setTimeout(r, 300));
      setData(mockData);
      setIsLoading(false);
      return;
    }

    try {
      const result = await fetchAPI<T>(endpoint);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Unknown error"));
      // Fall back to mock data on error
      setData(mockData);
    } finally {
      setIsLoading(false);
    }
  }, [endpoint, mockData, mockMode]);

  useEffect(() => {
    fetch();
  }, [fetch, ...deps]);

  return { data, isLoading, error, refetch: fetch };
}

/**
 * Hook to fetch DCG status.
 */
export function useDCGStatus(): UseQueryResult<DCGStatus> {
  return useQuery("/status", mockDCGStatus);
}

/**
 * Hook to fetch DCG statistics.
 */
export function useDCGStats(): UseQueryResult<DCGStats> {
  return useQuery("/stats/full", mockDCGStats);
}

/**
 * Hook to fetch DCG block history.
 */
export function useDCGBlocks(options?: {
  limit?: number;
  severity?: string;
  pack?: string;
}): UseQueryResult<DCGBlock[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.severity) params.set("severity", options.severity);
  if (options?.pack) params.set("pack", options.pack);
  const query = params.toString() ? `?${params.toString()}` : "";
  return useQuery(`/blocks${query}`, mockDCGBlocks, [
    options?.limit,
    options?.severity,
    options?.pack,
  ]);
}

/**
 * Hook to fetch pending exceptions.
 */
export function useDCGPending(options?: {
  status?: "pending" | "approved" | "denied" | "expired";
}): UseQueryResult<DCGPendingException[]> {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  const query = params.toString() ? `?${params.toString()}` : "";
  return useQuery(`/pending${query}`, mockDCGPending, [options?.status]);
}

/**
 * Hook to fetch DCG packs.
 */
export function useDCGPacks(): UseQueryResult<DCGPack[]> {
  return useQuery("/cli/packs", mockDCGPacks);
}

/**
 * Hook to fetch allowlist entries.
 */
export function useDCGAllowlist(): UseQueryResult<DCGAllowlistEntry[]> {
  return useQuery("/allowlist", mockDCGAllowlist);
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to approve a pending exception.
 */
export function useApprovePending() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const approve = useCallback(
    async (shortCode: string): Promise<DCGPendingException> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 500));
        setIsLoading(false);
        const mock = mockDCGPending.find((p) => p.shortCode === shortCode);
        if (mock) {
          return { ...mock, status: "approved", approvedBy: "api-user" };
        }
        throw new Error("Not found");
      }

      try {
        const result = await fetchAPI<DCGPendingException>(
          `/pending/${shortCode}/approve`,
          { method: "POST" },
        );
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [mockMode],
  );

  return { approve, isLoading, error };
}

/**
 * Hook to deny a pending exception.
 */
export function useDenyPending() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const deny = useCallback(
    async (
      shortCode: string,
      reason?: string,
    ): Promise<DCGPendingException> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 500));
        setIsLoading(false);
        const mock = mockDCGPending.find((p) => p.shortCode === shortCode);
        if (mock) {
          return {
            ...mock,
            status: "denied",
            deniedBy: "api-user",
            ...(reason && { denyReason: reason }),
          };
        }
        throw new Error("Not found");
      }

      try {
        const result = await fetchAPI<DCGPendingException>(
          `/pending/${shortCode}/deny`,
          {
            method: "POST",
            ...(reason && { body: JSON.stringify({ reason }) }),
          },
        );
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [mockMode],
  );

  return { deny, isLoading, error };
}

/**
 * Hook to test a command against DCG.
 */
export function useTestCommand() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const test = useCallback(
    async (command: string): Promise<DCGTestResult> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 500));
        setIsLoading(false);
        // Mock: block dangerous-looking commands
        const isDangerous =
          command.includes("rm -rf") ||
          command.includes("git reset --hard") ||
          command.includes("DROP") ||
          command.includes("--force");
        return {
          blocked: isDangerous,
          ...(isDangerous && {
            severity: "high",
            pack: "mock-dangerous",
            rule: "mock-rule",
          }),
          explanation: isDangerous
            ? "This command appears to be destructive"
            : "Command is safe to execute",
        };
      }

      try {
        const result = await fetchAPI<DCGTestResult>("/test", {
          method: "POST",
          body: JSON.stringify({ command }),
        });
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [mockMode],
  );

  return { test, isLoading, error };
}

/**
 * Hook to explain a command.
 */
export function useExplainCommand() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const explain = useCallback(
    async (command: string): Promise<DCGExplainResult> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 700));
        setIsLoading(false);
        const isDangerous =
          command.includes("rm -rf") ||
          command.includes("git reset --hard") ||
          command.includes("DROP") ||
          command.includes("--force");
        return {
          command,
          analysis: isDangerous
            ? "This command contains potentially destructive operations that could cause data loss or system instability."
            : "This command appears to be safe for execution.",
          wouldBlock: isDangerous,
          matchingRules: isDangerous
            ? [
                {
                  pack: "mock-pack",
                  rule: "mock-rule",
                  severity: "high",
                  reason: "Matches pattern for dangerous operations",
                },
              ]
            : [],
        };
      }

      try {
        const result = await fetchAPI<DCGExplainResult>("/explain", {
          method: "POST",
          body: JSON.stringify({ command }),
        });
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [mockMode],
  );

  return { explain, isLoading, error };
}

/**
 * Hook to toggle a pack's enabled state.
 */
export function useTogglePack() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const toggle = useCallback(
    async (
      packId: string,
      enable: boolean,
    ): Promise<{ packId: string; enabled: boolean }> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 300));
        setIsLoading(false);
        return { packId, enabled: enable };
      }

      try {
        const endpoint = enable
          ? `/cli/packs/${packId}/enable`
          : `/cli/packs/${packId}/disable`;
        const result = await fetchAPI<{ packId: string; enabled: boolean }>(
          endpoint,
          {
            method: "POST",
          },
        );
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [mockMode],
  );

  return { toggle, isLoading, error };
}

/**
 * Hook to mark a block as false positive.
 */
export function useMarkFalsePositive() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const mark = useCallback(
    async (blockId: string): Promise<DCGBlock> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 300));
        setIsLoading(false);
        const mock = mockDCGBlocks.find((b) => b.id === blockId);
        if (mock) {
          return { ...mock, falsePositive: true };
        }
        throw new Error("Not found");
      }

      try {
        const result = await fetchAPI<DCGBlock>(
          `/blocks/${blockId}/false-positive`,
          {
            method: "POST",
          },
        );
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [mockMode],
  );

  return { mark, isLoading, error };
}

/**
 * Hook to add an allowlist entry.
 */
export function useAddAllowlistEntry() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const add = useCallback(
    async (entry: {
      ruleId: string;
      pattern: string;
      reason: string;
      expiresAt?: string;
    }): Promise<DCGAllowlistEntry> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 500));
        setIsLoading(false);
        return {
          ...entry,
          addedBy: "api-user",
          addedAt: new Date().toISOString(),
        };
      }

      try {
        const result = await fetchAPI<DCGAllowlistEntry>("/allowlist", {
          method: "POST",
          body: JSON.stringify(entry),
        });
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [mockMode],
  );

  return { add, isLoading, error };
}

/**
 * Hook to remove an allowlist entry.
 */
export function useRemoveAllowlistEntry() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const remove = useCallback(
    async (ruleId: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 300));
        setIsLoading(false);
        return;
      }

      try {
        await fetchAPI<void>(`/allowlist/${ruleId}`, {
          method: "DELETE",
        });
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [mockMode],
  );

  return { remove, isLoading, error };
}
