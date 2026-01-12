/**
 * Flywheel Velocity Dashboard Page.
 *
 * Provides a comprehensive view of the Flywheel ecosystem's velocity:
 * - Overall velocity score (0-100)
 * - Per-stage metrics (Plan, Coordinate, Execute, Scan, Remember)
 * - Learning rate tracking
 * - Trend analysis and forecasting
 * - Historical velocity comparison
 */

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Brain,
  CheckCircle2,
  Clock,
  GitBranch,
  Lightbulb,
  Minus,
  RefreshCw,
  Search,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import {
  useVelocityScore,
  useStageMetrics,
  useLearningMetrics,
  useTrendAnalysis,
  useVelocityHistory,
  type VelocityPeriod,
  type VelocityTrend,
  type StageMetrics as StageMetricsType,
  type TrendRecommendation,
} from "../hooks/useVelocity";

// ============================================================================
// Tab Types
// ============================================================================

type TabId = "overview" | "stages" | "learning" | "trends" | "history";

interface Tab {
  id: TabId;
  label: string;
}

const tabs: Tab[] = [
  { id: "overview", label: "Overview" },
  { id: "stages", label: "Stages" },
  { id: "learning", label: "Learning" },
  { id: "trends", label: "Trends" },
  { id: "history", label: "History" },
];

// ============================================================================
// Helper Functions
// ============================================================================

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function getTrendIcon(trend: VelocityTrend) {
  switch (trend) {
    case "accelerating":
      return <TrendingUp size={16} style={{ color: "var(--positive)" }} />;
    case "decelerating":
      return <TrendingDown size={16} style={{ color: "var(--danger)" }} />;
    default:
      return <Minus size={16} style={{ color: "var(--muted)" }} />;
  }
}

function getTrendColor(trend: VelocityTrend): string {
  switch (trend) {
    case "accelerating":
      return "var(--positive)";
    case "decelerating":
      return "var(--danger)";
    default:
      return "var(--muted)";
  }
}

function getScoreColor(score: number): string {
  if (score >= 80) return "var(--positive)";
  if (score >= 60) return "var(--warning)";
  return "var(--danger)";
}

function getRecommendationIcon(type: TrendRecommendation["type"]) {
  switch (type) {
    case "optimization":
      return <Zap size={16} style={{ color: "var(--primary)" }} />;
    case "warning":
      return <AlertTriangle size={16} style={{ color: "var(--warning)" }} />;
    case "insight":
      return <Lightbulb size={16} style={{ color: "var(--info)" }} />;
  }
}

// ============================================================================
// Velocity Gauge Component
// ============================================================================

interface VelocityGaugeProps {
  score: number;
  trend: VelocityTrend;
  trendMagnitude: number;
  period: VelocityPeriod;
  onPeriodChange: (period: VelocityPeriod) => void;
}

function VelocityGauge({
  score,
  trend,
  trendMagnitude,
  period,
  onPeriodChange,
}: VelocityGaugeProps) {
  const circumference = 2 * Math.PI * 90;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className="card" style={{ textAlign: "center", padding: "32px" }}>
      <div className="card__header" style={{ justifyContent: "center", marginBottom: "24px" }}>
        <div style={{ display: "flex", gap: "8px" }}>
          {(["24h", "7d", "30d"] as VelocityPeriod[]).map((p) => (
            <button
              key={p}
              className={`btn btn--sm ${period === p ? "btn--primary" : "btn--secondary"}`}
              onClick={() => onPeriodChange(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div style={{ position: "relative", width: "200px", height: "200px", margin: "0 auto" }}>
        <svg width="200" height="200" viewBox="0 0 200 200">
          {/* Background circle */}
          <circle
            cx="100"
            cy="100"
            r="90"
            fill="none"
            stroke="var(--surface-elevated)"
            strokeWidth="12"
          />
          {/* Progress circle */}
          <circle
            cx="100"
            cy="100"
            r="90"
            fill="none"
            stroke={getScoreColor(score)}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            transform="rotate(-90 100 100)"
            style={{ transition: "stroke-dashoffset 0.5s ease-out" }}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "48px", fontWeight: 700, color: getScoreColor(score) }}>
            {score}
          </div>
          <div className="muted">Velocity Score</div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          marginTop: "16px",
        }}
      >
        {getTrendIcon(trend)}
        <span style={{ color: getTrendColor(trend), fontWeight: 600 }}>
          {trend === "accelerating" ? "+" : trend === "decelerating" ? "-" : ""}
          {trendMagnitude.toFixed(1)}%
        </span>
        <span className="muted">vs previous {period}</span>
      </div>
    </div>
  );
}

