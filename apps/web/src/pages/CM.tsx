/**
 * CM Page - Credential Manager overview.
 *
 * Surfaces credential health, API key rotation status,
 * and provider connectivity. Works alongside the Accounts
 * page which handles BYOA profile CRUD.
 */

import { useQuery } from "@tanstack/react-query";
import { StatusPill } from "../components/ui/StatusPill";

// ============================================================================
// Types
// ============================================================================

interface ByoaStatus {
  providers: Record<string, {
    configured: boolean;
    profileCount: number;
    activeProfile?: string;
    lastRotation?: string;
    healthy: boolean;
  }>;
  totalProfiles: number;
  healthyProviders: number;
  totalProviders: number;
}

interface PoolEntry {
  provider: string;
  profileId: string;
  active: boolean;
  cooldownUntil?: string;
  lastUsed?: string;
  verified: boolean;
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
  const { data: status, isLoading, error } = useQuery({
    queryKey: ["cm", "status"],
    queryFn: () => fetchJson<{ data: ByoaStatus }>("/accounts/byoa/status"),
    staleTime: 30_000,
  });

  const { data: pool } = useQuery({
    queryKey: ["cm", "pool"],
    queryFn: () => fetchJson<{ data: PoolEntry[] }>("/accounts/pool"),
    staleTime: 15_000,
  });

  const byoa = status?.data;
  const poolEntries = pool?.data ?? [];

  return (
    <div className="page">
      <div className="page__header">
        <h2>Credential Manager</h2>
        {byoa && (
          <StatusPill
            tone={byoa.healthyProviders === byoa.totalProviders ? "positive" : "warning"}
          >
            {byoa.healthyProviders}/{byoa.totalProviders} healthy
          </StatusPill>
        )}
      </div>

      {isLoading && <p className="muted">Loading credential status...</p>}
      {error && <p className="error-text">{(error as Error).message}</p>}

      {/* Provider overview */}
      {byoa?.providers && (
        <div className="grid grid--3" style={{ marginBottom: 16 }}>
          {Object.entries(byoa.providers).map(([name, provider]) => (
            <div key={name} className="card">
              <div className="card__header">
                <h3>{name}</h3>
                <StatusPill tone={provider.healthy ? "positive" : "danger"}>
                  {provider.healthy ? "healthy" : "unhealthy"}
                </StatusPill>
              </div>
              <p className="muted">
                {provider.profileCount} profile{provider.profileCount !== 1 ? "s" : ""}
                {provider.activeProfile && (
                  <> | Active: <code>{provider.activeProfile}</code></>
                )}
              </p>
              {provider.lastRotation && (
                <p className="muted">
                  Last rotation: {new Date(provider.lastRotation).toLocaleString()}
                </p>
              )}
              {!provider.configured && (
                <p className="warning-text">Not configured</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pool status */}
      {poolEntries.length > 0 && (
        <div className="card">
          <div className="card__header">
            <h3>Rotation Pool</h3>
            <StatusPill tone="muted">{poolEntries.length} entries</StatusPill>
          </div>
          <div className="table">
            <div className="table__row table__row--header">
              <span>Provider</span>
              <span>Profile</span>
              <span>Status</span>
              <span>Verified</span>
              <span>Last Used</span>
              <span>Cooldown</span>
            </div>
            {poolEntries.map((entry) => (
              <div key={`${entry.provider}-${entry.profileId}`} className="table__row">
                <span>{entry.provider}</span>
                <span className="mono">{entry.profileId}</span>
                <span>
                  <StatusPill tone={entry.active ? "positive" : "muted"}>
                    {entry.active ? "active" : "inactive"}
                  </StatusPill>
                </span>
                <span>
                  <StatusPill tone={entry.verified ? "positive" : "warning"}>
                    {entry.verified ? "yes" : "no"}
                  </StatusPill>
                </span>
                <span className="muted">
                  {entry.lastUsed
                    ? new Date(entry.lastUsed).toLocaleString()
                    : "never"}
                </span>
                <span className="muted">
                  {entry.cooldownUntil
                    ? new Date(entry.cooldownUntil).toLocaleString()
                    : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isLoading && !byoa && !error && (
        <div className="card">
          <p className="muted">
            No credential data available. Configure provider accounts in the Accounts page.
          </p>
        </div>
      )}
    </div>
  );
}
