import {
  createAcpDriver,
  createClaudeDriver,
  createNtmDriver,
  createTmuxDriver,
  type DriverRegistryEntry,
  getDriverRegistry,
} from "@flywheel/agent-drivers";

export function registerDrivers() {
  const registry = getDriverRegistry();

  const sdkDriverEntry: DriverRegistryEntry = {
    type: "sdk",
    factory: createClaudeDriver,
    description: "Claude SDK Driver",
    defaultCapabilities: {
      streaming: true,
      interrupt: true,
      checkpoint: true,
      fileOperations: true,
      terminalAttach: false,
      structuredEvents: true,
      toolCalls: true,
      diffRendering: false,
    },
  };

  const acpDriverEntry: DriverRegistryEntry = {
    type: "acp",
    factory: createAcpDriver,
    description: "ACP (Agent Client Protocol) Driver",
    defaultCapabilities: {
      streaming: true,
      interrupt: true,
      checkpoint: true,
      fileOperations: true,
      terminalAttach: false,
      structuredEvents: true,
      toolCalls: true,
      diffRendering: true,
    },
  };

  const tmuxDriverEntry: DriverRegistryEntry = {
    type: "tmux",
    factory: createTmuxDriver,
    description: "Tmux Visual Terminal Driver",
    defaultCapabilities: {
      streaming: true,
      interrupt: true,
      checkpoint: false,
      fileOperations: false,
      terminalAttach: true,
      structuredEvents: false,
      toolCalls: false,
      diffRendering: false,
    },
  };

  const ntmDriverEntry: DriverRegistryEntry = {
    type: "ntm",
    factory: createNtmDriver,
    description: "NTM (Named Tmux Manager) Multi-Agent Driver",
    defaultCapabilities: {
      streaming: true,
      interrupt: true,
      checkpoint: false,
      fileOperations: false,
      terminalAttach: true,
      structuredEvents: true,
      toolCalls: true,
      diffRendering: false,
    },
  };

  for (const entry of [
    sdkDriverEntry,
    acpDriverEntry,
    tmuxDriverEntry,
    ntmDriverEntry,
  ]) {
    if (!registry.has(entry.type)) {
      registry.register(entry);
    }
  }
}
