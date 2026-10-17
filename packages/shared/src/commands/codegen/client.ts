import { z } from "zod";
import type { CommandRegistry, RegisteredCommand } from "../types";

/**
 * Generated client method metadata.
 */
export interface GeneratedClientMethod {
  /** Command name */
  commandName: string;
  /** Method name in client */
  methodName: string;
  /** HTTP method */
  httpMethod: string;
  /** URL path template */
  path: string;
  /** Path parameters */
  pathParams: string[];
  /** Whether it returns a stream */
  streaming: boolean;
  /** Qualified input type name */
  inputTypeName: string;
  /** Qualified output type name */
  outputTypeName: string;
}

function getQualifiedTypeNames(cmd: RegisteredCommand): {
  inputTypeName: string;
  outputTypeName: string;
} {
  const capitalizedCategory =
    cmd.category.charAt(0).toUpperCase() + cmd.category.slice(1);
  const actionName = cmd.name.split(".")[1] ?? cmd.name;
  const capitalizedAction =
    actionName.charAt(0).toUpperCase() + actionName.slice(1);
  return {
    inputTypeName: `${capitalizedCategory}.${capitalizedAction}Input`,
    outputTypeName: `${capitalizedCategory}.${capitalizedAction}Output`,
  };
}

function jsonSchemaToTypeString(
  schema: Record<string, unknown>,
  indent = "  ",
): string {
  if (Array.isArray(schema["enum"])) {
    return (schema["enum"] as unknown[])
      .map((v) => JSON.stringify(v))
      .join(" | ");
  }
  if ("const" in schema) {
    return JSON.stringify(schema["const"]);
  }
  if (Array.isArray(schema["anyOf"]) || Array.isArray(schema["oneOf"])) {
    const variants = (schema["anyOf"] ?? schema["oneOf"]) as Record<
      string,
      unknown
    >[];
    return variants.map((v) => jsonSchemaToTypeString(v, indent)).join(" | ");
  }
  const type = schema["type"];
  if (type === "string") return "string";
  if (type === "number" || type === "integer") return "number";
  if (type === "boolean") return "boolean";
  if (type === "null") return "null";
  if (Array.isArray(type)) {
    return (type as string[])
      .map((t) => (t === "integer" ? "number" : t))
      .join(" | ");
  }
  if (type === "array") {
    const items = schema["items"] as Record<string, unknown> | undefined;
    if (!items) return "unknown[]";
    const itemType = jsonSchemaToTypeString(items, indent);
    return itemType.includes(" | ") ? `Array<${itemType}>` : `${itemType}[]`;
  }
  if (type === "object" || schema["properties"]) {
    const props = schema["properties"] as
      | Record<string, Record<string, unknown>>
      | undefined;
    const required = new Set(
      Array.isArray(schema["required"]) ? (schema["required"] as string[]) : [],
    );
    if (!props || Object.keys(props).length === 0) {
      if (
        schema["additionalProperties"] &&
        typeof schema["additionalProperties"] === "object"
      ) {
        const valType = jsonSchemaToTypeString(
          schema["additionalProperties"] as Record<string, unknown>,
          indent,
        );
        return `Record<string, ${valType}>`;
      }
      return "Record<string, unknown>";
    }
    const entries = Object.entries(props).map(([key, propSchema]) => {
      const opt = required.has(key) ? "" : "?";
      const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)
        ? key
        : JSON.stringify(key);
      const propType = jsonSchemaToTypeString(propSchema, `${indent}  `);
      return `${indent}  ${safeKey}${opt}: ${propType};`;
    });
    return `{\n${entries.join("\n")}\n${indent}}`;
  }
  return "unknown";
}

/**
 * Convert a Zod schema into a TypeScript type definition string.
 */
export function zodSchemaToTypeString(
  schema: z.ZodType,
  indent = "  ",
): string {
  try {
    const jsonSchema = z.toJSONSchema(schema, {
      unrepresentable: "any",
    }) as Record<string, unknown>;
    return jsonSchemaToTypeString(jsonSchema, indent);
  } catch {
    return "unknown";
  }
}

/**
 * Generate TypeScript client methods from the command registry.
 */
export function generateClientMethods(
  registry: CommandRegistry,
): GeneratedClientMethod[] {
  return registry.all().map((cmd) => {
    const { inputTypeName, outputTypeName } = getQualifiedTypeNames(cmd);
    return {
      commandName: cmd.name,
      methodName: cmd.name.replace(/\./g, "_"),
      httpMethod: cmd.rest.method,
      path: cmd.rest.path,
      pathParams: cmd.pathParams,
      streaming: cmd.rest.streaming ?? false,
      inputTypeName,
      outputTypeName,
    };
  });
}

