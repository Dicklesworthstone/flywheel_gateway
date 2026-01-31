import {
  type AgentMailClient,
  AgentMailClientError,
  type AgentMailToolCaller,
  createAgentMailClient,
  mapAgentMailError,
} from "@flywheel/flywheel-clients";

export interface AgentMailServiceConfig {
  callTool: AgentMailToolCaller;
  toolPrefix?: string;
  defaultTtlSeconds?: number;
}

export interface AgentMailService {
  client: AgentMailClient;
  mapError: typeof mapAgentMailError;
}

function getAgentMailToolCaller(): AgentMailToolCaller | undefined {
  const globalAny = globalThis as {
    agentMailCallTool?: AgentMailToolCaller;
  };
  return globalAny.agentMailCallTool;
}

function createFallbackCaller(): AgentMailToolCaller {
  return async (toolName: string) => {
    throw new AgentMailClientError(
      "transport",
      "Agent Mail MCP tool caller not configured",
      { tool: toolName },
    );
  };
}

export function createAgentMailService(
  config: AgentMailServiceConfig,
): AgentMailService {
  return {
    client: createAgentMailClient(config),
    mapError: mapAgentMailError,
  };
}

export function createAgentMailServiceFromEnv(): AgentMailService {
  const callTool = getAgentMailToolCaller() ?? createFallbackCaller();
  const toolPrefix = process.env["AGENT_MAIL_TOOL_PREFIX"];
  const defaultTtlRaw = process.env["AGENT_MAIL_DEFAULT_TTL_SECONDS"];
  const parsedDefaultTtlSeconds = defaultTtlRaw
    ? Number.parseInt(defaultTtlRaw, 10)
    : undefined;
  const defaultTtlSeconds =
    parsedDefaultTtlSeconds !== undefined &&
    Number.isFinite(parsedDefaultTtlSeconds) &&
    parsedDefaultTtlSeconds > 0
      ? parsedDefaultTtlSeconds
      : undefined;

  // Build config conditionally (for exactOptionalPropertyTypes)
  const config: AgentMailServiceConfig = { callTool };
  if (toolPrefix !== undefined) config.toolPrefix = toolPrefix;
  if (defaultTtlSeconds !== undefined)
    config.defaultTtlSeconds = defaultTtlSeconds;

  return createAgentMailService(config);
}
