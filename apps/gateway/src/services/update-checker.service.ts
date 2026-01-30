/**
 * Update Checker Service
 *
 * Checks for new releases from GitHub and downloads/verifies release assets
 * with SHA256 checksum verification.
 *
 * Features:
 * - Fetches latest release from GitHub API
 * - Downloads and parses checksums.json manifest
 * - Verifies downloaded files against checksums BEFORE writing to disk
 * - 24-hour caching to avoid rate limiting
 * - Progress callbacks for download monitoring
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import type {
  ChecksumManifest,
  DownloadProgress,
  DownloadProgressCallback,
  DownloadResult,
  ReleaseAsset,
  ReleaseInfo,
  UpdateCheckCache,
  UpdateCheckerConfig,
  UpdateCheckerService,
  UpdateCheckResult,
} from "@flywheel/shared";
import { UpdateError, UpdateErrorCode } from "@flywheel/shared";
import { getLogger } from "../middleware/correlation";
import { loadToolRegistry } from "./tool-registry.service";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_CACHE_FILE = ".update-cache.json";
const GITHUB_API_BASE = "https://api.github.com";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Compare semantic versions.
 * Returns true if `latest` is newer than `current`.
 */
function isNewerVersion(current: string, latest: string): boolean {
  const currentParts = current.replace(/^v/, "").split(".").map(Number);
  const latestParts = latest.replace(/^v/, "").split(".").map(Number);

  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const currentPart = currentParts[i] ?? 0;
    const latestPart = latestParts[i] ?? 0;

    if (latestPart > currentPart) return true;
    if (latestPart < currentPart) return false;
  }

  return false;
}

/**
 * Get platform identifier for current system.
 */
function _getPlatformIdentifier(): string {
  const platform = process.platform;
  const arch = process.arch;

  // Map to standard identifiers
  const platformMap: Record<string, string> = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows",
  };

  const archMap: Record<string, string> = {
    x64: "x64",
    arm64: "arm64",
    arm: "arm",
  };

  return `${platformMap[platform] ?? platform}-${archMap[arch] ?? arch}`;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Parse ACFS checksum format.
 * Supports formats:
 * - Raw hex: "abc123..."
 * - Prefixed: "sha256:abc123..." or "sha512:abc123..."
 */
function parseAcfsChecksum(checksum: string): {
  algorithm: "sha256" | "sha512";
  hash: string;
} {
  if (checksum.startsWith("sha512:")) {
    return { algorithm: "sha512", hash: checksum.slice(7) };
  }
  if (checksum.startsWith("sha256:")) {
    return { algorithm: "sha256", hash: checksum.slice(7) };
  }
  // Default to sha256 for raw hex
  return { algorithm: "sha256", hash: checksum };
}

// ============================================================================
// ACFS Checksum Verification Types
// ============================================================================

/**
 * Result of verifying a file against ACFS checksums.
 */
export interface AcfsVerifyResult {
  /** Whether the checksum matched */
  verified: boolean;
  /** Tool ID from the registry */
  toolId: string;
  /** Filename that was matched */
  filename: string;
  /** Actual computed checksum */
  actualChecksum: string;
  /** Expected checksum from ACFS manifest */
  expectedChecksum: string;
  /** Algorithm used (sha256 or sha512) */
  algorithm: "sha256" | "sha512";
  /** File size in bytes */
  size: number;
}

/**
 * Result of refreshing ACFS checksums from a remote source.
 */
export interface AcfsRefreshResult {
  /** Whether the refresh was successful */
  success: boolean;
  /** Number of tools with checksums updated */
  updatedTools: number;
  /** Source URL that was fetched */
  sourceUrl: string;
  /** When the refresh occurred */
  refreshedAt: string;
  /** Error message if refresh failed */
  error?: string;
}

// ============================================================================
// Update Checker Implementation
// ============================================================================

