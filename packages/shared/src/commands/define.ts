import type { z } from "zod";
import type {
  CommandDefinition,
  CommandDefinitionInput,
  RegisteredCommand,
} from "./types";

/**
 * Extract path parameters from a REST path template.
 * @param path - Path template (e.g., "/agents/:agentId/output")
 * @returns Array of parameter names (e.g., ["agentId"])
 */
function extractPathParams(path: string): string[] {
  const paramRegex = /:([a-zA-Z][a-zA-Z0-9]*)/g;
  const params: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = paramRegex.exec(path)) !== null) {
    const param = match[1];
    if (param !== undefined) {
      params.push(param);
    }
  }
  return params;
}

/**
 * Extract category from command name.
 * @param name - Command name (e.g., "agent.spawn")
 * @returns Category name (e.g., "agent")
 */
function extractCategory(name: string): string {
  const dotIndex = name.indexOf(".");
  return dotIndex === -1 ? name : name.slice(0, dotIndex);
}

/**
 * Define a type-safe command with full validation.
 *
 * @example
 * ```typescript
 * const spawnAgent = defineCommand({
 *   name: "agent.spawn",
 *   description: "Spawn a new agent",
 *   input: z.object({ repoUrl: z.string().url(), task: z.string() }),
 *   output: z.object({ agentId: z.string().uuid() }),
 *   rest: { method: "POST", path: "/agents" },
 *   metadata: { permissions: ["agent:write"], audit: true },
 *   aiHints: {
 *     whenToUse: "Use when starting a new agent",
 *     examples: ["Spawn an agent to fix the login bug"],
 *     relatedCommands: ["agent.stop", "agent.status"],
 *   },
 * });
 * ```
 */
export function defineCommand<
  TInput extends z.ZodType,
  TOutput extends z.ZodType,
>(
  input: CommandDefinitionInput<TInput, TOutput>,
): RegisteredCommand<TInput, TOutput> {
  // Validate command name format (category.action or just category, lowercase only)
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)?$/.test(input.name)) {
    throw new Error(
      `Invalid command name "${input.name}". Must be lowercase in format "category.action" or "category".`,
    );
  }

  // Validate REST path format
  if (!input.rest.path.startsWith("/")) {
    throw new Error(
      `Invalid REST path "${input.rest.path}". Must start with "/".`,
    );
  }

  // Validate that DELETE commands are not marked as safe
  if (input.rest.method === "DELETE" && input.metadata.safe) {
    throw new Error(
      `Command "${input.name}" is a DELETE operation and cannot be marked as safe.`,
    );
  }

  // Validate AI hints
  if (!input.aiHints.whenToUse || input.aiHints.whenToUse.trim().length === 0) {
    throw new Error(
      `Command "${input.name}" must have a non-empty whenToUse AI hint.`,
    );
  }

  if (!input.aiHints.examples || input.aiHints.examples.length === 0) {
    throw new Error(
      `Command "${input.name}" must have at least one example in AI hints.`,
    );
  }

  // Build definition with conditional optional properties
  const definition: CommandDefinition<TInput, TOutput> = {
    name: input.name,
    description: input.description,
    inputSchema: input.input,
    outputSchema: input.output,
    rest: input.rest,
    metadata: input.metadata,
    aiHints: input.aiHints,
  };

  // Only add ws if defined (exactOptionalPropertyTypes compliance)
  if (input.ws !== undefined) {
    (definition as { ws: typeof input.ws }).ws = input.ws;
  }

  return {
    ...definition,
    category: extractCategory(input.name),
    pathParams: extractPathParams(input.rest.path),
  };
}

/**
 * Type helper to infer command input type.
 */
export type InferCommandInput<T extends RegisteredCommand> =
  T extends RegisteredCommand<infer TInput, z.ZodType>
    ? z.infer<TInput>
    : never;

/**
 * Type helper to infer command output type.
 */
export type InferCommandOutput<T extends RegisteredCommand> =
  T extends RegisteredCommand<z.ZodType, infer TOutput>
    ? z.infer<TOutput>
    : never;
