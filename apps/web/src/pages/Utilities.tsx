import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { StatusPill } from "../components/ui/StatusPill";

// ============================================================================
// Types
// ============================================================================

interface UtilityInfo {
  name: string;
  displayName: string;
  description: string;
  installed: boolean;
  version: string | null;
  expectedVersion: string;
  installCommand?: string;
}

interface DoctorResult {
  utilities: UtilityInfo[];
  allHealthy: boolean;
  installedCount: number;
  totalCount: number;
}

interface GiilResult {
  success: boolean;
  path?: string;
  width?: number;
  height?: number;
  captureMethod?: string;
  error?: string;
}

interface CsctfResult {
  success: boolean;
  markdownPath?: string;
  htmlPath?: string;
  title?: string;
  messageCount?: number;
  error?: string;
}

interface XfSearchResult {
  results: Array<{
    type: string;
    text: string;
    created_at?: string;
    score?: number;
  }>;
  total: number;
  query: string;
}

interface PtScanResult {
  processes: Array<{
    pid: number;
    name: string;
    cpu?: number;
    cpu_percent?: number;
    memory?: number;
    memory_rss_mb?: number;
    runtime?: string;
    runtime_seconds?: number;
    score: number;
    user: string;
  }>;
  total?: number;
  suspicious_count?: number;
}

interface JfpPromptItem {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  difficulty: string;
  estimatedTokens: number;
  content: string;
}

interface JfpPromptsResult {
  available: boolean;
  prompts: JfpPromptItem[];
  total: number;
  message?: string;
}

interface AprStatusResult {
  available: boolean;
  configured: boolean;
  default_workflow?: string;
  workflow_count?: number;
  workflows: string[];
  oracle_available?: boolean;
  oracle_method?: string;
  message?: string;
}

interface ToonParseResponse {
  detectedFormat: string;
  isToon: boolean;
  sourceFormat: string;
  envelopeCompliant: boolean;
  data: unknown;
}

// ============================================================================
// API Helpers
// ============================================================================

const API_BASE = "/api";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error?.message ?? body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ============================================================================
// Components
// ============================================================================

function UtilityCard({ util }: { util: UtilityInfo }) {
  const queryClient = useQueryClient();

  const installMutation = useMutation({
    mutationFn: () =>
      fetchJson(`/utilities/${util.name}/install`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["utilities"] });
    },
  });

  return (
    <div className="card">
      <div className="card__header">
        <h3>{util.displayName}</h3>
        <StatusPill tone={util.installed ? "positive" : "warning"}>
          {util.installed ? (util.version ?? "installed") : "missing"}
        </StatusPill>
      </div>
      <p className="muted">{util.description}</p>
      {!util.installed && util.installCommand && (
        <button
          className="primary-button"
          type="button"
          onClick={() => installMutation.mutate()}
          disabled={installMutation.isPending}
        >
          {installMutation.isPending ? "Installing..." : "Install"}
        </button>
      )}
      {installMutation.isError && (
        <p className="error-text">{(installMutation.error as Error).message}</p>
      )}
    </div>
  );
}

function GiilPanel() {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<"file" | "json" | "base64">("json");

  const mutation = useMutation({
    mutationFn: () =>
      fetchJson<{ data: GiilResult }>("/utilities/giil/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, format }),
      }),
  });

  return (
    <div className="card card--wide">
      <h3>Image Download (giil)</h3>
      <p className="muted">
        Download full-resolution images from iCloud, Dropbox, Google Photos, or
        Google Drive share links.
      </p>
      <div className="form-row">
        <input
          type="url"
          className="text-input"
          placeholder="https://share.icloud.com/photos/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <select
          className="select-input"
          value={format}
          onChange={(e) =>
            setFormat(e.target.value as "file" | "json" | "base64")
          }
        >
          <option value="json">JSON (metadata + path)</option>
          <option value="file">File (download only)</option>
          <option value="base64">Base64 (for API)</option>
        </select>
        <button
          className="primary-button"
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !url}
        >
          {mutation.isPending ? "Downloading..." : "Download"}
        </button>
      </div>
      {mutation.isSuccess && mutation.data.data.success !== false && (
        <div className="result-box">
          <p>
            Downloaded: <code>{mutation.data.data.path}</code>
          </p>
          {mutation.data.data.width && (
            <p className="muted">
              {mutation.data.data.width}x{mutation.data.data.height} via{" "}
              {mutation.data.data.captureMethod}
            </p>
          )}
        </div>
      )}
      {mutation.isError && (
        <p className="error-text">{(mutation.error as Error).message}</p>
      )}
    </div>
  );
}

