/**
 * CAAM (Coding Agent Account Manager) Types
 *
 * Core type definitions for BYOA (Bring Your Own Account) profile management.
 * Gateway stores only metadata - auth artifacts live in workspace containers.
 */

/**
 * Supported AI provider identifiers.
 */
export type ProviderId = "claude" | "codex" | "gemini";

/**
 * Authentication modes for provider accounts.
 */
export type AuthMode = "oauth_browser" | "device_code" | "api_key";

/**
 * Account profile status values.
 */
export type ProfileStatus =
  | "unlinked" // Not yet linked to a provider account
  | "linked" // Linked but not verified
  | "verified" // Verified and ready for use
  | "expired" // Auth token has expired
  | "cooldown" // Temporarily unavailable (rate limited)
  | "error"; // Error state

/**
 * Rotation strategies for account pools.
 */
export type RotationStrategy = "smart" | "round_robin" | "least_recent" | "random";

/**
 * Storage modes for auth artifacts.
 */
export type StorageMode = "file" | "keyring" | "unknown";

/**
 * Account profile representation.
 */
export interface AccountProfile {
  id: string;
  workspaceId: string;
  provider: ProviderId;
  name: string;
  authMode: AuthMode;
  status: ProfileStatus;
  statusMessage?: string;
  healthScore?: number;
  lastVerifiedAt?: Date;
  expiresAt?: Date;
  cooldownUntil?: Date;
  lastUsedAt?: Date;
  artifacts: {
    authFilesPresent: boolean;
    authFileHash?: string;
    storageMode?: StorageMode;
  };
  labels?: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Account pool for grouping profiles by provider.
 */
export interface AccountPool {
  id: string;
  workspaceId: string;
  provider: ProviderId;
  rotationStrategy: RotationStrategy;
  cooldownMinutesDefault: number;
  maxRetries: number;
  activeProfileId?: string;
  lastRotatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Pool member linking profile to pool.
 */
export interface AccountPoolMember {
  id: string;
  poolId: string;
  profileId: string;
  priority: number;
  createdAt: Date;
}

/**
 * Login challenge returned when starting OAuth/device code flow.
 */
export interface LoginChallenge {
  provider: ProviderId;
  mode: "device_code" | "oauth_url" | "local_browser" | "manual_copy";
  code?: string;
  verificationUrl?: string;
  loginUrl?: string;
  instructions?: string;
  expiresInSeconds?: number;
}

/**
 * BYOA readiness status for a workspace.
 */
export interface ByoaStatus {
  workspaceId: string;
  ready: boolean;
  verifiedProviders: ProviderId[];
  missingProviders: ProviderId[];
  profileSummary: {
    total: number;
    verified: number;
    inCooldown: number;
    error: number;
  };
  recommendedAction?: string;
}

/**
 * Result of a rotation operation.
 */
export interface RotationResult {
  success: boolean;
  previousProfileId?: string;
  newProfileId: string;
  reason: string;
  retriesRemaining: number;
}

/**
 * Cooldown reason for tracking why a profile was put in cooldown.
 */
export interface CooldownReason {
  type: "rate_limit" | "error" | "manual" | "quota_exceeded";
  message?: string;
  provider_error_code?: string;
  timestamp: Date;
}

/**
 * Options for listing profiles.
 */
export interface ListProfilesOptions {
  workspaceId?: string;
  provider?: ProviderId;
  status?: ProfileStatus[];
  limit?: number;
  cursor?: string;
}

/**
 * Options for creating a profile.
 */
export interface CreateProfileOptions {
  workspaceId: string;
  provider: ProviderId;
  name: string;
  authMode: AuthMode;
  labels?: string[];
}

/**
 * Options for updating a profile.
 */
export interface UpdateProfileOptions {
  name?: string;
  status?: ProfileStatus;
  statusMessage?: string;
  healthScore?: number;
  labels?: string[];
  cooldownUntil?: Date;
  cooldownReason?: CooldownReason;
}

/**
 * Provider-specific error codes that indicate rate limiting.
 */
export const RATE_LIMIT_SIGNATURES: Record<ProviderId, string[]> = {
  claude: ["rate_limit_error", "overloaded_error", "429"],
  codex: ["rate_limit_exceeded", "429", "Too Many Requests"],
  gemini: ["RESOURCE_EXHAUSTED", "429", "quota exceeded"],
};

/**
 * Default cooldown durations by provider (in minutes).
 */
export const DEFAULT_COOLDOWN_MINUTES: Record<ProviderId, number> = {
  claude: 15,
  codex: 10,
  gemini: 5,
};
