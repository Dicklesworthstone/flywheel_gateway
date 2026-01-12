/**
 * DCG Dashboard Page.
 *
 * Provides a comprehensive interface for the Destructive Command Guard:
 * - Quick stats overview
 * - Live feed of blocked commands
 * - Pending exceptions approval
 * - Statistics and trends
 * - Pack configuration
 * - Allowlist management
 * - Command testing
 */

import { useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  Clock,
  FileQuestion,
  Play,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { StatusPill } from "../components/ui/StatusPill";
import {
  useDCGStats,
  useDCGBlocks,
  useDCGPending,
  useDCGPacks,
  useDCGAllowlist,
  useApprovePending,
  useDenyPending,
  useTestCommand,
  useExplainCommand,
  useTogglePack,
  useMarkFalsePositive,
  useAddAllowlistEntry,
  useRemoveAllowlistEntry,
  type DCGBlock,
  type DCGPendingException,
  type DCGPack,
  type DCGAllowlistEntry,
} from "../hooks/useDCG";

// ============================================================================
// Tab Types
// ============================================================================

type TabId = "feed" | "pending" | "stats" | "config" | "allowlist" | "test";

interface Tab {
  id: TabId;
  label: string;
  badge?: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function formatFutureTime(dateString: string | undefined): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs <= 0) return "expired";

  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `in ${diffMins}m`;
  if (diffHours < 24) return `in ${diffHours}h`;
  return `in ${diffDays}d`;
}

function formatTimeRemaining(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffSecs = Math.floor((diffMs % 60000) / 1000);

  if (diffMs <= 0) return "expired";
  if (diffMins < 1) return `${diffSecs}s`;
  return `${diffMins}m ${diffSecs}s`;
}

function getSeverityTone(severity: string): "danger" | "warning" | "positive" | "muted" {
  switch (severity) {
    case "critical":
      return "danger";
    case "high":
      return "danger";
    case "medium":
      return "warning";
    case "low":
      return "muted";
    default:
      return "muted";
  }
}

// ============================================================================
// Quick Stat Card Component
// ============================================================================

interface QuickStatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: number;
  variant?: "default" | "warning" | "danger";
}

function QuickStatCard({ title, value, icon, trend, variant = "default" }: QuickStatCardProps) {
  const variantClass = variant !== "default" ? `card--${variant}` : "";

  return (
    <div className={`card card--compact ${variantClass}`}>
      <div className="card__header">
        <div className="eyebrow">{title}</div>
        <span className="card__icon">{icon}</span>
      </div>
      <div className="metric">{value}</div>
      {trend !== undefined && (
        <p className="muted" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          {trend > 0 ? (
            <ArrowUp size={14} style={{ color: "var(--danger)" }} />
          ) : (
            <ArrowDown size={14} style={{ color: "var(--positive)" }} />
          )}
          {Math.abs(trend)}% vs yesterday
        </p>
      )}
    </div>
  );
}

// ============================================================================
// Blocks Feed Tab
// ============================================================================

interface BlocksFeedProps {
  blocks: DCGBlock[];
  onMarkFalsePositive: (id: string) => void;
}

