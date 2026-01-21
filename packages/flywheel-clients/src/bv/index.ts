import { CliClientError, type CliErrorDetails, type CliErrorKind } from "@flywheel/shared";
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

export class BvClientError extends CliClientError {
  constructor(kind: CliErrorKind, message: string, details?: CliErrorDetails) {
    super(kind, message, details);
    this.name = "BvClientError";
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

// Graph types for visualization
const BvGraphNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.number().optional(),
  pagerank: z.number().optional(),
  type: z.string().optional(),
  labels: z.array(z.string()).optional(),
});

const BvGraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.string().optional(),
});

const BvGraphResultSchema = z
  .object({
    format: z.string().optional(),
    nodes: z.union([z.number(), z.array(BvGraphNodeSchema)]),
    edges: z.union([z.number(), z.array(BvGraphEdgeSchema)]),
    data_hash: z.string().optional(),
    explanation: z
      .object({
        what: z.string().optional(),
        when_to_use: z.string().optional(),
      })
      .optional(),
    adjacency: z
      .object({
        nodes: z.array(BvGraphNodeSchema).optional(),
        edges: z.array(BvGraphEdgeSchema).optional(),
      })
      .optional(),
  })
  .passthrough();

export type BvBeadType = z.infer<typeof BeadTypeSchema>;
export type BvRecommendation = z.infer<typeof RecommendationSchema>;
export type BvTriageResult = z.infer<typeof BvTriageResultSchema>;
export type BvInsightsResult = z.infer<typeof BvInsightsResultSchema>;
export type BvPlanResult = z.infer<typeof BvPlanResultSchema>;
export type BvGraphNode = z.infer<typeof BvGraphNodeSchema>;
export type BvGraphEdge = z.infer<typeof BvGraphEdgeSchema>;
export type BvGraphResult = z.infer<typeof BvGraphResultSchema>;

/**
 * Options for getGraph method.
 */
export interface BvGraphOptions {
  /** Working directory */
  cwd?: string;
  /** Output format: json, dot, or mermaid */
  format?: "json" | "dot" | "mermaid";
  /** Root issue ID for subgraph (optional) */
  rootId?: string;
  /** Max depth for subgraph (0 = unlimited) */
  depth?: number;
}

export interface BvClient {
  getTriage: (options?: { cwd?: string }) => Promise<BvTriageResult>;
  getInsights: (options?: { cwd?: string }) => Promise<BvInsightsResult>;
  getPlan: (options?: { cwd?: string }) => Promise<BvPlanResult>;
  getGraph: (options?: BvGraphOptions) => Promise<BvGraphResult>;
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
    getGraph: async (opts) => {
      const cwd = opts?.cwd ?? baseCwd;
      const format = opts?.format ?? "json";

      // Build command arguments
      const args = ["--robot-graph", "--graph-format", format];

      // Add optional parameters
      if (opts?.rootId) {
        args.push("--graph-root", opts.rootId);
      }
      if (opts?.depth !== undefined && opts.depth > 0) {
        args.push("--graph-depth", String(opts.depth));
      }

      const stdout = await runBvCommand(options.runner, args, cwd);

      // For non-JSON formats, return raw output
      if (format !== "json") {
        return {
          format,
          nodes: 0,
          edges: 0,
          data_hash: undefined,
          raw: stdout,
        } as BvGraphResult;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch (error) {
        throw new BvClientError("parse_error", "Failed to parse BV output", {
          cause: error,
        });
      }

      const result = BvGraphResultSchema.safeParse(parsed);
      if (!result.success) {
        throw new BvClientError("validation_error", "Invalid BV output", {
          issues: result.error.issues,
        });
      }

      return result.data;
    },
  };
}
