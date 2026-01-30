/**
 * ProfileList - Account profile management component.
 *
 * Displays a list of BYOA profiles with status, health indicators,
 * and actions for managing accounts (activate, delete, edit).
 */

import { useCallback, useState } from "react";
import {
  type AccountProfile,
  AUTH_MODE_LABELS,
  PROVIDER_INFO,
  type ProviderId,
  useActivateProfile,
  useDeleteProfile,
  useProfiles,
  useRotatePool,
} from "../../hooks/useCAAM";
import { Modal } from "../ui/Modal";

// ============================================================================
// Sub-components
// ============================================================================

interface ProviderBadgeProps {
  provider: ProviderId;
  size?: "sm" | "md";
}

function ProviderBadge({ provider, size = "md" }: ProviderBadgeProps) {
  const info = PROVIDER_INFO[provider];
  const sizeClasses = size === "sm" ? "w-6 h-6 text-xs" : "w-8 h-8 text-sm";

  return (
    <div
      className={`${sizeClasses} rounded-lg flex items-center justify-center text-white font-bold`}
      style={{ backgroundColor: info.color }}
      title={info.displayName}
    >
      {info.icon}
    </div>
  );
}

interface StatusIndicatorProps {
  status: AccountProfile["status"];
  healthStatus?: AccountProfile["healthStatus"];
  cooldownUntil?: string;
}

function StatusIndicator({
  status,
  healthStatus,
  cooldownUntil,
}: StatusIndicatorProps) {
  const config: Record<
    AccountProfile["status"],
    { label: string; dotColor: string; bgColor: string }
  > = {
    unlinked: {
      label: "Not Linked",
      dotColor: "bg-gray-400",
      bgColor: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    },
    linked: {
      label: "Linked",
      dotColor: "bg-blue-400",
      bgColor:
        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    },
    verified: {
      label: healthStatus === "warning" ? "Verified (Warning)" : "Verified",
      dotColor:
        healthStatus === "warning"
          ? "bg-yellow-400"
          : healthStatus === "critical"
            ? "bg-red-400"
            : "bg-green-400",
      bgColor:
        healthStatus === "warning"
          ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
          : healthStatus === "critical"
            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
            : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    },
    expired: {
      label: "Expired",
      dotColor: "bg-orange-400",
      bgColor:
        "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
    },
    cooldown: {
      label: "Cooldown",
      dotColor: "bg-yellow-400 animate-pulse",
      bgColor:
        "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
    },
    error: {
      label: "Error",
      dotColor: "bg-red-400",
      bgColor: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    },
  };

  const { label, dotColor, bgColor } = config[status];

  // Calculate remaining cooldown time
  let cooldownText = "";
  if (status === "cooldown" && cooldownUntil) {
    const remaining = new Date(cooldownUntil).getTime() - Date.now();
    if (remaining > 0) {
      const minutes = Math.ceil(remaining / 60000);
      cooldownText = ` (${minutes}m)`;
    }
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full ${bgColor}`}
    >
      <span className={`w-2 h-2 rounded-full ${dotColor}`} />
      {label}
      {cooldownText}
    </span>
  );
}

interface HealthBarProps {
  score: number;
}

function HealthBar({ score }: HealthBarProps) {
  const color =
    score >= 80 ? "bg-green-500" : score >= 50 ? "bg-yellow-500" : "bg-red-500";

  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all duration-300`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 dark:text-gray-400 w-8">
        {score}%
      </span>
    </div>
  );
}

interface ProfileCardProps {
  profile: AccountProfile;
  isActive?: boolean;
  onActivate: () => void;
  onDelete: () => void;
  onReauth: () => void;
}

