/**
 * RU (Repo Updater) Fleet hooks for API integration.
 *
 * Provides hooks for fetching fleet stats, repos, sweeps, plans, and logs.
 * Also includes mutation hooks for sync, sweep, and plan operations.
 */

import { useCallback, useEffect, useState } from "react";
import { useUiStore } from "../stores/ui";

// ============================================================================
// Types
// ============================================================================

export type RepoStatus = "healthy" | "dirty" | "behind" | "ahead" | "diverged" | "unknown";
export type SweepStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type PlanApprovalStatus = "pending" | "approved" | "rejected" | "auto_approved";
export type PlanExecutionStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface FleetStats {
  totalRepos: number;
  clonedRepos: number;
  healthyRepos: number;
  dirtyRepos: number;
  behindRepos: number;
  aheadRepos: number;
  divergedRepos: number;
  unknownRepos: number;
  totalGroups: number;
  reposNeedingSync: number;
  reposWithUncommitted: number;
  reposWithUnpushed: number;
}

export interface FleetRepo {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  url: string;
  sshUrl?: string;
  localPath?: string;
  isCloned: boolean;
  currentBranch?: string;
  defaultBranch?: string;
  lastCommit?: string;
  lastCommitDate?: string;
  lastCommitAuthor?: string;
  status: RepoStatus;
  hasUncommittedChanges: boolean;
  hasUnpushedCommits: boolean;
  aheadBy: number;
  behindBy: number;
  description?: string;
  language?: string;
  stars?: number;
  isPrivate: boolean;
  isArchived: boolean;
  ruGroup?: string;
  lastSyncAt?: string;
  addedAt: string;
  updatedAt: string;
}

export interface SweepSession {
  id: string;
  repoCount: number;
  parallelism: number;
  currentPhase: number;
  status: SweepStatus;
  reposAnalyzed: number;
  reposPlanned: number;
  reposExecuted: number;
  reposFailed: number;
  reposSkipped: number;
  startedAt?: string;
  completedAt?: string;
  totalDurationMs?: number;
  slbApprovalRequired: boolean;
  slbApprovedBy?: string;
  slbApprovedAt?: string;
  triggeredBy: string;
  createdAt: string;
  updatedAt: string;
  planCount?: number;
  logCount?: number;
}