export function createUpdateCheckerService(
  config: UpdateCheckerConfig,
): UpdateCheckerService {
  const {
    owner,
    repo,
    currentVersion,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    cacheFile = DEFAULT_CACHE_FILE,
    includePrereleases = false,
    userAgent = `flywheel-gateway/${currentVersion}`,
  } = config;

  const log = getLogger();

  /**
   * Make authenticated request to GitHub API.
   */
  async function githubFetch(endpoint: string): Promise<Response> {
    const url = `${GITHUB_API_BASE}${endpoint}`;

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": userAgent,
    };

    // Use GitHub token if available
    const token = process.env["GITHUB_TOKEN"];
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(url, { headers });

    if (response.status === 403) {
      const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
      if (rateLimitRemaining === "0") {
        throw new UpdateError(
          "GitHub API rate limit exceeded. Try again later or set GITHUB_TOKEN.",
          UpdateErrorCode.RATE_LIMITED,
        );
      }
    }

    return response;
  }

  /**
   * Fetch latest release from GitHub.
   */
  async function fetchLatestRelease(): Promise<ReleaseInfo> {
    log.debug({ owner, repo }, "Fetching latest release from GitHub");

    const endpoint = `/repos/${owner}/${repo}/releases/latest`;
    const response = await githubFetch(endpoint);

    if (!response.ok) {
      if (response.status === 404) {
        throw new UpdateError(
          `No releases found for ${owner}/${repo}`,
          UpdateErrorCode.RELEASE_NOT_FOUND,
        );
      }
      throw new UpdateError(
        `GitHub API error: ${response.status} ${response.statusText}`,
        UpdateErrorCode.NETWORK_ERROR,
      );
    }

    const data = await response.json();

    // Fetch checksums.json from release assets
    const checksumsAsset = data.assets?.find(
      (a: { name: string }) => a.name === "checksums.json",
    );

    const checksums: Map<string, { sha256: string; sha512?: string }> =
      new Map();

    if (checksumsAsset) {
      try {
        const checksumsResponse = await fetch(
          checksumsAsset.browser_download_url,
        );
        const manifest: ChecksumManifest = await checksumsResponse.json();

        for (const file of manifest.files) {
          checksums.set(file.filename, {
            sha256: file.sha256,
            sha512: file.sha512,
          });
        }
      } catch (error) {
        log.warn(
          { error },
          "Failed to fetch checksums.json, proceeding without checksums",
        );
      }
    }

    // Map GitHub release to our format
    const assets: ReleaseAsset[] = (data.assets ?? [])
      .filter(
        (a: { name: string }) =>
          a.name.endsWith(".tar.gz") ||
          a.name.endsWith(".tar.xz") ||
          a.name.endsWith(".zip") ||
          a.name.endsWith(".exe") ||
          a.name.endsWith(".dmg") ||
          a.name.endsWith(".AppImage"),
      )
      .map(
        (a: {
          name: string;
          browser_download_url: string;
          size: number;
          content_type: string;
        }) => ({
          name: a.name,
          downloadUrl: a.browser_download_url,
          size: a.size,
          sha256: checksums.get(a.name)?.sha256 ?? "",
          sha512: checksums.get(a.name)?.sha512,
          contentType: a.content_type,
        }),
      );

    return {
      version: data.tag_name?.replace(/^v/, "") ?? "unknown",
      tagName: data.tag_name ?? "unknown",
      publishedAt: data.published_at ?? new Date().toISOString(),
      name: data.name ?? data.tag_name ?? "Unknown Release",
      changelog: data.body ?? "",
      prerelease: data.prerelease ?? false,
      draft: data.draft ?? false,
      assets,
      htmlUrl: data.html_url ?? "",
    };
  }

  /**
   * Read cached update check result.
   */
  async function getCachedResult(): Promise<UpdateCheckResult | null> {
    if (!existsSync(cacheFile)) {
      return null;
    }

    try {
      const content = await readFile(cacheFile, "utf-8");
      const cache: UpdateCheckCache = JSON.parse(content);

      const expiresAt = new Date(cache.expiresAt).getTime();
      if (Date.now() > expiresAt) {
        log.debug("Update cache expired");
        return null;
      }

      log.debug("Using cached update check result");
      return { ...cache.result, fromCache: true };
    } catch (error) {
      log.warn({ error }, "Failed to read update cache");
      return null;
    }
  }

  /**
   * Write update check result to cache.
   */
  async function cacheResult(result: UpdateCheckResult): Promise<void> {
    const cache: UpdateCheckCache = {
      result,
      expiresAt: new Date(Date.now() + cacheTtlMs).toISOString(),
    };

    try {
      await writeFile(cacheFile, JSON.stringify(cache, null, 2));
    } catch (error) {
      log.warn({ error }, "Failed to write update cache");
    }
  }

  return {
    async checkForUpdates(): Promise<UpdateCheckResult> {
      // Try cache first
      const cached = await getCachedResult();
      if (cached) {
        return cached;
      }

      log.info("Checking for updates...");

      try {
        const release = await fetchLatestRelease();

        // Skip prereleases unless configured
        if (release.prerelease && !includePrereleases) {
          log.debug({ version: release.version }, "Skipping prerelease");
          // Would need to fetch all releases and find latest non-prerelease
          // For simplicity, treat as no update available
        }

        const updateAvailable = isNewerVersion(currentVersion, release.version);

        const result: UpdateCheckResult = {
          currentVersion,
          latestVersion: release.version,
          updateAvailable,
          ...(updateAvailable && { release }),
          checkedAt: new Date().toISOString(),
          fromCache: false,
        };

        await cacheResult(result);

        log.info(
          {
            currentVersion,
            latestVersion: release.version,
            updateAvailable,
          },
          updateAvailable ? "Update available" : "Already on latest version",
        );

        return result;
      } catch (error) {
        if (error instanceof UpdateError) {
          throw error;
        }
        throw new UpdateError(
          `Failed to check for updates: ${error instanceof Error ? error.message : String(error)}`,
          UpdateErrorCode.NETWORK_ERROR,
          error instanceof Error ? error : undefined,
        );
      }
    },

    async downloadAndVerify(
      asset: ReleaseAsset,
      destPath: string,
      onProgress?: DownloadProgressCallback,
    ): Promise<DownloadResult> {
      log.info({ asset: asset.name, destPath }, "Downloading release asset");

      const startTime = performance.now();

      try {
        const response = await fetch(asset.downloadUrl);

        if (!response.ok) {
          throw new UpdateError(
            `Download failed: ${response.status} ${response.statusText}`,
            UpdateErrorCode.DOWNLOAD_FAILED,
          );
        }

        const contentLength = parseInt(
          response.headers.get("content-length") ?? "0",
          10,
        );
        const chunks: Uint8Array[] = [];
        let downloaded = 0;
        let lastProgressUpdate = 0;

        const reader = response.body?.getReader();
        if (!reader) {
          throw new UpdateError(
            "Failed to get response body reader",
            UpdateErrorCode.DOWNLOAD_FAILED,
          );
        }

        // Download with progress tracking
        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          chunks.push(value);
          downloaded += value.length;

          // Throttle progress updates to every 100ms
          const now = performance.now();
          if (onProgress && now - lastProgressUpdate > 100) {
            const elapsed = (now - startTime) / 1000;
            const speed = downloaded / elapsed;
            const eta =
              contentLength > 0 ? (contentLength - downloaded) / speed : null;

            const progress: DownloadProgress = {
              downloaded,
              total: contentLength,
              percentage:
                contentLength > 0
                  ? Math.round((downloaded / contentLength) * 100)
                  : null,
              speed: Math.round(speed),
              eta: eta !== null ? Math.round(eta) : null,
            };

            onProgress(progress);
            lastProgressUpdate = now;
          }
        }

        // Combine chunks
        const content = Buffer.concat(chunks);

        // Verify checksum BEFORE writing to disk
        const actualChecksum = createHash("sha256")
          .update(content)
          .digest("hex");

        if (asset.sha256 && !secureCompare(actualChecksum, asset.sha256)) {
          throw new UpdateError(
            `Checksum mismatch!\n` +
              `Expected: ${asset.sha256}\n` +
              `Actual:   ${actualChecksum}\n\n` +
              `This could indicate a corrupted download or tampered file.\n` +
              `The file was NOT written to disk.`,
            UpdateErrorCode.CHECKSUM_MISMATCH,
          );
        }

        // Only write after verification passes
        await writeFile(destPath, content);

        const durationMs = Math.round(performance.now() - startTime);

        log.info(
          {
            asset: asset.name,
            size: content.length,
            durationMs,
            verified: !!asset.sha256,
          },
          "Download complete",
        );

        return {
          filePath: destPath,
          actualChecksum,
          expectedChecksum: asset.sha256,
          verified:
            !!asset.sha256 && secureCompare(actualChecksum, asset.sha256),
          size: content.length,
          durationMs,
        };
      } catch (error) {
        if (error instanceof UpdateError) {
          throw error;
        }
        throw new UpdateError(
          `Download failed: ${error instanceof Error ? error.message : String(error)}`,
          UpdateErrorCode.DOWNLOAD_FAILED,
          error instanceof Error ? error : undefined,
        );
      }
    },

    async clearCache(): Promise<void> {
      if (existsSync(cacheFile)) {
        await unlink(cacheFile);
        log.debug("Update cache cleared");
      }
    },

    async getCacheStatus(): Promise<{
      cached: boolean;
      expiresIn?: number;
      lastCheck?: string;
    }> {
      if (!existsSync(cacheFile)) {
        return { cached: false };
      }

      try {
        const content = await readFile(cacheFile, "utf-8");
        const cache: UpdateCheckCache = JSON.parse(content);
        const expiresAt = new Date(cache.expiresAt).getTime();
        const expiresIn = expiresAt - Date.now();

        if (expiresIn <= 0) {
          return { cached: false };
        }

        return {
          cached: true,
          expiresIn,
          lastCheck: cache.result.checkedAt,
        };
      } catch {
        return { cached: false };
      }
    },
  };
}

