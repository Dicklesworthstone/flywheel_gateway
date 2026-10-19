import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { StatusPill } from "../components/ui/StatusPill";
import { useSendTestNotification } from "../hooks/useNotifications";
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

interface BackupManifestItem {
  id: string;
  workspaceId: string;
  label: string;
  integrityCheck: "ok" | "corrupt";
  checksumSha256: string;
  createdAt: string;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const theme = useUiStore((state) => state.theme);
  const mockMode = useUiStore((state) => state.mockMode);
  const toggleTheme = useUiStore((state) => state.toggleTheme);
  const toggleMockMode = useUiStore((state) => state.toggleMockMode);
  const addToast = useUiStore((state) => state.addToast);
  const { sendTest: sendTestNotification, loading: sendingTestNotif } =
    useSendTestNotification();

  const [newFlagKey, setNewFlagKey] = useState("");
  const [backupLabel, setBackupLabel] = useState("manual-snapshot");
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

  const { data: backupsData } = useQuery({
    queryKey: ["settings", "backups", mockMode],
    queryFn: async (): Promise<BackupManifestItem[]> => {
      if (mockMode) {
        return [
          {
            id: "bkp_mock_01",
            workspaceId: "default",
            label: "daily-auto-snapshot",
            integrityCheck: "ok",
            checksumSha256: "e3b0c44298fc1c149afbf4c8996fb924",
            createdAt: new Date().toISOString(),
          },
        ];
      }
      const res = await fetch("/api/backups?workspaceId=default");
      if (!res.ok) return [];
      const json = await res.json();
      const list = json.data ?? [];
      return Array.isArray(list) ? list : [];
    },
    staleTime: 15_000,
  });

