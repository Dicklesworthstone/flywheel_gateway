/**
 * Discord Webhook Adapter
 *
 * Sends alert notifications to Discord via incoming webhooks.
 * Supports rich embed formatting with severity-based colors.
 *
 * @see https://discord.com/developers/docs/resources/webhook
 * @see bd-3c0o3 Real-time Alert Channels bead
 */

import { getLogger } from "../../middleware/correlation";
import { isPrivateNetworkUrl } from "../../utils/url-security";
import type {
  AlertPayload,
  ChannelAdapter,
  ChannelConfig,
  DeliveryResult,
} from "./types";

/** Discord embed color by severity (decimal color values) */
const SEVERITY_COLORS: Record<string, number> = {
  critical: 0xdc3545, // Red
  error: 0xfd7e14, // Orange
  warning: 0xffc107, // Yellow
  info: 0x17a2b8, // Cyan
  low: 0x6c757d, // Gray
};

/** Discord embed field max length */
const FIELD_VALUE_MAX_LENGTH = 1024;

/** Discord embed description max length */
const DESCRIPTION_MAX_LENGTH = 4096;

/** Default fetch timeout (10 seconds) */
const WEBHOOK_TIMEOUT_MS = 10_000;

export interface DiscordConfig extends ChannelConfig {
  webhookUrl: string;
  username?: string;
  avatarUrl?: string;
  /** Thread ID if posting to a thread */
  threadId?: string;
}

/**
 * Truncate text to max length with ellipsis.
 */
function truncateText(text: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  return `${chars.slice(0, Math.max(0, maxLength - 1)).join("")}…`;
}

/**
 * Escape special characters for Discord markdown.
 * Discord uses a subset of Markdown with some special handling.
 */
