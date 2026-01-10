import { StatusPill } from "../components/ui/StatusPill";
import { mockBeads } from "../lib/mock-data";

const statusTone: Record<string, "positive" | "warning" | "danger" | "muted"> =
  {
    open: "muted",
    in_progress: "warning",
    blocked: "danger",
    closed: "positive",
  };

export function BeadsPage() {
  return (
    <div className="page">
      <div className="card">
        <div className="card__header">
          <h3>Beads</h3>
          <StatusPill tone="muted">{mockBeads.length} tracked</StatusPill>
        </div>
        <div className="table">
          <div className="table__row table__row--header">
            <span>Bead</span>
            <span>Status</span>
            <span>Title</span>
          </div>
          {mockBeads.map((bead) => (
            <div key={bead.id} className="table__row">
              <span className="mono">{bead.id}</span>
              <StatusPill tone={statusTone[bead.status] ?? "muted"}>
                {bead.status.replace("_", " ")}
              </StatusPill>
              <span>{bead.title}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