export interface SweepPlan {
  id: string;
  sessionId: string;
  repoId: string;
  repoFullName: string;
  planVersion: number;
  actionCount: number;
  estimatedDurationMs?: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  commitActions: number;
  releaseActions: number;
  branchActions: number;
  prActions: number;
  otherActions: number;
  approvalStatus: PlanApprovalStatus;
  approvedBy?: string;
  approvedAt?: string;
  rejectedReason?: string;
  executionStatus: PlanExecutionStatus;
  executedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SweepLog {
  id: string;
  sessionId: string;
  planId?: string;
  repoId?: string;
  phase: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: unknown;
  timestamp: string;
  durationMs?: number;
  actionType?: string;
  actionIndex?: number;
}

// ============================================================================
// Mock Data
// ============================================================================

const mockFleetStats: FleetStats = {
  totalRepos: 24,
  clonedRepos: 20,
  healthyRepos: 15,
  dirtyRepos: 3,
  behindRepos: 2,
  aheadRepos: 2,
  divergedRepos: 1,
  unknownRepos: 1,
  totalGroups: 4,
  reposNeedingSync: 5,
  reposWithUncommitted: 3,
  reposWithUnpushed: 2,
};

const mockFleetRepos: FleetRepo[] = [
  {
    id: "repo-001",
    owner: "acme",
    name: "flywheel-gateway",
    fullName: "acme/flywheel-gateway",
    url: "https://github.com/acme/flywheel-gateway",
    localPath: "/repos/flywheel-gateway",
    isCloned: true,
    currentBranch: "main",
    defaultBranch: "main",
    lastCommit: "d6e0231",
    lastCommitDate: new Date(Date.now() - 3600000).toISOString(),
    lastCommitAuthor: "developer",
    status: "healthy",
    hasUncommittedChanges: false,
    hasUnpushedCommits: false,
    aheadBy: 0,
    behindBy: 0,
    description: "AI Agent Orchestration Platform",
    language: "TypeScript",
    stars: 128,
    isPrivate: false,
    isArchived: false,
    ruGroup: "core",
    lastSyncAt: new Date(Date.now() - 1800000).toISOString(),
    addedAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: "repo-002",
    owner: "acme",
    name: "flywheel-private",
    fullName: "acme/flywheel-private",
    url: "https://github.com/acme/flywheel-private",
    localPath: "/repos/flywheel-private",
    isCloned: true,
    currentBranch: "develop",
    defaultBranch: "main",
    lastCommit: "a1b2c3d",
    lastCommitDate: new Date(Date.now() - 7200000).toISOString(),
    lastCommitAuthor: "admin",
    status: "dirty",
    hasUncommittedChanges: true,
    hasUnpushedCommits: false,
    aheadBy: 0,
    behindBy: 0,
    description: "Private infrastructure components",
    language: "TypeScript",
    isPrivate: true,
    isArchived: false,
    ruGroup: "core",
    lastSyncAt: new Date(Date.now() - 3600000).toISOString(),
    addedAt: new Date(Date.now() - 86400000 * 25).toISOString(),
    updatedAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: "repo-003",
    owner: "acme",
    name: "cass-memory",
    fullName: "acme/cass-memory",
    url: "https://github.com/acme/cass-memory",
    localPath: "/repos/cass-memory",
    isCloned: true,
    currentBranch: "main",
    defaultBranch: "main",
    lastCommit: "x9y8z7w",
    lastCommitDate: new Date(Date.now() - 86400000).toISOString(),
    lastCommitAuthor: "contributor",
    status: "behind",
    hasUncommittedChanges: false,
    hasUnpushedCommits: false,
    aheadBy: 0,
    behindBy: 5,
    description: "Context memory service",
    language: "TypeScript",
    isPrivate: false,
    isArchived: false,
    ruGroup: "services",
    lastSyncAt: new Date(Date.now() - 86400000).toISOString(),
    addedAt: new Date(Date.now() - 86400000 * 20).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: "repo-004",
    owner: "acme",
    name: "agent-drivers",
    fullName: "acme/agent-drivers",
    url: "https://github.com/acme/agent-drivers",
    localPath: "/repos/agent-drivers",
    isCloned: true,
    currentBranch: "feature/tmux",
    defaultBranch: "main",
    lastCommit: "m2n3o4p",
    lastCommitDate: new Date(Date.now() - 10800000).toISOString(),
    lastCommitAuthor: "developer",
    status: "ahead",
    hasUncommittedChanges: false,
    hasUnpushedCommits: true,
    aheadBy: 3,
    behindBy: 0,
    description: "Agent driver implementations",
    language: "TypeScript",
    isPrivate: false,
    isArchived: false,
    ruGroup: "packages",
    lastSyncAt: new Date(Date.now() - 10800000).toISOString(),
    addedAt: new Date(Date.now() - 86400000 * 15).toISOString(),
    updatedAt: new Date(Date.now() - 10800000).toISOString(),
  },
  {
    id: "repo-005",
    owner: "acme",
    name: "legacy-api",
    fullName: "acme/legacy-api",
    url: "https://github.com/acme/legacy-api",
    isCloned: false,
    status: "unknown",
    hasUncommittedChanges: false,
    hasUnpushedCommits: false,
    aheadBy: 0,
    behindBy: 0,
    description: "Legacy API (deprecated)",
    language: "JavaScript",
    isPrivate: false,
    isArchived: true,
    ruGroup: "archived",
    addedAt: new Date(Date.now() - 86400000 * 60).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 30).toISOString(),
  },
];

