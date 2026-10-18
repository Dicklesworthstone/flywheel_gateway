import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { StatusPill } from "../components/ui/StatusPill";
import {
  type OutputLine,
  VirtualizedOutput,
} from "../components/VirtualizedOutput";
import { useLogParser } from "../hooks/useLogParser";
import { useAllowMockFallback } from "../hooks/useMockFallback";
import { mockAgents } from "../lib/mock-data";
import { useUiStore } from "../stores/ui";

interface LiveAgentItem {
  agentId: string;
  state: string;
  driver: string;
  createdAt: string;
  lastActivityAt: string;
  model?: string;
  name?: string;
}

interface ApprovalItem {
  id: string;
  agentId: string;
  operation: string;
  description: string;
  status: string;
  priority?: string;
}

interface AgentHealthScoreItem {
  agentId: string;
  overallScore?: number;
  score?: number;
  status?: string;
  trend?: string;
}

interface DetectedCliSummary {
  agents?: Array<{
    name: string;
    available: boolean;
    version?: string;
    authenticated?: boolean;
  }>;
  summary?: {
    agentsAvailable?: number;
    agentsTotal?: number;
    toolsAvailable?: number;
    toolsTotal?: number;
  };
}

const statusTone: Record<string, "positive" | "warning" | "danger" | "muted"> =
  {
    ready: "positive",
    idle: "positive",
    working: "warning",
    executing: "warning",
    paused: "muted",
    failed: "danger",
    error: "danger",
    terminated: "muted",
  };

