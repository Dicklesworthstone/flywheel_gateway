import { z } from "zod";

export interface BvCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface BvCommandRunner {
  run: (
    command: string,
    args: string[],
    options?: { cwd?: string },
  ) => Promise<BvCommandResult>;
}

export interface BvClientOptions {
  runner: BvCommandRunner;
  cwd?: string;
}

export class BvClientError extends Error {
  readonly kind: "command_failed" | "parse_error" | "validation_error";
  readonly details?: Record<string, unknown>;

  constructor(
    kind: BvClientError["kind"],
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "BvClientError";
    this.kind = kind;
    if (details) {
      this.details = details;
    }
  }
}

const BeadTypeSchema = z.enum(["bug", "feature", "task", "epic", "chore"]);

const RecommendationSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    type: z.string().optional(),
    score: z.number(),
    reasons: z.array(z.string()).optional(),
    status: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough();

const TriageSchema = z
  .object({
    recommendations: z.array(RecommendationSchema).optional(),
    quick_wins: z.array(RecommendationSchema).optional(),
    blockers_to_clear: z.array(RecommendationSchema).optional(),
  })
  .passthrough();

const BvTriageResultSchema = z
  .object({
    generated_at: z.string(),
    data_hash: z.string().optional(),
    triage: TriageSchema,
  })
  .passthrough();

const BvInsightsResultSchema = z
  .object({
    generated_at: z.string(),
    data_hash: z.string().optional(),
  })
  .passthrough();

const BvPlanResultSchema = z
  .object({
    generated_at: z.string(),
    data_hash: z.string().optional(),
  })
  .passthrough();

export type BvBeadType = z.infer<typeof BeadTypeSchema>;
export type BvRecommendation = z.infer<typeof RecommendationSchema>;
export type BvTriageResult = z.infer<typeof BvTriageResultSchema>;
export type BvInsightsResult = z.infer<typeof BvInsightsResultSchema>;
export type BvPlanResult = z.infer<typeof BvPlanResultSchema>;

export interface BvClient {
  getTriage: (options?: { cwd?: string }) => Promise<BvTriageResult>;
  getInsights: (options?: { cwd?: string }) => Promise<BvInsightsResult>;
  getPlan: (options?: { cwd?: string }) => Promise<BvPlanResult>;
}

async function runBvCommand(
  runner: BvCommandRunner,
  args: string[],
  cwd?: string,
): Promise<string> {
  const runOptions: { cwd?: string } = {};
  if (cwd !== undefined) runOptions.cwd = cwd;
  const result = await runner.run("bv", args, runOptions);
  if (result.exitCode !== 0) {
    throw new BvClientError("command_failed", "BV command failed", {
      exitCode: result.exitCode,
      stderr: result.stderr,
    });
  }
  return result.stdout;
}

export function createBvClient(options: BvClientOptions): BvClient {
  const baseCwd = options.cwd;

  return {
    getTriage: async (opts) => {
      const cwd = opts?.cwd ?? baseCwd;
      const stdout = await runBvCommand(
        options.runner,
        ["--robot-triage"],
        cwd,
      );
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch (error) {
        throw new BvClientError("parse_error", "Failed to parse BV output", {
          cause: error,
        });
      }

      const result = BvTriageResultSchema.safeParse(parsed);
      if (!result.success) {
        throw new BvClientError("validation_error", "Invalid BV output", {
          issues: result.error.issues,
        });
      }

      return result.data;
    },
    getInsights: async (opts) => {
      const cwd = opts?.cwd ?? baseCwd;
      const stdout = await runBvCommand(
        options.runner,
        ["--robot-insights"],
        cwd,
      );
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch (error) {
        throw new BvClientError("parse_error", "Failed to parse BV output", {
          cause: error,
        });
      }

      const result = BvInsightsResultSchema.safeParse(parsed);
      if (!result.success) {
        throw new BvClientError("validation_error", "Invalid BV output", {
          issues: result.error.issues,
        });
      }

      return result.data;
    },
    getPlan: async (opts) => {
      const cwd = opts?.cwd ?? baseCwd;
      const stdout = await runBvCommand(options.runner, ["--robot-plan"], cwd);
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch (error) {
        throw new BvClientError("parse_error", "Failed to parse BV output", {
          cause: error,
        });
      }

      const result = BvPlanResultSchema.safeParse(parsed);
      if (!result.success) {
        throw new BvClientError("validation_error", "Invalid BV output", {
          issues: result.error.issues,
        });
      }

      return result.data;
    },
  };
}
