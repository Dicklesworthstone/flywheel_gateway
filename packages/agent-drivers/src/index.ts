/**
 * @flywheel/agent-drivers - Agent Driver Abstraction Layer
 *
 * This package provides a unified interface for multiple agent execution backends:
 * - SDK Driver: Direct API calls to Claude/Codex/Gemini SDKs (primary)
 * - ACP Driver: Agent Client Protocol for IDE-compatible structured events
 * - Tmux Driver: Visual terminal access for power users
 * - Mock Driver: Testing and development
 *
 * Usage:
 * ```typescript
 * import { selectDriver, DriverRequirements } from "@flywheel/agent-drivers";
 *
 * // Auto-select best available driver
 * const { driver, type, reason } = await selectDriver({
 *   preferredType: "sdk",
 *   requiredCapabilities: ["streaming", "interrupt"],
 * });
 *
 * // Spawn an agent
 * const { agent } = await driver.spawn({
 *   id: "agent-123",
 *   provider: "claude",
 *   model: "claude-opus-4",
 *   workingDirectory: "/path/to/workspace",
 * });
 *
 * // Subscribe to events
 * for await (const event of driver.subscribe(agent.id)) {
 *   console.log(event.type, event);
 * }
 * ```
 */

// Core types
export * from "./types";

// Interface and driver contract
export * from "./interface";

// Driver registry and selection
export * from "./registry";

// Base driver class (for implementing custom drivers)
export { BaseDriver, createDriverOptions, type BaseDriverConfig } from "./base-driver";

// SDK drivers
export * from "./sdk";

// ACP driver (placeholder for future implementation)
// export * from "./acp";

// Tmux driver (placeholder for future implementation)
// export * from "./tmux";
