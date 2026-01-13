/**
 * Pipelines Page - Pipeline orchestration dashboard.
 *
 * Provides a UI for managing multi-step workflow pipelines including:
 * - Pipeline list with status and stats
 * - Run history and monitoring
 * - Pipeline enable/disable controls
 * - Run execution controls (run, pause, resume, cancel)
 */

import { useState } from "react";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Settings,
  Square,
  Webhook,
  XCircle,
  Zap,
} from "lucide-react";

import { StatusPill } from "../components/ui/StatusPill";
import {
  type Pipeline,
  type PipelineRun,
  type PipelineStatus,
  type StepStatus,
  type TriggerType,
  usePipelineRuns,
  usePipelines,
  useRunPipeline,
  usePausePipeline,
  useResumePipeline,
  useCancelPipeline,
  useTogglePipeline,
} from "../hooks/usePipelines";

// ============================================================================
// Helpers
// ============================================================================

const statusTone: Record<PipelineStatus | StepStatus, "positive" | "warning" | "danger" | "muted"> = {
  idle: "muted",
  running: "warning",
  paused: "muted",
  completed: "positive",
  failed: "danger",
  cancelled: "muted",
  pending: "muted",
  skipped: "muted",
};

const triggerIcons: Record<TriggerType, typeof Play> = {
  manual: Play,
  schedule: Calendar,
  webhook: Webhook,
  bead_event: Zap,
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

function formatRelativeTime(dateString: string, isFuture = false): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = isFuture
    ? date.getTime() - now.getTime()
    : now.getTime() - date.getTime();

  // Handle edge case where diff is negative
  if (diff < 0) {
    return isFuture ? "now" : "just now";
  }

  const suffix = isFuture ? "" : " ago";
  const prefix = isFuture ? "in " : "";

  if (diff < 60000) return isFuture ? "in <1m" : "just now";
  if (diff < 3600000) return `${prefix}${Math.floor(diff / 60000)}m${suffix}`;
  if (diff < 86400000) return `${prefix}${Math.floor(diff / 3600000)}h${suffix}`;
  return `${prefix}${Math.floor(diff / 86400000)}d${suffix}`;
}

function getSuccessRate(stats: Pipeline["stats"]): number {
  if (stats.totalRuns === 0) return 0;
  return Math.round((stats.successfulRuns / stats.totalRuns) * 100);
}

// ============================================================================
// Components
// ============================================================================

interface PipelineCardProps {
  pipeline: Pipeline;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onRun: () => void;
  onToggleEnabled: () => void;
  isRunning: boolean;
  isToggling: boolean;
}