const mockSweepSessions: SweepSession[] = [
  {
    id: "sweep-001",
    repoCount: 5,
    parallelism: 2,
    currentPhase: 3,
    status: "completed",
    reposAnalyzed: 5,
    reposPlanned: 4,
    reposExecuted: 4,
    reposFailed: 0,
    reposSkipped: 1,
    startedAt: new Date(Date.now() - 7200000).toISOString(),
    completedAt: new Date(Date.now() - 3600000).toISOString(),
    totalDurationMs: 3600000,
    slbApprovalRequired: true,
    slbApprovedBy: "admin",
    slbApprovedAt: new Date(Date.now() - 5400000).toISOString(),
    triggeredBy: "cron",
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
    planCount: 4,
    logCount: 156,
  },
  {
    id: "sweep-002",
    repoCount: 3,
    parallelism: 1,
    currentPhase: 2,
    status: "paused",
    reposAnalyzed: 3,
    reposPlanned: 2,
    reposExecuted: 0,
    reposFailed: 0,
    reposSkipped: 0,
    startedAt: new Date(Date.now() - 1800000).toISOString(),
    slbApprovalRequired: true,
    triggeredBy: "manual",
    createdAt: new Date(Date.now() - 1800000).toISOString(),
    updatedAt: new Date(Date.now() - 600000).toISOString(),
    planCount: 2,
    logCount: 42,
  },
];

const mockSweepPlans: SweepPlan[] = [
  {
    id: "plan-001",
    sessionId: "sweep-002",
    repoId: "repo-002",
    repoFullName: "acme/flywheel-private",
    planVersion: 1,
    actionCount: 5,
    estimatedDurationMs: 120000,
    riskLevel: "medium",
    commitActions: 3,
    releaseActions: 0,
    branchActions: 1,
    prActions: 1,
    otherActions: 0,
    approvalStatus: "pending",
    executionStatus: "pending",
    createdAt: new Date(Date.now() - 1200000).toISOString(),
    updatedAt: new Date(Date.now() - 1200000).toISOString(),
  },
  {
    id: "plan-002",
    sessionId: "sweep-002",
    repoId: "repo-003",
    repoFullName: "acme/cass-memory",
    planVersion: 1,
    actionCount: 2,
    estimatedDurationMs: 60000,
    riskLevel: "low",
    commitActions: 1,
    releaseActions: 0,
    branchActions: 0,
    prActions: 1,
    otherActions: 0,
    approvalStatus: "pending",
    executionStatus: "pending",
    createdAt: new Date(Date.now() - 1100000).toISOString(),
    updatedAt: new Date(Date.now() - 1100000).toISOString(),
  },
];

// ============================================================================
// API Client
// ============================================================================

const API_BASE = "/api/ru";

async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
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
 * Hook to fetch fleet statistics.
 */
export function useFleetStats(): UseQueryResult<FleetStats> {
  return useQuery("/fleet/stats", mockFleetStats);
}

/**
 * Hook to fetch fleet repositories.
 */
export function useFleetRepos(options?: {
  status?: RepoStatus;
  group?: string;
  limit?: number;
}): UseQueryResult<FleetRepo[]> {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  if (options?.group) params.set("group", options.group);
  if (options?.limit) params.set("limit", String(options.limit));
  const query = params.toString() ? `?${params.toString()}` : "";
  return useQuery(`/fleet${query}`, mockFleetRepos, [options?.status, options?.group, options?.limit]);
}

/**
 * Hook to fetch fleet groups.
 */
export function useFleetGroups(): UseQueryResult<string[]> {
  return useQuery("/fleet/groups", ["core", "services", "packages", "archived"]);
}

/**
 * Hook to fetch repos needing sync.
 */
export function useReposNeedingSync(): UseQueryResult<FleetRepo[]> {
  const needingSync = mockFleetRepos.filter(
    (r) => r.status === "behind" || r.status === "diverged" || !r.isCloned,
  );
  return useQuery("/fleet/needs-sync", needingSync);
}

/**
 * Hook to fetch sweep sessions.
 */
export function useSweepSessions(options?: {
  status?: SweepStatus;
  limit?: number;
}): UseQueryResult<SweepSession[]> {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  if (options?.limit) params.set("limit", String(options.limit));
  const query = params.toString() ? `?${params.toString()}` : "";
  return useQuery(`/sweeps${query}`, mockSweepSessions, [options?.status, options?.limit]);
}

/**
 * Hook to fetch a single sweep session.
 */
export function useSweepSession(sessionId: string): UseQueryResult<SweepSession | null> {
  const session = mockSweepSessions.find((s) => s.id === sessionId) ?? null;
  return useQuery(`/sweeps/${sessionId}`, session, [sessionId]);
}

/**
 * Hook to fetch sweep plans.
 */
