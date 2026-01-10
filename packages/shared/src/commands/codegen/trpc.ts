import type { CommandRegistry, RegisteredCommand } from "../types";

/**
 * Generated tRPC procedure metadata.
 */
export interface GeneratedProcedure {
  /** Command name */
  commandName: string;
  /** Procedure type (query or mutation) */
  type: "query" | "mutation";
  /** Generated procedure code */
  procedureCode: string;
}

/**
 * Determine if a command should be a query or mutation.
 * GET requests with safe=true are queries, everything else is mutation.
 */
function getProcedureType(cmd: RegisteredCommand): "query" | "mutation" {
  if (cmd.rest.method === "GET" && cmd.metadata.safe) {
    return "query";
  }
  return "mutation";
}

/**
 * Generate tRPC procedures from the command registry.
 */
export function generateTrpcProcedures(
  registry: CommandRegistry,
): GeneratedProcedure[] {
  const procedures: GeneratedProcedure[] = [];

  for (const cmd of registry.all()) {
    procedures.push({
      commandName: cmd.name,
      type: getProcedureType(cmd),
      procedureCode: generateProcedureCode(cmd),
    });
  }

  return procedures;
}

/**
 * Generate procedure code for a single command.
 */
function generateProcedureCode(cmd: RegisteredCommand): string {
  const { name } = cmd;
  const procedureName = name.replace(/\./g, "_");
  const procedureType = getProcedureType(cmd);

  const lines = [
    `// Generated procedure for ${name}`,
    `export const ${procedureName} = publicProcedure`,
    `  .input(commands.get('${name}')!.inputSchema)`,
    `  .output(commands.get('${name}')!.outputSchema)`,
    `  .${procedureType}(async ({ input, ctx }) => {`,
    `    return handlers.${procedureName}(input, {`,
    `      correlationId: ctx.correlationId,`,
    `      timestamp: new Date(),`,
    `      workspaceId: ctx.workspaceId,`,
    `    });`,
    `  });`,
  ];

  return lines.join("\n");
}

/**
 * Generate a complete tRPC router file from the command registry.
 */
export function generateTrpcRouterFile(registry: CommandRegistry): string {
  const procedures = generateTrpcProcedures(registry);

  // Group by category
  const byCategory = new Map<string, GeneratedProcedure[]>();
  for (const proc of procedures) {
    const category = proc.commandName.split(".")[0] ?? "default";
    const list = byCategory.get(category) ?? [];
    list.push(proc);
    byCategory.set(category, list);
  }

  const imports = [
    "import { initTRPC } from '@trpc/server';",
    "import { commands } from '@flywheel/shared/commands';",
    "import * as handlers from '../handlers';",
    "",
    "const t = initTRPC.context<{ correlationId: string; workspaceId?: string }>().create();",
    "const publicProcedure = t.procedure;",
    "",
  ];

  // Generate procedures
  const procedureCode = procedures.map((p) => p.procedureCode).join("\n\n");

  // Generate router
  const routerLines: string[] = ["", "export const appRouter = t.router({"];
  for (const [category, procs] of byCategory) {
    routerLines.push(`  ${category}: t.router({`);
    for (const proc of procs) {
      const actionName = proc.commandName.split(".")[1] ?? proc.commandName;
      const procedureName = proc.commandName.replace(/\./g, "_");
      routerLines.push(`    ${actionName}: ${procedureName},`);
    }
    routerLines.push("  }),");
  }
  routerLines.push("});", "", "export type AppRouter = typeof appRouter;");

  return [...imports, procedureCode, ...routerLines].join("\n");
}

/**
 * Get procedure metadata for documentation.
 */
export function getProcedureMetadata(registry: CommandRegistry): Array<{
  name: string;
  type: "query" | "mutation";
  description: string;
  permissions: string[];
}> {
  return registry.all().map((cmd) => ({
    name: cmd.name.replace(/\./g, "_"),
    type: getProcedureType(cmd),
    description: cmd.description,
    permissions: cmd.metadata.permissions,
  }));
}
