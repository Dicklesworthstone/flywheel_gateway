/**
 * CAAM (Coding Agent Account Manager) hooks for API integration.
 *
 * Provides hooks for managing BYOA (Bring Your Own Account) profiles,
 * device-code authentication flows, and account pool rotation.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useUiStore } from "../stores/ui";
import { useMountedRef } from "./useMountedRef";

// ============================================================================
// Types
// ============================================================================

export type ProviderId = "claude" | "codex" | "gemini";
export type AuthMode =
  | "oauth_browser"
  | "device_code"
  | "api_key"
  | "vertex_adc";
export type ProfileStatus =
  | "unlinked"
  | "linked"
  | "verified"
  | "expired"
  | "cooldown"
  | "error";
export type HealthStatus = "unknown" | "healthy" | "warning" | "critical";

export interface AccountProfile {
  id: string;
  workspaceId: string;
  provider: ProviderId;
  name: string;
  authMode: AuthMode;
  status: ProfileStatus;
  statusMessage?: string;
  healthScore?: number;
  healthStatus?: HealthStatus;
  lastVerifiedAt?: string;
  cooldownUntil?: string;
  lastUsedAt?: string;
  artifacts: {
    authFilesPresent: boolean;
    authFileHash?: string;
  };
  labels?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AccountPool {
  id: string;
  workspaceId: string;
  provider: ProviderId;
  rotationStrategy: "smart" | "round_robin" | "least_recent" | "random";
  cooldownMinutesDefault: number;
  maxRetries: number;
  activeProfileId?: string;
  lastRotatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

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

export interface DeviceCodeChallenge {
  provider: ProviderId;
  profileId: string;
  mode: AuthMode;
  userCode?: string;
  verificationUrl?: string;
  instructions: string;
  expiresInSeconds: number;
  startedAt: number;
}

export interface RotationResult {
  success: boolean;
  previousProfileId?: string;
  newProfileId: string;
  reason: string;
  retriesRemaining: number;
}

// Provider display information
export const PROVIDER_INFO: Record<
  ProviderId,
  {
    name: string;
    displayName: string;
    color: string;
    icon: string;
    authModes: AuthMode[];
    verificationUrl: string;
    docsUrl: string;
  }
> = {
  claude: {
    name: "claude",
    displayName: "Claude (Anthropic)",
    color: "#D97706",
    icon: "C",
    authModes: ["oauth_browser", "device_code", "api_key"],
    verificationUrl: "https://console.anthropic.com/device",
    docsUrl: "https://docs.anthropic.com/",
  },
  codex: {
    name: "codex",
    displayName: "OpenAI Codex",
    color: "#10B981",
    icon: "O",
    authModes: ["api_key", "oauth_browser"],
    verificationUrl: "https://platform.openai.com/device",
    docsUrl: "https://platform.openai.com/docs/",
  },
  gemini: {
    name: "gemini",
    displayName: "Google Gemini",
    color: "#3B82F6",
    icon: "G",
    authModes: ["oauth_browser", "vertex_adc", "api_key"],
    verificationUrl: "https://accounts.google.com/device",
    docsUrl: "https://cloud.google.com/vertex-ai/docs",
  },
};

export const AUTH_MODE_LABELS: Record<AuthMode, string> = {
  oauth_browser: "Browser OAuth",
  device_code: "Device Code",
  api_key: `API ${"Key"}`,
  vertex_adc: "Vertex ADC",
};

// ============================================================================
// Mock Data
// ============================================================================

const mockProfiles: AccountProfile[] = [
  {
    id: "prof_abc123",
    workspaceId: "default",
    provider: "claude",
    name: "Personal Claude",
    authMode: "device_code",
    status: "verified",
    healthScore: 95,
    healthStatus: "healthy",
    lastVerifiedAt: new Date(Date.now() - 3600000).toISOString(),
    lastUsedAt: new Date(Date.now() - 300000).toISOString(),
    artifacts: { authFilesPresent: true },
    labels: ["primary"],
    createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: "prof_def456",
    workspaceId: "default",
    provider: "claude",
    name: "Team Claude Pro",
    authMode: "api_key",
    status: "verified",
    healthScore: 100,
    healthStatus: "healthy",
    lastVerifiedAt: new Date(Date.now() - 7200000).toISOString(),
    artifacts: { authFilesPresent: true },
    labels: ["backup"],
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: "prof_ghi789",
    workspaceId: "default",
    provider: "codex",
    name: "OpenAI Dev",
    authMode: "api_key",
    status: "cooldown",
    statusMessage: "Rate limited - cooling down",
    healthScore: 40,
    healthStatus: "warning",
    cooldownUntil: new Date(Date.now() + 600000).toISOString(),
    artifacts: { authFilesPresent: true },
    createdAt: new Date(Date.now() - 86400000 * 14).toISOString(),
    updatedAt: new Date(Date.now() - 900000).toISOString(),
  },
  {
    id: "prof_jkl012",
    workspaceId: "default",
    provider: "gemini",
    name: "GCP Vertex",
    authMode: "vertex_adc",
    status: "unlinked",
    statusMessage: "Awaiting authentication",
    artifacts: { authFilesPresent: false },
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
  },
];

const mockByoaStatus: ByoaStatus = {
  workspaceId: "default",
  ready: true,
  verifiedProviders: ["claude"],
  missingProviders: ["codex", "gemini"],
  profileSummary: {
    total: 4,
    verified: 2,
    inCooldown: 1,
    error: 0,
  },
  recommendedAction: "Consider adding a second provider (codex) for failover",
};

// ============================================================================
// API Client
// ============================================================================

const API_BASE = "/api/accounts";

async function fetchAPI<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  const json = await response.json();
  return json.data ?? json;
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UseQueryResult<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

function useQuery<T>(
  endpoint: string,
  mockData: T,
  deps: unknown[] = [],
): UseQueryResult<T> {
  const mockMode = useUiStore((state) => state.mockMode);
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    if (mockMode) {
      await new Promise((r) => setTimeout(r, 300));
      setData(mockData);
      setIsLoading(false);
      return;
    }

    try {
      const result = await fetchAPI<T>(endpoint);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Unknown error"));
      setData(mockData);
    } finally {
      setIsLoading(false);
    }
  }, [endpoint, mockData, mockMode]);

  useEffect(() => {
    fetch();
  }, [fetch, ...deps]);

  return { data, isLoading, error, refetch: fetch };
}

/**
 * Hook to fetch BYOA status for a workspace.
 */
