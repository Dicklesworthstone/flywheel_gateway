/**
 * Channel Authorization for WebSocket subscriptions.
 *
 * Enforces access control on channel subscriptions and publishing.
 * Rules:
 * - agent:* channels require read access to the specific agent
 * - workspace:* channels require workspace membership
 * - user:* channels require being that user
 * - system:* channels require authenticated connection
 */

import type { Channel } from "./channels";
import type { AuthContext } from "./hub";

/**
 * Authorization result.
 */
export interface AuthorizationResult {
  /** Whether the action is allowed */
  allowed: boolean;
  /** Reason for denial (if not allowed) */
  reason?: string;
}

/**
 * Check if a user can subscribe to a channel.
 *
 * @param auth - Authentication context
 * @param channel - Channel to subscribe to
 * @param agentAccess - Optional callback to check agent access
 * @returns Authorization result
 */
export function canSubscribe(
  auth: AuthContext,
  channel: Channel,
  agentAccess?: (
    agentId: string,
    userId?: string,
    workspaceIds?: string[],
  ) => boolean,
): AuthorizationResult {
  // Admins can subscribe to anything
  if (auth.isAdmin) {
    return { allowed: true };
  }

  // Must be authenticated for any subscription
  if (!auth.userId && !auth.apiKeyId) {
    return { allowed: false, reason: "Authentication required" };
  }

  switch (channel.type) {
    // Agent channels: require access to the specific agent
    case "agent:output":
    case "agent:state":
    case "agent:tools": {
      // If we have an agent access checker, use it
      if (agentAccess) {
        const hasAccess = agentAccess(
          channel.agentId,
          auth.userId,
          auth.workspaceIds,
        );
        if (!hasAccess) {
          return {
            allowed: false,
            reason: `No access to agent ${channel.agentId}`,
          };
        }
      }
      // Without a checker, allow if authenticated (agent-level checks happen elsewhere)
      return { allowed: true };
    }

    // Workspace channels: require membership in the workspace
    case "workspace:agents":
    case "workspace:reservations":
    case "workspace:conflicts": {
      if (!auth.workspaceIds.includes(channel.workspaceId)) {
        return {
          allowed: false,
          reason: `Not a member of workspace ${channel.workspaceId}`,
        };
      }
      return { allowed: true };
    }

    // User channels: require being that user
    case "user:mail":
    case "user:notifications": {
      if (auth.userId !== channel.userId) {
        return {
          allowed: false,
          reason: `Cannot subscribe to another user's channel`,
        };
      }
      return { allowed: true };
    }

    // System channels: just need authentication
    case "system:health":
    case "system:metrics": {
      return { allowed: true };
    }

    default: {
      // Unknown channel type
      return { allowed: false, reason: "Unknown channel type" };
    }
  }
}

/**
 * Check if a user can publish to a channel.
 * Publishing is more restricted than subscribing.
 *
 * @param auth - Authentication context
 * @param channel - Channel to publish to
 * @returns Authorization result
 */
export function canPublish(
  auth: AuthContext,
  channel: Channel,
): AuthorizationResult {
  // Admins can publish to anything
  if (auth.isAdmin) {
    return { allowed: true };
  }

  // Must be authenticated
  if (!auth.userId && !auth.apiKeyId) {
    return { allowed: false, reason: "Authentication required" };
  }

  switch (channel.type) {
    // Agent channels: only internal services can publish
    case "agent:output":
    case "agent:state":
    case "agent:tools": {
      // Regular users cannot publish to agent channels
      // These are populated by the gateway internals
      return {
        allowed: false,
        reason: "Only internal services can publish to agent channels",
      };
    }

    // Workspace channels: can publish if member
    case "workspace:agents":
    case "workspace:reservations":
    case "workspace:conflicts": {
      if (!auth.workspaceIds.includes(channel.workspaceId)) {
        return {
          allowed: false,
          reason: `Not a member of workspace ${channel.workspaceId}`,
        };
      }
      return { allowed: true };
    }

    // User channels: can send mail to any user, notifications only to self
    case "user:mail": {
      // Anyone can send mail (it goes to the recipient's inbox)
      return { allowed: true };
    }
    case "user:notifications": {
      // Only the user themselves or system can create notifications
      if (auth.userId !== channel.userId) {
        return {
          allowed: false,
          reason: "Cannot create notifications for another user",
        };
      }
      return { allowed: true };
    }

    // System channels: only admin/system can publish
    case "system:health":
    case "system:metrics": {
      return {
        allowed: false,
        reason: "Only system services can publish to system channels",
      };
    }

    default: {
      return { allowed: false, reason: "Unknown channel type" };
    }
  }
}

/**
 * Create an internal auth context for system operations.
 * Used when the gateway itself needs to publish messages.
 */
export function createInternalAuthContext(): AuthContext {
  return {
    userId: "system",
    workspaceIds: [],
    isAdmin: true,
  };
}

/**
 * Create a guest auth context for unauthenticated connections.
 * Very limited access.
 */
export function createGuestAuthContext(): AuthContext {
  return {
    userId: undefined,
    workspaceIds: [],
    isAdmin: false,
  };
}

/**
 * Validate and sanitize auth context from request.
 * Ensures required fields are present.
 */
export function validateAuthContext(auth: Partial<AuthContext>): AuthContext {
  const workspaceIds = Array.isArray(auth.workspaceIds)
    ? auth.workspaceIds.filter((id): id is string => typeof id === "string")
    : [];

  return {
    userId: auth.userId,
    apiKeyId: auth.apiKeyId,
    workspaceIds,
    isAdmin: auth.isAdmin ?? false,
  };
}
