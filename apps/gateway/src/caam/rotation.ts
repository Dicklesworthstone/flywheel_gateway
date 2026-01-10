/**
 * CAAM Rotation Logic
 *
 * Handles account pool rotation for failover and rate limit recovery.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db/connection";
import { accountPools } from "../db/schema";
import { auditLog } from "../services/audit";
import { getLogger } from "../middleware/correlation";
import {
  activateProfile,
  getPool,
  getPoolProfiles,
  setCooldown,
} from "./account.service";
import type {
  AccountProfile,
  ProviderId,
  RotationResult,
  RotationStrategy,
} from "./types";
import { RATE_LIMIT_SIGNATURES } from "./types";

// ============================================================================
// Rotation Strategies
// ============================================================================

/**
 * Select next profile using round-robin strategy.
 */
function selectRoundRobin(
  profiles: AccountProfile[],
  currentProfileId?: string,
): AccountProfile | null {
  if (profiles.length === 0) return null;

  const available = profiles.filter(isProfileAvailable);
  if (available.length === 0) return null;

  if (!currentProfileId) return available[0]!;

  const currentIndex = available.findIndex((p) => p.id === currentProfileId);
  const nextIndex = (currentIndex + 1) % available.length;
  return available[nextIndex]!;
}

/**
 * Select next profile using least-recent strategy (oldest lastUsedAt).
 */
function selectLeastRecent(profiles: AccountProfile[]): AccountProfile | null {
  const available = profiles.filter(isProfileAvailable);
  if (available.length === 0) return null;

  return available.sort((a, b) => {
    const aTime = a.lastUsedAt?.getTime() ?? 0;
    const bTime = b.lastUsedAt?.getTime() ?? 0;
    return aTime - bTime;
  })[0]!;
}

/**
 * Select next profile using random strategy.
 */
function selectRandom(profiles: AccountProfile[]): AccountProfile | null {
  const available = profiles.filter(isProfileAvailable);
  if (available.length === 0) return null;

  const index = Math.floor(Math.random() * available.length);
  return available[index]!;
}

/**
 * Select next profile using smart strategy.
 * Considers health score, cooldown status, and recent usage.
 */
