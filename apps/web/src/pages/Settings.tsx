import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { StatusPill } from "../components/ui/StatusPill";
import { useUiStore } from "../stores/ui";

interface DetailedHealthResponse {
  status?: string;
  components?: Record<
    string,
    {
      status: string;
      message?: string;
    }
  >;
}

interface FeatureFlagItem {
  key: string;
  description?: string;
  enabled: boolean;
  killSwitchEngaged?: boolean;
  rolloutPercentage?: number;
}

interface CostCapPolicyItem {
  workspaceId: string;
  dailySoftCapUsd: number;
  dailyHardCapUsd: number;
  monthlyHardCapUsd: number;
  fallbackModel: string;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const theme = useUiStore((state) => state.theme);
  const mockMode = useUiStore((state) => state.mockMode);
  const toggleTheme = useUiStore((state) => state.toggleTheme);
  const toggleMockMode = useUiStore((state) => state.toggleMockMode);
  const addToast = useUiStore((state) => state.addToast);

  const [newFlagKey, setNewFlagKey] = useState("");
  const [routingResult, setRoutingResult] = useState<string | null>(null);
  const [supportBundleInfo, setSupportBundleInfo] = useState<string | null>(
    null,
  );

  const { data: healthData } = useQuery({
    queryKey: ["settings", "health-detailed", mockMode],
    queryFn: async (): Promise<DetailedHealthResponse | null> => {
      if (mockMode) return null;
      const res = await fetch("/api/health/detailed");
      if (!res.ok) return null;
      const json = await res.json();
      return json.data ?? json;
    },
    staleTime: 30_000,
  });

  const { data: flagsData } = useQuery({
    queryKey: ["settings", "feature-flags", mockMode],
    queryFn: async (): Promise<FeatureFlagItem[]> => {
      if (mockMode) {
        return [
          {
            key: "fast-ws-compression",
            description: "Enable zstd WebSocket frame compression",
            enabled: true,
            killSwitchEngaged: false,
            rolloutPercentage: 100,
          },
          {
            key: "adaptive-context-rotation",
            description: "Auto-rotate agent context at 80% token headroom",
            enabled: true,
            killSwitchEngaged: false,
            rolloutPercentage: 100,
          },
        ];
      }
      const res = await fetch("/api/feature-flags");
      if (!res.ok) return [];
      const json = await res.json();
      const list = json.data ?? json.flags ?? [];
      return Array.isArray(list) ? list : [];
    },
    staleTime: 15_000,
  });

  const { data: costCapsData } = useQuery({
    queryKey: ["settings", "cost-caps", mockMode],
    queryFn: async (): Promise<CostCapPolicyItem[]> => {
      if (mockMode) {
        return [
          {
            workspaceId: "default",
            dailySoftCapUsd: 25,
            dailyHardCapUsd: 50,
            monthlyHardCapUsd: 500,
            fallbackModel: "claude-3-5-haiku",
          },
        ];
      }
      const res = await fetch("/api/cost-caps");
      if (!res.ok) return [];
      const json = await res.json();
      const list = json.data ?? json.policies ?? [];
      return Array.isArray(list) ? list : [];
    },
    staleTime: 15_000,
  });

  const { data: maintenanceData } = useQuery({
    queryKey: ["settings", "maintenance", mockMode],
    queryFn: async (): Promise<{ mode: string; reason?: string }> => {
      if (mockMode) return { mode: "normal" };
      const res = await fetch("/api/system/maintenance");
      if (!res.ok) return { mode: "normal" };
      const json = await res.json();
      const data = json.data ?? json;
      return {
        mode: data?.mode ?? "normal",
        reason: data?.reason,
      };
    },
    staleTime: 10_000,
  });

