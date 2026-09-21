/**
 * CASS Page - Cross-Agent Session Search.
 *
 * Provides a search interface for querying agent session histories,
 * viewing session content, and expanding context around matches.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { StatusPill } from "../components/ui/StatusPill";

// ============================================================================
// Types
// ============================================================================

interface CassSearchResult {
  file: string;
  line: number;
  content: string;
  agent?: string;
  workspace?: string;
  timestamp?: string;
  score?: number;
}

interface CassSearchResponse {
  data: {
    results: CassSearchResult[];
    total: number;
    query: string;
    mode: string;
  };
}

interface CassHealthResponse {
  data: {
    available: boolean;
    version?: string;
    indexedSessions?: number;
    lastIndexed?: string;
  };
}

interface CassViewResponse {
  data: {
    file: string;
    lines: Array<{ line: number; content: string }>;
    startLine: number;
    endLine: number;
  };
}

// ============================================================================
// API
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

function SearchResultRow({
  result,
  onView,
}: {
  result: CassSearchResult;
  onView: (file: string, line: number) => void;
}) {
  return (
    <div className="table__row">
      <span>
        <button
          className="ghost-button mono"
          type="button"
          onClick={() => onView(result.file, result.line)}
        >
          {result.file.split("/").slice(-2).join("/")}:{result.line}
        </button>
      </span>
      <span>{result.agent ?? "—"}</span>
      <span className="result-text">{result.content.slice(0, 200)}</span>
      <span className="muted">
        {result.score !== null && result.score !== undefined ? result.score.toFixed(2) : "—"}
      </span>
    </div>
  );
}

function SessionViewer({
  file,
  lines,
}: {
  file: string;
  lines: Array<{ line: number; content: string }>;
}) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card__header">
        <h3 className="mono">{file.split("/").slice(-3).join("/")}</h3>
      </div>
      <pre className="code-block">
        {lines.map((l) => (
          <div key={l.line} className="code-line">
            <span className="code-line__number">{l.line}</span>
            <span>{l.content}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

// ============================================================================
// Page
// ============================================================================

type SearchMode = "lexical" | "semantic" | "hybrid";

export function CASSPage() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("lexical");
  const [agentFilter, setAgentFilter] = useState("");
  const [limit, setLimit] = useState(20);
  const [viewerData, setViewerData] = useState<CassViewResponse["data"] | null>(null);

  const { data: health } = useQuery({
    queryKey: ["cass", "health"],
    queryFn: () => fetchJson<CassHealthResponse>("/cass/health"),
    staleTime: 30_000,
  });

  const searchMutation = useMutation({
    mutationFn: () => {
      const params = new URLSearchParams({
        q: query,
        mode,
        limit: String(limit),
      });
      if (agentFilter) params.set("agent", agentFilter);
      return fetchJson<CassSearchResponse>(`/cass/search?${params.toString()}`);
    },
  });

  const viewMutation = useMutation({
    mutationFn: ({ file, line }: { file: string; line: number }) =>
      fetchJson<CassViewResponse>(`/cass/view/${encodeURIComponent(file)}?line=${line}&context=10`),
    onSuccess: (data) => setViewerData(data.data),
  });

  const results = searchMutation.data?.data?.results ?? [];
  const available = health?.data?.available ?? false;

  return (
    <div className="page">
      <div className="page__header">
        <h2>Session Search</h2>
        <StatusPill tone={available ? "positive" : "warning"}>
          {available ? `CASS v${health?.data?.version ?? "?"}` : "unavailable"}
        </StatusPill>
      </div>

      {/* Health info */}
      {health?.data && available && (
        <div className="card card--compact" style={{ marginBottom: 16 }}>
          <p className="muted">
            {health.data.indexedSessions ?? 0} sessions indexed
            {health.data.lastIndexed && (
              <> | Last indexed: {new Date(health.data.lastIndexed).toLocaleString()}</>
            )}
          </p>
        </div>
      )}

      {/* Search controls */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Search</h3>
        <div className="form-row">
          <input
            type="text"
            className="text-input"
            placeholder="Search sessions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query) searchMutation.mutate();
            }}
          />
          <select
            className="select-input"
            value={mode}
            onChange={(e) => setMode(e.target.value as SearchMode)}
          >
            <option value="lexical">Lexical</option>
            <option value="semantic">Semantic</option>
            <option value="hybrid">Hybrid</option>
          </select>
          <input
            type="text"
            className="text-input text-input--small"
            placeholder="Agent filter"
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            style={{ width: 140 }}
          />
          <input
            type="number"
            className="text-input text-input--small"
            min={1}
            max={100}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            style={{ width: 80 }}
          />
          <button
            className="primary-button"
            type="button"
            onClick={() => searchMutation.mutate()}
            disabled={searchMutation.isPending || !query}
          >
            {searchMutation.isPending ? "Searching..." : "Search"}
          </button>
        </div>
      </div>

      {/* Results */}
      {searchMutation.isError && (
        <p className="error-text">{(searchMutation.error as Error).message}</p>
      )}

      {searchMutation.isSuccess && (
        <div className="card">
          <div className="card__header">
            <h3>Results</h3>
            <StatusPill tone="muted">
              {searchMutation.data.data.total} matches ({searchMutation.data.data.mode})
            </StatusPill>
          </div>
          {results.length === 0 && <p className="muted">No results found.</p>}
          {results.length > 0 && (
            <div className="table">
              <div className="table__row table__row--header">
                <span>Location</span>
                <span>Agent</span>
                <span>Content</span>
                <span>Score</span>
              </div>
              {results.map((r, i) => (
                <SearchResultRow
                  key={`${r.file}:${r.line}:${i}`}
                  result={r}
                  onView={(file, line) => viewMutation.mutate({ file, line })}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Session viewer */}
      {viewerData && <SessionViewer file={viewerData.file} lines={viewerData.lines} />}
    </div>
  );
}
