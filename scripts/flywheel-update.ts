#!/usr/bin/env bun

/**
 * Flywheel Gateway Update CLI
 *
 * Check for updates and download new releases with checksum verification.
 *
 * Usage:
 *   bun scripts/flywheel-update.ts check           # Check for updates
 *   bun scripts/flywheel-update.ts download        # Download latest if available
 *   bun scripts/flywheel-update.ts clear-cache     # Clear update cache
 *   bun scripts/flywheel-update.ts --help          # Show help
 *
 * Options:
 *   --json         Output as JSON for automation
 *   --force        Force check, bypass cache
 *   --pre          Include prerelease versions
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// ============================================================================
// Types (inline to avoid import issues in standalone script)
// ============================================================================

interface ReleaseAsset {
  name: string;
  downloadUrl: string;
  size: number;
  sha256: string;
  sha512?: string;
}

interface ReleaseInfo {
  version: string;
  tagName: string;
  publishedAt: string;
  name: string;
  changelog: string;
  prerelease: boolean;
  assets: ReleaseAsset[];
  htmlUrl: string;
}

interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  release?: ReleaseInfo;
  checkedAt: string;
  fromCache: boolean;
}

interface UpdateCheckCache {
  result: UpdateCheckResult;
  expiresAt: string;
}

interface ChecksumManifest {
  version: string;
  generated: string;
  files: { filename: string; sha256: string; sha512: string }[];
}

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  owner: "Dicklesworthstone",
  repo: "flywheel_gateway",
  currentVersion: process.env["VERSION"] ?? "0.0.0",
  cacheFile: ".update-cache.json",
  cacheTtlMs: 24 * 60 * 60 * 1000,
  downloadDir: "downloads",
};

// ============================================================================
// Utility Functions
// ============================================================================

function colorize(
  text: string,
  color: "green" | "yellow" | "red" | "cyan" | "gray" | "bold",
): string {
  const colors: Record<string, string> = {
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    gray: "\x1b[90m",
    bold: "\x1b[1m",
  };
  return `${colors[color]}${text}\x1b[0m`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

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

function getPlatformIdentifier(): string {
  const platform = process.platform;
  const arch = process.arch;

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

function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ============================================================================
// GitHub API
// ============================================================================

async function fetchLatestRelease(
  includePrereleases: boolean,
): Promise<ReleaseInfo> {
  const { owner, repo, currentVersion } = CONFIG;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": `flywheel-gateway/${currentVersion}`,
  };

  const token = process.env["GITHUB_TOKEN"];
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`No releases found for ${owner}/${repo}`);
    }
    if (response.status === 403) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      if (remaining === "0") {
        throw new Error(
          "GitHub API rate limit exceeded. Set GITHUB_TOKEN to increase limit.",
        );
      }
    }
    throw new Error(
      `GitHub API error: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();

  // Fetch checksums.json
  const checksumsAsset = data.assets?.find(
    (a: { name: string }) => a.name === "checksums.json",
  );

  const checksums = new Map<string, { sha256: string; sha512?: string }>();

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
    } catch {
      console.warn(
        colorize("Warning: Could not fetch checksums.json", "yellow"),
      );
    }
  }

  const assets: ReleaseAsset[] = (data.assets ?? [])
    .filter(
      (a: { name: string }) =>
        a.name.endsWith(".tar.gz") ||
        a.name.endsWith(".zip") ||
        a.name.endsWith(".exe"),
    )
    .map((a: { name: string; browser_download_url: string; size: number }) => ({
      name: a.name,
      downloadUrl: a.browser_download_url,
      size: a.size,
      sha256: checksums.get(a.name)?.sha256 ?? "",
      sha512: checksums.get(a.name)?.sha512,
    }));

  return {
    version: data.tag_name?.replace(/^v/, "") ?? "unknown",
    tagName: data.tag_name ?? "unknown",
    publishedAt: data.published_at ?? new Date().toISOString(),
    name: data.name ?? data.tag_name ?? "Unknown Release",
    changelog: data.body ?? "",
    prerelease: data.prerelease ?? false,
    assets,
    htmlUrl: data.html_url ?? "",
  };
}

// ============================================================================
// Cache Management
// ============================================================================

async function getCachedResult(): Promise<UpdateCheckResult | null> {
  const { cacheFile } = CONFIG;

  if (!existsSync(cacheFile)) {
    return null;
  }

  try {
    const content = await readFile(cacheFile, "utf-8");
    const cache: UpdateCheckCache = JSON.parse(content);

    const expiresAt = new Date(cache.expiresAt).getTime();
    if (Date.now() > expiresAt) {
      return null;
    }

    return { ...cache.result, fromCache: true };
  } catch {
    return null;
  }
}

async function cacheResult(result: UpdateCheckResult): Promise<void> {
  const { cacheFile, cacheTtlMs } = CONFIG;

  const cache: UpdateCheckCache = {
    result,
    expiresAt: new Date(Date.now() + cacheTtlMs).toISOString(),
  };

  await writeFile(cacheFile, JSON.stringify(cache, null, 2));
}

async function clearCache(): Promise<void> {
  const { cacheFile } = CONFIG;

  if (existsSync(cacheFile)) {
    await unlink(cacheFile);
  }
}

// ============================================================================
// Commands
// ============================================================================

async function checkCommand(
  force: boolean,
  includePre: boolean,
  jsonOutput: boolean,
): Promise<void> {
  const { currentVersion } = CONFIG;

  // Try cache first (unless forced)
  if (!force) {
    const cached = await getCachedResult();
    if (cached) {
      if (jsonOutput) {
        console.log(JSON.stringify(cached, null, 2));
      } else {
        printCheckResult(cached);
      }
      return;
    }
  }

  try {
    const release = await fetchLatestRelease(includePre);

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

    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printCheckResult(result);
    }
  } catch (error) {
    if (jsonOutput) {
      console.log(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      process.exit(1);
    }

    console.error(
      colorize(
        `\nError: ${error instanceof Error ? error.message : String(error)}`,
        "red",
      ),
    );
    process.exit(1);
  }
}

function printCheckResult(result: UpdateCheckResult): void {
  console.log("");
  console.log(colorize("  Flywheel Gateway - Update Check", "cyan"));
  console.log(colorize("  " + "─".repeat(35), "gray"));
  console.log("");

  console.log(`  Current version: ${colorize(result.currentVersion, "bold")}`);
  console.log(`  Latest version:  ${colorize(result.latestVersion, "bold")}`);
  console.log("");

  if (result.updateAvailable) {
    console.log(colorize("  ✓ Update available!", "green"));
    console.log("");

    if (result.release) {
      console.log(
        `  Released: ${new Date(result.release.publishedAt).toLocaleDateString()}`,
      );

      if (result.release.assets.length > 0) {
        console.log("");
        console.log(colorize("  Available downloads:", "cyan"));
        for (const asset of result.release.assets) {
          const hasChecksum = asset.sha256
            ? colorize("✓", "green")
            : colorize("○", "yellow");
          console.log(
            `    ${hasChecksum} ${asset.name} (${formatBytes(asset.size)})`,
          );
        }
      }

      console.log("");
      console.log(colorize("  To download:", "cyan"));
      console.log("    bun scripts/flywheel-update.ts download");
      console.log("");
      console.log(
        `  Release page: ${colorize(result.release.htmlUrl, "cyan")}`,
      );
    }
  } else {
    console.log(colorize("  ✓ You're on the latest version!", "green"));
  }

  if (result.fromCache) {
    console.log("");
    console.log(colorize("  (from cache, use --force to bypass)", "gray"));
  }

  console.log("");
}

async function downloadCommand(jsonOutput: boolean): Promise<void> {
  const { currentVersion, downloadDir } = CONFIG;

  // First check for updates
  const cached = await getCachedResult();
  let result: UpdateCheckResult | null = cached;

  if (!result) {
    try {
      const release = await fetchLatestRelease(false);
      const updateAvailable = isNewerVersion(currentVersion, release.version);

      result = {
        currentVersion,
        latestVersion: release.version,
        updateAvailable,
        ...(updateAvailable && { release }),
        checkedAt: new Date().toISOString(),
        fromCache: false,
      };

      await cacheResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (jsonOutput) {
        console.log(JSON.stringify({ error: message }));
      } else {
        console.error(colorize(`Error: ${message}`, "red"));
      }
      process.exit(1);
    }
  }

  if (!result || !result.updateAvailable || !result.release) {
    if (jsonOutput) {
      console.log(JSON.stringify({ message: "No updates available" }));
    } else {
      console.log(colorize("\nNo updates available.", "yellow"));
    }
    return;
  }

  // Find asset for current platform
  const platform = getPlatformIdentifier();
  const release = result.release;
  const asset = release.assets.find((a) => a.name.includes(platform));

  if (!asset) {
    if (jsonOutput) {
      console.log(
        JSON.stringify({
          error: `No release asset found for ${platform}`,
          available: release.assets.map((a) => a.name),
        }),
      );
    } else {
      console.error(
        colorize(`\nNo release asset found for ${platform}`, "red"),
      );
      console.log("\nAvailable assets:");
      for (const a of release.assets) {
        console.log(`  - ${a.name}`);
      }
    }
    process.exit(1);
  }

  // Ensure download directory exists
  if (!existsSync(downloadDir)) {
    mkdirSync(downloadDir, { recursive: true });
  }

  const destPath = join(downloadDir, asset.name);

  if (!jsonOutput) {
    console.log("");
    console.log(colorize("  Downloading...", "cyan"));
    console.log(`  File: ${asset.name}`);
    console.log(`  Size: ${formatBytes(asset.size)}`);
    console.log("");
  }

  const startTime = performance.now();

  try {
    const response = await fetch(asset.downloadUrl);

    if (!response.ok) {
      throw new Error(
        `Download failed: ${response.status} ${response.statusText}`,
      );
    }

    const chunks: Uint8Array[] = [];
    let downloaded = 0;
    const contentLength = parseInt(
      response.headers.get("content-length") ?? "0",
      10,
    );

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Failed to get response reader");
    }

    // Download with progress
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      downloaded += value.length;

      if (!jsonOutput && contentLength > 0) {
        const percent = Math.round((downloaded / contentLength) * 100);
        process.stdout.write(
          `\r  Progress: ${percent}% (${formatBytes(downloaded)})`,
        );
      }
    }

    if (!jsonOutput) {
      console.log("");
    }

    const content = Buffer.concat(chunks);

    // Verify checksum BEFORE writing
    const actualChecksum = createHash("sha256").update(content).digest("hex");

    if (asset.sha256) {
      if (!secureCompare(actualChecksum, asset.sha256)) {
        const error = {
          error: "Checksum mismatch",
          expected: asset.sha256,
          actual: actualChecksum,
        };

        if (jsonOutput) {
          console.log(JSON.stringify(error));
        } else {
          console.error("");
          console.error(colorize("  ✗ Checksum mismatch!", "red"));
          console.error(`  Expected: ${asset.sha256}`);
          console.error(`  Actual:   ${actualChecksum}`);
          console.error("");
          console.error(colorize("  File NOT written to disk.", "red"));
          console.error(
            "  This could indicate a corrupted download or tampered file.",
          );
        }
        process.exit(1);
      }

      if (!jsonOutput) {
        console.log(colorize("  ✓ Checksum verified", "green"));
      }
    } else {
      if (!jsonOutput) {
        console.log(colorize("  ○ No checksum available to verify", "yellow"));
      }
    }

    // Write file
    await writeFile(destPath, content);

    const durationMs = Math.round(performance.now() - startTime);
    const speed = content.length / (durationMs / 1000);

    if (jsonOutput) {
      console.log(
        JSON.stringify({
          success: true,
          file: destPath,
          size: content.length,
          checksum: actualChecksum,
          verified: !!asset.sha256,
          durationMs,
        }),
      );
    } else {
      console.log("");
      console.log(colorize("  ✓ Download complete", "green"));
      console.log(`  Saved to: ${destPath}`);
      console.log(`  Speed: ${formatBytes(speed)}/s`);
      console.log("");
      console.log("  To install, extract the archive and follow the README.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (jsonOutput) {
      console.log(JSON.stringify({ error: message }));
    } else {
      console.error(colorize(`\n  ✗ ${message}`, "red"));
    }
    process.exit(1);
  }
}

async function clearCacheCommand(jsonOutput: boolean): Promise<void> {
  await clearCache();

  if (jsonOutput) {
    console.log(JSON.stringify({ success: true, message: "Cache cleared" }));
  } else {
    console.log(colorize("\n  ✓ Update cache cleared\n", "green"));
  }
}

function showHelp(): void {
  console.log(`
${colorize("Flywheel Gateway Update CLI", "cyan")}

${colorize("Usage:", "yellow")}
  flywheel-update <command> [options]

${colorize("Commands:", "yellow")}
  check        Check for available updates
  download     Download latest release (if available)
  clear-cache  Clear the update check cache

${colorize("Options:", "yellow")}
  --json       Output as JSON for automation
  --force      Force check, bypass cache
  --pre        Include prerelease versions
  --help, -h   Show this help

${colorize("Examples:", "yellow")}
  bun scripts/flywheel-update.ts check
  bun scripts/flywheel-update.ts check --json
  bun scripts/flywheel-update.ts check --force
  bun scripts/flywheel-update.ts download
  bun scripts/flywheel-update.ts clear-cache

${colorize("Environment:", "yellow")}
  GITHUB_TOKEN    GitHub personal access token (increases rate limit)
  VERSION         Override current version (for testing)

${colorize("Exit Codes:", "yellow")}
  0  Success
  1  Error (network, checksum mismatch, etc.)
  2  Invalid usage
`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args.find((a) => !a.startsWith("-"));
  const jsonOutput = args.includes("--json");
  const force = args.includes("--force");
  const includePre = args.includes("--pre");
  const help = args.includes("--help") || args.includes("-h");

  if (help) {
    showHelp();
    process.exit(0);
  }

  if (!command) {
    showHelp();
    process.exit(2);
  }

  switch (command) {
    case "check":
      await checkCommand(force, includePre, jsonOutput);
      break;

    case "download":
      await downloadCommand(jsonOutput);
      break;

    case "clear-cache":
      await clearCacheCommand(jsonOutput);
      break;

    default:
      console.error(colorize(`Unknown command: ${command}`, "red"));
      showHelp();
      process.exit(2);
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