  const createFlagMutation = useMutation({
    mutationFn: async (key: string) => {
      const res = await fetch("/api/feature-flags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          description: `Managed via Gateway Settings (${key})`,
          enabled: true,
          rolloutPercentage: 100,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      setNewFlagKey("");
      queryClient.invalidateQueries({
        queryKey: ["settings", "feature-flags"],
      });
      addToast({
        type: "success",
        title: "Feature Flag Saved",
        message: "Persisted to SQLite gateway_kv_store",
      });
    },
  });

  const toggleKillSwitchMutation = useMutation({
    mutationFn: async (params: { key: string; engaged: boolean }) => {
      const res = await fetch(
        `/api/feature-flags/${encodeURIComponent(params.key)}/kill-switch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            engaged: params.engaged,
            reason: "Toggled from Settings UI",
          }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["settings", "feature-flags"],
      });
    },
  });

  const maintenanceMutation = useMutation({
    mutationFn: async (params: {
      enabled: boolean;
      deadlineSeconds?: number;
      reason?: string;
    }) => {
      const res = await fetch("/api/system/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "maintenance"] });
      addToast({
        type: "info",
        title: "Maintenance Mode Updated",
        message: "Gateway lifecycle state updated",
      });
    },
  });

  const evaluateRoutingMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/routing/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskType: "coding",
          contextHeadroomPercent: 55,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: (body) => {
      const data = body?.data ?? body;
      setRoutingResult(
        `Selected ${data?.provider ?? "anthropic"}/${data?.model ?? "claude-sonnet-4-20250514"} (failovers: ${data?.failoverCount ?? 0})`,
      );
    },
  });

  const supportBundleMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/support/bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redactSecrets: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: (body) => {
      const data = body?.data ?? body;
      setSupportBundleInfo(
        `Bundle ${data?.bundleId ?? "generated"} ready (redacted: true)`,
      );
      addToast({
        type: "success",
        title: "Support Bundle Generated",
        message: "Redacted diagnostic snapshot created",
      });
    },
  });

  const components = healthData?.components
    ? Object.entries(healthData.components)
    : [];
  const flagsList = flagsData ?? [];
  const costCapsList = costCapsData ?? [];
  const currentMode = maintenanceData?.mode ?? "normal";

  return (
    <div className="page">
      <div className="grid grid--2">
        <div className="card">
          <div className="card__header">
            <h3>Theme</h3>
            <StatusPill tone="muted">{theme}</StatusPill>
          </div>
          <p className="muted">Switch between dawn and dusk palettes.</p>
          <button
            className="primary-button"
            type="button"
            onClick={toggleTheme}
          >
            Toggle theme
          </button>
        </div>
        <div className="card">
          <div className="card__header">
            <h3>Mock data mode</h3>
            <StatusPill tone={mockMode ? "positive" : "muted"}>
              {mockMode ? "enabled" : "disabled"}
            </StatusPill>
          </div>
          <p className="muted">
            Keep the UI interactive when the backend is offline.
          </p>
          <button
            className="primary-button"
            type="button"
            onClick={toggleMockMode}
          >
            Toggle mock mode
          </button>
        </div>
      </div>

      {/* Wave 7 Governance Controls: Feature Flags & Maintenance/Drain Mode */}
      <div className="grid grid--2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card__header">
            <h3>Feature Flags & Kill Switches</h3>
            <StatusPill tone="positive">{flagsList.length} flags</StatusPill>
          </div>
          <p className="muted">
            Durable SQLite-backed feature flags with instant kill-switch
            override.
          </p>
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 12,
              alignItems: "center",
            }}
          >
            <input
              type="text"
              value={newFlagKey}
              onChange={(e) => setNewFlagKey(e.target.value)}
              placeholder="flag-key (e.g. fast-ws-compression)"
              aria-label="New feature flag key"
            />
            <button
              type="button"
              className="primary-button"
              disabled={!newFlagKey.trim() || createFlagMutation.isPending}
              onClick={() => createFlagMutation.mutate(newFlagKey.trim())}
            >
              Upsert Flag
            </button>
          </div>
          {flagsList.length > 0 && (
            <div className="table">
              <div className="table__row table__row--header">
                <span>Key</span>
                <span>State</span>
                <span>Kill Switch</span>
              </div>
              {flagsList.map((flag) => (
                <div key={flag.key} className="table__row">
                  <span className="mono">{flag.key}</span>
                  <span>
                    <StatusPill
                      tone={
                        flag.killSwitchEngaged
                          ? "danger"
                          : flag.enabled
                            ? "positive"
                            : "muted"
                      }
                    >
                      {flag.killSwitchEngaged
                        ? "killed"
                        : flag.enabled
                          ? "enabled"
                          : "disabled"}
                    </StatusPill>
                  </span>
                  <span>
                    <button
                      type="button"
                      onClick={() =>
                        toggleKillSwitchMutation.mutate({
                          key: flag.key,
                          engaged: !flag.killSwitchEngaged,
                        })
                      }
                    >
                      {flag.killSwitchEngaged
                        ? "Restore"
                        : "Engage Kill Switch"}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card__header">
            <h3>Maintenance, Routing & Support Bundle</h3>
            <StatusPill
              tone={currentMode === "normal" ? "positive" : "warning"}
            >
              {currentMode}
            </StatusPill>
          </div>
          <p className="muted">
            Control Gateway drain/maintenance mode, evaluate model routing
            failover chains, and export redacted diagnostic bundles.
          </p>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            <button
              type="button"
              onClick={() =>
                maintenanceMutation.mutate({
                  enabled: currentMode === "normal",
                  deadlineSeconds: 30,
                  reason: "Operator drain toggle via Settings UI",
                })
              }
            >
              {currentMode === "normal"
                ? "Enter Drain Mode"
                : "Resume Normal Mode"}
            </button>
            <button
              type="button"
              onClick={() => evaluateRoutingMutation.mutate()}
            >
              Evaluate Model Routing
            </button>
            <button
              type="button"
              onClick={() => supportBundleMutation.mutate()}
            >
              Export Support Bundle
            </button>
          </div>
          {routingResult && <p className="mono">{routingResult}</p>}
          {supportBundleInfo && <p className="mono">{supportBundleInfo}</p>}
          {costCapsList.length > 0 && (
            <p className="muted">
              Active Cost Caps: {costCapsList.length} workspace policy
              (fallback: {costCapsList[0]?.fallbackModel ?? "haiku"})
            </p>
          )}
        </div>
      </div>

      <div className="card card--wide" style={{ marginTop: 16 }}>
        <div className="card__header">
          <h3>Workspace signals & Subsystem Health</h3>
          <StatusPill
            tone={
              healthData?.status === "healthy"
                ? "positive"
                : mockMode
                  ? "muted"
                  : "warning"
            }
          >
            {healthData?.status ?? (mockMode ? "mock mode" : "checking")}
          </StatusPill>
        </div>
        {components.length > 0 ? (
          <div className="table">
            <div className="table__row table__row--header">
              <span>Subsystem</span>
              <span>Status</span>
              <span>Details</span>
            </div>
            {components.map(([name, info]) => (
              <div key={name} className="table__row">
                <span className="mono">{name}</span>
                <span>
                  <StatusPill
                    tone={
                      info.status === "healthy"
                        ? "positive"
                        : info.status === "degraded"
                          ? "warning"
                          : "danger"
                    }
                  >
                    {info.status}
                  </StatusPill>
                </span>
                <span className="muted">{info.message ?? "Operational"}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">
            Connected to Flywheel Gateway telemetry (SQLite WAL, WebSocket Hub,
            SDK/ACP/Tmux/NTM drivers, and Dicklesworthstone tool suite).
          </p>
        )}
      </div>
    </div>
  );
}
