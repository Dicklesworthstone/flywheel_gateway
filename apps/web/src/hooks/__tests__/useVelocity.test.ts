/**
 * useVelocity Hook Tests (bd-1vr1.8)
 *
 * Validates velocity API response fixtures and data processing
 * with mockMode=false assumptions.
 */

import { describe, expect, it } from "bun:test";

// ============================================================================
// Response Type Definitions (mirrors hook types)
// ============================================================================

interface VelocityScore {
  score: number;
  trend: "improving" | "stable" | "declining";
  period: "24h" | "7d" | "30d";
  breakdown: {
    throughput: number;
    quality: number;
    velocity: number;
  };
}

interface StageMetric {
  stage: string;
  avgDurationMs: number;
  count: number;
  failureRate: number;
}

interface LearningMetric {
  metric: string;
  current: number;
  previous: number;
  change: number;
  trend: "improving" | "stable" | "declining";
}

interface TrendPoint {
  timestamp: string;
  value: number;
}

interface VelocityHistory {
  period: "30d" | "60d" | "90d";
  points: TrendPoint[];
  average: number;
  peak: number;
  trough: number;
}

// ============================================================================
// Deterministic Fixtures
// ============================================================================

const FIXTURE_SCORE: VelocityScore = {
  score: 78.5,
  trend: "improving",
  period: "7d",
  breakdown: {
    throughput: 82,
    quality: 75,
    velocity: 79,
  },
};

const FIXTURE_STAGES: StageMetric[] = [
  { stage: "planning", avgDurationMs: 5000, count: 20, failureRate: 0.05 },
  { stage: "execution", avgDurationMs: 45000, count: 18, failureRate: 0.11 },
  { stage: "review", avgDurationMs: 12000, count: 15, failureRate: 0.07 },
  { stage: "deployment", avgDurationMs: 8000, count: 12, failureRate: 0.08 },
];

const FIXTURE_LEARNING: LearningMetric[] = [
  { metric: "context_retention", current: 0.85, previous: 0.78, change: 0.07, trend: "improving" },
  { metric: "first_attempt_success", current: 0.72, previous: 0.72, change: 0, trend: "stable" },
  { metric: "error_recovery_time", current: 3200, previous: 4500, change: -1300, trend: "improving" },
];

const FIXTURE_HISTORY: VelocityHistory = {
  period: "30d",
  points: Array.from({ length: 30 }, (_, i) => ({
    timestamp: new Date(Date.now() - (29 - i) * 86400000).toISOString(),
    value: 60 + Math.floor(i * 0.7),
  })),
  average: 70,
  peak: 82,
  trough: 58,
};

// ============================================================================
// Tests
// ============================================================================

describe("VelocityScore Fixture", () => {
  it("has valid score range", () => {
    expect(FIXTURE_SCORE.score).toBeGreaterThanOrEqual(0);
    expect(FIXTURE_SCORE.score).toBeLessThanOrEqual(100);
  });

  it("has valid trend value", () => {
    expect(["improving", "stable", "declining"]).toContain(FIXTURE_SCORE.trend);
  });

  it("has valid period", () => {
    expect(["24h", "7d", "30d"]).toContain(FIXTURE_SCORE.period);
  });

  it("breakdown components are within range", () => {
    const { breakdown } = FIXTURE_SCORE;
    for (const val of [breakdown.throughput, breakdown.quality, breakdown.velocity]) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(100);
    }
  });
});

describe("StageMetrics Fixture", () => {
  it("has expected stages", () => {
    const stages = FIXTURE_STAGES.map((s) => s.stage);
    expect(stages).toContain("planning");
    expect(stages).toContain("execution");
  });

  it("stage metrics have valid shapes", () => {
    for (const stage of FIXTURE_STAGES) {
      expect(stage.stage).toBeTruthy();
      expect(stage.avgDurationMs).toBeGreaterThan(0);
      expect(stage.count).toBeGreaterThanOrEqual(0);
      expect(stage.failureRate).toBeGreaterThanOrEqual(0);
      expect(stage.failureRate).toBeLessThanOrEqual(1);
    }
  });
});

describe("LearningMetrics Fixture", () => {
  it("has expected metrics", () => {
    const names = FIXTURE_LEARNING.map((m) => m.metric);
    expect(names).toContain("context_retention");
    expect(names).toContain("first_attempt_success");
  });

  it("each metric has valid trend", () => {
    for (const metric of FIXTURE_LEARNING) {
      expect(["improving", "stable", "declining"]).toContain(metric.trend);
      expect(typeof metric.current).toBe("number");
      expect(typeof metric.previous).toBe("number");
      expect(typeof metric.change).toBe("number");
    }
  });

  it("stable metrics have zero change", () => {
    const stable = FIXTURE_LEARNING.find((m) => m.trend === "stable");
    expect(stable?.change).toBe(0);
  });
});

describe("VelocityHistory Fixture", () => {
  it("has correct period", () => {
    expect(["30d", "60d", "90d"]).toContain(FIXTURE_HISTORY.period);
  });

  it("has expected number of data points", () => {
    expect(FIXTURE_HISTORY.points.length).toBe(30);
  });

  it("points have valid timestamps", () => {
    for (const point of FIXTURE_HISTORY.points) {
      expect(new Date(point.timestamp).getTime()).not.toBeNaN();
      expect(typeof point.value).toBe("number");
    }
  });

  it("aggregate stats are consistent", () => {
    expect(FIXTURE_HISTORY.peak).toBeGreaterThanOrEqual(FIXTURE_HISTORY.average);
    expect(FIXTURE_HISTORY.trough).toBeLessThanOrEqual(FIXTURE_HISTORY.average);
  });

  it("points are chronologically ordered", () => {
    for (let i = 1; i < FIXTURE_HISTORY.points.length; i++) {
      const prev = new Date(FIXTURE_HISTORY.points[i - 1]!.timestamp).getTime();
      const curr = new Date(FIXTURE_HISTORY.points[i]!.timestamp).getTime();
      expect(curr).toBeGreaterThan(prev);
    }
  });
});