/**
 * Generate a complete TypeScript client SDK from the command registry.
 */
export function generateClientSDK(
  registry: CommandRegistry,
  options: { className?: string; baseUrlVariable?: string } = {},
): string {
  const className = options.className ?? "FlywheelClient";
  const baseUrlVar = options.baseUrlVariable ?? "baseUrl";

  const methods = generateClientMethods(registry);

  const lines: string[] = [
    "// Generated TypeScript client SDK",
    "// Do not edit manually - regenerate from command registry",
    "",
    generateClientTypes(registry),
    "export interface ClientConfig {",
    "  baseUrl: string;",
    "  token?: string;",
    "  fetch?: typeof fetch;",
    "}",
    "",
    "export interface RequestOptions {",
    "  signal?: AbortSignal;",
    "  headers?: Record<string, string>;",
    "}",
    "",
  ];

  // Generate the client class
  lines.push(`export class ${className} {`);
  lines.push(`  private readonly ${baseUrlVar}: string;`);
  lines.push("  private readonly token?: string;");
  lines.push("  private readonly fetchFn: typeof fetch;");
  lines.push("");
  lines.push("  constructor(config: ClientConfig) {");
  lines.push(`    this.${baseUrlVar} = config.baseUrl.replace(/\\/$/, '');`);
  lines.push("    this.token = config.token;");
  lines.push("    this.fetchFn = config.fetch ?? globalThis.fetch;");
  lines.push("  }");
  lines.push("");

  // Private request method
  lines.push("  private async request<T>(");
  lines.push("    method: string,");
  lines.push("    path: string,");
  lines.push("    body?: unknown,");
  lines.push("    options?: RequestOptions,");
  lines.push("  ): Promise<T> {");
  lines.push("    const headers: Record<string, string> = {");
  lines.push("      'Content-Type': 'application/json',");
  lines.push("      ...options?.headers,");
  lines.push("    };");
  lines.push("");
  lines.push("    if (this.token) {");
  lines.push("      headers['Authorization'] = 'Bearer ' + this.token;");
  lines.push("    }");
  lines.push("");
  lines.push(
    `    const response = await this.fetchFn(this.${baseUrlVar} + path, {`,
  );
  lines.push("      method,");
  lines.push("      headers,");
  lines.push("      body: body ? JSON.stringify(body) : undefined,");
  lines.push("      signal: options?.signal,");
  lines.push("    });");
  lines.push("");
  lines.push("    if (!response.ok) {");
  lines.push(
    "      const error = await response.json().catch(() => ({ message: 'Unknown error' }));",
  );
  lines.push(
    "      throw new Error(error.message ?? 'Request failed: ' + response.status);",
  );
  lines.push("    }");
  lines.push("");
  lines.push("    if (response.status === 204) {");
  lines.push("      return undefined as T;");
  lines.push("    }");
  lines.push("");
  lines.push(
    "    const contentType = response.headers.get('content-type') ?? '';",
  );
  lines.push("    if (!contentType.includes('application/json')) {");
  lines.push("      return (await response.text()) as unknown as T;");
  lines.push("    }");
  lines.push("");
  lines.push("    return response.json();");
  lines.push("  }");
  lines.push("");

  // Generate methods for each command
  for (const method of methods) {
    lines.push(generateMethodCode(method, baseUrlVar));
    lines.push("");
  }

  lines.push("}");

  return lines.join("\n");
}

/**
 * Generate method code for a single command.
 */
