/**
 * GIIL (Get Image from Internet Link) Client
 *
 * Provides typed access to the giil CLI for downloading images from cloud
 * photo sharing services (iCloud, Dropbox, Google Photos, Google Drive).
 * Useful for agents to retrieve and process images from shared links.
 *
 * CLI: https://github.com/Dicklesworthstone/giil
 */

import {
  CliClientError,
  type CliErrorDetails,
  type CliErrorKind,
} from "@flywheel/shared";
import { z } from "zod";
import {
  CliCommandError,
  createBunCliRunner as createSharedBunCliRunner,
} from "../cli-runner";

// ============================================================================
// Command Runner Interface
// ============================================================================

export interface GiilCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GiilCommandRunner {
  run: (
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ) => Promise<GiilCommandResult>;
}

export interface GiilClientOptions {
  runner: GiilCommandRunner;
  cwd?: string;
  /** Default timeout in milliseconds (default: 120000) */
  timeout?: number;
  /** Default output directory */
  outputDir?: string;
}

// ============================================================================
// Error Types
// ============================================================================

export class GiilClientError extends CliClientError {
  constructor(kind: CliErrorKind, message: string, details?: CliErrorDetails) {
    super(kind, message, details);
    this.name = "GiilClientError";
  }
}

// ============================================================================
// Zod Schemas
// ============================================================================

/** Supported platform types */
const GiilPlatformSchema = z.enum([
  "icloud",
  "dropbox",
  "google_photos",
  "google_drive",
  "unknown",
]);

/** Image conversion formats */
const GiilConvertFormatSchema = z.enum(["jpeg", "png", "webp"]);

