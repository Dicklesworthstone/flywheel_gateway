/**
 * Pipeline hooks for API integration.
 *
 * Provides hooks for fetching pipelines, pipeline runs, and executing
 * pipeline operations like create, run, pause, resume, and cancel.
 */

import { useCallback, useEffect, useState } from "react";
import { useUiStore } from "../stores/ui";

// ============================================================================
// Types (mirrors backend models)
// ============================================================================

export type PipelineStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export type StepType =
  | "agent_task"
  | "conditional"
  | "parallel"
  | "approval"
  | "script"
  | "loop"
  | "wait"
  | "transform"
  | "webhook"
  | "sub_pipeline";

export type TriggerType = "manual" | "schedule" | "webhook" | "bead_event";

export interface PipelineStep {
  id: string;
  name: string;
  description?: string;
  type: StepType;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  result?: {
    success: boolean;
    output?: unknown;
    error?: { code: string; message: string };
    durationMs: number;
  };
}

export interface PipelineTrigger {
  type: TriggerType;
  enabled: boolean;
  lastTriggeredAt?: string;
  nextTriggerAt?: string;
}

export interface Pipeline {
  id: string;
  name: string;
  description?: string;
  version: number;
  enabled: boolean;
  trigger: PipelineTrigger;
  steps: PipelineStep[];
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  stats: {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    averageDurationMs: number;
  };
}

export interface PipelineRun {
  id: string;
  pipelineId: string;
  status: PipelineStatus;
  currentStepIndex: number;
  executedStepIds: string[];
  triggeredBy: {
    type: "user" | "schedule" | "webhook" | "bead_event" | "api";
    id?: string;
  };
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: {
    code: string;
    message: string;
    stepId?: string;
  };
}

// ============================================================================
// Mock Data
// ============================================================================

const mockPipelines: Pipeline[] = [
  {
    id: "pipe-001",
    name: "Code Review Pipeline",
    description: "Automated code review with multiple agents",
    version: 3,
    enabled: true,
    trigger: {
      type: "manual",
      enabled: true,
      lastTriggeredAt: new Date(Date.now() - 3600000).toISOString(),
    },
    steps: [
      {
        id: "step-1",
        name: "Static Analysis",
        type: "agent_task",
        status: "completed",
      },
      {
        id: "step-2",
        name: "Security Scan",
        type: "agent_task",
        status: "completed",
      },
      {
        id: "step-3",
        name: "Review Approval",
        type: "approval",
        status: "pending",
      },
    ],
    tags: ["review", "ci"],
    createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
    lastRunAt: new Date(Date.now() - 3600000).toISOString(),
    stats: {
      totalRuns: 47,
      successfulRuns: 42,
      failedRuns: 5,
      averageDurationMs: 145000,
    },
  },
  {
    id: "pipe-002",
    name: "Nightly Build",
    description: "Scheduled nightly build and test pipeline",
    version: 12,
    enabled: true,
    trigger: {
      type: "schedule",
      enabled: true,
      lastTriggeredAt: new Date(Date.now() - 43200000).toISOString(),
      nextTriggerAt: new Date(Date.now() + 43200000).toISOString(),
    },
    steps: [
      { id: "step-1", name: "Clean Build", type: "script", status: "completed" },
      {
        id: "step-2",
        name: "Unit Tests",
        type: "script",
        status: "completed",
      },
      {
        id: "step-3",
        name: "Integration Tests",
        type: "parallel",
        status: "running",
      },
      {
        id: "step-4",
        name: "Deploy to Staging",
        type: "webhook",
        status: "pending",
      },
    ],
    tags: ["build", "nightly"],
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    lastRunAt: new Date(Date.now() - 43200000).toISOString(),
    stats: {
      totalRuns: 89,
      successfulRuns: 81,
      failedRuns: 8,
      averageDurationMs: 720000,
    },
  },
  {
    id: "pipe-003",
    name: "Bug Triage",
    description: "Automated bug classification and assignment",
    version: 5,
    enabled: false,
    trigger: {
      type: "bead_event",
      enabled: false,
    },
    steps: [
      {
        id: "step-1",
        name: "Classify Bug",
        type: "agent_task",
        status: "pending",
      },
      {
        id: "step-2",
        name: "Assign Priority",
        type: "transform",
        status: "pending",
      },
      {
        id: "step-3",
        name: "Notify Team",
        type: "webhook",
        status: "pending",
      },
    ],
    tags: ["triage", "bugs"],
    createdAt: new Date(Date.now() - 86400000 * 14).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    stats: {
      totalRuns: 23,
      successfulRuns: 20,
      failedRuns: 3,
      averageDurationMs: 45000,
    },
  },
  {
    id: "pipe-004",
    name: "Documentation Generator",
    description: "Generate API docs from code",
    version: 2,
    enabled: true,
    trigger: {
      type: "webhook",
      enabled: true,
      lastTriggeredAt: new Date(Date.now() - 7200000).toISOString(),
    },
    steps: [
      {
        id: "step-1",
        name: "Parse Codebase",
        type: "agent_task",
        status: "completed",
      },
      {
        id: "step-2",
        name: "Generate Markdown",
        type: "agent_task",
        status: "completed",
      },
      {
        id: "step-3",
        name: "Publish to Wiki",
        type: "webhook",
        status: "failed",
        result: {
          success: false,
          error: { code: "WEBHOOK_TIMEOUT", message: "Wiki API timed out" },
          durationMs: 30000,
        },
      },
    ],
    tags: ["docs", "automation"],
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 7200000).toISOString(),
    lastRunAt: new Date(Date.now() - 7200000).toISOString(),
    stats: {
      totalRuns: 15,
      successfulRuns: 12,
      failedRuns: 3,
      averageDurationMs: 180000,
    },
  },
];

