/**
 * Accounts Page - CAAM (Coding Agent Account Manager) Dashboard.
 *
 * Provides comprehensive interface for managing BYOA accounts:
 * - BYOA status overview
 * - Account profiles by provider
 * - Onboarding wizard for new accounts
 * - Pool management and rotation
 */

import { Key, Plus, RefreshCw, Shield, Users, Zap } from "lucide-react";
import { useState } from "react";
import { OnboardingWizard, ProfileList } from "../components/caam";
import { Modal } from "../components/ui/Modal";
import { StatusPill } from "../components/ui/StatusPill";
import {
  type AccountProfile,
  PROVIDER_INFO,
  type ProviderId,
  useByoaStatus,
  useProfiles,
  useRotatePool,
} from "../hooks/useCAAM";

// ============================================================================
// Quick Stat Card Component
// ============================================================================

interface QuickStatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger";
}

function QuickStatCard({
  title,
  value,
  icon,
  variant = "default",
}: QuickStatCardProps) {
  const variantClass =
    variant !== "default"
      ? variant === "success"
        ? "card--success"
        : variant === "warning"
          ? "card--warning"
          : "card--danger"
      : "";

  return (
    <div className={`card card--compact ${variantClass}`}>
      <div className="card__header">
        <div className="eyebrow">{title}</div>
        <span className="card__icon">{icon}</span>
      </div>
      <div className="metric">{value}</div>
    </div>
  );
}

// ============================================================================
// Provider Status Card
// ============================================================================

interface ProviderStatusCardProps {
  provider: ProviderId;
  profileCount: number;
  verifiedCount: number;
  onAddProfile: () => void;
  onRotate: () => void;
  isRotating: boolean;
}

function ProviderStatusCard({
  provider,
  profileCount,
  verifiedCount,
  onAddProfile,
  onRotate,
  isRotating,
}: ProviderStatusCardProps) {
  const info = PROVIDER_INFO[provider];
  const isReady = verifiedCount > 0;

  return (
    <div
      className="card"
      style={{
        borderLeft: `4px solid ${info.color}`,
      }}
    >
      <div className="card__header">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "8px",
              backgroundColor: info.color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontWeight: "bold",
              fontSize: "18px",
            }}
          >
            {info.icon}
          </div>
          <div>
            <h4 style={{ margin: 0 }}>{info.displayName}</h4>
            <span className="muted">
              {profileCount} profile{profileCount !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <StatusPill tone={isReady ? "positive" : "warning"}>
          {isReady ? "Ready" : "Not Configured"}
        </StatusPill>
      </div>

      <div
        style={{
          display: "flex",
          gap: "8px",
          marginTop: "16px",
        }}
      >
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={onAddProfile}
        >
          <Plus size={14} />
          Add Account
        </button>
        {profileCount > 1 && (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={onRotate}
            disabled={isRotating}
          >
            <RefreshCw size={14} className={isRotating ? "animate-spin" : ""} />
            Rotate
          </button>
        )}
        <a
          href={info.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn--ghost btn--sm"
        >
          Docs
        </a>
      </div>
    </div>
  );
}

// ============================================================================
// Main Accounts Page Component
// ============================================================================

