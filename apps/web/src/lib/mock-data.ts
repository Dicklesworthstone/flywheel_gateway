export const DEFAULT_MOCK_MODE = import.meta.env["VITE_MOCK_DATA"] === "true";

export const mockAgents = [
  { id: "agent-ax7", name: "Claude", status: "ready", model: "claude-3.7" },
  { id: "agent-bp2", name: "Codex", status: "executing", model: "gpt-5" },
  { id: "agent-km9", name: "Gemini", status: "paused", model: "gemini-2.0" },
];

export const mockBeads = [
  { id: "flywheel_gateway-r3p", title: "Web UI Shell", status: "in_progress" },
  { id: "flywheel_gateway-36m", title: "Checkpoint/Restore", status: "open" },
  { id: "flywheel_gateway-5nm", title: "File Reservations", status: "blocked" },
];

export const mockMetrics = {
  activeAgents: 2,
  queuedRuns: 4,
  wsLatencyMs: 128,
  lastAudit: "2m ago",
};
