/**
 * Setup Page - Setup wizard and readiness dashboard.
 *
 * Provides an onboarding flow that:
 * - Detects installed agent/toolchain components
 * - Surfaces readiness gaps with recommendations
 * - Offers installation actions with progress tracking
 */

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  PartyPopper,
  RefreshCw,
  Shield,
  Terminal,
  XCircle,
  Zap,
} from "lucide-react";
import { useCallback, useState } from "react";
import { ConfirmModal } from "../components/ui/Modal";
import { StatusPill } from "../components/ui/StatusPill";
import {
  type DetectedCLI,
  getToolDisplayInfo,
  useInstallTool,
  useReadiness,
  TOOL_DISPLAY_INFO,
} from "../hooks/useSetup";
import {
  fadeVariants,
  listContainerVariants,
  listItemVariants,
  pageSlideVariants,
} from "../lib/animations";

// ============================================================================
// Readiness Score Display
// ============================================================================

interface ReadinessScoreProps {
  ready: boolean;
  agentsAvailable: number;
  agentsTotal: number;
  toolsAvailable: number;
  toolsTotal: number;
}

function ReadinessScore({
  ready,
  agentsAvailable,
  agentsTotal,
  toolsAvailable,
  toolsTotal,
}: ReadinessScoreProps) {
  const totalAvailable = agentsAvailable + toolsAvailable;
  const total = agentsTotal + toolsTotal;
  const percent = total > 0 ? Math.round((totalAvailable / total) * 100) : 0;

  return (
    <div className="card">
      <div className="card__header">
        <h3>Setup Status</h3>
        <StatusPill tone={ready ? "positive" : "warning"}>
          {ready ? "Ready" : "Setup Required"}
        </StatusPill>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
        <div
          style={{
            width: "100px",
            height: "100px",
            borderRadius: "50%",
            background: `conic-gradient(
              ${ready ? "var(--color-green-500)" : "var(--color-amber-500)"} ${percent}%,
              var(--color-surface-3) ${percent}%
            )`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: "80px",
              height: "80px",
              borderRadius: "50%",
              backgroundColor: "var(--color-surface-1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "24px",
              fontWeight: "bold",
            }}
          >
            {percent}%
          </div>
        </div>
        <div>
          <div style={{ marginBottom: "8px" }}>
            <span style={{ fontWeight: 500 }}>{agentsAvailable}</span>
            <span className="muted"> / {agentsTotal} agents detected</span>
          </div>
          <div>
            <span style={{ fontWeight: 500 }}>{toolsAvailable}</span>
            <span className="muted"> / {toolsTotal} tools installed</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Tool Card
// ============================================================================

interface ToolCardProps {
  cli: DetectedCLI;
  onInstall?: () => void;
  installing?: boolean;
  index?: number;
}

function ToolCard({ cli, onInstall, installing, index = 0 }: ToolCardProps) {
  const display = getToolDisplayInfo(cli.name);
  const isAgent = ["claude", "codex", "gemini", "aider", "gh-copilot"].includes(
    cli.name
  );

  return (
    <motion.div
      className="card card--compact"
      variants={listItemVariants}
      style={{
        borderLeft: `4px solid ${cli.available ? display.color : "var(--color-surface-3)"}`,
        opacity: cli.available ? 1 : 0.7,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "8px",
              backgroundColor: cli.available ? display.color : "var(--color-surface-3)",
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "bold",
              fontSize: "14px",
            }}
          >
            {display.icon}
          </div>
          <div>
            <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: "8px" }}>
              {display.displayName}
              {cli.available ? (
                <CheckCircle size={14} style={{ color: "var(--color-green-500)" }} />
              ) : (
                <XCircle size={14} style={{ color: "var(--color-red-500)" }} />
              )}
            </div>
            <div className="muted" style={{ fontSize: "12px" }}>
              {cli.available
                ? cli.version
                  ? `v${cli.version}`
                  : "Installed"
                : "Not installed"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {cli.available && cli.authenticated === false && (
            <StatusPill tone="warning">Not authenticated</StatusPill>
          )}
          {cli.available && cli.authenticated === true && (
            <StatusPill tone="positive">Authenticated</StatusPill>
          )}
          {!cli.available && !isAgent && onInstall && (
            <button
              className="btn btn--sm btn--secondary"
              onClick={onInstall}
              disabled={installing}
            >
              {installing ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <Download size={14} />
              )}
              Install
            </button>
          )}
        </div>
      </div>

      {cli.authError && (
        <div
          style={{
            marginTop: "8px",
            padding: "8px",
            borderRadius: "4px",
            backgroundColor: "var(--color-amber-50)",
            color: "var(--color-amber-700)",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <AlertCircle size={14} />
          {cli.authError}
        </div>
      )}
    </motion.div>
  );
}

// ============================================================================
// Recommendations Panel
// ============================================================================

interface RecommendationsPanelProps {
  recommendations: string[];
  missingRequired: string[];
}

function RecommendationsPanel({
  recommendations,
  missingRequired,
}: RecommendationsPanelProps) {
  if (recommendations.length === 0 && missingRequired.length === 0) {
    return (
      <div className="card" style={{ backgroundColor: "var(--color-green-50)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <CheckCircle size={24} style={{ color: "var(--color-green-500)" }} />
          <div>
            <div style={{ fontWeight: 500 }}>All systems ready!</div>
            <div className="muted">Your setup is complete and ready to use.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card__header">
        <h3>Recommendations</h3>
        <StatusPill tone="warning">{recommendations.length} items</StatusPill>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {recommendations.map((rec, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "12px",
              padding: "12px",
              borderRadius: "8px",
              backgroundColor: "var(--color-surface-2)",
            }}
          >
            <ChevronRight size={16} style={{ marginTop: "2px", flexShrink: 0 }} />
            <div>{rec}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Setup Steps
// ============================================================================

type SetupStep = "detect" | "install" | "verify";

interface SetupStepsProps {
  currentStep: SetupStep;
  onStepClick: (step: SetupStep) => void;
  completedSteps: SetupStep[];
}

function SetupSteps({ currentStep, onStepClick, completedSteps }: SetupStepsProps) {
  const steps: { id: SetupStep; label: string; icon: React.ReactNode }[] = [
    { id: "detect", label: "Detect", icon: <Terminal size={18} /> },
    { id: "install", label: "Install", icon: <Download size={18} /> },
    { id: "verify", label: "Verify", icon: <Shield size={18} /> },
  ];

  return (
    <div style={{ display: "flex", gap: "4px", marginBottom: "24px" }}>
      {steps.map((step, i) => {
        const isCompleted = completedSteps.includes(step.id);
        const isCurrent = currentStep === step.id;

        return (
          <button
            key={step.id}
            className={`btn ${isCurrent ? "btn--primary" : "btn--ghost"}`}
            onClick={() => onStepClick(step.id)}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              position: "relative",
            }}
          >
            {isCompleted ? (
              <Check size={18} style={{ color: "var(--color-green-500)" }} />
            ) : (
              step.icon
            )}
            {step.label}
            {i < steps.length - 1 && (
              <ChevronRight
                size={16}
                style={{
                  position: "absolute",
                  right: "-10px",
                  opacity: 0.3,
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export function SetupPage() {
  const { status, loading, error, refresh, isReady } = useReadiness();
  const { install, installing } = useInstallTool();
  const [currentStep, setCurrentStep] = useState<SetupStep>("detect");
  const [completedSteps, setCompletedSteps] = useState<SetupStep[]>([]);
  const [installingTool, setInstallingTool] = useState<string | null>(null);

  const handleInstall = async (tool: string) => {
    setInstallingTool(tool);
    try {
      await install(tool, "easy", true);
      // Refresh detection after install
      await refresh(true);
    } catch {
      // Error is handled by the hook
    } finally {
      setInstallingTool(null);
    }
  };

  const handleRefresh = async () => {
    await refresh(true);
    if (!completedSteps.includes("detect")) {
      setCompletedSteps([...completedSteps, "detect"]);
    }
  };

  // Auto-complete detect step when status loads
  if (status && !completedSteps.includes("detect")) {
    setCompletedSteps(["detect"]);
  }

  // Auto-complete all steps when ready
  if (isReady && !completedSteps.includes("verify")) {
    setCompletedSteps(["detect", "install", "verify"]);
  }

  if (error) {
    return (
      <div className="page">
        <div className="card" style={{ backgroundColor: "var(--color-red-50)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <AlertCircle size={24} style={{ color: "var(--color-red-500)" }} />
            <div>
              <div style={{ fontWeight: 500 }}>Error loading setup status</div>
              <div className="muted">{error}</div>
            </div>
          </div>
          <button className="btn btn--secondary" onClick={() => refresh()} style={{ marginTop: "16px" }}>
            <RefreshCw size={16} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (loading && !status) {
    return (
      <div className="page">
        <div className="card" style={{ textAlign: "center", padding: "48px" }}>
          <Loader2 size={32} className="spin" style={{ marginBottom: "16px" }} />
          <div>Detecting installed tools...</div>
        </div>
      </div>
    );
  }

  if (!status) {
    return null;
  }

  const agents = status.agents;
  const tools = status.tools;

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <h1 style={{ margin: 0, marginBottom: "4px" }}>Setup Wizard</h1>
          <p className="muted" style={{ margin: 0 }}>
            Configure your development environment for Flywheel Gateway
          </p>
        </div>
        <button
          className="btn btn--secondary"
          onClick={handleRefresh}
          disabled={loading}
        >
          {loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
          Refresh
        </button>
      </div>

      {/* Steps */}
      <SetupSteps
        currentStep={currentStep}
        onStepClick={setCurrentStep}
        completedSteps={completedSteps}
      />

      {/* Readiness Score */}
      <section className="grid grid--2" style={{ marginBottom: "24px" }}>
        <ReadinessScore
          ready={isReady}
          agentsAvailable={status.summary.agentsAvailable}
          agentsTotal={status.summary.agentsTotal}
          toolsAvailable={status.summary.toolsAvailable}
          toolsTotal={status.summary.toolsTotal}
        />
        <RecommendationsPanel
          recommendations={status.recommendations}
          missingRequired={status.summary.missingRequired}
        />
      </section>

      {/* Agents Section */}
      <section style={{ marginBottom: "24px" }}>
        <div className="card__header" style={{ marginBottom: "12px" }}>
          <h3 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Zap size={20} />
            AI Coding Agents
          </h3>
          <StatusPill tone={status.summary.agentsAvailable > 0 ? "positive" : "warning"}>
            {status.summary.agentsAvailable} / {status.summary.agentsTotal} available
          </StatusPill>
        </div>
        <div className="grid grid--2">
          {agents.map((agent) => (
            <ToolCard key={agent.name} cli={agent} />
          ))}
        </div>
      </section>

      {/* Tools Section */}
      <section>
        <div className="card__header" style={{ marginBottom: "12px" }}>
          <h3 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Terminal size={20} />
            Developer Tools
          </h3>
          <StatusPill tone={status.summary.toolsAvailable >= 2 ? "positive" : "warning"}>
            {status.summary.toolsAvailable} / {status.summary.toolsTotal} installed
          </StatusPill>
        </div>
        <div className="grid grid--2">
          {tools.map((tool) => (
            <ToolCard
              key={tool.name}
              cli={tool}
              onInstall={() => handleInstall(tool.name)}
              installing={installingTool === tool.name}
            />
          ))}
        </div>
      </section>

      {/* Quick Links */}
      <section style={{ marginTop: "24px" }}>
        <div className="card">
          <div className="card__header">
            <h3>Documentation</h3>
          </div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <a
              href="https://docs.flywheel.dev/getting-started"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--ghost"
            >
              <ExternalLink size={16} />
              Getting Started
            </a>
            <a
              href="https://docs.flywheel.dev/agents"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--ghost"
            >
              <ExternalLink size={16} />
              Agent Setup
            </a>
            <a
              href="https://docs.flywheel.dev/tools"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--ghost"
            >
              <ExternalLink size={16} />
              Tool Reference
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
