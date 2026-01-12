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
  | { type: "agent:tools"; agentId: string }
  | { type: "agent:checkpoints"; agentId: string };

/**
 * Workspace-scoped channels for workspace-wide subscriptions.
 */
export type WorkspaceChannel =
  | { type: "workspace:agents"; workspaceId: string }
  | { type: "workspace:reservations"; workspaceId: string }
  | { type: "workspace:conflicts"; workspaceId: string }
  | { type: "workspace:graph"; workspaceId: string }
  | { type: "workspace:git"; workspaceId: string }
  | { type: "workspace:handoffs"; workspaceId: string };

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
  | { type: "system:dcg" }
  | { type: "system:fleet" }
  | { type: "system:supervisor" };

/**
 * Fleet-scoped channels for RU (Repo Updater) operations.
 */
export type FleetChannel =
  | { type: "fleet:repos" }
  | { type: "fleet:sync" }
  | { type: "fleet:sync:session"; sessionId: string }
  | { type: "fleet:sweep" }
  | { type: "fleet:sweep:session"; sessionId: string };

/**
 * Pipeline-scoped channels for pipeline engine operations.
 */
export type PipelineChannel =
  | { type: "pipeline:all" }
  | { type: "pipeline:run"; pipelineId: string; runId: string };

/**
 * All channel types.
 */
export type Channel =
  | AgentChannel
  | WorkspaceChannel
  | UserChannel
  | SystemChannel
  | FleetChannel
  | PipelineChannel;

/**
 * Channel type prefixes for categorization.
 */
export type ChannelTypePrefix =
  | "agent:output"
  | "agent:state"
  | "agent:tools"
  | "agent:checkpoints"
  | "workspace:agents"
  | "workspace:reservations"
  | "workspace:conflicts"
  | "workspace:graph"
  | "workspace:git"
  | "workspace:handoffs"
  | "user:mail"
  | "user:notifications"
  | "system:health"
  | "system:metrics"
  | "system:dcg"
  | "system:fleet"
  | "system:supervisor"
  | "fleet:repos"
  | "fleet:sync"
  | "fleet:sync:session"
  | "fleet:sweep"
  | "fleet:sweep:session"
  | "pipeline:all"
  | "pipeline:run";

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
    case "agent:checkpoints":
      return `${channel.type}:${channel.agentId}`;

    case "workspace:agents":
    case "workspace:reservations":
    case "workspace:conflicts":
    case "workspace:graph":
    case "workspace:git":
    case "workspace:handoffs":
      return `${channel.type}:${channel.workspaceId}`;

    case "user:mail":
    case "user:notifications":
      return `${channel.type}:${channel.userId}`;

    case "system:health":
    case "system:metrics":
    case "system:dcg":
    case "system:fleet":
    case "system:supervisor":
      return channel.type;

    case "fleet:repos":
    case "fleet:sync":
    case "fleet:sweep":
      return channel.type;

    case "fleet:sync:session":
      return `fleet:sync:session:${channel.sessionId}`;

    case "fleet:sweep:session":
      return `fleet:sweep:session:${channel.sessionId}`;

    case "pipeline:all":
      return channel.type;

    case "pipeline:run":
      return `pipeline:run:${channel.pipelineId}:${channel.runId}`;
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
  if (str === "system:fleet") {
    return { type: "system:fleet" };
  }
  if (str === "system:supervisor") {
    return { type: "system:supervisor" };
  }

  // Fleet channels (some with IDs)
  if (str === "fleet:repos") {
    return { type: "fleet:repos" };
  }
  if (str === "fleet:sync") {
    return { type: "fleet:sync" };
  }
  if (str === "fleet:sweep") {
    return { type: "fleet:sweep" };
  }

  // Fleet session-specific channels: fleet:sync:session:<id> or fleet:sweep:session:<id>
  if (str.startsWith("fleet:sync:session:")) {
    const sessionId = str.substring("fleet:sync:session:".length);
    if (sessionId) {
      return { type: "fleet:sync:session", sessionId };
    }
  }
  if (str.startsWith("fleet:sweep:session:")) {
    const sessionId = str.substring("fleet:sweep:session:".length);
    if (sessionId) {
      return { type: "fleet:sweep:session", sessionId };
    }
  }

  // Pipeline channels
  if (str === "pipeline:all") {
    return { type: "pipeline:all" };
  }
  if (str.startsWith("pipeline:run:")) {
    const rest = str.substring("pipeline:run:".length);
    const [pipelineId, runId] = rest.split(":");
    if (pipelineId && runId) {
      return { type: "pipeline:run", pipelineId, runId };
    }
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
    case "agent:checkpoints":
      return { type: "agent:checkpoints", agentId: id };
    case "workspace:agents":
      return { type: "workspace:agents", workspaceId: id };
    case "workspace:reservations":
      return { type: "workspace:reservations", workspaceId: id };
    case "workspace:conflicts":
      return { type: "workspace:conflicts", workspaceId: id };
    case "workspace:graph":
      return { type: "workspace:graph", workspaceId: id };
    case "workspace:git":
      return { type: "workspace:git", workspaceId: id };
    case "workspace:handoffs":
      return { type: "workspace:handoffs", workspaceId: id };
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
export function getChannelScope(
  channel: Channel,
): "agent" | "workspace" | "user" | "system" | "fleet" | "pipeline" {
  if (channel.type.startsWith("agent:")) return "agent";
  if (channel.type.startsWith("workspace:")) return "workspace";
  if (channel.type.startsWith("user:")) return "user";
  if (channel.type.startsWith("fleet:")) return "fleet";
  if (channel.type.startsWith("pipeline:")) return "pipeline";
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
    case "agent:checkpoints":
      return channel.agentId;
    case "workspace:agents":
    case "workspace:reservations":
    case "workspace:conflicts":
    case "workspace:graph":
    case "workspace:git":
    case "workspace:handoffs":
      return channel.workspaceId;
    case "user:mail":
    case "user:notifications":
      return channel.userId;
    case "system:health":
    case "system:metrics":
    case "system:dcg":
    case "system:fleet":
    case "system:supervisor":
      return undefined;
    case "fleet:repos":
    case "fleet:sync":
    case "fleet:sweep":
      return undefined;
    case "fleet:sync:session":
    case "fleet:sweep:session":
      return channel.sessionId;
    case "pipeline:all":
      return undefined;
    case "pipeline:run":
      return `${channel.pipelineId}:${channel.runId}`;
  }
}

/**
 * Check if two channels are equal.
 */
export function channelsEqual(a: Channel, b: Channel): boolean {
  return channelToString(a) === channelToString(b);
}

/**
 * Channel types that require explicit acknowledgment.
 * Messages on these channels will be replayed if not acknowledged before disconnection.
 */
export const ACK_REQUIRED_CHANNELS: ReadonlySet<ChannelTypePrefix> = new Set([
  "workspace:conflicts",
  "workspace:reservations",
  "user:notifications",
]);

/**
 * Check if a channel requires acknowledgment.
 *
 * @param channel - The channel to check
 * @returns true if messages on this channel require ack
 */
export function channelRequiresAck(channel: Channel): boolean {
  return ACK_REQUIRED_CHANNELS.has(channel.type);
}

/**
 * Check if a channel type prefix requires acknowledgment.
 *
 * @param prefix - The channel type prefix
 * @returns true if messages on channels with this prefix require ack
 */
export function channelPrefixRequiresAck(prefix: ChannelTypePrefix): boolean {
  return ACK_REQUIRED_CHANNELS.has(prefix);
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
export function channelMatchesPattern(
  channel: Channel,
  pattern: string,
): boolean {
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
