import { StatusPill } from "../components/ui/StatusPill";
import { mockAgents, mockBeads, mockMetrics } from "../lib/mock-data";

export function DashboardPage() {
  const readyAgents = mockAgents.filter(
    (agent) => agent.status === "ready",
  ).length;
  const executingAgents = mockAgents.filter(
    (agent) => agent.status === "executing",
  ).length;

  return (
    <div className="page">
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
            <StatusPill tone="warning">{mockBeads.length} tracked</StatusPill>
          </div>
          <p className="metric">{mockMetrics.queuedRuns}</p>
          <p className="muted">Queued orchestration steps.</p>
        </div>
      </section>

      <section className="grid grid--3">
        <div className="card card--compact">
          <div className="eyebrow">WebSocket</div>
          <h4>{mockMetrics.wsLatencyMs}ms</h4>
          <p className="muted">Median latency (mocked).</p>
        </div>
        <div className="card card--compact">
          <div className="eyebrow">Audit</div>
          <h4>{mockMetrics.lastAudit}</h4>
          <p className="muted">Last activity sweep.</p>
        </div>
        <div className="card card--compact">
          <div className="eyebrow">Coverage</div>
          <h4>Mock-first</h4>
          <p className="muted">UI running without backend.</p>
        </div>
      </section>
    </div>
  );
}