// ============================================================================
// Singleton
// ============================================================================

let serviceInstance: UpdateCheckerService | null = null;

/**
 * Get the singleton update checker service.
 */
export function getUpdateCheckerService(): UpdateCheckerService {
  if (!serviceInstance) {
    serviceInstance = createUpdateCheckerService({
      owner: "Dicklesworthstone",
      repo: "flywheel_gateway",
      currentVersion: process.env["VERSION"] ?? "0.0.0",
    });
  }
  return serviceInstance;
}

// ============================================================================
// ACFS Checksum Verification Functions
// ============================================================================

/**
 * Verify a file against ACFS tool registry checksums.
 *
 * This function:
 * 1. Loads the tool registry (with caching)
 * 2. Finds the tool by ID
 * 3. Looks up the checksum for the given filename
 * 4. Computes the file's actual checksum
 * 5. Performs constant-time comparison
 *
 * @param toolId - Tool ID from the ACFS registry (e.g., "agents.claude")
 * @param filename - The artifact filename to match in checksums
 * @param filePath - Path to the file to verify
 * @returns Verification result with details
 */
export async function verifyAgainstAcfsChecksums(
  toolId: string,
  filename: string,
  filePath: string,
): Promise<AcfsVerifyResult> {
  const log = getLogger();

  log.debug(
    { toolId, filename, filePath },
    "Verifying file against ACFS checksums",
  );

  // Load tool registry
  const registry = await loadToolRegistry();
  const tool = registry.tools.find((t) => t.id === toolId);

  if (!tool) {
    throw new UpdateError(
      `Tool not found in ACFS registry: ${toolId}`,
      UpdateErrorCode.ASSET_NOT_FOUND,
    );
  }

  if (!tool.checksums || Object.keys(tool.checksums).length === 0) {
    throw new UpdateError(
      `No checksums defined for tool: ${toolId}`,
      UpdateErrorCode.CHECKSUM_MISMATCH,
    );
  }

  const expectedRaw = tool.checksums[filename];
  if (!expectedRaw) {
    throw new UpdateError(
      `No checksum found for file '${filename}' in tool '${toolId}'. ` +
        `Available files: ${Object.keys(tool.checksums).join(", ")}`,
      UpdateErrorCode.ASSET_NOT_FOUND,
    );
  }

  // Parse checksum format (may be prefixed with algorithm)
  const { algorithm, hash: expectedChecksum } = parseAcfsChecksum(expectedRaw);

  // Read file and compute checksum
  const content = await readFile(filePath);
  const actualChecksum = createHash(algorithm).update(content).digest("hex");

  // Constant-time comparison
  const verified = secureCompare(actualChecksum, expectedChecksum);

  const result: AcfsVerifyResult = {
    verified,
    toolId,
    filename,
    actualChecksum,
    expectedChecksum,
    algorithm,
    size: content.length,
  };

  if (!verified) {
    log.warn(
      {
        toolId,
        filename,
        expected: `${expectedChecksum.substring(0, 16)}...`,
        actual: `${actualChecksum.substring(0, 16)}...`,
      },
      "ACFS checksum mismatch",
    );
  } else {
    log.info(
      { toolId, filename, algorithm, size: content.length },
      "ACFS checksum verified",
    );
  }

  return result;
}

