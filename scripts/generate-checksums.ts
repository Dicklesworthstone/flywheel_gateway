#!/usr/bin/env bun

/**
 * Checksum Generation Script
 *
 * Generates SHA256 and SHA512 checksums for release artifacts.
 * Creates individual checksum files and a combined checksums.txt/checksums.json manifest.
 *
 * Usage:
 *   bun scripts/generate-checksums.ts <directory>
 *   bun scripts/generate-checksums.ts release-artifacts
 *
 * Output files:
 *   - <filename>.sha256     - Individual SHA256 checksum
 *   - <filename>.sha512     - Individual SHA512 checksum
 *   - checksums.txt         - Combined SHA256 checksums (sha256sum format)
 *   - checksums.json        - JSON manifest with all checksums
 */

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

// ============================================================================
// Types
// ============================================================================

interface ChecksumEntry {
  filename: string;
  sha256: string;
  sha512: string;
  size: number;
  createdAt: string;
}

interface ChecksumManifest {
  version: string;
  generated: string;
  generator: string;
  files: ChecksumEntry[];
}

// ============================================================================
// Checksum Functions
// ============================================================================

/**
 * Generate hash for a buffer using the specified algorithm.
 */
function generateHash(content: Buffer, algorithm: "sha256" | "sha512"): string {
  return createHash(algorithm).update(content).digest("hex");
}

/**
 * Generate checksums for a single file.
 */
async function generateFileChecksums(
  filepath: string,
): Promise<ChecksumEntry | null> {
  try {
    const content = await readFile(filepath);
    const fileStats = await stat(filepath);

    const sha256 = generateHash(content, "sha256");
    const sha512 = generateHash(content, "sha512");

    return {
      filename: basename(filepath),
      sha256,
      sha512,
      size: fileStats.size,
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`Failed to process ${filepath}:`, error);
    return null;
  }
}

/**
 * Format a checksum entry in sha256sum/sha512sum compatible format.
 * Uses two spaces between hash and filename (standard format).
 */
function formatChecksumLine(hash: string, filename: string): string {
  return `${hash}  ${filename}\n`;
}

// ============================================================================
// Main
// ============================================================================

async function generateChecksums(directory: string): Promise<ChecksumEntry[]> {
  console.log(`Generating checksums for files in: ${directory}`);

  // List files in directory
  const files = await readdir(directory);

  // Filter for release artifacts (tarballs, zips, executables)
  const artifacts = files.filter(
    (f) =>
      f.endsWith(".tar.gz") ||
      f.endsWith(".tar.xz") ||
      f.endsWith(".zip") ||
      f.endsWith(".exe") ||
      f.endsWith(".dmg") ||
      f.endsWith(".AppImage"),
  );

  if (artifacts.length === 0) {
    console.log("No release artifacts found.");
    return [];
  }

  console.log(`Found ${artifacts.length} artifact(s):`);
  for (const artifact of artifacts) {
    console.log(`  - ${artifact}`);
  }

  const entries: ChecksumEntry[] = [];

  for (const filename of artifacts) {
    const filepath = join(directory, filename);
    console.log(`\nProcessing: ${filename}`);

    const entry = await generateFileChecksums(filepath);
    if (!entry) {
      continue;
    }

    entries.push(entry);

    // Write individual checksum files
    const sha256File = join(directory, `${filename}.sha256`);
    const sha512File = join(directory, `${filename}.sha512`);

    await writeFile(sha256File, formatChecksumLine(entry.sha256, filename));
    await writeFile(sha512File, formatChecksumLine(entry.sha512, filename));

    console.log(`  SHA256: ${entry.sha256.substring(0, 16)}...`);
    console.log(`  SHA512: ${entry.sha512.substring(0, 16)}...`);
    console.log(`  Size: ${formatBytes(entry.size)}`);
  }

  // Write combined checksums.txt (SHA256 only, standard format)
  const checksumsTxt = entries
    .map((e) => formatChecksumLine(e.sha256, e.filename))
    .join("");
  await writeFile(join(directory, "checksums.txt"), checksumsTxt);
  console.log(`\nWrote: checksums.txt`);

  // Write JSON manifest for programmatic access
  const manifest: ChecksumManifest = {
    version: process.env["VERSION"] ?? "unknown",
    generated: new Date().toISOString(),
    generator: "flywheel-gateway/generate-checksums",
    files: entries,
  };
  await writeFile(
    join(directory, "checksums.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(`Wrote: checksums.json`);

  return entries;
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  const directory = process.argv[2];

  if (!directory) {
    console.error("Usage: bun scripts/generate-checksums.ts <directory>");
    console.error(
      "Example: bun scripts/generate-checksums.ts release-artifacts",
    );
    process.exit(2);
  }

  try {
    const entries = await generateChecksums(directory);

    if (entries.length === 0) {
      console.log("\nNo artifacts processed.");
      process.exit(0);
    }

    console.log(`\n${"─".repeat(50)}`);
    console.log(`Generated checksums for ${entries.length} artifact(s)`);
    console.log(
      `Total size: ${formatBytes(entries.reduce((sum, e) => sum + e.size, 0))}`,
    );
    console.log(`${"─".repeat(50)}`);
  } catch (error) {
    console.error("Error generating checksums:", error);
    process.exit(1);
  }
}

main();