function CsctfPanel() {
  const [url, setUrl] = useState("");
  const [formats, setFormats] = useState<string[]>(["md"]);

  const mutation = useMutation({
    mutationFn: () =>
      fetchJson<{ data: CsctfResult }>("/utilities/csctf/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, formats }),
      }),
  });

  const toggleFormat = useCallback((fmt: string) => {
    setFormats((prev) =>
      prev.includes(fmt) ? prev.filter((f) => f !== fmt) : [...prev, fmt],
    );
  }, []);

  return (
    <div className="card card--wide">
      <h3>Chat Transcript Export (csctf)</h3>
      <p className="muted">
        Convert AI chat share links (ChatGPT, Gemini, Grok, Claude) to clean
        Markdown and HTML.
      </p>
      <div className="form-row">
        <input
          type="url"
          className="text-input"
          placeholder="https://chatgpt.com/share/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={formats.includes("md")}
            onChange={() => toggleFormat("md")}
          />
          Markdown
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={formats.includes("html")}
            onChange={() => toggleFormat("html")}
          />
          HTML
        </label>
        <button
          className="primary-button"
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !url || formats.length === 0}
        >
          {mutation.isPending ? "Converting..." : "Convert"}
        </button>
      </div>
      {mutation.isSuccess && mutation.data.data.success !== false && (
        <div className="result-box">
          {mutation.data.data.title && <p>Title: {mutation.data.data.title}</p>}
          {mutation.data.data.messageCount !== null &&
            mutation.data.data.messageCount !== undefined && (
              <p className="muted">
                {mutation.data.data.messageCount} messages exported
              </p>
            )}
          {mutation.data.data.markdownPath && (
            <p>
              Markdown: <code>{mutation.data.data.markdownPath}</code>
            </p>
          )}
          {mutation.data.data.htmlPath && (
            <p>
              HTML: <code>{mutation.data.data.htmlPath}</code>
            </p>
          )}
        </div>
      )}
      {mutation.isError && (
        <p className="error-text">{(mutation.error as Error).message}</p>
      )}
    </div>
  );
}

