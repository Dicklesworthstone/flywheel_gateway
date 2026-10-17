/**
 * CM Page - Cass-Memory (CM) Procedural Memory & Playbook Rules.
 *
 * Surfaces procedural memory health, playbook statistics (rules, anti-patterns,
 * procedures), and active playbook rules via /api/memory/*.
 */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { StatusPill } from "../components/ui/StatusPill";

// ============================================================================
// Types
// ============================================================================

interface MemoryHealth {
  available: boolean;
  healthy: boolean;
  version?: string;
  overallStatus?: string;
  error?: string;
  timestamp: string;
}

interface MemoryStats {
  success: boolean;
  total: number;
  byScope?: Record<string, number>;
  byState?: Record<string, number>;
  byKind?: Record<string, number>;
  atRiskCount?: number;
  staleCount?: number;
}

interface PlaybookRule {
  id: string;
  text: string;
  category?: string;
  scope?: string;
  state: "active" | "deprecated" | "pending";
  kind: "rule" | "anti-pattern" | "procedure";
  confidence?: number;
  helpfulCount?: number;
  harmfulCount?: number;
  score?: number;
}

// ============================================================================
// API
// ============================================================================

const API_BASE = "/api";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error?.message ?? body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ============================================================================
// Page
// ============================================================================

export function CMPage() {
  const [kindFilter, setKindFilter] = useState<string>("");

  const {
    data: healthRes,
    isLoading: healthLoading,
    error: healthError,
  } = useQuery({
    queryKey: ["cm", "memory-health"],
    queryFn: () => fetchJson<{ data: MemoryHealth }>("/memory/health"),
    staleTime: 30_000,
  });

  const { data: statsRes } = useQuery({
    queryKey: ["cm", "memory-stats"],
    queryFn: () => fetchJson<{ data: MemoryStats }>("/memory/stats"),
    staleTime: 30_000,
  });

  const { data: rulesRes, isLoading: rulesLoading } = useQuery({
    queryKey: ["cm", "memory-rules", kindFilter],
    queryFn: () => {
      const qs = kindFilter ? `?kind=${encodeURIComponent(kindFilter)}` : "";
      return fetchJson<{ data: PlaybookRule[] }>(`/memory/rules${qs}`);
    },
    staleTime: 15_000,
  });

  const health = healthRes?.data;
  const stats = statsRes?.data;
  const rules = Array.isArray(rulesRes?.data) ? rulesRes.data : [];

  return (
    <div className="page">
      <div className="page__header">
        <h2>Cass-Memory (CM) Procedural Memory</h2>
        {health && (
          <StatusPill tone={health.healthy ? "positive" : "warning"}>
            {health.healthy
              ? `healthy${health.version ? ` (${health.version})` : ""}`
              : (health.overallStatus ?? "unavailable")}
          </StatusPill>
        )}
      </div>

      {healthLoading && <p className="muted">Loading Cass-Memory status...</p>}
      {healthError && (
        <p className="muted">
          Cass-Memory CLI status: {(healthError as Error).message}
        </p>
      )}

      {/* Playbook stats summary */}
      <div className="grid grid--3" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card__header">
            <h3>Total Playbook Rules</h3>
            <StatusPill tone="positive">
              {stats?.total ?? rules.length}
            </StatusPill>
          </div>
          <p className="muted">
            Active:{" "}
            {stats?.byState?.["active"] ??
              rules.filter((r) => r.state === "active").length}
            {" · "}Pending: {stats?.byState?.["pending"] ?? 0}
            {" · "}Deprecated: {stats?.byState?.["deprecated"] ?? 0}
          </p>
        </div>

        <div className="card">
          <div className="card__header">
            <h3>Breakdown by Kind</h3>
            <StatusPill tone="muted">Procedural</StatusPill>
          </div>
          <p className="muted">
            Rules:{" "}
            {stats?.byKind?.["rule"] ??
              rules.filter((r) => r.kind === "rule").length}
            {" · "}Anti-patterns:{" "}
            {stats?.byKind?.["anti-pattern"] ??
              rules.filter((r) => r.kind === "anti-pattern").length}
            {" · "}Procedures:{" "}
            {stats?.byKind?.["procedure"] ??
              rules.filter((r) => r.kind === "procedure").length}
          </p>
        </div>

        <div className="card">
          <div className="card__header">
            <h3>Rule Freshness</h3>
            <StatusPill
              tone={(stats?.atRiskCount ?? 0) === 0 ? "positive" : "warning"}
            >
              {stats?.atRiskCount ?? 0} at risk
            </StatusPill>
          </div>
          <p className="muted">
            Stale rules: {stats?.staleCount ?? 0} · Injected into Context Packs
          </p>
        </div>
      </div>

      {/* Playbook rules table */}
      <div className="card">
        <div className="card__header">
          <h3>Playbook Rules</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              aria-label="Filter rules by kind"
            >
              <option value="">All kinds</option>
              <option value="rule">Rules</option>
              <option value="anti-pattern">Anti-patterns</option>
              <option value="procedure">Procedures</option>
            </select>
            <StatusPill tone="muted">{rules.length} entries</StatusPill>
          </div>
        </div>

        {rulesLoading ? (
          <p className="muted">Loading playbook rules...</p>
        ) : rules.length > 0 ? (
          <div className="table">
            <div className="table__row table__row--header">
              <span>ID</span>
              <span>Kind</span>
              <span>Category</span>
              <span>Rule</span>
              <span>State</span>
              <span>Score</span>
            </div>
            {rules.map((rule) => (
              <div key={rule.id} className="table__row">
                <span className="mono">{rule.id}</span>
                <span>
                  <StatusPill
                    tone={
                      rule.kind === "anti-pattern"
                        ? "warning"
                        : rule.kind === "procedure"
                          ? "positive"
                          : "muted"
                    }
                  >
                    {rule.kind}
                  </StatusPill>
                </span>
                <span className="muted">
                  {rule.category ?? rule.scope ?? "general"}
                </span>
                <span>{rule.text}</span>
                <span>
                  <StatusPill
                    tone={rule.state === "active" ? "positive" : "muted"}
                  >
                    {rule.state}
                  </StatusPill>
                </span>
                <span className="mono">
                  {rule.score !== undefined
                    ? rule.score.toFixed(2)
                    : `+${rule.helpfulCount ?? 0}/-${rule.harmfulCount ?? 0}`}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">
            No playbook rules recorded yet. Rules and anti-patterns learned
            during agent sessions will appear here.
          </p>
        )}
      </div>
    </div>
  );
}