const mockRuns: PipelineRun[] = [
  {
    id: "run-001",
    pipelineId: "pipe-001",
    status: "completed",
    currentStepIndex: 2,
    executedStepIds: ["step-1", "step-2", "step-3"],
    triggeredBy: { type: "user", id: "user-123" },
    startedAt: new Date(Date.now() - 3600000).toISOString(),
    completedAt: new Date(Date.now() - 3500000).toISOString(),
    durationMs: 100000,
  },
  {
    id: "run-002",
    pipelineId: "pipe-002",
    status: "running",
    currentStepIndex: 2,
    executedStepIds: ["step-1", "step-2"],
    triggeredBy: { type: "schedule" },
    startedAt: new Date(Date.now() - 600000).toISOString(),
  },
  {
    id: "run-003",
    pipelineId: "pipe-004",
    status: "failed",
    currentStepIndex: 2,
    executedStepIds: ["step-1", "step-2", "step-3"],
    triggeredBy: { type: "webhook" },
    startedAt: new Date(Date.now() - 7200000).toISOString(),
    completedAt: new Date(Date.now() - 7170000).toISOString(),
    durationMs: 30000,
    error: {
      code: "WEBHOOK_TIMEOUT",
      message: "Wiki API timed out",
      stepId: "step-3",
    },
  },
];

// ============================================================================
// API Client
// ============================================================================

const API_BASE = "/api/pipelines";

async function fetchAPI<T>(
  endpoint: string,
  options?: RequestInit
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
  deps: unknown[] = []
): UseQueryResult<T> {
  const mockMode = useUiStore((state) => state.mockMode);
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Store mockData in a ref to avoid dependency issues while keeping current value
  const mockDataRef = { current: mockData };
  mockDataRef.current = mockData;

  const fetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    if (mockMode) {
      await new Promise((r) => setTimeout(r, 300));
      setData(mockDataRef.current);
      setIsLoading(false);
      return;
    }

    try {
      const result = await fetchAPI<T>(endpoint);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Unknown error"));
      // Fall back to mock data on error
      setData(mockDataRef.current);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, mockMode]);

  useEffect(() => {
    fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetch, ...deps]);

  return { data, isLoading, error, refetch: fetch };
}

/**
 * Hook to fetch all pipelines.
 */
