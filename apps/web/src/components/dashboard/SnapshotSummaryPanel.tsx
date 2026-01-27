/**
 * Snapshot Summary Panel - Unified system status overview.
 *
 * Displays a compact summary of system health from the /system/snapshot endpoint:
 * - Overall health status
 * - Active agents with their state
 * - Tool health (DCG, SLB, UBS)
 * - Beads summary (open, in progress, blocked)
 * - Current issues and alerts
 */

import { motion } from "framer-motion";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  Cpu,
  GitBranch,
  Loader2,
  Mail,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Users,
  XCircle,
} from "lucide-react";
import { StatusPill } from "../ui/StatusPill";
import {
  formatSecondsAgo,
  getAgentStateInfo,
  getAgentTypeColor,
  getHealthTone,
  useSnapshot,
} from "../../hooks/useSnapshot";
import {
  fadeVariants,
  listContainerVariants,
  listItemVariants,
} from "../../lib/animations";
import type {
  NtmAgentSnapshot,
  SystemHealthStatus,
  ToolHealthStatus,
} from "@flywheel/shared";

// ============================================================================
// Sub-components
// ============================================================================

interface HealthBadgeProps {
  status: SystemHealthStatus;
  label: string;
}

function HealthBadge({ status, label }: HealthBadgeProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 12px",
        borderRadius: "6px",
        backgroundColor: "var(--color-surface-2)",
      }}
    >
      <span className="muted" style={{ fontSize: "12px" }}>
        {label}
      </span>
      <StatusPill tone={getHealthTone(status)}>{status}</StatusPill>
    </div>
  );
}

interface AgentCardProps {
  agent: NtmAgentSnapshot;
  sessionName: string;
}

function AgentCard({ agent, sessionName }: AgentCardProps) {
  const stateInfo = getAgentStateInfo(agent.state);
  const typeColor = getAgentTypeColor(agent.type);

  return (
    <motion.div
      className="card card--compact"
      variants={listItemVariants}
      style={{
        borderLeft: `4px solid ${typeColor}`,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "6px",
              backgroundColor: typeColor,
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            {agent.type.substring(0, 2).toUpperCase()}
          </div>
          <div>
            <div
              style={{
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {agent.type}
              {agent.variant && (
                <span
                  className="muted"
                  style={{ fontSize: "12px", fontWeight: 400 }}
                >
                  ({agent.variant})
                </span>
              )}
            </div>
            <div className="muted" style={{ fontSize: "11px" }}>
              {sessionName} • {agent.pane}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "12px",
            color: stateInfo.color,
          }}
        >
          <span
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              backgroundColor: stateInfo.color,
            }}
          />
          {stateInfo.label}
        </div>
      </div>

      {(agent.currentBead || agent.lastOutputAgeSec !== undefined) && (
        <div
          className="muted"
          style={{
            marginTop: "8px",
            fontSize: "11px",
            display: "flex",
            gap: "12px",
          }}
        >
          {agent.currentBead && (
            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <GitBranch size={12} />
              {agent.currentBead}
            </span>
          )}
          {agent.lastOutputAgeSec !== undefined && (
            <span>Last output: {formatSecondsAgo(agent.lastOutputAgeSec)}</span>
          )}
        </div>
      )}
    </motion.div>
  );
}

interface ToolStatusRowProps {
  name: string;
  tool: ToolHealthStatus;
}

function ToolStatusRow({ name, tool }: ToolStatusRowProps) {
  const icon =
    tool.installed && tool.healthy ? (
      <ShieldCheck size={14} style={{ color: "var(--color-green-500)" }} />
    ) : tool.installed ? (
      <ShieldAlert size={14} style={{ color: "var(--color-amber-500)" }} />
    ) : (
      <Shield size={14} style={{ color: "var(--color-red-500)" }} />
    );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 0",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {icon}
        <span style={{ fontSize: "13px" }}>{name}</span>
        {tool.version && (
          <span className="muted" style={{ fontSize: "11px" }}>
            v{tool.version}
          </span>
        )}
      </div>
      <StatusPill
        tone={
          tool.installed && tool.healthy
            ? "positive"
            : tool.installed
              ? "warning"
              : "danger"
        }
      >
        {tool.installed && tool.healthy
          ? "OK"
          : tool.installed
            ? "Unhealthy"
            : "Missing"}
      </StatusPill>
    </div>
  );
}

interface BeadsSummaryProps {
  statusCounts: {
    open: number;
    inProgress: number;
    blocked: number;
    closed: number;
    total: number;
  };
  actionableCount: number;
}

