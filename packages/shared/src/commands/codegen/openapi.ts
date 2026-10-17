import type { CommandRegistry, RegisteredCommand } from "../types";

/**
 * OpenAPI 3.1 specification types (simplified).
 */
export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
}

interface PathItem {
  get?: Operation;
  post?: Operation;
  put?: Operation;
  patch?: Operation;
  delete?: Operation;
}

interface Operation {
  operationId: string;
  summary: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: RequestBody;
  responses: Record<string, Response>;
  security?: Array<Record<string, string[]>>;
  "x-ai-hints"?: {
    whenToUse: string;
    examples: string[];
    relatedCommands: string[];
  };
}

interface Parameter {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  schema: { type: string };
  description?: string;
}

interface RequestBody {
  required: boolean;
  content: {
    "application/json": {
      schema: unknown;
    };
  };
}

interface Response {
  description: string;
  content?: {
    "application/json": {
      schema: unknown;
    };
  };
}

/**
 * Generate OpenAPI 3.1 specification from the command registry.
 */
export function generateOpenAPISpec(
  registry: CommandRegistry,
  options: {
    title: string;
    version: string;
    description?: string;
  },
): OpenAPISpec {
  const paths: Record<string, PathItem> = {};

  for (const cmd of registry.all()) {
    const pathKey = cmd.rest.path;
    if (!paths[pathKey]) {
      paths[pathKey] = {};
    }

    const method = cmd.rest.method.toLowerCase() as keyof PathItem;
    paths[pathKey][method] = generateOperation(cmd);
  }

  // Build info with conditional description
  const info: OpenAPISpec["info"] = {
    title: options.title,
    version: options.version,
  };
  if (options.description !== undefined) {
    info.description = options.description;
  }

  return {
    openapi: "3.1.0",
    info,
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  };
}

/**
 * Generate OpenAPI operation from a command.
 */
function generateOperation(cmd: RegisteredCommand): Operation {
  const { name, description, rest, pathParams, metadata, aiHints } = cmd;
  const hasBody =
    rest.method === "POST" || rest.method === "PUT" || rest.method === "PATCH";

  // Build parameters
  const parameters: Parameter[] = pathParams.map((param) => ({
    name: param,
    in: "path" as const,
    required: true,
    schema: { type: "string" },
  }));

  // Build operation with conditional optional properties
  const operation: Operation = {
    operationId: name.replace(/\./g, "_"),
    summary: description,
    tags: [cmd.category],
    responses: {
      "200": {
        description: "Success",
        content: {
          "application/json": {
            schema: { type: "object" },
          },
        },
      },
      "400": {
        description: "Invalid request",
      },
      "401": {
        description: "Unauthorized",
      },
      "404": {
        description: "Not found",
      },
      "500": {
        description: "Server error",
      },
    },
    "x-ai-hints": {
      whenToUse: aiHints.whenToUse,
      examples: aiHints.examples,
      relatedCommands: aiHints.relatedCommands,
    },
  };

  // Add parameters only if present
  if (parameters.length > 0) {
    operation.parameters = parameters;
  }

  if (hasBody) {
    operation.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { type: "object" },
        },
      },
    };
  }

  if (metadata.permissions.length > 0) {
    operation.security = [{ bearerAuth: [] }];
  }

  return operation;
}

/**
 * Generate OpenAPI spec as JSON string.
 */
export function generateOpenAPIJSON(
  registry: CommandRegistry,
  options: {
    title: string;
    version: string;
    description?: string;
  },
): string {
  const spec = generateOpenAPISpec(registry, options);
  return JSON.stringify(spec, null, 2);
}
