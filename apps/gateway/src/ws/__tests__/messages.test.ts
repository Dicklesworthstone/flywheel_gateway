/**
 * Tests for WebSocket message types and error hints.
 */

import { describe, expect, test } from "bun:test";
import {
  createThrottleMessage,
  createWSError,
  parseClientMessage,
  serializeServerMessage,
  type ErrorMessage,
  type ThrottledMessage,
} from "../messages";

describe("WebSocket messages", () => {
  describe("parseClientMessage", () => {
    test("parses subscribe message", () => {
      const msg = parseClientMessage(
        JSON.stringify({ type: "subscribe", channel: "agent:output:agent-123" }),
      );
      expect(msg).toEqual({
        type: "subscribe",
        channel: "agent:output:agent-123",
        cursor: undefined,
      });
    });

    test("parses subscribe message with cursor", () => {
      const msg = parseClientMessage(
        JSON.stringify({
          type: "subscribe",
          channel: "agent:output:agent-123",
          cursor: "cursor-abc",
        }),
      );
      expect(msg).toEqual({
        type: "subscribe",
        channel: "agent:output:agent-123",
        cursor: "cursor-abc",
      });
    });

    test("parses unsubscribe message", () => {
      const msg = parseClientMessage(
        JSON.stringify({ type: "unsubscribe", channel: "agent:output:agent-123" }),
      );
      expect(msg).toEqual({
        type: "unsubscribe",
        channel: "agent:output:agent-123",
      });
    });

    test("parses ping message", () => {
      const msg = parseClientMessage(
        JSON.stringify({ type: "ping", timestamp: 12345 }),
      );
      expect(msg).toEqual({
        type: "ping",
        timestamp: 12345,
      });
    });

    test("returns undefined for invalid JSON", () => {
      expect(parseClientMessage("not json")).toBeUndefined();
    });

    test("returns undefined for missing type", () => {
      expect(parseClientMessage(JSON.stringify({ channel: "test" }))).toBeUndefined();
    });

    test("returns undefined for unknown type", () => {
      expect(
        parseClientMessage(JSON.stringify({ type: "unknown", channel: "test" })),
      ).toBeUndefined();
    });
  });

  describe("createWSError", () => {
    test("creates basic error message", () => {
      const error = createWSError("SOME_CODE", "Some message");
      expect(error.type).toBe("error");
      expect(error.code).toBe("SOME_CODE");
      expect(error.message).toBe("Some message");
    });

    test("includes channel when provided", () => {
      const error = createWSError("SOME_CODE", "Some message", "agent:output:123");
      expect(error.channel).toBe("agent:output:123");
    });

    test("includes details when provided", () => {
      const error = createWSError("SOME_CODE", "Some message", undefined, {
        extra: "info",
      });
      expect(error.details).toEqual({ extra: "info" });
    });

    test("includes hint for INVALID_FORMAT", () => {
      const error = createWSError("INVALID_FORMAT", "Invalid message format");
      expect(error.severity).toBe("recoverable");
      expect(error.hint).toContain("valid JSON");
      expect(error.example).toBeDefined();
      expect(error.docs).toContain("flywheel.dev");
    });

    test("includes hint for INVALID_CHANNEL", () => {
      const error = createWSError("INVALID_CHANNEL", "Invalid channel format");
      expect(error.severity).toBe("recoverable");
      expect(error.hint).toContain("scope:type:id");
      expect(error.example).toBe("agent:output:agent-abc123");
      expect(error.docs).toContain("channels");
    });

    test("includes hint for WS_SUBSCRIPTION_DENIED", () => {
      const error = createWSError("WS_SUBSCRIPTION_DENIED", "Access denied");
      expect(error.severity).toBe("terminal");
      expect(error.hint).toContain("auth token");
      expect(error.docs).toContain("authentication");
    });

    test("includes hint for WS_CURSOR_EXPIRED", () => {
      const error = createWSError("WS_CURSOR_EXPIRED", "Cursor expired");
      expect(error.severity).toBe("recoverable");
      expect(error.hint).toContain("expired");
      expect(error.example).toBeDefined();
      expect(error.docs).toContain("cursors");
    });

    test("includes hint for WS_RATE_LIMITED", () => {
      const error = createWSError("WS_RATE_LIMITED", "Too many requests");
      expect(error.severity).toBe("retry");
      expect(error.hint).toContain("too fast");
      expect(error.docs).toContain("rate-limits");
    });

    test("includes hint for WS_AUTHENTICATION_REQUIRED", () => {
      const error = createWSError("WS_AUTHENTICATION_REQUIRED", "Auth required");
      expect(error.severity).toBe("recoverable");
      expect(error.hint).toContain("authentication");
      expect(error.docs).toContain("authentication");
    });

    test("includes hint for INTERNAL_ERROR", () => {
      const error = createWSError("INTERNAL_ERROR", "Internal error");
      expect(error.severity).toBe("retry");
      expect(error.hint).toContain("internal error");
      expect(error.alternative).toContain("contact support");
    });

    test("works without hints for unknown codes", () => {
      const error = createWSError("UNKNOWN_CODE", "Unknown error");
      expect(error.type).toBe("error");
      expect(error.code).toBe("UNKNOWN_CODE");
      expect(error.message).toBe("Unknown error");
      expect(error.severity).toBeUndefined();
      expect(error.hint).toBeUndefined();
    });
  });

  describe("createThrottleMessage", () => {
    test("creates basic throttle message", () => {
      const msg = createThrottleMessage(1000);
      expect(msg.type).toBe("throttled");
      expect(msg.message).toBe("Slow down message rate");
      expect(msg.resumeAfterMs).toBe(1000);
    });

    test("includes count and limit when provided", () => {
      const msg = createThrottleMessage(2000, {
        currentCount: 105,
        limit: 100,
      });
      expect(msg.type).toBe("throttled");
      expect(msg.resumeAfterMs).toBe(2000);
      expect(msg.currentCount).toBe(105);
      expect(msg.limit).toBe(100);
    });

    test("includes resetsAt when provided", () => {
      const resetTime = new Date("2026-01-12T10:00:00Z");
      const msg = createThrottleMessage(5000, {
        resetsAt: resetTime,
      });
      expect(msg.resetsAt).toBe("2026-01-12T10:00:00.000Z");
    });

    test("includes all optional fields", () => {
      const resetTime = new Date("2026-01-12T12:00:00Z");
      const msg = createThrottleMessage(3000, {
        currentCount: 150,
        limit: 100,
        resetsAt: resetTime,
      });
      expect(msg.type).toBe("throttled");
      expect(msg.message).toBe("Slow down message rate");
      expect(msg.resumeAfterMs).toBe(3000);
      expect(msg.currentCount).toBe(150);
      expect(msg.limit).toBe(100);
      expect(msg.resetsAt).toBe("2026-01-12T12:00:00.000Z");
    });
  });

  describe("serializeServerMessage", () => {
    test("serializes error message with all fields", () => {
      const error = createWSError("INVALID_FORMAT", "Invalid message format");
      const serialized = serializeServerMessage(error);
      const parsed = JSON.parse(serialized) as ErrorMessage;

      expect(parsed.type).toBe("error");
      expect(parsed.code).toBe("INVALID_FORMAT");
      expect(parsed.hint).toBeDefined();
      expect(parsed.example).toBeDefined();
      expect(parsed.docs).toBeDefined();
    });

    test("serializes connected message", () => {
      const msg = {
        type: "connected" as const,
        connectionId: "conn-123",
        serverTime: "2026-01-12T00:00:00Z",
        serverVersion: "1.0.0",
        capabilities: {
          backfill: true,
          compression: false,
          acknowledgment: true,
        },
        heartbeatIntervalMs: 30000,
        docs: "https://docs.flywheel.dev/websocket",
      };

      const serialized = serializeServerMessage(msg);
      const parsed = JSON.parse(serialized);

      expect(parsed.type).toBe("connected");
      expect(parsed.connectionId).toBe("conn-123");
      expect(parsed.serverVersion).toBe("1.0.0");
      expect(parsed.capabilities.backfill).toBe(true);
      expect(parsed.heartbeatIntervalMs).toBe(30000);
      expect(parsed.docs).toContain("flywheel.dev");
    });

    test("serializes throttle message", () => {
      const msg = createThrottleMessage(1500, {
        currentCount: 120,
        limit: 100,
      });

      const serialized = serializeServerMessage(msg);
      const parsed = JSON.parse(serialized) as ThrottledMessage;

      expect(parsed.type).toBe("throttled");
      expect(parsed.message).toBe("Slow down message rate");
      expect(parsed.resumeAfterMs).toBe(1500);
      expect(parsed.currentCount).toBe(120);
      expect(parsed.limit).toBe(100);
    });
  });
});
