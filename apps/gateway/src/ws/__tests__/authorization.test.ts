/**
 * Tests for WebSocket channel authorization.
 */

import { describe, expect, test } from "bun:test";
import { canSubscribe } from "../authorization";
import type { Channel } from "../channels";
import type { AuthContext } from "../hub";

describe("canSubscribe", () => {
  test("denies unauthenticated subscriptions", () => {
    const auth: AuthContext = { workspaceIds: [], isAdmin: false };
    const channel: Channel = { type: "session:health", id: "sess-1" };

    expect(canSubscribe(auth, channel)).toEqual({
      allowed: false,
      reason: "Authentication required",
    });
  });

  test("allows admins to subscribe to agent channels", () => {
    const auth: AuthContext = {
      userId: "system",
      workspaceIds: [],
      isAdmin: true,
    };
    const channel: Channel = { type: "agent:output", agentId: "agent-123" };

    expect(canSubscribe(auth, channel).allowed).toBe(true);
  });

  test("denies agent channels without explicit agent access check", () => {
    const auth: AuthContext = {
      userId: "user-1",
      workspaceIds: [],
      isAdmin: false,
    };
    const channel: Channel = { type: "agent:state", agentId: "agent-123" };

    expect(canSubscribe(auth, channel)).toEqual({
      allowed: false,
      reason: "Agent access check is required for agent channels",
    });
  });

  test("allows agent channels when agent access check passes", () => {
    const auth: AuthContext = {
      userId: "user-1",
      workspaceIds: [],
      isAdmin: false,
    };
    const channel: Channel = { type: "agent:tools", agentId: "agent-123" };

    const result = canSubscribe(auth, channel, (agentId, userId) => {
      return agentId === "agent-123" && userId === "user-1";
    });
    expect(result.allowed).toBe(true);
  });

  test("denies agent channels when agent access check fails", () => {
    const auth: AuthContext = {
      userId: "user-1",
      workspaceIds: [],
      isAdmin: false,
    };
    const channel: Channel = {
      type: "agent:checkpoints",
      agentId: "agent-123",
    };

    const result = canSubscribe(auth, channel, () => false);
    expect(result).toEqual({
      allowed: false,
      reason: "No access to agent agent-123",
    });
  });

  test("enforces workspace membership for workspace channels", () => {
    const auth: AuthContext = {
      userId: "user-1",
      workspaceIds: ["ws-1"],
      isAdmin: false,
    };

    const ok: Channel = { type: "workspace:agents", workspaceId: "ws-1" };
    expect(canSubscribe(auth, ok).allowed).toBe(true);

    const denied: Channel = { type: "workspace:git", workspaceId: "ws-2" };
    expect(canSubscribe(auth, denied)).toEqual({
      allowed: false,
      reason: "Not a member of workspace ws-2",
    });
  });

  test("enforces user scoping for user channels", () => {
    const auth: AuthContext = {
      userId: "user-1",
      workspaceIds: [],
      isAdmin: false,
    };
    const ok: Channel = { type: "user:mail", userId: "user-1" };
    expect(canSubscribe(auth, ok).allowed).toBe(true);

    const denied: Channel = { type: "user:notifications", userId: "user-2" };
    expect(canSubscribe(auth, denied)).toEqual({
      allowed: false,
      reason: "Cannot subscribe to another user's channel",
    });
  });
});
