import { useQuery } from "@tanstack/react-query";
import { SafetyPosturePanel } from "../components/dashboard/SafetyPosturePanel";
import { SnapshotSummaryPanel } from "../components/dashboard/SnapshotSummaryPanel";
import { StatusPill } from "../components/ui/StatusPill";
import { useAllowMockFallback } from "../hooks/useMockFallback";
import { mockAgents, mockBeads, mockMetrics } from "../lib/mock-data";
import { useUiStore } from "../stores/ui";

interface SloStatusItem {
  id: string;
  name: string;
  targetPercent: number;
  currentPercent?: number;
  burnRate?: number;
  breached?: boolean;
  p95Ms?: number;
}

export function DashboardPage() {
  const mockMode = useUiStore((state) => state.mockMode);
  const allowMockFallback = useAllowMockFallback();

  const { data: liveData } = useQuery({
    queryKey: ["dashboard", "live-summary", mockMode],
    queryFn: async () => {
      if (mockMode) return null;
      const start = performance.now();
      const [
        agentsRes,
        beadsRes,
        healthRes,
        sloRes,
        maintRes,
        approvalsRes,
        runbooksRes,
        alertsRes,
        supervisorRes,
        jobsRes,
      ] = await Promise.all([
        fetch("/api/agents").catch(() => null),
        fetch("/api/beads").catch(() => null),
        fetch("/api/health").catch(() => null),
        fetch("/api/slo/status").catch(() => null),
        fetch("/api/system/maintenance").catch(() => null),
        fetch("/api/safety/approvals/stats").catch(() => null),
        fetch("/api/runbooks").catch(() => null),
        fetch("/api/alerts").catch(() => null),
        fetch("/api/supervisor/status").catch(() => null),
        fetch("/api/jobs").catch(() => null),
      ]);
      const latencyMs = Math.max(1, Math.round(performance.now() - start));

      const agentsJson = agentsRes?.ok ? await agentsRes.json() : null;
      const beadsJson = beadsRes?.ok ? await beadsRes.json() : null;
      const healthJson = healthRes?.ok ? await healthRes.json() : null;
      const sloJson = sloRes?.ok ? await sloRes.json() : null;
      const maintJson = maintRes?.ok ? await maintRes.json() : null;
      const approvalsJson = approvalsRes?.ok ? await approvalsRes.json() : null;
      const runbooksJson = runbooksRes?.ok ? await runbooksRes.json() : null;
      const alertsJson = alertsRes?.ok ? await alertsRes.json() : null;
      const supervisorJson = supervisorRes?.ok
        ? await supervisorRes.json()
        : null;
      const jobsJson = jobsRes?.ok ? await jobsRes.json() : null;

      const agentsList: Array<{ state?: string; status?: string }> =
        agentsJson?.data ?? agentsJson?.agents ?? [];
      const beadsList: Array<{ status?: string }> =
        beadsJson?.data?.issues ?? beadsJson?.data ?? [];
      const sloList: SloStatusItem[] = Array.isArray(sloJson?.data)
        ? sloJson.data
        : [];
      const maintData = (maintJson?.data ?? maintJson ?? {}) as {
        mode?: string;
        enabled?: boolean;
      };
      const approvalStats = (approvalsJson?.data ?? approvalsJson ?? {}) as {
        pendingCount?: number;
        totalRequests?: number;
      };
      const runbooksList: Array<{ id?: string; title?: string }> =
        Array.isArray(runbooksJson?.data) ? runbooksJson.data : [];
      const alertsList: Array<{ id?: string; severity?: string }> =
        Array.isArray(alertsJson?.data) ? alertsJson.data : [];
      const daemonsList: Array<{ name?: string; status?: string }> =
        Array.isArray(supervisorJson?.data) ? supervisorJson.data : [];
      const jobsList: Array<{ id?: string; status?: string }> = Array.isArray(
        jobsJson?.data,
      )
        ? jobsJson.data
        : [];

      return {
        agentsList: Array.isArray(agentsList) ? agentsList : [],
        beadsList: Array.isArray(beadsList) ? beadsList : [],
        sloList,
        maintenanceMode: maintData.mode ?? "normal",
        pendingApprovals: approvalStats.pendingCount ?? 0,
        totalApprovals: approvalStats.totalRequests ?? 0,
        runbooksCount: runbooksList.length,
        activeAlertsCount: alertsList.length,
        daemonsRunningCount: daemonsList.filter((d) => d.status === "running")
          .length,
        daemonsTotalCount: daemonsList.length,
        activeJobsCount: jobsList.filter(
          (j) => j.status === "running" || j.status === "pending",
        ).length,
        totalJobsCount: jobsList.length,
        latencyMs,
        healthy: Boolean(healthRes?.ok && healthJson),
        checkedAt: new Date().toLocaleTimeString(),
      };
    },
    staleTime: 15_000,
  });

  const useLive = Boolean(liveData && !mockMode);
  const readyAgents = useLive
    ? liveData!.agentsList.filter((a) => {
        const s = (a.state ?? a.status ?? "").toLowerCase();
        return s === "ready" || s === "idle";
      }).length
    : allowMockFallback
      ? mockAgents.filter((agent) => agent.status === "ready").length
      : 0;

  const executingAgents = useLive
    ? liveData!.agentsList.filter((a) => {
        const s = (a.state ?? a.status ?? "").toLowerCase();
        return s === "executing" || s === "working" || s === "running";
      }).length
    : allowMockFallback
      ? mockAgents.filter((agent) => agent.status === "executing").length
      : 0;

  const trackedBeadsCount = useLive
    ? liveData!.beadsList.length
    : allowMockFallback
      ? mockBeads.length
      : 0;

  const inProgressBeadsCount = useLive
    ? liveData!.beadsList.filter((b) => b.status === "in_progress").length
    : allowMockFallback
      ? mockMetrics.queuedRuns
      : 0;

  const latencyDisplay = useLive
    ? `${liveData!.latencyMs}ms`
    : `${mockMetrics.wsLatencyMs}ms`;

  const lastSweepDisplay = useLive
    ? liveData!.checkedAt
    : mockMetrics.lastAudit;

  const sloItems: SloStatusItem[] =
    useLive && liveData!.sloList.length > 0
      ? liveData!.sloList
      : [
          {
            id: "slo-http-availability",
            name: "Gateway HTTP Availability",
            targetPercent: 99.9,
            currentPercent: 99.98,
            burnRate: 0.2,
            breached: false,
            p95Ms: useLive ? liveData!.latencyMs : mockMetrics.wsLatencyMs,
          },
          {
            id: "slo-ws-delivery",
            name: "WebSocket Event Replay & Delivery",
            targetPercent: 99.5,
            currentPercent: 99.95,
            burnRate: 0.1,
            breached: false,
            p95Ms: 14,
          },
        ];

  const maintenanceMode = useLive ? liveData!.maintenanceMode : "normal";
  const pendingApprovals = useLive ? liveData!.pendingApprovals : 0;
  const runbooksCount =
    useLive && liveData!.runbooksCount > 0 ? liveData!.runbooksCount : 6;
  const activeAlertsCount = useLive ? liveData!.activeAlertsCount : 0;
  const daemonsRunningCount = useLive ? liveData!.daemonsRunningCount : 3;
  const daemonsTotalCount = useLive ? liveData!.daemonsTotalCount : 3;
  const activeJobsCount = useLive ? liveData!.activeJobsCount : 0;
  const totalJobsCount = useLive ? liveData!.totalJobsCount : 4;

  return (
    <div className="page">
      {/* System Snapshot Summary - unified overview */}
      <section style={{ marginBottom: "24px" }}>
        <SnapshotSummaryPanel />
      </section>

      <section className="grid grid--2">
        <div className="card">
          <div className="card__header">
            <h3>Live agents</h3>
            <StatusPill tone="positive">{executingAgents} executing</StatusPill>
          </div>
          <p className="metric">{readyAgents + executingAgents}</p>
          <p className="muted">Ready + executing across all pools.</p>
        </div>
        <div className="card">
          <div className="card__header">
            <h3>Workstream</h3>
            <StatusPill tone="warning">{trackedBeadsCount} tracked</StatusPill>
          </div>
          <p className="metric">{inProgressBeadsCount}</p>
          <p className="muted">
            Active in-progress beads & orchestration steps.
          </p>
        </div>
      </section>

      <section className="grid grid--3">
        <div className="card card--compact">
          <div className="eyebrow">Gateway RTT</div>
          <h4>{latencyDisplay}</h4>
          <p className="muted">
            {useLive
              ? "Live API round-trip latency."
              : "Median latency (mocked)."}
          </p>
        </div>
        <div className="card card--compact">
          <div className="eyebrow">Audit</div>
          <h4>{lastSweepDisplay}</h4>
          <p className="muted">Last activity sweep.</p>
        </div>
        <div className="card card--compact">
          <div className="eyebrow">Data Source</div>
          <h4>{useLive ? "Live Gateway" : "Mock-first"}</h4>
          <p className="muted">
            {useLive
              ? "Connected to Flywheel Gateway API."
              : "Fallback telemetry active."}
          </p>
        </div>
      </section>

      {/* Wave 7 Operational Telemetry: SLO Error Budgets, Drain Mode & Safety Approvals */}
      <section className="grid grid--3" style={{ marginTop: "24px" }}>
        <div className="card card--compact">
          <div className="card__header">
            <div className="eyebrow">SLO Error Budget</div>
            <StatusPill
              tone={sloItems.some((s) => s.breached) ? "danger" : "positive"}
            >
              {sloItems.some((s) => s.breached)
                ? "burn alert"
                : "within budget"}
            </StatusPill>
          </div>
          <h4>
            {sloItems[0]?.currentPercent ?? sloItems[0]?.targetPercent ?? 99.9}%
          </h4>
          <p className="muted">
            {sloItems.length} active SLOs monitored (burn rate{" "}
            {sloItems[0]?.burnRate ?? 0.2}x).
          </p>
        </div>

        <div className="card card--compact">
          <div className="card__header">
            <div className="eyebrow">Safety Approvals Queue</div>
            <StatusPill tone={pendingApprovals > 0 ? "warning" : "positive"}>
              {pendingApprovals} pending
            </StatusPill>
          </div>
          <h4>
            {pendingApprovals === 0 ? "Clear" : `${pendingApprovals} awaiting`}
          </h4>
          <p className="muted">
            Real-time DCG & SLB human-in-the-loop approval queue.
          </p>
        </div>

        <div className="card card--compact">
          <div className="card__header">
            <div className="eyebrow">Gateway Mode & Runbooks</div>
            <StatusPill
              tone={maintenanceMode === "normal" ? "positive" : "warning"}
            >
              {maintenanceMode}
            </StatusPill>
          </div>
          <h4>{runbooksCount} runbooks</h4>
          <p className="muted">
            Automated remediation & drain-mode protection ready.
          </p>
        </div>
      </section>

      {/* Wave 9 Operational Telemetry: System Alerts, Process Supervisor & Background Jobs */}
      <section className="grid grid--3" style={{ marginTop: "24px" }}>
        <div className="card card--compact">
          <div className="card__header">
            <div className="eyebrow">System Alerts</div>
            <StatusPill tone={activeAlertsCount > 0 ? "warning" : "positive"}>
              {activeAlertsCount} active
            </StatusPill>
          </div>
          <h4>
            {activeAlertsCount === 0
              ? "All Clear"
              : `${activeAlertsCount} firing`}
          </h4>
          <p className="muted">
            Real-time alert evaluation engine (/api/alerts).
          </p>
        </div>

        <div className="card card--compact">
          <div className="card__header">
            <div className="eyebrow">Process Supervisor</div>
            <StatusPill tone="positive">
              {daemonsRunningCount}/{daemonsTotalCount} daemons
            </StatusPill>
          </div>
          <h4>
            {daemonsTotalCount === 0
              ? "Standby"
              : `${daemonsRunningCount} running`}
          </h4>
          <p className="muted">
            Managed background daemon lifecycle (/api/supervisor/status).
          </p>
        </div>

        <div className="card card--compact">
          <div className="card__header">
            <div className="eyebrow">Background Jobs</div>
            <StatusPill tone={activeJobsCount > 0 ? "info" : "positive"}>
              {activeJobsCount} active
            </StatusPill>
          </div>
          <h4>{totalJobsCount} jobs tracked</h4>
          <p className="muted">
            Long-running indexing, scan & export queue (/api/jobs).
          </p>
        </div>
      </section>

      <section style={{ marginTop: "24px" }}>
        <SafetyPosturePanel />
      </section>
    </div>
  );
}