function PipelineCard({
  pipeline,
  isExpanded,
  onToggleExpand,
  onRun,
  onToggleEnabled,
  isRunning,
  isToggling,
}: PipelineCardProps) {
  const TriggerIcon = triggerIcons[pipeline.trigger.type];
  const successRate = getSuccessRate(pipeline.stats);

  return (
    <div className={`card ${!pipeline.enabled ? "card--muted" : ""}`}>
      <div className="card__header" style={{ cursor: "pointer" }} onClick={onToggleExpand}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <h4 style={{ margin: 0 }}>{pipeline.name}</h4>
          {!pipeline.enabled && (
            <StatusPill tone="muted">disabled</StatusPill>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span className="muted" style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <TriggerIcon size={14} />
            {pipeline.trigger.type}
          </span>
          <span className="muted">v{pipeline.version}</span>
          <StatusPill tone={successRate >= 80 ? "positive" : successRate >= 50 ? "warning" : "danger"}>
            {successRate}% success
          </StatusPill>
        </div>
      </div>

      {isExpanded && (
        <div className="card__body">
          {pipeline.description && (
            <p className="muted" style={{ marginBottom: "1rem" }}>
              {pipeline.description}
            </p>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <div className="muted" style={{ fontSize: "0.75rem" }}>Total Runs</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>{pipeline.stats.totalRuns}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: "0.75rem" }}>Successful</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 600, color: "var(--color-positive)" }}>
                {pipeline.stats.successfulRuns}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: "0.75rem" }}>Failed</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 600, color: "var(--color-danger)" }}>
                {pipeline.stats.failedRuns}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: "0.75rem" }}>Avg Duration</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>
                {formatDuration(pipeline.stats.averageDurationMs)}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <div className="muted" style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}>Steps ({pipeline.steps.length})</div>
            <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
              {pipeline.steps.map((step, i) => (
                <div
                  key={step.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.25rem",
                    padding: "0.25rem 0.5rem",
                    background: "var(--color-surface-elevated)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "0.75rem",
                  }}
                >
                  <span className="mono">{i + 1}.</span>
                  <span>{step.name}</span>
                  <StatusPill tone={statusTone[step.status]} style={{ fontSize: "0.625rem", padding: "0 0.25rem" }}>
                    {step.type}
                  </StatusPill>
                </div>
              ))}
            </div>
          </div>

          {pipeline.tags && pipeline.tags.length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <div className="muted" style={{ fontSize: "0.75rem", marginBottom: "0.25rem" }}>Tags</div>
              <div style={{ display: "flex", gap: "0.25rem" }}>
                {pipeline.tags.map((tag) => (
                  <span
                    key={tag}
                    style={{
                      padding: "0.125rem 0.5rem",
                      background: "var(--color-accent-subtle)",
                      borderRadius: "var(--radius-full)",
                      fontSize: "0.75rem",
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="muted" style={{ fontSize: "0.75rem" }}>
              {pipeline.lastRunAt && `Last run ${formatRelativeTime(pipeline.lastRunAt)}`}
              {pipeline.trigger.nextTriggerAt && ` · Next: ${formatRelativeTime(pipeline.trigger.nextTriggerAt, true)}`}
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                className="btn btn--ghost btn--sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleEnabled();
                }}
                disabled={isToggling}
              >
                {isToggling ? <Loader2 size={14} className="spin" /> : <Settings size={14} />}
                {pipeline.enabled ? "Disable" : "Enable"}
              </button>
              <button
                className="btn btn--primary btn--sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onRun();
                }}
                disabled={!pipeline.enabled || isRunning}
              >
                {isRunning ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                Run
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface RunRowProps {
  run: PipelineRun;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  isLoading: boolean;
}

function RunRow({ run, onPause, onResume, onCancel, isLoading }: RunRowProps) {
  const StatusIcon = {
    idle: Clock,
    running: Loader2,
    paused: Pause,
    completed: CheckCircle2,
    failed: XCircle,
    cancelled: Square,
  }[run.status];

  return (
    <div className="table__row">
      <span className="mono">{run.id}</span>
      <span style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
        <StatusIcon size={14} className={run.status === "running" ? "spin" : ""} />
        <StatusPill tone={statusTone[run.status]}>{run.status}</StatusPill>
      </span>
      <span>{formatRelativeTime(run.startedAt)}</span>
      <span>{run.durationMs ? formatDuration(run.durationMs) : "—"}</span>
      <span>{run.triggeredBy.type}</span>
      <span style={{ display: "flex", gap: "0.25rem" }}>
        {run.status === "running" && (
          <>
            <button className="btn btn--ghost btn--xs" onClick={onPause} disabled={isLoading}>
              <Pause size={12} />
            </button>
            <button className="btn btn--ghost btn--xs" onClick={onCancel} disabled={isLoading}>
              <Square size={12} />
            </button>
          </>
        )}
        {run.status === "paused" && (
          <>
            <button className="btn btn--ghost btn--xs" onClick={onResume} disabled={isLoading}>
              <Play size={12} />
            </button>
            <button className="btn btn--ghost btn--xs" onClick={onCancel} disabled={isLoading}>
              <Square size={12} />
            </button>
          </>
        )}
        {run.error && (
          <span title={run.error.message} style={{ color: "var(--color-danger)" }}>
            <AlertCircle size={14} />
          </span>
        )}
      </span>
    </div>
  );
}

interface PipelineRunsProps {
  pipelineId: string;
}

function PipelineRuns({ pipelineId }: PipelineRunsProps) {
  const { data: runs, isLoading, refetch } = usePipelineRuns(pipelineId, { limit: 10 });
  const { mutate: pause, isLoading: isPausing } = usePausePipeline();
  const { mutate: resume, isLoading: isResuming } = useResumePipeline();
  const { mutate: cancel, isLoading: isCancelling } = useCancelPipeline();

  if (isLoading) {
    return (
      <div style={{ padding: "1rem", textAlign: "center" }}>
        <Loader2 size={24} className="spin" />
      </div>
    );
  }

  if (!runs || runs.length === 0) {
    return (
      <div style={{ padding: "1rem", textAlign: "center" }} className="muted">
        No runs yet
      </div>
    );
  }

  const isActionLoading = isPausing || isResuming || isCancelling;

  return (
    <div className="table" style={{ marginTop: "0.5rem" }}>
      <div className="table__row table__row--header">
        <span>Run ID</span>
        <span>Status</span>
        <span>Started</span>
        <span>Duration</span>
        <span>Trigger</span>
        <span>Actions</span>
      </div>
      {runs.map((run) => (
        <RunRow
          key={run.id}
          run={run}
          onPause={() => pause(pipelineId, run.id).then(refetch)}
          onResume={() => resume(pipelineId, run.id).then(refetch)}
          onCancel={() => cancel(pipelineId, run.id).then(refetch)}
          isLoading={isActionLoading}
        />
      ))}
    </div>
  );
}

// ============================================================================
// Page Component
// ============================================================================

export function PipelinesPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showRuns, setShowRuns] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all");

  const { data: pipelines, isLoading, error, refetch } = usePipelines(
    filter === "all" ? undefined : { enabled: filter === "enabled" }
  );

  const { mutate: runPipeline, isLoading: isRunning } = useRunPipeline();
  const { mutate: togglePipeline, isLoading: isToggling } = useTogglePipeline();

  const handleRun = async (pipelineId: string) => {
    await runPipeline(pipelineId);
    refetch();
  };

  const handleToggle = async (pipeline: Pipeline) => {
    await togglePipeline(pipeline.id, !pipeline.enabled);
    refetch();
  };

  return (
    <div className="page">
      <header className="page__header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1>Pipelines</h1>
            <p className="muted">
              Orchestrate multi-step agent workflows with triggers, conditions, and approvals.
            </p>
          </div>
          <button className="btn btn--ghost" onClick={refetch}>
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </header>

      <div style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem" }}>
        <button
          className={`btn btn--sm ${filter === "all" ? "btn--primary" : "btn--ghost"}`}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        <button
          className={`btn btn--sm ${filter === "enabled" ? "btn--primary" : "btn--ghost"}`}
          onClick={() => setFilter("enabled")}
        >
          Enabled
        </button>
        <button
          className={`btn btn--sm ${filter === "disabled" ? "btn--primary" : "btn--ghost"}`}
          onClick={() => setFilter("disabled")}
        >
          Disabled
        </button>
      </div>

      {isLoading && (
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <Loader2 size={32} className="spin" />
          <p className="muted">Loading pipelines...</p>
        </div>
      )}

      {error && (
        <div className="card" style={{ borderColor: "var(--color-danger)" }}>
          <div className="card__header">
            <AlertCircle size={18} color="var(--color-danger)" />
            <span>Error loading pipelines</span>
          </div>
          <div className="card__body">
            <p className="muted">{error.message}</p>
            <button className="btn btn--primary btn--sm" onClick={refetch}>
              Retry
            </button>
          </div>
        </div>
      )}

      {!isLoading && pipelines && pipelines.length === 0 && (
        <div className="card">
          <div className="card__body" style={{ textAlign: "center", padding: "2rem" }}>
            <Zap size={48} className="muted" style={{ marginBottom: "1rem" }} />
            <h3>No pipelines yet</h3>
            <p className="muted">
              Create your first pipeline to automate multi-step agent workflows.
            </p>
          </div>
        </div>
      )}

      {pipelines && pipelines.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {pipelines.map((pipeline) => (
            <div key={pipeline.id}>
              <PipelineCard
                pipeline={pipeline}
                isExpanded={expandedId === pipeline.id}
                onToggleExpand={() => {
                  setExpandedId(expandedId === pipeline.id ? null : pipeline.id);
                  if (expandedId !== pipeline.id) {
                    setShowRuns(pipeline.id);
                  }
                }}
                onRun={() => handleRun(pipeline.id)}
                onToggleEnabled={() => handleToggle(pipeline)}
                isRunning={isRunning}
                isToggling={isToggling}
              />
              {showRuns === pipeline.id && expandedId === pipeline.id && (
                <div style={{ marginLeft: "1.5rem", marginTop: "0.5rem" }}>
                  <div className="card">
                    <div className="card__header">
                      <h4 style={{ margin: 0 }}>Recent Runs</h4>
                    </div>
                    <PipelineRuns pipelineId={pipeline.id} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
