import {
  createClaudeCodeWsDriver,
  createClaudeDriver,
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

  const claudeCodeWsDriverEntry: DriverRegistryEntry = {
    type: "claude_code_ws",
    factory: createClaudeCodeWsDriver,
    description: "Claude Code WebSocket Driver (--sdk-url)",
    defaultCapabilities: {
      streaming: true,
      interrupt: true,
      checkpoint: false,
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

  if (!registry.has("claude_code_ws")) {
    registry.register(claudeCodeWsDriverEntry);
  }
}
