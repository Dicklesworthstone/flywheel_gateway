/**
 * Alert Adapters
 *
 * Unified export of all channel adapters for alert delivery.
 *
 * @see bd-3c0o3 Real-time Alert Channels bead
 */

export * from "./discord.adapter";
export * from "./slack.adapter";
export * from "./types";
export * from "./webhook.adapter";

import { discordAdapter } from "./discord.adapter";
import { slackAdapter } from "./slack.adapter";
import type { AdapterRegistry, ChannelAdapter } from "./types";
import { webhookAdapter } from "./webhook.adapter";

/**
 * Registry of all available adapters by type.
 */
export const adapters: AdapterRegistry = {
  webhook: webhookAdapter,
  slack: slackAdapter,
  discord: discordAdapter,
};

/**
 * Get an adapter by type.
 */
export function getAdapter(type: string): ChannelAdapter | undefined {
  return adapters[type];
}

/**
 * Get all supported channel types.
 */
export function getSupportedChannelTypes(): string[] {
  return Object.keys(adapters);
}
