import type { CliErrorDetails, CliErrorKind } from "@flywheel/shared";
import { z } from "zod";

export type CliCommandErrorKind = CliErrorKind | "spawn_failed";

export class CliCommandError extends Error {
  readonly kind: CliCommandErrorKind;
  readonly details?: CliErrorDetails;

  constructor(
    kind: CliCommandErrorKind,
    message: string,
    details?: CliErrorDetails,
  ) {
    super(message);
    this.name = "CliCommandError";
    this.kind = kind;
    if (details) {
      this.details = details;
    }
  }
}

export interface CliCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  timedOut?: boolean;
}

export interface CliCommandOptions {
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: Record<string, string>;
}

export interface CliCommandRunner {
  run: (
    command: string,
    args: string[],
    options?: CliCommandOptions,
  ) => Promise<CliCommandResult>;
}

export interface CliRunnerDefaults {
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

async function readStreamSafe(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let totalBytes = 0;
  let truncated = false;
  const drainLimit = maxBytes * 5;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.length;

      if (content.length < maxBytes) {
        const chunk = decoder.decode(value, { stream: true });
        if (content.length + chunk.length > maxBytes) {
          truncated = true;
          content += chunk.slice(0, Math.max(0, maxBytes - content.length));
        } else {
          content += chunk;
        }
      } else {
        truncated = true;
      }

      if (totalBytes > drainLimit) {
        await reader.cancel();
        break;
      }
    }
  } catch {
    // Ignore stream errors (e.g. process killed)
  } finally {
    reader.releaseLock();
  }

  // Flush any remaining bytes from the decoder
  if (!truncated && content.length < maxBytes) {
    content += decoder.decode();
  }

  if (content.length > maxBytes) {
    truncated = true;
    content = content.slice(0, maxBytes);
  }

  return { text: content, truncated };
}

export function createBunCliRunner(
  defaults: CliRunnerDefaults = {},
): CliCommandRunner {
  return {
    run: async (command, args, options) => {
      const timeoutMs =
        options?.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const maxOutputBytes =
        options?.maxOutputBytes ??
        defaults.maxOutputBytes ??
        DEFAULT_MAX_OUTPUT_BYTES;

      let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
      try {
        const spawnOpts: Parameters<typeof Bun.spawn>[1] = {
          stdout: "pipe",
          stderr: "pipe",
          env: {
            ...process.env,
            ...defaults.env,
            ...options?.env,
            NO_COLOR: "1",
          },
        };
        if (options?.cwd) {
          spawnOpts.cwd = options.cwd;
        }
        proc = Bun.spawn([command, ...args], spawnOpts);
      } catch (error) {
        throw new CliCommandError("spawn_failed", "Failed to spawn command", {
          command,
          args,
          cause: error instanceof Error ? error.message : String(error),
        });
      }

      let timedOut = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise =
        timeoutMs > 0
          ? new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => {
                timedOut = true;
                proc.kill(9);
                reject(
                  new CliCommandError("timeout", "Command timed out", {
                    command,
                    args,
                    timeoutMs,
                  }),
                );
              }, timeoutMs);
            })
          : null;

      const stdoutPromise = readStreamSafe(proc.stdout, maxOutputBytes);
      const stderrPromise = proc.stderr
        ? readStreamSafe(proc.stderr, maxOutputBytes)
        : Promise.resolve({ text: "", truncated: false });

      try {
        await Promise.race(
          [proc.exited, timeoutPromise].filter(Boolean) as Promise<unknown>[],
        );
      } finally {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }

      const stdout = await stdoutPromise;
      const stderr = await stderrPromise;

      const result: CliCommandResult = {
        stdout: stdout.text,
        stderr: stderr.text,
        exitCode: proc.exitCode ?? -1,
      };
      if (stdout.truncated) result.stdoutTruncated = true;
      if (stderr.truncated) result.stderrTruncated = true;
      if (timedOut) result.timedOut = true;
      return result;
    },
  };
}

export function parseJson<T>(
  stdout: string,
  context: string,
  maxSnippet = 500,
): T {
  try {
    return JSON.parse(stdout) as T;
  } catch (error) {
    throw new CliCommandError("parse_error", `Failed to parse ${context}`, {
      cause: error instanceof Error ? error.message : String(error),
      stdout: stdout.slice(0, maxSnippet),
    });
  }
}

export function parseJsonWithSchema<T>(
  stdout: string,
  schema: z.ZodSchema<T>,
  context: string,
): T {
  const parsed = parseJson<unknown>(stdout, context);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new CliCommandError(
      "validation_error",
      `Invalid ${context} response`,
      { issues: result.error.issues },
    );
  }
  return result.data;
}
