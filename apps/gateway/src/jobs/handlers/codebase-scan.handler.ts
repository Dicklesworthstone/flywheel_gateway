/**
 * Codebase Scan Job Handler
 *
 * Scans a codebase directory for files matching specified patterns.
 * Supports checkpointing for resume on large codebases.
 */

import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { JobHandler, JobContext, ValidationResult } from "../../types/job.types";

export interface CodebaseScanInput {
  path: string;
  patterns?: string[];
  excludePatterns?: string[];
  maxFiles?: number;
  includeStats?: boolean;
}

export interface CodebaseScanOutput {
  files: ScanResult[];
  totalFiles: number;
  totalSize: number;
  scannedAt: string;
}

export interface ScanResult {
  path: string;
  relativePath: string;
  size?: number;
  modifiedAt?: string;
}

interface ScanCheckpoint {
  scannedDirs: string[];
  files: ScanResult[];
  totalSize: number;
}

export class CodebaseScanHandler implements JobHandler<CodebaseScanInput, CodebaseScanOutput> {
  async validate(input: CodebaseScanInput): Promise<ValidationResult> {
    const errors: string[] = [];

    if (!input.path) {
      errors.push("path is required");
    }

    if (input.maxFiles !== undefined && input.maxFiles < 1) {
      errors.push("maxFiles must be at least 1");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  async execute(context: JobContext<CodebaseScanInput>): Promise<CodebaseScanOutput> {
    const { input } = context;
    const maxFiles = input.maxFiles ?? 10000;

    context.log("info", "Starting codebase scan", { path: input.path });
    await context.setStage("initializing");

    // Check for existing checkpoint
    const checkpoint = (await context.getCheckpoint()) as ScanCheckpoint | null;
    const scannedDirs = new Set(checkpoint?.scannedDirs ?? []);
    const files: ScanResult[] = checkpoint?.files ?? [];
    let totalSize = checkpoint?.totalSize ?? 0;

    await context.setStage("scanning");

    // Get all directories to scan
    const dirsToScan = await this.getDirectories(input.path, input.excludePatterns ?? []);

    for (let i = 0; i < dirsToScan.length; i++) {
      // Check for cancellation
      context.throwIfCancelled();

      const dir = dirsToScan[i];

      // Skip already scanned directories
      if (scannedDirs.has(dir)) {
        continue;
      }

      // Update progress
      await context.updateProgress(
        i,
        dirsToScan.length,
        `Scanning ${relative(input.path, dir) || "root"}`,
      );

      // Scan directory
      const dirFiles = await this.scanDirectory(
        dir,
        input.path,
        input.patterns ?? ["*"],
        input.excludePatterns ?? [],
        input.includeStats ?? false,
      );

      for (const file of dirFiles) {
        if (files.length >= maxFiles) {
          break;
        }
        files.push(file);
        totalSize += file.size ?? 0;
      }

      scannedDirs.add(dir);

      // Checkpoint every 100 directories
      if (i % 100 === 0) {
        await context.checkpoint({
          scannedDirs: Array.from(scannedDirs),
          files,
          totalSize,
        });
      }

      if (files.length >= maxFiles) {
        context.log("warn", "Max files limit reached", { maxFiles, found: files.length });
        break;
      }
    }

    await context.updateProgress(dirsToScan.length, dirsToScan.length, "Scan complete");

    context.log("info", "Codebase scan complete", {
      totalFiles: files.length,
      totalSize,
    });

    return {
      files,
      totalFiles: files.length,
      totalSize,
      scannedAt: new Date().toISOString(),
    };
  }

  async onCancel(context: JobContext<CodebaseScanInput>): Promise<void> {
    context.log("info", "Scan cancelled, preserving checkpoint");
  }

  private async getDirectories(
    basePath: string,
    excludePatterns: string[],
  ): Promise<string[]> {
    const dirs: string[] = [basePath];
    const queue: string[] = [basePath];

    while (queue.length > 0) {
      const current = queue.shift()!;

      try {
        const entries = await readdir(current, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory()) {
            const dirPath = join(current, entry.name);
            const relativePath = relative(basePath, dirPath);

            // Skip excluded patterns
            if (this.matchesAny(relativePath, excludePatterns)) {
              continue;
            }

            // Skip common ignored directories
            if (this.isIgnoredDirectory(entry.name)) {
              continue;
            }

            dirs.push(dirPath);
            queue.push(dirPath);
          }
        }
      } catch {
        // Directory may not be accessible
      }
    }

    return dirs;
  }

  private async scanDirectory(
    dirPath: string,
    basePath: string,
    patterns: string[],
    excludePatterns: string[],
    includeStats: boolean,
  ): Promise<ScanResult[]> {
    const results: ScanResult[] = [];

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile()) {
          const filePath = join(dirPath, entry.name);
          const relativePath = relative(basePath, filePath);

          // Check patterns
          if (!this.matchesAny(entry.name, patterns)) {
            continue;
          }

          // Check exclude patterns
          if (this.matchesAny(relativePath, excludePatterns)) {
            continue;
          }

          const result: ScanResult = {
            path: filePath,
            relativePath,
          };

          if (includeStats) {
            try {
              const stats = await stat(filePath);
              result.size = stats.size;
              result.modifiedAt = stats.mtime.toISOString();
            } catch {
              // Stats may not be available
            }
          }

          results.push(result);
        }
      }
    } catch {
      // Directory may not be accessible
    }

    return results;
  }

  private matchesAny(name: string, patterns: string[]): boolean {
    if (patterns.length === 0 || patterns.includes("*")) {
      return true;
    }

    return patterns.some((pattern) => {
      if (pattern.startsWith("*.")) {
        return name.endsWith(pattern.slice(1));
      }
      if (pattern.endsWith("*")) {
        return name.startsWith(pattern.slice(0, -1));
      }
      return name === pattern || name.includes(pattern);
    });
  }

  private isIgnoredDirectory(name: string): boolean {
    const ignored = [
      "node_modules",
      ".git",
      ".svn",
      ".hg",
      "__pycache__",
      ".cache",
      "dist",
      "build",
      "coverage",
      ".next",
      ".nuxt",
      "vendor",
    ];
    return ignored.includes(name) || name.startsWith(".");
  }
}
