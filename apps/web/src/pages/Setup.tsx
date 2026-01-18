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
  TOOL_DISPLAY_INFO,
  useInstallTool,
  useReadiness,
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
    cli.name,
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
              backgroundColor: cli.available
                ? display.color
                : "var(--color-surface-3)",
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
            <div
              style={{
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {display.displayName}
              {cli.available ? (
                <CheckCircle
                  size={14}
                  style={{ color: "var(--color-green-500)" }}
                />
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
      <div
        className="card"
        style={{ backgroundColor: "var(--color-green-50)" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <CheckCircle size={24} style={{ color: "var(--color-green-500)" }} />
          <div>
            <div style={{ fontWeight: 500 }}>All systems ready!</div>
            <div className="muted">
              Your setup is complete and ready to use.
            </div>
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
            <ChevronRight
              size={16}
              style={{ marginTop: "2px", flexShrink: 0 }}
            />
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

function SetupSteps({
  currentStep,
  onStepClick,
  completedSteps,
}: SetupStepsProps) {
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
// Step Content Components
// ============================================================================

interface DetectStepContentProps {
  agents: DetectedCLI[];
  tools: DetectedCLI[];
  summary: {
    agentsAvailable: number;
    agentsTotal: number;
    toolsAvailable: number;
    toolsTotal: number;
  };
  isReady: boolean;
  recommendations: string[];
  missingRequired: string[];
  onNext: () => void;
}

function DetectStepContent({
  agents,
  tools,
  summary,
  isReady,
  recommendations,
  missingRequired,
  onNext,
}: DetectStepContentProps) {
  return (
    <motion.div
      key="detect"
      variants={pageSlideVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      {/* Readiness Score */}
      <section className="grid grid--2" style={{ marginBottom: "24px" }}>
        <ReadinessScore
          ready={isReady}
          agentsAvailable={summary.agentsAvailable}
          agentsTotal={summary.agentsTotal}
          toolsAvailable={summary.toolsAvailable}
          toolsTotal={summary.toolsTotal}
        />
        <RecommendationsPanel
          recommendations={recommendations}
          missingRequired={missingRequired}
        />
      </section>

      {/* Agents Section */}
      <section style={{ marginBottom: "24px" }}>
        <div className="card__header" style={{ marginBottom: "12px" }}>
          <h3 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Zap size={20} />
            AI Coding Agents
          </h3>
          <StatusPill
            tone={summary.agentsAvailable > 0 ? "positive" : "warning"}
          >
            {summary.agentsAvailable} / {summary.agentsTotal} available
          </StatusPill>
        </div>
        <motion.div
          className="grid grid--2"
          variants={listContainerVariants}
          initial="hidden"
          animate="visible"
        >
          {agents.map((agent, i) => (
            <ToolCard key={agent.name} cli={agent} index={i} />
          ))}
        </motion.div>
      </section>

      {/* Tools Section */}
      <section style={{ marginBottom: "24px" }}>
        <div className="card__header" style={{ marginBottom: "12px" }}>
          <h3 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Terminal size={20} />
            Developer Tools
          </h3>
          <StatusPill
            tone={summary.toolsAvailable >= 2 ? "positive" : "warning"}
          >
            {summary.toolsAvailable} / {summary.toolsTotal} installed
          </StatusPill>
        </div>
        <motion.div
          className="grid grid--2"
          variants={listContainerVariants}
          initial="hidden"
          animate="visible"
        >
          {tools.map((tool, i) => (
            <ToolCard key={tool.name} cli={tool} index={i} />
          ))}
        </motion.div>
      </section>

      {/* Next button */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginTop: "24px",
        }}
      >
        <button className="btn btn--primary" onClick={onNext}>
          Continue to Install
          <ArrowRight size={16} />
        </button>
      </div>
    </motion.div>
  );
}

interface InstallStepContentProps {
  tools: DetectedCLI[];
  onInstall: (tool: string) => void;
  installingTool: string | null;
  onNext: () => void;
  onBack: () => void;
}

function InstallStepContent({
  tools,
  onInstall,
  installingTool,
  onNext,
  onBack,
}: InstallStepContentProps) {
  const missingTools = tools.filter((t) => !t.available);
  const installedTools = tools.filter((t) => t.available);

  return (
    <motion.div
      key="install"
      variants={pageSlideVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <div className="card" style={{ marginBottom: "24px" }}>
        <div className="card__header">
          <h3 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Download size={20} />
            Install Missing Tools
          </h3>
          <StatusPill tone={missingTools.length === 0 ? "positive" : "warning"}>
            {missingTools.length} missing
          </StatusPill>
        </div>

        {missingTools.length === 0 ? (
          <motion.div
            variants={fadeVariants}
            initial="hidden"
            animate="visible"
            style={{
              textAlign: "center",
              padding: "32px",
              color: "var(--color-green-600)",
            }}
          >
            <CheckCircle size={48} style={{ marginBottom: "12px" }} />
            <div style={{ fontWeight: 500 }}>All tools are installed!</div>
            <div className="muted" style={{ marginTop: "4px" }}>
              Your environment is ready to use.
            </div>
          </motion.div>
        ) : (
          <motion.div
            variants={listContainerVariants}
            initial="hidden"
            animate="visible"
            style={{ display: "flex", flexDirection: "column", gap: "12px" }}
          >
            {missingTools.map((tool, i) => (
              <ToolCard
                key={tool.name}
                cli={tool}
                onInstall={() => onInstall(tool.name)}
                installing={installingTool === tool.name}
                index={i}
              />
            ))}
          </motion.div>
        )}
      </div>

      {installedTools.length > 0 && (
        <div className="card" style={{ marginBottom: "24px" }}>
          <div className="card__header">
            <h3>Already Installed</h3>
            <StatusPill tone="positive">
              {installedTools.length} tools
            </StatusPill>
          </div>
          <motion.div
            variants={listContainerVariants}
            initial="hidden"
            animate="visible"
            className="grid grid--2"
          >
            {installedTools.map((tool, i) => (
              <ToolCard key={tool.name} cli={tool} index={i} />
            ))}
          </motion.div>
        </div>
      )}

      {/* Navigation */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: "24px",
        }}
      >
        <button className="btn btn--ghost" onClick={onBack}>
          Back
        </button>
        <button className="btn btn--primary" onClick={onNext}>
          Continue to Verify
          <ArrowRight size={16} />
        </button>
      </div>
    </motion.div>
  );
}

interface VerifyStepContentProps {
  status: {
    ready: boolean;
    agents: DetectedCLI[];
    tools: DetectedCLI[];
    summary: {
      agentsAvailable: number;
      agentsTotal: number;
      toolsAvailable: number;
      toolsTotal: number;
    };
  };
  onRefresh: () => void;
  loading: boolean;
  onBack: () => void;
}

function VerifyStepContent({
  status,
  onRefresh,
  loading,
  onBack,
}: VerifyStepContentProps) {
  const allCLIs = [...status.agents, ...status.tools];
  const availableCLIs = allCLIs.filter((cli) => cli.available);
  const totalAvailable = availableCLIs.length;
  const total = allCLIs.length;

  return (
    <motion.div
      key="verify"
      variants={pageSlideVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <div className="card" style={{ marginBottom: "24px" }}>
        <div className="card__header">
          <h3 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Shield size={20} />
            Verification Results
          </h3>
          <button
            className="btn btn--sm btn--secondary"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Re-verify
          </button>
        </div>

        {status.ready ? (
          <motion.div
            variants={fadeVariants}
            initial="hidden"
            animate="visible"
            style={{
              textAlign: "center",
              padding: "48px 24px",
              backgroundColor: "var(--color-green-50)",
              borderRadius: "8px",
            }}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
            >
              <PartyPopper
                size={64}
                style={{
                  color: "var(--color-green-500)",
                  marginBottom: "16px",
                }}
              />
            </motion.div>
            <div
              style={{
                fontSize: "24px",
                fontWeight: 600,
                color: "var(--color-green-700)",
              }}
            >
              Setup Complete!
            </div>
            <div className="muted" style={{ marginTop: "8px" }}>
              Your Flywheel Gateway environment is fully configured and ready to
              use.
            </div>
            <div
              style={{
                marginTop: "16px",
                fontSize: "14px",
                color: "var(--color-green-600)",
              }}
            >
              {totalAvailable} / {total} components available
            </div>
          </motion.div>
        ) : (
          <motion.div
            variants={fadeVariants}
            initial="hidden"
            animate="visible"
            style={{
              textAlign: "center",
              padding: "32px",
              backgroundColor: "var(--color-amber-50)",
              borderRadius: "8px",
            }}
          >
            <AlertCircle
              size={48}
              style={{ color: "var(--color-amber-500)", marginBottom: "12px" }}
            />
            <div style={{ fontWeight: 500, color: "var(--color-amber-700)" }}>
              Some components are missing
            </div>
            <div className="muted" style={{ marginTop: "4px" }}>
              {totalAvailable} / {total} components available. Go back to
              install missing tools.
            </div>
          </motion.div>
        )}
      </div>

      {/* Component Summary */}
      <div className="card" style={{ marginBottom: "24px" }}>
        <div className="card__header">
          <h3>Component Summary</h3>
        </div>
        <motion.div
          variants={listContainerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid--2"
        >
          {allCLIs.map((cli, i) => (
            <ToolCard key={cli.name} cli={cli} index={i} />
          ))}
        </motion.div>
      </div>

      {/* Quick Links */}
      <div className="card">
        <div className="card__header">
          <h3>Next Steps</h3>
        </div>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <a href="/" className="btn btn--primary">
            Go to Dashboard
            <ArrowRight size={16} />
          </a>
          <a
            href="https://docs.flywheel.dev/getting-started"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn--ghost"
          >
            <ExternalLink size={16} />
            Getting Started Guide
          </a>
          <a
            href="https://docs.flywheel.dev/agents"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn--ghost"
          >
            <ExternalLink size={16} />
            Agent Documentation
          </a>
        </div>
      </div>

      {/* Back button */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-start",
          marginTop: "24px",
        }}
      >
        <button className="btn btn--ghost" onClick={onBack}>
          Back
        </button>
      </div>
    </motion.div>
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

  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    tool: string | null;
  }>({ open: false, tool: null });

  // Open confirmation dialog before install
  const handleInstallRequest = useCallback((tool: string) => {
    setConfirmModal({ open: true, tool });
  }, []);

  // Perform the actual install after confirmation
  const handleConfirmInstall = useCallback(async () => {
    const tool = confirmModal.tool;
    if (!tool) return;

    setConfirmModal({ open: false, tool: null });
    setInstallingTool(tool);

    try {
      await install(tool, "easy", true);
      // Refresh detection after install
      await refresh(true);
      setInstallingTool(null);
    } catch {
      // Error is handled by the hook
      setInstallingTool(null);
    }
  }, [confirmModal.tool, install, refresh]);

  const handleRefresh = useCallback(async () => {
    await refresh(true);
    if (!completedSteps.includes("detect")) {
      setCompletedSteps((prev) => [...prev, "detect"]);
    }
  }, [refresh, completedSteps]);

  const handleNextStep = useCallback(() => {
    if (currentStep === "detect") {
      setCompletedSteps((prev) =>
        prev.includes("detect") ? prev : [...prev, "detect"],
      );
      setCurrentStep("install");
    } else if (currentStep === "install") {
      setCompletedSteps((prev) =>
        prev.includes("install") ? prev : [...prev, "install"],
      );
      setCurrentStep("verify");
    }
  }, [currentStep]);

  const handleBackStep = useCallback(() => {
    if (currentStep === "verify") {
      setCurrentStep("install");
    } else if (currentStep === "install") {
      setCurrentStep("detect");
    }
  }, [currentStep]);

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
              <div style={{ fontWeight: 500 }}>Error loading setup status</div>
              <div className="muted">{error}</div>
            </div>
          </div>
          <button
            className="btn btn--secondary"
            onClick={() => refresh()}
            style={{ marginTop: "16px" }}
          >
            <RefreshCw size={16} />
            Retry
          </button>
        </motion.div>
      </div>
    );
  }

  if (loading && !status) {
    return (
      <div className="page">
        <motion.div
          className="card"
          style={{ textAlign: "center", padding: "48px" }}
          variants={fadeVariants}
          initial="hidden"
          animate="visible"
        >
          <Loader2
            size={32}
            className="spin"
            style={{ marginBottom: "16px" }}
          />
          <div>Detecting installed tools...</div>
        </motion.div>
      </div>
    );
  }

  if (!status) {
    return null;
  }

  const agents = status.agents;
  const tools = status.tools;
  const toolDisplayInfo = confirmModal.tool
    ? getToolDisplayInfo(confirmModal.tool)
    : null;

  return (
    <div className="page">
      {/* Header */}
      <motion.div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
        }}
        variants={fadeVariants}
        initial="hidden"
        animate="visible"
      >
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
          {loading ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          Refresh
        </button>
      </motion.div>

      {/* Steps */}
      <SetupSteps
        currentStep={currentStep}
        onStepClick={setCurrentStep}
        completedSteps={completedSteps}
      />

      {/* Step Content with Animations */}
      <AnimatePresence mode="wait">
        {currentStep === "detect" && (
          <DetectStepContent
            agents={agents}
            tools={tools}
            summary={status.summary}
            isReady={isReady}
            recommendations={status.recommendations}
            missingRequired={status.summary.missingRequired}
            onNext={handleNextStep}
          />
        )}

        {currentStep === "install" && (
          <InstallStepContent
            tools={tools}
            onInstall={handleInstallRequest}
            installingTool={installingTool}
            onNext={handleNextStep}
            onBack={handleBackStep}
          />
        )}

        {currentStep === "verify" && (
          <VerifyStepContent
            status={status}
            onRefresh={handleRefresh}
            loading={loading}
            onBack={handleBackStep}
          />
        )}
      </AnimatePresence>

      {/* Install Confirmation Modal */}
      <ConfirmModal
        open={confirmModal.open}
        onClose={() => setConfirmModal({ open: false, tool: null })}
        onConfirm={handleConfirmInstall}
        title={`Install ${toolDisplayInfo?.displayName || confirmModal.tool}?`}
        message={`This will install ${toolDisplayInfo?.displayName || confirmModal.tool} using easy mode. The installation will be verified after completion. Do you want to proceed?`}
        confirmLabel="Install"
        cancelLabel="Cancel"
        loading={installing}
      />
    </div>
  );
}
