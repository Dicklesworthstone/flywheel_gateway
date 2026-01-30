/**
 * SLB Page - Safety Line Buffer (Two-Person Authorization).
 *
 * Provides session management, pending request approval,
 * command tier checking, and request history.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  startedAt: string;
  lastHeartbeat: string;
}

interface SlbRequest {
  id: string;
  command: string;
  tier: string;
  status: string;
  requestedBy: string;
  requestedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reason?: string;
}

interface SlbCheckResult {
  command: string;
  tier: string;
  pattern?: string;
  requiresApproval: boolean;
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

const statusTone: Record<string, "positive" | "warning" | "danger" | "muted"> = {
  pending: "warning",
  approved: "positive",
  rejected: "danger",
  cancelled: "muted",
  timeout: "muted",
  executed: "positive",
  failed: "danger",
};

type TabId = "pending" | "history" | "sessions" | "check";

// ============================================================================
// Page
// ============================================================================

export function SLBPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>("pending");
  const [checkCommand, setCheckCommand] = useState("");

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

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/slb/requests/${id}/approve`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["slb", "pending"] });
      queryClient.invalidateQueries({ queryKey: ["slb", "history"] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/slb/requests/${id}/reject`, { method: "POST" }),
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

  const available = status?.data?.available ?? false;
  const pendingList = pending?.data ?? [];
  const historyList = history?.data ?? [];
  const sessionList = sessions?.data ?? [];

  const tabs: Array<{ id: TabId; label: string; badge?: number }> = [
    pendingList.length > 0
      ? { id: "pending" as const, label: "Pending", badge: pendingList.length }
      : { id: "pending" as const, label: "Pending" },
    { id: "history", label: "History" },
    sessionList.length > 0
      ? { id: "sessions" as const, label: "Sessions", badge: sessionList.length }
      : { id: "sessions" as const, label: "Sessions" },
    { id: "check", label: "Check Command" },
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
            className={tab === t.id ? "tab-button tab-button--active" : "tab-button"}
            type="button"
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge != null && <span className="nav-badge">{t.badge}</span>}
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
              {pendingList.map((r) => (
                <div key={r.id} className="table__row">
                  <span className="mono">{r.command}</span>
                  <span>
                    <StatusPill tone={tierTone[r.tier] ?? "muted"}>{r.tier}</StatusPill>
                  </span>
                  <span>{r.requestedBy}</span>
                  <span className="muted">
                    {new Date(r.requestedAt).toLocaleString()}
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
              ))}
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
              {historyList.map((r) => (
                <div key={r.id} className="table__row">
                  <span className="mono">{r.command}</span>
                  <span>
                    <StatusPill tone={tierTone[r.tier] ?? "muted"}>{r.tier}</StatusPill>
                  </span>
                  <span>
                    <StatusPill tone={statusTone[r.status] ?? "muted"}>{r.status}</StatusPill>
                  </span>
                  <span>{r.requestedBy}</span>
                  <span>{r.reviewedBy ?? "—"}</span>
                  <span className="muted">
                    {new Date(r.requestedAt).toLocaleString()}
                  </span>
                </div>
              ))}
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
              {sessionList.map((s) => (
                <div key={s.id} className="table__row">
                  <span className="mono">{s.id}</span>
                  <span>{s.agent}</span>
                  <span>{s.program}</span>
                  <span className="muted">
                    {new Date(s.startedAt).toLocaleString()}
                  </span>
                  <span className="muted">
                    {new Date(s.lastHeartbeat).toLocaleString()}
                  </span>
                </div>
              ))}
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
                <StatusPill tone={tierTone[checkMutation.data.data.tier] ?? "muted"}>
                  {checkMutation.data.data.tier}
                </StatusPill>
              </p>
              <p>
                Requires approval:{" "}
                {checkMutation.data.data.requiresApproval ? "Yes" : "No"}
              </p>
              {checkMutation.data.data.pattern && (
                <p className="muted">
                  Matched pattern: <code>{checkMutation.data.data.pattern}</code>
                </p>
              )}
            </div>
          )}
          {checkMutation.isError && (
            <p className="error-text">{(checkMutation.error as Error).message}</p>
          )}
        </div>
      )}
    </div>
  );
}