export function usePipelines(options?: {
  enabled?: boolean;
  tags?: string[];
  search?: string;
}): UseQueryResult<Pipeline[]> {
  const params = new URLSearchParams();
  if (options?.enabled !== undefined)
    params.set("enabled", String(options.enabled));
  if (options?.tags) params.set("tags", options.tags.join(","));
  if (options?.search) params.set("search", options.search);
  const query = params.toString() ? `?${params.toString()}` : "";

  let filtered = mockPipelines;
  if (options?.enabled !== undefined) {
    filtered = filtered.filter((p) => p.enabled === options.enabled);
  }
  if (options?.tags?.length) {
    filtered = filtered.filter((p) =>
      options.tags!.some((t) => p.tags?.includes(t))
    );
  }
  if (options?.search) {
    const search = options.search.toLowerCase();
    filtered = filtered.filter(
      (p) =>
        p.name.toLowerCase().includes(search) ||
        p.description?.toLowerCase().includes(search)
    );
  }

  return useQuery(`${query}`, filtered, [
    options?.enabled,
    options?.tags?.join(","),
    options?.search,
  ]);
}

/**
 * Hook to fetch a single pipeline by ID.
 */
export function usePipeline(pipelineId: string): UseQueryResult<Pipeline> {
  const mock = mockPipelines.find((p) => p.id === pipelineId) ?? mockPipelines[0];
  return useQuery(`/${pipelineId}`, mock, [pipelineId]);
}

/**
 * Hook to fetch runs for a pipeline.
 */
export function usePipelineRuns(
  pipelineId: string,
  options?: {
    status?: PipelineStatus[];
    limit?: number;
  }
): UseQueryResult<PipelineRun[]> {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status.join(","));
  if (options?.limit) params.set("limit", String(options.limit));
  const query = params.toString() ? `?${params.toString()}` : "";

  const filtered = mockRuns.filter((r) => {
    if (r.pipelineId !== pipelineId) return false;
    if (options?.status && !options.status.includes(r.status)) return false;
    return true;
  });

  return useQuery(`/${pipelineId}/runs${query}`, filtered, [
    pipelineId,
    options?.status?.join(","),
    options?.limit,
  ]);
}

/**
 * Hook to fetch a single run by ID.
 */
export function usePipelineRun(
  pipelineId: string,
  runId: string
): UseQueryResult<PipelineRun> {
  const mock = mockRuns.find((r) => r.id === runId) ?? mockRuns[0];
  return useQuery(`/${pipelineId}/runs/${runId}`, mock, [pipelineId, runId]);
}

// ============================================================================
// Mutation Hooks
// ============================================================================

interface MutationResult<T, A extends unknown[]> {
  mutate: (...args: A) => Promise<T>;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to create a new pipeline.
 */
export function useCreatePipeline(): MutationResult<
  Pipeline,
  [Partial<Pipeline>]
> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const mutate = useCallback(
    async (input: Partial<Pipeline>): Promise<Pipeline> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 500));
        setIsLoading(false);
        return {
          id: `pipe-${Date.now()}`,
          name: input.name ?? "New Pipeline",
          version: 1,
          enabled: true,
          trigger: input.trigger ?? { type: "manual", enabled: true },
          steps: input.steps ?? [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          stats: {
            totalRuns: 0,
            successfulRuns: 0,
            failedRuns: 0,
            averageDurationMs: 0,
          },
          ...input,
        } as Pipeline;
      }

      try {
        const result = await fetchAPI<Pipeline>("", {
          method: "POST",
          body: JSON.stringify(input),
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
    [mockMode]
  );

  return { mutate, isLoading, error };
}

/**
 * Hook to update a pipeline.
 */
export function useUpdatePipeline(): MutationResult<
  Pipeline,
  [string, Partial<Pipeline>]
> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const mutate = useCallback(
    async (pipelineId: string, input: Partial<Pipeline>): Promise<Pipeline> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 500));
        setIsLoading(false);
        const existing = mockPipelines.find((p) => p.id === pipelineId);
        return {
          ...existing,
          ...input,
          version: (existing?.version ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        } as Pipeline;
      }

      try {
        const result = await fetchAPI<Pipeline>(`/${pipelineId}`, {
          method: "PUT",
          body: JSON.stringify(input),
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
    [mockMode]
  );

  return { mutate, isLoading, error };
}

/**
 * Hook to delete a pipeline.
 */
export function useDeletePipeline(): MutationResult<void, [string]> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const mutate = useCallback(
    async (pipelineId: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 300));
        setIsLoading(false);
        return;
      }

      try {
        await fetchAPI<void>(`/${pipelineId}`, {
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
    [mockMode]
  );

  return { mutate, isLoading, error };
}

/**
 * Hook to run a pipeline.
 */
export function useRunPipeline(): MutationResult<
  PipelineRun,
  [string, Record<string, unknown>?]
> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const mutate = useCallback(
    async (
      pipelineId: string,
      params?: Record<string, unknown>
    ): Promise<PipelineRun> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 500));
        setIsLoading(false);
        return {
          id: `run-${Date.now()}`,
          pipelineId,
          status: "running",
          currentStepIndex: 0,
          executedStepIds: [],
          triggeredBy: { type: "user", id: "mock-user" },
          startedAt: new Date().toISOString(),
        };
      }

      try {
        const result = await fetchAPI<PipelineRun>(`/${pipelineId}/run`, {
          method: "POST",
          body: params ? JSON.stringify(params) : undefined,
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
    [mockMode]
  );

  return { mutate, isLoading, error };
}

/**
 * Hook to pause a pipeline run.
 */
export function usePausePipeline(): MutationResult<
  PipelineRun,
  [string, string]
> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const mutate = useCallback(
    async (pipelineId: string, runId: string): Promise<PipelineRun> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 300));
        setIsLoading(false);
        const run = mockRuns.find((r) => r.id === runId) ?? mockRuns[0];
        return { ...run, status: "paused" };
      }

      try {
        const result = await fetchAPI<PipelineRun>(
          `/${pipelineId}/runs/${runId}/pause`,
          { method: "POST" }
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
    [mockMode]
  );

  return { mutate, isLoading, error };
}

