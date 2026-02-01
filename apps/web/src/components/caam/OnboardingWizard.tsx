/**
 * OnboardingWizard - BYOA onboarding guidance component.
 *
 * Provides step-by-step guidance for setting up AI provider accounts with:
 * - Prerequisites and requirements
 * - Security notes and data handling explanations
 * - Warnings about common pitfalls
 * - Progress tracking
 */

import { useCallback, useState } from "react";
import {
  AUTH_MODE_LABELS,
  type AuthMode,
  PROVIDER_INFO,
  PROVIDER_ONBOARDING,
  type ProviderId,
  useByoaStatus,
  useCreateProfile,
  useOnboardingGuidance,
} from "../../hooks/useCAAM";
import { DeviceCodeFlow } from "./DeviceCodeFlow";

// ============================================================================
// Sub-components
// ============================================================================

interface ProgressBarProps {
  percentage: number;
}

function ProgressBar({ percentage }: ProgressBarProps) {
  return (
    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
      <div
        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

interface ChecklistItemProps {
  label: string;
  completed: boolean;
  description?: string;
}

function ChecklistItem({ label, completed, description }: ChecklistItemProps) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div
        className={`
          w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5
          ${completed ? "bg-green-500 text-white" : "border-2 border-gray-300 dark:border-gray-600"}
        `}
      >
        {completed && (
          <svg
            aria-hidden="true"
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}
      </div>
      <div>
        <span
          className={`font-medium ${completed ? "text-gray-500 dark:text-gray-400 line-through" : "text-gray-900 dark:text-white"}`}
        >
          {label}
        </span>
        {description && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

interface InfoCardProps {
  title: string;
  items: string[];
  variant: "info" | "warning" | "security";
}

function InfoCard({ title, items, variant }: InfoCardProps) {
  const config = {
    info: {
      bg: "bg-blue-50 dark:bg-blue-900/20",
      border: "border-blue-200 dark:border-blue-800",
      title: "text-blue-900 dark:text-blue-200",
      text: "text-blue-700 dark:text-blue-300",
      icon: (
        <svg
          aria-hidden="true"
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
    },
    warning: {
      bg: "bg-yellow-50 dark:bg-yellow-900/20",
      border: "border-yellow-200 dark:border-yellow-800",
      title: "text-yellow-900 dark:text-yellow-200",
      text: "text-yellow-700 dark:text-yellow-300",
      icon: (
        <svg
          aria-hidden="true"
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      ),
    },
    security: {
      bg: "bg-green-50 dark:bg-green-900/20",
      border: "border-green-200 dark:border-green-800",
      title: "text-green-900 dark:text-green-200",
      text: "text-green-700 dark:text-green-300",
      icon: (
        <svg
          aria-hidden="true"
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
          />
        </svg>
      ),
    },
  };

  const c = config[variant];

  return (
    <div className={`${c.bg} ${c.border} border rounded-lg p-4`}>
      <div className={`flex items-center gap-2 ${c.title} mb-2`}>
        {c.icon}
        <h4 className="font-medium">{title}</h4>
      </div>
      <ul className={`${c.text} text-sm space-y-1.5`}>
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="text-current">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface AuthModeCardProps {
  mode: AuthMode;
  provider: ProviderId;
  selected: boolean;
  onSelect: () => void;
  recommended?: boolean;
}

function AuthModeCard({
  mode,
  provider,
  selected,
  onSelect,
  recommended,
}: AuthModeCardProps) {
  const descriptions: Record<AuthMode, string> = {
    oauth_browser:
      "Sign in via browser. Best for interactive sessions and subscriptions.",
    device_code:
      "Enter a code on a separate device. Works well for headless/server environments.",
    api_key: `Direct API ${"key"}. Simple but requires manual key management.`,
    vertex_adc:
      "Use Google Cloud Application Default Credentials. Best for GCP environments.",
  };

  const available = PROVIDER_INFO[provider].authModes.includes(mode);
  if (!available) return null;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`
        w-full text-left p-4 rounded-lg border-2 transition-all
        ${
          selected
            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
            : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
        }
      `}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900 dark:text-white">
              {AUTH_MODE_LABELS[mode]}
            </span>
            {recommended && (
              <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full font-medium">
                RECOMMENDED
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {descriptions[mode]}
          </p>
        </div>
        <div
          className={`
            w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0
            ${selected ? "border-blue-500 bg-blue-500" : "border-gray-300 dark:border-gray-600"}
          `}
        >
          {selected && (
            <svg
              aria-hidden="true"
              className="w-3 h-3 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M5 13l4 4L19 7"
              />
            </svg>
          )}
        </div>
      </div>
    </button>
  );
}

// ============================================================================
// Wizard Steps
// ============================================================================

type WizardStep =
  | "select-provider"
  | "select-auth"
  | "review"
  | "authenticate"
  | "complete";

interface WizardState {
  step: WizardStep;
  provider: ProviderId | null;
  authMode: AuthMode | null;
  profileName: string;
}

// ============================================================================
// Main Component
// ============================================================================

interface OnboardingWizardProps {
  initialProvider?: ProviderId;
  workspaceId?: string;
  onComplete?: () => void;
  onCancel?: () => void;
}

export function OnboardingWizard({
  initialProvider,
  workspaceId = "default",
  onComplete,
  onCancel,
}: OnboardingWizardProps) {
  const { data: byoaStatus } = useByoaStatus(workspaceId);
  const { create, isLoading: creating } = useCreateProfile();

  const [state, setState] = useState<WizardState>({
    step: initialProvider ? "select-auth" : "select-provider",
    provider: initialProvider ?? null,
    authMode: null,
    profileName: "",
  });

  // Always call hook unconditionally with a fallback provider to satisfy Rules of Hooks
  const guidanceResult = useOnboardingGuidance(state.provider ?? "claude");
  // Only use guidance when we have an actual provider selected
  const guidance = state.provider ? guidanceResult : null;

  const setStep = useCallback(
    (step: WizardStep) => setState((s) => ({ ...s, step })),
    [],
  );
  const setProvider = (provider: ProviderId) =>
    setState((s) => ({
      ...s,
      provider,
      profileName: `${PROVIDER_INFO[provider].displayName} Account`,
    }));
  const setAuthMode = (authMode: AuthMode) =>
    setState((s) => ({ ...s, authMode }));
  const setProfileName = (profileName: string) =>
    setState((s) => ({ ...s, profileName }));

  const handleCreateAndAuthenticate = useCallback(async () => {
    if (!state.provider || !state.authMode) return;

    const accountName =
      state.profileName ||
      `${PROVIDER_INFO[state.provider].displayName} Account`;

    try {
      await create({
        workspaceId,
        provider: state.provider,
        name: accountName,
        authMode: state.authMode,
      });
      setStep("authenticate");
    } catch {
      // Error handled by hook
    }
  }, [state, workspaceId, create, setStep]);

  const providerInfo = state.provider ? PROVIDER_INFO[state.provider] : null;
  const onboarding = state.provider
    ? PROVIDER_ONBOARDING[state.provider]
    : null;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg max-w-2xl mx-auto overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 text-white">
        <h2 className="text-xl font-semibold">Add AI Provider Account</h2>
        <p className="text-blue-100 text-sm mt-1">
          {state.step === "select-provider" &&
            "Choose a provider to get started"}
          {state.step === "select-auth" &&
            `Set up ${providerInfo?.displayName}`}
          {state.step === "review" && "Review setup details"}
          {state.step === "authenticate" && "Complete authentication"}
          {state.step === "complete" && "Setup complete!"}
        </p>
      </div>

      {/* Content */}
      <div className="p-6">
        {/* Step: Select Provider */}
        {state.step === "select-provider" && (
          <div className="space-y-4">
            <p className="text-gray-600 dark:text-gray-400">
              Select an AI provider to add to your workspace. You can add
              multiple accounts for failover and load balancing.
            </p>

            {/* Provider Cards */}
            <div className="grid gap-3">
              {(["claude", "codex", "gemini"] as ProviderId[]).map((p) => {
                const info = PROVIDER_INFO[p];
                const isConfigured = byoaStatus?.verifiedProviders.includes(p);

                return (
                  <button
                    type="button"
                    key={p}
                    onClick={() => {
                      setProvider(p);
                      setStep("select-auth");
                    }}
                    className={`
                      flex items-center gap-4 p-4 rounded-lg border-2 text-left transition-all
                      border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-md
                    `}
                  >
                    <div
                      className="w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold text-xl"
                      style={{ backgroundColor: info.color }}
                    >
                      {info.icon}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 dark:text-white">
                          {info.displayName}
                        </span>
                        {isConfigured && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full font-medium">
                            CONFIGURED
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {p === "claude" && "Anthropic's Claude models"}
                        {p === "codex" && "OpenAI's GPT and Codex models"}
                        {p === "gemini" &&
                          "Google's Gemini models via Vertex AI"}
                      </p>
                    </div>
                    <svg
                      aria-hidden="true"
                      className="w-5 h-5 text-gray-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step: Select Auth Mode */}
        {state.step === "select-auth" && state.provider && onboarding && (
          <div className="space-y-6">
            {/* Prerequisites */}
            <InfoCard
              title="Prerequisites"
              items={onboarding.prerequisites}
              variant="info"
            />

            {/* Profile Name */}
            <div>
              <label
                htmlFor="profile-name-input"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Profile Name
              </label>
              <input
                id="profile-name-input"
                type="text"
                value={state.profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder={`My ${providerInfo?.displayName} Account`}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Auth Mode Selection */}
            <fieldset>
              <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Authentication Method
              </legend>
              <div className="space-y-2">
                {(
                  [
                    "device_code",
                    "oauth_browser",
                    "api_key",
                    "vertex_adc",
                  ] as AuthMode[]
                ).map((mode) => (
                  <AuthModeCard
                    key={mode}
                    mode={mode}
                    provider={state.provider!}
                    selected={state.authMode === mode}
                    onSelect={() => setAuthMode(mode)}
                    recommended={mode === "device_code"}
                  />
                ))}
              </div>
            </fieldset>

            {/* Warnings */}
            <InfoCard
              title="Important Notes"
              items={onboarding.warnings}
              variant="warning"
            />
          </div>
        )}

        {/* Step: Review */}
        {state.step === "review" && state.provider && onboarding && (
          <div className="space-y-6">
            {/* Summary */}
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
              <h4 className="font-medium text-gray-900 dark:text-white mb-3">
                Setup Summary
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">
                    Provider
                  </span>
                  <span className="text-gray-900 dark:text-white font-medium">
                    {providerInfo?.displayName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">
                    Profile Name
                  </span>
                  <span className="text-gray-900 dark:text-white font-medium">
                    {state.profileName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">
                    Auth Method
                  </span>
                  <span className="text-gray-900 dark:text-white font-medium">
                    {state.authMode
                      ? AUTH_MODE_LABELS[state.authMode]
                      : "Not selected"}
                  </span>
                </div>
              </div>
            </div>

            {/* Security Notes */}
            <InfoCard
              title="Security & Data Handling"
              items={onboarding.securityNotes}
              variant="security"
            />

            {/* Steps Checklist */}
            {guidance && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-gray-900 dark:text-white">
                    Setup Progress
                  </h4>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {guidance.completionPercentage}%
                  </span>
                </div>
                <ProgressBar percentage={guidance.completionPercentage} />
                <div className="mt-3">
                  {guidance.guidance.steps.map((step) => (
                    <ChecklistItem
                      key={step.id}
                      label={step.title}
                      completed={step.completed}
                      description={step.description}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step: Authenticate */}
        {state.step === "authenticate" && state.provider && (
          <DeviceCodeFlow
            provider={state.provider}
            workspaceId={workspaceId}
            onSuccess={() => setStep("complete")}
            onCancel={() => setStep("review")}
          />
        )}

        {/* Step: Complete */}
        {state.step === "complete" && (
          <div className="text-center py-8">
            <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                aria-hidden="true"
                className="w-10 h-10 text-green-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              Account Added Successfully!
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              Your {providerInfo?.displayName} account is now connected and
              ready to use.
            </p>
            <button
              type="button"
              onClick={onComplete}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Done
            </button>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      {state.step !== "authenticate" && state.step !== "complete" && (
        <div className="flex justify-between gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <button
            type="button"
            onClick={() => {
              if (state.step === "select-provider") {
                onCancel?.();
              } else if (state.step === "select-auth") {
                setStep("select-provider");
              } else if (state.step === "review") {
                setStep("select-auth");
              }
            }}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            {state.step === "select-provider" ? "Cancel" : "Back"}
          </button>

          {state.step === "select-auth" && (
            <button
              type="button"
              onClick={() => setStep("review")}
              disabled={!state.authMode}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue
            </button>
          )}

          {state.step === "review" && (
            <button
              type="button"
              onClick={handleCreateAndAuthenticate}
              disabled={creating}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
            >
              {creating ? "Creating..." : "Start Authentication"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
