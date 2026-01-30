/**
 * CAAM Account Service
 *
 * Manages account profiles for BYOA (Bring Your Own Account).
 * Gateway stores only metadata - auth artifacts live in workspace containers.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  accountPoolMembers,
  accountPools,
  accountProfiles,
} from "../db/schema";
import { getLogger } from "../middleware/correlation";
import { audit } from "../services/audit";
import type {
  AccountPool,
  AccountProfile,
  ByoaStatus,
  CreateProfileOptions,
  HealthStatus,
  ListProfilesOptions,
  ProfileStatus,
  ProviderId,
  StorageMode,
  UpdateProfileOptions,
} from "./types";
import { DEFAULT_COOLDOWN_MINUTES } from "./types";

// ============================================================================
// ID Generation
// ============================================================================

function generateId(prefix: string): string {
  // Use crypto.randomUUID for standard, collision-resistant IDs
  // Remove dashes to keep it compact and URL-safe
  const uuid = crypto.randomUUID().replace(/-/g, "");
  return `${prefix}_${uuid}`;
}

// ============================================================================
// Profile Management
// ============================================================================

/**
 * List account profiles with optional filters.
 */
export async function listProfiles(options: ListProfilesOptions = {}): Promise<{
  profiles: AccountProfile[];
  pagination: { total: number; hasMore: boolean; cursor?: string };
}> {
  const log = getLogger();
  const limit = options.limit ?? 50;

  const conditions = [];
  if (options.workspaceId) {
    conditions.push(eq(accountProfiles.workspaceId, options.workspaceId));
  }
  if (options.provider) {
    conditions.push(eq(accountProfiles.provider, options.provider));
  }
  if (options.status && options.status.length > 0) {
    conditions.push(inArray(accountProfiles.status, options.status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(accountProfiles)
    .where(whereClause)
    .orderBy(desc(accountProfiles.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const profiles = rows.slice(0, limit).map(rowToProfile);

  log.debug({ count: profiles.length, hasMore }, "Listed account profiles");

  // Build pagination object conditionally (for exactOptionalPropertyTypes)
  const pagination: { total: number; hasMore: boolean; cursor?: string } = {
    total: profiles.length,
    hasMore,
  };
  if (hasMore && profiles.length > 0) {
    const lastProfile = profiles.at(-1);
    if (lastProfile) {
      pagination.cursor = lastProfile.id;
    }
  }

  return { profiles, pagination };
}

/**
 * Get a profile by ID.
 */
export async function getProfile(
  profileId: string,
): Promise<AccountProfile | null> {
  const rows = await db
    .select()
    .from(accountProfiles)
    .where(eq(accountProfiles.id, profileId))
    .limit(1);

  return rows[0] ? rowToProfile(rows[0]) : null;
}

/**
 * Create a new profile.
 */
export async function createProfile(
  options: CreateProfileOptions,
): Promise<AccountProfile> {
  const log = getLogger();
  const now = new Date();
  const id = generateId("prof");

  const insertRow = {
    id,
    workspaceId: options.workspaceId,
    provider: options.provider,
    name: options.name,
    authMode: options.authMode,
    status: "unlinked" as const,
    authFilesPresent: false,
    labels: options.labels ?? null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(accountProfiles).values(insertRow);

  // Ensure pool exists and add profile to it
  const pool = await ensurePool(options.workspaceId, options.provider);
  await addProfileToPool(pool.id, id, 0);

  // Log audit event
  audit({
    action: "profile.create",
    resourceType: "account_profile",
    resource: id,
    outcome: "success",
    metadata: { provider: options.provider, workspaceId: options.workspaceId },
  });

  log.info(
    { profileId: id, provider: options.provider },
    "Created account profile",
  );

  // Fetch the complete profile from database to ensure all fields
  const created = await getProfile(id);
  if (!created) {
    throw new Error(`Failed to create profile: ${id}`);
  }
  return created;
}

/**
 * Update a profile.
 */
export async function updateProfile(
  profileId: string,
  options: UpdateProfileOptions,
): Promise<AccountProfile | null> {
  const log = getLogger();
  const now = new Date();

  const updateData: Record<string, unknown> = { updatedAt: now };

  if (options.name !== undefined) updateData["name"] = options.name;
  if (options.status !== undefined) updateData["status"] = options.status;
  if (options.statusMessage !== undefined)
    updateData["statusMessage"] = options.statusMessage;
  if (options.healthScore !== undefined)
    updateData["healthScore"] = options.healthScore;
  if (options.labels !== undefined) updateData["labels"] = options.labels;
  if (options.cooldownUntil !== undefined)
    updateData["cooldownUntil"] = options.cooldownUntil;

  await db
    .update(accountProfiles)
    .set(updateData)
    .where(eq(accountProfiles.id, profileId));

  const updated = await getProfile(profileId);

  if (updated) {
    audit({
      action: "profile.update",
      resourceType: "account_profile",
      resource: profileId,
      outcome: "success",
      metadata: { changes: Object.keys(options) },
    });

    log.info(
      { profileId, changes: Object.keys(options) },
      "Updated account profile",
    );
  }

  return updated;
}

/**
 * Delete a profile.
 */
export async function deleteProfile(profileId: string): Promise<boolean> {
  const log = getLogger();

  // Check if profile exists
  const existing = await getProfile(profileId);
  if (!existing) {
    return false;
  }

  // Remove from any pools first
  await db
    .delete(accountPoolMembers)
    .where(eq(accountPoolMembers.profileId, profileId));

  // Delete the profile
  await db.delete(accountProfiles).where(eq(accountProfiles.id, profileId));

  audit({
    action: "profile.delete",
    resourceType: "account_profile",
    resource: profileId,
    outcome: "success",
  });

  log.info({ profileId }, "Deleted account profile");

  return true;
}

/**
 * Set a profile into cooldown.
 */
export async function setCooldown(
  profileId: string,
  minutes: number,
  reason?: string,
): Promise<AccountProfile | null> {
  const log = getLogger();
  const now = new Date();
  const cooldownUntil = new Date(now.getTime() + minutes * 60 * 1000);

  const updated = await updateProfile(profileId, {
    status: "cooldown",
    statusMessage: reason ?? `Cooldown for ${minutes} minutes`,
    cooldownUntil,
  });

  if (updated) {
    log.warn({ profileId, minutes, cooldownUntil }, "Profile set to cooldown");
  }

  return updated;
}

/**
 * Activate a profile for use.
 */
export async function activateProfile(
  profileId: string,
): Promise<AccountProfile | null> {
  const log = getLogger();
  const now = new Date();

  const profile = await getProfile(profileId);
  if (!profile) return null;

  // Update last used time
  await db
    .update(accountProfiles)
    .set({ lastUsedAt: now, updatedAt: now })
    .where(eq(accountProfiles.id, profileId));

  // Update pool's active profile
  await db
    .update(accountPools)
    .set({ activeProfileId: profileId, updatedAt: now })
    .where(
      and(
        eq(accountPools.workspaceId, profile.workspaceId),
        eq(accountPools.provider, profile.provider),
      ),
    );

  audit({
    action: "profile.activate",
    resourceType: "account_profile",
    resource: profileId,
    outcome: "success",
    metadata: { provider: profile.provider },
  });

  log.info(
    { profileId, provider: profile.provider },
    "Activated account profile",
  );

  return getProfile(profileId);
}

/**
 * Mark a profile as verified after successful login.
 */
export async function markVerified(
  profileId: string,
  authFileHash?: string,
): Promise<AccountProfile | null> {
  const log = getLogger();
  const now = new Date();

  await db
    .update(accountProfiles)
    .set({
      status: "verified",
      statusMessage: null,
      lastVerifiedAt: now,
      authFilesPresent: true,
      authFileHash: authFileHash ?? null,
      healthScore: 100,
      updatedAt: now,
    })
    .where(eq(accountProfiles.id, profileId));

  audit({
    action: "profile.verify",
    resourceType: "account_profile",
    resource: profileId,
    outcome: "success",
  });

  log.info({ profileId }, "Profile marked as verified");

  return getProfile(profileId);
}

// ============================================================================
// Pool Management
// ============================================================================

/**
 * Ensure a pool exists for a workspace/provider combination.
 */
async function ensurePool(
  workspaceId: string,
  provider: ProviderId,
): Promise<AccountPool> {
  const now = new Date();

  // Check if pool exists
  const existing = await db
    .select()
    .from(accountPools)
    .where(
      and(
        eq(accountPools.workspaceId, workspaceId),
        eq(accountPools.provider, provider),
      ),
    )
    .limit(1);

  if (existing[0]) {
    return rowToPool(existing[0]);
  }

  // Create new pool
  const id = generateId("pool");
  const row = {
    id,
    workspaceId,
    provider,
    rotationStrategy: "smart" as const,
    cooldownMinutesDefault: DEFAULT_COOLDOWN_MINUTES[provider],
    maxRetries: 3,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(accountPools).values(row);

  return rowToPool(row as typeof row);
}

/**
 * Get pool for a workspace/provider.
 */
export async function getPool(
  workspaceId: string,
  provider: ProviderId,
): Promise<AccountPool | null> {
  const rows = await db
    .select()
    .from(accountPools)
    .where(
      and(
        eq(accountPools.workspaceId, workspaceId),
        eq(accountPools.provider, provider),
      ),
    )
    .limit(1);

  return rows[0] ? rowToPool(rows[0]) : null;
}

/**
 * Get profiles in a pool, ordered by priority.
 */
export async function getPoolProfiles(
  poolId: string,
): Promise<AccountProfile[]> {
  const members = await db
    .select({
      profileId: accountPoolMembers.profileId,
      priority: accountPoolMembers.priority,
    })
    .from(accountPoolMembers)
    .where(eq(accountPoolMembers.poolId, poolId))
    .orderBy(accountPoolMembers.priority);

  if (members.length === 0) return [];

  const profileIds = members.map(
    (m: { profileId: string; priority: number }) => m.profileId,
  );
  const profiles = await db
    .select()
    .from(accountProfiles)
    .where(inArray(accountProfiles.id, profileIds));

  // Sort by priority
  const profileMap = new Map(
    profiles.map((p: (typeof profiles)[number]) => [p.id, p]),
  );
  return members
    .map((m: { profileId: string; priority: number }) =>
      profileMap.get(m.profileId),
    )
    .filter((p): p is NonNullable<typeof p> => p !== undefined)
    .map((p: (typeof profiles)[number]) => rowToProfile(p));
}

/**
 * Add a profile to a pool.
 */
export async function addProfileToPool(
  poolId: string,
  profileId: string,
  priority = 0,
): Promise<void> {
  const now = new Date();
  const id = generateId("pmem");

  await db.insert(accountPoolMembers).values({
    id,
    poolId,
    profileId,
    priority,
    createdAt: now,
  });
}

// ============================================================================
// BYOA Status
// ============================================================================

/**
 * Get BYOA readiness status for a workspace.
 */
export async function getByoaStatus(workspaceId: string): Promise<ByoaStatus> {
  const profiles = await db
    .select()
    .from(accountProfiles)
    .where(eq(accountProfiles.workspaceId, workspaceId));

  const verifiedProviders = new Set<ProviderId>();
  const allProviders: ProviderId[] = ["claude", "codex", "gemini"];

  let verified = 0;
  let inCooldown = 0;
  let error = 0;

  for (const profile of profiles) {
    if (profile.status === "verified") {
      verifiedProviders.add(profile.provider as ProviderId);
      verified++;
    } else if (profile.status === "cooldown") {
      inCooldown++;
    } else if (profile.status === "error") {
      error++;
    }
  }

  const verifiedList = [...verifiedProviders];
  const missingProviders = allProviders.filter(
    (p) => !verifiedProviders.has(p),
  );
  const ready = verifiedList.length >= 1;

  // Build base status
  const status: ByoaStatus = {
    workspaceId,
    ready,
    verifiedProviders: verifiedList,
    missingProviders,
    profileSummary: {
      total: profiles.length,
      verified,
      inCooldown,
      error,
    },
  };

  // Conditionally add recommendedAction (for exactOptionalPropertyTypes)
  if (!ready) {
    status.recommendedAction =
      "Link at least one provider account to enable agent execution";
  } else if (verifiedList.length === 1) {
    status.recommendedAction = `Consider adding a second provider (${missingProviders[0]}) for failover`;
  }

  return status;
}

// ============================================================================
// Helpers
// ============================================================================

function rowToProfile(row: {
  id: string;
  workspaceId: string;
  provider: string;
  name: string;
  authMode: string;
  status: string;
  statusMessage: string | null;
  healthScore: number | null;
  healthStatus: string | null;
  lastVerifiedAt: Date | null;
  expiresAt: Date | null;
  cooldownUntil: Date | null;
  lastUsedAt: Date | null;
  // Health penalty tracking
  tokenExpiresAt: Date | null;
  lastErrorAt: Date | null;
  errorCount1h: number | null;
  penaltyScore: number | null;
  penaltyUpdatedAt: Date | null;
  planType: string | null;
  // Auth artifacts
  authFilesPresent: boolean;
  authFileHash: string | null;
  storageMode: string | null;
  labels: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}): AccountProfile {
  // Build base profile with required fields
  const profile: AccountProfile = {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: row.provider as ProviderId,
    name: row.name,
    authMode: row.authMode as AccountProfile["authMode"],
    status: row.status as ProfileStatus,
    artifacts: {
      authFilesPresent: row.authFilesPresent,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  // Conditionally add optional fields (for exactOptionalPropertyTypes)
  if (row.statusMessage !== null) profile.statusMessage = row.statusMessage;
  if (row.healthScore !== null) profile.healthScore = row.healthScore;
  if (row.healthStatus !== null)
    profile.healthStatus = row.healthStatus as HealthStatus;
  if (row.lastVerifiedAt !== null) profile.lastVerifiedAt = row.lastVerifiedAt;
  if (row.expiresAt !== null) profile.expiresAt = row.expiresAt;
  if (row.cooldownUntil !== null) profile.cooldownUntil = row.cooldownUntil;
  if (row.lastUsedAt !== null) profile.lastUsedAt = row.lastUsedAt;

  // Health penalty tracking fields
  if (row.tokenExpiresAt !== null) profile.tokenExpiresAt = row.tokenExpiresAt;
  if (row.lastErrorAt !== null) profile.lastErrorAt = row.lastErrorAt;
  if (row.errorCount1h !== null) profile.errorCount1h = row.errorCount1h;
  if (row.penaltyScore !== null) profile.penaltyScore = row.penaltyScore;
  if (row.penaltyUpdatedAt !== null)
    profile.penaltyUpdatedAt = row.penaltyUpdatedAt;
  if (row.planType !== null) profile.planType = row.planType;

  // Auth artifacts
  if (row.authFileHash !== null)
    profile.artifacts.authFileHash = row.authFileHash;
  if (row.storageMode !== null)
    profile.artifacts.storageMode = row.storageMode as StorageMode;
  if (row.labels !== null) profile.labels = row.labels;

  return profile;
}

function rowToPool(row: {
  id: string;
  workspaceId: string;
  provider: string;
  rotationStrategy: string;
  cooldownMinutesDefault: number;
  maxRetries: number;
  activeProfileId?: string | null;
  lastRotatedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AccountPool {
  // Build base pool with required fields
  const pool: AccountPool = {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: row.provider as ProviderId,
    rotationStrategy: row.rotationStrategy as AccountPool["rotationStrategy"],
    cooldownMinutesDefault: row.cooldownMinutesDefault,
    maxRetries: row.maxRetries,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  // Conditionally add optional fields (for exactOptionalPropertyTypes)
  if (row.activeProfileId !== null && row.activeProfileId !== undefined) {
    pool.activeProfileId = row.activeProfileId;
  }
  if (row.lastRotatedAt !== null && row.lastRotatedAt !== undefined) {
    pool.lastRotatedAt = row.lastRotatedAt;
  }

  return pool;
}