/**
 * Hook to resume a pipeline run.
 */
export function useResumePipeline(): MutationResult<
  PipelineRun,
  [string, string]
> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const mutate = useCallback(
    async (pipelineId: string, runId: string): Promise<PipelineRun> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 300));
        setIsLoading(false);
        const run = mockRuns.find((r) => r.id === runId) ?? mockRuns[0];
        return { ...run, status: "running" };
      }

      try {
        const result = await fetchAPI<PipelineRun>(
          `/${pipelineId}/runs/${runId}/resume`,
          { method: "POST" }
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
    [mockMode]
  );

  return { mutate, isLoading, error };
}

/**
 * Hook to cancel a pipeline run.
 */
export function useCancelPipeline(): MutationResult<
  PipelineRun,
  [string, string]
> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const mutate = useCallback(
    async (pipelineId: string, runId: string): Promise<PipelineRun> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 300));
        setIsLoading(false);
        const run = mockRuns.find((r) => r.id === runId) ?? mockRuns[0];
        return { ...run, status: "cancelled" };
      }

      try {
        const result = await fetchAPI<PipelineRun>(
          `/${pipelineId}/runs/${runId}/cancel`,
          { method: "POST" }
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
    [mockMode]
  );

  return { mutate, isLoading, error };
}

/**
 * Hook to approve an approval step.
 */
export function useApproveStep(): MutationResult<
  void,
  [string, string, string, string?]
> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const mutate = useCallback(
    async (
      pipelineId: string,
      runId: string,
      stepId: string,
      comment?: string
    ): Promise<void> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 300));
        setIsLoading(false);
        return;
      }

      try {
        await fetchAPI<void>(`/${pipelineId}/runs/${runId}/approve`, {
          method: "POST",
          body: JSON.stringify({ stepId, decision: "approved", comment }),
        });
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [mockMode]
  );

  return { mutate, isLoading, error };
}

/**
 * Hook to toggle pipeline enabled state.
 */
export function useTogglePipeline(): MutationResult<Pipeline, [string, boolean]> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const mutate = useCallback(
    async (pipelineId: string, enabled: boolean): Promise<Pipeline> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 300));
        setIsLoading(false);
        const existing = mockPipelines.find((p) => p.id === pipelineId);
        return { ...existing!, enabled };
      }

      try {
        const result = await fetchAPI<Pipeline>(`/${pipelineId}`, {
          method: "PUT",
          body: JSON.stringify({ enabled }),
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
    [mockMode]
  );

  return { mutate, isLoading, error };
}