export function AccountsPage() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingProvider, setOnboardingProvider] = useState<
    ProviderId | undefined
  >();

  // Data hooks
  const { data: byoaStatus, refetch: refetchStatus } = useByoaStatus();
  const { data: profiles, refetch: refetchProfiles } = useProfiles();
  const { rotate, isLoading: isRotating } = useRotatePool();

  // Group profiles by provider
  const profilesByProvider = profiles?.reduce(
    (acc, profile) => {
      const key = profile.provider;
      if (!acc[key]) acc[key] = [];
      acc[key].push(profile);
      return acc;
    },
    {} as Record<ProviderId, typeof profiles>,
  );

  const handleAddProfile = (provider?: ProviderId) => {
    setOnboardingProvider(provider);
    setShowOnboarding(true);
  };

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    setOnboardingProvider(undefined);
    refetchStatus();
    refetchProfiles();
  };

  const handleRotate = async (provider: ProviderId) => {
    await rotate(provider);
    refetchProfiles();
  };

  const handleReauth = (profile: AccountProfile) => {
    setOnboardingProvider(profile.provider);
    setShowOnboarding(true);
  };

  // Count stats
  const totalProfiles = profiles?.length ?? 0;
  const verifiedProfiles =
    profiles?.filter((p) => p.status === "verified").length ?? 0;
  const cooldownProfiles =
    profiles?.filter((p) => p.status === "cooldown").length ?? 0;
  const errorProfiles =
    profiles?.filter((p) => p.status === "error" || p.status === "expired")
      .length ?? 0;

  return (
    <div className="page">
      {/* Header */}
      <div className="card__header">
        <h2 style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <Key size={28} />
          Account Management
        </h2>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => handleAddProfile()}
        >
          <Plus size={16} />
          Add Account
        </button>
      </div>

      {/* Description */}
      <p className="muted" style={{ marginBottom: "24px" }}>
        Manage your AI provider accounts for BYOA (Bring Your Own Account). Add
        multiple accounts for failover and load balancing across providers.
      </p>

      {/* Quick Stats */}
      <section
        className="grid"
        style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}
      >
        <QuickStatCard
          title="Total Profiles"
          value={totalProfiles}
          icon={<Users size={18} />}
        />
        <QuickStatCard
          title="Verified"
          value={verifiedProfiles}
          icon={<Shield size={18} />}
          variant={verifiedProfiles > 0 ? "success" : "warning"}
        />
        <QuickStatCard
          title="In Cooldown"
          value={cooldownProfiles}
          icon={<RefreshCw size={18} />}
          variant={cooldownProfiles > 0 ? "warning" : "default"}
        />
        <QuickStatCard
          title="Errors"
          value={errorProfiles}
          icon={<Zap size={18} />}
          variant={errorProfiles > 0 ? "danger" : "default"}
        />
      </section>

      {/* BYOA Status Alert */}
      {byoaStatus && !byoaStatus.ready && (
        <div
          className="card"
          style={{
            marginTop: "24px",
            background: "rgba(234, 179, 8, 0.1)",
            borderLeft: "4px solid var(--warning)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <Shield size={24} style={{ color: "var(--warning)" }} />
            <div>
              <h4 style={{ margin: 0 }}>BYOA Not Ready</h4>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                {byoaStatus.recommendedAction ??
                  "Link at least one provider account to enable agent execution"}
              </p>
            </div>
          </div>
        </div>
      )}

      {byoaStatus?.ready && (
        <div
          className="card"
          style={{
            marginTop: "24px",
            background: "rgba(34, 197, 94, 0.1)",
            borderLeft: "4px solid var(--positive)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <Shield size={24} style={{ color: "var(--positive)" }} />
            <div>
              <h4 style={{ margin: 0 }}>BYOA Ready</h4>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                {byoaStatus.verifiedProviders.length} provider
                {byoaStatus.verifiedProviders.length !== 1 ? "s" : ""}{" "}
                configured ({byoaStatus.verifiedProviders.join(", ")}).
                {byoaStatus.recommendedAction &&
                  ` ${byoaStatus.recommendedAction}`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Provider Status Cards */}
      <section style={{ marginTop: "24px" }}>
        <h3 style={{ marginBottom: "16px" }}>Providers</h3>
        <div
          className="grid"
          style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}
        >
          {(["claude", "codex", "gemini"] as ProviderId[]).map((provider) => {
            const providerProfiles = profilesByProvider?.[provider] ?? [];
            const verifiedCount = providerProfiles.filter(
              (p) => p.status === "verified",
            ).length;

            return (
              <ProviderStatusCard
                key={provider}
                provider={provider}
                profileCount={providerProfiles.length}
                verifiedCount={verifiedCount}
                onAddProfile={() => handleAddProfile(provider)}
                onRotate={() => handleRotate(provider)}
                isRotating={isRotating}
              />
            );
          })}
        </div>
      </section>

      {/* Profiles List */}
      <section style={{ marginTop: "32px" }}>
        <h3 style={{ marginBottom: "16px" }}>All Profiles</h3>
        <ProfileList
          workspaceId="default"
          onAddProfile={handleAddProfile}
          onReauth={handleReauth}
        />
      </section>

      {/* Onboarding Modal */}
      <Modal
        open={showOnboarding}
        onClose={() => setShowOnboarding(false)}
        title=""
      >
        <OnboardingWizard
          {...(onboardingProvider !== null &&
            onboardingProvider !== undefined && {
              initialProvider: onboardingProvider,
            })}
          workspaceId="default"
          onComplete={handleOnboardingComplete}
          onCancel={() => setShowOnboarding(false)}
        />
      </Modal>
    </div>
  );
}
