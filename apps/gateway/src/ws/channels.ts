/**
 * WebSocket Channel Types and Parsing.
 *
 * Channels define the topics that clients can subscribe to.
 * Each channel type has specific semantics and authorization requirements.
 */

/**
 * Agent-scoped channels for per-agent subscriptions.
 */
export type AgentChannel =
  | { type: "agent:output"; agentId: string }
  | { type: "agent:state"; agentId: string }
  | { type: "agent:tools"; agentId: string };

/**
 * Workspace-scoped channels for workspace-wide subscriptions.
 */
export type WorkspaceChannel =
  | { type: "workspace:agents"; workspaceId: string }
  | { type: "workspace:reservations"; workspaceId: string }
  | { type: "workspace:conflicts"; workspaceId: string };

/**
 * User-scoped channels for per-user subscriptions.
 */
export type UserChannel =
  | { type: "user:mail"; userId: string }
  | { type: "user:notifications"; userId: string };

/**
 * System-wide channels.
 */
export type SystemChannel =
  | { type: "system:health" }
  | { type: "system:metrics" }
  | { type: "system:dcg" };

/**
 * All channel types.
 */
export type Channel = AgentChannel | WorkspaceChannel | UserChannel | SystemChannel;

/**
 * Channel type prefixes for categorization.
 */
export type ChannelTypePrefix =
  | "agent:output"
  | "agent:state"
  | "agent:tools"
  | "workspace:agents"
  | "workspace:reservations"
  | "workspace:conflicts"
  | "user:mail"
  | "user:notifications"
  | "system:health"
  | "system:metrics"
  | "system:dcg";

/**
 * Convert a channel to its string representation.
 * Format: "type:id" (e.g., "agent:output:agent-abc123")
 *
 * @param channel - The channel to serialize
 * @returns String representation of the channel
 */
export function channelToString(channel: Channel): string {
  switch (channel.type) {
    case "agent:output":
    case "agent:state":
    case "agent:tools":
      return `${channel.type}:${channel.agentId}`;

    case "workspace:agents":
    case "workspace:reservations":
    case "workspace:conflicts":
      return `${channel.type}:${channel.workspaceId}`;

    case "user:mail":
    case "user:notifications":
      return `${channel.type}:${channel.userId}`;

    case "system:health":
    case "system:metrics":
    case "system:dcg":
      return channel.type;
  }
}

/**
 * Parse a channel string to its structured form.
 *
 * @param str - The channel string to parse
 * @returns Parsed channel or undefined if invalid
 */
export function parseChannel(str: string): Channel | undefined {
  // System channels (no ID)
  if (str === "system:health") {
    return { type: "system:health" };
  }
  if (str === "system:metrics") {
    return { type: "system:metrics" };
  }
  if (str === "system:dcg") {
    return { type: "system:dcg" };
  }

  // Channels with IDs: split into type and ID
  const parts = str.split(":");
  if (parts.length < 3) return undefined;

  // Reconstruct type (first two parts) and ID (remaining parts, in case ID contains colons)
  const typePrefix = `${parts[0]}:${parts[1]}` as ChannelTypePrefix;
  const id = parts.slice(2).join(":");

  if (!id) return undefined;

  switch (typePrefix) {
    case "agent:output":
      return { type: "agent:output", agentId: id };
    case "agent:state":
      return { type: "agent:state", agentId: id };
    case "agent:tools":
      return { type: "agent:tools", agentId: id };
    case "workspace:agents":
      return { type: "workspace:agents", workspaceId: id };
    case "workspace:reservations":
      return { type: "workspace:reservations", workspaceId: id };
    case "workspace:conflicts":
      return { type: "workspace:conflicts", workspaceId: id };
    case "user:mail":
      return { type: "user:mail", userId: id };
    case "user:notifications":
      return { type: "user:notifications", userId: id };
    default:
      return undefined;
  }
}

/**
 * Get the type prefix of a channel (without the ID).
 *
 * @param channel - The channel
 * @returns The type prefix (e.g., "agent:output")
 */
export function getChannelTypePrefix(channel: Channel): ChannelTypePrefix {
  return channel.type;
}

/**
 * Get the scope type of a channel.
 */
export function getChannelScope(channel: Channel): "agent" | "workspace" | "user" | "system" {
  if (channel.type.startsWith("agent:")) return "agent";
  if (channel.type.startsWith("workspace:")) return "workspace";
  if (channel.type.startsWith("user:")) return "user";
  return "system";
}

/**
 * Get the resource ID for a scoped channel.
 *
 * @param channel - The channel
 * @returns The resource ID or undefined for system channels
 */
export function getChannelResourceId(channel: Channel): string | undefined {
  switch (channel.type) {
    case "agent:output":
    case "agent:state":
    case "agent:tools":
      return channel.agentId;
    case "workspace:agents":
    case "workspace:reservations":
    case "workspace:conflicts":
      return channel.workspaceId;
    case "user:mail":
    case "user:notifications":
      return channel.userId;
    case "system:health":
    case "system:metrics":
      return undefined;
  }
}

/**
 * Check if two channels are equal.
 */
export function channelsEqual(a: Channel, b: Channel): boolean {
  return channelToString(a) === channelToString(b);
}

/**
 * Check if a channel matches a pattern.
 * Patterns can use '*' as wildcard for the ID part.
 *
 * Examples:
 * - "agent:output:*" matches any agent output channel
 * - "workspace:*:workspace-123" matches any workspace channel for workspace-123
 *
 * @param channel - The channel to check
 * @param pattern - The pattern to match against
 * @returns true if the channel matches the pattern
 */
export function channelMatchesPattern(channel: Channel, pattern: string): boolean {
  const channelStr = channelToString(channel);

  // Simple case: exact match
  if (channelStr === pattern) return true;

  // Wildcard matching
  if (pattern.includes("*")) {
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
      .replace(/\*/g, "[^:]*"); // Replace * with "anything except :"
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(channelStr);
  }

  return false;
}
