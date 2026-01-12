/**
 * Velocity Dashboard hooks for API integration.
 *
 * Provides hooks for fetching Flywheel velocity scores, stage metrics,
 * learning rates, trend analysis, and historical data. The velocity score
 * measures how well the Flywheel ecosystem is accelerating over time.
 */

import { useCallback, useEffect, useState } from "react";
import { useUiStore } from "../stores/ui";

// ============================================================================
// Types
// ============================================================================

export type VelocityPeriod = "24h" | "7d" | "30d";
export type VelocityTrend = "accelerating" | "stable" | "decelerating";

export interface VelocityComponents {
  throughput_score: number;      // Weight: 25%
  cycle_time_score: number;      // Weight: 25%
  success_rate_score: number;    // Weight: 20%
  learning_rate_score: number;   // Weight: 20%
  collaboration_score: number;   // Weight: 10%
}

export interface VelocityScore {
  overall_score: number; // 0-100
  timestamp: string;
  period: VelocityPeriod;
  components: VelocityComponents;
  trend: VelocityTrend;
  trend_magnitude: number; // percentage change
}

export interface PlanStageMetrics {
  avg_planning_duration_seconds: number;
  plan_quality_score: number;
  plan_revision_rate: number;
  estimation_accuracy: number;
  complexity_assessment_accuracy: number;
}

export interface CoordinateStageMetrics {
  avg_coordination_duration_seconds: number;
  agent_assignment_efficiency: number;
  resource_contention_rate: number;
  parallel_execution_ratio: number;
  coordination_overhead_percent: number;
}

export interface ExecuteStageMetrics {
  avg_execution_duration_seconds: number;
  tool_call_success_rate: number;
  retry_rate: number;
  context_switch_frequency: number;
  execution_efficiency: number;
}

export interface ScanStageMetrics {
  avg_scan_duration_seconds: number;
  files_scanned_per_second: number;
  issue_detection_rate: number;
  false_positive_rate: number;
  scan_coverage_percent: number;
}

export interface RememberStageMetrics {
  avg_remember_duration_seconds: number;
  knowledge_entries_created: number;
  knowledge_retrieval_hit_rate: number;
  knowledge_freshness_score: number;
  cross_agent_sharing_rate: number;
}

export interface StageMetrics {
  plan: PlanStageMetrics;
  coordinate: CoordinateStageMetrics;
  execute: ExecuteStageMetrics;
  scan: ScanStageMetrics;
  remember: RememberStageMetrics;
}

export interface LearningMetrics {
  period: { start: string; end: string };
  improvement_rate: {
    overall: number;
    by_task_type: Record<string, number>;
    by_agent: Record<string, number>;
  };
  knowledge_reuse: {
    cache_hit_rate: number;
    similar_task_acceleration: number;
    pattern_recognition_improvement: number;
  };
  error_reduction: {
    overall_error_rate_trend: number;
    recurring_error_elimination: number;
    novel_error_rate: number;
  };
}

export interface TrendRecommendation {
  id: string;
  type: "optimization" | "warning" | "insight";
  title: string;
  description: string;
  impact: "high" | "medium" | "low";
  stage?: string;
}

export interface TrendAnalysis {
  velocity_trend: VelocityTrend;
  confidence: number;
  acceleration_factors: string[];
  deceleration_factors: string[];
  forecast_7d: {
    expected_velocity: number;
    confidence_interval: [number, number];
  };
  recommendations: TrendRecommendation[];
}

export interface VelocityHistoryPoint {
  timestamp: string;
  score: number;
  trend: VelocityTrend;
}

export interface VelocityHistory {
  points: VelocityHistoryPoint[];
  period: "30d" | "60d" | "90d";
  average: number;
  best: { timestamp: string; score: number };
  worst: { timestamp: string; score: number };
}

// ============================================================================
// Mock Data
// ============================================================================

const mockVelocityScore: VelocityScore = {
  overall_score: 73,
  timestamp: new Date().toISOString(),
  period: "24h",
  components: {
    throughput_score: 78,
    cycle_time_score: 71,
    success_rate_score: 89,
    learning_rate_score: 62,
    collaboration_score: 68,
  },
  trend: "accelerating",
  trend_magnitude: 8.3,
};

const mockStageMetrics: StageMetrics = {
  plan: {
    avg_planning_duration_seconds: 45,
    plan_quality_score: 82,
    plan_revision_rate: 0.15,
    estimation_accuracy: 0.78,
    complexity_assessment_accuracy: 0.85,
  },
  coordinate: {
    avg_coordination_duration_seconds: 12,
    agent_assignment_efficiency: 0.91,
    resource_contention_rate: 0.08,
    parallel_execution_ratio: 0.65,
    coordination_overhead_percent: 5.2,
  },
  execute: {
    avg_execution_duration_seconds: 180,
    tool_call_success_rate: 0.94,
    retry_rate: 0.12,
    context_switch_frequency: 3.2,
    execution_efficiency: 0.82,
  },
  scan: {
    avg_scan_duration_seconds: 8,
    files_scanned_per_second: 1250,
    issue_detection_rate: 0.96,
    false_positive_rate: 0.04,
    scan_coverage_percent: 98,
  },
  remember: {
    avg_remember_duration_seconds: 3,
    knowledge_entries_created: 847,
    knowledge_retrieval_hit_rate: 0.72,
    knowledge_freshness_score: 0.88,
    cross_agent_sharing_rate: 0.45,
  },
};