function BeadsSummary({ statusCounts, actionableCount }: BeadsSummaryProps) {
  return (
    <div className="card card--compact">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <GitBranch size={16} />
          <span style={{ fontWeight: 500 }}>Beads</span>
        </div>
        <StatusPill tone="muted">{statusCounts.total} total</StatusPill>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "8px",
          textAlign: "center",
        }}
      >
        <div>
          <div style={{ fontSize: "18px", fontWeight: 600 }}>
            {statusCounts.open}
          </div>
          <div className="muted" style={{ fontSize: "11px" }}>
            Open
          </div>
        </div>
        <div>
          <div
            style={{
              fontSize: "18px",
              fontWeight: 600,
              color: "var(--color-blue-500)",
            }}
          >
            {statusCounts.inProgress}
          </div>
          <div className="muted" style={{ fontSize: "11px" }}>
            In Progress
          </div>
        </div>
        <div>
          <div
            style={{
              fontSize: "18px",
              fontWeight: 600,
              color: "var(--color-amber-500)",
            }}
          >
            {statusCounts.blocked}
          </div>
          <div className="muted" style={{ fontSize: "11px" }}>
            Blocked
          </div>
        </div>
        <div>
          <div
            style={{
              fontSize: "18px",
              fontWeight: 600,
              color: "var(--color-green-500)",
            }}
          >
            {actionableCount}
          </div>
          <div className="muted" style={{ fontSize: "11px" }}>
            Ready
          </div>
        </div>
      </div>
    </div>
  );
}

interface IssuesListProps {
  issues: string[];
}