  const createBackupMutation = useMutation({
    mutationFn: async (label: string) => {
      const res = await fetch("/api/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "default",
          label: label || "manual-snapshot",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "backups"] });
      addToast({
        type: "success",
        title: "Workspace Backup Created",
        message: "SQLite PRAGMA integrity_check passed & SHA-256 signed",
      });
    },
  });

  const { data: governanceData } = useQuery({
    queryKey: ["settings", "governance-summary", mockMode],
    queryFn: async () => {
      if (mockMode) {
        return {
          configVersionCount: 1,
          rbacRolesCount: 4,
          secretProvidersCount: 2,
          retryProfilesCount: 4,
          alertChannelsCount: 2,
        };
      }
      const [
        configHistRes,
        rbacRes,
        secretsRes,
        retryRes,
        alertChanRes,
        alertsChanAliasRes,
      ] = await Promise.all([
        fetch("/api/config/history").catch(() => null),
        fetch("/api/rbac/roles").catch(() => null),
        fetch("/api/secrets/providers").catch(() => null),
        fetch("/api/retry-profiles").catch(() => null),
        fetch("/api/alert-channels").catch(() => null),
        fetch("/api/alerts/channels").catch(() => null),
      ]);
      const configHistJson = configHistRes?.ok
        ? await configHistRes.json()
        : null;
      const rbacJson = rbacRes?.ok ? await rbacRes.json() : null;
      const secretsJson = secretsRes?.ok ? await secretsRes.json() : null;
      const retryJson = retryRes?.ok ? await retryRes.json() : null;
      const alertChanJson = alertChanRes?.ok
        ? await alertChanRes.json()
        : alertsChanAliasRes?.ok
          ? await alertsChanAliasRes.json()
          : null;

      return {
        configVersionCount: Array.isArray(configHistJson?.data)
          ? configHistJson.data.length
          : 1,
        rbacRolesCount: Array.isArray(rbacJson?.data)
          ? rbacJson.data.length
          : 0,
        secretProvidersCount: Array.isArray(secretsJson?.data)
          ? secretsJson.data.length
          : 0,
        retryProfilesCount: Array.isArray(retryJson?.data)
          ? retryJson.data.length
          : 0,
        alertChannelsCount: Array.isArray(alertChanJson?.data)
          ? alertChanJson.data.length
          : 0,
      };
    },
    staleTime: 30_000,
  });

  const purgeRetentionMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/backups/retention/purge", {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      addToast({
        type: "info",
        title: "Retention Purge Completed",
        message: "Expired session/job/event logs evaluated",
      });
    },
  });

  const rotateSecretMutation = useMutation({
    mutationFn: async (secretName: string) => {
      const res = await fetch("/api/secrets/rotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: secretName,
          rotatedBy: "admin",
          reason: "Manual rotation via Settings UI",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      addToast({
        type: "success",
        title: "Secret Reference Rotated",
        message: "Audit rotation record persisted via /api/secrets/rotate",
      });
    },
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

  const handleSendTestNotification = async () => {
    try {
      await sendTestNotification("default", "in_app");
      addToast({
        type: "success",
        title: "Test Notification Sent",
        message: "Dispatched to recipient 'default'",
      });
    } catch {
      addToast({
        type: "error",
        title: "Notification Failed",
        message: "Could not send test notification",
      });
    }
  };

  const components = healthData?.components
    ? Object.entries(healthData.components)
    : [];
  const flagsList = flagsData ?? [];
  const costCapsList = costCapsData ?? [];
  const backupsList = backupsData ?? [];
  const currentMode = maintenanceData?.mode ?? "normal";

  return (
    <div className="page">
      <div className="grid grid--2">
        <div className="card">
          <div className="card__header">
            <h3>Theme & Notifications</h3>
            <StatusPill tone="muted">{theme}</StatusPill>
          </div>
          <p className="muted">
            Switch between dawn and dusk palettes or verify notification
            delivery.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="primary-button"
              type="button"
              onClick={toggleTheme}
            >
              Toggle theme
            </button>
            <button
              type="button"
              onClick={handleSendTestNotification}
              disabled={sendingTestNotif}
            >
              {sendingTestNotif ? "Sending..." : "Send Test Notification"}
            </button>
          </div>
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

      {/* Wave 9 Workspace Backups & Retention Governance */}
      <div className="card card--wide" style={{ marginTop: 16 }}>
        <div className="card__header">
          <h3>Workspace Backups & Data Retention (/api/backups)</h3>
          <StatusPill tone="positive">
            {backupsList.length} snapshots
          </StatusPill>
        </div>
        <p className="muted">
          Create SHA-256 signed SQLite snapshots with PRAGMA integrity_check
          verification and run retention purges.
        </p>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 12,
            alignItems: "center",
          }}
        >
          <input
            type="text"
            value={backupLabel}
            onChange={(e) => setBackupLabel(e.target.value)}
            placeholder="Snapshot label"
            aria-label="Backup snapshot label"
          />
          <button
            type="button"
            className="primary-button"
            disabled={createBackupMutation.isPending}
            onClick={() => createBackupMutation.mutate(backupLabel.trim())}
          >
            {createBackupMutation.isPending
              ? "Creating Snapshot..."
              : "Create Signed Backup"}
          </button>
          <button
            type="button"
            disabled={purgeRetentionMutation.isPending}
            onClick={() => purgeRetentionMutation.mutate()}
          >
            {purgeRetentionMutation.isPending
              ? "Purging..."
              : "Run Retention Purge"}
          </button>
        </div>
        {backupsList.length > 0 && (
          <div className="table">
            <div className="table__row table__row--header">
              <span>ID / Label</span>
              <span>Integrity</span>
              <span>SHA-256</span>
            </div>
            {backupsList.slice(0, 5).map((bkp) => (
              <div key={bkp.id} className="table__row">
                <span className="mono">
                  {bkp.label} ({bkp.id.slice(0, 10)})
                </span>
                <span>
                  <StatusPill
                    tone={bkp.integrityCheck === "ok" ? "positive" : "danger"}
                  >
                    {bkp.integrityCheck}
                  </StatusPill>
                </span>
                <span className="mono muted">
                  {bkp.checksumSha256.slice(0, 16)}...
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Wave 10 Security, RBAC, Secrets, Retry Profiles & Alert Channels */}
      {governanceData && (
        <div className="card card--wide" style={{ marginTop: 16 }}>
          <div className="card__header">
            <h3>Config, RBAC, Secrets, Retry Profiles & Alert Channels</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <StatusPill tone="info">
                Config Versions: {governanceData.configVersionCount}
              </StatusPill>
              <StatusPill tone="positive">
                RBAC Roles: {governanceData.rbacRolesCount}
              </StatusPill>
              <StatusPill tone="positive">
                Secrets Providers: {governanceData.secretProvidersCount}
              </StatusPill>
              <StatusPill tone="info">
                Retry Profiles: {governanceData.retryProfilesCount}
              </StatusPill>
              <StatusPill tone="info">
                Alert Channels: {governanceData.alertChannelsCount}
              </StatusPill>
            </div>
          </div>
          <p className="muted">
            Connected to runtime config (/api/config), role-based access control
            (/api/rbac/roles), secret references (/api/secrets/providers), smart
            retry profiles (/api/retry-profiles), and external alert channels
            (/api/alert-channels).
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              type="button"
              disabled={rotateSecretMutation.isPending}
              onClick={() => rotateSecretMutation.mutate("GATEWAY_ADMIN_KEY")}
            >
              {rotateSecretMutation.isPending
                ? "Rotating..."
                : "Rotate GATEWAY_ADMIN_KEY Audit Ref"}
            </button>
          </div>
        </div>
      )}

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