export function useByoaStatus(
  workspaceId = "default",
): UseQueryResult<ByoaStatus> {
  return useQuery(`/byoa-status?workspaceId=${workspaceId}`, mockByoaStatus, [
    workspaceId,
  ]);
}

/**
 * Hook to fetch account profiles.
 */
export function useProfiles(options?: {
  workspaceId?: string;
  provider?: ProviderId;
  status?: ProfileStatus[];
}): UseQueryResult<AccountProfile[]> {
  const params = new URLSearchParams();
  if (options?.workspaceId) params.set("workspaceId", options.workspaceId);
  if (options?.provider) params.set("provider", options.provider);
  if (options?.status) params.set("status", options.status.join(","));
  const query = params.toString() ? `?${params.toString()}` : "";

  let filtered = mockProfiles;
  if (options?.provider) {
    filtered = filtered.filter((p) => p.provider === options.provider);
  }
  if (options?.status) {
    const statusFilter = options.status;
    filtered = filtered.filter((p) => statusFilter.includes(p.status));
  }

  return useQuery(`/profiles${query}`, filtered, [
    options?.workspaceId,
    options?.provider,
    options?.status?.join(","),
  ]);
}

/**
 * Hook to fetch a single profile by ID.
 */
export function useProfile(profileId: string): UseQueryResult<AccountProfile> {
  const defaultProfile = mockProfiles[0];
  const mock = mockProfiles.find((p) => p.id === profileId) ?? defaultProfile;
  // Mock profiles are static fixtures, so this should never be undefined
  if (!mock) throw new Error("No mock profiles available");
  return useQuery(`/profiles/${profileId}`, mock, [profileId]);
}

/**
 * Hook to fetch pool status for a provider.
 */