function IssuesList({ issues }: IssuesListProps) {
  if (issues.length === 0) return null;

  return (
    <div
      className="card card--compact"
      style={{
        backgroundColor: "var(--color-amber-50)",
        borderColor: "var(--color-amber-200)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "8px",
        }}
      >
        <AlertTriangle size={16} style={{ color: "var(--color-amber-500)" }} />
        <span style={{ fontWeight: 500, color: "var(--color-amber-800)" }}>
          {issues.length} Issue{issues.length === 1 ? "" : "s"}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {issues.map((issue, i) => (
          <div
            key={i}
            style={{
              fontSize: "12px",
              color: "var(--color-amber-700)",
              display: "flex",
              alignItems: "flex-start",
              gap: "6px",
            }}
          >
            <ChevronRight
              size={12}
              style={{ marginTop: "2px", flexShrink: 0 }}
            />
            {issue}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function SnapshotSummaryPanel() {
  const { data, isLoading, error, refetch } = useSnapshot({
    pollingInterval: 30000, // Auto-refresh every 30 seconds
  });

  if (isLoading && !data) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "32px" }}>
        <Loader2 size={24} className="spin" style={{ marginBottom: "12px" }} />
        <div className="muted">Loading system snapshot...</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <motion.div
        className="card"
        style={{ backgroundColor: "var(--color-red-50)" }}
        variants={fadeVariants}
        initial="hidden"
        animate="visible"
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <AlertCircle size={24} style={{ color: "var(--color-red-500)" }} />
          <div>
            <div style={{ fontWeight: 500 }}>Error loading system snapshot</div>
            <div className="muted">{error.message}</div>
          </div>
        </div>
        <button
          className="btn btn--secondary"
          onClick={() => refetch(true)}
          style={{ marginTop: "16px" }}
        >
          <RefreshCw size={16} />
          Retry
        </button>
      </motion.div>
    );
  }

  if (!data) {
    return null;
  }

  const statusIcon =
    data.summary.status === "healthy" ? (
      <CheckCircle size={24} style={{ color: "var(--color-green-500)" }} />
    ) : data.summary.status === "degraded" ? (
      <AlertTriangle size={24} style={{ color: "var(--color-amber-500)" }} />
    ) : (
      <XCircle size={24} style={{ color: "var(--color-red-500)" }} />
    );

  const allAgents = data.ntm.sessions.flatMap((s) =>
    s.agents.map((a) => ({ ...a, sessionName: s.name })),
  );
  const activeAgents = allAgents.filter(
    (a) => a.state === "working" || a.isActive,
  );

  return (
    <motion.div
      data-testid="snapshot-summary-panel"
      variants={fadeVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header Card */}
      <div className="card">
        <div className="card__header">
          <h3
            style={{
              margin: 0,
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            {statusIcon}
            System Status
          </h3>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <StatusPill tone={getHealthTone(data.summary.status)}>
              {data.summary.status === "healthy"
                ? "All Systems Healthy"
                : data.summary.status === "degraded"
                  ? "Degraded"
                  : "Unhealthy"}
            </StatusPill>
            <button
              className="btn btn--sm btn--ghost"
              onClick={() => refetch(true)}
              disabled={isLoading}
              title="Refresh (bypass cache)"
            >
              {isLoading ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <RefreshCw size={14} />
              )}
            </button>
          </div>
        </div>

        {/* Component Health Summary */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "8px",
            marginTop: "12px",
          }}
        >
          <HealthBadge status={data.summary.ntm} label="NTM" />
          <HealthBadge status={data.summary.agentMail} label="Mail" />
          <HealthBadge status={data.summary.beads} label="Beads" />
          <HealthBadge status={data.summary.tools} label="Tools" />
        </div>

        {/* Generation info */}
        <div
          className="muted"
          style={{
            marginTop: "12px",
            fontSize: "11px",
            display: "flex",
            gap: "16px",
          }}
        >
          <span>
            Generated: {new Date(data.meta.generatedAt).toLocaleTimeString()}
          </span>
          <span>Duration: {data.meta.generationDurationMs}ms</span>
        </div>
      </div>

      {/* Issues (if any) */}
      {data.summary.issues.length > 0 && (
        <div style={{ marginTop: "16px" }}>
          <IssuesList issues={data.summary.issues} />
        </div>
      )}

      {/* Two-column layout for agents and tools */}
      <div
        style={{
          marginTop: "16px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "16px",
        }}
      >
        {/* Active Agents */}
        <div>
          <h4
            style={{
              marginBottom: "12px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <Users size={16} />
            Active Agents
            {activeAgents.length > 0 && (
              <StatusPill tone="positive">{activeAgents.length}</StatusPill>
            )}
          </h4>
          {activeAgents.length > 0 ? (
            <motion.div
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
              variants={listContainerVariants}
              initial="hidden"
              animate="visible"
            >
              {activeAgents.slice(0, 5).map((agent, i) => (
                <AgentCard
                  key={`${agent.sessionName}-${agent.pane}-${i}`}
                  agent={agent}
                  sessionName={agent.sessionName}
                />
              ))}
              {activeAgents.length > 5 && (
                <div className="muted" style={{ textAlign: "center" }}>
                  +{activeAgents.length - 5} more agents
                </div>
              )}
            </motion.div>
          ) : (
            <div
              className="card card--compact muted"
              style={{ textAlign: "center" }}
            >
              No active agents
            </div>
          )}
        </div>

        {/* Tools & Beads */}
        <div>
          {/* Tool Health */}
          <h4
            style={{
              marginBottom: "12px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <Shield size={16} />
            Safety Tools
          </h4>
          <div className="card card--compact">
            <ToolStatusRow name="DCG" tool={data.tools.dcg} />
            <ToolStatusRow name="SLB" tool={data.tools.slb} />
            <ToolStatusRow name="UBS" tool={data.tools.ubs} />
          </div>

          {/* Beads Summary */}
          <div style={{ marginTop: "16px" }}>
            <h4
              style={{
                marginBottom: "12px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <Activity size={16} />
              Work Queue
            </h4>
            <BeadsSummary
              statusCounts={data.beads.statusCounts}
              actionableCount={data.beads.actionableCount}
            />
          </div>
        </div>
      </div>

      {/* NTM Alerts */}
      {data.ntm.alerts.length > 0 && (
        <div style={{ marginTop: "16px" }}>
          <div
            className="card card--compact"
            style={{
              backgroundColor: "var(--color-red-50)",
              borderColor: "var(--color-red-200)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "8px",
              }}
            >
              <AlertCircle
                size={16}
                style={{ color: "var(--color-red-500)" }}
              />
              <span style={{ fontWeight: 500, color: "var(--color-red-800)" }}>
                NTM Alerts
              </span>
            </div>
            {data.ntm.alerts.map((alert, i) => (
              <div
                key={i}
                style={{
                  fontSize: "12px",
                  color: "var(--color-red-700)",
                  marginTop: "4px",
                }}
              >
                {alert}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Links */}
      <div style={{ marginTop: "16px" }}>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <a href="/agents" className="btn btn--sm btn--ghost">
            Agent Fleet
            <ChevronRight size={14} />
          </a>
          <a href="/beads" className="btn btn--sm btn--ghost">
            Beads Dashboard
            <ChevronRight size={14} />
          </a>
          <a href="/safety" className="btn btn--sm btn--ghost">
            Safety Posture
            <ChevronRight size={14} />
          </a>
        </div>
      </div>
    </motion.div>
  );
}
