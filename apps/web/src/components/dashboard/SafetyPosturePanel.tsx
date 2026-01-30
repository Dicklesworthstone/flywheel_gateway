/**
 * Safety Posture Panel - Quick status and remediation for safety tools.
 *
 * Displays the installation and health status of DCG, SLB, and UBS safety tools,
 * along with ACFS checksum age for tool integrity verification.
 */

import { motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  formatAge,
  getStatusTone,
  type ToolStatus,
  useSafetyPosture,
} from "../../hooks/useSafetyPosture";
import {
  fadeVariants,
  listContainerVariants,
  listItemVariants,
} from "../../lib/animations";
import { StatusPill } from "../ui/StatusPill";

// ============================================================================
// Tool Status Card
// ============================================================================

interface ToolStatusCardProps {
  name: string;
  description: string;
  status: ToolStatus;
  installCommand?: string;
}

function ToolStatusCard({
  name,
  description,
  status,
  installCommand,
}: ToolStatusCardProps) {
  const iconColor =
    status.installed && status.healthy
      ? "var(--color-green-500)"
      : status.installed
        ? "var(--color-amber-500)"
        : "var(--color-red-500)";

  return (
    <motion.div
      className="card card--compact"
      variants={listItemVariants}
      style={{
        borderLeft: `4px solid ${iconColor}`,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "8px",
              backgroundColor: iconColor,
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {status.installed && status.healthy ? (
              <ShieldCheck size={20} />
            ) : status.installed ? (
              <ShieldAlert size={20} />
            ) : (
              <Shield size={20} />
            )}
          </div>
          <div>
            <div
              style={{
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {name}
              {status.installed && status.healthy ? (
                <CheckCircle
                  size={14}
                  style={{ color: "var(--color-green-500)" }}
                />
              ) : status.installed ? (
                <AlertCircle
                  size={14}
                  style={{ color: "var(--color-amber-500)" }}
                />
              ) : (
                <XCircle size={14} style={{ color: "var(--color-red-500)" }} />
              )}
            </div>
            <div className="muted" style={{ fontSize: "12px" }}>
              {status.installed
                ? status.version
                  ? `v${status.version}`
                  : "Installed"
                : "Not installed"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {status.installed && status.healthy && (
            <StatusPill tone="positive">Healthy</StatusPill>
          )}
          {status.installed && !status.healthy && (
            <StatusPill tone="warning">Unhealthy</StatusPill>
          )}
          {!status.installed && <StatusPill tone="danger">Missing</StatusPill>}
        </div>
      </div>

      <div className="muted" style={{ marginTop: "8px", fontSize: "12px" }}>
        {description}
      </div>

      {!status.installed && installCommand && (
        <div
          style={{
            marginTop: "12px",
            padding: "8px 12px",
            borderRadius: "6px",
            backgroundColor: "var(--color-surface-2)",
            fontFamily: "monospace",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <code style={{ flex: 1 }}>{installCommand}</code>
        </div>
      )}
    </motion.div>
  );
}

// ============================================================================
// Checksum Status Card
// ============================================================================

interface ChecksumStatusCardProps {
  registryAgeMs: number | null;
  isStale: boolean;
  toolsWithChecksums: number;
  staleThresholdMs: number;
}

function ChecksumStatusCard({
  registryAgeMs,
  isStale,
  toolsWithChecksums,
  staleThresholdMs,
}: ChecksumStatusCardProps) {
  const thresholdDays = Math.round(staleThresholdMs / (24 * 60 * 60 * 1000));

  return (
    <div className="card card--compact">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "8px",
              backgroundColor: isStale
                ? "var(--color-amber-500)"
                : "var(--color-blue-500)",
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Clock size={20} />
          </div>
          <div>
            <div style={{ fontWeight: 500 }}>ACFS Checksums</div>
            <div className="muted" style={{ fontSize: "12px" }}>
              {registryAgeMs !== null
                ? formatAge(registryAgeMs)
                : "Not available"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {isStale ? (
            <StatusPill tone="warning">Stale</StatusPill>
          ) : toolsWithChecksums > 0 ? (
            <StatusPill tone="positive">Current</StatusPill>
          ) : (
            <StatusPill tone="muted">Unavailable</StatusPill>
          )}
        </div>
      </div>

      <div className="muted" style={{ marginTop: "8px", fontSize: "12px" }}>
        {toolsWithChecksums} tools with checksums verified.
        {isStale && ` Checksums are older than ${thresholdDays} days.`}
      </div>
    </div>
  );
}

// ============================================================================
// Issues Panel
// ============================================================================

interface IssuesPanelProps {
  issues: string[];
  recommendations: string[];
}

function IssuesPanel({ issues, recommendations }: IssuesPanelProps) {
  if (issues.length === 0) {
    return null;
  }

  return (
    <div
      className="card"
      style={{
        backgroundColor: "var(--color-amber-50)",
        borderColor: "var(--color-amber-200)",
      }}
    >
      <div className="card__header">
        <h4
          style={{
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <AlertCircle size={18} style={{ color: "var(--color-amber-500)" }} />
          Issues Detected
        </h4>
        <StatusPill tone="warning">{issues.length}</StatusPill>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {issues.map((issue, i) => (
          <div
            key={recommendations[i] ? `${issue}::${recommendations[i]}` : issue}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "12px",
            }}
          >
            <ChevronRight
              size={16}
              style={{
                marginTop: "2px",
                flexShrink: 0,
                color: "var(--color-amber-600)",
              }}
            />
            <div>
              <div style={{ color: "var(--color-amber-800)" }}>{issue}</div>
              {recommendations[i] && (
                <div
                  className="muted"
                  style={{
                    fontSize: "12px",
                    marginTop: "4px",
                    color: "var(--color-amber-700)",
                  }}
                >
                  {recommendations[i]}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function SafetyPosturePanel() {
  const { data, isLoading, error, refetch } = useSafetyPosture();

  if (isLoading && !data) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "32px" }}>
        <Loader2 size={24} className="spin" style={{ marginBottom: "12px" }} />
        <div className="muted">Loading safety posture...</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <motion.div
        className="card"
        style={{ backgroundColor: "var(--color-red-50)" }}
        variants={fadeVariants}
        initial="hidden"
        animate="visible"
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <AlertCircle size={24} style={{ color: "var(--color-red-500)" }} />
          <div>
            <div style={{ fontWeight: 500 }}>Error loading safety posture</div>
            <div className="muted">{error.message}</div>
          </div>
        </div>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={refetch}
          style={{ marginTop: "16px" }}
        >
          <RefreshCw size={16} />
          Retry
        </button>
      </motion.div>
    );
  }

  if (!data) {
    return null;
  }

  const statusIcon =
    data.status === "healthy" ? (
      <ShieldCheck size={24} style={{ color: "var(--color-green-500)" }} />
    ) : data.status === "degraded" ? (
      <ShieldAlert size={24} style={{ color: "var(--color-amber-500)" }} />
    ) : (
      <Shield size={24} style={{ color: "var(--color-red-500)" }} />
    );

  return (
    <motion.div variants={fadeVariants} initial="hidden" animate="visible">
      {/* Header */}
      <div className="card">
        <div className="card__header">
          <h3
            style={{
              margin: 0,
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            {statusIcon}
            Safety Posture
          </h3>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <StatusPill tone={getStatusTone(data.status)}>
              {data.status === "healthy"
                ? "All Systems Healthy"
                : data.status === "degraded"
                  ? "Some Issues"
                  : "Attention Required"}
            </StatusPill>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={refetch}
              disabled={isLoading}
              title="Refresh"
            >
              {isLoading ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <RefreshCw size={14} />
              )}
            </button>
          </div>
        </div>

        {data.summary.overallHealthy ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px",
              borderRadius: "8px",
              backgroundColor: "var(--color-green-50)",
            }}
          >
            <CheckCircle
              size={20}
              style={{ color: "var(--color-green-500)" }}
            />
            <div>
              <div style={{ fontWeight: 500, color: "var(--color-green-700)" }}>
                All safety tools are installed and healthy
              </div>
              <div className="muted" style={{ fontSize: "12px" }}>
                Your environment is protected against destructive operations.
              </div>
            </div>
          </div>
        ) : (
          <div className="muted">
            {data.summary.issues.length} issue
            {data.summary.issues.length === 1 ? "" : "s"} detected. Review the
            recommendations below.
          </div>
        )}
      </div>

      {/* Issues (if any) */}
      {data.summary.issues.length > 0 && (
        <div style={{ marginTop: "16px" }}>
          <IssuesPanel
            issues={data.summary.issues}
            recommendations={data.summary.recommendations}
          />
        </div>
      )}

      {/* Tool Status Cards */}
      <div style={{ marginTop: "16px" }}>
        <h4
          style={{
            marginBottom: "12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <Shield size={18} />
          Safety Tools
        </h4>
        <motion.div
          className="grid grid--3"
          variants={listContainerVariants}
          initial="hidden"
          animate="visible"
        >
          <ToolStatusCard
            name="DCG"
            description="Destructive Command Guard prevents dangerous command execution"
            status={data.tools.dcg}
            installCommand="cargo install dcg"
          />
          <ToolStatusCard
            name="SLB"
            description="Simultaneous Launch Button provides two-person authorization"
            status={data.tools.slb}
            installCommand="go install github.com/Dicklesworthstone/slb@latest"
          />
          <ToolStatusCard
            name="UBS"
            description="Ultimate Bug Scanner performs static analysis on code changes"
            status={data.tools.ubs}
            installCommand="cargo install ubs"
          />
        </motion.div>
      </div>

      {/* Checksums Status */}
      <div style={{ marginTop: "16px" }}>
        <h4
          style={{
            marginBottom: "12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <Clock size={18} />
          Integrity Verification
        </h4>
        <ChecksumStatusCard
          registryAgeMs={data.checksums.registryAgeMs}
          isStale={data.checksums.isStale}
          toolsWithChecksums={data.checksums.toolsWithChecksums}
          staleThresholdMs={data.checksums.staleThresholdMs}
        />
      </div>

      {/* Quick Links */}
      <div style={{ marginTop: "16px" }}>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <a href="/dcg" className="btn btn--sm btn--ghost">
            DCG Dashboard
            <ChevronRight size={14} />
          </a>
          <a
            href="https://github.com/Dicklesworthstone/dcg"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn--sm btn--ghost"
          >
            <ExternalLink size={14} />
            DCG Docs
          </a>
          <a
            href="https://github.com/Dicklesworthstone/slb"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn--sm btn--ghost"
          >
            <ExternalLink size={14} />
            SLB Docs
          </a>
        </div>
      </div>
    </motion.div>
  );
}