export function useSweepPlans(sessionId: string, options?: {
  approvalStatus?: PlanApprovalStatus;
}): UseQueryResult<SweepPlan[]> {
  const params = new URLSearchParams();
  if (options?.approvalStatus) params.set("approvalStatus", options.approvalStatus);
  const query = params.toString() ? `?${params.toString()}` : "";
  const plans = mockSweepPlans.filter((p) => p.sessionId === sessionId);
  return useQuery(`/sweeps/${sessionId}/plans${query}`, plans, [sessionId, options?.approvalStatus]);
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to start a new sweep.
 */
export function useStartSweep() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const start = useCallback(
    async (config: {
      targetRepos: string[] | "*";
      parallelism?: number;
      dryRun?: boolean;
      autoApprove?: boolean;
    }): Promise<SweepSession> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 500));
        setIsLoading(false);
        return {
          id: `sweep-${Date.now()}`,
          repoCount: config.targetRepos === "*" ? 5 : config.targetRepos.length,
          parallelism: config.parallelism ?? 2,
          currentPhase: 1,
          status: "running",
          reposAnalyzed: 0,
          reposPlanned: 0,
          reposExecuted: 0,
          reposFailed: 0,
          reposSkipped: 0,
          startedAt: new Date().toISOString(),
          slbApprovalRequired: !config.autoApprove,
          triggeredBy: "manual",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      try {
        const result = await fetchAPI<SweepSession>("/sweeps", {
          method: "POST",
          body: JSON.stringify(config),
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

  return { start, isLoading, error };
}

/**
 * Hook to approve a sweep session.
 */
export function useApproveSweep() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const approve = useCallback(
    async (sessionId: string, approvedBy: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 500));
        setIsLoading(false);
        return;
      }

      try {
        await fetchAPI(`/sweeps/${sessionId}/approve`, {
          method: "POST",
          body: JSON.stringify({ approvedBy }),
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

  return { approve, isLoading, error };
}

/**
 * Hook to cancel a sweep session.
 */
export function useCancelSweep() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const cancel = useCallback(
    async (sessionId: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 500));
        setIsLoading(false);
        return;
      }

      try {
        await fetchAPI(`/sweeps/${sessionId}/cancel`, {
          method: "POST",
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

  return { cancel, isLoading, error };
}

/**
 * Hook to approve a plan.
 */
export function useApprovePlan() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const approve = useCallback(
    async (planId: string, approvedBy: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 500));
        setIsLoading(false);
        return;
      }

      try {
        await fetchAPI(`/plans/${planId}/approve`, {
          method: "POST",
          body: JSON.stringify({ approvedBy }),
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

  return { approve, isLoading, error };
}

/**
 * Hook to reject a plan.
 */
export function useRejectPlan() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const reject = useCallback(
    async (planId: string, rejectedBy: string, reason: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 500));
        setIsLoading(false);
        return;
      }

      try {
        await fetchAPI(`/plans/${planId}/reject`, {
          method: "POST",
          body: JSON.stringify({ rejectedBy, reason }),
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

  return { reject, isLoading, error };
}

/**
 * Hook to add a repo to the fleet.
 */
export function useAddRepo() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const add = useCallback(
    async (repo: {
      owner: string;
      name: string;
      url: string;
      group?: string;
      description?: string;
    }): Promise<FleetRepo> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 500));
        setIsLoading(false);
        return {
          id: `repo-${Date.now()}`,
          owner: repo.owner,
          name: repo.name,
          fullName: `${repo.owner}/${repo.name}`,
          url: repo.url,
          isCloned: false,
          status: "unknown",
          hasUncommittedChanges: false,
          hasUnpushedCommits: false,
          aheadBy: 0,
          behindBy: 0,
          description: repo.description,
          isPrivate: false,
          isArchived: false,
          ruGroup: repo.group,
          addedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      try {
        const result = await fetchAPI<FleetRepo>("/fleet", {
          method: "POST",
          body: JSON.stringify(repo),
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
 * Hook to remove a repo from the fleet.
 */
export function useRemoveRepo() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const remove = useCallback(
    async (repoId: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 300));
        setIsLoading(false);
        return;
      }

      try {
        await fetchAPI(`/fleet/${repoId}`, {
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