/**
 * Find a tool's checksum for a file, matching by filename pattern.
 *
 * Useful when you don't know the exact filename but have a pattern
 * (e.g., looking for any linux-x64 tarball).
 *
 * @param toolId - Tool ID from the ACFS registry
 * @param pattern - Regex pattern or glob-like pattern to match filenames
 * @returns The matching filename and checksum, or null if not found
 */
export async function findAcfsChecksum(
  toolId: string,
  pattern: string | RegExp,
): Promise<{
  filename: string;
  checksum: string;
  algorithm: "sha256" | "sha512";
} | null> {
  const registry = await loadToolRegistry();
  const tool = registry.tools.find((t) => t.id === toolId);

  if (!tool?.checksums) {
    return null;
  }

  const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;

  for (const [filename, checksum] of Object.entries(tool.checksums)) {
    if (regex.test(filename)) {
      const { algorithm, hash } = parseAcfsChecksum(checksum);
      return { filename, checksum: hash, algorithm };
    }
  }

  return null;
}

/**
 * Get checksum age for a tool (time since registry was last loaded).
 *
 * This helps determine if checksums might be stale and need refresh.
 *
 * @param toolId - Tool ID to check
 * @returns Age information or null if tool not found
 */
export async function getChecksumAge(toolId: string): Promise<{
  toolId: string;
  hasChecksums: boolean;
  checksumCount: number;
  registryGeneratedAt?: string;
} | null> {
  const registry = await loadToolRegistry();
  const tool = registry.tools.find((t) => t.id === toolId);

  if (!tool) {
    return null;
  }

  // Build result, only including registryGeneratedAt if defined
  const result: {
    toolId: string;
    hasChecksums: boolean;
    checksumCount: number;
    registryGeneratedAt?: string;
  } = {
    toolId,
    hasChecksums: !!(tool.checksums && Object.keys(tool.checksums).length > 0),
    checksumCount: tool.checksums ? Object.keys(tool.checksums).length : 0,
  };

  if (registry.generatedAt !== undefined) {
    result.registryGeneratedAt = registry.generatedAt;
  }

  return result;
}

