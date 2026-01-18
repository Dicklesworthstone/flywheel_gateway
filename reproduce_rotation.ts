import { describe, expect, mock, spyOn, test } from "bun:test";
import {
  createCheckpoint,
  restoreCheckpoint,
} from "./apps/gateway/src/services/checkpoint";
import { executeRotation } from "./apps/gateway/src/services/context-rotation";
import type {
  Agent,
  AgentConfig,
  TokenUsage,
} from "./packages/agent-drivers/src/types";

// Mock dependencies
// Mock createCheckpoint
const mockCreateCheckpoint = mock(async () => ({
  id: "chk_test",
}));

// Mock restoreCheckpoint - returns the checkpoint data
const mockRestoreCheckpoint = mock(async (checkpointId: string) => ({
  id: checkpointId,
  agentId: "agent-1",
  createdAt: new Date(),
  tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  conversationHistory: [{ role: "user", content: "test" }],
  toolState: {},
}));

// Mock handlers
const mockHandlers = {
  getConversationHistory: mock(async () => []),
  getToolState: mock(async () => ({})),
  spawnAgent: mock(async () => ({ agentId: "agent-new" })),
  terminateAgent: mock(async () => {}),
  sendMessage: mock(async () => {}),
};

// Mock agent
const mockAgent: Agent = {
  id: "agent-1",
  config: {
    id: "agent-1",
    provider: "claude",
    model: "claude-3-sonnet",
    workingDirectory: "/tmp",
  },
  activityState: "idle",
  tokenUsage: {
    promptTokens: 100000,
    completionTokens: 0,
    totalTokens: 100000,
  },
  contextHealth: "emergency",
  startedAt: new Date(),
  lastActivityAt: new Date(),
  driverId: "mock-driver",
  driverType: "mock",
};

// Spy on checkpoint service exports - trick to mock them inside the module
// Since we are running in the same process, we can't easily mock imports of the module under test
// without a proper mocking framework or import interception.
// Bun test mocking works well for function calls.

// However, context-rotation.ts imports createCheckpoint and restoreCheckpoint directly.
// We need to intercept those calls.
// A common way in Bun is to use `mock.module` but that replaces the whole module.

mock.module("./apps/gateway/src/services/checkpoint", () => ({
  createCheckpoint: mockCreateCheckpoint,
  restoreCheckpoint: mockRestoreCheckpoint,
}));

describe("Context Rotation", () => {
  test("rotateCheckpointAndRestart calls spawnAgent but does NOT pass initial state", async () => {
    // Clear mocks
    mockCreateCheckpoint.mockClear();
    mockRestoreCheckpoint.mockClear();
    mockHandlers.spawnAgent.mockClear();

    // Execute rotation
    const result = await executeRotation(
      mockAgent,
      "checkpoint_and_restart",
      mockHandlers,
    );

    expect(result.success).toBe(true);
    expect(mockCreateCheckpoint).toHaveBeenCalled();
    expect(mockHandlers.spawnAgent).toHaveBeenCalled();
    expect(mockRestoreCheckpoint).toHaveBeenCalled();
    expect(mockHandlers.terminateAgent).toHaveBeenCalled();

    // Check spawnAgent arguments
    // The issue is that spawnAgent is called with config only, not state
    const spawnCall = mockHandlers.spawnAgent.mock.calls[0];
    const spawnConfig = spawnCall[0] as any;

    // It should NOT have conversationHistory or toolState yet because the code is buggy
    expect(spawnConfig.conversationHistory).toBeUndefined();
    expect(spawnConfig.toolState).toBeUndefined();

    // We expect to fix this so that spawnAgent CAN receive state, OR the rotation logic
    // applies the state to the new agent using some other method (e.g. setState).
    // Currently `restoreCheckpoint` returns data but it's dropped on the floor.
  });
});
