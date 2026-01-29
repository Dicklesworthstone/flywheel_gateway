/**
 * NTM Page - Named Tmux Manager session management.
 *
 * Displays NTM-tracked agent sessions with health status, activity state,
 * work detection, and alerts. Provides session-level drill-down for
 * agent output, context usage, and file access tracking.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StatusPill } from "../components/ui/StatusPill";

// ============================================================================
// Types
// ============================================================================

interface NtmAgent {
  id: string;
  driverType: string;
  activityState: string;
  startedAt: string;
  lastActivityAt?: string;
  config: Record<string, unknown>;
  pane?: string;
  agentType?: string;
  variant?: string;
  health?: string;
  isWorking?: boolean;
  confidence?: number;
}

interface SystemSnapshot {
  data: {
    agents?: NtmAgent[];
    generatedAt?: string;
    timestamp?: string;
    health?: Record<string, unknown>;
  };
}

interface HealthDetailed {
  status: string;
  components: Record<string, {
    status: string;
    message?: string;
    detection?: Record<string, unknown>;
    details?: Record<string, unknown>;
  }>;
  diagnostics?: {
    tools?: Record<string, {
      available: boolean;
      reasonLabel?: string;
      rootCausePath?: string[];
      rootCauseExplanation?: string;
    }>;
    summary?: {
      totalTools: number;
      availableTools: number;
      unavailableTools: number;
    };
  };
}

// ============================================================================
// API
// ============================================================================

const API_BASE = "";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error?.message ?? body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ============================================================================
// Components
// ============================================================================

const stateTone: Record<string, "positive" | "warning" | "danger" | "muted"> = {
  READY: "positive",
  EXECUTING: "positive",
  PAUSED: "warning",
  FAILED: "danger",
  TERMINATED: "muted",
  idle: "muted",
  working: "positive",
  stalled: "warning",
  error: "danger",
};

const healthTone: Record<string, "positive" | "warning" | "danger" | "muted"> = {
  healthy: "positive",
  degraded: "warning",
  unhealthy: "danger",
};

function AgentRow({ agent }: { agent: NtmAgent }) {
  return (
    <div className="table__row">
      <span className="mono">{agent.id}</span>
      <span>{agent.agentType ?? agent.config?.["type"] ?? "unknown"}</span>
      <span>{agent.variant ?? "—"}</span>
      <span>
        <StatusPill tone={stateTone[agent.activityState] ?? "muted"}>
          {agent.activityState}
        </StatusPill>
      </span>
      <span>
        {agent.health && (
          <StatusPill tone={healthTone[agent.health] ?? "muted"}>
            {agent.health}
          </StatusPill>
        )}
        {!agent.health && "—"}
      </span>
      <span>
        {agent.isWorking != null
          ? agent.isWorking
            ? `Working (${((agent.confidence ?? 0) * 100).toFixed(0)}%)`
            : "Idle"
          : "—"}
      </span>
      <span className="muted">
        {agent.lastActivityAt
          ? new Date(agent.lastActivityAt).toLocaleString()
          : agent.startedAt
            ? new Date(agent.startedAt).toLocaleString()
            : "—"}
      </span>
    </div>
  );
}

// ============================================================================
// Page
// ============================================================================

export function NTMPage() {
  const [tab, setTab] = useState<"sessions" | "health" | "diagnostics">("sessions");

  const { data: snapshot, isLoading: snapshotLoading, error: snapshotError } = useQuery({
    queryKey: ["ntm", "snapshot"],
    queryFn: () => fetchJson<SystemSnapshot>("/system/snapshot"),
    staleTime: 10_000,
  });

  const { data: health } = useQuery({
    queryKey: ["ntm", "health"],
    queryFn: () => fetchJson<HealthDetailed>("/health/detailed"),
    staleTime: 10_000,
  });

  const agents = snapshot?.data?.agents ?? [];
  const ntmAgents = agents.filter((a) => a.driverType === "ntm");
  const otherAgents = agents.filter((a) => a.driverType !== "ntm");

  const ntmComponent = health?.components?.["agentCLIs"];
  const ntmAvailable = ntmComponent?.detection
    ? Boolean((ntmComponent.detection as Record<string, unknown>)?.["clis"]
        && ((ntmComponent.detection as Record<string, Record<string, unknown>>)["clis"]?.["ntm"] as Record<string, unknown>)?.["available"])
    : false;

  const diagnostics = health?.diagnostics;
  const ntmTool = diagnostics?.tools?.["ntm"];

  const tabs: Array<{ id: typeof tab; label: string; badge?: number }> = [
    { id: "sessions", label: "Sessions", badge: ntmAgents.length || undefined },
    { id: "health", label: "Health" },
    { id: "diagnostics", label: "Diagnostics" },
  ];

  return (
    <div className="page">
      <div className="page__header">
        <h2>NTM Sessions</h2>
        <StatusPill tone={ntmAvailable ? "positive" : "warning"}>
          {ntmAvailable ? "NTM available" : "NTM unavailable"}
        </StatusPill>
      </div>

      {/* Summary */}
      <div className="card card--compact" style={{ marginBottom: 16 }}>
        <p className="muted">
          {ntmAgents.length} NTM agent{ntmAgents.length !== 1 ? "s" : ""}
          {otherAgents.length > 0 && ` | ${otherAgents.length} other agent${otherAgents.length !== 1 ? "s" : ""}`}
          {snapshot?.data?.generatedAt && (
            <> | Snapshot: {new Date(snapshot.data.generatedAt).toLocaleString()}</>
          )}
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "tab-button tab-button--active" : "tab-button"}
            type="button"
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge != null && <span className="nav-badge">{t.badge}</span>}
          </button>
        ))}
      </div>

      {/* Sessions tab */}
      {tab === "sessions" && (
        <div className="card">
          <div className="card__header">
            <h3>NTM-Tracked Agents</h3>
          </div>
          {snapshotLoading && <p className="muted">Loading sessions...</p>}
          {snapshotError && <p className="error-text">{(snapshotError as Error).message}</p>}
          {!snapshotLoading && ntmAgents.length === 0 && (
            <div>
              <p className="muted">No NTM agents detected.</p>
              {!ntmAvailable && (
                <p className="muted" style={{ marginTop: 8 }}>
                  NTM is not available. Install NTM and start a tmux session to see agents here.
                </p>
              )}
            </div>
          )}
          {ntmAgents.length > 0 && (
            <div className="table">
              <div className="table__row table__row--header">
                <span>ID</span>
                <span>Type</span>
                <span>Variant</span>
                <span>State</span>
                <span>Health</span>
                <span>Work Status</span>
                <span>Last Activity</span>
              </div>
              {ntmAgents.map((a) => (
                <AgentRow key={a.id} agent={a} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Health tab */}
      {tab === "health" && (
        <div className="card">
          <div className="card__header">
            <h3>System Health</h3>
            {health?.status && (
              <StatusPill tone={healthTone[health.status] ?? "muted"}>
                {health.status}
              </StatusPill>
            )}
          </div>
          {health?.components && (
            <div className="table">
              <div className="table__row table__row--header">
                <span>Component</span>
                <span>Status</span>
                <span>Message</span>
              </div>
              {Object.entries(health.components).map(([name, comp]) => (
                <div key={name} className="table__row">
                  <span>{name}</span>
                  <span>
                    <StatusPill tone={healthTone[comp.status] ?? "muted"}>
                      {comp.status}
                    </StatusPill>
                  </span>
                  <span className="muted">{comp.message ?? "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Diagnostics tab */}
      {tab === "diagnostics" && (
        <div className="card">
          <div className="card__header">
            <h3>Tool Diagnostics</h3>
          </div>
          {!diagnostics && (
            <p className="muted">No diagnostics available.</p>
          )}
          {diagnostics?.summary && (
            <p className="muted" style={{ marginBottom: 12 }}>
              {diagnostics.summary.availableTools}/{diagnostics.summary.totalTools} tools available
              {diagnostics.summary.unavailableTools > 0 && (
                <> | {diagnostics.summary.unavailableTools} unavailable</>
              )}
            </p>
          )}
          {diagnostics?.tools && (
            <div className="table">
              <div className="table__row table__row--header">
                <span>Tool</span>
                <span>Available</span>
                <span>Details</span>
              </div>
              {Object.entries(diagnostics.tools).map(([name, tool]) => (
                <div key={name} className="table__row">
                  <span>{name}</span>
                  <span>
                    <StatusPill tone={tool.available ? "positive" : "danger"}>
                      {tool.available ? "yes" : "no"}
                    </StatusPill>
                  </span>
                  <span className="muted">
                    {!tool.available && tool.reasonLabel
                      ? tool.reasonLabel
                      : tool.rootCauseExplanation ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
          {ntmTool && !ntmTool.available && ntmTool.rootCausePath && (
            <div style={{ marginTop: 12 }}>
              <p className="muted">
                Root cause path: {ntmTool.rootCausePath.join(" → ")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