// ============================================================================
// Component Score Card
// ============================================================================

interface ComponentScoreCardProps {
  label: string;
  score: number;
  weight: string;
  icon: React.ReactNode;
}

function ComponentScoreCard({ label, score, weight, icon }: ComponentScoreCardProps) {
  return (
    <div className="card card--compact">
      <div className="card__header">
        <span className="eyebrow">{label}</span>
        {icon}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
        <span className="metric">{score}</span>
        <span className="muted">/ 100</span>
      </div>
      <div
        style={{
          height: "4px",
          backgroundColor: "var(--surface-elevated)",
          borderRadius: "2px",
          marginTop: "8px",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${score}%`,
            backgroundColor: getScoreColor(score),
            borderRadius: "2px",
            transition: "width 0.3s ease-out",
          }}
        />
      </div>
      <div className="muted" style={{ marginTop: "4px", fontSize: "12px" }}>
        Weight: {weight}
      </div>
    </div>
  );
}

// ============================================================================
// Overview Tab
// ============================================================================

function OverviewTab() {
  const [period, setPeriod] = useState<VelocityPeriod>("24h");
  const { data: velocityScore, isLoading } = useVelocityScore(period);
  const { data: trendData } = useTrendAnalysis();

  if (isLoading || !velocityScore) {
    return (
      <div className="loading-state">
        <RefreshCw className="spin" size={24} />
        <span>Loading velocity data...</span>
      </div>
    );
  }

  const { components } = velocityScore;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "24px" }}>
        <VelocityGauge
          score={velocityScore.overall_score}
          trend={velocityScore.trend}
          trendMagnitude={velocityScore.trend_magnitude}
          period={period}
          onPeriodChange={setPeriod}
        />

        <div className="card">
          <div className="card__header">
            <h3>Component Scores</h3>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "16px",
              marginTop: "16px",
            }}
          >
            <ComponentScoreCard
              label="Throughput"
              score={components.throughput_score}
              weight="25%"
              icon={<Activity size={16} />}
            />
            <ComponentScoreCard
              label="Cycle Time"
              score={components.cycle_time_score}
              weight="25%"
              icon={<Clock size={16} />}
            />
            <ComponentScoreCard
              label="Success Rate"
              score={components.success_rate_score}
              weight="20%"
              icon={<CheckCircle2 size={16} />}
            />
            <ComponentScoreCard
              label="Learning Rate"
              score={components.learning_rate_score}
              weight="20%"
              icon={<Brain size={16} />}
            />
            <ComponentScoreCard
              label="Collaboration"
              score={components.collaboration_score}
              weight="10%"
              icon={<Users size={16} />}
            />
          </div>
        </div>
      </div>

      {trendData && trendData.recommendations.length > 0 && (
        <div className="card">
          <div className="card__header">
            <h3>Recommendations</h3>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {trendData.recommendations.slice(0, 3).map((rec) => (
              <div
                key={rec.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "12px",
                  padding: "12px",
                  backgroundColor: "var(--surface-elevated)",
                  borderRadius: "8px",
                }}
              >
                {getRecommendationIcon(rec.type)}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{rec.title}</div>
                  <div className="muted" style={{ fontSize: "14px" }}>
                    {rec.description}
                  </div>
                </div>
                {rec.stage && (
                  <span
                    style={{
                      padding: "2px 8px",
                      backgroundColor: "var(--surface)",
                      borderRadius: "4px",
                      fontSize: "12px",
                    }}
                  >
                    {rec.stage}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Stage Performance Card
// ============================================================================

interface StageCardProps {
  name: string;
  icon: React.ReactNode;
  metrics: { label: string; value: string; score?: number }[];
  color: string;
}

function StageCard({ name, icon, metrics, color }: StageCardProps) {
  return (
    <div className="card">
      <div className="card__header">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color }}>{icon}</span>
          <h3>{name}</h3>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {metrics.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="muted">{m.label}</span>
            <span style={{ fontWeight: 600, color: m.score !== undefined ? getScoreColor(m.score * 100) : undefined }}>
              {m.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Stages Tab
// ============================================================================

function StagesTab() {
  const { data: stageMetrics, isLoading } = useStageMetrics();

  if (isLoading || !stageMetrics) {
    return (
      <div className="loading-state">
        <RefreshCw className="spin" size={24} />
        <span>Loading stage metrics...</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: "16px",
      }}
    >
      <StageCard
        name="Plan"
        icon={<Target size={20} />}
        color="var(--primary)"
        metrics={[
          { label: "Avg Duration", value: formatDuration(stageMetrics.plan.avg_planning_duration_seconds) },
          { label: "Quality Score", value: `${stageMetrics.plan.plan_quality_score}`, score: stageMetrics.plan.plan_quality_score / 100 },
          { label: "Revision Rate", value: formatPercent(stageMetrics.plan.plan_revision_rate) },
          { label: "Estimation Accuracy", value: formatPercent(stageMetrics.plan.estimation_accuracy), score: stageMetrics.plan.estimation_accuracy },
        ]}
      />
      <StageCard
        name="Coordinate"
        icon={<GitBranch size={20} />}
        color="var(--info)"
        metrics={[
          { label: "Avg Duration", value: formatDuration(stageMetrics.coordinate.avg_coordination_duration_seconds) },
          { label: "Assignment Efficiency", value: formatPercent(stageMetrics.coordinate.agent_assignment_efficiency), score: stageMetrics.coordinate.agent_assignment_efficiency },
          { label: "Contention Rate", value: formatPercent(stageMetrics.coordinate.resource_contention_rate) },
          { label: "Parallel Ratio", value: formatPercent(stageMetrics.coordinate.parallel_execution_ratio), score: stageMetrics.coordinate.parallel_execution_ratio },
        ]}
      />
      <StageCard
        name="Execute"
        icon={<Zap size={20} />}
        color="var(--warning)"
        metrics={[
          { label: "Avg Duration", value: formatDuration(stageMetrics.execute.avg_execution_duration_seconds) },
          { label: "Tool Success Rate", value: formatPercent(stageMetrics.execute.tool_call_success_rate), score: stageMetrics.execute.tool_call_success_rate },
          { label: "Retry Rate", value: formatPercent(stageMetrics.execute.retry_rate) },
          { label: "Efficiency", value: formatPercent(stageMetrics.execute.execution_efficiency), score: stageMetrics.execute.execution_efficiency },
        ]}
      />
      <StageCard
        name="Scan"
        icon={<Search size={20} />}
        color="var(--positive)"
        metrics={[
          { label: "Avg Duration", value: formatDuration(stageMetrics.scan.avg_scan_duration_seconds) },
          { label: "Files/Second", value: stageMetrics.scan.files_scanned_per_second.toLocaleString() },
          { label: "Detection Rate", value: formatPercent(stageMetrics.scan.issue_detection_rate), score: stageMetrics.scan.issue_detection_rate },
          { label: "Coverage", value: formatPercent(stageMetrics.scan.scan_coverage_percent / 100), score: stageMetrics.scan.scan_coverage_percent / 100 },
        ]}
      />
      <StageCard
        name="Remember"
        icon={<Brain size={20} />}
        color="var(--danger)"
        metrics={[
          { label: "Avg Duration", value: formatDuration(stageMetrics.remember.avg_remember_duration_seconds) },
          { label: "Entries Created", value: stageMetrics.remember.knowledge_entries_created.toLocaleString() },
          { label: "Retrieval Hit Rate", value: formatPercent(stageMetrics.remember.knowledge_retrieval_hit_rate), score: stageMetrics.remember.knowledge_retrieval_hit_rate },
          { label: "Cross-Agent Sharing", value: formatPercent(stageMetrics.remember.cross_agent_sharing_rate), score: stageMetrics.remember.cross_agent_sharing_rate },
        ]}
      />
    </div>
  );
}

// ============================================================================
// Learning Tab
// ============================================================================

function LearningTab() {
  const { data: learningMetrics, isLoading } = useLearningMetrics();

  if (isLoading || !learningMetrics) {
    return (
      <div className="loading-state">
        <RefreshCw className="spin" size={24} />
        <span>Loading learning metrics...</span>
      </div>
    );
  }

  const { improvement_rate, knowledge_reuse, error_reduction } = learningMetrics;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
        <div className="card" style={{ textAlign: "center", padding: "24px" }}>
          <div className="eyebrow">Overall Improvement</div>
          <div
            className="metric"
            style={{ color: improvement_rate.overall > 0 ? "var(--positive)" : "var(--danger)" }}
          >
            {improvement_rate.overall > 0 ? "+" : ""}
            {improvement_rate.overall.toFixed(1)}%
          </div>
          <div className="muted">per week</div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "24px" }}>
          <div className="eyebrow">Cache Hit Rate</div>
          <div className="metric" style={{ color: getScoreColor(knowledge_reuse.cache_hit_rate * 100) }}>
            {formatPercent(knowledge_reuse.cache_hit_rate)}
          </div>
          <div className="muted">knowledge reuse</div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "24px" }}>
          <div className="eyebrow">Error Rate Trend</div>
          <div
            className="metric"
            style={{ color: error_reduction.overall_error_rate_trend < 0 ? "var(--positive)" : "var(--danger)" }}
          >
            {error_reduction.overall_error_rate_trend > 0 ? "+" : ""}
            {(error_reduction.overall_error_rate_trend * 100).toFixed(1)}%
          </div>
          <div className="muted">{error_reduction.overall_error_rate_trend < 0 ? "improving" : "declining"}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        <div className="card">
          <div className="card__header">
            <h3>Improvement by Task Type</h3>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {Object.entries(improvement_rate.by_task_type).map(([type, rate]) => (
              <div key={type}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span>{type}</span>
                  <span style={{ color: rate > 0 ? "var(--positive)" : "var(--danger)", fontWeight: 600 }}>
                    {rate > 0 ? "+" : ""}
                    {rate.toFixed(1)}%
                  </span>
                </div>
                <div
                  style={{
                    height: "4px",
                    backgroundColor: "var(--surface-elevated)",
                    borderRadius: "2px",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(100, Math.abs(rate) * 3)}%`,
                      backgroundColor: rate > 0 ? "var(--positive)" : "var(--danger)",
                      borderRadius: "2px",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card__header">
            <h3>Improvement by Agent</h3>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {Object.entries(improvement_rate.by_agent).map(([agent, rate]) => (
              <div key={agent}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span>{agent}</span>
                  <span style={{ color: rate > 0 ? "var(--positive)" : "var(--danger)", fontWeight: 600 }}>
                    {rate > 0 ? "+" : ""}
                    {rate.toFixed(1)}%
                  </span>
                </div>
                <div
                  style={{
                    height: "4px",
                    backgroundColor: "var(--surface-elevated)",
                    borderRadius: "2px",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(100, Math.abs(rate) * 3)}%`,
                      backgroundColor: rate > 0 ? "var(--positive)" : "var(--danger)",
                      borderRadius: "2px",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <h3>Knowledge & Error Metrics</h3>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
          <div style={{ textAlign: "center" }}>
            <div className="eyebrow">Similar Task Acceleration</div>
            <div className="metric">{formatPercent(knowledge_reuse.similar_task_acceleration)}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div className="eyebrow">Pattern Recognition</div>
            <div className="metric">{formatPercent(knowledge_reuse.pattern_recognition_improvement)}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div className="eyebrow">Recurring Error Elimination</div>
            <div className="metric" style={{ color: "var(--positive)" }}>
              {formatPercent(error_reduction.recurring_error_elimination)}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div className="eyebrow">Novel Error Rate</div>
            <div className="metric">{formatPercent(error_reduction.novel_error_rate)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Trends Tab
// ============================================================================

function TrendsTab() {
  const { data: trendData, isLoading } = useTrendAnalysis();

  if (isLoading || !trendData) {
    return (
      <div className="loading-state">
        <RefreshCw className="spin" size={24} />
        <span>Loading trend analysis...</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
        <div className="card" style={{ textAlign: "center", padding: "24px" }}>
          <div className="eyebrow">Current Trend</div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              marginTop: "8px",
            }}
          >
            {getTrendIcon(trendData.velocity_trend)}
            <span
              className="metric"
              style={{ color: getTrendColor(trendData.velocity_trend), textTransform: "capitalize" }}
            >
              {trendData.velocity_trend}
            </span>
          </div>
          <div className="muted" style={{ marginTop: "8px" }}>
            {formatPercent(trendData.confidence)} confidence
          </div>
        </div>

        <div className="card" style={{ textAlign: "center", padding: "24px" }}>
          <div className="eyebrow">7-Day Forecast</div>
          <div className="metric" style={{ marginTop: "8px" }}>
            {trendData.forecast_7d.expected_velocity}
          </div>
          <div className="muted" style={{ marginTop: "8px" }}>
            Range: {trendData.forecast_7d.confidence_interval[0]} - {trendData.forecast_7d.confidence_interval[1]}
          </div>
        </div>

        <div className="card" style={{ textAlign: "center", padding: "24px" }}>
          <div className="eyebrow">Contributing Factors</div>
          <div style={{ display: "flex", justifyContent: "center", gap: "16px", marginTop: "12px" }}>
            <div>
              <span style={{ color: "var(--positive)", fontWeight: 600 }}>
                {trendData.acceleration_factors.length}
              </span>
              <div className="muted">Positive</div>
            </div>
            <div>
              <span style={{ color: "var(--danger)", fontWeight: 600 }}>
                {trendData.deceleration_factors.length}
              </span>
              <div className="muted">Negative</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        <div className="card">
          <div className="card__header">
            <h3 style={{ color: "var(--positive)" }}>Acceleration Factors</h3>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {trendData.acceleration_factors.map((factor, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px",
                  backgroundColor: "var(--surface-elevated)",
                  borderRadius: "4px",
                }}
              >
                <ArrowUp size={14} style={{ color: "var(--positive)" }} />
                <span>{factor}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card__header">
            <h3 style={{ color: "var(--danger)" }}>Deceleration Factors</h3>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {trendData.deceleration_factors.map((factor, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px",
                  backgroundColor: "var(--surface-elevated)",
                  borderRadius: "4px",
                }}
              >
                <ArrowDown size={14} style={{ color: "var(--danger)" }} />
                <span>{factor}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <h3>Recommendations</h3>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {trendData.recommendations.map((rec) => (
            <div
              key={rec.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "12px",
                padding: "16px",
                backgroundColor: "var(--surface-elevated)",
                borderRadius: "8px",
                borderLeft: `3px solid ${
                  rec.impact === "high"
                    ? "var(--danger)"
                    : rec.impact === "medium"
                      ? "var(--warning)"
                      : "var(--muted)"
                }`,
              }}
            >
              {getRecommendationIcon(rec.type)}
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontWeight: 600 }}>{rec.title}</span>
                  <span
                    style={{
                      padding: "2px 6px",
                      backgroundColor: "var(--surface)",
                      borderRadius: "4px",
                      fontSize: "11px",
                      textTransform: "uppercase",
                    }}
                  >
                    {rec.impact}
                  </span>
                </div>
                <div className="muted" style={{ marginTop: "4px" }}>
                  {rec.description}
                </div>
              </div>
              {rec.stage && (
                <span
                  style={{
                    padding: "4px 8px",
                    backgroundColor: "var(--primary)",
                    color: "white",
                    borderRadius: "4px",
                    fontSize: "12px",
                  }}
                >
                  {rec.stage}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// History Tab
// ============================================================================

function HistoryTab() {
  const [period, setPeriod] = useState<"30d" | "60d" | "90d">("30d");
  const { data: history, isLoading } = useVelocityHistory(period);

  if (isLoading || !history) {
    return (
      <div className="loading-state">
        <RefreshCw className="spin" size={24} />
        <span>Loading history...</span>
      </div>
    );
  }

  const maxScore = Math.max(...history.points.map((p) => p.score));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div className="card">
        <div className="card__header">
          <h3>Velocity History</h3>
          <div style={{ display: "flex", gap: "8px" }}>
            {(["30d", "60d", "90d"] as const).map((p) => (
              <button
                key={p}
                className={`btn btn--sm ${period === p ? "btn--primary" : "btn--secondary"}`}
                onClick={() => setPeriod(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Simple bar chart */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: "2px",
            height: "200px",
            marginTop: "16px",
            padding: "16px 0",
          }}
        >
          {history.points.map((point, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: `${(point.score / maxScore) * 160}px`,
                  backgroundColor: getTrendColor(point.trend),
                  borderRadius: "2px 2px 0 0",
                  opacity: 0.8,
                  transition: "height 0.3s ease-out",
                }}
                title={`${formatDate(point.timestamp)}: ${point.score}`}
              />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span className="muted">{formatDate(history.points[0]?.timestamp)}</span>
          <span className="muted">{formatDate(history.points[history.points.length - 1]?.timestamp)}</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
        <div className="card" style={{ textAlign: "center", padding: "24px" }}>
          <div className="eyebrow">Average</div>
          <div className="metric">{history.average}</div>
          <div className="muted">over {period}</div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "24px" }}>
          <div className="eyebrow">Best Day</div>
          <div className="metric" style={{ color: "var(--positive)" }}>
            {history.best.score}
          </div>
          <div className="muted">{formatDate(history.best.timestamp)}</div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "24px" }}>
          <div className="eyebrow">Worst Day</div>
          <div className="metric" style={{ color: "var(--danger)" }}>
            {history.worst.score}
          </div>
          <div className="muted">{formatDate(history.worst.timestamp)}</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export function VelocityPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Flywheel Velocity</h1>
          <p className="page__subtitle">
            Monitor ecosystem acceleration and identify optimization opportunities
          </p>
        </div>
      </header>

      <nav className="tabs" style={{ marginBottom: "24px" }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tabs__tab ${activeTab === tab.id ? "tabs__tab--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="page__content">
        {activeTab === "overview" && <OverviewTab />}
        {activeTab === "stages" && <StagesTab />}
        {activeTab === "learning" && <LearningTab />}
        {activeTab === "trends" && <TrendsTab />}
        {activeTab === "history" && <HistoryTab />}
      </main>
    </div>
  );
}