/** Download result metadata */
const GiilDownloadResultSchema = z
  .object({
    success: z.boolean(),
    url: z.string(),
    platform: GiilPlatformSchema.optional(),
    filename: z.string().optional(),
    output_path: z.string().optional(),
    file_size: z.number().optional(),
    mime_type: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    direct_url: z.string().optional(),
    base64: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();

/** Album download results */
const GiilAlbumResultSchema = z
  .object({
    success: z.boolean(),
    url: z.string(),
    platform: GiilPlatformSchema.optional(),
    photos_found: z.number().optional(),
    photos_downloaded: z.number().optional(),
    photos_failed: z.number().optional(),
    output_dir: z.string().optional(),
    files: z.array(GiilDownloadResultSchema).optional(),
    error: z.string().optional(),
  })
  .passthrough();

// ============================================================================
// Exported Types
// ============================================================================

export type GiilPlatform = z.infer<typeof GiilPlatformSchema>;
export type GiilConvertFormat = z.infer<typeof GiilConvertFormatSchema>;
export type GiilDownloadResult = z.infer<typeof GiilDownloadResultSchema>;
export type GiilAlbumResult = z.infer<typeof GiilAlbumResultSchema>;

export interface GiilStatus {
  available: boolean;
  version?: string;
}

// ============================================================================
// Options Types
// ============================================================================

export interface GiilCommandOptions {
  cwd?: string;
  timeout?: number;
}

export interface GiilDownloadOptions extends GiilCommandOptions {
  /** Output directory for downloaded image */
  outputDir?: string;
  /** JPEG/WebP quality 1-100 (default: 85) */
  quality?: number;
  /** Keep original bytes (skip compression) */
  preserve?: boolean;
  /** Convert to specified format */
  convert?: GiilConvertFormat;
  /** Output base64-encoded image data */
  base64?: boolean;
  /** Only return direct URL without downloading */
  printUrl?: boolean;
}

export interface GiilAlbumOptions extends GiilDownloadOptions {
  /** Download all photos from shared album */
  all?: boolean;
}

// ============================================================================
// Client Interface
// ============================================================================

export interface GiilClient {
  /** Download a single image from a URL */
  download: (
    url: string,
    options?: GiilDownloadOptions,
  ) => Promise<GiilDownloadResult>;

  /** Download all images from an album */
  downloadAlbum: (
    url: string,
    options?: GiilAlbumOptions,
  ) => Promise<GiilAlbumResult>;

  /** Get direct URL for an image without downloading */
  getDirectUrl: (
    url: string,
    options?: GiilCommandOptions,
  ) => Promise<string | null>;

  /** Get overall status */
  status: (options?: GiilCommandOptions) => Promise<GiilStatus>;

  /** Fast availability check */
  isAvailable: () => Promise<boolean>;
}

// ============================================================================
// Implementation
// ============================================================================

async function runGiilCommand(
  runner: GiilCommandRunner,
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<string> {
  const result = await runner.run("giil", args, options);
  if (result.exitCode !== 0 && !result.stdout) {
    throw new GiilClientError("command_failed", "GIIL command failed", {
      exitCode: result.exitCode,
      stderr: result.stderr,
      args,
    });
  }
  return result.stdout;
}

function parseJson<T>(
  stdout: string,
  schema: z.ZodSchema<T>,
  context: string,
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new GiilClientError(
      "parse_error",
      `Failed to parse GIIL ${context}`,
      {
        cause: error instanceof Error ? error.message : String(error),
        stdout: stdout.slice(0, 500),
      },
    );
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new GiilClientError(
      "validation_error",
      `Invalid GIIL ${context} response`,
      {
        issues: result.error.issues,
      },
    );
  }

  return result.data;
}

function buildRunOptions(
  options: GiilClientOptions,
  override?: GiilCommandOptions,
): { cwd?: string; timeout?: number } {
  const result: { cwd?: string; timeout?: number } = {};
  const cwd = override?.cwd ?? options.cwd;
  const timeout = override?.timeout ?? options.timeout ?? 120000;
  if (cwd !== undefined) result.cwd = cwd;
  result.timeout = timeout;
  return result;
}

function buildDownloadArgs(
  options: GiilClientOptions,
  override?: GiilDownloadOptions,
): string[] {
  const args: string[] = [];

  const outputDir = override?.outputDir ?? options.outputDir;
  if (outputDir) args.push("--output", outputDir);
  if (override?.quality !== undefined)
    args.push("--quality", String(override.quality));
  if (override?.preserve) args.push("--preserve");
  if (override?.convert) args.push("--convert", override.convert);
  if (override?.base64) args.push("--base64");
  if (override?.printUrl) args.push("--print-url");

  return args;
}

async function getVersion(
  runner: GiilCommandRunner,
  cwd?: string,
): Promise<string | null> {
  try {
    const opts: { cwd?: string; timeout: number } = { timeout: 5000 };
    if (cwd !== undefined) opts.cwd = cwd;
    const result = await runner.run("giil", ["--help"], opts);
    if (result.exitCode !== 0) return null;
    // Extract version from help output (e.g., "giil v3.1.0" -> "3.1.0")
    const versionMatch = result.stdout.match(/giil\s+v?(\d+\.\d+\.\d+)/i);
    return versionMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

export function createGiilClient(options: GiilClientOptions): GiilClient {
  return {
    download: async (url, opts) => {
      const args = [url, "--json", ...buildDownloadArgs(options, opts)];

      const stdout = await runGiilCommand(
        options.runner,
        args,
        buildRunOptions(options, opts),
      );
      return parseJson(stdout, GiilDownloadResultSchema, "download");
    },

    downloadAlbum: async (url, opts) => {
      const args = [
        url,
        "--json",
        "--all",
        ...buildDownloadArgs(options, opts),
      ];

      const stdout = await runGiilCommand(
        options.runner,
        args,
        buildRunOptions(options, { ...opts, timeout: opts?.timeout ?? 600000 }),
      );
      return parseJson(stdout, GiilAlbumResultSchema, "album");
    },

    getDirectUrl: async (url, opts) => {
      const args = [url, "--print-url", "--quiet"];

      try {
        const stdout = await runGiilCommand(
          options.runner,
          args,
          buildRunOptions(options, opts),
        );
        const directUrl = stdout.trim();
        return directUrl.startsWith("http") ? directUrl : null;
      } catch {
        return null;
      }
    },

    status: async (opts): Promise<GiilStatus> => {
      try {
        const version = await getVersion(
          options.runner,
          opts?.cwd ?? options.cwd,
        );

        const status: GiilStatus = {
          available: true,
        };
        if (version !== null) status.version = version;
        return status;
      } catch {
        return {
          available: false,
        };
      }
    },

    isAvailable: async () => {
      try {
        const opts: { cwd?: string; timeout: number } = { timeout: 5000 };
        if (options.cwd !== undefined) opts.cwd = options.cwd;
        const result = await options.runner.run("giil", ["--help"], opts);
        return result.exitCode === 0;
      } catch {
        return false;
      }
    },
  };
}

// ============================================================================
// Default Command Runner (Bun subprocess)
// ============================================================================

/**
 * Create a command runner that uses Bun.spawn for subprocess execution.
 */
export function createBunGiilCommandRunner(): GiilCommandRunner {
  const runner = createSharedBunCliRunner({ timeoutMs: 120000 });
  return {
    run: async (command, args, options) => {
      try {
        const runOpts: { cwd?: string; timeoutMs?: number } = {};
        if (options?.cwd !== undefined) runOpts.cwd = options.cwd;
        if (options?.timeout !== undefined) runOpts.timeoutMs = options.timeout;
        const result = await runner.run(command, args, runOpts);
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      } catch (error) {
        if (error instanceof CliCommandError) {
          if (error.kind === "timeout") {
            throw new GiilClientError("timeout", "Command timed out", {
              timeout: options?.timeout ?? 120000,
            });
          }
          if (error.kind === "spawn_failed") {
            throw new GiilClientError(
              "unavailable",
              "GIIL command failed to start",
              {
                command,
                args,
                details: error.details,
              },
            );
          }
        }
        throw error;
      }
    },
  };
}
