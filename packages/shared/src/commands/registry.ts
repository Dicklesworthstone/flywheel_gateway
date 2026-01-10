import type { CommandRegistry, RegisteredCommand } from "./types";

/**
 * Create a command registry from an array of registered commands.
 *
 * @example
 * ```typescript
 * import { createCommandRegistry } from "./registry";
 * import { agentCommands } from "./commands/agent";
 * import { checkpointCommands } from "./commands/checkpoint";
 *
 * export const commandRegistry = createCommandRegistry([
 *   ...agentCommands,
 *   ...checkpointCommands,
 * ]);
 * ```
 */
export function createCommandRegistry(
  commands: readonly RegisteredCommand[],
): CommandRegistry {
  const byName = new Map<string, RegisteredCommand>();
  const byCategory = new Map<string, RegisteredCommand[]>();
  const pathConflicts = new Map<string, string>();

  // Register all commands and check for conflicts
  for (const cmd of commands) {
    // Check for duplicate names
    if (byName.has(cmd.name)) {
      throw new Error(
        `Duplicate command name: "${cmd.name}". Each command must have a unique name.`,
      );
    }

    // Check for conflicting REST paths
    const pathKey = `${cmd.rest.method}:${cmd.rest.path}`;
    const existingCmd = pathConflicts.get(pathKey);
    if (existingCmd) {
      throw new Error(
        `REST path conflict: "${cmd.rest.method} ${cmd.rest.path}" is used by both "${existingCmd}" and "${cmd.name}".`,
      );
    }

    byName.set(cmd.name, cmd);
    pathConflicts.set(pathKey, cmd.name);

    // Group by category
    const categoryList = byCategory.get(cmd.category) ?? [];
    categoryList.push(cmd);
    byCategory.set(cmd.category, categoryList);
  }

  return {
    get(name: string): RegisteredCommand | undefined {
      return byName.get(name);
    },

    has(name: string): boolean {
      return byName.has(name);
    },

    all(): RegisteredCommand[] {
      return Array.from(byName.values());
    },

    byCategory(category: string): RegisteredCommand[] {
      return byCategory.get(category) ?? [];
    },

    categories(): string[] {
      return Array.from(byCategory.keys());
    },

    get size(): number {
      return byName.size;
    },
  };
}

/**
 * Validate a command registry and return any issues found.
 */
export function validateRegistry(
  registry: CommandRegistry,
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  for (const cmd of registry.all()) {
    // Every command should have at least one permission
    if (cmd.metadata.permissions.length === 0) {
      issues.push(`Command "${cmd.name}" has no permissions defined.`);
    }

    // Check for related commands that don't exist
    for (const related of cmd.aiHints.relatedCommands) {
      if (!registry.has(related)) {
        issues.push(
          `Command "${cmd.name}" references unknown related command "${related}".`,
        );
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
