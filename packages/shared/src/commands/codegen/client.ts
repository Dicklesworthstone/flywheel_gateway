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
}

/**
 * Generate TypeScript client methods from the command registry.
 */
export function generateClientMethods(registry: CommandRegistry): GeneratedClientMethod[] {
  return registry.all().map((cmd) => ({
    commandName: cmd.name,
    methodName: cmd.name.replace(/\./g, "_"),
    httpMethod: cmd.rest.method,
    path: cmd.rest.path,
    pathParams: cmd.pathParams,
    streaming: cmd.rest.streaming ?? false,
  }));
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
  lines.push("export class " + className + " {");
  lines.push("  private readonly " + baseUrlVar + ": string;");
  lines.push("  private readonly token?: string;");
  lines.push("  private readonly fetchFn: typeof fetch;");
  lines.push("");
  lines.push("  constructor(config: ClientConfig) {");
  lines.push("    this." + baseUrlVar + " = config.baseUrl.replace(/\\/$/, '');");
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
  lines.push("    const response = await this.fetchFn(this." + baseUrlVar + " + path, {");
  lines.push("      method,");
  lines.push("      headers,");
  lines.push("      body: body ? JSON.stringify(body) : undefined,");
  lines.push("      signal: options?.signal,");
  lines.push("    });");
  lines.push("");
  lines.push("    if (!response.ok) {");
  lines.push("      const error = await response.json().catch(() => ({ message: 'Unknown error' }));");
  lines.push("      throw new Error(error.message ?? 'Request failed: ' + response.status);");
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
function generateMethodCode(method: GeneratedClientMethod, baseUrlVar: string): string {
  const { methodName, httpMethod, path, pathParams, streaming } = method;

  // Build parameter list
  const params: string[] = [];
  for (const param of pathParams) {
    params.push(param + ": string");
  }

  const needsBody = httpMethod === "POST" || httpMethod === "PUT" || httpMethod === "PATCH";
  if (needsBody) {
    params.push("body: Record<string, unknown>");
  } else if (pathParams.length === 0) {
    params.push("params?: Record<string, unknown>");
  }

  params.push("options?: RequestOptions");

  // Build path with parameter substitution
  let pathExpr = "'" + path + "'";
  for (const param of pathParams) {
    pathExpr = pathExpr.replace(":" + param, "' + " + param + " + '");
  }
  // Clean up empty string concatenations
  pathExpr = pathExpr.replace(/ \+ ''$/g, "").replace(/^'' \+ /g, "");

  // Build query string for GET without body
  let urlExpr = pathExpr;
  if (!needsBody && pathParams.length === 0) {
    urlExpr = pathExpr + " + (params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '')";
  }

  const lines: string[] = [];
  lines.push("  /** " + method.commandName + " */");

  if (streaming) {
    lines.push("  async *" + methodName + "(" + params.join(", ") + "): AsyncGenerator<unknown> {");
    lines.push("    const response = await this.fetchFn(this." + baseUrlVar + " + " + urlExpr + ", {");
    lines.push("      method: '" + httpMethod + "',");
    lines.push("      headers: {");
    if (needsBody) {
      lines.push("        'Content-Type': 'application/json',");
    }
    lines.push("        'Accept': 'text/event-stream',");
    lines.push("        ...(this.token ? { 'Authorization': 'Bearer ' + this.token } : {}),");
    lines.push("        ...options?.headers,");
    lines.push("      },");
    if (needsBody) {
      lines.push("      body: JSON.stringify(body),");
    }
    lines.push("      signal: options?.signal,");
    lines.push("    });");
    lines.push("");
    lines.push("    if (!response.body) throw new Error('No response body');");
    lines.push("    const reader = response.body.getReader();");
    lines.push("    const decoder = new TextDecoder();");
    lines.push("");
    lines.push("    while (true) {");
    lines.push("      const { done, value } = await reader.read();");
    lines.push("      if (done) break;");
    lines.push("      const text = decoder.decode(value);");
    lines.push("      for (const line of text.split('\\n')) {");
    lines.push("        if (line.startsWith('data: ')) {");
    lines.push("          yield JSON.parse(line.slice(6));");
    lines.push("        }");
    lines.push("      }");
    lines.push("    }");
    lines.push("  }");
  } else {
    lines.push("  async " + methodName + "(" + params.join(", ") + "): Promise<unknown> {");
    if (needsBody) {
      lines.push("    return this.request('" + httpMethod + "', " + urlExpr + ", body, options);");
    } else {
      lines.push("    return this.request('" + httpMethod + "', " + urlExpr + ", undefined, options);");
    }
    lines.push("  }");
  }

  return lines.join("\n");
}

/**
 * Generate type definitions for the client.
 */
export function generateClientTypes(registry: CommandRegistry): string {
  const lines: string[] = [
    "// Generated client type definitions",
    "",
  ];

  // Group commands by category
  const byCategory = new Map<string, RegisteredCommand[]>();
  for (const cmd of registry.all()) {
    const list = byCategory.get(cmd.category) ?? [];
    list.push(cmd);
    byCategory.set(cmd.category, list);
  }

  // Generate namespace for each category
  for (const [category, cmds] of byCategory) {
    const capitalizedCategory = category.charAt(0).toUpperCase() + category.slice(1);
    lines.push("export namespace " + capitalizedCategory + " {");

    for (const cmd of cmds) {
      const actionName = cmd.name.split(".")[1] ?? cmd.name;
      const capitalizedAction = actionName.charAt(0).toUpperCase() + actionName.slice(1);

      lines.push("  /** Input for " + cmd.name + " */");
      lines.push("  export type " + capitalizedAction + "Input = unknown; // Infer from Zod schema");
      lines.push("");
      lines.push("  /** Output for " + cmd.name + " */");
      lines.push("  export type " + capitalizedAction + "Output = unknown; // Infer from Zod schema");
      lines.push("");
    }

    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}