function BlocksFeed({ blocks, onMarkFalsePositive }: BlocksFeedProps) {
  const [filter, setFilter] = useState<string | null>(null);

  const filteredBlocks = filter
    ? blocks.filter((b) => b.severity === filter || b.pack === filter)
    : blocks;

  return (
    <div className="card card--wide">
      <div className="card__header">
        <h3>Recent Blocks</h3>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            className={`btn btn--sm ${filter === null ? "btn--primary" : "btn--secondary"}`}
            onClick={() => setFilter(null)}
          >
            All
          </button>
          {["critical", "high", "medium", "low"].map((sev) => (
            <button
              key={sev}
              className={`btn btn--sm ${filter === sev ? "btn--primary" : "btn--secondary"}`}
              onClick={() => setFilter(sev)}
            >
              {sev}
            </button>
          ))}
        </div>
      </div>

      <div className="table">
        <div className="table__row table__row--header">
          <span>Command</span>
          <span>Severity</span>
          <span>Pack</span>
          <span>Time</span>
        </div>
        {filteredBlocks.map((block) => (
          <div key={block.id} className="table__row">
            <span className="mono" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {block.command}
            </span>
            <span>
              <StatusPill tone={getSeverityTone(block.severity)}>{block.severity}</StatusPill>
            </span>
            <span>{block.pack}</span>
            <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {formatRelativeTime(block.blockedAt)}
              {!block.falsePositive && (
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  onClick={() => onMarkFalsePositive(block.id)}
                  title="Mark as false positive"
                >
                  <ShieldX size={14} />
                </button>
              )}
              {block.falsePositive && (
                <StatusPill tone="warning">FP</StatusPill>
              )}
            </span>
          </div>
        ))}
        {filteredBlocks.length === 0 && (
          <div style={{ padding: "32px", textAlign: "center", color: "var(--ink-muted)" }}>
            No blocks found
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Pending Exceptions Tab
// ============================================================================

interface PendingListProps {
  pending: DCGPendingException[];
  onApprove: (shortCode: string) => void;
  onDeny: (shortCode: string) => void;
  isApproving: boolean;
  isDenying: boolean;
}

function PendingList({ pending, onApprove, onDeny, isApproving, isDenying }: PendingListProps) {
  const pendingOnly = pending.filter((p) => p.status === "pending");

  return (
    <div className="card card--wide">
      <div className="card__header">
        <h3>Pending Exceptions</h3>
        <StatusPill tone={pendingOnly.length > 0 ? "warning" : "positive"}>
          {pendingOnly.length} pending
        </StatusPill>
      </div>

      {pendingOnly.length === 0 ? (
        <div style={{ padding: "48px", textAlign: "center" }}>
          <ShieldCheck size={48} style={{ color: "var(--positive)", marginBottom: "16px" }} />
          <h4>No pending exceptions</h4>
          <p className="muted">All exception requests have been processed.</p>
        </div>
      ) : (
        <div className="table">
          {pendingOnly.map((exception) => (
            <div
              key={exception.shortCode}
              className="card"
              style={{ marginBottom: "12px", background: "var(--surface-muted)" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                <span className="mono" style={{ fontWeight: 600 }}>
                  {exception.shortCode}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--warning)" }}>
                  <Clock size={14} />
                  {formatTimeRemaining(exception.expiresAt)}
                </span>
              </div>
              <div className="mono" style={{ marginBottom: "12px", wordBreak: "break-all" }}>
                {exception.command}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="muted">Agent: {exception.agentId}</span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    className="btn btn--danger btn--sm"
                    onClick={() => onDeny(exception.shortCode)}
                    disabled={isDenying}
                  >
                    <X size={14} />
                    Deny
                  </button>
                  <button
                    className="btn btn--primary btn--sm"
                    onClick={() => onApprove(exception.shortCode)}
                    disabled={isApproving}
                  >
                    <Check size={14} />
                    Approve
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Statistics Tab
// ============================================================================

interface StatsTabProps {
  stats: {
    overview: {
      blocksLast24h: number;
      totalBlocks: number;
      falsePositiveRate: number;
      pendingExceptionsCount: number;
    };
    bySeverity: Record<string, number>;
    byPack: Record<string, number>;
  } | null;
}

function StatsTab({ stats }: StatsTabProps) {
  if (!stats) {
    return (
      <div className="card card--wide" style={{ textAlign: "center", padding: "48px" }}>
        <div className="spinner spinner--lg" />
        <p className="muted" style={{ marginTop: "16px" }}>Loading statistics...</p>
      </div>
    );
  }

  const severityEntries = Object.entries(stats.bySeverity);
  const packEntries = Object.entries(stats.byPack).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <div className="card">
        <h3>Blocks by Severity</h3>
        <div style={{ marginTop: "16px" }}>
          {severityEntries.map(([severity, count]) => {
            const total = Object.values(stats.bySeverity).reduce((a, b) => a + b, 0);
            const pct = total > 0 ? (count / total) * 100 : 0;
            return (
              <div key={severity} style={{ marginBottom: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <StatusPill tone={getSeverityTone(severity)}>{severity}</StatusPill>
                  <span>{count}</span>
                </div>
                <div
                  style={{
                    height: "8px",
                    background: "var(--surface-muted)",
                    borderRadius: "4px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${pct}%`,
                      background:
                        severity === "critical" || severity === "high"
                          ? "var(--danger)"
                          : severity === "medium"
                            ? "var(--warning)"
                            : "var(--ink-muted)",
                      borderRadius: "4px",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h3>Top Blocking Packs</h3>
        <div style={{ marginTop: "16px" }}>
          {packEntries.slice(0, 5).map(([pack, count], i) => (
            <div
              key={pack}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "12px 0",
                borderBottom: i < 4 ? "1px solid var(--border)" : "none",
              }}
            >
              <span>{pack}</span>
              <span className="mono">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ============================================================================
// Configuration Tab
// ============================================================================

interface ConfigTabProps {
  packs: DCGPack[];
  onToggle: (packId: string, enable: boolean) => void;
  isToggling: boolean;
}

function ConfigTab({ packs, onToggle, isToggling }: ConfigTabProps) {
  return (
    <div className="card card--wide">
      <div className="card__header">
        <h3>Rule Packs</h3>
        <span className="muted">{packs.filter((p) => p.enabled).length} enabled</span>
      </div>

      <div className="table">
        {packs.map((pack) => (
          <div
            key={pack.id}
            className="card"
            style={{
              marginBottom: "12px",
              background: pack.enabled ? "var(--surface)" : "var(--surface-muted)",
              opacity: pack.enabled ? 1 : 0.7,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h4>{pack.name}</h4>
                <p className="muted" style={{ marginTop: "4px" }}>
                  {pack.description}
                </p>
                <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                  <StatusPill tone={getSeverityTone(pack.severity)}>{pack.severity}</StatusPill>
                  <StatusPill tone="muted">{pack.ruleCount} rules</StatusPill>
                </div>
              </div>
              <button
                className={`btn btn--sm ${pack.enabled ? "btn--secondary" : "btn--primary"}`}
                onClick={() => onToggle(pack.id, !pack.enabled)}
                disabled={isToggling}
              >
                {pack.enabled ? "Disable" : "Enable"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Allowlist Tab
// ============================================================================

interface AllowlistTabProps {
  entries: DCGAllowlistEntry[];
  onRemove: (ruleId: string) => void;
  onAdd: (entry: { ruleId: string; pattern: string; reason: string }) => void;
  isRemoving: boolean;
  isAdding: boolean;
}

function AllowlistTab({ entries, onRemove, onAdd, isRemoving, isAdding }: AllowlistTabProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEntry, setNewEntry] = useState({ ruleId: "", pattern: "", reason: "" });

  const handleAdd = () => {
    if (newEntry.ruleId && newEntry.pattern && newEntry.reason) {
      onAdd(newEntry);
      setNewEntry({ ruleId: "", pattern: "", reason: "" });
      setShowAddForm(false);
    }
  };

  return (
    <div className="card card--wide">
      <div className="card__header">
        <h3>Allowlist</h3>
        <button
          className="btn btn--primary btn--sm"
          onClick={() => setShowAddForm(!showAddForm)}
        >
          {showAddForm ? "Cancel" : "Add Entry"}
        </button>
      </div>

      {showAddForm && (
        <div
          className="card"
          style={{ marginBottom: "16px", background: "var(--surface-muted)" }}
        >
          <div style={{ display: "grid", gap: "12px" }}>
            <div>
              <label className="eyebrow">Rule ID</label>
              <input
                type="text"
                className="data-table__search-input"
                style={{ width: "100%", marginTop: "4px" }}
                placeholder="allow-xxx"
                value={newEntry.ruleId}
                onChange={(e) => setNewEntry({ ...newEntry, ruleId: e.target.value })}
              />
            </div>
            <div>
              <label className="eyebrow">Pattern</label>
              <input
                type="text"
                className="data-table__search-input"
                style={{ width: "100%", marginTop: "4px" }}
                placeholder="rm -rf ./node_modules"
                value={newEntry.pattern}
                onChange={(e) => setNewEntry({ ...newEntry, pattern: e.target.value })}
              />
            </div>
            <div>
              <label className="eyebrow">Reason</label>
              <input
                type="text"
                className="data-table__search-input"
                style={{ width: "100%", marginTop: "4px" }}
                placeholder="Why this should be allowed"
                value={newEntry.reason}
                onChange={(e) => setNewEntry({ ...newEntry, reason: e.target.value })}
              />
            </div>
            <button
              className="btn btn--primary"
              onClick={handleAdd}
              disabled={isAdding || !newEntry.ruleId || !newEntry.pattern || !newEntry.reason}
            >
              Add to Allowlist
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <div style={{ padding: "48px", textAlign: "center" }}>
          <Shield size={48} style={{ color: "var(--ink-muted)", marginBottom: "16px" }} />
          <h4>No allowlist entries</h4>
          <p className="muted">Add patterns to bypass DCG checks for specific commands.</p>
        </div>
      ) : (
        <div className="table">
          {entries.map((entry) => (
            <div
              key={entry.ruleId}
              className="card"
              style={{ marginBottom: "12px", background: "var(--surface-muted)" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <span className="mono" style={{ fontWeight: 600 }}>
                    {entry.ruleId}
                  </span>
                  <div className="mono" style={{ marginTop: "8px" }}>
                    {entry.pattern}
                  </div>
                  <p className="muted" style={{ marginTop: "4px" }}>
                    {entry.reason}
                  </p>
                  <div className="muted" style={{ marginTop: "8px", fontSize: "0.8rem" }}>
                    Added by {entry.addedBy} {formatRelativeTime(entry.addedAt)}
                    {entry.expiresAt && ` (expires ${formatFutureTime(entry.expiresAt)})`}
                  </div>
                </div>
                <button
                  className="btn btn--danger btn--sm btn--icon"
                  onClick={() => onRemove(entry.ruleId)}
                  disabled={isRemoving}
                  title="Remove"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Command Tester Tab
// ============================================================================

interface CommandTesterProps {
  onTest: (command: string) => void;
  onExplain: (command: string) => void;
  isTesting: boolean;
  isExplaining: boolean;
  testResult?: {
    blocked: boolean;
    severity?: string;
    explanation?: string;
  } | null;
  explainResult?: {
    analysis: string;
    wouldBlock: boolean;
    matchingRules: Array<{ pack: string; rule: string; severity: string; reason: string }>;
  } | null;
}

function CommandTester({
  onTest,
  onExplain,
  isTesting,
  isExplaining,
  testResult,
  explainResult,
}: CommandTesterProps) {
  const [command, setCommand] = useState("");

  return (
    <div className="card card--wide">
      <div className="card__header">
        <h3>Command Tester</h3>
        <Terminal size={20} />
      </div>

      <div style={{ marginBottom: "16px" }}>
        <label className="eyebrow">Enter a command to test</label>
        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <input
            type="text"
            className="data-table__search-input"
            style={{ flex: 1 }}
            placeholder="git reset --hard HEAD"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && command) {
                onTest(command);
              }
            }}
          />
          <button
            className="btn btn--primary"
            onClick={() => onTest(command)}
            disabled={!command || isTesting}
          >
            <Play size={14} />
            Test
          </button>
          <button
            className="btn btn--secondary"
            onClick={() => onExplain(command)}
            disabled={!command || isExplaining}
          >
            <FileQuestion size={14} />
            Explain
          </button>
        </div>
      </div>

      {testResult && (
        <div
          className="card"
          style={{
            marginTop: "16px",
            background: testResult.blocked
              ? "rgba(196, 77, 65, 0.1)"
              : "rgba(42, 127, 98, 0.1)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
            {testResult.blocked ? (
              <ShieldX size={24} style={{ color: "var(--danger)" }} />
            ) : (
              <ShieldCheck size={24} style={{ color: "var(--positive)" }} />
            )}
            <h4 style={{ color: testResult.blocked ? "var(--danger)" : "var(--positive)" }}>
              {testResult.blocked ? "BLOCKED" : "ALLOWED"}
            </h4>
            {testResult.severity && (
              <StatusPill tone={getSeverityTone(testResult.severity)}>
                {testResult.severity}
              </StatusPill>
            )}
          </div>
          {testResult.explanation && <p>{testResult.explanation}</p>}
        </div>
      )}

      {explainResult && (
        <div className="card" style={{ marginTop: "16px", background: "var(--surface-muted)" }}>
          <h4 style={{ marginBottom: "8px" }}>Analysis</h4>
          <p style={{ marginBottom: "16px" }}>{explainResult.analysis}</p>

          {explainResult.matchingRules.length > 0 && (
            <>
              <h4 style={{ marginBottom: "8px" }}>Matching Rules</h4>
              {explainResult.matchingRules.map((rule, i) => (
                <div
                  key={i}
                  style={{
                    padding: "8px",
                    marginBottom: "8px",
                    background: "var(--surface)",
                    borderRadius: "8px",
                  }}
                >
                  <div style={{ display: "flex", gap: "8px", marginBottom: "4px" }}>
                    <StatusPill tone={getSeverityTone(rule.severity)}>{rule.severity}</StatusPill>
                    <span className="mono">{rule.pack}/{rule.rule}</span>
                  </div>
                  <p className="muted">{rule.reason}</p>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main DCG Page Component
// ============================================================================

export function DCGPage() {
  const [activeTab, setActiveTab] = useState<TabId>("feed");
  const [testResult, setTestResult] = useState<{
    blocked: boolean;
    severity?: string;
    explanation?: string;
  } | null>(null);
  const [explainResult, setExplainResult] = useState<{
    analysis: string;
    wouldBlock: boolean;
    matchingRules: Array<{ pack: string; rule: string; severity: string; reason: string }>;
  } | null>(null);

  // Data hooks
  const { data: stats, isLoading: statsLoading } = useDCGStats();
  const { data: blocks, refetch: refetchBlocks } = useDCGBlocks({ limit: 50 });
  const { data: pending, refetch: refetchPending } = useDCGPending({ status: "pending" });
  const { data: packs, refetch: refetchPacks } = useDCGPacks();
  const { data: allowlist, refetch: refetchAllowlist } = useDCGAllowlist();

  // Mutation hooks
  const { approve, isLoading: isApproving } = useApprovePending();
  const { deny, isLoading: isDenying } = useDenyPending();
  const { test, isLoading: isTesting } = useTestCommand();
  const { explain, isLoading: isExplaining } = useExplainCommand();
  const { toggle, isLoading: isToggling } = useTogglePack();
  const { mark: markFP } = useMarkFalsePositive();
  const { add: addAllowlist, isLoading: isAddingAllowlist } = useAddAllowlistEntry();
  const { remove: removeAllowlist, isLoading: isRemovingAllowlist } = useRemoveAllowlistEntry();

  // Handler functions
  const handleApprove = async (shortCode: string) => {
    await approve(shortCode);
    refetchPending();
  };

  const handleDeny = async (shortCode: string) => {
    await deny(shortCode);
    refetchPending();
  };

  const handleTest = async (command: string) => {
    setExplainResult(null);
    const result = await test(command);
    setTestResult(result);
  };

  const handleExplain = async (command: string) => {
    setTestResult(null);
    const result = await explain(command);
    setExplainResult(result);
  };

  const handleTogglePack = async (packId: string, enable: boolean) => {
    await toggle(packId, enable);
    refetchPacks();
  };

  const handleMarkFP = async (blockId: string) => {
    await markFP(blockId);
    refetchBlocks();
  };

  const handleAddAllowlist = async (entry: { ruleId: string; pattern: string; reason: string }) => {
    await addAllowlist(entry);
    refetchAllowlist();
  };

  const handleRemoveAllowlist = async (ruleId: string) => {
    await removeAllowlist(ruleId);
    refetchAllowlist();
  };

  // Tab configuration
  const tabs: Tab[] = [
    { id: "feed", label: "Live Feed" },
    { id: "pending", label: "Pending", badge: pending?.filter((p) => p.status === "pending").length },
    { id: "stats", label: "Statistics" },
    { id: "config", label: "Configuration" },
    { id: "allowlist", label: "Allowlist" },
    { id: "test", label: "Test Command" },
  ];

  return (
    <div className="page">
      {/* Header */}
      <div className="card__header">
        <h2 style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <Shield size={28} />
          Destructive Command Guard
        </h2>
        {pending && pending.filter((p) => p.status === "pending").length > 0 && (
          <StatusPill tone="warning">
            {pending.filter((p) => p.status === "pending").length} pending
          </StatusPill>
        )}
      </div>

      {/* Quick Stats */}
      <section className="grid grid--4" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <QuickStatCard
          title="Blocks (24h)"
          value={stats?.overview.blocksLast24h ?? "-"}
          icon={<ShieldAlert size={18} />}
          trend={stats?.overview.trendVsYesterday}
        />
        <QuickStatCard
          title="Total Blocks"
          value={stats?.overview.totalBlocks ?? "-"}
          icon={<Shield size={18} />}
        />
        <QuickStatCard
          title="False Positive Rate"
          value={
            stats?.overview.falsePositiveRate !== undefined
              ? `${(stats.overview.falsePositiveRate * 100).toFixed(1)}%`
              : "-"
          }
          icon={<AlertCircle size={18} />}
        />
        <QuickStatCard
          title="Pending"
          value={stats?.overview.pendingExceptionsCount ?? "-"}
          icon={<Clock size={18} />}
          variant={stats?.overview.pendingExceptionsCount ? "warning" : "default"}
        />
      </section>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "8px", borderBottom: "1px solid var(--border)", paddingBottom: "12px" }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`btn btn--sm ${activeTab === tab.id ? "btn--primary" : "btn--ghost"}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span
                style={{
                  marginLeft: "6px",
                  background: activeTab === tab.id ? "rgba(255,255,255,0.2)" : "var(--warning)",
                  color: activeTab === tab.id ? "inherit" : "#fff",
                  padding: "2px 6px",
                  borderRadius: "999px",
                  fontSize: "0.75rem",
                }}
              >
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <section className={activeTab === "stats" ? "grid grid--2" : ""}>
        {activeTab === "feed" && blocks && (
          <BlocksFeed blocks={blocks} onMarkFalsePositive={handleMarkFP} />
        )}

        {activeTab === "pending" && pending && (
          <PendingList
            pending={pending}
            onApprove={handleApprove}
            onDeny={handleDeny}
            isApproving={isApproving}
            isDenying={isDenying}
          />
        )}

        {activeTab === "stats" && <StatsTab stats={stats} />}

        {activeTab === "config" && packs && (
          <ConfigTab packs={packs} onToggle={handleTogglePack} isToggling={isToggling} />
        )}

        {activeTab === "allowlist" && allowlist && (
          <AllowlistTab
            entries={allowlist}
            onRemove={handleRemoveAllowlist}
            onAdd={handleAddAllowlist}
            isRemoving={isRemovingAllowlist}
            isAdding={isAddingAllowlist}
          />
        )}

        {activeTab === "test" && (
          <CommandTester
            onTest={handleTest}
            onExplain={handleExplain}
            isTesting={isTesting}
            isExplaining={isExplaining}
            testResult={testResult}
            explainResult={explainResult}
          />
        )}
      </section>
    </div>
  );
}
