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
 * Harmonized with CAAM CLI (see coding_agent_account_manager/internal/provider/provider.go).
 */
export type AuthMode =
  | "oauth_browser" // Browser-based OAuth flow (subscriptions)
  | "device_code" // OAuth device code flow (RFC 8628)
  | "api_key" // API key authentication
  | "vertex_adc"; // Vertex AI Application Default Credentials (Gemini)

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
export type RotationStrategy =
  | "smart"
  | "round_robin"
  | "least_recent"
  | "random";

/**
 * Storage modes for auth artifacts.
 */
export type StorageMode = "file" | "keyring" | "unknown";

/**
 * Health status for profiles.
 * Harmonized with CAAM CLI (see coding_agent_account_manager/internal/health/status.go).
 */
export type HealthStatus = "unknown" | "healthy" | "warning" | "critical";

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

  // Health tracking (harmonized with CAAM CLI health/storage.go)
  healthScore?: number; // Computed score 0-100 (for gateway-level sorting)
  healthStatus?: HealthStatus; // Categorical status from CAAM CLI
  tokenExpiresAt?: Date; // When OAuth token expires
  lastErrorAt?: Date; // When last error occurred
  errorCount1h?: number; // Errors in the last hour
  penaltyScore?: number; // Penalty with exponential decay
  penaltyUpdatedAt?: Date; // When penalty was last updated
  planType?: string; // Subscription tier (free, pro, enterprise)

  // Timestamps
  lastVerifiedAt?: Date;
  expiresAt?: Date; // Legacy: use tokenExpiresAt for CAAM compat
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

// ============================================================================
// CAAM CLI Output Types
// These types match the JSON output from the `caam` CLI tool.
// Used by the CaamRunner service to parse CLI responses.
// ============================================================================

/**
 * CAAM CLI auth mode values (use kebab-case from CLI).
 * @see coding_agent_account_manager/internal/provider/provider.go
 */
export type CaamAuthMode = "oauth" | "device-code" | "api-key" | "vertex-adc";

/**
 * Profile as returned by `caam ls --json`.
 */
export interface CaamCliProfile {
  provider: string;
  name: string;
  active: boolean;
  logged_in: boolean;
  account_id?: string;
  expires_at?: string; // ISO 8601
  last_used?: string; // ISO 8601
  has_lock_file?: boolean;
  error?: string;
}

/**
 * ProfileHealth as returned by `caam status --json`.
 * @see coding_agent_account_manager/internal/health/storage.go
 */
export interface CaamCliProfileHealth {
  token_expires_at?: string; // ISO 8601
  last_error?: string; // ISO 8601
  error_count_1h: number;
  penalty: number;
  penalty_updated_at?: string; // ISO 8601
  plan_type?: string;
  last_checked?: string; // ISO 8601
}

/**
 * Status output from `caam status --json`.
 */
export interface CaamCliStatus {
  provider: string;
  profile: string;
  logged_in: boolean;
  account_id?: string;
  expires_at?: string;
  last_used?: string;
  error?: string;
  health?: CaamCliProfileHealth;
}

/**
 * Rotation result from `caam activate --auto --json`.
 */
export interface CaamCliRotationResult {
  success: boolean;
  provider: string;
  previous_profile?: string;
  new_profile: string;
  reason: string;
}

/**
 * Cooldown entry from `caam cooldown list --json`.
 */
export interface CaamCliCooldown {
  provider: string;
  profile: string;
  until: string; // ISO 8601
  reason?: string;
  remaining_minutes: number;
}

/**
 * Convert CAAM CLI auth mode to Gateway auth mode.
 */
export function caamAuthModeToGateway(mode: CaamAuthMode): AuthMode {
  switch (mode) {
    case "oauth":
      return "oauth_browser";
    case "device-code":
      return "device_code";
    case "api-key":
      return "api_key";
    case "vertex-adc":
      return "vertex_adc";
    default:
      return "device_code";
  }
}

/**
 * Convert Gateway auth mode to CAAM CLI auth mode.
 */
export function gatewayAuthModeToCaam(mode: AuthMode): CaamAuthMode {
  switch (mode) {
    case "oauth_browser":
      return "oauth";
    case "device_code":
      return "device-code";
    case "api_key":
      return "api-key";
    case "vertex_adc":
      return "vertex-adc";
    default:
      return "device-code";
  }
}

/**
 * Convert CAAM CLI health status string to HealthStatus.
 */
export function parseHealthStatus(status: string): HealthStatus {
  switch (status.toLowerCase()) {
    case "healthy":
      return "healthy";
    case "warning":
      return "warning";
    case "critical":
      return "critical";
    default:
      return "unknown";
  }
}