function escapeDiscordMarkdown(text: string): string {
  // Escape: * _ ` ~ | \ < > [ ] ( )
  return text.replace(/([*_`~|\\<>[\]()])/g, "\\$1");
}

/**
 * Mask a URL for safe logging.
 */
function maskUrlForLogging(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/***`;
  } catch {
    return "***invalid-url***";
  }
}

/**
 * Build Discord embed payload from alert.
 */
function buildDiscordPayload(
  alert: AlertPayload,
  config: DiscordConfig,
): {
  username?: string;
  avatar_url?: string;
  embeds: Array<{
    title: string;
    description: string;
    color: number;
    fields: Array<{ name: string; value: string; inline?: boolean }>;
    footer?: { text: string };
    timestamp?: string;
  }>;
} {
  const color = SEVERITY_COLORS[alert.severity] ?? 0x17a2b8; // Default to info color

  const severityEmoji: Record<string, string> = {
    critical: ":rotating_light:",
    error: ":x:",
    warning: ":warning:",
    info: ":information_source:",
    low: ":grey_question:",
  };

  const emoji = severityEmoji[alert.severity] ?? "";
  const title = truncateText(`${emoji} ${alert.title}`, 256);
  const description = truncateText(
    escapeDiscordMarkdown(alert.body),
    DESCRIPTION_MAX_LENGTH,
  );

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    {
      name: "Severity",
      value: alert.severity.toUpperCase(),
      inline: true,
    },
    {
      name: "Category",
      value: alert.category ?? "general",
      inline: true,
    },
  ];

  // Add source if available
  if (alert.source) {
    fields.push({
      name: "Source",
      value: truncateText(
        typeof alert.source === "string"
          ? alert.source
          : (alert.source.name ?? alert.source.type ?? "unknown"),
        FIELD_VALUE_MAX_LENGTH,
      ),
      inline: true,
    });
  }

  // Add link if available
  if (alert.link) {
    fields.push({
      name: "Details",
      value: `[View Details](${alert.link})`,
      inline: false,
    });
  }

  const payload: ReturnType<typeof buildDiscordPayload> = {
    embeds: [
      {
        title,
        description,
        color,
        fields,
        footer: {
          text: "Flywheel Gateway Alert",
        },
        timestamp: alert.timestamp ?? new Date().toISOString(),
      },
    ],
  };

  // Add optional username/avatar
  if (config.username) {
    payload.username = config.username;
  }
  if (config.avatarUrl) {
    payload.avatar_url = config.avatarUrl;
  }

  return payload;
}

/**
 * Discord webhook adapter.
 */
export const discordAdapter: ChannelAdapter<DiscordConfig> = {
  type: "discord",

  async send(
    alert: AlertPayload,
    config: DiscordConfig,
  ): Promise<DeliveryResult> {
    const log = getLogger();
    const startTime = Date.now();

    if (!config.webhookUrl) {
      return {
        success: false,
        error: "Discord webhook URL not configured",
        errorCode: "MISSING_CONFIG",
        durationMs: Date.now() - startTime,
      };
    }

    // SECURITY: Prevent SSRF
    if (isPrivateNetworkUrl(config.webhookUrl)) {
      log.warn(
        { alertId: alert.id },
        "[DISCORD] Webhook blocked: URL points to private/internal network",
      );
      return {
        success: false,
        error: "Webhook URL points to private network",
        errorCode: "SSRF_BLOCKED",
        durationMs: Date.now() - startTime,
      };
    }

    const maskedUrl = maskUrlForLogging(config.webhookUrl);

    try {
      const payload = buildDiscordPayload(alert, config);

      // Append thread_id query param if specified
      let url = config.webhookUrl;
      if (config.threadId) {
        const separator = url.includes("?") ? "&" : "?";
        url = `${url}${separator}thread_id=${config.threadId}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        WEBHOOK_TIMEOUT_MS,
      );

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        const durationMs = Date.now() - startTime;

        if (!response.ok) {
          const errorText = await response.text();
          log.error(
            {
              alertId: alert.id,
              url: maskedUrl,
              status: response.status,
              error: errorText,
            },
            "[DISCORD] Webhook request failed",
          );
          return {
            success: false,
            error: errorText,
            errorCode: `HTTP_${response.status}`,
            responseStatus: response.status,
            durationMs,
          };
        }

        log.info(
          { alertId: alert.id, title: alert.title, durationMs },
          "[DISCORD] Alert sent successfully",
        );

        return {
          success: true,
          responseStatus: response.status,
          durationMs,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const isTimeout = error instanceof Error && error.name === "AbortError";

      log.error(
        {
          alertId: alert.id,
          url: maskedUrl,
          error: isTimeout ? "Request timed out" : String(error),
        },
        "[DISCORD] Webhook request error",
      );

      return {
        success: false,
        error: isTimeout ? "Request timed out" : String(error),
        errorCode: isTimeout ? "TIMEOUT" : "REQUEST_ERROR",
        durationMs,
      };
    }
  },

  validateConfig(config: unknown): config is DiscordConfig {
    if (typeof config !== "object" || config === null) return false;
    const c = config as Record<string, unknown>;

    if (typeof c["webhookUrl"] !== "string" || !c["webhookUrl"]) return false;

    // Validate URL format
    try {
      const url = new URL(c["webhookUrl"]);
      // Discord webhooks should be on discord.com
      if (
        !url.hostname.endsWith("discord.com") &&
        !url.hostname.endsWith("discordapp.com")
      ) {
        return false;
      }
    } catch {
      return false;
    }

    if (c["username"] !== undefined && typeof c["username"] !== "string")
      return false;
    if (c["avatarUrl"] !== undefined && typeof c["avatarUrl"] !== "string")
      return false;
    if (c["threadId"] !== undefined && typeof c["threadId"] !== "string")
      return false;

    return true;
  },

  async testConnection(config: DiscordConfig): Promise<DeliveryResult> {
    return this.send(
      {
        id: `test_${Date.now()}`,
        type: "test",
        title: "Test Alert",
        body: "This is a test alert from Flywheel Gateway to verify your Discord webhook configuration.",
        severity: "info",
        category: "system",
        timestamp: new Date().toISOString(),
      },
      config,
    );
  },
};
