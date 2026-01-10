import { StatusPill } from "../components/ui/StatusPill";
import { mockAgents } from "../lib/mock-data";

const statusTone: Record<string, "positive" | "warning" | "danger" | "muted"> =
  {
    ready: "positive",
    executing: "warning",
    paused: "muted",
    failed: "danger",
  };

export function AgentsPage() {
  return (
    <div className="page">
      <div className="card">
        <div className="card__header">
          <h3>Agents</h3>
          <StatusPill tone="muted">{mockAgents.length} total</StatusPill>
        </div>
        <div className="table">
          <div className="table__row table__row--header">
            <span>Name</span>
            <span>Status</span>
            <span>Model</span>
            <span>ID</span>
          </div>
          {mockAgents.map((agent) => (
            <div key={agent.id} className="table__row">
              <span>{agent.name}</span>
              <StatusPill tone={statusTone[agent.status] ?? "muted"}>
                {agent.status}
              </StatusPill>
              <span>{agent.model}</span>
              <span className="mono">{agent.id}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
