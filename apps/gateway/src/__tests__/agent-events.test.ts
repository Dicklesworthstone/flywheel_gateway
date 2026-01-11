/**
 * Tests for agent-events service.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { WebSocketHub } from "../ws/hub";

// Track state change subscribers
let stateChangeCallback: ((event: unknown) => void) | null = null;

// Mock the state machine
mock.module("../services/agent-state-machine", () => ({
  onStateChange: (callback: (event: unknown) => void) => {
    stateChangeCallback = callback;
    return () => {
      stateChangeCallback = null;
    };
  },
}));

// Mock the logger
mock.module("../services/logger", () => ({
  logger: {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  },
}));

// Import after mocking
import { AgentEventsService } from "../services/agent-events";

describe("Agent Events Service", () => {
  let mockHub: WebSocketHub;
  let publishCalls: Array<{
    channel: unknown;
    type: string;
    payload: unknown;
    metadata: unknown;
  }>;

  beforeEach(() => {
    publishCalls = [];
    mockHub = {
      publish: (channel: unknown, type: string, payload: unknown, metadata: unknown) => {
        publishCalls.push({ channel, type, payload, metadata });
      },
    } as unknown as WebSocketHub;

    // Reset singleton
    // @ts-expect-error accessing private for testing
    (globalThis as Record<string, unknown>).__agentEventsService = undefined;
  });

  afterEach(() => {
    stateChangeCallback = null;
  });

  describe("AgentEventsService", () => {
    test("can be instantiated with hub", () => {
      const service = new AgentEventsService(mockHub);
      expect(service).toBeDefined();
    });

    test("start subscribes to state changes", () => {
      const service = new AgentEventsService(mockHub);
      expect(stateChangeCallback).toBeNull();

      service.start();
      expect(stateChangeCallback).not.toBeNull();
    });

    test("start is idempotent", () => {
      const service = new AgentEventsService(mockHub);
      service.start();
      const callback1 = stateChangeCallback;

      service.start();
      expect(stateChangeCallback).toBe(callback1);
    });

    test("stop unsubscribes from state changes", () => {
      const service = new AgentEventsService(mockHub);
      service.start();
      expect(stateChangeCallback).not.toBeNull();

      service.stop();
      expect(stateChangeCallback).toBeNull();
    });

    test("stop is idempotent", () => {
      const service = new AgentEventsService(mockHub);
      service.start();
      service.stop();
      service.stop(); // Should not throw
      expect(stateChangeCallback).toBeNull();
    });
  });

  describe("publishOutput", () => {
    test("publishes output to correct channel", () => {
      const service = new AgentEventsService(mockHub);
      const payload = {
        agentId: "agent-123",
        type: "text" as const,
        content: "Hello world",
        timestamp: new Date().toISOString(),
      };

      service.publishOutput("agent-123", payload);

      expect(publishCalls).toHaveLength(1);
      expect(publishCalls[0].channel).toEqual({
        type: "agent:output",
        agentId: "agent-123",
      });
      expect(publishCalls[0].type).toBe("output.chunk");
      expect(publishCalls[0].payload).toEqual(payload);
    });

    test("includes metadata in publish", () => {
      const service = new AgentEventsService(mockHub);
      const payload = {
        agentId: "agent-123",
        type: "text" as const,
        content: "Test",
        timestamp: new Date().toISOString(),
      };

      service.publishOutput("agent-123", payload, {
        correlationId: "corr-123",
      });

      expect(publishCalls[0].metadata).toMatchObject({
        correlationId: "corr-123",
        agentId: "agent-123",
      });
    });
  });

  describe("publishToolEvent", () => {
    test("publishes tool_call as tool.start", () => {
      const service = new AgentEventsService(mockHub);
      const payload = {
        agentId: "agent-123",
        type: "tool_call" as const,
        toolName: "read_file",
        toolId: "tool-456",
        input: { path: "/test" },
        timestamp: new Date().toISOString(),
      };

      service.publishToolEvent("agent-123", payload);

      expect(publishCalls[0].channel).toEqual({
        type: "agent:tools",
        agentId: "agent-123",
      });
      expect(publishCalls[0].type).toBe("tool.start");
    });

    test("publishes tool_result as tool.end", () => {
      const service = new AgentEventsService(mockHub);
      const payload = {
        agentId: "agent-123",
        type: "tool_result" as const,
        toolName: "read_file",
        toolId: "tool-456",
        output: "file contents",
        duration: 100,
        timestamp: new Date().toISOString(),
      };

      service.publishToolEvent("agent-123", payload);

      expect(publishCalls[0].type).toBe("tool.end");
    });
  });

  describe("publishTextOutput", () => {
    test("creates and publishes text output payload", () => {
      const service = new AgentEventsService(mockHub);

      service.publishTextOutput("agent-123", "Hello world", "corr-123");

      expect(publishCalls).toHaveLength(1);
      const payload = publishCalls[0].payload as Record<string, unknown>;
      expect(payload.agentId).toBe("agent-123");
      expect(payload.type).toBe("text");
      expect(payload.content).toBe("Hello world");
      expect(payload.correlationId).toBe("corr-123");
      expect(payload.timestamp).toBeDefined();
    });
  });

  describe("publishToolCall", () => {
    test("creates and publishes tool call payload", () => {
      const service = new AgentEventsService(mockHub);
      const input = { path: "/test/file.ts" };

      service.publishToolCall(
        "agent-123",
        "read_file",
        "tool-456",
        input,
        "corr-123",
      );

      expect(publishCalls).toHaveLength(1);
      expect(publishCalls[0].type).toBe("tool.start");
      const payload = publishCalls[0].payload as Record<string, unknown>;
      expect(payload.agentId).toBe("agent-123");
      expect(payload.type).toBe("tool_call");
      expect(payload.toolName).toBe("read_file");
      expect(payload.toolId).toBe("tool-456");
      expect(payload.input).toEqual(input);
    });
  });

  describe("publishToolResult", () => {
    test("creates and publishes tool result payload", () => {
      const service = new AgentEventsService(mockHub);
      const output = { content: "file contents" };

      service.publishToolResult(
        "agent-123",
        "read_file",
        "tool-456",
        output,
        150,
        undefined,
        "corr-123",
      );

      expect(publishCalls).toHaveLength(1);
      expect(publishCalls[0].type).toBe("tool.end");
      const payload = publishCalls[0].payload as Record<string, unknown>;
      expect(payload.agentId).toBe("agent-123");
      expect(payload.type).toBe("tool_result");
      expect(payload.toolName).toBe("read_file");
      expect(payload.toolId).toBe("tool-456");
      expect(payload.output).toEqual(output);
      expect(payload.duration).toBe(150);
    });

    test("includes error when provided", () => {
      const service = new AgentEventsService(mockHub);

      service.publishToolResult(
        "agent-123",
        "read_file",
        "tool-456",
        null,
        50,
        "File not found",
        "corr-123",
      );

      const payload = publishCalls[0].payload as Record<string, unknown>;
      expect(payload.error).toBe("File not found");
    });
  });

  describe("state change publishing", () => {
    test("publishes state change events to WebSocket", () => {
      const service = new AgentEventsService(mockHub);
      service.start();

      // Simulate state change
      stateChangeCallback?.({
        agentId: "agent-123",
        previousState: "idle",
        currentState: "running",
        reason: "user_message",
        timestamp: "2024-01-01T00:00:00Z",
        correlationId: "corr-123",
      });

      expect(publishCalls).toHaveLength(1);
      expect(publishCalls[0].channel).toEqual({
        type: "agent:state",
        agentId: "agent-123",
      });
      expect(publishCalls[0].type).toBe("state.change");
      const payload = publishCalls[0].payload as Record<string, unknown>;
      expect(payload.previousState).toBe("idle");
      expect(payload.currentState).toBe("running");
    });

    test("includes error in state change payload when present", () => {
      const service = new AgentEventsService(mockHub);
      service.start();

      stateChangeCallback?.({
        agentId: "agent-123",
        previousState: "running",
        currentState: "error",
        reason: "tool_error",
        timestamp: "2024-01-01T00:00:00Z",
        correlationId: "corr-123",
        error: {
          code: "TOOL_FAILED",
          message: "Tool execution failed",
        },
      });

      const payload = publishCalls[0].payload as Record<string, unknown>;
      expect(payload.error).toEqual({
        code: "TOOL_FAILED",
        message: "Tool execution failed",
      });
    });
  });
});
