/**
 * Fleet Dashboard Page.
 *
 * Provides a comprehensive interface for RU (Repo Updater) fleet management:
 * - Fleet overview statistics
 * - Repository list with status indicators
 * - Active sweep session monitoring
 * - Plan approval workflow
 * - Repository management (add/remove)
 */

import { useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { StatusPill } from "../components/ui/StatusPill";
import {
  useFleetStats,
  useFleetRepos,
  useFleetGroups,
  useSweepSessions,
  useSweepPlans,
  useStartSweep,
  useApproveSweep,
  useCancelSweep,
  useApprovePlan,
  useRejectPlan,
  useAddRepo,
  useRemoveRepo,
  type FleetRepo,
  type SweepSession,
  type SweepPlan,
  type RepoStatus,
} from "../hooks/useFleet";

// ============================================================================
// Tab Types
// ============================================================================

type TabId = "repos" | "sweeps" | "add";

interface Tab {
  id: TabId;
  label: string;
  badge?: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatRelativeTime(dateString: string | undefined): string {
  if (!dateString) return "never";
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

function getStatusTone(status: RepoStatus): "positive" | "warning" | "danger" | "muted" {
  switch (status) {
    case "healthy":
      return "positive";
    case "dirty":
    case "ahead":
      return "warning";
    case "behind":
    case "diverged":
      return "danger";
    default:
      return "muted";
  }
}

function getSweepStatusTone(status: string): "positive" | "warning" | "danger" | "muted" {
  switch (status) {
    case "completed":
      return "positive";
    case "running":
    case "paused":
      return "warning";
    case "failed":
    case "cancelled":
      return "danger";
    default:
      return "muted";
  }
}

function getRiskLevelTone(risk: string): "positive" | "warning" | "danger" | "muted" {
  switch (risk) {
    case "low":
      return "positive";
    case "medium":
      return "warning";
    case "high":
    case "critical":
      return "danger";
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
  variant?: "default" | "warning" | "danger" | "positive";
}

function QuickStatCard({ title, value, icon, variant = "default" }: QuickStatCardProps) {
  return (
    <div className={`card card--compact ${variant !== "default" ? `card--${variant}` : ""}`}>
      <div className="card__header">
        <div className="eyebrow">{title}</div>
        <span className="card__icon">{icon}</span>
      </div>
      <div className="metric">{value}</div>
    </div>
  );
}

// ============================================================================
// Repository List Tab
// ============================================================================

interface RepoListProps {
  repos: FleetRepo[];
  groups: string[];
  onRemove: (id: string) => void;
  isRemoving: boolean;
}

function RepoList({ repos, groups, onRemove, isRemoving }: RepoListProps) {
  const [filterGroup, setFilterGroup] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<RepoStatus | null>(null);
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);

  const filteredRepos = repos.filter((r) => {
    if (filterGroup && r.ruGroup !== filterGroup) return false;
    if (filterStatus && r.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="card card--wide">
      <div className="card__header">
        <h3>Repositories</h3>
        <span className="muted">{repos.length} total</span>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
        <div>
          <select
            className="data-table__page-size"
            value={filterGroup ?? ""}
            onChange={(e) => setFilterGroup(e.target.value || null)}
          >
            <option value="">All Groups</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          {(["healthy", "dirty", "behind", "ahead"] as RepoStatus[]).map((status) => (
            <button
              key={status}
              className={`btn btn--sm ${filterStatus === status ? "btn--primary" : "btn--secondary"}`}
              onClick={() => setFilterStatus(filterStatus === status ? null : status)}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Repository List */}
      <div className="table">
        {filteredRepos.map((repo) => (
          <div key={repo.id}>
            <div
              className="table__row"
              style={{ cursor: "pointer", padding: "12px 0" }}
              onClick={() => setExpandedRepo(expandedRepo === repo.id ? null : repo.id)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                {expandedRepo === repo.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <GitBranch size={18} />
                <div>
                  <div style={{ fontWeight: 500 }}>{repo.fullName}</div>
                  <div className="muted" style={{ fontSize: "0.85rem" }}>
                    {repo.description || "No description"}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <StatusPill tone={getStatusTone(repo.status)}>{repo.status}</StatusPill>
                {repo.ruGroup && <StatusPill tone="muted">{repo.ruGroup}</StatusPill>}
              </div>
              <div className="muted">{repo.currentBranch || "-"}</div>
              <div className="muted">{formatRelativeTime(repo.lastSyncAt)}</div>
            </div>

            {/* Expanded Details */}
            {expandedRepo === repo.id && (
              <div
                style={{
                  padding: "16px",
                  marginBottom: "12px",
                  background: "var(--surface-muted)",
                  borderRadius: "8px",
                }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
                  <div>
                    <div className="eyebrow">Last Commit</div>
                    <div className="mono">{repo.lastCommit || "-"}</div>
                    <div className="muted">{formatRelativeTime(repo.lastCommitDate)}</div>
                  </div>
                  <div>
                    <div className="eyebrow">Sync Status</div>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      {repo.aheadBy > 0 && <span style={{ color: "var(--warning)" }}>+{repo.aheadBy} ahead</span>}
                      {repo.behindBy > 0 && <span style={{ color: "var(--danger)" }}>-{repo.behindBy} behind</span>}
                      {repo.aheadBy === 0 && repo.behindBy === 0 && <span>In sync</span>}
                    </div>
                  </div>
                  <div>
                    <div className="eyebrow">Flags</div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      {repo.hasUncommittedChanges && <StatusPill tone="warning">Uncommitted</StatusPill>}
                      {repo.hasUnpushedCommits && <StatusPill tone="warning">Unpushed</StatusPill>}
                      {repo.isArchived && <StatusPill tone="muted">Archived</StatusPill>}
                      {repo.isPrivate && <StatusPill tone="muted">Private</StatusPill>}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                  <a
                    href={repo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn--secondary btn--sm"
                  >
                    View on GitHub
                  </a>
                  <button
                    className="btn btn--danger btn--sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(repo.id);
                    }}
                    disabled={isRemoving}
                  >
                    <Trash2 size={14} />
                    Remove
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {filteredRepos.length === 0 && (
          <div style={{ padding: "48px", textAlign: "center", color: "var(--ink-muted)" }}>
            No repositories found
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Sweeps Tab
// ============================================================================

interface SweepsTabProps {
  sessions: SweepSession[];
  onStartSweep: () => void;
  onApproveSweep: (id: string) => void;
  onCancelSweep: (id: string) => void;
  isStarting: boolean;
  isApproving: boolean;
  isCancelling: boolean;
}

function SweepsTab({
  sessions,
  onStartSweep,
  onApproveSweep,
  onCancelSweep,
  isStarting,
  isApproving,
  isCancelling,
}: SweepsTabProps) {
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  const activeSession = sessions.find((s) => s.status === "running" || s.status === "paused");

  return (
    <div className="card card--wide">
      <div className="card__header">
        <h3>Sweep Sessions</h3>
        <button className="btn btn--primary btn--sm" onClick={onStartSweep} disabled={isStarting || !!activeSession}>
          {isStarting ? <Loader2 size={14} className="spinner" /> : <Play size={14} />}
          Start Sweep
        </button>
      </div>

      {activeSession && (
        <div
          className="card"
          style={{ marginBottom: "16px", background: "rgba(193, 136, 45, 0.1)", border: "1px solid var(--warning)" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <RefreshCw size={20} style={{ color: "var(--warning)", animation: "spin 2s linear infinite" }} />
              <h4>Active Sweep: {activeSession.id}</h4>
              <StatusPill tone="warning">{activeSession.status}</StatusPill>
            </div>
            <button
              className="btn btn--danger btn--sm"
              onClick={() => onCancelSweep(activeSession.id)}
              disabled={isCancelling}
            >
              <X size={14} />
              Cancel
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
            <div>
              <div className="eyebrow">Phase</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>{activeSession.currentPhase}/3</div>
            </div>
            <div>
              <div className="eyebrow">Repos</div>
              <div>
                {activeSession.reposAnalyzed}/{activeSession.repoCount} analyzed
              </div>
            </div>
            <div>
              <div className="eyebrow">Plans</div>
              <div>{activeSession.reposPlanned} generated</div>
            </div>
            <div>
              <div className="eyebrow">Executed</div>
              <div>
                {activeSession.reposExecuted} done, {activeSession.reposFailed} failed
              </div>
            </div>
          </div>

          {activeSession.slbApprovalRequired && !activeSession.slbApprovedBy && (
            <div style={{ marginTop: "16px", padding: "12px", background: "var(--surface)", borderRadius: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Clock size={16} />
                  <span>Waiting for approval to proceed</span>
                </div>
                <button
                  className="btn btn--primary btn--sm"
                  onClick={() => onApproveSweep(activeSession.id)}
                  disabled={isApproving}
                >
                  <Check size={14} />
                  Approve Session
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="table">
        <div className="table__row table__row--header">
          <span>Session</span>
          <span>Status</span>
          <span>Progress</span>
          <span>Duration</span>
        </div>
        {sessions.map((session) => (
          <div
            key={session.id}
            className="table__row"
            style={{ cursor: "pointer" }}
            onClick={() => setExpandedSession(expandedSession === session.id ? null : session.id)}
          >
            <span className="mono">{session.id}</span>
            <span>
              <StatusPill tone={getSweepStatusTone(session.status)}>{session.status}</StatusPill>
            </span>
            <span>
              {session.reposExecuted}/{session.repoCount} repos
            </span>
            <span>
              {session.totalDurationMs ? `${Math.round(session.totalDurationMs / 60000)}m` : "-"}
            </span>
          </div>
        ))}

        {sessions.length === 0 && (
          <div style={{ padding: "48px", textAlign: "center", color: "var(--ink-muted)" }}>
            No sweep sessions yet. Start one to begin fleet maintenance.
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Plan Approval Component
// ============================================================================

interface PlanApprovalProps {
  sessionId: string;
}

function PlanApproval({ sessionId }: PlanApprovalProps) {
  const { data: plans, refetch } = useSweepPlans(sessionId);
  const { approve, isLoading: isApproving } = useApprovePlan();
  const { reject, isLoading: isRejecting } = useRejectPlan();
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});

  const pendingPlans = plans?.filter((p) => p.approvalStatus === "pending") ?? [];

  const handleApprove = async (planId: string) => {
    await approve(planId, "api-user");
    refetch();
  };

  const handleReject = async (planId: string) => {
    const reason = rejectReasons[planId];
    if (!reason) return;
    await reject(planId, "api-user", reason);
    setRejectReasons((prev) => {
      const next = { ...prev };
      delete next[planId];
      return next;
    });
    refetch();
  };

  const updateRejectReason = (planId: string, reason: string) => {
    setRejectReasons((prev) => ({ ...prev, [planId]: reason }));
  };

  if (pendingPlans.length === 0) {
    return (
      <div className="card" style={{ marginTop: "16px" }}>
        <div style={{ padding: "24px", textAlign: "center" }}>
          <Check size={32} style={{ color: "var(--positive)", marginBottom: "12px" }} />
          <p>All plans have been reviewed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: "16px" }}>
      <div className="card__header">
        <h4>Pending Plan Approvals</h4>
        <StatusPill tone="warning">{pendingPlans.length} pending</StatusPill>
      </div>

      {pendingPlans.map((plan) => (
        <div
          key={plan.id}
          className="card"
          style={{ marginBottom: "12px", background: "var(--surface-muted)" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
            <div>
              <div style={{ fontWeight: 500 }}>{plan.repoFullName}</div>
              <div className="muted">{plan.actionCount} actions planned</div>
            </div>
            <StatusPill tone={getRiskLevelTone(plan.riskLevel)}>{plan.riskLevel} risk</StatusPill>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "8px", marginBottom: "12px" }}>
            <div className="eyebrow">
              <GitCommit size={14} /> Commits: {plan.commitActions}
            </div>
            <div className="eyebrow">
              <GitBranch size={14} /> Branches: {plan.branchActions}
            </div>
            <div className="eyebrow">
              <GitPullRequest size={14} /> PRs: {plan.prActions}
            </div>
            <div className="eyebrow">Releases: {plan.releaseActions}</div>
            <div className="eyebrow">Other: {plan.otherActions}</div>
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <input
              type="text"
              className="data-table__search-input"
              placeholder="Rejection reason (required for reject)"
              value={rejectReasons[plan.id] ?? ""}
              onChange={(e) => updateRejectReason(plan.id, e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              className="btn btn--danger btn--sm"
              onClick={() => handleReject(plan.id)}
              disabled={isRejecting || !rejectReasons[plan.id]}
            >
              <X size={14} />
              Reject
            </button>
            <button
              className="btn btn--primary btn--sm"
              onClick={() => handleApprove(plan.id)}
              disabled={isApproving}
            >
              <Check size={14} />
              Approve
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Add Repository Tab
// ============================================================================

interface AddRepoTabProps {
  onAdd: (repo: { owner: string; name: string; url: string; group?: string }) => void;
  isAdding: boolean;
  groups: string[];
}

function AddRepoTab({ onAdd, isAdding, groups }: AddRepoTabProps) {
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [group, setGroup] = useState("");

  const handleSubmit = () => {
    if (!owner || !name || !url) return;
    onAdd({
      owner,
      name,
      url,
      group: group || undefined,
    });
    setOwner("");
    setName("");
    setUrl("");
    setGroup("");
  };

  // Auto-generate URL from owner/name
  const handleOwnerNameChange = (newOwner: string, newName: string) => {
    if (newOwner && newName && !url) {
      setUrl(`https://github.com/${newOwner}/${newName}`);
    }
  };

  return (
    <div className="card card--wide">
      <div className="card__header">
        <h3>Add Repository to Fleet</h3>
      </div>

      <div style={{ display: "grid", gap: "16px", maxWidth: "500px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div>
            <label className="eyebrow">Owner</label>
            <input
              type="text"
              className="data-table__search-input"
              style={{ width: "100%", marginTop: "4px" }}
              placeholder="organization"
              value={owner}
              onChange={(e) => {
                setOwner(e.target.value);
                handleOwnerNameChange(e.target.value, name);
              }}
            />
          </div>
          <div>
            <label className="eyebrow">Name</label>
            <input
              type="text"
              className="data-table__search-input"
              style={{ width: "100%", marginTop: "4px" }}
              placeholder="repository"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                handleOwnerNameChange(owner, e.target.value);
              }}
            />
          </div>
        </div>

        <div>
          <label className="eyebrow">URL</label>
          <input
            type="text"
            className="data-table__search-input"
            style={{ width: "100%", marginTop: "4px" }}
            placeholder="https://github.com/owner/repo"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        <div>
          <label className="eyebrow">Group (optional)</label>
          <select
            className="data-table__page-size"
            style={{ width: "100%", marginTop: "4px", padding: "10px" }}
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="">No group</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>

        <button
          className="btn btn--primary"
          onClick={handleSubmit}
          disabled={isAdding || !owner || !name || !url}
        >
          {isAdding ? <Loader2 size={14} className="spinner" /> : <Plus size={14} />}
          Add to Fleet
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Main Fleet Page Component
// ============================================================================

export function FleetPage() {
  const [activeTab, setActiveTab] = useState<TabId>("repos");

  // Data hooks
  const { data: stats } = useFleetStats();
  const { data: repos, refetch: refetchRepos } = useFleetRepos();
  const { data: groups } = useFleetGroups();
  const { data: sessions, refetch: refetchSessions } = useSweepSessions();

  // Mutation hooks
  const { start: startSweep, isLoading: isStarting } = useStartSweep();
  const { approve: approveSweep, isLoading: isApprovingSweep } = useApproveSweep();
  const { cancel: cancelSweep, isLoading: isCancelling } = useCancelSweep();
  const { add: addRepo, isLoading: isAdding } = useAddRepo();
  const { remove: removeRepo, isLoading: isRemoving } = useRemoveRepo();

  // Handler functions
  const handleStartSweep = async () => {
    await startSweep({ targetRepos: "*", parallelism: 2 });
    refetchSessions();
  };

  const handleApproveSweep = async (id: string) => {
    await approveSweep(id, "api-user");
    refetchSessions();
  };

  const handleCancelSweep = async (id: string) => {
    await cancelSweep(id);
    refetchSessions();
  };

  const handleAddRepo = async (repo: { owner: string; name: string; url: string; group?: string }) => {
    await addRepo(repo);
    refetchRepos();
  };

  const handleRemoveRepo = async (id: string) => {
    await removeRepo(id);
    refetchRepos();
  };

  // Tab configuration
  const activeSweeps = sessions?.filter((s) => s.status === "running" || s.status === "paused").length ?? 0;
  const tabs: Tab[] = [
    { id: "repos", label: "Repositories", badge: repos?.length },
    { id: "sweeps", label: "Sweeps", badge: activeSweeps > 0 ? activeSweeps : undefined },
    { id: "add", label: "Add Repo" },
  ];

  return (
    <div className="page">
      {/* Header */}
      <div className="card__header">
        <h2 style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <GitBranch size={28} />
          Fleet Dashboard
        </h2>
        {activeSweeps > 0 && <StatusPill tone="warning">{activeSweeps} sweep active</StatusPill>}
      </div>

      {/* Quick Stats */}
      <section className="grid grid--4" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <QuickStatCard
          title="Total Repos"
          value={stats?.totalRepos ?? "-"}
          icon={<GitBranch size={18} />}
        />
        <QuickStatCard
          title="Healthy"
          value={stats?.healthyRepos ?? "-"}
          icon={<Check size={18} />}
          variant="positive"
        />
        <QuickStatCard
          title="Needs Attention"
          value={(stats?.dirtyRepos ?? 0) + (stats?.behindRepos ?? 0) + (stats?.divergedRepos ?? 0)}
          icon={<AlertCircle size={18} />}
          variant={
            ((stats?.dirtyRepos ?? 0) + (stats?.behindRepos ?? 0) + (stats?.divergedRepos ?? 0)) > 0
              ? "warning"
              : "default"
          }
        />
        <QuickStatCard
          title="Active Sweeps"
          value={activeSweeps}
          icon={<RefreshCw size={18} />}
          variant={activeSweeps > 0 ? "warning" : "default"}
        />
      </section>

      {/* Tabs */}
      <div
        style={{ display: "flex", gap: "8px", borderBottom: "1px solid var(--border)", paddingBottom: "12px" }}
      >
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
                  background: activeTab === tab.id ? "rgba(255,255,255,0.2)" : "var(--accent)",
                  color: "#fff",
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
      <section>
        {activeTab === "repos" && repos && groups && (
          <RepoList repos={repos} groups={groups} onRemove={handleRemoveRepo} isRemoving={isRemoving} />
        )}

        {activeTab === "sweeps" && sessions && (
          <>
            <SweepsTab
              sessions={sessions}
              onStartSweep={handleStartSweep}
              onApproveSweep={handleApproveSweep}
              onCancelSweep={handleCancelSweep}
              isStarting={isStarting}
              isApproving={isApprovingSweep}
              isCancelling={isCancelling}
            />
            {sessions.find((s) => s.status === "paused") && (
              <PlanApproval sessionId={sessions.find((s) => s.status === "paused")!.id} />
            )}
          </>
        )}

        {activeTab === "add" && groups && (
          <AddRepoTab onAdd={handleAddRepo} isAdding={isAdding} groups={groups} />
        )}
      </section>
    </div>
  );
}
