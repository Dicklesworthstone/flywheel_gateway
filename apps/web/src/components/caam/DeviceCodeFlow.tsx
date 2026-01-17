/**
 * DeviceCodeFlow - Step-by-step device code authentication component.
 *
 * Provides guided UI for OAuth device code flow with:
 * - Copy-to-clipboard for codes
 * - Verification URL handling
 * - Countdown timer / expiry visibility
 * - Polling status with visual feedback
 * - Cancel/retry actions
 * - Clear error recovery
 */

import { useCallback, useEffect, useState } from "react";
import {
  type DeviceCodeStatus,
  PROVIDER_INFO,
  type ProviderId,
  useDeviceCodeFlow,
} from "../../hooks/useCAAM";

// ============================================================================
// Sub-components
// ============================================================================

interface StepIndicatorProps {
  currentStep: number;
  steps: string[];
}

function StepIndicator({ currentStep, steps }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {steps.map((step, index) => (
        <div key={step} className="flex items-center">
          <div
            className={`
              w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
              transition-colors duration-200
              ${
                index < currentStep
                  ? "bg-green-500 text-white"
                  : index === currentStep
                    ? "bg-blue-500 text-white"
                    : "bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
              }
            `}
          >
            {index < currentStep ? (
              <svg
                aria-hidden="true"
                className="w-4 h-4"
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
            ) : (
              index + 1
            )}
          </div>
          {index < steps.length - 1 && (
            <div
              className={`
                w-8 h-0.5 mx-1
                ${
                  index < currentStep
                    ? "bg-green-500"
                    : "bg-gray-200 dark:bg-gray-700"
                }
              `}
            />
          )}
        </div>
      ))}
    </div>
  );
}

interface CopyButtonProps {
  text: string;
  label?: string;
}

function CopyButton({ text, label = "Copy" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`
        px-3 py-1.5 text-sm font-medium rounded-md transition-colors
        ${
          copied
            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
            : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        }
      `}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

interface CountdownTimerProps {
  seconds: number;
  total: number;
}

function CountdownTimer({ seconds, total }: CountdownTimerProps) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const percentage = (seconds / total) * 100;
  const isLow = seconds < 60;

  return (
    <div className="flex items-center gap-3">
      <div className="relative w-12 h-12">
        <svg aria-hidden="true" className="w-12 h-12 transform -rotate-90">
          <circle
            className="text-gray-200 dark:text-gray-700"
            strokeWidth="3"
            stroke="currentColor"
            fill="transparent"
            r="20"
            cx="24"
            cy="24"
          />
          <circle
            className={isLow ? "text-red-500" : "text-blue-500"}
            strokeWidth="3"
            strokeDasharray={125.6}
            strokeDashoffset={125.6 - (percentage / 100) * 125.6}
            strokeLinecap="round"
            stroke="currentColor"
            fill="transparent"
            r="20"
            cx="24"
            cy="24"
          />
        </svg>
      </div>
      <div>
        <div
          className={`text-lg font-mono font-semibold ${isLow ? "text-red-500" : "text-gray-900 dark:text-white"}`}
        >
          {minutes}:{secs.toString().padStart(2, "0")}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {isLow ? "Expiring soon!" : "Time remaining"}
        </div>
      </div>
    </div>
  );
}

interface StatusBadgeProps {
  status: DeviceCodeStatus;
}