function ProfileCard({
  profile,
  isActive,
  onActivate,
  onDelete,
  onReauth,
}: ProfileCardProps) {
  const [showMenu, setShowMenu] = useState(false);

  const lastUsed = profile.lastUsedAt
    ? new Date(profile.lastUsedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Never";

  return (
    <div
      className={`
        relative bg-white dark:bg-gray-800 rounded-lg border p-4 transition-shadow
        ${
          isActive
            ? "border-blue-500 shadow-md ring-1 ring-blue-500"
            : "border-gray-200 dark:border-gray-700 hover:shadow-md"
        }
      `}
    >
      {/* Active indicator */}
      {isActive && (
        <div className="absolute -top-2 -right-2 bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
          ACTIVE
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <ProviderBadge provider={profile.provider} />
          <div>
            <h4 className="font-medium text-gray-900 dark:text-white">
              {profile.name}
            </h4>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {AUTH_MODE_LABELS[profile.authMode]}
            </p>
          </div>
        </div>

        {/* Menu button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowMenu(!showMenu)}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
          >
            <svg
              aria-hidden="true"
              className="w-5 h-5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
            </svg>
          </button>

          {showMenu && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-10"
                aria-label="Close menu"
                onClick={() => setShowMenu(false)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setShowMenu(false);
                  }
                }}
              />
              <div className="absolute right-0 mt-1 w-36 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-20">
                {profile.status === "verified" && !isActive && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false);
                      onActivate();
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Set as Active
                  </button>
                )}
                {(profile.status === "unlinked" ||
                  profile.status === "expired" ||
                  profile.status === "error") && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false);
                      onReauth();
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    {profile.status === "unlinked"
                      ? "Link Account"
                      : "Re-authenticate"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setShowMenu(false);
                    onDelete();
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Status and Health */}
      <div className="mt-3 flex items-center justify-between">
        <StatusIndicator
          status={profile.status}
          {...(profile.healthStatus !== undefined && {
            healthStatus: profile.healthStatus,
          })}
          {...(profile.cooldownUntil !== undefined && {
            cooldownUntil: profile.cooldownUntil,
          })}
        />
        {profile.healthScore !== undefined && (
          <HealthBar score={profile.healthScore} />
        )}
      </div>

      {/* Status message */}
      {profile.statusMessage && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 italic">
          {profile.statusMessage}
        </p>
      )}

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>Last used: {lastUsed}</span>
        {profile.labels && profile.labels.length > 0 && (
          <div className="flex gap-1">
            {profile.labels.map((label) => (
              <span
                key={label}
                className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px]"
              >
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface ProfileListProps {
  provider?: ProviderId;
  workspaceId?: string;
  onAddProfile?: (provider: ProviderId) => void;
  onReauth?: (profile: AccountProfile) => void;
}

export function ProfileList({
  provider,
  workspaceId = "default",
  onAddProfile,
  onReauth,
}: ProfileListProps) {
  const {
    data: profiles,
    isLoading,
    refetch,
  } = useProfiles({
    workspaceId,
    ...(provider !== undefined && { provider }),
  });
  const { activate, isLoading: _activating } = useActivateProfile();
  const { remove, isLoading: deleting } = useDeleteProfile();
  const { rotate, isLoading: rotating } = useRotatePool();

  const [deleteConfirm, setDeleteConfirm] = useState<AccountProfile | null>(
    null,
  );
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  // Find active profile for each provider
  const getActiveProfileForProvider = useCallback(
    (p: ProviderId) => {
      const providerProfiles = profiles?.filter((prof) => prof.provider === p);
      return (
        providerProfiles?.find((prof) => prof.lastUsedAt) ??
        providerProfiles?.[0]
      );
    },
    [profiles],
  );

  const handleActivate = useCallback(
    async (profile: AccountProfile) => {
      try {
        await activate(profile.id);
        setActiveProfileId(profile.id);
        refetch();
      } catch {
        // Error handled by hook
      }
    },
    [activate, refetch],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    try {
      await remove(deleteConfirm.id);
      setDeleteConfirm(null);
      refetch();
    } catch {
      // Error handled by hook
    }
  }, [deleteConfirm, remove, refetch]);

  const handleRotate = useCallback(
    async (p: ProviderId) => {
      try {
        const result = await rotate(p, workspaceId);
        if (result.success) {
          setActiveProfileId(result.newProfileId);
          refetch();
        }
      } catch {
        // Error handled by hook
      }
    },
    [rotate, workspaceId, refetch],
  );

  // Group profiles by provider if no specific provider is selected
  const groupedProfiles = profiles?.reduce(
    (acc, profile) => {
      const key = profile.provider;
      if (!acc[key]) acc[key] = [];
      acc[key].push(profile);
      return acc;
    },
    {} as Record<ProviderId, AccountProfile[]>,
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-gray-100 dark:bg-gray-800 rounded-lg h-32 animate-pulse"
          />
        ))}
      </div>
    );
  }

  const providers: ProviderId[] = provider
    ? [provider]
    : (["claude", "codex", "gemini"] as ProviderId[]);

  return (
    <div className="space-y-6">
      {providers.map((p) => {
        const providerProfiles = groupedProfiles?.[p] ?? [];
        const info = PROVIDER_INFO[p];
        const activeProfile = getActiveProfileForProvider(p);

        return (
          <div key={p}>
            {/* Provider Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ProviderBadge provider={p} size="sm" />
                <h3 className="font-medium text-gray-900 dark:text-white">
                  {info.displayName}
                </h3>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  ({providerProfiles.length} profile
                  {providerProfiles.length !== 1 ? "s" : ""})
                </span>
              </div>

              <div className="flex items-center gap-2">
                {providerProfiles.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRotate(p)}
                    disabled={rotating}
                    className="text-xs px-2 py-1 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors disabled:opacity-50"
                  >
                    {rotating ? "Rotating..." : "Rotate"}
                  </button>
                )}
                {onAddProfile && (
                  <button
                    type="button"
                    onClick={() => onAddProfile(p)}
                    className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  >
                    + Add
                  </button>
                )}
              </div>
            </div>

            {/* Profiles Grid */}
            {providerProfiles.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {providerProfiles.map((profile) => (
                  <ProfileCard
                    key={profile.id}
                    profile={profile}
                    isActive={
                      activeProfileId === profile.id ||
                      (!activeProfileId && activeProfile?.id === profile.id)
                    }
                    onActivate={() => handleActivate(profile)}
                    onDelete={() => setDeleteConfirm(profile)}
                    onReauth={() => onReauth?.(profile)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700">
                <div
                  className="w-12 h-12 rounded-lg mx-auto mb-3 flex items-center justify-center text-white text-xl font-bold opacity-50"
                  style={{ backgroundColor: info.color }}
                >
                  {info.icon}
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                  No {info.displayName} profiles yet
                </p>
                {onAddProfile && (
                  <button
                    type="button"
                    onClick={() => onAddProfile(p)}
                    className="text-sm px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Add {info.displayName} Account
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <Modal
          open={!!deleteConfirm}
          onClose={() => setDeleteConfirm(null)}
          title="Delete Profile"
        >
          <div className="space-y-4">
            <p className="text-gray-600 dark:text-gray-400">
              Are you sure you want to delete the profile{" "}
              <strong className="text-gray-900 dark:text-white">
                {deleteConfirm.name}
              </strong>
              ?
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              This will remove the profile from the Gateway. Any stored
              credentials will be deleted.
            </p>
            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
