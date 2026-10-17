/**
 * SLB Page - Safety Line Buffer (Two-Person Authorization).
 *
 * Provides session management, pending request approval,
 * command tier checking, and request history.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { StatusPill } from "../components/ui/StatusPill";

// ============================================================================
// Types
// ============================================================================

interface SlbStatus {
  available: boolean;
  version?: string;
}

interface SlbSession {
  id: string;
  agent: string;
  program: string;
  startedAt?: string;
  started_at?: string;
  lastHeartbeat?: string;
  last_active_at?: string;
}

interface SlbRequest {
  id: string;
  command: string;
  tier: string;
  status: string;
  requestedBy?: string;
  requestor_agent?: string;
  requestor_session_id?: string;
  requestedAt?: string;
  created_at?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  resolved_at?: string;
  reason?: string;
}

interface SlbCheckResult {
  command: string;
  tier: string;
  pattern?: string;
  matched_pattern?: string;
  requiresApproval?: boolean;
  requires_approval?: boolean;
}

interface SlbPatternItem {
  pattern: string;
  tier: string;
  reason?: string;
  builtin?: boolean;
}

// ============================================================================
// API
// ============================================================================

const API_BASE = "/api";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error?.message ?? body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ============================================================================
// Components
// ============================================================================

const tierTone: Record<string, "positive" | "warning" | "danger" | "muted"> = {
  safe: "positive",
  caution: "warning",
  dangerous: "danger",
  critical: "danger",
};

const statusTone: Record<string, "positive" | "warning" | "danger" | "muted"> =
  {
    pending: "warning",
    approved: "positive",
    rejected: "danger",
    cancelled: "muted",
    timeout: "muted",
    executed: "positive",
    failed: "danger",
  };

type TabId = "pending" | "history" | "sessions" | "check" | "patterns";

// ============================================================================
// Page
// ============================================================================

export function SLBPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>("pending");
  const [checkCommand, setCheckCommand] = useState("");
  const [newPattern, setNewPattern] = useState("");
  const [newPatternTier, setNewPatternTier] = useState<
    "safe" | "caution" | "dangerous" | "critical"
  >("dangerous");
  const [newPatternReason, setNewPatternReason] = useState("");

  const { data: status } = useQuery({
    queryKey: ["slb", "status"],
    queryFn: () => fetchJson<{ data: SlbStatus }>("/slb/status"),
    staleTime: 30_000,
  });

  const { data: sessions } = useQuery({
    queryKey: ["slb", "sessions"],
    queryFn: () => fetchJson<{ data: SlbSession[] }>("/slb/sessions"),
    staleTime: 10_000,
    enabled: tab === "sessions",
  });

  const { data: pending } = useQuery({
    queryKey: ["slb", "pending"],
    queryFn: () => fetchJson<{ data: SlbRequest[] }>("/slb/requests/pending"),
    staleTime: 5_000,
    enabled: tab === "pending",
  });

  const { data: history } = useQuery({
    queryKey: ["slb", "history"],
    queryFn: () => fetchJson<{ data: SlbRequest[] }>("/slb/requests/history"),
    staleTime: 15_000,
    enabled: tab === "history",
  });

  const { data: patternsData } = useQuery({
    queryKey: ["slb", "patterns"],
    queryFn: () =>
      fetchJson<{
        data: Record<string, SlbPatternItem[]> | SlbPatternItem[];
      }>("/slb/patterns"),
    staleTime: 30_000,
    enabled: tab === "patterns",
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/slb/requests/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "web-operator",
          sessionKey: "web-dashboard",
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["slb", "pending"] });
      queryClient.invalidateQueries({ queryKey: ["slb", "history"] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/slb/requests/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "web-operator",
          sessionKey: "web-dashboard",
          reason: "Rejected from Safety Line Buffer UI",
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["slb", "pending"] });
      queryClient.invalidateQueries({ queryKey: ["slb", "history"] });
    },
  });

  const checkMutation = useMutation({
    mutationFn: () =>
      fetchJson<{ data: SlbCheckResult }>("/slb/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: checkCommand }),
      }),
  });

  const addPatternMutation = useMutation({
    mutationFn: () =>
      fetchJson("/slb/patterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pattern: newPattern,
          tier: newPatternTier,
          ...(newPatternReason.trim()
            ? { reason: newPatternReason.trim() }
            : {}),
        }),
      }),
    onSuccess: () => {
      setNewPattern("");
      setNewPatternReason("");
      queryClient.invalidateQueries({ queryKey: ["slb", "patterns"] });
    },
  });

  const available = status?.data?.available ?? false;
  const pendingList = Array.isArray(pending?.data) ? pending.data : [];
  const historyList = Array.isArray(history?.data) ? history.data : [];
  const sessionList = Array.isArray(sessions?.data) ? sessions.data : [];

  const flatPatterns: SlbPatternItem[] = (() => {
    const raw = patternsData?.data;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    const out: SlbPatternItem[] = [];
    for (const [tierKey, items] of Object.entries(raw)) {
      if (Array.isArray(items)) {
        for (const item of items) {
          out.push({ ...item, tier: item.tier ?? tierKey });
        }
      }
    }
    return out;
  })();

  const tabs: Array<{ id: TabId; label: string; badge?: number }> = [
    pendingList.length > 0
      ? { id: "pending" as const, label: "Pending", badge: pendingList.length }
      : { id: "pending" as const, label: "Pending" },
    { id: "history", label: "History" },
    sessionList.length > 0
      ? {
          id: "sessions" as const,
          label: "Sessions",
          badge: sessionList.length,
        }
      : { id: "sessions" as const, label: "Sessions" },
    { id: "check", label: "Check Command" },
    { id: "patterns", label: "Patterns" },
  ];

  return (
    <div className="page">
      <div className="page__header">
        <h2>Safety Line Buffer</h2>
        <StatusPill tone={available ? "positive" : "warning"}>
          {available ? `SLB v${status?.data?.version ?? "?"}` : "unavailable"}
        </StatusPill>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            className={
              tab === t.id ? "tab-button tab-button--active" : "tab-button"
            }
            type="button"
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge !== null && t.badge !== undefined && (
              <span className="nav-badge">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Pending requests */}
      {tab === "pending" && (
        <div className="card">
          <div className="card__header">
            <h3>Pending Approval</h3>
          </div>
          {pendingList.length === 0 && (
            <p className="muted">No pending requests.</p>
          )}
          {pendingList.length > 0 && (
            <div className="table">
              <div className="table__row table__row--header">
                <span>Command</span>
                <span>Tier</span>
                <span>Requested By</span>
                <span>Time</span>
                <span>Actions</span>
              </div>
              {pendingList.map((r) => {
                const requestedBy =
                  r.requestedBy ??
                  r.requestor_agent ??
                  r.requestor_session_id ??
                  "—";
                const requestedAt = r.requestedAt ?? r.created_at;
                return (
                  <div key={r.id} className="table__row">
                    <span className="mono">{r.command}</span>
                    <span>
                      <StatusPill tone={tierTone[r.tier] ?? "muted"}>
                        {r.tier}
                      </StatusPill>
                    </span>
                    <span>{requestedBy}</span>
                    <span className="muted">
                      {requestedAt
                        ? new Date(requestedAt).toLocaleString()
                        : "—"}
                    </span>
                    <span style={{ display: "flex", gap: 4 }}>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => approveMutation.mutate(r.id)}
                        disabled={approveMutation.isPending}
                      >
                        Approve
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => rejectMutation.mutate(r.id)}
                        disabled={rejectMutation.isPending}
                      >
                        Reject
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* History */}
      {tab === "history" && (
        <div className="card">
          <div className="card__header">
            <h3>Request History</h3>
          </div>
          {historyList.length === 0 && (
            <p className="muted">No request history.</p>
          )}
          {historyList.length > 0 && (
            <div className="table">
              <div className="table__row table__row--header">
                <span>Command</span>
                <span>Tier</span>
                <span>Status</span>
                <span>Requested By</span>
                <span>Reviewed By</span>
                <span>Time</span>
              </div>
              {historyList.map((r) => {
                const requestedBy =
                  r.requestedBy ??
                  r.requestor_agent ??
                  r.requestor_session_id ??
                  "—";
                const requestedAt = r.requestedAt ?? r.created_at;
                return (
                  <div key={r.id} className="table__row">
                    <span className="mono">{r.command}</span>
                    <span>
                      <StatusPill tone={tierTone[r.tier] ?? "muted"}>
                        {r.tier}
                      </StatusPill>
                    </span>
                    <span>
                      <StatusPill tone={statusTone[r.status] ?? "muted"}>
                        {r.status}
                      </StatusPill>
                    </span>
                    <span>{requestedBy}</span>
                    <span>{r.reviewedBy ?? "—"}</span>
                    <span className="muted">
                      {requestedAt
                        ? new Date(requestedAt).toLocaleString()
                        : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Sessions */}
      {tab === "sessions" && (
        <div className="card">
          <div className="card__header">
            <h3>Active Sessions</h3>
          </div>
          {sessionList.length === 0 && (
            <p className="muted">No active sessions.</p>
          )}
          {sessionList.length > 0 && (
            <div className="table">
              <div className="table__row table__row--header">
                <span>ID</span>
                <span>Agent</span>
                <span>Program</span>
                <span>Started</span>
                <span>Last Heartbeat</span>
              </div>
              {sessionList.map((s) => {
                const startedAt = s.startedAt ?? s.started_at;
                const lastHeartbeat =
                  s.lastHeartbeat ?? s.last_active_at ?? startedAt;
                return (
                  <div key={s.id} className="table__row">
                    <span className="mono">{s.id}</span>
                    <span>{s.agent}</span>
                    <span>{s.program}</span>
                    <span className="muted">
                      {startedAt ? new Date(startedAt).toLocaleString() : "—"}
                    </span>
                    <span className="muted">
                      {lastHeartbeat
                        ? new Date(lastHeartbeat).toLocaleString()
                        : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Command check */}
      {tab === "check" && (
        <div className="card">
          <h3>Check Command Tier</h3>
          <p className="muted">
            Test which risk tier a command matches against SLB patterns.
          </p>
          <div className="form-row">
            <input
              type="text"
              className="text-input"
              placeholder="rm -rf /important/data"
              value={checkCommand}
              onChange={(e) => setCheckCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && checkCommand) checkMutation.mutate();
              }}
            />
            <button
              className="primary-button"
              type="button"
              onClick={() => checkMutation.mutate()}
              disabled={checkMutation.isPending || !checkCommand}
            >
              {checkMutation.isPending ? "Checking..." : "Check"}
            </button>
          </div>
          {checkMutation.isSuccess && (
            <div className="result-box" style={{ marginTop: 12 }}>
              <p>
                Tier:{" "}
                <StatusPill
                  tone={tierTone[checkMutation.data.data.tier] ?? "muted"}
                >
                  {checkMutation.data.data.tier}
                </StatusPill>
              </p>
              <p>
                Requires approval:{" "}
                {(checkMutation.data.data.requiresApproval ??
                checkMutation.data.data.requires_approval)
                  ? "Yes"
                  : "No"}
              </p>
              {(checkMutation.data.data.pattern ??
                checkMutation.data.data.matched_pattern) && (
                <p className="muted">
                  Matched pattern:{" "}
                  <code>
                    {checkMutation.data.data.pattern ??
                      checkMutation.data.data.matched_pattern}
                  </code>
                </p>
              )}
            </div>
          )}
          {checkMutation.isError && (
            <p className="error-text">
              {(checkMutation.error as Error).message}
            </p>
          )}
        </div>
      )}

      {/* Patterns inspector */}
      {tab === "patterns" && (
        <div className="card">
          <div className="card__header">
            <h3>SLB Risk Tier Patterns</h3>
          </div>
          <div className="form-row" style={{ marginBottom: 16 }}>
            <input
              type="text"
              className="text-input"
              placeholder="Regex pattern (e.g., ^kubectl delete)"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
            />
            <select
              className="select-input"
              value={newPatternTier}
              onChange={(e) =>
                setNewPatternTier(
                  e.target.value as
                    | "safe"
                    | "caution"
                    | "dangerous"
                    | "critical",
                )
              }
            >
              <option value="safe">Safe</option>
              <option value="caution">Caution</option>
              <option value="dangerous">Dangerous</option>
              <option value="critical">Critical</option>
            </select>
            <input
              type="text"
              className="text-input"
              placeholder="Reason (optional)"
              value={newPatternReason}
              onChange={(e) => setNewPatternReason(e.target.value)}
            />
            <button
              className="primary-button"
              type="button"
              onClick={() => addPatternMutation.mutate()}
              disabled={addPatternMutation.isPending || !newPattern.trim()}
            >
              {addPatternMutation.isPending ? "Adding..." : "Add Pattern"}
            </button>
          </div>
          {flatPatterns.length === 0 ? (
            <p className="muted">No patterns loaded or SLB unavailable.</p>
          ) : (
            <div className="table">
              <div className="table__row table__row--header">
                <span>Pattern</span>
                <span>Tier</span>
                <span>Reason</span>
              </div>
              {flatPatterns.map((p, idx) => (
                <div
                  key={`${p.tier}:${p.pattern}:${idx}`}
                  className="table__row"
                >
                  <span className="mono">{p.pattern}</span>
                  <span>
                    <StatusPill tone={tierTone[p.tier] ?? "muted"}>
                      {p.tier}
                    </StatusPill>
                  </span>
                  <span className="muted">{p.reason ?? "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