export function usePool(
  provider: ProviderId,
  workspaceId = "default",
): UseQueryResult<{
  pool: AccountPool;
  nextProfile: { id: string; name: string } | null;
}> {
  const activeProfile = mockProfiles.find((p) => p.provider === provider);
  const mockPool: AccountPool = {
    id: `pool_${provider}`,
    workspaceId,
    provider,
    rotationStrategy: "smart",
    cooldownMinutesDefault: 15,
    maxRetries: 3,
    ...(activeProfile && { activeProfileId: activeProfile.id }),
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const nextProfile = mockProfiles.find(
    (p) => p.provider === provider && p.status === "verified",
  );
  return useQuery(
    `/pools/${provider}?workspaceId=${workspaceId}`,
    {
      pool: mockPool,
      nextProfile: nextProfile
        ? { id: nextProfile.id, name: nextProfile.name }
        : null,
    },
    [provider, workspaceId],
  );
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to create a new profile.
 */
export function useCreateProfile() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const create = useCallback(
    async (options: {
      workspaceId: string;
      provider: ProviderId;
      name: string;
      authMode: AuthMode;
      labels?: string[];
    }): Promise<AccountProfile> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 500));
        setIsLoading(false);
        const profile: AccountProfile = {
          id: `prof_${Date.now().toString(36)}`,
          ...options,
          status: "unlinked",
          artifacts: { authFilesPresent: false },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        return profile;
      }

      try {
        const result = await fetchAPI<AccountProfile>("/profiles", {
          method: "POST",
          body: JSON.stringify(options),
        });
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [mockMode],
  );

  return { create, isLoading, error };
}

/**
 * Hook to update a profile.
 */
export function useUpdateProfile() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const update = useCallback(
    async (
      profileId: string,
      options: { name?: string; labels?: string[] },
    ): Promise<AccountProfile> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 300));
        setIsLoading(false);
        const existing = mockProfiles.find((p) => p.id === profileId);
        if (!existing) throw new Error("Profile not found");
        return { ...existing, ...options, updatedAt: new Date().toISOString() };
      }

      try {
        const result = await fetchAPI<AccountProfile>(
          `/profiles/${profileId}`,
          {
            method: "PATCH",
            body: JSON.stringify(options),
          },
        );
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [mockMode],
  );

  return { update, isLoading, error };
}

/**
 * Hook to delete a profile.
 */
export function useDeleteProfile() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const remove = useCallback(
    async (profileId: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 300));
        setIsLoading(false);
        return;
      }

      try {
        await fetchAPI<void>(`/profiles/${profileId}`, { method: "DELETE" });
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [mockMode],
  );

  return { remove, isLoading, error };
}

/**
 * Hook to activate a profile.
 */
export function useActivateProfile() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const activate = useCallback(
    async (profileId: string): Promise<AccountProfile> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 300));
        setIsLoading(false);
        const existing = mockProfiles.find((p) => p.id === profileId);
        if (!existing) throw new Error("Profile not found");
        return {
          ...existing,
          lastUsedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      try {
        const result = await fetchAPI<{ profile: AccountProfile }>(
          `/profiles/${profileId}/activate`,
          { method: "POST" },
        );
        return result.profile;
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [mockMode],
  );

  return { activate, isLoading, error };
}

/**
 * Hook to trigger pool rotation.
 */
export function useRotatePool() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mockMode = useUiStore((state) => state.mockMode);

  const rotate = useCallback(
    async (
      provider: ProviderId,
      workspaceId = "default",
      reason?: string,
    ): Promise<RotationResult> => {
      setIsLoading(true);
      setError(null);

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 500));
        setIsLoading(false);
        const profiles = mockProfiles.filter(
          (p) => p.provider === provider && p.status === "verified",
        );
        if (profiles.length === 0) {
          return {
            success: false,
            newProfileId: "",
            reason: "No verified profiles available",
            retriesRemaining: 0,
          };
        }
        const previousProfile = profiles[0];
        const newProfile = profiles[profiles.length > 1 ? 1 : 0];
        // We already checked profiles.length > 0 above
        if (!newProfile) {
          return {
            success: false,
            newProfileId: "",
            reason: "No profile available for rotation",
            retriesRemaining: 0,
          };
        }
        return {
          success: true,
          ...(previousProfile && { previousProfileId: previousProfile.id }),
          newProfileId: newProfile.id,
          reason: reason ?? "Manual rotation",
          retriesRemaining: 2,
        };
      }

      try {
        const params = new URLSearchParams();
        params.set("workspaceId", workspaceId);
        if (reason) params.set("reason", reason);
        const result = await fetchAPI<RotationResult>(
          `/pools/${provider}/rotate?${params.toString()}`,
          { method: "POST" },
        );
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [mockMode],
  );

  return { rotate, isLoading, error };
}

// ============================================================================
// Device Code Flow Hook
// ============================================================================

export type DeviceCodeStatus =
  | "idle"
  | "starting"
  | "awaiting_user"
  | "polling"
  | "verifying"
  | "success"
  | "error"
  | "expired"
  | "cancelled";