export function AgentsPage() {
  const queryClient = useQueryClient();
  const mockMode = useUiStore((state) => state.mockMode);
  const addToast = useUiStore((state) => state.addToast);
  const allowMockFallback = useAllowMockFallback();
  const {
    logs: parsedLogs,
    parse: parseRawLogs,
    clear: clearParsedLogs,
  } = useLogParser({ maxLogs: 1000 });

  const [driver, setDriver] = useState<"sdk" | "acp" | "tmux" | "ntm">("sdk");
  const [provider, setProvider] = useState<"claude" | "codex" | "gemini">(
    "claude",
  );
  const [model, setModel] = useState("claude-sonnet-4-20250514");
  const [workingDirectory, setWorkingDirectory] = useState("/data/projects");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [promptInput, setPromptInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    Array<{ id?: string; text?: string; snippet?: string }>
  >([]);
  const [inspectorStatus, setInspectorStatus] = useState<string | null>(null);

  const {
    data: apiAgents,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["agents", "list", mockMode],
    queryFn: async (): Promise<LiveAgentItem[]> => {
      if (mockMode) {
        return mockAgents.map((a) => ({
          agentId: a.id,
          name: a.name,
          state: a.status,
          driver: "sdk",
          model: a.model,
          createdAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
        }));
      }
      const res = await fetch("/api/agents");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      const list = json.data ?? json.agents ?? [];
      return Array.isArray(list) ? list : [];
    },
    staleTime: 10_000,
  });

  const { data: detectedClis } = useQuery({
    queryKey: ["agents", "detected", mockMode],
    queryFn: async (): Promise<DetectedCliSummary | null> => {
      if (mockMode) return null;
      const res = await fetch("/api/agents/detected");
      if (!res.ok) return null;
      const json = await res.json();
      return (json.data ?? json) as DetectedCliSummary;
    },
    staleTime: 30_000,
  });

  const { data: healthScores } = useQuery({
    queryKey: ["agents", "health-scores", mockMode],
    queryFn: async (): Promise<AgentHealthScoreItem[]> => {
      if (mockMode) return [];
      const res = await fetch("/api/agents/health-scores");
      if (!res.ok) return [];
      const json = await res.json();
      const list = json.data ?? json.scores ?? [];
      return Array.isArray(list) ? list : [];
    },
    staleTime: 15_000,
  });

  const { data: pendingApprovals } = useQuery({
    queryKey: ["agents", "pending-approvals", mockMode],
    queryFn: async (): Promise<ApprovalItem[]> => {
      if (mockMode) return [];
      const res = await fetch("/api/safety/approvals?status=pending");
      if (!res.ok) return [];
      const json = await res.json();
      const list = json.data ?? json.approvals ?? [];
      return Array.isArray(list) ? list : [];
    },
    staleTime: 10_000,
  });

  const agentsList: LiveAgentItem[] =
    apiAgents ??
    (allowMockFallback
      ? mockAgents.map((a) => ({
          agentId: a.id,
          name: a.name,
          state: a.status,
          driver: "sdk",
          model: a.model,
          createdAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
        }))
      : []);

  const activeAgentId = selectedAgentId ?? agentsList[0]?.agentId ?? "agent-1";
  const approvalsList = pendingApprovals ?? [];
  const healthScoreMap = new Map(
    (healthScores ?? []).map((s) => [
      s.agentId,
      s.overallScore ?? s.score ?? 100,
    ]),
  );

  const { data: agentOutputChunks, refetch: refetchAgentOutput } = useQuery({
    queryKey: ["agents", "output", activeAgentId, mockMode],
    queryFn: async (): Promise<OutputLine[]> => {
      if (mockMode) {
        return [
          {
            id: "mock-1",
            content: `[${activeAgentId}] Session initialized with driver ${driver}`,
            timestamp: Date.now() - 5000,
            type: "system",
          },
          {
            id: "mock-2",
            content: "Ready for instructions.",
            timestamp: Date.now() - 1000,
            type: "stdout",
          },
        ];
      }
      const res = await fetch(
        `/api/agents/${encodeURIComponent(activeAgentId)}/output?limit=100`,
      );
      if (!res.ok) return [];
      const json = await res.json();
      const raw = json.data ?? json.chunks ?? [];
      if (!Array.isArray(raw)) return [];
      return raw.map(
        (
          chunk: {
            id?: string;
            seq?: number;
            content?: string;
            text?: string;
            data?: string;
            timestamp?: string | number;
            type?: string;
            stream?: string;
          },
          idx: number,
        ) => ({
          id: String(chunk.id ?? chunk.seq ?? `line-${idx}`),
          content: String(chunk.content ?? chunk.text ?? chunk.data ?? ""),
          timestamp:
            typeof chunk.timestamp === "number"
              ? chunk.timestamp
              : chunk.timestamp
                ? new Date(chunk.timestamp).getTime()
                : Date.now(),
          type: (chunk.type === "stderr" || chunk.stream === "stderr"
            ? "stderr"
            : chunk.type === "system"
              ? "system"
              : chunk.type === "tool"
                ? "tool"
                : chunk.type === "thinking"
                  ? "thinking"
                  : "stdout") as OutputLine["type"],
        }),
      );
    },
    staleTime: 5_000,
  });

  useEffect(() => {
    clearParsedLogs();
    if (agentOutputChunks && agentOutputChunks.length > 0) {
      void parseRawLogs(
        agentOutputChunks.map((line) => ({
          id: line.id,
          content: line.content,
          timestamp: line.timestamp,
          type: line.type,
        })),
      );
    }
  }, [agentOutputChunks, clearParsedLogs, parseRawLogs]);

  const spawnMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workingDirectory,
          driver,
          provider,
          model,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });

  const terminateMutation = useMutation({
    mutationFn: async (agentId: string) => {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(`Failed to terminate agent (${res.status})`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (params: { agentId: string; content: string }) => {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(params.agentId)}/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "user",
            content: params.content,
          }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: (_body, vars) => {
      setPromptInput("");
      setInspectorStatus(`Sent prompt to ${vars.agentId}`);
      void refetchAgentOutput();
    },
  });

  const interruptMutation = useMutation({
    mutationFn: async (agentId: string) => {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/interrupt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signal: "SIGINT" }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: (_body, agentId) => {
      setInspectorStatus(`Sent SIGINT interrupt to ${agentId}`);
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });

  const compactCheckpointsMutation = useMutation({
    mutationFn: async (agentId: string) => {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(agentId)}/checkpoints/compact`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dryRun: false }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: (body, agentId) => {
      const data = body?.data ?? body;
      setInspectorStatus(
        `Compacted checkpoints for ${agentId}: retained ${data?.retainedCount ?? 0}, pruned ${data?.deletedCount ?? 0}`,
      );
      addToast({
        type: "success",
        title: "Checkpoints Compacted",
        message: `Agent ${agentId} checkpoints compacted`,
      });
    },
  });

  const rotateContextMutation = useMutation({
    mutationFn: async (agentId: string) => {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(agentId)}/context/rotate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: "Manual context rotation from Agents UI",
          }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: (_body, agentId) => {
      setInspectorStatus(
        `Rotated context window for session ${agentId} with handoff summary`,
      );
      addToast({
        type: "info",
        title: "Context Rotated",
        message: `Generated handoff summary for ${agentId}`,
      });
    },
  });

  const decideApprovalMutation = useMutation({
    mutationFn: async (params: {
      id: string;
      decision: "approved" | "denied";
    }) => {
      const res = await fetch(
        `/api/safety/approvals/${encodeURIComponent(params.id)}/decide`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision: params.decision,
            decidedBy: "operator-ui",
            reason: `Decided via Agents UI (${params.decision})`,
          }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["agents", "pending-approvals"],
      });
    },
  });

  async function handleOutputSearch() {
    if (!searchQuery.trim()) return;
    try {
      const params = new URLSearchParams({ q: searchQuery.trim() });
      if (selectedAgentId) params.set("agentId", selectedAgentId);
      const res = await fetch(`/api/search?${params.toString()}`);
      if (!res.ok) {
        setSearchResults([]);
        return;
      }
      const json = await res.json();
      const hits = json.data?.hits ?? json.data ?? json.results ?? [];
      setSearchResults(Array.isArray(hits) ? hits : []);
    } catch {
      setSearchResults([]);
    }
  }

  const outputLines: OutputLine[] =
    parsedLogs.length > 0
      ? parsedLogs.map((l) => ({
          id: l.id,
          content: l.content,
          timestamp: l.timestamp,
          type: l.type,
        }))
      : (agentOutputChunks ?? []);

  return (
    <div className="page">
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__header">
          <h3>Spawn Agent</h3>
          <StatusPill tone="muted">Multi-Driver</StatusPill>
        </div>
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <select
            value={driver}
            onChange={(e) =>
              setDriver(e.target.value as "sdk" | "acp" | "tmux" | "ntm")
            }
            aria-label="Agent driver"
          >
            <option value="sdk">SDK Driver</option>
            <option value="acp">ACP Driver</option>
            <option value="tmux">Tmux Driver</option>
            <option value="ntm">NTM Driver</option>
          </select>
          <select
            value={provider}
            onChange={(e) =>
              setProvider(e.target.value as "claude" | "codex" | "gemini")
            }
            aria-label="Model provider"
          >
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
            <option value="gemini">Gemini</option>
          </select>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Model name"
            aria-label="Model name"
          />
          <input
            type="text"
            value={workingDirectory}
            onChange={(e) => setWorkingDirectory(e.target.value)}
            placeholder="Working directory"
            aria-label="Working directory"
          />
          <button
            type="button"
            className="primary-button"
            disabled={spawnMutation.isPending || mockMode}
            onClick={() => spawnMutation.mutate()}
          >
            {spawnMutation.isPending ? "Spawning..." : "Spawn Agent"}
          </button>
        </div>
        {spawnMutation.error && (
          <p className="error-text">{(spawnMutation.error as Error).message}</p>
        )}
      </div>

      <div className="card">
        <div className="card__header">
          <h3>Agents</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {detectedClis?.summary && (
              <StatusPill tone="positive">
                {detectedClis.summary.agentsAvailable ?? 0}/
                {detectedClis.summary.agentsTotal ?? 0} CLIs detected
              </StatusPill>
            )}
            <StatusPill tone="muted">{agentsList.length} total</StatusPill>
          </div>
        </div>
        {isLoading && <p className="muted">Loading agents...</p>}
        {error && !allowMockFallback && (
          <p className="error-text">{(error as Error).message}</p>
        )}
        <div className="table">
          <div className="table__row table__row--header">
            <span>Name / Driver</span>
            <span>Status</span>
            <span>Model</span>
            <span>ID / Health</span>
            <span>Actions</span>
          </div>
          {agentsList.map((agent) => {
            const score = healthScoreMap.get(agent.agentId);
            return (
              <div key={agent.agentId} className="table__row">
                <span>{agent.name ?? `${agent.driver} agent`}</span>
                <StatusPill
                  tone={statusTone[agent.state.toLowerCase()] ?? "muted"}
                >
                  {agent.state}
                </StatusPill>
                <span>{agent.model ?? agent.driver}</span>
                <span className="mono">
                  {agent.agentId}
                  {score !== undefined ? ` (${score}%)` : ""}
                </span>
                <span style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setSelectedAgentId(agent.agentId)}
                  >
                    Inspect
                  </button>
                  {!mockMode && (
                    <button
                      type="button"
                      onClick={() => terminateMutation.mutate(agent.agentId)}
                      disabled={terminateMutation.isPending}
                    >
                      Terminate
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Wave 9 Live Agent Output Stream (VirtualizedOutput + useLogParser) & Interactive Controls */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__header">
          <h3>Live Agent Console & Output Stream</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <StatusPill tone="positive">{activeAgentId}</StatusPill>
            <button
              type="button"
              onClick={() => void refetchAgentOutput()}
              style={{ fontSize: 12 }}
            >
              Refresh Output
            </button>
            <button
              type="button"
              onClick={() => interruptMutation.mutate(activeAgentId)}
              disabled={interruptMutation.isPending || mockMode}
              style={{ fontSize: 12 }}
            >
              Interrupt (SIGINT)
            </button>
          </div>
        </div>
        <div
          style={{
            border: "1px solid var(--border, #2a2f3a)",
            borderRadius: 8,
            overflow: "hidden",
            marginBottom: 12,
            background: "#0d1117",
          }}
        >
          <VirtualizedOutput
            lines={outputLines}
            height={200}
            autoScroll={true}
          />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            placeholder={`Send prompt or instruction to ${activeAgentId}...`}
            aria-label="Send prompt to agent"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="primary-button"
            disabled={
              !promptInput.trim() || sendMessageMutation.isPending || mockMode
            }
            onClick={() =>
              sendMessageMutation.mutate({
                agentId: activeAgentId,
                content: promptInput.trim(),
              })
            }
          >
            {sendMessageMutation.isPending ? "Sending..." : "Send Prompt"}
          </button>
        </div>
      </div>

      {/* Wave 7 Session Lifecycle Inspector: Checkpoints, Context Rotation, Output Search & Approvals */}
      <div className="grid grid--2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card__header">
            <h3>Session Lifecycle & Compaction</h3>
            <StatusPill tone="positive">{activeAgentId}</StatusPill>
          </div>
          <p className="muted">
            Manage checkpoint retention compaction, context window rotation, and
            full-text output search for the selected agent.
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
              onClick={() => compactCheckpointsMutation.mutate(activeAgentId)}
              disabled={compactCheckpointsMutation.isPending}
            >
              Compact Checkpoints
            </button>
            <button
              type="button"
              onClick={() => rotateContextMutation.mutate(activeAgentId)}
              disabled={rotateContextMutation.isPending}
            >
              Rotate Context Window
            </button>
          </div>
          {inspectorStatus && <p className="mono">{inspectorStatus}</p>}
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginTop: 8,
            }}
          >
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search agent output (FTS5)..."
              aria-label="Search agent output"
            />
            <button type="button" onClick={() => void handleOutputSearch()}>
              Search Output
            </button>
          </div>
          {searchResults.length > 0 && (
            <p className="muted" style={{ marginTop: 8 }}>
              Found {searchResults.length} matching output chunks.
            </p>
          )}
        </div>

        <div className="card">
          <div className="card__header">
            <h3>Pending Safety Approvals</h3>
            <StatusPill
              tone={approvalsList.length > 0 ? "warning" : "positive"}
            >
              {approvalsList.length} pending
            </StatusPill>
          </div>
          <p className="muted">
            Approve or deny sensitive agent operations gated by safety rules.
          </p>
          {approvalsList.length === 0 ? (
            <p className="muted">No pending approval requests in queue.</p>
          ) : (
            <div className="table">
              <div className="table__row table__row--header">
                <span>Agent</span>
                <span>Operation</span>
                <span>Decision</span>
              </div>
              {approvalsList.map((req) => (
                <div key={req.id} className="table__row">
                  <span className="mono">{req.agentId}</span>
                  <span>{req.operation}</span>
                  <span style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() =>
                        decideApprovalMutation.mutate({
                          id: req.id,
                          decision: "approved",
                        })
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        decideApprovalMutation.mutate({
                          id: req.id,
                          decision: "denied",
                        })
                      }
                    >
                      Deny
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
