import {
  createClaudeDriver,
  getDriverRegistry,
  type DriverRegistryEntry,
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

  if (!registry.has("sdk")) {
    registry.register(sdkDriverEntry);
  }
}
