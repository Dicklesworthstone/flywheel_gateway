import type { CommandRegistry, RegisteredCommand } from "../types";

/**
 * Generated REST route metadata for a command.
 */
export interface GeneratedRoute {
  /** Command name */
  commandName: string;
  /** HTTP method */
  method: string;
  /** URL path (with :params) */
  path: string;
  /** Path parameters */
  pathParams: string[];
  /** Whether the endpoint supports streaming */
  streaming: boolean;
  /** Generated handler function code */
  handlerCode: string;
}

/**
 * Generate REST route code from the command registry.
 *
 * This produces Hono-compatible route definitions that can be used
 * to create route handlers.
 */
export function generateRestRoutes(registry: CommandRegistry): GeneratedRoute[] {
  const routes: GeneratedRoute[] = [];

  for (const cmd of registry.all()) {
    routes.push(generateRoute(cmd));
  }

  return routes;
}

/**
 * Generate a single REST route from a command.
 */
function generateRoute(cmd: RegisteredCommand): GeneratedRoute {
  const { name, rest, pathParams } = cmd;
  const streaming = rest.streaming ?? false;

  // Generate handler code
  const handlerCode = generateHandlerCode(cmd);

  return {
    commandName: name,
    method: rest.method,
    path: rest.path,
    pathParams,
    streaming,
    handlerCode,
  };
}

/**
 * Generate the handler function code for a command.
 */
function generateHandlerCode(cmd: RegisteredCommand): string {
  const { name, rest, pathParams } = cmd;
  const methodLower = rest.method.toLowerCase();
  const hasBody = rest.method === "POST" || rest.method === "PUT" || rest.method === "PATCH";
  const streaming = rest.streaming ?? false;

  // Build parameter extraction
  const paramLines: string[] = [];
  for (const param of pathParams) {
    paramLines.push(`    const ${param} = c.req.param('${param}');`);
  }

  // Build input construction
  const inputLines: string[] = [];
  if (hasBody) {
    inputLines.push("    const body = await c.req.json();");
    if (pathParams.length > 0) {
      const paramList = pathParams.join(", ");
      inputLines.push(`    const input = { ...body, ${paramList} };`);
    } else {
      inputLines.push("    const input = body;");
    }
  } else if (pathParams.length > 0) {
    inputLines.push("    const query = c.req.query();");
    const paramList = pathParams.join(", ");
    inputLines.push(`    const input = { ...query, ${paramList} };`);
  } else {
    inputLines.push("    const query = c.req.query();");
    inputLines.push("    const input = query;");
  }

  // Handler name (replace . with _)
  const handlerName = name.replace(/\./g, "_");

  // Build handler
  const lines: string[] = [
    `// Generated handler for ${name}`,
    `app.${methodLower}('${rest.path}', async (c) => {`,
    `    const correlationId = c.get('correlationId') ?? crypto.randomUUID();`,
    ...paramLines,
    ...inputLines,
    "",
    "    // Validate input",
    `    const validation = commands.get('${name}')!.inputSchema.safeParse(input);`,
    "    if (!validation.success) {",
    "      return c.json(serializeGatewayError(",
    "        createValidationError('INVALID_REQUEST', validation.error.errors.map(e => ({",
    "          path: e.path.join('.'),",
    "          message: e.message,",
    "          code: e.code,",
    "        })))",
    "      ), 400);",
    "    }",
    "",
    "    // Execute handler",
    "    try {",
    `      const result = await handlers.${handlerName}(validation.data, { correlationId, timestamp: new Date() });`,
  ];

  if (streaming) {
    lines.push(
      "      // Streaming response",
      "      return streamSSE(c, async (stream) => {",
      "        for await (const chunk of result) {",
      "          await stream.writeSSE({ data: JSON.stringify(chunk), event: 'chunk' });",
      "        }",
      "      });",
    );
  } else {
    lines.push("      return c.json(result);");
  }

  lines.push(
    "    } catch (error) {",
    "      const gatewayError = toGatewayError(error);",
    "      return c.json(serializeGatewayError(gatewayError), gatewayError.httpStatus);",
    "    }",
    "});",
  );

  return lines.join("\n");
}

/**
 * Generate a complete routes file from the command registry.
 */
export function generateRoutesFile(registry: CommandRegistry): string {
  const routes = generateRestRoutes(registry);

  const imports = [
    "import { Hono } from 'hono';",
    "import { streamSSE } from 'hono/streaming';",
    "import { commands } from '@flywheel/shared/commands';",
    "import { createValidationError, toGatewayError, serializeGatewayError } from '@flywheel/shared/errors';",
    "import * as handlers from '../handlers';",
    "",
    "const app = new Hono();",
    "",
  ];

  const routeCode = routes.map((r) => r.handlerCode).join("\n\n");

  const exports = [
    "",
    "export default app;",
  ];

  return [...imports, routeCode, ...exports].join("\n");
}

/**
 * Get route metadata for documentation.
 */
export function getRouteMetadata(
  registry: CommandRegistry,
): Array<{
  method: string;
  path: string;
  command: string;
  description: string;
  permissions: string[];
}> {
  return registry.all().map((cmd) => ({
    method: cmd.rest.method,
    path: cmd.rest.path,
    command: cmd.name,
    description: cmd.description,
    permissions: cmd.metadata.permissions,
  }));
}
