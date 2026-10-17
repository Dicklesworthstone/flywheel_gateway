/**
 * Tests for channel types and parsing.
 */

import { describe, expect, test } from "bun:test";
import {
  type Channel,
  channelMatchesPattern,
  channelsEqual,
  channelToString,
  getChannelResourceId,
  getChannelScope,
  getChannelTypePrefix,
  parseChannel,
} from "../channels";

describe("channel utilities", () => {
  describe("channelToString", () => {
    test("serializes agent channels", () => {
      expect(
        channelToString({ type: "agent:output", agentId: "agent-123" }),
      ).toBe("agent:output:agent-123");
      expect(
        channelToString({ type: "agent:state", agentId: "agent-456" }),
      ).toBe("agent:state:agent-456");
      expect(
        channelToString({ type: "agent:tools", agentId: "agent-789" }),
      ).toBe("agent:tools:agent-789");
    });

    test("serializes workspace channels", () => {
      expect(
        channelToString({ type: "workspace:agents", workspaceId: "ws-123" }),
      ).toBe("workspace:agents:ws-123");
      expect(
        channelToString({
          type: "workspace:reservations",
          workspaceId: "ws-456",
        }),
      ).toBe("workspace:reservations:ws-456");
      expect(
        channelToString({ type: "workspace:conflicts", workspaceId: "ws-789" }),
      ).toBe("workspace:conflicts:ws-789");
    });

    test("serializes user channels", () => {
      expect(channelToString({ type: "user:mail", userId: "user-123" })).toBe(
        "user:mail:user-123",
      );
      expect(
        channelToString({ type: "user:notifications", userId: "user-456" }),
      ).toBe("user:notifications:user-456");
    });

    test("serializes system channels", () => {
      expect(channelToString({ type: "system:health" })).toBe("system:health");
      expect(channelToString({ type: "system:metrics" })).toBe(
        "system:metrics",
      );
      expect(channelToString({ type: "system:maintenance" })).toBe(
        "system:maintenance",
      );
      expect(channelToString({ type: "system:circuits" })).toBe(
        "system:circuits",
      );
    });

    test("handles IDs with colons", () => {
      expect(
        channelToString({ type: "agent:output", agentId: "agent:with:colons" }),
      ).toBe("agent:output:agent:with:colons");
    });
  });

  describe("parseChannel", () => {
    test("parses agent channels", () => {
      expect(parseChannel("agent:output:agent-123")).toEqual({
        type: "agent:output",
        agentId: "agent-123",
      });
      expect(parseChannel("agent:state:agent-456")).toEqual({
        type: "agent:state",
        agentId: "agent-456",
      });
      expect(parseChannel("agent:tools:agent-789")).toEqual({
        type: "agent:tools",
        agentId: "agent-789",
      });
    });

    test("parses workspace channels", () => {
      expect(parseChannel("workspace:agents:ws-123")).toEqual({
        type: "workspace:agents",
        workspaceId: "ws-123",
      });
      expect(parseChannel("workspace:reservations:ws-456")).toEqual({
        type: "workspace:reservations",
        workspaceId: "ws-456",
      });
      expect(parseChannel("workspace:conflicts:ws-789")).toEqual({
        type: "workspace:conflicts",
        workspaceId: "ws-789",
      });
    });

    test("parses user channels", () => {
      expect(parseChannel("user:mail:user-123")).toEqual({
        type: "user:mail",
        userId: "user-123",
      });
      expect(parseChannel("user:notifications:user-456")).toEqual({
        type: "user:notifications",
        userId: "user-456",
      });
    });

    test("parses system channels", () => {
      expect(parseChannel("system:health")).toEqual({ type: "system:health" });
      expect(parseChannel("system:metrics")).toEqual({
        type: "system:metrics",
      });
      expect(parseChannel("system:maintenance")).toEqual({
        type: "system:maintenance",
      });
      expect(parseChannel("system:circuits")).toEqual({
        type: "system:circuits",
      });
    });

    test("handles IDs with colons", () => {
      expect(parseChannel("agent:output:agent:with:colons")).toEqual({
        type: "agent:output",
        agentId: "agent:with:colons",
      });
    });

    test("returns undefined for invalid format", () => {
      expect(parseChannel("invalid")).toBeUndefined();
      expect(parseChannel("")).toBeUndefined();
      expect(parseChannel("agent:output")).toBeUndefined(); // Missing ID
      expect(parseChannel("unknown:type:id")).toBeUndefined();
    });
  });

  describe("round-trip", () => {
    test("channelToString -> parseChannel preserves data", () => {
      const channels: Channel[] = [
        { type: "agent:output", agentId: "test-agent" },
        { type: "workspace:agents", workspaceId: "test-workspace" },
        { type: "user:mail", userId: "test-user" },
        { type: "system:health" },
        { type: "system:maintenance" },
        { type: "system:circuits" },
      ];

      for (const channel of channels) {
        const serialized = channelToString(channel);
        const parsed = parseChannel(serialized);
        expect(parsed).toEqual(channel);
      }
    });
  });

  describe("getChannelTypePrefix", () => {
    test("returns type prefix for all channel types", () => {
      expect(getChannelTypePrefix({ type: "agent:output", agentId: "x" })).toBe(
        "agent:output",
      );
      expect(
        getChannelTypePrefix({ type: "workspace:agents", workspaceId: "x" }),
      ).toBe("workspace:agents");
      expect(getChannelTypePrefix({ type: "user:mail", userId: "x" })).toBe(
        "user:mail",
      );
      expect(getChannelTypePrefix({ type: "system:health" })).toBe(
        "system:health",
      );
    });
  });

  describe("getChannelScope", () => {
    test("returns correct scope for each channel type", () => {
      expect(getChannelScope({ type: "agent:output", agentId: "x" })).toBe(
        "agent",
      );
      expect(getChannelScope({ type: "agent:state", agentId: "x" })).toBe(
        "agent",
      );
      expect(
        getChannelScope({ type: "workspace:agents", workspaceId: "x" }),
      ).toBe("workspace");
      expect(getChannelScope({ type: "user:mail", userId: "x" })).toBe("user");
      expect(getChannelScope({ type: "system:health" })).toBe("system");
    });
  });

  describe("getChannelResourceId", () => {
    test("returns ID for scoped channels", () => {
      expect(
        getChannelResourceId({ type: "agent:output", agentId: "agent-123" }),
      ).toBe("agent-123");
      expect(
        getChannelResourceId({
          type: "workspace:agents",
          workspaceId: "ws-456",
        }),
      ).toBe("ws-456");
      expect(
        getChannelResourceId({ type: "user:mail", userId: "user-789" }),
      ).toBe("user-789");
    });

    test("returns undefined for system channels", () => {
      expect(getChannelResourceId({ type: "system:health" })).toBeUndefined();
      expect(getChannelResourceId({ type: "system:metrics" })).toBeUndefined();
      expect(
        getChannelResourceId({ type: "system:maintenance" }),
      ).toBeUndefined();
      expect(getChannelResourceId({ type: "system:circuits" })).toBeUndefined();
    });
  });

  describe("channelsEqual", () => {
    test("returns true for identical channels", () => {
      expect(
        channelsEqual(
          { type: "agent:output", agentId: "test" },
          { type: "agent:output", agentId: "test" },
        ),
      ).toBe(true);

      expect(
        channelsEqual({ type: "system:health" }, { type: "system:health" }),
      ).toBe(true);
    });

    test("returns false for different channels", () => {
      expect(
        channelsEqual(
          { type: "agent:output", agentId: "test1" },
          { type: "agent:output", agentId: "test2" },
        ),
      ).toBe(false);

      expect(
        channelsEqual(
          { type: "agent:output", agentId: "test" },
          { type: "agent:state", agentId: "test" },
        ),
      ).toBe(false);
    });
  });

  describe("channelMatchesPattern", () => {
    test("matches exact patterns", () => {
      const channel: Channel = { type: "agent:output", agentId: "agent-123" };

      expect(channelMatchesPattern(channel, "agent:output:agent-123")).toBe(
        true,
      );
      expect(channelMatchesPattern(channel, "agent:output:agent-456")).toBe(
        false,
      );
    });

    test("matches wildcard patterns", () => {
      const channel: Channel = { type: "agent:output", agentId: "agent-123" };

      expect(channelMatchesPattern(channel, "agent:output:*")).toBe(true);
      expect(channelMatchesPattern(channel, "agent:*:agent-123")).toBe(true);
      expect(channelMatchesPattern(channel, "*:output:agent-123")).toBe(true);
    });

    test("wildcard does not cross colons", () => {
      const channel: Channel = { type: "agent:output", agentId: "agent-123" };

      // * matches [^:]*  so won't cross colons
      expect(channelMatchesPattern(channel, "agent:*")).toBe(false);
      expect(channelMatchesPattern(channel, "*:agent-123")).toBe(false);
    });

    test("matches system channels", () => {
      const channel: Channel = { type: "system:health" };

      expect(channelMatchesPattern(channel, "system:health")).toBe(true);
      expect(channelMatchesPattern(channel, "system:*")).toBe(true);
    });
  });
});