function StatusBadge({ status }: StatusBadgeProps) {
  const config: Record<
    DeviceCodeStatus,
    { label: string; color: string; animate?: boolean }
  > = {
    idle: { label: "Ready", color: "bg-gray-100 text-gray-600" },
    starting: {
      label: "Starting...",
      color: "bg-blue-100 text-blue-600",
      animate: true,
    },
    awaiting_user: {
      label: "Awaiting Action",
      color: "bg-yellow-100 text-yellow-700",
    },
    polling: {
      label: "Checking...",
      color: "bg-blue-100 text-blue-600",
      animate: true,
    },
    verifying: {
      label: "Verifying...",
      color: "bg-blue-100 text-blue-600",
      animate: true,
    },
    success: { label: "Connected", color: "bg-green-100 text-green-700" },
    error: { label: "Error", color: "bg-red-100 text-red-700" },
    expired: { label: "Expired", color: "bg-orange-100 text-orange-700" },
    cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-600" },
  };

  const { label, color, animate } = config[status];

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full
        ${color}
      `}
    >
      {animate && (
        <span className="w-2 h-2 bg-current rounded-full animate-pulse" />
      )}
      {label}
    </span>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface DeviceCodeFlowProps {
  provider: ProviderId;
  workspaceId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function DeviceCodeFlow({
  provider,
  workspaceId = "default",
  onSuccess,
  onCancel,
}: DeviceCodeFlowProps) {
  const {
    status,
    challenge,
    error,
    remainingSeconds,
    start,
    complete,
    cancel,
    retry,
  } = useDeviceCodeFlow();

  const providerInfo = PROVIDER_INFO[provider];
  const steps = ["Start", "Authorize", "Verify"];

  // Map status to step number
  const currentStep =
    status === "idle" || status === "starting"
      ? 0
      : status === "awaiting_user" || status === "polling"
        ? 1
        : status === "verifying" || status === "success"
          ? 2
          : 0;

  // Auto-start on mount
  useEffect(() => {
    if (status === "idle") {
      start(provider, workspaceId);
    }
  }, [provider, workspaceId, status, start]);

  // Call onSuccess when verification succeeds
  useEffect(() => {
    if (status === "success" && onSuccess) {
      const timer = setTimeout(onSuccess, 1500);
      return () => clearTimeout(timer);
    }
  }, [status, onSuccess]);

  const handleCancel = useCallback(() => {
    cancel();
    onCancel?.();
  }, [cancel, onCancel]);

  const handleOpenUrl = () => {
    if (challenge?.verificationUrl) {
      window.open(challenge.verificationUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg p-6 max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-lg"
            style={{ backgroundColor: providerInfo.color }}
          >
            {providerInfo.icon}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">
              Connect {providerInfo.displayName}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Device Code Authentication
            </p>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Step Indicator */}
      <StepIndicator currentStep={currentStep} steps={steps} />

      {/* Content based on status */}
      <div className="space-y-4">
        {/* Starting State */}
        {status === "starting" && (
          <div className="flex flex-col items-center py-8">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-gray-600 dark:text-gray-400">
              Initializing authentication...
            </p>
          </div>
        )}

        {/* Awaiting User Action */}
        {(status === "awaiting_user" || status === "polling") && challenge && (
          <>
            {/* Instructions */}
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
              <h4 className="font-medium text-blue-900 dark:text-blue-200 mb-2">
                Instructions
              </h4>
              <ol className="text-sm text-blue-800 dark:text-blue-300 space-y-2">
                <li className="flex gap-2">
                  <span className="font-semibold">1.</span>
                  <span>Open the verification URL below</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold">2.</span>
                  <span>Enter the code when prompted</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold">3.</span>
                  <span>Sign in and authorize access</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold">4.</span>
                  <span>Click "I've Authorized" below</span>
                </li>
              </ol>
            </div>

            {/* Code Display */}
            {challenge.userCode && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Your Code
                  </span>
                  <CopyButton text={challenge.userCode} label="Copy Code" />
                </div>
                <div className="font-mono text-2xl font-bold tracking-wider text-center text-gray-900 dark:text-white py-2">
                  {challenge.userCode}
                </div>
              </div>
            )}

            {/* Verification URL */}
            {challenge.verificationUrl && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Verification URL
                  </span>
                  <CopyButton
                    text={challenge.verificationUrl}
                    label="Copy URL"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleOpenUrl}
                  className="w-full text-left text-blue-600 dark:text-blue-400 hover:underline text-sm break-all"
                >
                  {challenge.verificationUrl}
                </button>
              </div>
            )}

            {/* Timer */}
            <div className="flex items-center justify-between pt-2">
              <CountdownTimer
                seconds={remainingSeconds}
                total={challenge.expiresInSeconds}
              />
              <button
                type="button"
                onClick={handleOpenUrl}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                Open URL
              </button>
            </div>
          </>
        )}

        {/* Verifying State */}
        {status === "verifying" && (
          <div className="flex flex-col items-center py-8">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-gray-600 dark:text-gray-400">
              Verifying your authorization...
            </p>
          </div>
        )}

        {/* Success State */}
        {status === "success" && (
          <div className="flex flex-col items-center py-8">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
              <svg
                aria-hidden="true"
                className="w-8 h-8 text-green-500"
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
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              Connected Successfully!
            </h4>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Your {providerInfo.displayName} account is now linked
            </p>
          </div>
        )}

        {/* Error State */}
        {status === "error" && (
          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                <svg
                  aria-hidden="true"
                  className="w-4 h-4 text-red-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </div>
              <div>
                <h4 className="font-medium text-red-900 dark:text-red-200">
                  Authentication Failed
                </h4>
                <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                  {error?.message || "An unexpected error occurred"}
                </p>
                <div className="mt-3">
                  <h5 className="text-sm font-medium text-red-800 dark:text-red-200 mb-1">
                    Common fixes:
                  </h5>
                  <ul className="text-sm text-red-700 dark:text-red-300 list-disc list-inside">
                    <li>Ensure you completed authorization in the browser</li>
                    <li>Check that the code wasn't expired</li>
                    <li>Verify you have API access enabled</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Expired State */}
        {status === "expired" && (
          <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4 text-center">
            <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg
                aria-hidden="true"
                className="w-6 h-6 text-orange-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h4 className="font-medium text-orange-900 dark:text-orange-200">
              Code Expired
            </h4>
            <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
              The authentication code has expired. Please try again.
            </p>
          </div>
        )}

        {/* Cancelled State */}
        {status === "cancelled" && (
          <div className="text-center py-6 text-gray-500 dark:text-gray-400">
            Authentication cancelled.
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
        {(status === "awaiting_user" || status === "polling") && (
          <>
            <button
              type="button"
              onClick={handleCancel}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={complete}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
            >
              I've Authorized
            </button>
          </>
        )}

        {(status === "error" ||
          status === "expired" ||
          status === "cancelled") && (
          <>
            <button
              type="button"
              onClick={handleCancel}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors font-medium"
            >
              Close
            </button>
            <button
              type="button"
              onClick={retry}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Try Again
            </button>
          </>
        )}

        {status === "success" && (
          <button
            type="button"
            onClick={onSuccess}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}