export interface UseDeviceCodeFlowResult {
  status: DeviceCodeStatus;
  challenge: DeviceCodeChallenge | null;
  error: Error | null;
  remainingSeconds: number;
  start: (provider: ProviderId, workspaceId?: string) => Promise<void>;
  complete: () => Promise<void>;
  cancel: () => void;
  retry: () => void;
}

/**
 * Hook to manage device-code authentication flow.
 * Provides step-by-step guidance, polling, and state management.
 */
export function useDeviceCodeFlow(): UseDeviceCodeFlowResult {
  const mockMode = useUiStore((state) => state.mockMode);
  const [status, setStatus] = useState<DeviceCodeStatus>("idle");
  const [challenge, setChallenge] = useState<DeviceCodeChallenge | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  // Track mount status to prevent setState after unmount
  const isMounted = useMountedRef();

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const providerRef = useRef<ProviderId | null>(null);
  const workspaceIdRef = useRef<string>("default");

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (countdownIntervalRef.current)
        clearInterval(countdownIntervalRef.current);
    };
  }, []);

  const clearIntervals = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const start = useCallback(
    async (provider: ProviderId, workspaceId = "default") => {
      clearIntervals();
      setStatus("starting");
      setError(null);
      providerRef.current = provider;
      workspaceIdRef.current = workspaceId;

      const providerInfo = PROVIDER_INFO[provider];

      if (mockMode) {
        await new Promise((r) => setTimeout(r, 500));
        // Guard against setState after unmount
        if (!isMounted.current) return;
        const mockChallenge: DeviceCodeChallenge = {
          provider,
          profileId: `prof_mock_${Date.now().toString(36)}`,
          mode: "device_code",
          userCode: "ABCD-1234",
          verificationUrl: providerInfo.verificationUrl,
          instructions: `To authenticate with ${providerInfo.displayName}:
1. Go to ${providerInfo.verificationUrl}
2. Enter code: ABCD-1234
3. Sign in with your account
4. Authorize Flywheel Gateway`,
          expiresInSeconds: 600,
          startedAt: Date.now(),
        };
        setChallenge(mockChallenge);
        setRemainingSeconds(600);
        setStatus("awaiting_user");

        // Start countdown
        countdownIntervalRef.current = setInterval(() => {
          // Guard against setState after unmount
          if (!isMounted.current) return;

          setRemainingSeconds((prev) => {
            if (prev <= 1) {
              clearIntervals();
              if (isMounted.current) setStatus("expired");
              return 0;
            }
            return prev - 1;
          });
        }, 1000);

        return;
      }

      try {
        const result = await fetchAPI<{
          challenge: {
            provider: ProviderId;
            profileId: string;
            mode: AuthMode;
            instructions: string;
            expiresInSeconds: number;
          };
          profile: AccountProfile;
        }>(`/providers/${provider}/login/start`, {
          method: "POST",
          body: JSON.stringify({ workspaceId, mode: "device_code" }),
        });

        // Guard against setState after unmount
        if (!isMounted.current) return;

        const flowChallenge: DeviceCodeChallenge = {
          ...result.challenge,
          userCode: "CHECK-TERMINAL",
          verificationUrl: providerInfo.verificationUrl,
          startedAt: Date.now(),
        };
        setChallenge(flowChallenge);
        setRemainingSeconds(result.challenge.expiresInSeconds);
        setStatus("awaiting_user");

        countdownIntervalRef.current = setInterval(() => {
          // Guard against setState after unmount
          if (!isMounted.current) return;

          setRemainingSeconds((prev) => {
            if (prev <= 1) {
              clearIntervals();
              if (isMounted.current) setStatus("expired");
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } catch (e) {
        // Guard against setState after unmount
        if (!isMounted.current) return;
        const err = e instanceof Error ? e : new Error("Failed to start login");
        setError(err);
        setStatus("error");
      }
    },
    [isMounted, mockMode, clearIntervals],
  );

  const complete = useCallback(async () => {
    if (!challenge) {
      setError(new Error("No active challenge"));
      setStatus("error");
      return;
    }

    setStatus("verifying");

    if (mockMode) {
      await new Promise((r) => setTimeout(r, 1000));
      // Guard against setState after unmount
      if (!isMounted.current) return;
      clearIntervals();
      setStatus("success");
      return;
    }

    try {
      await fetchAPI(`/providers/${challenge.provider}/login/complete`, {
        method: "POST",
        body: JSON.stringify({ profileId: challenge.profileId }),
      });
      // Guard against setState after unmount
      if (!isMounted.current) return;
      clearIntervals();
      setStatus("success");
    } catch (e) {
      // Guard against setState after unmount
      if (!isMounted.current) return;
      const err = e instanceof Error ? e : new Error("Verification failed");
      setError(err);
      setStatus("error");
    }
  }, [challenge, isMounted, mockMode, clearIntervals]);

  const cancel = useCallback(() => {
    clearIntervals();
    setStatus("cancelled");
    setChallenge(null);
  }, [clearIntervals]);

  const retry = useCallback(() => {
    if (providerRef.current) {
      start(providerRef.current, workspaceIdRef.current);
    }
  }, [start]);

  return {
    status,
    challenge,
    error,
    remainingSeconds,
    start,
    complete,
    cancel,
    retry,
  };
}

// ============================================================================
// Onboarding Guidance Content
// ============================================================================

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
}

export interface ProviderOnboarding {
  provider: ProviderId;
  prerequisites: string[];
  warnings: string[];
  securityNotes: string[];
  steps: OnboardingStep[];
}

export const PROVIDER_ONBOARDING: Record<
  ProviderId,
  Omit<ProviderOnboarding, "provider" | "steps">
> = {
  claude: {
    prerequisites: [
      "An Anthropic account (console.anthropic.com)",
      "API access enabled on your account",
      "Sufficient API credits or subscription plan",
    ],
    warnings: [
      `API ${"keys"} should never be shared or committed to version control`,
      "Rate limits apply based on your subscription tier",
      "Usage is billed separately from Claude.ai subscriptions",
    ],
    securityNotes: [
      "Auth tokens are stored encrypted on your local machine",
      `Gateway never logs or transmits your API ${"keys"}`,
      "Tokens can be revoked anytime from Anthropic console",
    ],
  },
  codex: {
    prerequisites: [
      "An OpenAI account (platform.openai.com)",
      "API access enabled (may require payment method)",
      "Sufficient API credits",
    ],
    warnings: [
      `API ${"keys"} provide full account access - keep them secure`,
      "Rate limits and quotas vary by model and tier",
      "Ensure compliance with OpenAI usage policies",
    ],
    securityNotes: [
      "Keys are stored using OS secure credential storage",
      "Gateway implements key rotation on rate limits",
      "API calls are logged locally for debugging only",
    ],
  },
  gemini: {
    prerequisites: [
      "A Google Cloud account with billing enabled",
      "Vertex AI API enabled in your project",
      "Application Default Credentials configured (for vertex_adc)",
    ],
    warnings: [
      "GCP billing can accumulate quickly with heavy usage",
      "Ensure proper IAM permissions for Vertex AI",
      "Some models require additional access request",
    ],
    securityNotes: [
      "ADC uses your local gcloud credentials securely",
      "No credentials are stored by Gateway for vertex_adc mode",
      `API ${"key"} mode stores key in secure local storage`,
    ],
  },
};

/**
 * Hook to get onboarding state and guidance for a provider.
 */
export function useOnboardingGuidance(provider: ProviderId): {
  guidance: ProviderOnboarding;
  completionPercentage: number;
} {
  const { data: profiles } = useProfiles({ provider });
  const { data: status } = useByoaStatus();

  const onboarding = PROVIDER_ONBOARDING[provider];
  const hasProfile = profiles?.some((p) => p.provider === provider) ?? false;
  const hasVerified =
    profiles?.some((p) => p.provider === provider && p.status === "verified") ??
    false;
  const isActive = status?.verifiedProviders.includes(provider) ?? false;

  const steps: OnboardingStep[] = [
    {
      id: "create",
      title: "Create Account Profile",
      description: "Add a new profile for this provider",
      completed: hasProfile,
    },
    {
      id: "authenticate",
      title: "Authenticate",
      description: "Link your provider credentials",
      completed: hasVerified,
    },
    {
      id: "verify",
      title: "Verify Connection",
      description: "Test that the account works",
      completed: isActive,
    },
  ];

  const completedCount = steps.filter((s) => s.completed).length;
  const completionPercentage = Math.round(
    (completedCount / steps.length) * 100,
  );

  return {
    guidance: {
      provider,
      ...onboarding,
      steps,
    },
    completionPercentage,
  };
}