function generateMethodCode(
  method: GeneratedClientMethod,
  baseUrlVar: string,
): string {
  const {
    methodName,
    httpMethod,
    path,
    pathParams,
    streaming,
    inputTypeName,
    outputTypeName,
  } = method;

  // Build parameter list
  const params: string[] = [];
  for (const param of pathParams) {
    params.push(`${param}: string`);
  }

  const needsBody =
    httpMethod === "POST" || httpMethod === "PUT" || httpMethod === "PATCH";
  if (needsBody) {
    params.push(`body: ${inputTypeName}`);
  } else {
    // GET/DELETE without body can have query params
    params.push(`params?: Partial<${inputTypeName}>`);
  }

  params.push("options?: RequestOptions");

  // Build path with parameter substitution
  let pathExpr = `'${path}'`;
  for (const param of pathParams) {
    pathExpr = pathExpr.replace(
      `:${param}`,
      `' + encodeURIComponent(${param}) + '`,
    );
  }
  // Clean up empty string concatenations
  pathExpr = pathExpr.replace(/ \+ ''$/g, "").replace(/^'' \+ /g, "");

  const queryExpr =
    "params ? new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value)] as [string, string])).toString() : ''";

  const lines: string[] = [];
  lines.push(`  /** ${method.commandName} */`);

  if (streaming) {
    lines.push(
      `  async *${methodName}(${params.join(", ")}): AsyncGenerator<${outputTypeName}> {`,
    );
    if (!needsBody) {
      lines.push(`    const query = ${queryExpr};`);
      lines.push(`    const url = ${pathExpr} + (query ? '?' + query : '');`);
    }
    const streamingUrlExpr = needsBody ? pathExpr : "url";
    lines.push(
      `    const response = await this.fetchFn(this.${baseUrlVar} + ${streamingUrlExpr}, {`,
    );
    lines.push(`      method: '${httpMethod}',`);
    lines.push("      headers: {");
    if (needsBody) {
      lines.push("        'Content-Type': 'application/json',");
    }
    lines.push("        'Accept': 'text/event-stream',");
    lines.push(
      "        ...(this.token ? { 'Authorization': 'Bearer ' + this.token } : {}),",
    );
    lines.push("        ...options?.headers,");
    lines.push("      },");
    if (needsBody) {
      lines.push("      body: JSON.stringify(body),");
    }
    lines.push("      signal: options?.signal,");
    lines.push("    });");
    lines.push("");
    lines.push("    if (!response.ok) {");
    lines.push(
      "      const error = await response.json().catch(() => ({ message: 'Unknown error' }));",
    );
    lines.push(
      "      throw new Error(error.message ?? 'Request failed: ' + response.status);",
    );
    lines.push("    }");
    lines.push("");
    lines.push("    if (!response.body) throw new Error('No response body');");
    lines.push("    const reader = response.body.getReader();");
    lines.push("    const decoder = new TextDecoder();");
    lines.push("    let buffer = '';");
    lines.push("");
    lines.push("    while (true) {");
    lines.push("      const { done, value } = await reader.read();");
    lines.push("      if (done) {");
    lines.push("        buffer += decoder.decode();");
    lines.push("        break;");
    lines.push("      }");
    lines.push("      buffer += decoder.decode(value, { stream: true });");
    lines.push("      const lines = buffer.split('\\n');");
    lines.push("      buffer = lines.pop() ?? '';");
    lines.push("      for (const line of lines) {");
    lines.push("        if (line.startsWith('data: ')) {");
    lines.push("          yield JSON.parse(line.slice(6));");
    lines.push("        }");
    lines.push("      }");
    lines.push("    }");
    lines.push("    if (buffer.startsWith('data: ')) {");
    lines.push("      yield JSON.parse(buffer.slice(6));");
    lines.push("    }");
    lines.push("  }");
  } else {
    lines.push(
      `  async ${methodName}(${params.join(", ")}): Promise<${outputTypeName}> {`,
    );
    if (needsBody) {
      lines.push(
        `    return this.request('${httpMethod}', ${pathExpr}, body, options);`,
      );
    } else {
      lines.push(`    const query = ${queryExpr};`);
      lines.push(`    const url = ${pathExpr} + (query ? '?' + query : '');`);
      lines.push(
        `    return this.request('${httpMethod}', url, undefined, options);`,
      );
    }
    lines.push("  }");
  }

  return lines.join("\n");
}

/**
 * Generate type definitions for the client.
 */
export function generateClientTypes(registry: CommandRegistry): string {
  const lines: string[] = ["// Generated client type definitions", ""];

  // Group commands by category
  const byCategory = new Map<string, RegisteredCommand[]>();
  for (const cmd of registry.all()) {
    const list = byCategory.get(cmd.category) ?? [];
    list.push(cmd);
    byCategory.set(cmd.category, list);
  }

  // Generate namespace for each category
  for (const [category, cmds] of byCategory) {
    const capitalizedCategory =
      category.charAt(0).toUpperCase() + category.slice(1);
    lines.push(`export namespace ${capitalizedCategory} {`);

    for (const cmd of cmds) {
      const actionName = cmd.name.split(".")[1] ?? cmd.name;
      const capitalizedAction =
        actionName.charAt(0).toUpperCase() + actionName.slice(1);

      const inputType = zodSchemaToTypeString(cmd.inputSchema, "  ");
      const outputType = zodSchemaToTypeString(cmd.outputSchema, "  ");

      lines.push(`  /** Input for ${cmd.name} */`);
      lines.push(`  export type ${capitalizedAction}Input = ${inputType};`);
      lines.push("");
      lines.push(`  /** Output for ${cmd.name} */`);
      lines.push(`  export type ${capitalizedAction}Output = ${outputType};`);
      lines.push("");
    }

    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}