const mockLearningMetrics: LearningMetrics = {
  period: {
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    end: new Date().toISOString(),
  },
  improvement_rate: {
    overall: 12.5,
    by_task_type: {
      "code-review": 15.2,
      "bug-fix": 8.7,
      "feature-impl": 11.3,
      "refactor": 14.8,
    },
    by_agent: {
      "agent-ax7": 18.2,
      "agent-bp2": 9.1,
      "agent-km9": 12.8,
    },
  },
  knowledge_reuse: {
    cache_hit_rate: 0.72,
    similar_task_acceleration: 0.35,
    pattern_recognition_improvement: 0.22,
  },
  error_reduction: {
    overall_error_rate_trend: -0.18,
    recurring_error_elimination: 0.85,
    novel_error_rate: 0.04,
  },
};

const mockTrendAnalysis: TrendAnalysis = {
  velocity_trend: "accelerating",
  confidence: 0.87,
  acceleration_factors: [
    "Improved knowledge retrieval hit rate (+15%)",
    "Reduced retry rate in execution stage",
    "Better parallel execution ratio",
  ],
  deceleration_factors: [
    "Increasing context switch frequency",
    "Slight uptick in coordination overhead",
  ],
  forecast_7d: {
    expected_velocity: 78,
    confidence_interval: [74, 82],
  },
  recommendations: [
    {
      id: "rec-001",
      type: "optimization",
      title: "Reduce Context Switching",
      description: "Context switch frequency increased 12% this week. Consider batching related tasks.",
      impact: "high",
      stage: "execute",
    },
    {
      id: "rec-002",
      type: "insight",
      title: "Strong Learning Curve",
      description: "Agent ax7 shows 18% improvement rate. Consider having it mentor other agents.",
      impact: "medium",
    },
    {
      id: "rec-003",
      type: "warning",
      title: "Coordination Overhead Growing",
      description: "Coordination overhead increased from 4.1% to 5.2%. Monitor for bottlenecks.",
      impact: "medium",
      stage: "coordinate",
    },
  ],
};

function generateMockHistory(): VelocityHistory {
  const points: VelocityHistoryPoint[] = [];
  const now = Date.now();
  let score = 65;

  for (let i = 30; i >= 0; i--) {
    const timestamp = new Date(now - i * 24 * 60 * 60 * 1000).toISOString();
    // Simulate gradual improvement with some noise
    score = Math.min(100, Math.max(0, score + (Math.random() - 0.4) * 5));
    const trend: VelocityTrend =
      Math.random() > 0.7 ? "decelerating" : Math.random() > 0.4 ? "stable" : "accelerating";
    points.push({ timestamp, score: Math.round(score), trend });
  }

  const scores = points.map((p) => p.score);
  const average = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const bestPoint = points.find((p) => p.score === maxScore)!;
  const worstPoint = points.find((p) => p.score === minScore)!;

  return {
    points,
    period: "30d",
    average,
    best: { timestamp: bestPoint.timestamp, score: bestPoint.score },
    worst: { timestamp: worstPoint.timestamp, score: worstPoint.score },
  };
}

const mockVelocityHistory = generateMockHistory();

// ============================================================================
// API Client
// ============================================================================

const API_BASE = "/api/velocity";

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
 * Hook to fetch the current velocity score.
 */
export function useVelocityScore(period: VelocityPeriod = "24h"): UseQueryResult<VelocityScore> {
  return useQuery(`/score?period=${period}`, { ...mockVelocityScore, period }, [period]);
}

/**
 * Hook to fetch per-stage metrics.
 */
export function useStageMetrics(): UseQueryResult<StageMetrics> {
  return useQuery("/stages", mockStageMetrics);
}

/**
 * Hook to fetch learning metrics.
 */
export function useLearningMetrics(): UseQueryResult<LearningMetrics> {
  return useQuery("/learning", mockLearningMetrics);
}

/**
 * Hook to fetch trend analysis.
 */
export function useTrendAnalysis(): UseQueryResult<TrendAnalysis> {
  return useQuery("/trends", mockTrendAnalysis);
}

/**
 * Hook to fetch velocity history.
 */
export function useVelocityHistory(
  period: "30d" | "60d" | "90d" = "30d",
): UseQueryResult<VelocityHistory> {
  return useQuery(`/history?period=${period}`, mockVelocityHistory, [period]);
}
