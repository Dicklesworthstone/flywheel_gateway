export type AgentDriverType = 'sdk' | 'acp' | 'tmux' | 'mock';

export interface AgentDriver {
  readonly driverId: string;
  readonly driverType: AgentDriverType;
}