function selectSmart(
  profiles: AccountProfile[],
  currentProfileId?: string,
): AccountProfile | null {
  const available = profiles.filter(isProfileAvailable);
  if (available.length === 0) return null;

  // Score each profile
  const scored = available.map((p) => {
    let score = 0;

    // Health score (0-100) contributes up to 40 points
    score += (p.healthScore ?? 50) * 0.4;

    // Recency penalty (prefer less recently used)
    const hoursSinceUse = p.lastUsedAt
      ? (Date.now() - p.lastUsedAt.getTime()) / (1000 * 60 * 60)
      : 24;
    score += Math.min(hoursSinceUse, 24) * 1.25; // Up to 30 points

    // Avoid current profile slightly
    if (p.id === currentProfileId) {
      score -= 10;
    }

    // Verification recency (prefer recently verified)
    if (p.lastVerifiedAt) {
      const daysSinceVerified =
        (Date.now() - p.lastVerifiedAt.getTime()) / (1000 * 60 * 60 * 24);
      score += Math.max(0, 30 - daysSinceVerified); // Up to 30 points
    }

    return { profile: p, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored[0]?.profile ?? null;
}

/**
 * Check if a profile is available for use.
 */
function isProfileAvailable(profile: AccountProfile): boolean {
  // Must be verified
  if (profile.status !== "verified") return false;

  // Must not be in cooldown
  if (profile.cooldownUntil && profile.cooldownUntil > new Date()) {
    return false;
  }

  // Must not be expired
  if (profile.expiresAt && profile.expiresAt < new Date()) {
    return false;
  }

  return true;
}

// ============================================================================
// Rotation Operations
// ============================================================================

/**
 * Rotate to the next available profile in a pool.
 */
export async function rotate(
  workspaceId: string,
  provider: ProviderId,
  reason?: string,
): Promise<RotationResult> {
  const log = getLogger();
  const db = getDb();
  const now = new Date();

  // Get pool
  const pool = await getPool(workspaceId, provider);
  if (!pool) {
    return {
      success: false,
      newProfileId: "",
      reason: `No pool found for provider ${provider}`,
      retriesRemaining: 0,
    };
  }

  // Get profiles
  const profiles = await getPoolProfiles(pool.id);
  if (profiles.length === 0) {
    return {
      success: false,
      newProfileId: "",
      reason: "No profiles in pool",
      retriesRemaining: 0,
    };
  }

  // Select next profile based on strategy
  const currentProfileId = pool.activeProfileId;
  const nextProfile = selectByStrategy(
    pool.rotationStrategy,
    profiles,
    currentProfileId,
  );

  if (!nextProfile) {
    return {
      success: false,
      previousProfileId: currentProfileId,
      newProfileId: "",
      reason: "No available profiles (all in cooldown or error state)",
      retriesRemaining: 0,
    };
  }

  // Update pool
  await db
    .update(accountPools)
    .set({
      activeProfileId: nextProfile.id,
      lastRotatedAt: now,
      updatedAt: now,
    })
    .where(eq(accountPools.id, pool.id));

  // Activate the new profile
  await activateProfile(nextProfile.id);

  // Log audit
  await auditLog({
    action: "rotate",
    resourceType: "account_pool",
    resource: pool.id,
    outcome: "success",
    metadata: {
      provider,
      previousProfileId: currentProfileId,
      newProfileId: nextProfile.id,
      reason,
    },
  });

  log.info(
    {
      poolId: pool.id,
      provider,
      previousProfileId: currentProfileId,
      newProfileId: nextProfile.id,
      reason,
    },
    "Rotated to next profile",
  );

  // Calculate retries remaining
  const availableCount = profiles.filter(isProfileAvailable).length;

  return {
    success: true,
    previousProfileId: currentProfileId,
    newProfileId: nextProfile.id,
    reason: reason ?? "Manual rotation",
    retriesRemaining: Math.max(0, availableCount - 1),
  };
}

/**
 * Handle a rate limit by putting current profile in cooldown and rotating.
 */
export async function handleRateLimit(
  workspaceId: string,
  provider: ProviderId,
  errorMessage?: string,
): Promise<RotationResult> {
  const log = getLogger();

  // Get current pool
  const pool = await getPool(workspaceId, provider);
  if (!pool || !pool.activeProfileId) {
    return {
      success: false,
      newProfileId: "",
      reason: "No active profile to cooldown",
      retriesRemaining: 0,
    };
  }

  // Put current profile in cooldown
  await setCooldown(
    pool.activeProfileId,
    pool.cooldownMinutesDefault,
    `Rate limit: ${errorMessage ?? "API rate limit exceeded"}`,
  );

  log.warn(
    {
      profileId: pool.activeProfileId,
      provider,
      cooldownMinutes: pool.cooldownMinutesDefault,
    },
    "Profile rate limited, rotating",
  );

  // Rotate to next profile
  return rotate(workspaceId, provider, "Rate limit recovery");
}

/**
 * Check if an error message indicates a rate limit.
 */
export function isRateLimitError(provider: ProviderId, errorMessage: string): boolean {
  const signatures = RATE_LIMIT_SIGNATURES[provider];
  const lowerMessage = errorMessage.toLowerCase();
  return signatures.some((sig) => lowerMessage.includes(sig.toLowerCase()));
}

/**
 * Get the next profile that would be selected by rotation.
 * Does not actually rotate - useful for preview.
 */
export async function peekNextProfile(
  workspaceId: string,
  provider: ProviderId,
): Promise<AccountProfile | null> {
  const pool = await getPool(workspaceId, provider);
  if (!pool) return null;

  const profiles = await getPoolProfiles(pool.id);
  if (profiles.length === 0) return null;

  return selectByStrategy(pool.rotationStrategy, profiles, pool.activeProfileId);
}

// ============================================================================
// Helpers
// ============================================================================

function selectByStrategy(
  strategy: RotationStrategy,
  profiles: AccountProfile[],
  currentProfileId?: string,
): AccountProfile | null {
  switch (strategy) {
    case "round_robin":
      return selectRoundRobin(profiles, currentProfileId);
    case "least_recent":
      return selectLeastRecent(profiles);
    case "random":
      return selectRandom(profiles);
    case "smart":
    default:
      return selectSmart(profiles, currentProfileId);
  }
}