/**
 * Verify multiple files against ACFS checksums in batch.
 *
 * @param toolId - Tool ID from the ACFS registry
 * @param files - Array of { filename, filePath } to verify
 * @returns Array of verification results
 */
export async function verifyAcfsBatch(
  toolId: string,
  files: Array<{ filename: string; filePath: string }>,
): Promise<AcfsVerifyResult[]> {
  const results: AcfsVerifyResult[] = [];

  for (const { filename, filePath } of files) {
    try {
      const result = await verifyAgainstAcfsChecksums(
        toolId,
        filename,
        filePath,
      );
      results.push(result);
    } catch (_error) {
      // Include failed verifications with verified=false
      results.push({
        verified: false,
        toolId,
        filename,
        actualChecksum: "",
        expectedChecksum: "",
        algorithm: "sha256",
        size: 0,
      });
    }
  }

  return results;
}

/**
 * List all tools with checksums defined in the ACFS registry.
 *
 * Useful for audit and monitoring checksum coverage.
 */
export async function listToolsWithChecksums(): Promise<
  Array<{
    toolId: string;
    name: string;
    checksumCount: number;
    filenames: string[];
  }>
> {
  const registry = await loadToolRegistry();

  return registry.tools
    .filter((tool) => tool.checksums && Object.keys(tool.checksums).length > 0)
    .map((tool) => ({
      toolId: tool.id,
      name: tool.name,
      checksumCount: Object.keys(tool.checksums!).length,
      filenames: Object.keys(tool.checksums!),
    }));
}
