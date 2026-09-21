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
    cpu: number;
    memory: number;
    runtime: string;
    score: number;
    user: string;
  }>;
  total: number;
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
    mutationFn: () => fetchJson(`/utilities/${util.name}/install`, { method: "POST" }),
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
        Download full-resolution images from iCloud, Dropbox, Google Photos, or Google Drive share
        links.
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
          onChange={(e) => setFormat(e.target.value as "file" | "json" | "base64")}
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
      {mutation.isSuccess && mutation.data.data.success && (
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
      {mutation.isError && <p className="error-text">{(mutation.error as Error).message}</p>}
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
    setFormats((prev) => (prev.includes(fmt) ? prev.filter((f) => f !== fmt) : [...prev, fmt]));
  }, []);

  return (
    <div className="card card--wide">
      <h3>Chat Transcript Export (csctf)</h3>
      <p className="muted">
        Convert AI chat share links (ChatGPT, Gemini, Grok, Claude) to clean Markdown and HTML.
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
      {mutation.isSuccess && mutation.data.data.success && (
        <div className="result-box">
          {mutation.data.data.title && <p>Title: {mutation.data.data.title}</p>}
          {mutation.data.data.messageCount !== null &&
            mutation.data.data.messageCount !== undefined && (
              <p className="muted">{mutation.data.data.messageCount} messages exported</p>
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
      {mutation.isError && <p className="error-text">{(mutation.error as Error).message}</p>}
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
      {mutation.isError && <p className="error-text">{(mutation.error as Error).message}</p>}
    </div>
  );
}

function PtPanel() {
  const mutation = useMutation({
    mutationFn: () => fetchJson<{ data: PtScanResult }>("/pt/scan", { method: "POST" }),
  });

  return (
    <div className="card card--wide">
      <h3>Process Triage (pt)</h3>
      <p className="muted">
        Scan for stuck, zombie, or resource-hungry processes. Identify orphaned agent sessions.
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
          <p className="muted">{mutation.data.data.total} suspicious processes found</p>
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
                {mutation.data.data.processes.slice(0, 20).map((p) => (
                  <tr key={p.pid}>
                    <td>{p.pid}</td>
                    <td>{p.name}</td>
                    <td>{p.cpu.toFixed(1)}</td>
                    <td>{p.memory.toFixed(0)}</td>
                    <td>{p.runtime}</td>
                    <td>{p.score.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {mutation.isError && <p className="error-text">{(mutation.error as Error).message}</p>}
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
    </div>
  );
}
