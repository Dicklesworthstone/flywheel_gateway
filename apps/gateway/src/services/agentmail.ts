import {
  createAgentMailClient,
  mapAgentMailError,
  type AgentMailClient,
  type AgentMailToolCaller,
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

export function createAgentMailService(
  config: AgentMailServiceConfig,
): AgentMailService {
  return {
    client: createAgentMailClient(config),
    mapError: mapAgentMailError,
  };
}