function XfPanel() {
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<string[]>(["all"]);
  const [limit, setLimit] = useState(20);

  const mutation = useMutation({
    mutationFn: () =>
      fetchJson<{ data: XfSearchResult }>("/xf/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, types, limit }),
      }),
  });

  return (
    <div className="card card--wide">
      <h3>X Archive Search (xf)</h3>
      <p className="muted">
        Search tweets, DMs, likes, and Grok conversations from X data archives.
      </p>
      <div className="form-row">
        <input
          type="text"
          className="text-input"
          placeholder="Search query..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="select-input"
          value={types[0]}
          onChange={(e) => setTypes([e.target.value])}
        >
          <option value="all">All types</option>
          <option value="tweet">Tweets</option>
          <option value="like">Likes</option>
          <option value="dm">DMs</option>
          <option value="grok">Grok</option>
        </select>
        <input
          type="number"
          className="text-input text-input--small"
          min={1}
          max={100}
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          style={{ width: "80px" }}
        />
        <button
          className="primary-button"
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !query}
        >
          {mutation.isPending ? "Searching..." : "Search"}
        </button>
      </div>
      {mutation.isSuccess && (
        <div className="result-box">
          <p className="muted">
            {mutation.data.data.total} results for "{mutation.data.data.query}"
          </p>
          <div className="result-list">
            {mutation.data.data.results.map((r) => (
              <div
                key={`${r.type}:${r.created_at ?? "unknown"}:${r.text.slice(0, 24)}`}
                className="result-item"
              >
                <StatusPill tone="muted">{r.type}</StatusPill>
                <span className="result-text">{r.text.slice(0, 200)}</span>
                {r.created_at && (
                  <span className="muted result-date">
                    {new Date(r.created_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {mutation.isError && (
        <p className="error-text">{(mutation.error as Error).message}</p>
      )}
    </div>
  );
}

function PtPanel() {
  const mutation = useMutation({
    mutationFn: () =>
      fetchJson<{ data: PtScanResult }>("/pt/scan", { method: "POST" }),
  });

  const totalSuspicious =
    mutation.data?.data.suspicious_count ?? mutation.data?.data.total ?? 0;

  return (
    <div className="card card--wide">
      <h3>Process Triage (pt)</h3>
      <p className="muted">
        Scan for stuck, zombie, or resource-hungry processes. Identify orphaned
        agent sessions.
      </p>
      <div className="form-row">
        <button
          className="primary-button"
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Scanning..." : "Scan processes"}
        </button>
      </div>
      {mutation.isSuccess && (
        <div className="result-box">
          <p className="muted">{totalSuspicious} suspicious processes found</p>
          {mutation.data.data.processes.length > 0 && (
            <table className="mini-table">
              <thead>
                <tr>
                  <th>PID</th>
                  <th>Name</th>
                  <th>CPU%</th>
                  <th>Mem MB</th>
                  <th>Runtime</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {mutation.data.data.processes.slice(0, 20).map((p) => {
                  const cpu = p.cpu_percent ?? p.cpu ?? 0;
                  const mem = p.memory_rss_mb ?? p.memory ?? 0;
                  const runtime =
                    p.runtime ??
                    (p.runtime_seconds !== undefined
                      ? `${Math.round(p.runtime_seconds)}s`
                      : "-");
                  return (
                    <tr key={p.pid}>
                      <td>{p.pid}</td>
                      <td>{p.name}</td>
                      <td>{cpu.toFixed(1)}</td>
                      <td>{mem.toFixed(0)}</td>
                      <td>{runtime}</td>
                      <td>{p.score.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
      {mutation.isError && (
        <p className="error-text">{(mutation.error as Error).message}</p>
      )}
    </div>
  );
}

function JfpPanel() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"search" | "suggest">("search");

  const mutation = useMutation({
    mutationFn: () => {
      const params = new URLSearchParams();
      if (query.trim()) {
        params.set(mode === "suggest" ? "task" : "q", query.trim());
      }
      return fetchJson<{ data: JfpPromptsResult }>(
        `/utilities/jfp/prompts?${params.toString()}`,
      );
    },
  });

  return (
    <div className="card card--wide">
      <h3>Jeffrey&apos;s Prompts (jfp)</h3>
      <p className="muted">
        Browse, search, and suggest battle-tested agent prompts from the JFP CLI
        library.
      </p>
      <div className="form-row">
        <input
          type="text"
          className="text-input"
          placeholder={
            mode === "suggest"
              ? "Describe task (e.g., reality check codebase)..."
              : "Search prompts (leave blank to list all)..."
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="select-input"
          value={mode}
          onChange={(e) => setMode(e.target.value as "search" | "suggest")}
        >
          <option value="search">Search / List</option>
          <option value="suggest">Suggest for Task</option>
        </select>
        <button
          className="primary-button"
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Loading..." : "Query JFP"}
        </button>
      </div>
      {mutation.isSuccess && (
        <div className="result-box">
          {!mutation.data.data.available ? (
            <p className="muted">
              {mutation.data.data.message ?? "jfp CLI is not installed"}
            </p>
          ) : (
            <>
              <p className="muted">
                {mutation.data.data.total} prompt(s) returned
              </p>
              <div className="result-list">
                {mutation.data.data.prompts.slice(0, 10).map((p) => (
                  <div key={p.id} className="result-item">
                    <StatusPill tone="info">{p.category}</StatusPill>
                    <strong>{p.title}</strong>
                    <span className="muted">{p.description}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {mutation.isError && (
        <p className="error-text">{(mutation.error as Error).message}</p>
      )}
    </div>
  );
}

function AprPanel() {
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["utilities", "apr", "status"],
    queryFn: () =>
      fetchJson<{ data: AprStatusResult }>("/utilities/apr/status"),
    enabled: false,
  });

  const apr = data?.data;

  return (
    <div className="card card--wide">
      <h3>Automated Plan Reviser (apr)</h3>
      <p className="muted">
        Inspect APR specification refinement workflows and oracle configuration.
      </p>
      <div className="form-row">
        <button
          className="primary-button"
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? "Checking APR..." : "Check APR Workflows"}
        </button>
      </div>
      {apr && (
        <div className="result-box">
          {!apr.available ? (
            <p className="muted">{apr.message ?? "apr CLI is not installed"}</p>
          ) : (
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <StatusPill tone={apr.configured ? "positive" : "warning"}>
                {apr.configured ? "Configured" : "Unconfigured"}
              </StatusPill>
              <StatusPill tone={apr.oracle_available ? "positive" : "muted"}>
                Oracle: {apr.oracle_method ?? "none"}
              </StatusPill>
              <span className="muted">
                Workflows ({apr.workflow_count ?? apr.workflows.length}):{" "}
                {apr.workflows.join(", ") || "none"}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToonPanel() {
  const [input, setInput] = useState(
    "─── Agent Summary ───\n│ status: healthy │\n│ active_beads: 4 │",
  );

  const mutation = useMutation({
    mutationFn: () =>
      fetchJson<{ data: ToonParseResponse }>("/utilities/toon/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      }),
  });

  return (
    <div className="card card--wide">
      <h3>TOON / Output Format Inspector (toon)</h3>
      <p className="muted">
        Detect, parse, and normalize TOON box-drawing output, JSON, JSONL, CSV,
        or SARIF envelopes into structured JSON.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <textarea
          className="text-input"
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste TOON, JSON, JSONL, CSV, or SARIF output..."
        />
        <div className="form-row">
          <button
            className="primary-button"
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !input.trim()}
          >
            {mutation.isPending ? "Parsing..." : "Parse & Normalize"}
          </button>
        </div>
      </div>
      {mutation.isSuccess && (
        <div className="result-box">
          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              marginBottom: "8px",
            }}
          >
            <StatusPill tone="info">
              Format: {mutation.data.data.detectedFormat}
            </StatusPill>
            <StatusPill tone={mutation.data.data.isToon ? "positive" : "muted"}>
              {mutation.data.data.isToon ? "TOON Detected" : "Standard Format"}
            </StatusPill>
          </div>
          <pre
            style={{
              margin: 0,
              fontSize: "12px",
              overflowX: "auto",
              padding: "8px",
              background: "rgba(0,0,0,0.2)",
              borderRadius: "6px",
            }}
          >
            {JSON.stringify(mutation.data.data.data, null, 2)}
          </pre>
        </div>
      )}
      {mutation.isError && (
        <p className="error-text">{(mutation.error as Error).message}</p>
      )}
    </div>
  );
}

function RchPanel() {
  const {
    data: healthData,
    isFetching: healthFetching,
    refetch: refetchHealth,
  } = useQuery({
    queryKey: ["utilities", "rch", "health"],
    queryFn: () =>
      fetchJson<{
        data: {
          available?: boolean;
          healthy?: boolean;
          version?: string;
          daemonRunning?: boolean;
          workersOnline?: number;
          workersTotal?: number;
        };
      }>("/rch/health"),
    enabled: false,
  });

  const {
    data: workersData,
    isFetching: workersFetching,
    refetch: refetchWorkers,
  } = useQuery({
    queryKey: ["utilities", "rch", "workers"],
    queryFn: () =>
      fetchJson<{
        data: {
          workers: Array<{
            name: string;
            host: string;
            status?: string;
            cpu_cores?: number;
          }>;
          summary: { total: number; online: number; busy: number };
        };
      }>("/rch/workers"),
    enabled: false,
  });

  const handleCheck = () => {
    refetchHealth();
    refetchWorkers();
  };

  const health = healthData?.data;
  const workers = workersData?.data;

  return (
    <div className="card card--wide">
      <h3>Remote Compilation Helper (rch)</h3>
      <p className="muted">
        Inspect remote compilation workers, daemon health, and offload capacity.
      </p>
      <div className="form-row">
        <button
          className="primary-button"
          type="button"
          onClick={handleCheck}
          disabled={healthFetching || workersFetching}
        >
          {healthFetching || workersFetching
            ? "Checking RCH..."
            : "Check RCH Workers & Health"}
        </button>
      </div>
      {(health || workers) && (
        <div className="result-box">
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            {health && (
              <>
                <StatusPill tone={health.available ? "positive" : "warning"}>
                  {health.available ? "CLI Installed" : "CLI Not Installed"}
                </StatusPill>
                <StatusPill tone={health.healthy ? "positive" : "muted"}>
                  {health.healthy ? "Healthy" : "Degraded / Offline"}
                </StatusPill>
              </>
            )}
            {workers && (
              <span className="muted">
                Workers: {workers.summary.online}/{workers.summary.total} online
                ({workers.summary.busy} busy)
              </span>
            )}
          </div>
          {workers && workers.workers.length > 0 && (
            <div className="result-list" style={{ marginTop: "8px" }}>
              {workers.workers.map((w) => (
                <div key={w.name} className="result-item">
                  <StatusPill
                    tone={w.status === "online" ? "positive" : "muted"}
                  >
                    {w.status ?? "unknown"}
                  </StatusPill>
                  <strong>{w.name}</strong>
                  <span className="muted">{w.host}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UbsScannerPanel() {
  const [scanProfile, setScanProfile] = useState<"strict" | "loose">("strict");

  const { data: statsData, refetch: refetchStats } = useQuery({
    queryKey: ["utilities", "scanner", "stats"],
    queryFn: () =>
      fetchJson<{
        data: {
          totalScans?: number;
          openFindings?: number;
          dismissedFindings?: number;
          bySeverity?: Record<string, number>;
        };
      }>("/scanner/stats"),
    staleTime: 30_000,
  });

  const { data: findingsData, refetch: refetchFindings } = useQuery({
    queryKey: ["utilities", "scanner", "findings"],
    queryFn: () =>
      fetchJson<{
        data: Array<{
          id: string;
          severity: string;
          file: string;
          line: number;
          message: string;
          category: string;
        }>;
      }>("/scanner/findings?limit=10"),
    staleTime: 30_000,
  });

  const scanMutation = useMutation({
    mutationFn: () =>
      fetchJson<{
        data: {
          scanId: string;
          status: string;
          filesScanned: number;
          findingsCount: number;
        };
      }>("/scanner/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: scanProfile }),
      }),
    onSuccess: () => {
      refetchStats();
      refetchFindings();
    },
  });

  const stats = statsData?.data;
  const findings = findingsData?.data ?? [];

  return (
    <div className="card card--wide">
      <h3>Ultimate Bug Scanner (ubs)</h3>
      <p className="muted">
        Run static bug/security analysis scans and inspect open findings.
      </p>
      <div className="form-row">
        <select
          className="select-input"
          value={scanProfile}
          onChange={(e) => setScanProfile(e.target.value as "strict" | "loose")}
        >
          <option value="strict">Strict Profile</option>
          <option value="loose">Loose Profile</option>
        </select>
        <button
          className="primary-button"
          type="button"
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
        >
          {scanMutation.isPending ? "Scanning..." : "Run UBS Scan"}
        </button>
        {stats && (
          <StatusPill
            tone={(stats.openFindings ?? 0) === 0 ? "positive" : "warning"}
          >
            {stats.openFindings ?? 0} open findings ({stats.totalScans ?? 0}{" "}
            scans)
          </StatusPill>
        )}
      </div>
      {scanMutation.isSuccess && (
        <div className="result-box">
          <p className="muted">
            Scan <code>{scanMutation.data.data.scanId}</code> (
            {scanMutation.data.data.status}):{" "}
            {scanMutation.data.data.filesScanned} files scanned,{" "}
            {scanMutation.data.data.findingsCount} findings.
          </p>
        </div>
      )}
      {findings.length > 0 && (
        <div className="result-box" style={{ marginTop: "8px" }}>
          <div className="result-list">
            {findings.slice(0, 5).map((f) => (
              <div key={f.id} className="result-item">
                <StatusPill
                  tone={
                    f.severity === "critical" || f.severity === "high"
                      ? "danger"
                      : "warning"
                  }
                >
                  {f.severity}
                </StatusPill>
                <code>
                  {f.file}:{f.line}
                </code>
                <span className="muted">{f.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {scanMutation.isError && (
        <p className="error-text">{(scanMutation.error as Error).message}</p>
      )}
    </div>
  );
}

// ============================================================================
// Page
// ============================================================================

export function UtilitiesPage() {
  const { data: doctor, isLoading } = useQuery({
    queryKey: ["utilities", "doctor"],
    queryFn: () => fetchJson<{ data: DoctorResult }>("/utilities/doctor"),
    staleTime: 30_000,
  });

  const utils = doctor?.data?.utilities ?? [];

  return (
    <div className="page">
      <div className="page__header">
        <h2>Utilities</h2>
        {doctor?.data && (
          <StatusPill tone={doctor.data.allHealthy ? "positive" : "warning"}>
            {doctor.data.installedCount}/{doctor.data.totalCount} installed
          </StatusPill>
        )}
      </div>

      {isLoading && <p className="muted">Loading utility status...</p>}

      {utils.length > 0 && (
        <div className="grid grid--3">
          {utils.map((u) => (
            <UtilityCard key={u.name} util={u} />
          ))}
        </div>
      )}

      <h2 style={{ marginTop: "2rem" }}>Tool Workflows</h2>

      <GiilPanel />
      <CsctfPanel />
      <XfPanel />
      <PtPanel />
      <JfpPanel />
      <AprPanel />
      <ToonPanel />
      <RchPanel />
      <UbsScannerPanel />
    </div>
  );
}
